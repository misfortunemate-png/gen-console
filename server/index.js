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

const app = express();
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', async (req, res) => {
  const comfyOk = await comfy.healthCheck();
  res.json({ ok: true, comfy: comfyOk });
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
