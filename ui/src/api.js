async function req(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'request_failed');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  health: () => req('GET', '/api/health'),
  getPresets: () => req('GET', '/api/presets'),
  updateGlobal: (body) => req('PUT', '/api/presets/global', body),
  addCategory: (body) => req('POST', '/api/presets/categories', body),
  updateCategory: (catId, body) => req('PUT', `/api/presets/categories/${encodeURIComponent(catId)}`, body),
  deleteCategory: (catId) => req('DELETE', `/api/presets/categories/${encodeURIComponent(catId)}`),
  addEntry: (catId, body) => req('POST', `/api/presets/categories/${encodeURIComponent(catId)}/entries`, body),
  updateEntry: (catId, entryId, body) =>
    req('PUT', `/api/presets/categories/${encodeURIComponent(catId)}/entries/${encodeURIComponent(entryId)}`, body),
  deleteEntry: (catId, entryId) =>
    req('DELETE', `/api/presets/categories/${encodeURIComponent(catId)}/entries/${encodeURIComponent(entryId)}`),
  getProfiles: () => req('GET', '/api/profiles'),
  startRun: (runDef, profileId) => req('POST', '/api/runs', { runDef, profileId }),
  resumeRun: (runId) => req('POST', `/api/runs/${encodeURIComponent(runId)}/resume`),
  stopRun: () => req('POST', '/api/runs/current/stop'),
  getCurrentRun: () => req('GET', '/api/runs/current'),
  listRuns: () => req('GET', '/api/runs'),
  getRunManifest: (runId) => req('GET', `/api/runs/${encodeURIComponent(runId)}`),
};
