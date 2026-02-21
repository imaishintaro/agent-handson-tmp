import {
  Client,
  GatewayIntentBits,
  Message,
  Partials,
  TextChannel,
} from "discord.js";
import { config } from "dotenv";
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
const MODEL = process.env.MODEL || "claude-sonnet-4-20250514";
const WORK_DIR = process.env.WORK_DIR || process.cwd();
const ALLOWED_USER_IDS = process.env.ALLOWED_USER_IDS
  ? process.env.ALLOWED_USER_IDS.split(",").map((id) => id.trim())
  : [];

// Discordの1メッセージあたりの文字数上限
const DISCORD_MAX_LENGTH = 2000;

// ボットへのプレフィックス
const PREFIX = "!claude";

// セッションマネージャーの初期化
const sessionManager = new ClaudeSessionManager(WORK_DIR, MODEL);

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

/**
 * ユーザーがボットの使用を許可されているか確認する
 */
function isUserAllowed(userId: string): boolean {
  // 許可リストが空なら全員許可
  if (ALLOWED_USER_IDS.length === 0) return true;
  return ALLOWED_USER_IDS.includes(userId);
}

// ボット起動時の処理
client.once("ready", () => {
  console.log(`ボットが起動しました: ${client.user?.tag}`);
  console.log(`作業ディレクトリ: ${WORK_DIR}`);
  console.log(`モデル: ${MODEL}`);
  console.log(
    `許可ユーザー: ${ALLOWED_USER_IDS.length === 0 ? "全員" : ALLOWED_USER_IDS.join(", ")}`
  );
  console.log(`使い方: "${PREFIX} <メッセージ>" でClaude Codeに話しかけます`);
});

// メッセージ受信時の処理
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
    const helpText = [
      "**Discord Claude Code Bot**",
      "",
      "Claude Codeの機能をDiscordから利用できます。",
      "ファイルの読み書き、コード生成、Git操作などが可能です。",
      "",
      "**使い方:**",
      `\`${PREFIX} <メッセージ>\` — Claude Codeにメッセージを送る`,
      `\`${PREFIX} clear\` — セッションをリセット`,
      `\`${PREFIX} help\` — このヘルプを表示`,
      "",
      "**例:**",
      `\`${PREFIX} このプロジェクトの構成を教えて\``,
      `\`${PREFIX} auth.tsのバグを修正して\``,
      `\`${PREFIX} テストを実行して\``,
      "",
      `チャンネルごとに会話が継続されます。`,
    ].join("\n");
    await message.reply(helpText);
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

    // 最初のチャンクで「考え中...」メッセージを更新
    const costInfo =
      costUsd > 0 ? `\n-# コスト: $${costUsd.toFixed(4)}` : "";
    await thinkingMessage.edit(chunks[0] + (chunks.length === 1 ? costInfo : ""));

    // 残りのチャンクを追加メッセージとして送信
    for (let i = 1; i < chunks.length; i++) {
      const suffix = i === chunks.length - 1 ? costInfo : "";
      await message.channel.send(chunks[i] + suffix);
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
