import {
  AttachmentBuilder,
  Client,
  GatewayIntentBits,
  Interaction,
  Message,
  Partials,
  TextChannel,
} from "discord.js";
import { config } from "dotenv";
import { existsSync, statSync } from "fs";
import { resolve, basename } from "path";
import { ClaudeSessionManager } from "./claude-session";

// 環境変数を読み込む
config();

// 必須環境変数のチェック
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
if (!DISCORD_TOKEN) {
  console.error("エラー: DISCORD_TOKEN が設定されていません");
  process.exit(1);
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("エラー: ANTHROPIC_API_KEY が設定されていません");
  process.exit(1);
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

/**
 * 長いテキストをDiscordの文字数制限に収まるように分割する
 * コードブロックの途中で切れないよう考慮する
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
 * バッククォート内のパスや、よく使われるパターンを検出する
 */
function extractAttachableFiles(text: string, workDir: string): string[] {
  const filePaths = new Set<string>();

  // バッククォート内のファイルパスを抽出（例: `src/index.ts` や `/home/user/file.txt`）
  const backtickPattern = /`([^`\s]+\.[a-zA-Z0-9]+)`/g;
  let match;
  while ((match = backtickPattern.exec(text)) !== null) {
    filePaths.add(match[1]);
  }

  // 検出したパスを検証し、実在するファイルのみ返す
  const validFiles: string[] = [];
  for (const filePath of filePaths) {
    // 絶対パスまたは作業ディレクトリからの相対パスに解決
    const absolutePath = resolve(workDir, filePath);

    try {
      if (!existsSync(absolutePath)) continue;

      const stats = statSync(absolutePath);
      // ディレクトリは除外
      if (!stats.isFile()) continue;
      // サイズ上限チェック
      if (stats.size > DISCORD_FILE_SIZE_LIMIT) continue;
      // 空ファイルは除外
      if (stats.size === 0) continue;

      validFiles.push(absolutePath);
    } catch {
      // アクセスエラーなどは無視
      continue;
    }
  }

  return validFiles;
}

/**
 * ユーザーがボットの使用を許可されているか確認する
 */
function isUserAllowed(userId: string): boolean {
  // 許可リストが空なら全員許可
  if (ALLOWED_USER_IDS.length === 0) return true;
  return ALLOWED_USER_IDS.includes(userId);
}

/**
 * ヘルプテキストを生成する
 */
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
    "`/claude-help` — このヘルプを表示",
    "",
    "**プレフィックス方式（従来互換）:**",
    `\`${PREFIX} <メッセージ>\` — Claude Codeにメッセージを送る`,
    `\`${PREFIX} clear\` — セッションをリセット`,
    `\`${PREFIX} help\` — このヘルプを表示`,
    "",
    "**例:**",
    "`/claude prompt:このプロジェクトの構成を教えて`",
    "`/claude prompt:auth.tsのバグを修正して`",
    "",
    `チャンネルごとに会話が継続されます。`,
  ].join("\n");
}

// ボット起動時の処理
client.once("ready", () => {
  console.log(`ボットが起動しました: ${client.user?.tag}`);
  console.log(`作業ディレクトリ: ${WORK_DIR}`);
  console.log(`デフォルトモデル: ${DEFAULT_MODEL}`);
  console.log(
    `許可ユーザー: ${ALLOWED_USER_IDS.length === 0 ? "全員" : ALLOWED_USER_IDS.join(", ")}`
  );
  console.log("スラッシュコマンド: /claude, /claude-clear, /claude-model, /claude-help");
  console.log(`プレフィックス方式: "${PREFIX} <メッセージ>" も引き続き使えます`);
});

// ========================================
// スラッシュコマンドの処理
// ========================================
client.on("interactionCreate", async (interaction: Interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const userId = interaction.user.id;

  // ユーザー権限チェック
  if (!isUserAllowed(userId)) {
    await interaction.reply({
      content: "このボットを使用する権限がありません。",
      ephemeral: true,
    });
    return;
  }

  const { commandName } = interaction;

  // /claude-help — ヘルプ表示
  if (commandName === "claude-help") {
    await interaction.reply({ content: getHelpText(), ephemeral: true });
    return;
  }

  // /claude-clear — セッションリセット
  if (commandName === "claude-clear") {
    const cleared = sessionManager.clearSession(interaction.channelId);
    await interaction.reply(
      cleared
        ? "セッションをクリアしました。新しい会話を始められます。"
        : "このチャンネルにはアクティブなセッションがありません。"
    );
    return;
  }

  // /claude-model — モデル変更
  if (commandName === "claude-model") {
    const model = interaction.options.getString("model", true);
    sessionManager.setModel(interaction.channelId, model);

    // モデル名を表示用にマッピング
    const modelNames: Record<string, string> = {
      "claude-sonnet-4-20250514": "Sonnet (高速・バランス型)",
      "claude-opus-4-20250514": "Opus (最高性能)",
      "claude-haiku-4-5-20251001": "Haiku (最速・軽量)",
    };
    const displayName = modelNames[model] || model;

    await interaction.reply(
      `モデルを **${displayName}** に変更しました。\n次のメッセージからこのモデルが使用されます。`
    );
    return;
  }

  // /claude — メッセージ送信
  if (commandName === "claude") {
    const prompt = interaction.options.getString("prompt", true);

    // スラッシュコマンドは3秒以内に応答が必要なので、deferReplyで猶予を確保
    await interaction.deferReply();

    try {
      const { result, costUsd } = await sessionManager.sendPrompt(
        interaction.channelId,
        prompt
      );

      const responseText = result || "（応答なし）";
      const chunks = splitMessage(responseText);

      // ファイル添付の準備
      const attachableFiles = extractAttachableFiles(responseText, WORK_DIR);
      const attachments = attachableFiles.map(
        (filePath) =>
          new AttachmentBuilder(filePath, { name: basename(filePath) })
      );

      const costInfo =
        costUsd > 0 ? `\n-# コスト: $${costUsd.toFixed(4)}` : "";
      const attachInfo =
        attachments.length > 0
          ? `\n-# 添付ファイル: ${attachableFiles.map((f) => basename(f)).join(", ")}`
          : "";

      // 最初のチャンクでdeferReplyに応答
      await interaction.editReply(
        chunks[0] + (chunks.length === 1 ? attachInfo + costInfo : "")
      );

      // 残りのチャンクを追加メッセージとして送信
      if (interaction.channel) {
        const channel = interaction.channel as TextChannel;
        for (let i = 1; i < chunks.length; i++) {
          const suffix = i === chunks.length - 1 ? attachInfo + costInfo : "";
          await channel.send(chunks[i] + suffix);
        }

        // 添付ファイルがあれば送信
        if (attachments.length > 0) {
          await channel.send({ files: attachments });
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "不明なエラー";
      console.error("Claude Code エラー:", error);
      await interaction.editReply(`エラーが発生しました: ${errorMessage}`);
    }
  }
});

// ========================================
// プレフィックス方式の処理（従来互換）
// ========================================
client.on("messageCreate", async (message: Message) => {
  // ボット自身のメッセージは無視
  if (message.author.bot) return;

  const content = message.content.trim();

  // メンション or プレフィックスで始まるメッセージのみ処理
  const mentionPrefix = `<@${client.user?.id}>`;
  let prompt = "";

  if (content.startsWith(PREFIX)) {
    prompt = content.slice(PREFIX.length).trim();
  } else if (content.startsWith(mentionPrefix)) {
    prompt = content.slice(mentionPrefix.length).trim();
  } else {
    return;
  }

  // ユーザー権限チェック
  if (!isUserAllowed(message.author.id)) {
    await message.reply("このボットを使用する権限がありません。");
    return;
  }

  // セッションクリアコマンド
  if (prompt === "clear" || prompt === "リセット") {
    const cleared = sessionManager.clearSession(message.channelId);
    await message.reply(
      cleared
        ? "セッションをクリアしました。新しい会話を始められます。"
        : "このチャンネルにはアクティブなセッションがありません。"
    );
    return;
  }

  // ヘルプコマンド
  if (prompt === "help" || prompt === "ヘルプ") {
    await message.reply(getHelpText());
    return;
  }

  // プロンプトが空の場合
  if (!prompt) {
    await message.reply(
      `メッセージを入力してください。例: \`${PREFIX} このプロジェクトの構成を教えて\``
    );
    return;
  }

  // 処理中の表示
  const thinkingMessage = await message.reply("考え中...");

  try {
    // Claude Codeにプロンプトを送信
    const { result, costUsd } = await sessionManager.sendPrompt(
      message.channelId,
      prompt
    );

    // 結果をDiscordに送信（文字数制限対応）
    const responseText = result || "（応答なし）";
    const chunks = splitMessage(responseText);

    // レスポンスからファイルパスを抽出し、添付ファイルを準備
    const attachableFiles = extractAttachableFiles(responseText, WORK_DIR);
    const attachments = attachableFiles.map(
      (filePath) => new AttachmentBuilder(filePath, { name: basename(filePath) })
    );

    // 最初のチャンクで「考え中...」メッセージを更新
    const costInfo =
      costUsd > 0 ? `\n-# コスト: $${costUsd.toFixed(4)}` : "";

    // 添付ファイルの案内テキスト
    const attachInfo =
      attachments.length > 0
        ? `\n-# 添付ファイル: ${attachableFiles.map((f) => basename(f)).join(", ")}`
        : "";

    await thinkingMessage.edit(
      chunks[0] + (chunks.length === 1 ? attachInfo + costInfo : "")
    );

    // 残りのチャンクを追加メッセージとして送信
    const channel = message.channel as TextChannel;
    for (let i = 1; i < chunks.length; i++) {
      const suffix = i === chunks.length - 1 ? attachInfo + costInfo : "";
      await channel.send(chunks[i] + suffix);
    }

    // 添付ファイルがあれば送信
    if (attachments.length > 0) {
      await channel.send({ files: attachments });
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "不明なエラー";
    console.error("Claude Code エラー:", error);
    await thinkingMessage.edit(`エラーが発生しました: ${errorMessage}`);
  }
});

// ボットを起動
client.login(DISCORD_TOKEN);
