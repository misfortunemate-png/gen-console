import { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { api } from './api';
import ControlsPanel from './ControlsPanel';
import Stage from './Stage';
import PresetModal from './PresetModal';
import SettingsModal from './SettingsModal';
import Toasts from './Toasts';
import { formatValidationError } from './validationDisplay';

const SETTINGS_KEY = 'gen-console:settings';

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { maxImages: 100, pauseSeconds: 0, debugVisible: false, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { maxImages: 100, pauseSeconds: 0, debugVisible: false };
}

function initRuntimeFromLibrary(library) {
  const rt = {};
  for (const cat of library.categories) {
    rt[cat.id] = { mode: cat.default_mode, selectedIds: cat.entries.map((e) => e.id) };
  }
  return rt;
}

let toastIdSeq = 0;

export default function App() {
  const [library, setLibrary] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [selectedProfileId, setSelectedProfileId] = useState('anima-base');
  const [categoryRuntime, setCategoryRuntime] = useState({});
  const [subject, setSubject] = useState('');
  const [exclusion, setExclusion] = useState('');
  const [genSettings, setGenSettings] = useState({
    width: 896,
    height: 1152,
    steps: 25,
    cfg: 4.5,
    sampler: 'er_sde',
    scheduler: 'simple',
    imagesPerAxisEntry: 1,
  });
  const [settings, setSettings] = useState(loadSettings());
  const [runStatus, setRunStatus] = useState(null);
  const [pastRuns, setPastRuns] = useState([]);
  const [selectedRunId, setSelectedRunId] = useState(null);
  const [selectedRunManifest, setSelectedRunManifest] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [showPresetModal, setShowPresetModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [lastPresetError, setLastPresetError] = useState(null);

  const prevRunStatusRef = useRef(null);

  function pushToast(kind, message) {
    const id = ++toastIdSeq;
    setToasts((prev) => [...prev, { id, kind, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 6000);
  }

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    api.getPresets().then((lib) => {
      setLibrary(lib);
      setCategoryRuntime(initRuntimeFromLibrary(lib));
    });
    api.getProfiles().then((list) => {
      setProfiles(list);
      if (list.length > 0 && !list.find((p) => p.id === selectedProfileId)) {
        setSelectedProfileId(list[0].id);
      }
    });
    api.listRuns().then((runs) => {
      setPastRuns(runs);
      setSelectedRunId((prev) => prev || runs[0] || null);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const status = await api.getCurrentRun();
        if (cancelled) return;
        const prev = prevRunStatusRef.current;
        if (prev && prev.active && status.active && status.failedCount > prev.failedCount) {
          pushToast('err', `失敗が増加しました（${status.failedCount}件）`);
        }
        if (prev && prev.active && prev.status === 'running' && status.status !== 'running') {
          pushToast(status.status === 'completed' ? 'ok' : 'err', `ラン ${status.runId} が${status.status === 'completed' ? '完了' : '停止'}しました`);
          api.listRuns().then(setPastRuns);
        }
        prevRunStatusRef.current = status;
        setRunStatus(status);
        if (status.active && (!selectedRunId || selectedRunId === status.runId)) {
          setSelectedRunId(status.runId);
        }
      } catch {
        /* transient poll failure; ignore */
      }
    }
    poll();
    const interval = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedRunId) return;
    if (runStatus?.active && runStatus.runId === selectedRunId) {
      setSelectedRunManifest(null); // use live runStatus instead
      return;
    }
    api.getRunManifest(selectedRunId).then(setSelectedRunManifest).catch(() => setSelectedRunManifest(null));
  }, [selectedRunId, runStatus]);

  const tiles = useMemo(() => {
    if (runStatus?.active && runStatus.runId === selectedRunId) {
      return runStatus.tasks.map((t) => ({ ...t, runId: selectedRunId }));
    }
    if (selectedRunManifest) {
      return selectedRunManifest.tasks.map((t) => ({ ...t, runId: selectedRunId }));
    }
    return [];
  }, [runStatus, selectedRunManifest, selectedRunId]);

  if (!library) {
    return <div style={{ padding: 40, color: '#8b93a5' }}>読み込み中…</div>;
  }

  function onToggleChip(catId, entryId) {
    setCategoryRuntime((prev) => {
      const cur = prev[catId] || { mode: 'join', selectedIds: [] };
      const has = cur.selectedIds.includes(entryId);
      const selectedIds = has ? cur.selectedIds.filter((id) => id !== entryId) : [...cur.selectedIds, entryId];
      return { ...prev, [catId]: { ...cur, selectedIds } };
    });
  }

  function onCycleMode(catId) {
    setCategoryRuntime((prev) => {
      const cur = prev[catId];
      const order = ['axis', 'join', 'pick'];
      const next = order[(order.indexOf(cur.mode) + 1) % order.length];
      const updated = { ...prev, [catId]: { ...cur, mode: next } };
      if (next === 'axis') {
        for (const [id, rt] of Object.entries(updated)) {
          if (id !== catId && rt.mode === 'axis') {
            const cat = library.categories.find((c) => c.id === id);
            updated[id] = { ...rt, mode: cat.default_mode === 'axis' ? 'join' : cat.default_mode };
          }
        }
      }
      return updated;
    });
  }

  const axisCatEntry = Object.entries(categoryRuntime).find(([, rt]) => rt.mode === 'axis');
  const totalImages = axisCatEntry ? axisCatEntry[1].selectedIds.length * genSettings.imagesPerAxisEntry : 0;
  const canStart = !!axisCatEntry && axisCatEntry[1].selectedIds.length > 0;

  async function onStart() {
    const runDef = {
      subject,
      categorySelections: Object.fromEntries(
        Object.entries(categoryRuntime).map(([catId, rt]) => [catId, { mode: rt.mode, entryIds: rt.selectedIds }])
      ),
      exclusion,
      imagesPerAxisEntry: genSettings.imagesPerAxisEntry,
      params: {
        width: genSettings.width,
        height: genSettings.height,
        steps: genSettings.steps,
        cfg: genSettings.cfg,
        sampler: genSettings.sampler,
        scheduler: genSettings.scheduler,
      },
      maxImages: settings.maxImages,
      pauseSeconds: settings.pauseSeconds,
    };
    try {
      const res = await api.startRun(runDef, selectedProfileId);
      pushToast('ok', `ラン開始（計${res.totalTasks}枚）`);
    } catch (err) {
      if (err.data?.errors?.length) {
        for (const e of err.data.errors) pushToast('err', `開始失敗: ${formatValidationError(e)}`);
      } else {
        pushToast('err', `開始失敗: ${err.data?.error || err.message}`);
      }
    }
  }

  async function onStop() {
    try {
      await api.stopRun();
      pushToast('ok', '停止指示を送信しました');
    } catch (err) {
      pushToast('err', `停止失敗: ${err.data?.error || err.message}`);
    }
  }

  function refreshLibrary(lib) {
    setLibrary(lib);
    setCategoryRuntime((prev) => {
      const next = initRuntimeFromLibrary(lib);
      for (const catId of Object.keys(next)) {
        if (prev[catId]) next[catId] = prev[catId];
      }
      return next;
    });
    setLastPresetError(null);
  }

  function wrapPresetCall(fn) {
    return async (...args) => {
      try {
        const lib = await fn(...args);
        refreshLibrary(lib);
      } catch (err) {
        setLastPresetError(err.data || { message: err.message });
      }
    };
  }

  const presetHandlers = {
    onUpdateGlobal: wrapPresetCall(api.updateGlobal),
    onAddCategory: wrapPresetCall(api.addCategory),
    onUpdateCategory: wrapPresetCall(api.updateCategory),
    onDeleteCategory: wrapPresetCall(api.deleteCategory),
    onAddEntry: wrapPresetCall(api.addEntry),
    onUpdateEntry: wrapPresetCall(api.updateEntry),
    onDeleteEntry: wrapPresetCall(api.deleteEntry),
  };

  const runActive = runStatus?.active && runStatus.status === 'running';

  return (
    <>
      <header>
        <h1>
          gen-<span>console</span>
        </h1>
        <div className="profile-pill">
          モデル:{' '}
          <select value={selectedProfileId} onChange={(e) => setSelectedProfileId(e.target.value)}>
            {profiles.map((p) => (
              <option key={p.id} value={p.id} disabled={p.installed === false}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="gear" onClick={() => setShowSettingsModal(true)}>
          ⚙ 設定
        </button>
      </header>

      <div className="wrap">
        <ControlsPanel
          library={library}
          categoryRuntime={categoryRuntime}
          onToggleChip={onToggleChip}
          onCycleMode={onCycleMode}
          onEditCategory={() => setShowPresetModal(true)}
          subject={subject}
          onSubjectChange={setSubject}
          exclusion={exclusion}
          onExclusionChange={setExclusion}
          genSettings={genSettings}
          onGenSettingsChange={(patch) => setGenSettings((prev) => ({ ...prev, ...patch }))}
          totalImages={totalImages}
          onStart={onStart}
          onStop={onStop}
          runActive={runActive}
          canStart={canStart}
        />
        <Stage
          runStatus={runStatus}
          pastRuns={pastRuns}
          selectedRunId={selectedRunId}
          onSelectRun={setSelectedRunId}
          tiles={tiles}
        />
      </div>

      {showPresetModal && (
        <PresetModal
          library={library}
          onClose={() => setShowPresetModal(false)}
          lastError={lastPresetError}
          {...presetHandlers}
        />
      )}

      {showSettingsModal && (
        <SettingsModal
          settings={settings}
          onChangeSettings={(patch) => setSettings((prev) => ({ ...prev, ...patch }))}
          onClose={() => setShowSettingsModal(false)}
          runStatus={runStatus}
          profiles={profiles}
          selectedProfileId={selectedProfileId}
        />
      )}

      <Toasts toasts={toasts} />
    </>
  );
}
