import { useState } from 'react';
import { formatValidationError } from './validationDisplay';

function EntryRow({ catId, entry, onUpdate, onDelete }) {
  const [label, setLabel] = useState(entry.label);
  const [positive, setPositive] = useState(entry.positive);
  const [negative, setNegative] = useState(entry.negative);

  return (
    <div className="entry-row">
      <input value={label} onChange={(e) => setLabel(e.target.value)} onBlur={() => onUpdate(catId, entry.id, { label })} placeholder="表示名" />
      <input
        value={positive}
        onChange={(e) => setPositive(e.target.value)}
        onBlur={() => onUpdate(catId, entry.id, { positive })}
        placeholder="positive"
      />
      <input
        value={negative}
        onChange={(e) => setNegative(e.target.value)}
        onBlur={() => onUpdate(catId, entry.id, { negative })}
        placeholder="negative"
      />
      <button type="button" className="btn-mini danger" onClick={() => onDelete(catId, entry.id)}>
        削除
      </button>
    </div>
  );
}

function NewEntryForm({ catId, onAdd }) {
  const [id, setId] = useState('');
  const [label, setLabel] = useState('');
  const [positive, setPositive] = useState('');
  const [negative, setNegative] = useState('');

  function submit() {
    if (!id || !label) return;
    onAdd(catId, { id, label, positive, negative });
    setId('');
    setLabel('');
    setPositive('');
    setNegative('');
  }

  return (
    <div className="entry-row">
      <input value={id} onChange={(e) => setId(e.target.value)} placeholder="id（半角英数）" />
      <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="表示名" />
      <input value={positive} onChange={(e) => setPositive(e.target.value)} placeholder="positive" />
      <button type="button" className="btn-mini" onClick={submit}>
        追加
      </button>
    </div>
  );
}

function CategoryBlock({ cat, onUpdateCategory, onDeleteCategory, onAddEntry, onUpdateEntry, onDeleteEntry }) {
  const [label, setLabel] = useState(cat.label);

  return (
    <div className="cat-block">
      <div className="cat-block-head">
        <input value={label} onChange={(e) => setLabel(e.target.value)} onBlur={() => onUpdateCategory(cat.id, { label })} />
        <select
          value={cat.default_mode}
          onChange={(e) => onUpdateCategory(cat.id, { default_mode: e.target.value })}
        >
          <option value="axis">axis（ラン軸）</option>
          <option value="join">join（結合）</option>
          <option value="pick">pick（抽選）</option>
        </select>
        <button type="button" className="btn-mini danger" onClick={() => onDeleteCategory(cat.id)}>
          カテゴリ削除
        </button>
      </div>
      {cat.entries.map((e) => (
        <EntryRow key={e.id} catId={cat.id} entry={e} onUpdate={onUpdateEntry} onDelete={onDeleteEntry} />
      ))}
      <NewEntryForm catId={cat.id} onAdd={onAddEntry} />
    </div>
  );
}

function NewCategoryForm({ onAdd }) {
  const [id, setId] = useState('');
  const [label, setLabel] = useState('');
  const [mode, setMode] = useState('join');

  function submit() {
    if (!id || !label) return;
    onAdd({ id, label, default_mode: mode });
    setId('');
    setLabel('');
  }

  return (
    <div className="cat-block-head" style={{ marginTop: 8 }}>
      <input value={id} onChange={(e) => setId(e.target.value)} placeholder="カテゴリid" />
      <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="カテゴリ名" />
      <select value={mode} onChange={(e) => setMode(e.target.value)}>
        <option value="axis">axis</option>
        <option value="join">join</option>
        <option value="pick">pick</option>
      </select>
      <button type="button" className="btn-mini" onClick={submit}>
        カテゴリ追加
      </button>
    </div>
  );
}

export default function PresetModal({
  library,
  onClose,
  onUpdateGlobal,
  onAddCategory,
  onUpdateCategory,
  onDeleteCategory,
  onAddEntry,
  onUpdateEntry,
  onDeleteEntry,
  lastError,
}) {
  const [qualityPositive, setQualityPositive] = useState(library.global.quality_positive);
  const [baseNegative, setBaseNegative] = useState(library.global.base_negative);
  const [composition, setComposition] = useState(library.global.composition);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-close" onClick={onClose}>
          閉じる
        </button>
        <h2>プリセット管理</h2>

        {lastError && (
          <div className="validation-errors">
            {(lastError.errors || (lastError.error ? [{ type: lastError.error }] : [lastError])).map((e, i) => (
              <div key={i}>{formatValidationError(e)}</div>
            ))}
          </div>
        )}

        <div className="cat-block">
          <div className="cathead">
            <label>共通設定</label>
          </div>
          <div className="entry-row" style={{ gridTemplateColumns: '1fr' }}>
            <input
              value={qualityPositive}
              onChange={(e) => setQualityPositive(e.target.value)}
              onBlur={() => onUpdateGlobal({ quality_positive: qualityPositive })}
              placeholder="品質positive"
            />
          </div>
          <div className="entry-row" style={{ gridTemplateColumns: '1fr' }}>
            <input
              value={baseNegative}
              onChange={(e) => setBaseNegative(e.target.value)}
              onBlur={() => onUpdateGlobal({ base_negative: baseNegative })}
              placeholder="共通negative"
            />
          </div>
          <div className="entry-row" style={{ gridTemplateColumns: '1fr' }}>
            <input
              value={composition}
              onChange={(e) => setComposition(e.target.value)}
              onBlur={() => onUpdateGlobal({ composition })}
              placeholder="composition template"
            />
          </div>
        </div>

        {library.categories.map((cat) => (
          <CategoryBlock
            key={cat.id}
            cat={cat}
            onUpdateCategory={onUpdateCategory}
            onDeleteCategory={onDeleteCategory}
            onAddEntry={onAddEntry}
            onUpdateEntry={onUpdateEntry}
            onDeleteEntry={onDeleteEntry}
          />
        ))}

        <NewCategoryForm onAdd={onAddCategory} />
      </div>
    </div>
  );
}
