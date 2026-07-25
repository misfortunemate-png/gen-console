# プロジェクトステータス
プロジェクト: gen-console
最終更新: 2026-07-25
更新者: PG（フラン）
## 現在のフェーズ
v1.1実装完了・inspect緑・発注者確認待ち
## 完了事項
- §0: scripts/inspect.mjs 新設（マニフェスト照合・版確認・_STATUS.md行数・ui build警告なし）
- §1: content/outputs/ 一元化（{ts}_{modelTag}_{seed}.png保存 + index.jsonl追記）
- §1: GET /api/outputs・GET /api/outputs/:file（パストラバーサル対策済み）
- §2: ライトボックス（ホイールズーム・ピンチ・ドラッグパン・ダブルタップ・ESC/×/背景クリック）
- §3: ControlsPanelにcheckpoint名+LoRA選択表示、タイルにmodel/loras/seed/steps/cfg表示
- §4: GET /api/loras（ComfyUI /object_info/LoraLoader 経由、空リスト対応）
- §4: LoRA選択UI（最大2個・強度スライダー0.00〜1.50）・compose.jsにLoRAチェーン注入
- package.json + /healthz 両方 1.1.0（R-012）
- inspect ALL GREEN（サーバー未起動につき /healthz はスキップ）
## 未完了事項
- inspect /healthz 項目: 実機起動後に再確認が必要
## 未検証項目（#012）
- 実機試験1: Pixel 10とフランのブラウザでのライトボックス操作（発注者依頼）
- 実機試験2: LoRA導入後の実適用生成・強度反映確認（発注者依頼）
## 次のアクション
- 誰が: 発注者
- 何を: 実機確認をお願いします
