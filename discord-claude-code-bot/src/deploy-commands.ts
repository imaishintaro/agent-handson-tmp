import { REST, Routes, SlashCommandBuilder } from "discord.js";
import { config } from "dotenv";

// 環境変数を読み込む
config();

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;

if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error(
    "エラー: DISCORD_TOKEN と DISCORD_CLIENT_ID を設定してください"
  );
  process.exit(1);
}

// スラッシュコマンドの定義
const commands = [
  // /claude — Claude Codeにメッセージを送る
  new SlashCommandBuilder()
    .setName("claude")
    .setDescription("Claude Codeにメッセージを送る")
    .addStringOption((option) =>
      option
        .setName("prompt")
        .setDescription("Claude Codeに送るメッセージ")
        .setRequired(true)
    ),

  // /claude-clear — セッションをリセットする
  new SlashCommandBuilder()
    .setName("claude-clear")
    .setDescription("このチャンネルのClaude Codeセッションをリセットする"),

  // /claude-model — 使用するモデルを変更する
  new SlashCommandBuilder()
    .setName("claude-model")
    .setDescription("Claude Codeで使用するモデルを変更する")
    .addStringOption((option) =>
      option
        .setName("model")
        .setDescription("使用するモデル")
        .setRequired(true)
        .addChoices(
          { name: "Sonnet (高速・バランス型)", value: "anthropic/claude-sonnet-4-20250514" },
          { name: "Opus (最高性能)", value: "anthropic/claude-opus-4-20250514" },
          { name: "Haiku (最速・軽量)", value: "anthropic/claude-haiku-4-5-20251001" }
        )
    ),

  // /claude-workspace — ワークスペースを登録する
  new SlashCommandBuilder()
    .setName("claude-workspace")
    .setDescription("ワークスペースを登録してDiscordカテゴリと紐付ける")
    .addStringOption((option) =>
      option
        .setName("name")
        .setDescription("ワークスペース名（カテゴリ名になります）")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("directory")
        .setDescription("作業ディレクトリの絶対パス")
        .setRequired(true)
    ),

  // /claude-workspaces — ワークスペース一覧を表示する
  new SlashCommandBuilder()
    .setName("claude-workspaces")
    .setDescription("登録済みワークスペースの一覧を表示する"),

  // /claude-help — ヘルプを表示する
  new SlashCommandBuilder()
    .setName("claude-help")
    .setDescription("Claude Code Botの使い方を表示する"),

  // /cron-list — スケジュールジョブ一覧を表示する
  new SlashCommandBuilder()
    .setName("cron-list")
    .setDescription("登録済みスケジュールジョブの一覧を表示する"),

  // /cron-reload — crontab.json を再読み込みする
  new SlashCommandBuilder()
    .setName("cron-reload")
    .setDescription("crontab.json を再読み込みしてジョブを更新する"),

  // /cron-id — 現在のチャンネルIDを表示する
  new SlashCommandBuilder()
    .setName("cron-id")
    .setDescription("このチャンネルのIDを表示する（crontab.json の channelId に使用）"),
].map((command) => command.toJSON());

// コマンドをDiscordに登録する
const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

(async () => {
  try {
    console.log("スラッシュコマンドを登録中...");

    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });

    console.log("スラッシュコマンドの登録が完了しました:");
    console.log("  /claude            — Claude Codeにメッセージを送る");
    console.log("  /claude-clear      — セッションをリセット");
    console.log("  /claude-model      — モデルを変更");
    console.log("  /claude-workspace  — ワークスペースを登録");
    console.log("  /claude-workspaces — ワークスペース一覧");
    console.log("  /claude-help       — ヘルプを表示");
    console.log("  /cron-list         — スケジュールジョブ一覧");
    console.log("  /cron-reload       — crontab.json を再読み込み");
    console.log("  /cron-id           — このチャンネルのIDを表示");
  } catch (error) {
    console.error("コマンド登録エラー:", error);
  }
})();
