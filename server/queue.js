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

function makeModelTag(checkpoint) {
  return (checkpoint || '').replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 16);
}

function appendOutputsIndex(outputsDir, entry) {
  const indexPath = path.join(outputsDir, 'index.jsonl');
  fs.appendFileSync(indexPath, JSON.stringify(entry) + '\n');
}

// Saves the PNG to content/output/temp/ and appends gallery metadata to
// temp/index.jsonl. Deletes ComfyUI's scratch copy after confirming byte count.
function writeOutputFiles({ task, seed, buffer, profile, runDef, loras, comfyFilename, comfySubfolder }) {
  const tempDir = path.join(CONTENT_ROOT, 'output', 'temp');
  fs.mkdirSync(tempDir, { recursive: true });

  const now = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const ts = `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}-${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}`;
  const modelTag = makeModelTag(profile.checkpoint);
  const fileName = `${ts}_${modelTag}_${seed}.png`;
  const filePath = path.join(tempDir, fileName);

  fs.writeFileSync(filePath, buffer);

  if (comfyFilename) {
    try {
      const comfyPath = path.join(COMFYUI_OUTPUT_DIR, comfySubfolder || '', comfyFilename);
      if (fs.statSync(comfyPath).size === buffer.length) fs.unlinkSync(comfyPath);
    } catch { /* best-effort cleanup only */ }
  }

  appendOutputsIndex(tempDir, {
    file: fileName,
    ts: now.toISOString(),
    model: modelTag,
    loras: loras || [],
    seed,
    steps: runDef.params?.steps,
    cfg: runDef.params?.cfg,
    sampler: runDef.params?.sampler,
  });
}

async function executeRun(runState) {
  const { runId, runDef, tasks } = runState;
  const library = presets.getLibrary();
  const profile = loadProfile(runState.profileId);

  const uiLoras = Array.isArray(runDef.loras) ? runDef.loras.filter((l) => l && l.name) : [];
  let workflowTemplate;
  if (uiLoras.length > 0) {
    const loraBase = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'workflows', 'anima-lora.json'), 'utf-8'));
    workflowTemplate = compose.buildLoraChainWorkflow(loraBase, uiLoras);
  } else {
    workflowTemplate = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'workflows', profile.workflow), 'utf-8'));
  }
  const effectiveLoras =
    uiLoras.length > 0
      ? uiLoras.map((l) => ({ name: l.name, strength: l.strength }))
      : profile.lora
        ? [{ name: profile.lora, strength: profile.loraStrengthModel ?? 1.0 }]
        : [];

  for (const task of tasks) {
    if (runState.stopRequested) break;
    if (task.status !== 'pending') continue;

    task.status = 'running';
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

      if (uiLoras.length === 0 && profile.lora) {
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
        task,
        seed,
        buffer,
        profile,
        runDef,
        loras: effectiveLoras,
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

    if (runDef.pauseSeconds > 0 && !runState.stopRequested) {
      await sleep(runDef.pauseSeconds * 1000);
    }
  }

  runState.status = runState.stopRequested ? 'stopped' : 'completed';
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

  executeRun(runState).catch((err) => {
    logger.logEvent({ scope: 'run', runId, status: 'crashed', errorType: err.type || 'unknown' });
  });

  return { runId, totalTasks: tasks.length };
}

function resumeRun() {
  throw new QueueError('run_not_found');
}

function listRuns() {
  return [];
}

function getRunManifest() {
  throw new QueueError('run_not_found');
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
