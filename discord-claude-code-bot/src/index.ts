import {
  AttachmentBuilder,
  CategoryChannel,
  ChannelType,
  Client,
  Collection,
  GatewayIntentBits,
  type GuildBasedChannel,
  type Interaction,
  type Message,
  Partials,
  type TextChannel,
} from "discord.js";
import { config } from "dotenv";
import { createWriteStream, existsSync, mkdirSync, statSync } from "fs";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import { resolve, basename, join } from "path";
import { ClaudeSessionManager, type ProgressEvent } from "./claude-session";

// 環境変数を読み込む
config();

// 必須環境変数のチェック
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
if (!DISCORD_TOKEN) {
  console.error("エラー: DISCORD_TOKEN が設定されていません");
  process.exit(1);
}

// Claude Code内から起動された場合のネスト実行制限を解除する
// （このボット自体をClaude Codeセッション内で起動した場合に必要）
delete process.env.CLAUDECODE;

// APIキーは任意（Claude Code Pro/MaxプランはCLIのログイン認証を使うため不要）
// OpenRouter経由で使う場合のみ設定する
if (process.env.OPENROUTER_API_KEY) {
  process.env.ANTHROPIC_API_KEY = process.env.OPENROUTER_API_KEY;
  process.env.ANTHROPIC_BASE_URL = "https://openrouter.ai/api/v1";
  console.log("OpenRouter APIを使用します");
} else {
  console.log("Claude Code CLIのログイン認証を使用します（Pro/Maxプラン）");
}

// 設定値
const DEFAULT_MODEL = process.env.MODEL || "claude-sonnet-4-20250514";
const WORK_DIR = process.env.WORK_DIR || process.cwd();
const ALLOWED_USER_IDS = process.env.ALLOWED_USER_IDS
  ? process.env.ALLOWED_USER_IDS.split(",").map((id) => id.trim())
  : [];

// Discordの1メッセージあたりの文字数上限
const DISCORD_MAX_LENGTH = 2000;

// ボットへのプレフィックス（従来方式も維持）
const PREFIX = "!claude";

// 添付ファイルのダウンロード先ディレクトリ
const ATTACHMENTS_DIR = join(WORK_DIR, ".discord-attachments");

// セッションマネージャーの初期化
const sessionManager = new ClaudeSessionManager(WORK_DIR, DEFAULT_MODEL);

// Discordクライアントの初期化
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

// ========================================
// ユーティリティ関数
// ========================================

/**
 * 長いテキストをDiscordの文字数制限に収まるように分割する
 */
function splitMessage(text: string): string[] {
  if (text.length <= DISCORD_MAX_LENGTH) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= DISCORD_MAX_LENGTH) {
      chunks.push(remaining);
      break;
    }

    // 分割ポイントを探す（改行 > スペース > 強制分割）
    let splitIndex = remaining.lastIndexOf("\n", DISCORD_MAX_LENGTH);
    if (splitIndex === -1 || splitIndex < DISCORD_MAX_LENGTH / 2) {
      splitIndex = remaining.lastIndexOf(" ", DISCORD_MAX_LENGTH);
    }
    if (splitIndex === -1 || splitIndex < DISCORD_MAX_LENGTH / 2) {
      splitIndex = DISCORD_MAX_LENGTH;
    }

    chunks.push(remaining.substring(0, splitIndex));
    remaining = remaining.substring(splitIndex).trimStart();
  }

  return chunks;
}

// Discordのファイルアップロード上限（無料サーバー: 25MB）
const DISCORD_FILE_SIZE_LIMIT = 25 * 1024 * 1024;

/**
 * レスポンステキストからファイルパスを抽出し、実在するファイルのみ返す
 */
function extractAttachableFiles(text: string, workDir: string): string[] {
  const filePaths = new Set<string>();

  const backtickPattern = /`([^`\s]+\.[a-zA-Z0-9]+)`/g;
  let match;
  while ((match = backtickPattern.exec(text)) !== null) {
    filePaths.add(match[1]);
  }

  const validFiles: string[] = [];
  for (const filePath of filePaths) {
    const absolutePath = resolve(workDir, filePath);
    try {
      if (!existsSync(absolutePath)) continue;
      const stats = statSync(absolutePath);
      if (!stats.isFile()) continue;
      if (stats.size > DISCORD_FILE_SIZE_LIMIT) continue;
      if (stats.size === 0) continue;
      validFiles.push(absolutePath);
    } catch {
      continue;
    }
  }

  return validFiles;
}

/**
 * ユーザーがボットの使用を許可されているか確認する
 */
function isUserAllowed(userId: string): boolean {
  if (ALLOWED_USER_IDS.length === 0) return true;
  return ALLOWED_USER_IDS.includes(userId);
}

/**
 * ツール名を日本語の表示名に変換する
 */
function toolDisplayName(toolName: string): string {
  const names: Record<string, string> = {
    Bash: "コマンド実行",
    Read: "ファイル読み込み",
    Write: "ファイル書き込み",
    Edit: "ファイル編集",
    Glob: "ファイル検索",
    Grep: "テキスト検索",
    WebFetch: "Web取得",
    WebSearch: "Web検索",
    Task: "サブタスク",
    TodoWrite: "タスク管理",
  };
  return names[toolName] || toolName;
}

// ========================================
// 添付ファイルのダウンロード処理
// ========================================

/**
 * Discord添付ファイルをローカルにダウンロードする
 * ダウンロードしたファイルのパスを返す
 */
async function downloadAttachment(
  url: string,
  filename: string
): Promise<string> {
  // ダウンロードディレクトリが存在しなければ作成
  if (!existsSync(ATTACHMENTS_DIR)) {
    mkdirSync(ATTACHMENTS_DIR, { recursive: true });
  }

  // ファイル名の衝突を避けるためタイムスタンプを付加
  const timestamp = Date.now();
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const localPath = join(ATTACHMENTS_DIR, `${timestamp}_${safeName}`);

  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`ダウンロード失敗: ${response.statusText}`);
  }

  // Node.js ReadableStreamをファイルに書き込む
  const fileStream = createWriteStream(localPath);
  await pipeline(Readable.fromWeb(response.body as any), fileStream);

  return localPath;
}

/**
 * Discordメッセージの添付ファイルを処理してプロンプトに追加する
 * 画像はパスを参照、テキストファイルは内容も含める
 */
async function processAttachments(
  attachments: Collection<string, any>
): Promise<{ promptAddition: string; downloadedPaths: string[] }> {
  if (attachments.size === 0) {
    return { promptAddition: "", downloadedPaths: [] };
  }

  const downloadedPaths: string[] = [];
  const promptParts: string[] = [];

  for (const [, attachment] of attachments) {
    try {
      const localPath = await downloadAttachment(
        attachment.url,
        attachment.name
      );
      downloadedPaths.push(localPath);

      // ファイルの種類に応じてプロンプトを構築
      const ext = attachment.name.split(".").pop()?.toLowerCase() || "";
      const isImage = ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext);

      if (isImage) {
        promptParts.push(
          `[添付画像: ${attachment.name}] → ${localPath}`
        );
      } else {
        promptParts.push(
          `[添付ファイル: ${attachment.name}] → ${localPath}\nこのファイルの内容を読んで処理してください。`
        );
      }
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : "不明なエラー";
      promptParts.push(
        `[添付ファイル: ${attachment.name}] ダウンロード失敗: ${errorMsg}`
      );
    }
  }

  const promptAddition =
    promptParts.length > 0
      ? "\n\n--- 添付ファイル ---\n" + promptParts.join("\n")
      : "";

  return { promptAddition, downloadedPaths };
}

// ========================================
// 進捗通知ヘルパー
// ========================================

/**
 * Discordメッセージをリアルタイム進捗で更新する
 * ログを積み上げて表示し、レート制限を避けるため最低2秒間隔で更新する
 */
function createProgressUpdater(
  editFn: (content: string) => Promise<any>
): (event: ProgressEvent) => void {
  let lastUpdateTime = 0;
  let pendingUpdate = false;
  const UPDATE_INTERVAL_MS = 2000;
  // 積み上げるログ行
  const logLines: string[] = ["考え中..."];

  /**
   * ログ行をDiscordの文字数制限に収めて返す（古い行を先頭から削る）
   */
  const buildContent = (): string => {
    const MAX = 1800; // フッター用に余裕を持たせる
    let content = logLines.join("\n");
    while (content.length > MAX && logLines.length > 1) {
      logLines.shift();
      content = logLines.join("\n");
    }
    return content;
  };

  const doUpdate = async () => {
    const now = Date.now();
    if (now - lastUpdateTime < UPDATE_INTERVAL_MS) {
      if (!pendingUpdate) {
        pendingUpdate = true;
        setTimeout(async () => {
          pendingUpdate = false;
          lastUpdateTime = Date.now();
          try { await editFn(buildContent()); } catch { /* 無視 */ }
        }, UPDATE_INTERVAL_MS - (now - lastUpdateTime));
      }
      return;
    }
    lastUpdateTime = now;
    try { await editFn(buildContent()); } catch { /* 無視 */ }
  };

  return (event: ProgressEvent) => {
    switch (event.type) {
      case "assistant_text": {
        const preview = event.text.slice(0, 200).replace(/\n/g, " ");
        logLines.push(`💭 ${preview}${event.text.length > 200 ? "..." : ""}`);
        doUpdate();
        break;
      }
      case "tool_call": {
        const inputStr = formatToolInput(event.toolName, event.input);
        logLines.push(`⏺ **${event.toolName}**(${inputStr})`);
        doUpdate();
        break;
      }
      case "tool_result": {
        const lines = event.output.split("\n").slice(0, 3).join(" / ");
        const more = event.output.split("\n").length > 3
          ? ` (+${event.output.split("\n").length - 3}行)` : "";
        const icon = event.isError ? "⎿ Error:" : "⎿";
        logLines.push(`  ${icon} ${lines}${more}`);
        doUpdate();
        break;
      }
      case "tool_progress":
        logLines.push(`⏳ **${toolDisplayName(event.toolName)}** 実行中... (${Math.floor(event.elapsedSeconds)}秒)`);
        doUpdate();
        break;
      case "tool_summary":
        logLines.push(`✅ ${event.summary}`);
        doUpdate();
        break;
      case "task_started":
        logLines.push(`🔄 サブタスク: ${event.description}`);
        doUpdate();
        break;
      case "task_completed":
        logLines.push(
          event.status === "completed"
            ? `✅ 完了: ${event.summary}`
            : `❌ ${event.status}: ${event.summary}`
        );
        doUpdate();
        break;
    }
  };
}

// ========================================
// コンソールロギング
// ========================================

/** ANSIカラーコード */
const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  red: "\x1b[31m",
  gray: "\x1b[90m",
};

/**
 * タイムスタンプ付きのログ出力
 */
function log(label: string, color: string, ...args: string[]): void {
  const time = new Date().toLocaleTimeString("ja-JP");
  console.log(`${C.gray}[${time}]${C.reset} ${color}${C.bold}${label}${C.reset}`, ...args);
}

/**
 * ユーザーのメッセージ受信をログ出力
 */
function logUserMessage(
  username: string,
  userId: string,
  channelInfo: string,
  prompt: string
): void {
  log("📨 受信", C.cyan, `${username} (${userId}) @ ${channelInfo}`);
  console.log(`${C.gray}   └─ ${C.reset}${prompt.slice(0, 200)}${prompt.length > 200 ? "..." : ""}`);
}

/**
 * Claudeの進捗イベントをログ出力
 */
function logProgress(event: ProgressEvent): void {
  switch (event.type) {
    case "assistant_text": {
      const preview = event.text.slice(0, 300).replace(/\n/g, " ");
      log("🤔 Claude", C.blue, `${preview}${event.text.length > 300 ? "..." : ""}`);
      break;
    }
    case "tool_call": {
      // ⏺ Bash(git status) のような形式で表示
      const inputStr = formatToolInput(event.toolName, event.input);
      console.log(`${C.green}⏺ ${event.toolName}${C.reset}(${C.gray}${inputStr}${C.reset})`);
      break;
    }
    case "tool_result": {
      // ⎿ 結果 の形式で表示
      const icon = event.isError ? `${C.red}⎿ Error:${C.reset}` : `${C.gray}⎿ ${C.reset}`;
      const lines = event.output.split("\n").slice(0, 5); // 最大5行
      const more = event.output.split("\n").length > 5 ? ` ... (+${event.output.split("\n").length - 5}行)` : "";
      console.log(`  ${icon} ${lines.join("\n     ")}${more}`);
      break;
    }
    case "tool_progress":
      log("🔧 実行中", C.yellow,
        `${toolDisplayName(event.toolName)} (${Math.floor(event.elapsedSeconds)}秒経過)`
      );
      break;
    case "tool_summary":
      log("✅ 完了", C.green, event.summary);
      break;
    case "task_started":
      log("🔄 サブタスク", C.blue, event.description);
      break;
    case "task_completed": {
      const icon = event.status === "completed" ? "✅" : "❌";
      log(`${icon} タスク完了`, event.status === "completed" ? C.green : C.red,
        `[${event.status}] ${event.summary}`
      );
      break;
    }
  }
}

/**
 * ツールの入力パラメータを簡潔な文字列に変換する
 */
function formatToolInput(toolName: string, input: Record<string, unknown>): string {
  // ツールごとに主要なパラメータを抽出
  switch (toolName) {
    case "Bash":
      return String(input.command || "").slice(0, 100);
    case "Read":
      return String(input.file_path || "");
    case "Write":
      return String(input.file_path || "");
    case "Edit":
      return String(input.file_path || "");
    case "Glob":
      return String(input.pattern || "");
    case "Grep":
      return `"${String(input.pattern || "")}"`;
    case "WebFetch":
      return String(input.url || "").slice(0, 80);
    case "WebSearch":
      return String(input.query || "").slice(0, 80);
    default:
      return JSON.stringify(input).slice(0, 100);
  }
}

/**
 * Claudeの応答をログ出力
 */
function logResponse(responseText: string, costUsd: number): void {
  const preview = responseText.slice(0, 200).replace(/\n/g, " ");
  log("💬 応答", C.magenta, `${preview}${responseText.length > 200 ? "..." : ""}`);
  if (process.env.OPENROUTER_API_KEY && costUsd > 0) {
    log("💰 コスト", C.gray, `$${costUsd.toFixed(4)}`);
  }
}

// ========================================
// ヘルプテキスト
// ========================================

function getHelpText(): string {
  return [
    "**Discord Claude Code Bot**",
    "",
    "Claude Codeの機能をDiscordから利用できます。",
    "ファイルの読み書き、コード生成、Git操作などが可能です。",
    "",
    "**スラッシュコマンド:**",
    "`/claude prompt:<メッセージ>` — Claude Codeにメッセージを送る",
    "`/claude-clear` — セッションをリセット",
    "`/claude-model model:<モデル>` — モデルを変更",
    "`/claude-workspace name:<名前> directory:<パス>` — ワークスペースを登録",
    "`/claude-workspaces` — ワークスペース一覧を表示",
    "`/claude-help` — このヘルプを表示",
    "",
    "**プレフィックス方式（従来互換）:**",
    `\`${PREFIX} <メッセージ>\` — Claude Codeにメッセージを送る`,
    `\`${PREFIX} clear\` — セッションをリセット`,
    `\`${PREFIX} help\` — このヘルプを表示`,
    "",
    "**添付ファイル:**",
    "メッセージに画像やファイルを添付すると、Claudeに渡されます。",
    "",
    "**ワークスペース:**",
    "カテゴリ内のチャンネルは自動的にワークスペースのディレクトリで作業します。",
    "",
    "**進捗通知:**",
    "処理中はツール実行状況がリアルタイムで表示されます。",
  ].join("\n");
}

// ========================================
// 共通の応答送信処理
// ========================================

/**
 * ClaudeCodeの応答結果をDiscordに送信する共通関数
 */
async function sendResponse(
  responseText: string,
  costUsd: number,
  channelId: string,
  editFirstMessage: (content: string) => Promise<any>,
  sendToChannel: (content: string) => Promise<any>,
  sendFilesToChannel: (files: AttachmentBuilder[]) => Promise<any>
): Promise<void> {
  const workDir = sessionManager.resolveWorkDir(channelId);
  const workspaceName = sessionManager.resolveWorkspaceName(channelId);
  const chunks = splitMessage(responseText);

  // ファイル添付の準備
  const attachableFiles = extractAttachableFiles(responseText, workDir);
  const attachments = attachableFiles.map(
    (filePath) => new AttachmentBuilder(filePath, { name: basename(filePath) })
  );

  // OpenRouter利用時のみコストを表示（Pro/Maxプランは実費課金なし）
  const showCost = !!process.env.OPENROUTER_API_KEY;
  const costInfo = showCost && costUsd > 0 ? `\n-# コスト: $${costUsd.toFixed(4)}` : "";
  const wsInfo = workspaceName ? `\n-# ワークスペース: ${workspaceName}` : "";
  const attachInfo =
    attachments.length > 0
      ? `\n-# 添付: ${attachableFiles.map((f) => basename(f)).join(", ")}`
      : "";
  const footer = attachInfo + wsInfo + costInfo;

  // 最初のチャンクで元のメッセージを編集
  await editFirstMessage(
    chunks[0] + (chunks.length === 1 ? footer : "")
  );

  // 残りのチャンクを追加送信
  for (let i = 1; i < chunks.length; i++) {
    const suffix = i === chunks.length - 1 ? footer : "";
    await sendToChannel(chunks[i] + suffix);
  }

  // 添付ファイルがあれば送信
  if (attachments.length > 0) {
    await sendFilesToChannel(attachments);
  }
}

// ========================================
// ボット起動時の処理
// ========================================

client.once("ready", () => {
  console.log(`ボットが起動しました: ${client.user?.tag}`);
  console.log(`作業ディレクトリ: ${WORK_DIR}`);
  console.log(`デフォルトモデル: ${DEFAULT_MODEL}`);
  console.log(
    `許可ユーザー: ${ALLOWED_USER_IDS.length === 0 ? "全員" : ALLOWED_USER_IDS.join(", ")}`
  );

  // システムプロンプトの読み込み元を表示
  const identifyMdPath = `${WORK_DIR}/identify.md`;
  const contextMdPath  = `${WORK_DIR}/context.md`;
  const hasIdentify = existsSync(identifyMdPath);
  const hasContext  = existsSync(contextMdPath);
  if (hasIdentify || hasContext) {
    if (hasIdentify) console.log(`システムプロンプト: identify.md (性格・口調)`);
    if (hasContext)  console.log(`システムプロンプト: context.md  (プロジェクト情報)`);
  } else if (process.env.SYSTEM_PROMPT) {
    console.log(`システムプロンプト: 環境変数 SYSTEM_PROMPT を使用`);
  } else {
    console.log(`システムプロンプト: 未設定`);
  }
});

// ========================================
// スラッシュコマンドの処理
// ========================================

client.on("interactionCreate", async (interaction: Interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const userId = interaction.user.id;

  if (!isUserAllowed(userId)) {
    await interaction.reply({
      content: "このボットを使用する権限がありません。",
      ephemeral: true,
    });
    return;
  }

  const { commandName } = interaction;

  // /claude-help
  if (commandName === "claude-help") {
    await interaction.reply({ content: getHelpText(), ephemeral: true });
    return;
  }

  // /claude-clear
  if (commandName === "claude-clear") {
    const { cleared, savedFile } = sessionManager.clearSession(interaction.channelId);
    const memoryNote = savedFile ? `\n💾 会話履歴を \`${savedFile}\` に保存しました。` : "";
    await interaction.reply(
      cleared
        ? `セッションをクリアしました。新しい会話を始められます。${memoryNote}`
        : "このチャンネルにはアクティブなセッションがありません。"
    );
    return;
  }

  // /claude-model
  if (commandName === "claude-model") {
    const model = interaction.options.getString("model", true);
    sessionManager.setModel(interaction.channelId, model);

    // よく使うモデルの表示名（未登録の場合はモデルIDをそのまま表示）
    const modelNames: Record<string, string> = {
      "anthropic/claude-sonnet-4-20250514": "Claude Sonnet 4 (高速・バランス型)",
      "anthropic/claude-opus-4-20250514": "Claude Opus 4 (最高性能)",
      "anthropic/claude-haiku-4-5-20251001": "Claude Haiku 4.5 (最速・軽量)",
      "anthropic/claude-3-5-sonnet-20241022": "Claude 3.5 Sonnet",
      "anthropic/claude-3-5-haiku-20241022": "Claude 3.5 Haiku",
      "openai/gpt-4o": "GPT-4o",
      "openai/gpt-4o-mini": "GPT-4o Mini",
      "google/gemini-2.0-flash-001": "Gemini 2.0 Flash",
      "google/gemini-2.5-pro-preview-03-25": "Gemini 2.5 Pro",
      "meta-llama/llama-3.3-70b-instruct": "Llama 3.3 70B",
    };
    const displayName = modelNames[model] || model;

    await interaction.reply(
      `モデルを **${displayName}** に変更しました。\n次のメッセージからこのモデルが使用されます。`
    );
    return;
  }

  // /claude-workspace — ワークスペース登録
  if (commandName === "claude-workspace") {
    const name = interaction.options.getString("name", true);
    const directory = interaction.options.getString("directory", true);

    // ディレクトリの存在チェック
    if (!existsSync(directory)) {
      await interaction.reply({
        content: `ディレクトリが存在しません: \`${directory}\``,
        ephemeral: true,
      });
      return;
    }

    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({
        content: "このコマンドはサーバー内でのみ使用できます。",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply();

    try {
      // 既存のカテゴリを検索、なければ作成
      let category = guild.channels.cache.find(
        (ch): ch is CategoryChannel =>
          ch.type === ChannelType.GuildCategory &&
          ch.name === `🤖 ${name}`
      );

      if (!category) {
        category = await guild.channels.create({
          name: `🤖 ${name}`,
          type: ChannelType.GuildCategory,
        });
      }

      // カテゴリ配下にデフォルトチャンネルがなければ作成
      const existingChannels = guild.channels.cache.filter(
        (ch) => ch.parentId === category!.id
      );
      if (existingChannels.size === 0) {
        await guild.channels.create({
          name: "general",
          type: ChannelType.GuildText,
          parent: category,
        });
      }

      // ワークスペースを登録
      sessionManager.addWorkspace({
        name,
        directory,
        categoryId: category.id,
      });

      await interaction.editReply(
        `ワークスペース **${name}** を登録しました。\n` +
          `📁 ディレクトリ: \`${directory}\`\n` +
          `📂 カテゴリ: ${category.name}\n\n` +
          `このカテゴリ内のチャンネルでの操作は自動的にこのディレクトリで実行されます。`
      );
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : "不明なエラー";
      await interaction.editReply(`ワークスペースの作成に失敗: ${errorMsg}`);
    }
    return;
  }

  // /claude-workspaces — ワークスペース一覧
  if (commandName === "claude-workspaces") {
    const workspaces = sessionManager.getWorkspaces();
    if (workspaces.length === 0) {
      await interaction.reply({
        content:
          "登録されたワークスペースはありません。\n`/claude-workspace` で登録してください。",
        ephemeral: true,
      });
      return;
    }

    const list = workspaces
      .map(
        (ws) =>
          `• **${ws.name}** → \`${ws.directory}\``
      )
      .join("\n");

    await interaction.reply({
      content: `**ワークスペース一覧:**\n${list}`,
      ephemeral: true,
    });
    return;
  }

  // /claude — メッセージ送信
  if (commandName === "claude") {
    const prompt = interaction.options.getString("prompt", true);

    // チャンネルの親カテゴリ情報をキャッシュ
    const channel = interaction.channel;
    if (channel && "parentId" in channel && channel.parentId) {
      sessionManager.setChannelCategory(
        interaction.channelId,
        channel.parentId
      );
    }

    // ユーザーメッセージをコンソールに出力
    const channelName = channel && "name" in channel ? `#${channel.name}` : "スラッシュコマンド";
    logUserMessage(interaction.user.username, interaction.user.id, channelName, prompt);

    await interaction.deferReply();

    // 進捗更新用コールバック（Discord表示 + コンソールログ）
    const onProgress = createProgressUpdater((content) =>
      interaction.editReply(content)
    );
    const onProgressWithLog = (event: ProgressEvent) => {
      logProgress(event);
      onProgress(event);
    };

    try {
      const { result, costUsd } = await sessionManager.sendPrompt(
        interaction.channelId,
        prompt,
        onProgressWithLog
      );

      const responseText = result || "（応答なし）";
      logResponse(responseText, costUsd);

      await sendResponse(
        responseText,
        costUsd,
        interaction.channelId,
        (content) => interaction.editReply(content),
        (content) => (interaction.channel as TextChannel).send(content),
        (files) => (interaction.channel as TextChannel).send({ files })
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "不明なエラー";
      log("❌ エラー", C.red, errorMessage);
      console.error(error);
      await interaction.editReply(`エラーが発生しました: ${errorMessage}`);
    }
  }
});

// ========================================
// プレフィックス方式の処理（従来互換 + 添付ファイル対応）
// ========================================

client.on("messageCreate", async (message: Message) => {
  if (message.author.bot) return;

  const content = message.content.trim();

  // メンション or プレフィックスで始まるメッセージのみ処理
  // DMの場合はプレフィックス不要でそのままプロンプトとして扱う
  const mentionPrefix = `<@${client.user?.id}>`;
  const isDM = !message.guild; // ギルドがなければDM
  let prompt = "";

  if (isDM) {
    // DMは全文をプロンプトとして使う（clearとhelpは引き続き有効）
    prompt = content;
  } else if (content.startsWith(PREFIX)) {
    prompt = content.slice(PREFIX.length).trim();
  } else if (content.startsWith(mentionPrefix)) {
    prompt = content.slice(mentionPrefix.length).trim();
  } else {
    return;
  }

  if (!isUserAllowed(message.author.id)) {
    await message.reply("このボットを使用する権限がありません。");
    return;
  }

  // セッションクリアコマンド
  if (prompt === "clear" || prompt === "リセット") {
    const { cleared, savedFile } = sessionManager.clearSession(message.channelId);
    const memoryNote = savedFile ? `\n💾 会話履歴を \`${savedFile}\` に保存しました。` : "";
    await message.reply(
      cleared
        ? `セッションをクリアしました。新しい会話を始められます。${memoryNote}`
        : "このチャンネルにはアクティブなセッションがありません。"
    );
    return;
  }

  // ヘルプコマンド
  if (prompt === "help" || prompt === "ヘルプ") {
    await message.reply(getHelpText());
    return;
  }

  // プロンプトが空で添付もない場合
  if (!prompt && message.attachments.size === 0) {
    await message.reply(
      `メッセージを入力してください。例: \`${PREFIX} このプロジェクトの構成を教えて\``
    );
    return;
  }

  // チャンネルの親カテゴリ情報をキャッシュ
  if ("parentId" in message.channel && message.channel.parentId) {
    sessionManager.setChannelCategory(
      message.channelId,
      message.channel.parentId
    );
  }

  // ユーザーメッセージをコンソールに出力
  const channelInfo = isDM
    ? "DM"
    : "name" in message.channel
    ? `#${(message.channel as any).name}`
    : message.channelId;
  logUserMessage(message.author.username, message.author.id, channelInfo, prompt);

  // 処理中の表示
  const thinkingMessage = await message.reply("考え中...");

  // 進捗更新用コールバック（Discord表示 + コンソールログ）
  const onProgress = createProgressUpdater((content) =>
    thinkingMessage.edit(content)
  );
  const onProgressWithLog = (event: ProgressEvent) => {
    logProgress(event);
    onProgress(event);
  };

  try {
    // 添付ファイルを処理してプロンプトに追加
    const { promptAddition } = await processAttachments(message.attachments);
    const fullPrompt = prompt + promptAddition;

    // Claude Codeにプロンプトを送信
    const { result, costUsd } = await sessionManager.sendPrompt(
      message.channelId,
      fullPrompt,
      onProgressWithLog
    );

    const responseText = result || "（応答なし）";
    logResponse(responseText, costUsd);

    const channel = message.channel as TextChannel;

    await sendResponse(
      responseText,
      costUsd,
      message.channelId,
      (content) => thinkingMessage.edit(content),
      (content) => channel.send(content),
      (files) => channel.send({ files })
    );
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "不明なエラー";
    log("❌ エラー", C.red, errorMessage);
    console.error(error);
    await thinkingMessage.edit(`エラーが発生しました: ${errorMessage}`);
  }
});

// ボットを起動
client.login(DISCORD_TOKEN);
