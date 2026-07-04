const fs = require('fs');
const path = require('path');

const CONTENT_ROOT = path.join(__dirname, '..', '..', 'content');
const WILDCARDS_DIR = path.join(CONTENT_ROOT, 'wildcards');

function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
}

function validateLibrarySchema(lib) {
  const errors = [];
  if (typeof lib !== 'object' || lib === null) {
    errors.push({ type: 'invalid_schema', message: 'library is not an object' });
    return errors;
  }
  if (typeof lib.version !== 'number') {
    errors.push({ type: 'invalid_schema', message: 'version must be a number' });
  }
  if (typeof lib.global !== 'object' || lib.global === null) {
    errors.push({ type: 'invalid_schema', message: 'global must be an object' });
  } else {
    for (const key of ['quality_positive', 'base_negative', 'composition']) {
      if (typeof lib.global[key] !== 'string') {
        errors.push({ type: 'invalid_schema', message: `global.${key} must be a string` });
      }
    }
  }
  if (!Array.isArray(lib.categories)) {
    errors.push({ type: 'invalid_schema', message: 'categories must be an array' });
    return errors;
  }
  const seenCatIds = new Set();
  for (const cat of lib.categories) {
    if (typeof cat !== 'object' || cat === null) {
      errors.push({ type: 'invalid_schema', message: 'category entry is not an object' });
      continue;
    }
    if (!isNonEmptyString(cat.id)) {
      errors.push({ type: 'invalid_schema', message: 'category missing id' });
    } else if (seenCatIds.has(cat.id)) {
      errors.push({ type: 'duplicate_category_id', categoryId: cat.id });
    } else {
      seenCatIds.add(cat.id);
    }
    if (!isNonEmptyString(cat.label)) {
      errors.push({ type: 'invalid_schema', categoryId: cat.id, message: 'category missing label' });
    }
    if (!['axis', 'join', 'pick'].includes(cat.default_mode)) {
      errors.push({ type: 'invalid_schema', categoryId: cat.id, message: 'default_mode must be axis/join/pick' });
    }
    if (!Array.isArray(cat.entries)) {
      errors.push({ type: 'invalid_schema', categoryId: cat.id, message: 'entries must be an array' });
      continue;
    }
    const seenEntryIds = new Set();
    for (const entry of cat.entries) {
      if (typeof entry !== 'object' || entry === null) {
        errors.push({ type: 'invalid_schema', categoryId: cat.id, message: 'entry is not an object' });
        continue;
      }
      if (!isNonEmptyString(entry.id)) {
        errors.push({ type: 'invalid_schema', categoryId: cat.id, message: 'entry missing id' });
      } else if (seenEntryIds.has(entry.id)) {
        errors.push({ type: 'duplicate_entry_id', categoryId: cat.id, entryId: entry.id });
      } else {
        seenEntryIds.add(entry.id);
      }
      if (!isNonEmptyString(entry.label)) {
        errors.push({ type: 'invalid_schema', categoryId: cat.id, entryId: entry.id, message: 'entry missing label' });
      }
      if (typeof entry.positive !== 'string') {
        errors.push({ type: 'invalid_schema', categoryId: cat.id, entryId: entry.id, message: 'positive must be a string' });
      }
      if (typeof entry.negative !== 'string') {
        errors.push({ type: 'invalid_schema', categoryId: cat.id, entryId: entry.id, message: 'negative must be a string' });
      }
    }
  }
  return errors;
}

// Pure structural check: does not care what's inside the braces (composition
// slots vs. inline-choice syntax), only that they balance.
function checkBraceBalance(str, context) {
  const errors = [];
  let depth = 0;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '{') depth++;
    else if (str[i] === '}') {
      depth--;
      if (depth < 0) {
        errors.push({ type: 'unbalanced_braces', charOffset: i, ...context });
        depth = 0;
      }
    }
  }
  if (depth > 0) errors.push({ type: 'unbalanced_braces', ...context });
  return errors;
}

function extractCatRefs(str) {
  const re = /\{cat:([a-zA-Z0-9_-]+)\}/g;
  const refs = [];
  let m;
  while ((m = re.exec(str))) refs.push(m[1]);
  return refs;
}

function extractWildcardRefs(str) {
  const re = /__([a-zA-Z0-9_-]+)__/g;
  const refs = [];
  let m;
  while ((m = re.exec(str))) refs.push(m[1]);
  return refs;
}

// NFR-8 boundary (PM-approved): existence + 0-byte size only. Never reads
// line content here. "All-whitespace file" is a runtime concern instead
// (compose.js raises wildcard_no_candidates for that case).
function checkWildcardExistence(name) {
  const filePath = path.join(WILDCARDS_DIR, `${name}.txt`);
  if (!fs.existsSync(filePath)) {
    return { type: 'missing_wildcard', name };
  }
  const stat = fs.statSync(filePath);
  if (stat.size === 0) {
    return { type: 'empty_wildcard', name };
  }
  return null;
}

function validateLibrary(lib) {
  const errors = validateLibrarySchema(lib);
  if (errors.length > 0) return errors;

  const catIds = new Set(lib.categories.map((c) => c.id));

  errors.push(...checkBraceBalance(lib.global.composition, { field: 'composition' }));

  for (const ref of extractCatRefs(lib.global.composition)) {
    if (!catIds.has(ref)) errors.push({ type: 'unknown_category_ref', categoryId: ref });
  }

  for (const name of extractWildcardRefs(lib.global.composition)) {
    const err = checkWildcardExistence(name);
    if (err) errors.push({ ...err, field: 'composition' });
  }

  for (const cat of lib.categories) {
    for (const entry of cat.entries) {
      for (const field of ['positive', 'negative']) {
        errors.push(...checkBraceBalance(entry[field], { categoryId: cat.id, entryId: entry.id, field }));
        for (const name of extractWildcardRefs(entry[field])) {
          const err = checkWildcardExistence(name);
          if (err) errors.push({ ...err, categoryId: cat.id, entryId: entry.id, field });
        }
      }
    }
  }

  return errors;
}

function validateRunDef(runDef, lib) {
  const errors = [];
  const catIds = new Set(lib.categories.map((c) => c.id));
  const selections = runDef.categorySelections || {};

  const axisCats = Object.entries(selections).filter(([, sel]) => sel.mode === 'axis');
  if (axisCats.length === 0) errors.push({ type: 'no_axis' });
  if (axisCats.length > 1) {
    errors.push({ type: 'multiple_axis', categoryIds: axisCats.map(([id]) => id) });
  }

  for (const catId of Object.keys(selections)) {
    if (!catIds.has(catId)) errors.push({ type: 'unknown_category_ref', categoryId: catId });
  }

  if (isNonEmptyString(runDef.subject)) {
    errors.push(...checkBraceBalance(runDef.subject, { field: 'subject' }));
    for (const name of extractWildcardRefs(runDef.subject)) {
      const err = checkWildcardExistence(name);
      if (err) errors.push({ ...err, field: 'subject' });
    }
  }

  return errors;
}

module.exports = {
  validateLibrary,
  validateRunDef,
  extractCatRefs,
  extractWildcardRefs,
  checkBraceBalance,
};
