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

export default function Stage({ runStatus, pastRuns, selectedRunId, onSelectRun, tiles }) {
  return (
    <main className="stage">
      <RunStrip status={runStatus} />

      <div className="gal-head">
        <h2>ギャラリー</h2>
        <select value={selectedRunId || ''} onChange={(e) => onSelectRun(e.target.value)}>
          {runStatus?.active && (
            <option value={runStatus.runId}>
              run {runStatus.runId}（{runStatus.status === 'running' ? '実行中' : runStatus.status}）
            </option>
          )}
          {pastRuns
            .filter((id) => id !== runStatus?.runId)
            .map((id) => (
              <option key={id} value={id}>
                run {id}
              </option>
            ))}
        </select>
      </div>

      <div className="tiles">
        {tiles.length === 0 && <div className="hint">ランを開始するとここに結果が表示されます</div>}
        {tiles.map((t) => (
          <figure key={`${t.axisId}-${t.seq}`} className={`tile ${t.status === 'failed' ? 'failed' : ''}`}>
            {t.status === 'completed' && t.seed ? (
              <img
                src={`/content-output/${t.runId}/${t.axisId}/${pad3(t.seq)}_${t.seed}.png`}
                alt={`${t.axisId} #${t.seq}`}
              />
            ) : (
              <div className="ph">
                {t.status === 'failed' ? `✕ 失敗（${t.errorType || 'unknown'}）` : t.status === 'running' ? '生成中…' : '待機'}
              </div>
            )}
            <figcaption>
              {t.axisId} #{pad3(t.seq)} {t.seed ? `· seed ${t.seed}` : ''}
            </figcaption>
          </figure>
        ))}
      </div>
    </main>
  );
}
