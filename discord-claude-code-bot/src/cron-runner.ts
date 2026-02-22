import * as schedule from "node-schedule";
import * as yaml from "js-yaml";
import { EmbedBuilder, type Client, type TextChannel } from "discord.js";
import { existsSync, readFileSync, watchFile, writeFileSync } from "fs";
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

// ========================================
// スケジュール定義の型
// ========================================

/** 繰り返しジョブのスケジュール設定 */
interface RepeatSchedule {
  /** 実行時刻: "HH:MM" 形式 */
  time: string;
  /**
   * 実行曜日: "毎日" | "平日" | "週末" | "月,水,金" など
   * month_day を指定した場合はこの設定は無視される
   */
  days?: string;
  /**
   * 毎月N日に実行 (1-31)
   * 指定すると days より優先される
   */
  month_day?: number;
}

/** 単発ジョブのスケジュール設定 */
interface OnceSchedule {
  /** 実行日時: "YYYY-MM-DD HH:MM" 形式 */
  datetime: string;
}

interface BaseCronJob {
  id: string;
  description: string;
  channel_id: string;
  prompt: string;
  enabled: boolean;
}

/** 繰り返しジョブ */
export interface RepeatCronJob extends BaseCronJob {
  type: "repeat";
  schedule: RepeatSchedule;
}

/** 単発ジョブ（実行後は crontab.yaml から削除され backlog.yaml に移動する） */
export interface OnceCronJob extends BaseCronJob {
  type: "once";
  schedule: OnceSchedule;
}

export type CronJob = RepeatCronJob | OnceCronJob;

/** backlog.yaml に保存するエントリ */
interface BacklogEntry extends OnceCronJob {
  executed_at: string;
  status: "completed" | "failed";
  error?: string;
}

interface CrontabConfig {
  jobs: CronJob[];
}

interface BacklogConfig {
  completed: BacklogEntry[];
}

// ========================================
// スケジュールパーサー
// ========================================

/** 日本語曜日 → cron曜日番号の対応表 */
const DAY_MAP: Record<string, string> = {
  毎日: "*",
  平日: "1-5",
  週末: "0,6",
  月: "1", 火: "2", 水: "3",
  木: "4", 金: "5", 土: "6", 日: "0",
};

/** 曜日文字列を cron の曜日フィールドに変換する */
function parseDays(days: string): string {
  if (DAY_MAP[days]) return DAY_MAP[days];
  return days
    .split(/[,、・]/)
    .map((d) => DAY_MAP[d.trim()] ?? d.trim())
    .join(",");
}

/** 繰り返しスケジュールを cron 式に変換する */
function toCronExpression(s: RepeatSchedule): string {
  const [hourStr, minuteStr] = s.time.split(":");
  const hour = parseInt(hourStr, 10);
  const minute = parseInt(minuteStr ?? "0", 10);
  if (s.month_day !== undefined) {
    return `${minute} ${hour} ${s.month_day} * *`;
  }
  const days = parseDays(s.days ?? "毎日");
  return `${minute} ${hour} * * ${days}`;
}

/** "YYYY-MM-DD HH:MM" を Date に変換する */
function parseOnceDate(datetime: string): Date {
  const [datePart, timePart = "0:0"] = datetime.split(" ");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  return new Date(year, month - 1, day, hour, minute, 0);
}

/** スケジュールを人間が読みやすい文字列に変換する */
export function describeSchedule(job: CronJob): string {
  if (job.type === "once") {
    return `📅 単発: ${job.schedule.datetime}`;
  }
  const s = job.schedule;
  if (s.month_day !== undefined) {
    return `🔄 繰り返し: 毎月${s.month_day}日 ${s.time}`;
  }
  return `🔄 繰り返し: ${s.days ?? "毎日"} ${s.time}`;
}

/** 現在時刻を "YYYY-MM-DD HH:MM:SS" 形式で返す（Asia/Tokyo） */
function nowJST(): string {
  return new Date().toLocaleString("sv-SE", { timeZone: "Asia/Tokyo" }).replace("T", " ");
}

// ========================================
// CronRunner クラス
// ========================================

export class CronRunner {
  private readonly tasks = new Map<string, schedule.Job>();
  private readonly crontabPath: string;
  private readonly backlogPath: string;

  constructor(
    private readonly workDir: string,
    private readonly sessionManager: ClaudeSessionManager,
    private readonly client: Client
  ) {
    this.crontabPath = join(workDir, "cron", "crontab.yaml");
    this.backlogPath = join(workDir, "cron", "backlog.yaml");
  }

  /**
   * cronを起動する。
   * crontab.yaml が存在しなければスキップ。
   * ファイル変更を5秒間隔で監視して自動リロードする。
   */
  start(): void {
    if (!existsSync(this.crontabPath)) {
      console.log(`[Cron] crontab.yaml が見つかりません: ${this.crontabPath}`);
      console.log("[Cron] workspace/cron/crontab.yaml を作成するとcronが有効になります");
      return;
    }

    this.loadAndSchedule();

    watchFile(this.crontabPath, { interval: 5000 }, () => {
      console.log("[Cron] crontab.yaml が変更されました。再読み込みします...");
      this.reload();
    });
  }

  /** 登録済みジョブ一覧を返す */
  getJobs(): CronJob[] {
    try {
      const raw = readFileSync(this.crontabPath, "utf-8");
      const config = yaml.load(raw) as CrontabConfig;
      return config?.jobs ?? [];
    } catch {
      return [];
    }
  }

  /** バックログ一覧を返す */
  getBacklog(): BacklogEntry[] {
    try {
      const raw = readFileSync(this.backlogPath, "utf-8");
      const config = yaml.load(raw) as BacklogConfig;
      return config?.completed ?? [];
    } catch {
      return [];
    }
  }

  /** 全タスクを停止して crontab.yaml を再読み込みする */
  reload(): void {
    this.tasks.forEach((job) => job.cancel());
    this.tasks.clear();
    if (!existsSync(this.crontabPath)) return;
    this.loadAndSchedule();
  }

  /**
   * 単発ジョブを crontab.yaml から削除し backlog.yaml に移動する。
   * crontab.yaml のヘッダーコメント（jobs: 行より前）は保持する。
   */
  private archiveJob(job: OnceCronJob, status: "completed" | "failed", error?: string): void {
    try {
      // ── 1. crontab.yaml からジョブを削除 ──────────────────────────
      const raw = readFileSync(this.crontabPath, "utf-8");

      // jobs: 行より前のヘッダーコメントを保持する
      const headerLines: string[] = [];
      for (const line of raw.split("\n")) {
        if (/^jobs\s*:/.test(line)) break;
        headerLines.push(line);
      }
      const header = headerLines.join("\n").trimEnd();

      const config = yaml.load(raw) as CrontabConfig;
      config.jobs = (config.jobs ?? []).filter((j) => j.id !== job.id);

      const jobsYaml = yaml.dump(config, { indent: 2, lineWidth: 120 });
      const newContent = header ? `${header}\n\n${jobsYaml}` : jobsYaml;
      writeFileSync(this.crontabPath, newContent, "utf-8");

      // ── 2. backlog.yaml にエントリを追記 ──────────────────────────
      let backlog: BacklogEntry[] = this.getBacklog();
      const entry: BacklogEntry = {
        ...job,
        executed_at: nowJST(),
        status,
        ...(error ? { error } : {}),
      };
      backlog.push(entry);

      const backlogYaml = yaml.dump({ completed: backlog }, { indent: 2, lineWidth: 120 });
      writeFileSync(this.backlogPath, backlogYaml, "utf-8");

      console.log(`[Cron] 単発ジョブをバックログに移動しました: ${job.id} [${status}]`);
    } catch (err) {
      console.error("[Cron] バックログへの移動に失敗:", err);
    }
  }

  private loadAndSchedule(): void {
    let config: CrontabConfig;
    try {
      const raw = readFileSync(this.crontabPath, "utf-8");
      config = yaml.load(raw) as CrontabConfig;
    } catch (err) {
      console.error("[Cron] crontab.yaml の読み込みに失敗:", err);
      return;
    }

    const jobs = config?.jobs ?? [];
    let scheduled = 0;

    for (const job of jobs) {
      if (!job.enabled) {
        console.log(`[Cron] スキップ (disabled): ${job.id}`);
        continue;
      }

      if (job.type === "repeat") {
        let cronExpr: string;
        try {
          cronExpr = toCronExpression(job.schedule);
        } catch (err) {
          console.warn(`[Cron] スケジュール変換エラー: ${job.id} —`, err);
          continue;
        }

        const task = schedule.scheduleJob(cronExpr, () => this.runJob(job));
        if (!task) {
          console.warn(`[Cron] スケジュール登録失敗（無効な式？）: ${job.id} | "${cronExpr}"`);
          continue;
        }
        this.tasks.set(job.id, task);
        scheduled++;
        console.log(`[Cron] 登録(repeat): ${job.id} | ${cronExpr} | ${job.description}`);

      } else if (job.type === "once") {
        const date = parseOnceDate(job.schedule.datetime);
        if (date <= new Date()) {
          console.warn(`[Cron] 過去の日時のためスキップ: ${job.id} | ${job.schedule.datetime}`);
          continue;
        }

        const task = schedule.scheduleJob(date, () => this.runJob(job));
        if (!task) {
          console.warn(`[Cron] スケジュール登録失敗: ${job.id}`);
          continue;
        }
        this.tasks.set(job.id, task);
        scheduled++;
        console.log(`[Cron] 登録(once): ${job.id} | ${job.schedule.datetime} | ${job.description}`);
      }
    }

    console.log(`[Cron] ${scheduled} 件のジョブを登録しました（全${jobs.length}件中）`);
  }

  private async runJob(job: CronJob): Promise<void> {
    console.log(`[Cron] ジョブ開始: ${job.id} — ${job.description}`);

    const channel = this.client.channels.cache.get(job.channel_id) as TextChannel | undefined;
    if (!channel || !("send" in channel)) {
      console.error(`[Cron] チャンネルが見つかりません: channel_id=${job.channel_id} (ジョブ: ${job.id})`);
      if (job.type === "once") this.archiveJob(job, "failed", "チャンネルが見つかりません");
      return;
    }

    // 開始通知Embedを送信
    const startEmbed = new EmbedBuilder()
      .setColor(EMBED_COLOR.progress)
      .setTitle(`⏰ ${job.description}`)
      .setDescription("AIが応答を生成中です...")
      .setFooter({ text: `${describeSchedule(job)} | ID: ${job.id}` })
      .setTimestamp();

    const notifyMsg = await channel.send({ embeds: [startEmbed] });

    try {
      const { result } = await this.sessionManager.sendPrompt(
        job.channel_id,
        job.prompt,
        (event: ProgressEvent) => {
          if (event.type === "tool_call") {
            console.log(`[Cron:${job.id}] ⏺ ${event.toolName}`);
          }
        }
      );

      const responseText = result || "（応答なし）";
      const truncated = responseText.length > 4000;
      const displayText = truncated
        ? responseText.slice(0, 3950) + "\n\n...（長いため省略されました）"
        : responseText;

      const responseEmbed = new EmbedBuilder()
        .setColor(EMBED_COLOR.response)
        .setTitle(`✅ ${job.description}`)
        .setDescription(displayText)
        .setFooter({ text: `${describeSchedule(job)} | ID: ${job.id}` })
        .setTimestamp();

      await notifyMsg.edit({ embeds: [responseEmbed] });
      console.log(`[Cron] ジョブ完了: ${job.id}`);

      // 単発ジョブは完了後に crontab.yaml から削除して backlog.yaml へ
      if (job.type === "once") this.archiveJob(job, "completed");

    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "不明なエラー";
      console.error(`[Cron] ジョブ失敗: ${job.id} —`, errMsg);

      const errorEmbed = new EmbedBuilder()
        .setColor(EMBED_COLOR.error)
        .setTitle(`❌ エラー: ${job.description}`)
        .setDescription(errMsg)
        .setFooter({ text: `${describeSchedule(job)} | ID: ${job.id}` })
        .setTimestamp();

      await notifyMsg.edit({ embeds: [errorEmbed] });

      // 失敗した単発ジョブもバックログに移動
      if (job.type === "once") this.archiveJob(job, "failed", errMsg);
    }
  }
}
