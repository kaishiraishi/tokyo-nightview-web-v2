# サーバー再起動マニュアル

このファイルでは、開発サーバーを完全にkillして再起動する手順を説明します。

## 問題の原因（今回のケース）

**404エラーの原因**:
1. FastAPIの依存関係が未インストール（`ModuleNotFoundError: No module named 'fastapi'`）
2. APIサーバーが正しく起動していなかった（`python server.py` では起動せず、`uvicorn` コマンドが必要）

---

## 完全な再起動手順

### Step 1: すべてのサーバーをkill

```bash
# 現在動いているプロセスを確認
lsof -i :5173 -P -n  # Viteサーバー (フロントエンド)
lsof -i :8000 -P -n  # APIサーバー (バックエンド)

# プロセスIDを確認して、該当するプロセスをすべてkill
# 例: PIDが12345, 12346の場合
kill -9 12345 12346
```

**簡単な方法** (プロセスIDを調べて一括kill):
```bash
# Viteサーバーをkill
lsof -ti :5173 | xargs kill -9

# APIサーバーをkill
lsof -ti :8000 | xargs kill -9
```

### Step 2: 依存関係の確認（初回のみ / エラー時）

**Python依存関係**:
```bash
pip3 install fastapi uvicorn rasterio numpy
```

**Node.js依存関係**:
```bash
npm install
```

### Step 3: サーバーを起動

**2つのターミナルを開いてください**

#### ターミナル1: フロントエンド (Vite)

```bash
cd /Users/kaishiraishi/Desktop/tokyo_nightview_web_v2
npm run dev
```

起動成功のメッセージ:
```
VITE v6.4.1  ready in XXX ms

➜  Local:   http://localhost:5173/
➜  Network: http://192.168.3.10:5173/
```

#### ターミナル2: バックエンド (FastAPI)

```bash
cd /Users/kaishiraishi/Desktop/tokyo_nightview_web_v2/tools/dsm-api
uvicorn server:app --host 127.0.0.1 --port 8000
```

⚠️ **重要**: `python server.py` ではなく `uvicorn server:app` コマンドを使用してください！

起動成功のメッセージ:
```
INFO:     Started server process [XXXXX]
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)
```

### Step 4: 動作確認

**ヘルスチェック**:
```bash
# フロントエンド
curl -i http://localhost:5173/

# バックエンド
curl -i http://127.0.0.1:8000/health
```

**ブラウザで確認**:
- http://localhost:5173/ を開く
- 地図と3D建物が表示されることを確認
- 位置情報を許可するか、地図をクリックして動作確認

---

## トラブルシューティング

### ❌ Error: `EADDRINUSE` (ポートが使用中)

すでにサーバーが起動している可能性があります。Step 1のkillコマンドを再実行してください。

### ❌ Error: `ModuleNotFoundError: No module named 'fastapi'`

Step 2のPython依存関係インストールを実行してください。

### ❌ Error: `command not found: npm`

Node.jsがインストールされていません。[Node.js公式サイト](https://nodejs.org/)からインストールしてください。

### ❌ 404エラーがブラウザで表示される

1. 両方のサーバー（5173と8000）が起動しているか確認
   ```bash
   lsof -i :5173 -P -n
   lsof -i :8000 -P -n
   ```
2. ブラウザのキャッシュをクリアして再読み込み (Cmd+Shift+R)

---

## クイックリファレンス

**プロセス確認**:
```bash
lsof -i :5173 -P -n  # Vite
lsof -i :8000 -P -n  # API
```

**一括kill**:
```bash
lsof -ti :5173 | xargs kill -9  # Vite
lsof -ti :8000 | xargs kill -9  # API
```

**起動**:
```bash
# Terminal 1 (フロントエンド)
npm run dev

# Terminal 2 (バックエンド)
cd tools/dsm-api
uvicorn server:app --host 127.0.0.1 --port 8000
```

**ヘルスチェック**:
```bash
curl http://localhost:5173/
curl http://127.0.0.1:8000/health
```
