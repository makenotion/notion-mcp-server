# ベースイメージとしてNode.jsの最新LTSバージョンを使用
FROM node:20-slim AS builder

# 作業ディレクトリを設定
WORKDIR /app

# package.jsonとpackage-lock.jsonをコピー
COPY package*.json ./

# 依存関係をインストール
RUN npm install

# ソースコードをコピー
COPY . .

# ビルド
RUN npm run build

# パッケージをグローバルにインストール
RUN npm link

# 実行用の最小イメージ
FROM node:20-slim

# ビルドしたパッケージをコピー
COPY --from=builder /usr/local/lib/node_modules/@notionhq/notion-mcp-server /usr/local/lib/node_modules/@notionhq/notion-mcp-server
COPY --from=builder /usr/local/bin/notion-mcp-server /usr/local/bin/notion-mcp-server

# 環境変数のデフォルト値を設定
ENV OPENAPI_MCP_HEADERS="{}"

# エントリーポイントを設定
ENTRYPOINT ["notion-mcp-server"] 