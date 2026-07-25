# gen-console v1.1 実装仕様書
（保管先: gen-console リポジトリ docs/ ＝交換所）

作成日: 2026-07-25
PM: クリーデ
承認済み要件定義: 2026-07-25 チャットにて骨子4項承認（①出力一元化 ②拡大表示 ③モデル/LoRA可視化 ④ComfyUI環境整理）。④はリポジトリ外のインフラ作業のため本仕様の対象外（別指示書 instructions-comfyui-inventory.md）
共通機能ガイド照合: v1.0開発時に実施済み。本増分に新規該当なし
対応データ定義書: なし（静的データの新規支給なし）

## 1. 概要
- 何を作るか: gen-console v1.1。生成画像の保存先一元化、UI拡大表示、モデル/LoRAの可視化、LoRAローダー対応
- なぜ作るか: 成果物の散在解消と、いま何で生成しているかの把握性向上（発注者要求 2026-07-25）
- 誰が使うか: 発注者（フラン上のブラウザ、およびPixel 10）

## 2. ファイル構成（変更・追加分のみ）
```
gen-console/
├── scripts/inspect.mjs          # 新規（devスキルv5.0対応。§0参照）
├── server/
│   ├── index.js                 # 変更: outputs系API追加
│   ├── comfy.js                 # 変更: 生成画像の取得→content/outputs/保存
│   └── compose.js               # 変更: LoRAノード組み込み（anima-lora.json経路）
├── ui/src/
│   ├── Stage.jsx                # 変更: ライトボックス・履歴一覧
│   ├── ControlsPanel.jsx        # 変更: モデル/LoRA表示・LoRA選択UI
│   └── api.js                   # 変更: 新APIクライアント
└── content/outputs/             # 実行時生成（gitignore対象・リポジトリ外運用）
    └── index.jsonl              # 生成メタの追記専用台帳
```
ファイル構成の上記以外の変更が必要な場合はR-006に従い停止・報告。

## 3. 技術選定
| 技術 | 理由 |
|---|---|
| 追加npm依存なし（原則） | ズーム・パンはCSS transform + Pointer Eventsで実現可能。ライブラリが必要と判断した場合は実装せずdocs/reports/へ提案 |
| index.jsonl（追記専用） | 画像メタの一覧取得をPNG解析なしで行うため。生成物の内容読取禁止と両立する |

## 4. 機能仕様

### §0: inspect整備（devスキルv5.0対応）
- 何を: scripts/inspect.mjs を新設（本リポジトリはv1.0納品が交換所制定前のため未整備）
- 検査項目: マニフェスト照合／版確認（package.json version と /healthz 応答の一致・R-012）／_STATUS.md 30行以内／ui build 警告なし
- 制約: 実装フェーズ初期（§1着手前）に用意する

### §1: 出力の一元化
- 何を: 生成完了した画像をすべて `content/outputs/` 直下（サブフォルダなし）に保存する。以後この場所を成果物の正とする
- どのように:
  - サーバーが生成完了時にComfyUI APIから画像を取得し、`{YYYYMMDD-HHmmss}_{modelTag}_{seed}.png` で保存する。modelTagはcheckpointファイル名から拡張子を除き、英数字と`-_`のみ・最大16字に整形
  - 同時に `content/outputs/index.jsonl` へ1行追記: `{"file","ts","model","loras":[{"name","strength"}],"seed","steps","cfg","sampler"}`
  - API追加: `GET /api/outputs`（index.jsonlを新しい順で返す。limit/offset任意）、`GET /api/outputs/:file`（画像配信。パストラバーサル対策必須）
  - `content/outputs/` が無ければサーバー起動時に作成
- 制約: ComfyUI内部のoutput配下を成果物の参照先にしない。ComfyUI側の既定保存動作の抑制は任意（安全にできる場合のみ）。過去の生成物の移行は本仕様のスコープ外（④の棚卸し後に判断）

### §2: UI拡大表示（ライトボックス）
- 何を: 成果物画像のクリック/タップで全画面オーバーレイ表示し、拡大・縮小・パンができる
- どのように: ホイールおよびピンチでズーム（1x〜8x程度）、ドラッグ/スワイプでパン、ダブルタップで等倍⇔2x切替、ESC・×・背景タップで閉じる。CSS transformベース
- 制約: Pixel 10（タッチ）とフランのブラウザ（マウス）の両方で操作可能なこと。追加依存なし（§3の技術選定に従う）

### §3: モデル/LoRAの可視化
- 何を: いま何のモデル・LoRAで生成するのか／したのかを常時わかるようにする
- どのように:
  - ControlsPanelに現在選択中のcheckpoint名と、適用中LoRA（名前＋強度）を常時表示する
  - 生成結果の表示・履歴一覧の各画像に、index.jsonlのメタ（model / loras / seed / steps / cfg / sampler）を表示する
- 制約: 表示名はファイル名ベースでよい（別名管理は行わない）

### §4: LoRAローダー
- 何を: UIからLoRAを選択して生成に適用できる（workflows/anima-lora.json 経路の実用化）
- どのように:
  - API追加: `GET /api/loras`（ComfyUIの/object_info等からLoRA一覧を列挙。空リスト可）
  - UI: LoRA選択（なし／最大2個の連結）＋各強度スライダー（0.00〜1.50・step 0.05・既定0.80）
  - LoRA未選択時は従来どおり anima-base.json 経路。選択時は anima-lora.json をベースにcompose.jsが強度・連結数を反映
- 制約: LoRAファイルが未導入の環境では一覧が空になる。その場合もUIは破綻せず「LoRAなし」で動作すること（実LoRA適用テストは発注者のモデル導入後・§5）

## 5. テスト方針
| テスト対象 | 方法 | 合格条件 |
|---|---|---|
| §1 保存・台帳 | PG自己テスト（生成実行） | 画像とindex.jsonl行が対で生成され、GET /api/outputsで新しい順に取得できる |
| §1 画像配信 | PG自己テスト | パストラバーサル（../等）が拒否される |
| §2 ズーム | 発注者実機（Pixel 10＋フラン） | ピンチ/ホイールで拡大縮小・パン・閉じるが自然に操作できる |
| §3 表示 | PG自己テスト＋発注者確認 | 生成前後でモデル/LoRA/主要パラメータが画面で確認できる |
| §4 ローダー | PG自己テスト（空一覧）／発注者実機（LoRA導入後） | 空一覧で破綻しない／実LoRAで強度が生成に反映される |
| 版確認 | inspect | package.jsonと/healthzが1.1.0で一致 |

## 6. PG向け作業指示
docs/instructions/instructions-v1.1.md を参照（単一ファイル・R-014）。
