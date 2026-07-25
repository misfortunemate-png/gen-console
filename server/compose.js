const fs = require('fs');
const path = require('path');

const CONTENT_ROOT = path.join(__dirname, '..', '..', 'content');
const WILDCARDS_DIR = path.join(CONTENT_ROOT, 'wildcards');

class ComposeError extends Error {
  constructor(type, detail) {
    super(type);
    this.type = type;
    this.detail = detail;
  }
}

// Deterministic 32-bit seedable PRNG (mulberry32). Node's Math.random() isn't
// seedable, so a task's seed must drive both KSampler noise and this RNG for
// reproducibility (AC-1-4): same seed -> same image AND same expansion.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function readWildcardLines(name) {
  const filePath = path.join(WILDCARDS_DIR, `${name}.txt`);
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

// Single left-to-right pass over a field's raw text, expanding both inline
// choice `{A|B|C}` and wildcard `__name__` in the order they appear (v1: no
// nesting — replaced text is never re-scanned). One rng() draw per match.
function expandText(text, rng, expansionLog, fieldLabel) {
  const re = /\{([^{}]*)\}|__([a-zA-Z0-9_-]+)__/g;
  return text.replace(re, (match, choiceGroup, wildcardName, offset) => {
    if (wildcardName !== undefined) {
      const lines = readWildcardLines(wildcardName);
      if (lines.length === 0) {
        throw new ComposeError('wildcard_no_candidates', wildcardName);
      }
      const idx = Math.floor(rng() * lines.length);
      const chosen = lines[idx];
      expansionLog.push({ type: 'wildcard', name: wildcardName, field: fieldLabel, position: offset, chosen });
      return chosen;
    }
    const options = choiceGroup.split('|');
    const idx = Math.floor(rng() * options.length);
    const chosen = options[idx];
    expansionLog.push({ type: 'inline', field: fieldLabel, position: offset, chosen });
    return chosen;
  });
}

// Content-independent structural normalization only (spec §6): collapse
// comma-delimited whitespace/empty segments. Never trims or reorders content.
function normalizeCommaList(str) {
  return str
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .join(', ');
}

function composeTemplate(template, slotMap) {
  const substituted = template.replace(/\{(quality|subject|cat:[a-zA-Z0-9_-]+)\}/g, (match, key) => {
    return slotMap[key] !== undefined ? slotMap[key] : '';
  });
  return normalizeCommaList(substituted);
}

function composeNegative(axisEntryNegative, otherNegatives, exclusionText, baseNegative) {
  const parts = [axisEntryNegative, ...otherNegatives, exclusionText, baseNegative].filter(
    (s) => typeof s === 'string' && s.trim().length > 0
  );
  return normalizeCommaList(parts.join(', '));
}

// Builds the final positive/negative prompt text for one task.
// runDef: { subject, categorySelections: { [catId]: { mode, entryIds } }, exclusion }
// library: the full library.json object
// axisEntryId: the axis entry this task belongs to
// seed: this task's seed (doubles as compose RNG seed and KSampler noise seed)
function buildTaskPrompt({ runDef, library, axisEntryId, seed }) {
  const rng = mulberry32(seed);
  const expansionLog = [];

  const expandedSubject = expandText(runDef.subject || '', rng, expansionLog, 'subject');

  const slotMap = {
    quality: library.global.quality_positive,
    subject: expandedSubject,
  };
  const negativeParts = [];
  let axisEntryNegative = '';

  for (const cat of library.categories) {
    const sel = (runDef.categorySelections || {})[cat.id];
    if (!sel) continue;
    const mode = sel.mode || cat.default_mode;

    if (mode === 'axis') {
      const entry = cat.entries.find((e) => e.id === axisEntryId);
      if (!entry) continue;
      const positive = expandText(entry.positive, rng, expansionLog, `${cat.id}:${entry.id}:positive`);
      const negative = expandText(entry.negative, rng, expansionLog, `${cat.id}:${entry.id}:negative`);
      slotMap[`cat:${cat.id}`] = positive;
      axisEntryNegative = negative;
    } else if (mode === 'join') {
      const selectedIds = new Set(sel.entryIds || []);
      const chosenEntries = cat.entries.filter((e) => selectedIds.has(e.id));
      const positives = [];
      for (const entry of chosenEntries) {
        positives.push(expandText(entry.positive, rng, expansionLog, `${cat.id}:${entry.id}:positive`));
        const neg = expandText(entry.negative, rng, expansionLog, `${cat.id}:${entry.id}:negative`);
        if (neg) negativeParts.push(neg);
      }
      slotMap[`cat:${cat.id}`] = positives.join(', ');
    } else if (mode === 'pick') {
      const selectedIds = new Set(sel.entryIds || []);
      const candidates = cat.entries.filter((e) => selectedIds.has(e.id));
      if (candidates.length === 0) continue;
      const idx = Math.floor(rng() * candidates.length);
      const entry = candidates[idx];
      expansionLog.push({ type: 'pick', category: cat.id, chosen: entry.id });
      const positive = expandText(entry.positive, rng, expansionLog, `${cat.id}:${entry.id}:positive`);
      const negative = expandText(entry.negative, rng, expansionLog, `${cat.id}:${entry.id}:negative`);
      slotMap[`cat:${cat.id}`] = positive;
      if (negative) negativeParts.push(negative);
    }
  }

  const positiveText = composeTemplate(library.global.composition, slotMap);
  const negativeText = composeNegative(axisEntryNegative, negativeParts, runDef.exclusion || '', library.global.base_negative);

  return { positiveText, negativeText, expansionLog };
}

// Builds a ComfyUI workflow from anima-lora.json base, injecting 1 or 2 LoRA nodes.
// loras: [{name: string, strength: number}] (1 or 2 entries)
// Returns a new workflow object with LoRA values set directly (no __SLOT__ placeholders for LoRAs).
function buildLoraChainWorkflow(loraTemplate, loras) {
  const wf = JSON.parse(JSON.stringify(loraTemplate));

  // Fill first LoRA into existing node "4"
  wf['4'].inputs.lora_name = loras[0].name;
  wf['4'].inputs.strength_model = loras[0].strength;
  wf['4'].inputs.strength_clip = loras[0].strength;

  if (loras.length < 2) return wf;

  // Inject second LoRA as node "11", chained from node "4"
  wf['11'] = {
    class_type: 'LoraLoader',
    inputs: {
      model: ['4', 0],
      clip: ['4', 1],
      lora_name: loras[1].name,
      strength_model: loras[1].strength,
      strength_clip: loras[1].strength,
    },
  };

  // Rewire downstream nodes that referenced node "4" to use "11" instead
  if (Array.isArray(wf['5']?.inputs?.clip) && wf['5'].inputs.clip[0] === '4') wf['5'].inputs.clip = ['11', 1];
  if (Array.isArray(wf['6']?.inputs?.clip) && wf['6'].inputs.clip[0] === '4') wf['6'].inputs.clip = ['11', 1];
  if (Array.isArray(wf['8']?.inputs?.model) && wf['8'].inputs.model[0] === '4') wf['8'].inputs.model = ['11', 0];

  return wf;
}

module.exports = {
  mulberry32,
  expandText,
  composeTemplate,
  composeNegative,
  buildTaskPrompt,
  buildLoraChainWorkflow,
  ComposeError,
};
