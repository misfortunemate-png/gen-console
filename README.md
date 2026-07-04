# gen-console

## 起動方法

1. `start.bat` をダブルクリックする
2. ComfyUIとサーバーが起動し、既定ブラウザが自動で開く
3. ブラウザ上で操作する（コンソール作業は不要）

## 環境再構築手順（フラン再セットアップ時）

`ui/dist`・各`node_modules`はgitignore対象のため、clone直後は`start.bat`だけでは起動しない。以下を先に行う。

1. リポジトリ直下（`app/`）で依存関係をインストール: `npm install`
2. `ui/`でも依存関係をインストールしてビルド: `cd ui && npm install && npm run build`
3. ComfyUI本体・モデルファイルの取得・配置はデータ定義書（`20260704_local-imagegen-agent_datadef.md`）を参照。ComfyUIは`D:\AI\imagegen\ComfyUI`に公式リポジトリをclone後、Python venv作成→cu130系PyTorchインストール→`requirements.txt`インストールが必要（本リポジトリには含まれない）
4. 上記完了後、`start.bat`をダブルクリックすれば通常起動できる
