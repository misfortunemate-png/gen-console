import { useEffect, useRef, useState, useCallback } from 'react';
import { api } from './api';

function pad3(n) {
  return String(n).padStart(3, '0');
}

function RunStrip({ status }) {
  if (!status || !status.active) {
    return (
      <div className="runstrip">
        <div className="row1">
          <b>実行中のランなし</b>
        </div>
      </div>
    );
  }
  const segments = Object.entries(status.perAxisSegments || {});
  return (
    <div className="runstrip">
      <div className="row1">
        <b>{status.status === 'running' ? '実行中' : status.status === 'stopped' ? '停止' : '完了'}</b>
        <span className="cnt">
          {status.completedCount + status.failedCount} / {status.totalTasks} 枚
        </span>
        {status.failedCount > 0 && (
          <span className="fail">
            失敗 {status.failedCount}
            {status.status === 'running' ? '（継続中）' : ''}
          </span>
        )}
        <span className="rid">run {status.runId}</span>
      </div>
      <div className="segs">
        {segments.map(([axisId, seg]) => (
          <div className="seg" key={axisId}>
            <small>{axisId}</small>
            <div className="bar">
              <i style={{ width: `${(seg.done / seg.total) * 100}%` }} />
              {seg.failed > 0 && <i className="err" style={{ width: `${(seg.failed / seg.total) * 100}%` }} />}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Lightbox({ outputs, idx, onClose, onNavigate }) {
  const item = outputs[idx];
  const src = `/api/outputs/${encodeURIComponent(item.file)}`;
  const meta = item;
  const total = outputs.length;

  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [saved, setSaved] = useState(false);
  const dragRef = useRef(null);
  const wasDragRef = useRef(false);
  const imgRef = useRef(null);
  const stageRef = useRef(null);
  const touchesRef = useRef([]);

  const prevIdx = (idx - 1 + total) % total;
  const nextIdx = (idx + 1) % total;

  useEffect(() => {
    setScale(1);
    setPos({ x: 0, y: 0 });
    setSaved(false);
  }, [idx]);

  const handleClose = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    const h = (e) => {
      if (e.key === 'Escape') handleClose();
      if (e.key === 'ArrowLeft') onNavigate(prevIdx);
      if (e.key === 'ArrowRight') onNavigate(nextIdx);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [handleClose, onNavigate, prevIdx, nextIdx]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const h = (e) => { if (e.touches.length >= 2) e.preventDefault(); };
    el.addEventListener('touchmove', h, { passive: false });
    return () => el.removeEventListener('touchmove', h);
  }, []);

  function clamp(s) { return Math.max(1, Math.min(8, s)); }

  function onWheel(e) {
    e.preventDefault();
    setScale((s) => clamp(s * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
  }

  function onPointerDown(e) {
    e.currentTarget.setPointerCapture(e.pointerId);
    wasDragRef.current = false;
    dragRef.current = { x: e.clientX - pos.x, y: e.clientY - pos.y, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY };
  }

  function onPointerMove(e) {
    if (!dragRef.current || dragRef.current.pointerId !== e.pointerId) return;
    if (Math.hypot(e.clientX - dragRef.current.startX, e.clientY - dragRef.current.startY) > 5) {
      wasDragRef.current = true;
    }
    setPos({ x: e.clientX - dragRef.current.x, y: e.clientY - dragRef.current.y });
  }

  function onPointerUp() { dragRef.current = null; }

  function onDblClick() {
    setScale((s) => (s > 1 ? 1 : 2));
    setPos({ x: 0, y: 0 });
  }

  function onTouchStart(e) {
    touchesRef.current = Array.from(e.touches);
    wasDragRef.current = false;
    if (e.touches.length === 1) {
      const [t] = e.touches;
      dragRef.current = { x: t.clientX - pos.x, y: t.clientY - pos.y, pointerId: -1, startX: t.clientX, startY: t.clientY };
    }
  }

  function onTouchMove(e) {
    const touches = Array.from(e.touches);
    wasDragRef.current = true;
    if (touches.length === 2) {
      const prev = touchesRef.current;
      if (prev.length === 2) {
        const prevDist = Math.hypot(prev[0].clientX - prev[1].clientX, prev[0].clientY - prev[1].clientY);
        const newDist = Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
        if (prevDist > 0) setScale((s) => clamp(s * (newDist / prevDist)));
      }
      dragRef.current = null;
    } else if (touches.length === 1 && dragRef.current) {
      const [t] = touches;
      setPos({ x: t.clientX - dragRef.current.x, y: t.clientY - dragRef.current.y });
    }
    touchesRef.current = touches;
  }

  function onTouchEnd(e) {
    touchesRef.current = Array.from(e.touches);
    if (e.touches.length === 0) dragRef.current = null;
  }

  // Click on stage: close if outside the image; ignore drags and image-area clicks
  function onStageClick(e) {
    e.stopPropagation();
    if (wasDragRef.current) { wasDragRef.current = false; return; }
    if (imgRef.current) {
      const r = imgRef.current.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) return;
    }
    handleClose();
  }

  async function handleSave(e) {
    e.stopPropagation();
    try {
      await api.saveOutput(item.file);
      setSaved(true);
    } catch { /* ignore */ }
  }

  const loraStr = meta?.loras?.length
    ? meta.loras.map((l) => `${l.name.replace(/\.[^.]+$/, '')}(${Number(l.strength).toFixed(2)})`).join(', ')
    : null;

  return (
    <div className="lb-backdrop" onClick={handleClose}>
      <button className="lb-close" onClick={(e) => { e.stopPropagation(); handleClose(); }}>✕</button>

      {total > 1 && (
        <>
          <button
            className="lb-nav lb-prev"
            onClick={(e) => { e.stopPropagation(); onNavigate(prevIdx); }}
            aria-label="前の画像"
          >‹</button>
          <button
            className="lb-nav lb-next"
            onClick={(e) => { e.stopPropagation(); onNavigate(nextIdx); }}
            aria-label="次の画像"
          >›</button>
        </>
      )}

      <div
        ref={stageRef}
        className="lb-stage"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDblClick}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClick={onStageClick}
        style={{ cursor: scale > 1 ? 'grab' : 'default', touchAction: 'none' }}
      >
        <img
          ref={imgRef}
          src={src}
          alt=""
          draggable={false}
          style={{
            transform: `scale(${scale}) translate(${pos.x / scale}px, ${pos.y / scale}px)`,
            transformOrigin: 'center',
            userSelect: 'none',
            pointerEvents: 'none',
            maxWidth: '90vw',
            maxHeight: '90vh',
          }}
        />
      </div>

      <div className="lb-meta" onClick={(e) => e.stopPropagation()}>
        <span>{meta.model}</span>
        {loraStr && <span>LoRA: {loraStr}</span>}
        <span>seed {meta.seed}</span>
        <span>{meta.steps}steps · CFG{meta.cfg} · {meta.sampler}</span>
        <button
          className={`lb-save${saved ? ' saved' : ''}`}
          onClick={handleSave}
          disabled={saved}
        >
          {saved ? '保存済み ✓' : '保存'}
        </button>
      </div>
    </div>
  );
}

export default function Stage({ runStatus, outputs }) {
  const [lightboxIdx, setLightboxIdx] = useState(null);

  return (
    <main className="stage">
      <RunStrip status={runStatus} />

      <div className="gal-head">
        <h2>成果物一覧</h2>
        <span className="gal-count">{outputs.length} 件</span>
      </div>

      <div className="tiles">
        {outputs.length === 0 && (
          <div className="hint">生成を開始するとここに結果が表示されます</div>
        )}
        {outputs.map((item, i) => (
          <figure
            key={item.file}
            className="tile"
            onClick={() => setLightboxIdx(i)}
          >
            <img
              src={`/api/outputs/${encodeURIComponent(item.file)}`}
              alt={item.file}
              loading="lazy"
            />
            <figcaption>
              <div className="tile-model">{item.model}</div>
              {item.loras?.length > 0 && (
                <div className="tile-loras">
                  {item.loras.map((l) => `${l.name.replace(/\.[^.]+$/, '')}(${Number(l.strength).toFixed(2)})`).join(' ')}
                </div>
              )}
              <div className="tile-params">
                seed {item.seed} · {item.steps}st · CFG{item.cfg}
              </div>
            </figcaption>
          </figure>
        ))}
      </div>

      {lightboxIdx !== null && outputs[lightboxIdx] && (
        <Lightbox
          outputs={outputs}
          idx={lightboxIdx}
          onClose={() => setLightboxIdx(null)}
          onNavigate={setLightboxIdx}
        />
      )}
    </main>
  );
}
