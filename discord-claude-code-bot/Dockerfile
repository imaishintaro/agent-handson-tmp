FROM node:22-slim

# discoAIが開発作業で使うツールをインストール
RUN apt-get update && apt-get install -y \
    git \
    curl \
    python3 \
    python3-pip \
    make \
    && rm -rf /var/lib/apt/lists/*

# Claude Code CLIをグローバルインストール（claude-agent-sdkが内部で使用）
RUN npm install -g @anthropic-ai/claude-code

# /workspace 内でgitを安全に使えるように設定
RUN git config --global --add safe.directory /workspace

# アプリケーションディレクトリ
WORKDIR /app

# 依存関係を先にインストール（キャッシュ効率化）
COPY package*.json ./
RUN npm ci

# ソースコードをコピーしてビルド
COPY . .
RUN npm run build

# workspaceディレクトリのマウントポイントを作成
RUN mkdir -p /workspace

# discoAIの作業ディレクトリをworkspaceに固定
ENV WORK_DIR=/workspace
ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
