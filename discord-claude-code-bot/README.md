# Discord Claude Code Bot

DiscordからClaude Codeを操作できるボットです。
Claude Agent SDKを使用し、ファイル読み書き・コード生成・Git操作などClaude Codeの全機能をDiscordチャンネルから利用できます。

## 機能

- **チャンネルごとの会話継続** — 同じチャンネルではセッションが維持され、文脈を保った会話が可能
- **Claude Codeの全ツール利用** — ファイル操作、Bash実行、Web検索など
- **ファイル編集の自動許可** — Discordでの承認UIが難しいため、ファイル編集は自動承認
- **長文レスポンスの自動分割** — Discordの2000文字制限に対応
- **ユーザーアクセス制御** — 許可されたユーザーのみボットを利用可能

## セットアップ

### 1. Discord Botの作成

1. [Discord Developer Portal](https://discord.com/developers/applications) にアクセス
2. 「New Application」でアプリを作成
3. 「Bot」タブで:
   - 「Reset Token」でBotトークンを取得（メモしておく）
   - 「MESSAGE CONTENT INTENT」を **有効化**
4. 「OAuth2 > URL Generator」で:
   - Scopes: `bot`
   - Bot Permissions: `Send Messages`, `Read Message History`
   - 生成されたURLでボットをサーバーに招待

### 2. Anthropic APIキーの取得

1. [Anthropic Console](https://console.anthropic.com/) にアクセス
2. APIキーを作成

### 3. プロジェクトのセットアップ

```bash
cd discord-claude-code-bot
npm install
cp .env.example .env
```

`.env` を編集して必要な値を設定:

```env
DISCORD_TOKEN=your-discord-bot-token
ANTHROPIC_API_KEY=your-anthropic-api-key
```

### 4. ビルド＆起動

```bash
npm run build
npm start
```

開発時は:
```bash
npm run dev
```

## 使い方

Discord上で以下のように話しかけます:

| コマンド | 説明 |
|---------|------|
| `!claude <メッセージ>` | Claude Codeにメッセージを送る |
| `!claude clear` | セッションをリセット |
| `!claude help` | ヘルプを表示 |
| `@ボット名 <メッセージ>` | メンションでも使用可能 |

### 使用例

```
!claude このプロジェクトの構成を教えて
!claude src/index.tsにバグがあるので修正して
!claude テストを実行して結果を教えて
!claude clear
```

## 設定

`.env` で以下を設定できます:

| 変数名 | 必須 | 説明 |
|--------|------|------|
| `DISCORD_TOKEN` | はい | Discord Botトークン |
| `ANTHROPIC_API_KEY` | はい | Anthropic APIキー |
| `MODEL` | いいえ | 使用モデル（デフォルト: `claude-sonnet-4-20250514`） |
| `WORK_DIR` | いいえ | Claude Codeの作業ディレクトリ |
| `ALLOWED_USER_IDS` | いいえ | 許可するDiscordユーザーID（カンマ区切り） |

## 注意事項

- `permissionMode: "acceptEdits"` が設定されているため、Claude Codeはファイル編集を自動で実行します。信頼できる環境でのみ使用してください
- Anthropic APIの利用料金が発生します。各レスポンスにコストが表示されます
- Claude Codeのインストールが別途必要です（`npm install -g @anthropic-ai/claude-code`）
