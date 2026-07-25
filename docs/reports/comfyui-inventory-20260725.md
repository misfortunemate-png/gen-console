# ComfyUI 環境棚卸し報告書

調査日: 2026-07-25  
担当: フラン（PG）  
依拠指示書: docs/instructions/instructions-comfyui-inventory.md  
対象: D:\AI\imagegen 配下の全構成  

---

## 1. custom_nodes

| ノード名 | 容量 | gen-console参照 | 判定 |
|---|---|---|---|
| `__pycache__` | ~0 MB（自動生成） | なし | 不要（削除候補）|

**補足**: カスタムノードは一切導入されていない。`custom_nodes/__pycache__` はPython実行時に自動生成されるキャッシュで、削除しても再生成される。

gen-console の `anima-base.json` / `anima-lora.json` が使用するノード:

```
CLIPLoader, CLIPTextEncode, EmptyLatentImage, KSampler,
SaveImage, UNETLoader, VAEDecode, VAELoader, LoraLoader
```

これらはすべて ComfyUI 組み込みノード。カスタムノード依存なし。

**削除した場合の影響**: なし（`__pycache__` は次回 ComfyUI 起動時に再生成）

---

## 2. models 配下

### 2-1. diffusion_models（合計 11,965.5 MB）

| ファイル名 | 容量 | gen-console使用プロファイル | 判定 |
|---|---|---|---|
| `anima-base-v1.0.safetensors` | 3,988.5 MB | anima-base / anima-turbo / niji-sweet-spot | **gen-console稼働に必要** |
| `akanezora_v055B.safetensors` | 3,988.5 MB | akanezora | **gen-console稼働に必要** |
| `waiANIMA_v10Base10.safetensors` | 3,988.5 MB | wai-anima | **gen-console稼働に必要** |
| `put_diffusion_model_files_here` | 0 B | なし | 不要（削除候補）|

**削除候補の影響**: プレースホルダのみ。削除しても機能影響なし。

### 2-2. text_encoders（合計 3,410.7 MB）

| ファイル名 | 容量 | 対応checkpoint | 判定 |
|---|---|---|---|
| `qwen_3_06b_base.safetensors` | 1,136.9 MB | anima-base-v1.0（全 Anima 系共通）| **gen-console稼働に必要** |
| `akanezora_v055B_txt.safetensors` | 1,136.9 MB | akanezora_v055B | **gen-console稼働に必要** |
| `waiANIMA_v10Base10_txt.safetensors` | 1,136.9 MB | waiANIMA_v10Base10 | **gen-console稼働に必要** |
| `put_text_encoder_files_here` | 0 B | なし | 不要（削除候補）|

**削除候補の影響**: プレースホルダのみ。削除しても機能影響なし。

### 2-3. loras（合計 317.1 MB）

| ファイル名 | 容量 | gen-console使用プロファイル | 判定 |
|---|---|---|---|
| `anima-turbo-lora-v0.2.safetensors` | 142.0 MB | anima-turbo | **gen-console稼働に必要** |
| `ANIMA_Niji_Sweet_Spot_v4.safetensors` | 175.1 MB | niji-sweet-spot | **gen-console稼働に必要** |
| `put_loras_here` | 0 B | なし | 不要（削除候補）|

### 2-4. vae（合計 242.0 MB）

| ファイル名 | 容量 | 使用状況 | 判定 |
|---|---|---|---|
| `qwen_image_vae.safetensors` | 242.0 MB | 全プロファイル共通で参照 | **gen-console稼働に必要** |
| `put_vae_here` | 0 B | なし | 不要（削除候補）|

### 2-5. configs（合計 ~0 MB）

`models/configs/` に SD1.x/2.x 向けデフォルト YAML が 11 ファイル（各 0 MB 未満）:

```
anything_v3.yaml, v1-inference.yaml, v1-inference_clip_skip_2.yaml,
v1-inference_clip_skip_2_fp16.yaml, v1-inference_fp16.yaml,
v1-inpainting-inference.yaml, v2-inference-v.yaml, v2-inference-v_fp32.yaml,
v2-inference.yaml, v2-inference_fp32.yaml, v2-inpainting-inference.yaml
```

**判定**: 不要（削除候補）  
**削除した場合の影響**: AuraFlow/Anima 系は CLIPLoader + UNETLoader + VAELoader を使用しており、これらの yaml は参照されない。削除しても gen-console の動作に影響なし。ComfyUI 公式同梱ファイルのため、将来 SD1.x 系モデルを使用したい場合は再配置が必要。

### 2-6. その他のフォルダ（プレースホルダのみ）

以下のフォルダはプレースホルダ（`put_*_here` 0 byte ファイル）のみで、モデルファイルなし:

`audio_encoders, background_removal, checkpoints, clip, clip_vision, controlnet,
detection, diffusers, embeddings, frame_interpolation, geometry_estimation, gligen,
hypernetworks, latent_upscale_models, model_patches, optical_flow, photomaker,
style_models, unet, upscale_models, vae_approx`

**判定**: プレースホルダ自体は不要（削除候補）。フォルダ構造は ComfyUI が自動管理するため、フォルダごと削除しても再生成される。

---

## 3. 設定ファイル

### 3-1. extra_model_paths.yaml

`extra_model_paths.yaml` は**存在しない**（`.yaml.example` のみ存在）。ComfyUI はデフォルトパス（`models/` 配下）でモデルを検索中。外部パスの追加設定なし。

**判定**: 現状問題なし（必要に応じて `.example` から作成）

### 3-2. 起動スクリプト・bat ファイル

| パス | 内容 | 判定 |
|---|---|---|
| `D:\AI\imagegen\start.bat` | ComfyUI + gen-console server を順次起動する統合スクリプト | **必要** |

ComfyUI 直下に独自の bat ファイルなし。`start.bat` の起動引数: `--listen 127.0.0.1`（ローカルホストのみ待受）。

### 3-3. venv

| パス | 容量 | 判定 |
|---|---|---|
| `D:\AI\imagegen\ComfyUI\.venv` | 3,772 MB | **gen-console稼働に必要** |

venv の重複なし（1 カ所のみ）。`pip.exe` は `.venv/Scripts/` 直下に存在せず、`python -m pip` で操作する構成。

---

## 4. output / temp / input（件数と容量のみ）

| ディレクトリ | ファイル数 | 合計容量 |
|---|---|---|
| `ComfyUI/output` | 7 files（PNG 6枚 + placeholder 1件）| 3.8 MB |
| `ComfyUI/temp` | 0 files | 0 MB |
| `ComfyUI/input` | 1 file（placeholder）| 0 MB |

**ComfyUI/output の補足**: PNG 6 枚は v1.0 開発・試験時（2026-07-04〜07-11）の生成物。`genconsole_00001_.png`〜`genconsole_00006_.png` というファイル名パターン（ファイル内容は読まず）。v1.1 仕様（§1）により今後の成果物は `content/outputs/` に一元化される予定のため、この PNG 群の取り扱いは発注者判断を仰ぐ。

**判定**: 不明（発注者判断）。削除しても gen-console の動作に影響なし。

---

## 5. ComfyUI 本体以外（D:\AI\imagegen 直下）

| アイテム | 種別 | 概要 | 判定 |
|---|---|---|---|
| `app/` | ディレクトリ | gen-console リポジトリ | **必要** |
| `ComfyUI/` | ディレクトリ | ComfyUI 本体 | **必要** |
| `content/` | ディレクトリ | 発注者専用生成物（読み取り禁止） | **必要** |
| `start.bat` | bat | ComfyUI + gen-console 統合起動スクリプト | **必要** |
| `モデル設定メモ.md` | md | 各モデルの配布ページ情報要約（フラン作成 2026-07-05）| 不明（発注者判断）|
| `チェックポイント.lnk` | ショートカット | `ComfyUI/models/diffusion_models` へのリンク | 不明（発注者判断）|
| `LoRA.lnk` | ショートカット | `ComfyUI/models/loras` へのリンク | 不明（発注者判断）|
| `生成物.lnk` | ショートカット | `content/output` へのリンク | 不明（発注者判断）|
| `プリセット.lnk` | ショートカット | `content/presets` へのリンク | 不明（発注者判断）|

**補足**: ショートカット 4 点は利便性のためにフランが作成（2026-07-05）。削除しても gen-console の動作に影響なし。

---

## 6. バージョン

| 項目 | バージョン |
|---|---|
| ComfyUI 本体 | v0.27.0-13-g1073a749（コミット: `1073a749`）|
| PyTorch | 2.12.1+cu130 |
| CUDA | 13.0 |
| GPU | NVIDIA GeForce RTX 5060 Ti |
| Python venv | `D:\AI\imagegen\ComfyUI\.venv` |

---

## 7. 所見サマリー

### 削除候補（gen-console 稼働に不要と判断できるもの）

| # | アイテム | 容量 | 削除した場合の影響 |
|---|---|---|---|
| 1 | `ComfyUI/custom_nodes/__pycache__/` | ~0 MB | なし（次回起動時に再生成）|
| 2 | `ComfyUI/models/configs/` 11 ファイル | ~0 MB | なし（AuraFlow 系では未参照）|
| 3 | 各 models フォルダ内 `put_*_here` プレースホルダ（約 20 件）| 0 MB | なし |
| 4 | `ComfyUI/models/*/` 空フォルダ群（モデル未配置）| 0 MB | フォルダは ComfyUI が再作成 |

**削除候補の合計容量: 実質 0 MB**（ディスク節約効果は無視できる水準）

### 発注者判断が必要なもの

| # | アイテム | 容量 | 補足 |
|---|---|---|---|
| 5 | `ComfyUI/output/` の PNG 6 枚 | 3.8 MB | v1.0 開発時の生成テスト物。v1.1 移行後は `content/outputs/` が正の成果物置き場になるため整理タイミングを確認 |
| 6 | `D:\AI\imagegen\` 直下のショートカット 4 件 | 0 MB | 利便性ショートカット。不要なら削除可 |
| 7 | `D:\AI\imagegen\モデル設定メモ.md` | 0 MB | フラン作成の配布ページ要約メモ。リポジトリ外に保管中 |

### gen-console 稼働に必要なもの（削除禁止）

| アイテム | 容量 |
|---|---|
| `ComfyUI/` 本体（.venv 除く）| ～ |
| `ComfyUI/.venv/` | 3,772 MB |
| `models/diffusion_models/` × 3 safetensors | 11,965.5 MB |
| `models/text_encoders/` × 3 safetensors | 3,410.7 MB |
| `models/loras/` × 2 safetensors | 317.1 MB |
| `models/vae/qwen_image_vae.safetensors` | 242.0 MB |
| `D:\AI\imagegen\start.bat` | 0 MB |
| `D:\AI\imagegen\app/` | ～ |
| `D:\AI\imagegen\content/` | ～ |

---

以上。削除実行は第二段指示を待つ。確認をお願いします。
