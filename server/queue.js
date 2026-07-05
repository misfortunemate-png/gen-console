const fs = require('fs');
const path = require('path');

const compose = require('./compose');
const comfy = require('./comfy');
const validate = require('./validate');
const presets = require('./presets');
const logger = require('./logger');

const APP_ROOT = path.join(__dirname, '..');
const CONTENT_ROOT = path.join(APP_ROOT, '..', 'content');
const COMFYUI_OUTPUT_DIR = path.join(APP_ROOT, '..', 'ComfyUI', 'output');

const DEFAULT_MAX_IMAGES = 100;
const DEFAULT_TASK_TIMEOUT_MS = 120000; // ~5x the ~21-25s/image observed at G0 (896x1152, steps25)

class QueueError extends Error {
  constructor(type, detail) {
    super(type);
    this.type = type;
    this.detail = detail;
  }
}

let currentRun = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateRunId() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function loadProfile(profileId) {
  const profilePath = path.join(APP_ROOT, 'profiles', `${profileId}.json`);
  return JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
}

function expandRunToTasks(runDef, library) {
  const axisEntryPair = Object.entries(runDef.categorySelections || {}).find(([, sel]) => sel.mode === 'axis');
  if (!axisEntryPair) throw new QueueError('no_axis');
  const [axisCatId, axisSel] = axisEntryPair;
  const axisCat = library.categories.find((c) => c.id === axisCatId);
  if (!axisCat) throw new QueueError('unknown_category_ref');

  const selectedIds = new Set(axisSel.entryIds || []);
  const axisEntries = axisCat.entries.filter((e) => selectedIds.has(e.id));

  const imagesPerAxisEntry = runDef.imagesPerAxisEntry || 1;
  const tasks = [];
  let taskIndex = 0;
  for (const entry of axisEntries) {
    for (let seq = 1; seq <= imagesPerAxisEntry; seq++) {
      tasks.push({ taskIndex: taskIndex++, axisId: entry.id, seq, status: 'pending' });
    }
  }
  return tasks;
}

function enforceLimit(tasks, maxImages) {
  const limit = maxImages || DEFAULT_MAX_IMAGES;
  if (tasks.length > limit) {
    throw new QueueError('run_exceeds_limit', { total: tasks.length, limit });
  }
}

function validateRunDefOrThrow(runDef, library) {
  const errors = validate.validateRunDef(runDef, library);
  if (errors.length > 0) {
    const err = new QueueError('validation_failed');
    err.errors = errors;
    throw err;
  }
}

function pickSeed(params, task) {
  if (params && typeof params.seedBase === 'number') {
    return (params.seedBase + task.taskIndex) >>> 0;
  }
  return Math.floor(Math.random() * 2 ** 32);
}

function persistManifest(runState) {
  const manifestPath = path.join(CONTENT_ROOT, 'output', runState.runId, 'run-manifest.json');
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  const manifest = {
    runId: runState.runId,
    status: runState.status,
    startedAt: runState.startedAt,
    updatedAt: new Date().toISOString(),
    profileId: runState.profileId,
    runDef: runState.runDef,
    tasks: runState.tasks.map((t) => ({
      taskIndex: t.taskIndex,
      axisId: t.axisId,
      seq: t.seq,
      status: t.status,
      seed: t.seed,
      errorType: t.errorType,
      durationMs: t.durationMs,
    })),
  };
  const tmp = `${manifestPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2));
  fs.renameSync(tmp, manifestPath);
}

// Writes the final PNG+JSON into content/output (the orderer's space — full
// prompt text belongs here per spec §9, unlike logs/pipeline.log). Only
// deletes ComfyUI's own scratch copy after confirming the destination write's
// byte size matches (PM decision: never delete before verifying the copy).
function writeOutputFiles({ outputRoot, task, seed, buffer, positiveText, negativeText, expansionLog, profile, runDef, comfyFilename, comfySubfolder }) {
  const axisDir = path.join(outputRoot, task.axisId);
  fs.mkdirSync(axisDir, { recursive: true });
  const baseName = `${String(task.seq).padStart(3, '0')}_${seed}`;
  const pngPath = path.join(axisDir, `${baseName}.png`);
  const jsonPath = path.join(axisDir, `${baseName}.json`);

  fs.writeFileSync(pngPath, buffer);

  const writtenSize = fs.statSync(pngPath).size;
  if (writtenSize === buffer.length && comfyFilename) {
    const comfyOutputPath = path.join(COMFYUI_OUTPUT_DIR, comfySubfolder || '', comfyFilename);
    try {
      const comfySize = fs.statSync(comfyOutputPath).size;
      if (comfySize === buffer.length) {
        fs.unlinkSync(comfyOutputPath);
      }
    } catch {
      // best-effort cleanup only; never fail the task over this
    }
  }

  const metadata = {
    seed,
    profile: profile.id,
    params: runDef.params,
    positiveText,
    negativeText,
    expansionLog,
    workflow: profile.workflow,
    axisId: task.axisId,
    seq: task.seq,
  };
  fs.writeFileSync(jsonPath, JSON.stringify(metadata, null, 2));
}

async function executeRun(runState) {
  const { runId, runDef, tasks } = runState;
  const library = presets.getLibrary();
  const profile = loadProfile(runState.profileId);
  const outputRoot = path.join(CONTENT_ROOT, 'output', runId);
  fs.mkdirSync(outputRoot, { recursive: true });
  const workflowTemplate = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'workflows', profile.workflow), 'utf-8'));

  for (const task of tasks) {
    if (runState.stopRequested) break;
    if (task.status !== 'pending') continue;

    task.status = 'running';
    persistManifest(runState);
    const t0 = Date.now();

    try {
      const seed = pickSeed(runDef.params, task);
      const { positiveText, negativeText, expansionLog } = compose.buildTaskPrompt({
        runDef,
        library,
        axisEntryId: task.axisId,
        seed,
      });

      const slotValues = {
        __CKPT_NAME__: profile.checkpoint,
        __CLIP_NAME__: profile.clip,
        __VAE_NAME__: profile.vae,
        __POSITIVE_TEXT__: positiveText,
        __NEGATIVE_TEXT__: negativeText,
        __WIDTH__: runDef.params.width,
        __HEIGHT__: runDef.params.height,
        __SEED__: seed,
        __STEPS__: runDef.params.steps,
        __CFG__: runDef.params.cfg,
        __SAMPLER__: runDef.params.sampler,
        __SCHEDULER__: runDef.params.scheduler,
      };

      if (profile.lora) {
        slotValues.__LORA_NAME__ = profile.lora;
        slotValues.__LORA_STRENGTH_MODEL__ = profile.loraStrengthModel ?? 1.0;
        slotValues.__LORA_STRENGTH_CLIP__ = profile.loraStrengthClip ?? 1.0;
      }

      // Test-only deterministic failure injection (spec §5 "失敗継続" test).
      // Never exposed via the production UI — a testdata-driven test script
      // sets this field directly on the run-definition body.
      if (runDef.testInjectFailureAtIndex === task.taskIndex) {
        slotValues.__WIDTH__ = 999999999;
      }

      const filled = comfy.fillTemplate(workflowTemplate, slotValues);
      const { promptId } = await comfy.submitTask(filled);
      const result = await comfy.waitForCompletion(promptId, {
        timeoutMs: runDef.taskTimeoutMs || DEFAULT_TASK_TIMEOUT_MS,
      });

      if (result.status !== 'completed') {
        const err = new Error(result.errorType);
        err.type = result.errorType;
        throw err;
      }

      const { buffer, filename, subfolder } = await comfy.fetchOutputImage(promptId, profile.outputNodeId);
      writeOutputFiles({
        outputRoot,
        task,
        seed,
        buffer,
        positiveText,
        negativeText,
        expansionLog,
        profile,
        runDef,
        comfyFilename: filename,
        comfySubfolder: subfolder,
      });

      task.status = 'completed';
      task.seed = seed;
      task.durationMs = Date.now() - t0;
      runState.completedCount++;
    } catch (err) {
      task.status = 'failed';
      task.errorType = err.type || 'unknown';
      task.durationMs = Date.now() - t0;
      runState.failedCount++;
      logger.logEvent({
        scope: 'run',
        runId,
        taskIndex: task.taskIndex,
        axisId: task.axisId,
        status: 'failed',
        errorType: task.errorType,
        durationMs: task.durationMs,
      });
    }

    persistManifest(runState);

    if (runDef.pauseSeconds > 0 && !runState.stopRequested) {
      await sleep(runDef.pauseSeconds * 1000);
    }
  }

  runState.status = runState.stopRequested ? 'stopped' : 'completed';
  persistManifest(runState);
  logger.logEvent({
    scope: 'run',
    runId,
    status: 'finished',
    finalStatus: runState.status,
    completedCount: runState.completedCount,
    failedCount: runState.failedCount,
  });
}

function startRun(runDef, profileId) {
  if (currentRun && currentRun.status === 'running') {
    throw new QueueError('run_already_active');
  }
  const library = presets.getLibrary();
  validateRunDefOrThrow(runDef, library);
  const tasks = expandRunToTasks(runDef, library);
  enforceLimit(tasks, runDef.maxImages);

  const runId = generateRunId();
  const runState = {
    runId,
    profileId,
    runDef,
    status: 'running',
    startedAt: new Date().toISOString(),
    tasks,
    completedCount: 0,
    failedCount: 0,
    stopRequested: false,
  };
  currentRun = runState;
  persistManifest(runState);

  executeRun(runState).catch((err) => {
    logger.logEvent({ scope: 'run', runId, status: 'crashed', errorType: err.type || 'unknown' });
  });

  return { runId, totalTasks: tasks.length };
}

function resumeRun(runId) {
  const manifestPath = path.join(CONTENT_ROOT, 'output', runId, 'run-manifest.json');
  if (!fs.existsSync(manifestPath)) throw new QueueError('run_not_found');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

  const tasks = manifest.tasks.map((t) => ({
    ...t,
    status: t.status === 'running' ? 'pending' : t.status,
  }));

  const runState = {
    runId,
    profileId: manifest.profileId,
    runDef: manifest.runDef,
    status: 'running',
    startedAt: manifest.startedAt,
    tasks,
    completedCount: tasks.filter((t) => t.status === 'completed').length,
    failedCount: tasks.filter((t) => t.status === 'failed').length,
    stopRequested: false,
  };
  currentRun = runState;
  persistManifest(runState);

  executeRun(runState).catch((err) => {
    logger.logEvent({ scope: 'run', runId, status: 'crashed', errorType: err.type || 'unknown' });
  });

  return { runId, totalTasks: tasks.length };
}

// Directory listing only (path/filename operations) — never opens/reads
// prompt content. NFR-8 compliant.
function listRuns() {
  const outputRoot = path.join(CONTENT_ROOT, 'output');
  if (!fs.existsSync(outputRoot)) return [];
  return fs
    .readdirSync(outputRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(outputRoot, d.name, 'run-manifest.json')))
    .map((d) => d.name)
    .sort()
    .reverse();
}

function getRunManifest(runId) {
  const manifestPath = path.join(CONTENT_ROOT, 'output', runId, 'run-manifest.json');
  if (!fs.existsSync(manifestPath)) throw new QueueError('run_not_found');
  return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
}

function stopCurrentRun() {
  if (!currentRun || currentRun.status !== 'running') {
    throw new QueueError('no_active_run');
  }
  currentRun.stopRequested = true;
}

function getCurrentRunStatus() {
  if (!currentRun) return { active: false };
  const perAxisSegments = {};
  for (const t of currentRun.tasks) {
    if (!perAxisSegments[t.axisId]) perAxisSegments[t.axisId] = { total: 0, done: 0, failed: 0 };
    perAxisSegments[t.axisId].total++;
    if (t.status === 'completed') perAxisSegments[t.axisId].done++;
    if (t.status === 'failed') perAxisSegments[t.axisId].failed++;
  }
  return {
    active: true,
    runId: currentRun.runId,
    status: currentRun.status,
    totalTasks: currentRun.tasks.length,
    completedCount: currentRun.completedCount,
    failedCount: currentRun.failedCount,
    perAxisSegments,
    tasks: currentRun.tasks.map((t) => ({
      taskIndex: t.taskIndex,
      axisId: t.axisId,
      seq: t.seq,
      status: t.status,
      seed: t.seed,
      errorType: t.errorType,
    })),
  };
}

module.exports = {
  startRun,
  resumeRun,
  stopCurrentRun,
  getCurrentRunStatus,
  listRuns,
  getRunManifest,
  expandRunToTasks,
  enforceLimit,
  QueueError,
  DEFAULT_MAX_IMAGES,
  DEFAULT_TASK_TIMEOUT_MS,
};
