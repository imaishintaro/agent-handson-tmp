import * as cron from "node-cron";
import { EmbedBuilder, type Client, type TextChannel } from "discord.js";
import { existsSync, readFileSync, watchFile } from "fs";
import { join } from "path";
import type { ClaudeSessionManager, ProgressEvent } from "./claude-session";

// Embedカラー定義（index.tsと同じ値）
const EMBED_COLOR = {
  progress: 0xf59e0b,
  response: 0x5865f2,
  error: 0xef4444,
  info: 0x3b82f6,
  success: 0x22c55e,
} as const;

/** crontab.json の1ジョブ定義 */
export interface CronJob {
  /** ジョブを識別するユニークなID */
  id: string;
  /** ジョブの説明（Discordに表示される） */
  description: string;
  /**
   * cron式（標準5フィールド形式、Asia/Tokyo基準）
   * 例: "0 9 * * *" = 毎日9時, "0 9 * * 1-5" = 平日9時
   */
  cron: string;
  /** 送信先のDiscordチャンネルID */
  channelId: string;
  /** AIへの指示プロンプト */
  prompt: string;
  /** true のときのみ実行される */
  enabled: boolean;
}

interface CrontabConfig {
  jobs: CronJob[];
}

export class CronRunner {
  private readonly tasks = new Map<string, cron.ScheduledTask>();
  private readonly crontabPath: string;

  constructor(
    private readonly workDir: string,
    private readonly sessionManager: ClaudeSessionManager,
    private readonly client: Client
  ) {
    this.crontabPath = join(workDir, "cron", "crontab.json");
  }

  /**
   * cronを起動する。
   * crontab.jsonが存在しない場合はスキップ。
   * ファイル変更を5秒間隔で監視して自動リロードする。
   */
  start(): void {
    if (!existsSync(this.crontabPath)) {
      console.log(`[Cron] crontab.json が見つかりません: ${this.crontabPath}`);
      console.log("[Cron] workspace/cron/crontab.json を作成するとcronが有効になります");
      return;
    }

    this.loadAndSchedule();

    // crontab.json の変更を監視して自動リロード
    watchFile(this.crontabPath, { interval: 5000 }, () => {
      console.log("[Cron] crontab.json が変更されました。再読み込みします...");
      this.reload();
    });
  }

  /** 実行中のジョブ一覧を返す */
  getJobs(): CronJob[] {
    try {
      const raw = readFileSync(this.crontabPath, "utf-8");
      const config: CrontabConfig = JSON.parse(raw);
      return config.jobs ?? [];
    } catch {
      return [];
    }
  }

  /** 全タスクを停止して crontab.json を再読み込みする */
  reload(): void {
    this.tasks.forEach((task) => task.stop());
    this.tasks.clear();

    if (!existsSync(this.crontabPath)) {
      console.log("[Cron] crontab.json が見つかりません。cronを無効化します");
      return;
    }

    this.loadAndSchedule();
  }

  private loadAndSchedule(): void {
    let config: CrontabConfig;
    try {
      const raw = readFileSync(this.crontabPath, "utf-8");
      config = JSON.parse(raw);
    } catch (err) {
      console.error("[Cron] crontab.json の読み込みに失敗:", err);
      return;
    }

    const jobs = config.jobs ?? [];
    let scheduled = 0;

    for (const job of jobs) {
      if (!job.enabled) {
        console.log(`[Cron] スキップ (disabled): ${job.id}`);
        continue;
      }
      if (!cron.validate(job.cron)) {
        console.warn(`[Cron] 無効なcron式をスキップ: id="${job.id}" cron="${job.cron}"`);
        continue;
      }

      const task = cron.schedule(job.cron, () => this.runJob(job), {
        timezone: "Asia/Tokyo",
      });
      this.tasks.set(job.id, task);
      scheduled++;
      console.log(`[Cron] 登録: ${job.id} | "${job.cron}" | ${job.description}`);
    }

    console.log(`[Cron] ${scheduled} 件のジョブを登録しました（全${jobs.length}件中）`);
  }

  private async runJob(job: CronJob): Promise<void> {
    console.log(`[Cron] ジョブ開始: ${job.id} — ${job.description}`);

    // 送信先チャンネルを取得
    const channel = this.client.channels.cache.get(job.channelId) as TextChannel | undefined;
    if (!channel || !("send" in channel)) {
      console.error(`[Cron] チャンネルが見つかりません: channelId=${job.channelId} (ジョブ: ${job.id})`);
      return;
    }

    // 開始通知メッセージを送信
    const startEmbed = new EmbedBuilder()
      .setColor(EMBED_COLOR.progress)
      .setTitle(`⏰ ${job.description}`)
      .setDescription("AIが応答を生成中です...")
      .setFooter({ text: `スケジュールタスク | ID: ${job.id}` })
      .setTimestamp();

    const notifyMsg = await channel.send({ embeds: [startEmbed] });

    try {
      const { result } = await this.sessionManager.sendPrompt(
        job.channelId,
        job.prompt,
        (event: ProgressEvent) => {
          // 進捗はコンソールのみ（Discordは最終結果のみ更新）
          if (event.type === "tool_call") {
            console.log(`[Cron:${job.id}] ⏺ ${event.toolName}`);
          }
        }
      );

      const responseText = result || "（応答なし）";

      // 応答が長い場合は4000文字に切り詰め、続きがある旨を付記
      const truncated = responseText.length > 4000;
      const displayText = truncated
        ? responseText.slice(0, 3950) + "\n\n...（長いため省略されました）"
        : responseText;

      const responseEmbed = new EmbedBuilder()
        .setColor(EMBED_COLOR.response)
        .setTitle(`✅ ${job.description}`)
        .setDescription(displayText)
        .setFooter({ text: `スケジュールタスク | ID: ${job.id}` })
        .setTimestamp();

      await notifyMsg.edit({ embeds: [responseEmbed] });
      console.log(`[Cron] ジョブ完了: ${job.id}`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "不明なエラー";
      console.error(`[Cron] ジョブ失敗: ${job.id} —`, errMsg);

      const errorEmbed = new EmbedBuilder()
        .setColor(EMBED_COLOR.error)
        .setTitle(`❌ エラー: ${job.description}`)
        .setDescription(errMsg)
        .setFooter({ text: `スケジュールタスク | ID: ${job.id}` })
        .setTimestamp();

      await notifyMsg.edit({ embeds: [errorEmbed] });
    }
  }
}
