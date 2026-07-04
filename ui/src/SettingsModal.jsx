export default function SettingsModal({ settings, onChangeSettings, onClose, runStatus, profiles, selectedProfileId }) {
  const profile = profiles.find((p) => p.id === selectedProfileId);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-close" onClick={onClose}>
          閉じる
        </button>
        <h2>設定</h2>

        <div className="cat-block">
          <div className="cathead">
            <label>プロファイル既定値</label>
          </div>
          {profile ? (
            <div className="debug-panel">
              {JSON.stringify(profile.defaults, null, 2)}
              {profile.turbo && !profile.installed && (
                <div style={{ color: 'var(--err)', marginTop: 6 }}>
                  {profile.installNote || 'このプロファイルは未導入です'}
                </div>
              )}
            </div>
          ) : (
            <div className="hint">プロファイル未選択</div>
          )}
        </div>

        <div className="cat-block">
          <div className="settings-row">
            <label>1ラン最大枚数</label>
            <input
              type="number"
              min={1}
              style={{ width: 100 }}
              value={settings.maxImages}
              onChange={(e) => onChangeSettings({ maxImages: Number(e.target.value) })}
            />
          </div>
          <div className="settings-row">
            <label>タスク間休止秒（夏季用）</label>
            <input
              type="number"
              min={0}
              style={{ width: 100 }}
              value={settings.pauseSeconds}
              onChange={(e) => onChangeSettings({ pauseSeconds: Number(e.target.value) })}
            />
          </div>
          <div className="settings-row">
            <div>
              <label>Turbo（未導入）</label>
              <span className="warn">Anima Turbo LoRAはCivitaiログイン待ちのため無効化中</span>
            </div>
            <input type="checkbox" checked={false} disabled />
          </div>
          <div className="settings-row">
            <label>デバッグパネル表示</label>
            <input
              type="checkbox"
              checked={settings.debugVisible}
              onChange={(e) => onChangeSettings({ debugVisible: e.target.checked })}
            />
          </div>
        </div>

        {settings.debugVisible && (
          <div className="cat-block">
            <div className="cathead">
              <label>デバッグ（キュー状態・バージョン）</label>
            </div>
            <div className="debug-panel">
              gen-console v0.1.0{'\n'}
              {JSON.stringify(runStatus, null, 2)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
