const crypto = require('crypto');

const COMFY_HOST = '127.0.0.1';
const COMFY_PORT = 8188;
const BASE_URL = `http://${COMFY_HOST}:${COMFY_PORT}`;
const WS_URL = `ws://${COMFY_HOST}:${COMFY_PORT}/ws`;

const CLIENT_ID = crypto.randomUUID();

// Placeholder -> value-type table. Values are stringified in the workflow
// JSON file (JSON needs quotes) but ComfyUI expects real numbers for these.
const SLOT_TYPES = {
  __CKPT_NAME__: 'string',
  __CLIP_NAME__: 'string',
  __VAE_NAME__: 'string',
  __POSITIVE_TEXT__: 'string',
  __NEGATIVE_TEXT__: 'string',
  __WIDTH__: 'number',
  __HEIGHT__: 'number',
  __SEED__: 'number',
  __STEPS__: 'number',
  __CFG__: 'number',
  __SAMPLER__: 'string',
  __SCHEDULER__: 'string',
  __LORA_NAME__: 'string',
  __LORA_STRENGTH_MODEL__: 'number',
  __LORA_STRENGTH_CLIP__: 'number',
};

function fillTemplate(templateObj, slotValues) {
  function walk(node) {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(node)) out[k] = walk(v);
      return out;
    }
    if (typeof node === 'string' && Object.prototype.hasOwnProperty.call(SLOT_TYPES, node)) {
      if (!(node in slotValues)) throw new Error(`missing slot value for ${node}`);
      const value = slotValues[node];
      return SLOT_TYPES[node] === 'number' ? Number(value) : String(value);
    }
    return node;
  }
  return walk(JSON.parse(JSON.stringify(templateObj)));
}

let wsConn = null;
let wsReadyPromise = null;

function ensureWs() {
  if (wsConn && wsConn.readyState === WebSocket.OPEN) return Promise.resolve();
  wsConn = new WebSocket(`${WS_URL}?clientId=${CLIENT_ID}`);
  wsReadyPromise = new Promise((resolve, reject) => {
    wsConn.addEventListener('open', () => resolve(), { once: true });
    wsConn.addEventListener('error', (e) => reject(e), { once: true });
  });
  return wsReadyPromise;
}

async function healthCheck(timeoutMs = 2000) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`${BASE_URL}/system_stats`, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

async function submitTask(filledWorkflow) {
  const res = await fetch(`${BASE_URL}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: filledWorkflow, client_id: CLIENT_ID }),
  });
  if (!res.ok) {
    const err = new Error('prompt_validation_rejected');
    err.type = 'prompt_validation_rejected';
    throw err;
  }
  const data = await res.json();
  return { promptId: data.prompt_id };
}

function waitForCompletion(promptId, { onProgress, timeoutMs = 300000 } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let timer;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (wsConn) wsConn.removeEventListener('message', onMessage);
      resolve(result);
    };
    timer = setTimeout(() => finish({ status: 'failed', errorType: 'timeout' }), timeoutMs);

    function onMessage(event) {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return; // binary frame (not used in this design), ignore
      }
      if (!msg.data || msg.data.prompt_id !== promptId) return;
      if (msg.type === 'executing' && msg.data.node === null) {
        finish({ status: 'completed' });
      } else if (msg.type === 'execution_error') {
        finish({ status: 'failed', errorType: 'execution_error' });
      } else if (msg.type === 'progress' && onProgress) {
        onProgress(msg.data);
      }
    }

    ensureWs()
      .then(() => {
        wsConn.addEventListener('message', onMessage);
        wsConn.addEventListener('close', () => finish({ status: 'failed', errorType: 'ws_disconnected' }), { once: true });
      })
      .catch(() => finish({ status: 'failed', errorType: 'ws_disconnected' }));
  });
}

async function fetchOutputImage(promptId, outputNodeId) {
  const res = await fetch(`${BASE_URL}/history/${promptId}`);
  const data = await res.json();
  const entry = data[promptId];
  const images = entry && entry.outputs && entry.outputs[outputNodeId] && entry.outputs[outputNodeId].images;
  if (!images || images.length === 0) {
    const err = new Error('history_missing_output');
    err.type = 'history_missing_output';
    throw err;
  }
  const { filename, subfolder, type } = images[0];
  const params = new URLSearchParams({ filename, subfolder: subfolder || '', type: type || 'output' });
  const imgRes = await fetch(`${BASE_URL}/view?${params.toString()}`);
  const buffer = Buffer.from(await imgRes.arrayBuffer());
  return { buffer, filename, subfolder, type };
}

async function interruptCurrent() {
  await fetch(`${BASE_URL}/interrupt`, { method: 'POST' });
}

async function freeMemory() {
  await fetch(`${BASE_URL}/free`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unload_models: true, free_memory: true }),
  });
}

module.exports = {
  fillTemplate,
  healthCheck,
  submitTask,
  waitForCompletion,
  fetchOutputImage,
  interruptCurrent,
  freeMemory,
  SLOT_TYPES,
};
