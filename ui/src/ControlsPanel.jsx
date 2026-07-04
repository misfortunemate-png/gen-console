const MODES = ['axis', 'join', 'pick'];
const MODE_LABEL = { axis: 'ラン軸', join: '結合', pick: '抽選' };

function CategorySection({ cat, runtime, onToggleChip, onCycleMode, onEdit }) {
  const mode = runtime?.mode || cat.default_mode;
  const selectedIds = runtime?.selectedIds || [];
  return (
    <div className="sec">
      <div className="cathead">
        <label>{cat.label}</label>
        <span className={`mode ${mode}`} onClick={() => onCycleMode(cat.id)}>
          {MODE_LABEL[mode]}
        </span>
        <button type="button" className="editlink" onClick={() => onEdit(cat.id)}>
          編集
        </button>
      </div>
      <div className="chips">
        {cat.entries.length === 0 && <span className="hint">エントリ未登録</span>}
        {cat.entries.map((e) => (
          <span
            key={e.id}
            className={`chip ${selectedIds.includes(e.id) ? 'on' : ''}`}
            onClick={() => onToggleChip(cat.id, e.id)}
          >
            {e.label}
          </span>
        ))}
      </div>
      {mode === 'pick' && <div className="hint">選択{selectedIds.length}件から画像ごとに1件を抽選</div>}
      {mode === 'axis' && <div className="hint">選択した各エントリが別バッチとして生成されます</div>}
    </div>
  );
}

export default function ControlsPanel({
  library,
  categoryRuntime,
  onToggleChip,
  onCycleMode,
  onEditCategory,
  subject,
  onSubjectChange,
  exclusion,
  onExclusionChange,
  genSettings,
  onGenSettingsChange,
  totalImages,
  onStart,
  onStop,
  runActive,
  canStart,
}) {
  return (
    <aside className="controls">
      <div className="sec">
        <label>プロンプト（自由記述）</label>
        <textarea rows={4} value={subject} onChange={(e) => onSubjectChange(e.target.value)} />
        <div className="hint">
          <code>{'{A|B|C}'}</code> ランダム選択 / <code>{'__名前__'}</code> ワイルドカード
        </div>
      </div>

      {library.categories.map((cat) => (
        <CategorySection
          key={cat.id}
          cat={cat}
          runtime={categoryRuntime[cat.id]}
          onToggleChip={onToggleChip}
          onCycleMode={onCycleMode}
          onEdit={onEditCategory}
        />
      ))}

      <div className="sec">
        <label>除外したい要素（任意）</label>
        <textarea rows={2} value={exclusion} onChange={(e) => onExclusionChange(e.target.value)} />
      </div>

      <div className="sec">
        <label>生成設定</label>
        <div className="grid2">
          <div className="field">
            <small>サイズ</small>
            <b>
              {genSettings.width} × {genSettings.height}
            </b>
          </div>
          <div className="field">
            <small>枚数 / ラン軸</small>
            <input
              type="number"
              min={1}
              value={genSettings.imagesPerAxisEntry}
              onChange={(e) => onGenSettingsChange({ imagesPerAxisEntry: Number(e.target.value) })}
            />
          </div>
          <div className="field">
            <small>Steps / CFG</small>
            <b>
              {genSettings.steps} / {genSettings.cfg}
            </b>
          </div>
          <div className="field">
            <small>シード</small>
            <b>ランダム</b>
          </div>
        </div>
      </div>
      <div className="runbtns">
        <button className="btn-go" disabled={!canStart || runActive} onClick={onStart}>
          生成開始（計 {totalImages} 枚）
        </button>
        <button className="btn-stop" disabled={!runActive} onClick={onStop}>
          停止
        </button>
      </div>
      <div className="hint" style={{ marginTop: 10 }}>
        プリセットは「編集」から登録・編集（保存先: content/presets/library.json）。カテゴリの追加も可能
      </div>
    </aside>
  );
}

export { MODES, MODE_LABEL };
