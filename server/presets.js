const fs = require('fs');
const path = require('path');
const express = require('express');
const validate = require('./validate');

const CONTENT_ROOT = path.join(__dirname, '..', '..', 'content');
const LIBRARY_PATH = path.join(CONTENT_ROOT, 'presets', 'library.json');
const BAK_PATH = `${LIBRARY_PATH}.bak`;
const TMP_PATH = `${LIBRARY_PATH}.tmp`;

function defaultLibrary() {
  return {
    version: 1,
    global: { quality_positive: '', base_negative: '', composition: '{quality}, {subject}' },
    categories: [],
  };
}

function getLibrary() {
  if (!fs.existsSync(LIBRARY_PATH)) return defaultLibrary();
  return JSON.parse(fs.readFileSync(LIBRARY_PATH, 'utf-8'));
}

// Atomic write: back up the last-good file first, write to a temp file, then
// rename (atomic on the same volume) so a crash mid-write never corrupts
// library.json. presets.js performs field-transparent saves only — it does
// not interpret or alter the values it stores (spec §5b).
function saveLibrarySync(lib) {
  fs.mkdirSync(path.dirname(LIBRARY_PATH), { recursive: true });
  if (fs.existsSync(LIBRARY_PATH)) {
    fs.copyFileSync(LIBRARY_PATH, BAK_PATH);
  }
  fs.writeFileSync(TMP_PATH, JSON.stringify(lib, null, 2));
  fs.renameSync(TMP_PATH, LIBRARY_PATH);
}

function findCategory(lib, catId) {
  return lib.categories.find((c) => c.id === catId);
}

function addCategory(lib, { id, label, default_mode }) {
  if (findCategory(lib, id)) throw new HttpError(409, 'duplicate_category_id');
  lib.categories.push({ id, label, default_mode, entries: [] });
  return lib;
}

function updateCategory(lib, catId, { label, default_mode }) {
  const cat = findCategory(lib, catId);
  if (!cat) throw new HttpError(404, 'category_not_found');
  if (label !== undefined) cat.label = label;
  if (default_mode !== undefined) cat.default_mode = default_mode;
  return lib;
}

function deleteCategory(lib, catId) {
  const idx = lib.categories.findIndex((c) => c.id === catId);
  if (idx === -1) throw new HttpError(404, 'category_not_found');
  lib.categories.splice(idx, 1);
  return lib;
}

function addEntry(lib, catId, { id, label, positive, negative }) {
  const cat = findCategory(lib, catId);
  if (!cat) throw new HttpError(404, 'category_not_found');
  if (cat.entries.find((e) => e.id === id)) throw new HttpError(409, 'duplicate_entry_id');
  cat.entries.push({ id, label, positive: positive || '', negative: negative || '' });
  return lib;
}

function updateEntry(lib, catId, entryId, { label, positive, negative }) {
  const cat = findCategory(lib, catId);
  if (!cat) throw new HttpError(404, 'category_not_found');
  const entry = cat.entries.find((e) => e.id === entryId);
  if (!entry) throw new HttpError(404, 'entry_not_found');
  if (label !== undefined) entry.label = label;
  if (positive !== undefined) entry.positive = positive;
  if (negative !== undefined) entry.negative = negative;
  return lib;
}

function deleteEntry(lib, catId, entryId) {
  const cat = findCategory(lib, catId);
  if (!cat) throw new HttpError(404, 'category_not_found');
  const idx = cat.entries.findIndex((e) => e.id === entryId);
  if (idx === -1) throw new HttpError(404, 'entry_not_found');
  cat.entries.splice(idx, 1);
  return lib;
}

function updateGlobal(lib, { quality_positive, base_negative, composition }) {
  if (quality_positive !== undefined) lib.global.quality_positive = quality_positive;
  if (base_negative !== undefined) lib.global.base_negative = base_negative;
  if (composition !== undefined) lib.global.composition = composition;
  return lib;
}

class HttpError extends Error {
  constructor(status, type) {
    super(type);
    this.status = status;
    this.type = type;
  }
}

function withMutation(mutateFn) {
  return (req, res) => {
    try {
      const lib = getLibrary();
      mutateFn(lib, req);
      const errors = validate.validateLibrary(lib);
      if (errors.length > 0) {
        return res.status(400).json({ errors });
      }
      saveLibrarySync(lib);
      res.json(lib);
    } catch (err) {
      if (err instanceof HttpError) {
        return res.status(err.status).json({ error: err.type });
      }
      res.status(500).json({ error: 'internal_error' });
    }
  };
}

function createRouter() {
  const router = express.Router();

  router.get('/', (req, res) => res.json(getLibrary()));

  router.put('/global', withMutation((lib, req) => updateGlobal(lib, req.body || {})));

  router.post('/categories', withMutation((lib, req) => addCategory(lib, req.body || {})));
  router.put('/categories/:catId', withMutation((lib, req) => updateCategory(lib, req.params.catId, req.body || {})));
  router.delete('/categories/:catId', withMutation((lib, req) => deleteCategory(lib, req.params.catId)));

  router.post('/categories/:catId/entries', withMutation((lib, req) => addEntry(lib, req.params.catId, req.body || {})));
  router.put(
    '/categories/:catId/entries/:entryId',
    withMutation((lib, req) => updateEntry(lib, req.params.catId, req.params.entryId, req.body || {}))
  );
  router.delete(
    '/categories/:catId/entries/:entryId',
    withMutation((lib, req) => deleteEntry(lib, req.params.catId, req.params.entryId))
  );

  return router;
}

module.exports = {
  createRouter,
  getLibrary,
  saveLibrarySync,
  addCategory,
  updateCategory,
  deleteCategory,
  addEntry,
  updateEntry,
  deleteEntry,
  updateGlobal,
  defaultLibrary,
};
