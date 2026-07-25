const path = require('path');
const fs = require('fs');
const express = require('express');
const comfy = require('./comfy');
const logger = require('./logger');
const presets = require('./presets');
const queue = require('./queue');

const PORT = process.env.PORT || 3000;
const APP_ROOT = path.join(__dirname, '..');
const CONTENT_ROOT = path.join(APP_ROOT, '..', 'content');
const OUTPUT_ROOT = path.join(CONTENT_ROOT, 'output');
const OUTPUTS_DIR = path.join(OUTPUT_ROOT, 'temp');

fs.mkdirSync(OUTPUTS_DIR, { recursive: true });
fs.mkdirSync(OUTPUT_ROOT, { recursive: true });

// Clear temp on startup (files only; subdirectories like run manifests are left intact)
for (const f of fs.readdirSync(OUTPUTS_DIR)) {
  try {
    const p = path.join(OUTPUTS_DIR, f);
    if (fs.statSync(p).isFile()) fs.unlinkSync(p);
  } catch { /* best-effort */ }
}

const app = express();
app.use(express.json({ limit: '2mb' }));

app.get('/healthz', (req, res) => {
  const { version } = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'package.json'), 'utf-8'));
  res.json({ ok: true, version });
});

app.get('/api/health', async (req, res) => {
  const comfyOk = await comfy.healthCheck();
  res.json({ ok: true, comfy: comfyOk });
});

app.get('/api/outputs', (req, res) => {
  const indexPath = path.join(OUTPUTS_DIR, 'index.jsonl');
  if (!fs.existsSync(indexPath)) return res.json([]);
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);
  const lines = fs.readFileSync(indexPath, 'utf-8').trimEnd().split('\n').filter(Boolean);
  const parsed = [];
  for (const line of lines) {
    try { parsed.push(JSON.parse(line)); } catch { /* skip malformed */ }
  }
  parsed.reverse();
  res.json(parsed.slice(offset, offset + limit));
});

app.get('/api/outputs/:file', (req, res) => {
  const { file } = req.params;
  if (!/^[A-Za-z0-9._-]+\.png$/.test(file)) {
    return res.status(400).json({ error: 'invalid_filename' });
  }
  const filePath = path.resolve(OUTPUTS_DIR, file);
  if (!filePath.startsWith(OUTPUTS_DIR + path.sep)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'not_found' });
  res.sendFile(filePath);
});

app.post('/api/outputs/save/:file', (req, res) => {
  const { file } = req.params;
  if (!/^[A-Za-z0-9._-]+\.png$/.test(file)) {
    return res.status(400).json({ error: 'invalid_filename' });
  }
  const src = path.resolve(OUTPUTS_DIR, file);
  if (!src.startsWith(OUTPUTS_DIR + path.sep)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  if (!fs.existsSync(src)) return res.status(404).json({ error: 'not_found' });
  const dst = path.join(OUTPUT_ROOT, file);
  fs.copyFileSync(src, dst);
  res.json({ ok: true });
});

app.get('/api/loras', async (req, res) => {
  const list = await comfy.fetchLoraList();
  res.json(list);
});

// M0 smoke-test endpoint only. Real run orchestration (queue.js) lands in M1.
app.post('/api/dummy-generate', async (req, res) => {
  try {
    const { prompt, negative } = req.body || {};
    if (!prompt) {
      return res.status(400).json({ error: 'prompt is required' });
    }

    const profile = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'profiles', 'anima-base.json'), 'utf-8'));
    const workflowTemplate = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'workflows', profile.workflow), 'utf-8'));

    const seed = Math.floor(Math.random() * 2 ** 32);
    const slotValues = {
      __CKPT_NAME__: profile.checkpoint,
      __CLIP_NAME__: profile.clip,
      __VAE_NAME__: profile.vae,
      __POSITIVE_TEXT__: prompt,
      __NEGATIVE_TEXT__: negative || '',
      __WIDTH__: profile.defaults.width,
      __HEIGHT__: profile.defaults.height,
      __SEED__: seed,
      __STEPS__: profile.defaults.steps,
      __CFG__: profile.defaults.cfg,
      __SAMPLER__: profile.defaults.sampler,
      __SCHEDULER__: profile.defaults.scheduler,
    };

    const filled = comfy.fillTemplate(workflowTemplate, slotValues);
    const t0 = Date.now();
    const { promptId } = await comfy.submitTask(filled);
    const result = await comfy.waitForCompletion(promptId, { timeoutMs: 300000 });

    if (result.status !== 'completed') {
      logger.logEvent({ scope: 'm0-smoke', promptId, status: 'failed', errorType: result.errorType });
      return res.status(500).json({ error: result.errorType });
    }

    const { buffer } = await comfy.fetchOutputImage(promptId, profile.outputNodeId);
    const outputRoot = path.join(CONTENT_ROOT, 'output');
    const outDir = path.join(outputRoot, '_m0-smoke');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `${seed}.png`);
    fs.writeFileSync(outPath, buffer);

    const durationMs = Date.now() - t0;
    logger.logEvent({ scope: 'm0-smoke', promptId, status: 'completed', seed, durationMs });

    res.json({ ok: true, seed, durationMs, relativePath: path.relative(outputRoot, outPath) });
  } catch (err) {
    logger.logEvent({ scope: 'm0-smoke', status: 'error', errorType: err.type || 'unknown' });
    res.status(500).json({ error: err.type || 'internal_error' });
  }
});

app.use('/api/presets', presets.createRouter());

app.get('/api/profiles', (req, res) => {
  const dir = path.join(APP_ROOT, 'profiles');
  const ids = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''));
  const list = ids.map((id) => JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), 'utf-8')));
  res.json(list);
});

app.post('/api/runs', (req, res) => {
  try {
    const { runDef, profileId } = req.body || {};
    if (!runDef || !profileId) {
      return res.status(400).json({ error: 'runDef and profileId are required' });
    }
    const result = queue.startRun(runDef, profileId);
    res.json(result);
  } catch (err) {
    if (err instanceof queue.QueueError) {
      return res.status(400).json({ error: err.type, detail: err.detail, errors: err.errors });
    }
    logger.logEvent({ scope: 'run', status: 'start_error', errorType: err.type || 'unknown' });
    res.status(500).json({ error: 'internal_error' });
  }
});

app.post('/api/runs/:runId/resume', (req, res) => {
  try {
    const result = queue.resumeRun(req.params.runId);
    res.json(result);
  } catch (err) {
    if (err instanceof queue.QueueError) {
      return res.status(400).json({ error: err.type });
    }
    res.status(500).json({ error: 'internal_error' });
  }
});

app.post('/api/runs/current/stop', (req, res) => {
  try {
    queue.stopCurrentRun();
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof queue.QueueError) {
      return res.status(400).json({ error: err.type });
    }
    res.status(500).json({ error: 'internal_error' });
  }
});

app.get('/api/runs/current', (req, res) => {
  res.json(queue.getCurrentRunStatus());
});

app.get('/api/runs', (req, res) => {
  res.json(queue.listRuns());
});

app.get('/api/runs/:runId', (req, res) => {
  try {
    res.json(queue.getRunManifest(req.params.runId));
  } catch (err) {
    if (err instanceof queue.QueueError) {
      return res.status(404).json({ error: err.type });
    }
    res.status(500).json({ error: 'internal_error' });
  }
});

// Static byte-serving only (no content parsing/reading by server logic) so the
// browser UI can preview generated images. Does not violate NFR-8.
app.use('/content-output', express.static(path.join(CONTENT_ROOT, 'output')));

const uiDist = path.join(APP_ROOT, 'ui', 'dist');
if (fs.existsSync(uiDist)) {
  app.use(express.static(uiDist));
  app.get('/{*splat}', (req, res) => res.sendFile(path.join(uiDist, 'index.html')));
}

app.listen(PORT, '127.0.0.1', () => {
  logger.logEvent({ scope: 'server', status: 'started', port: PORT });
  console.log(`gen-console server listening on http://127.0.0.1:${PORT}`);
});
