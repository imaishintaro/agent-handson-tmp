import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

// ボット本体のルートディレクトリ（identify.md / context.md の置き場所）
// dist/ の一つ上がプロジェクトルート
const BOT_ROOT = join(__dirname, "..");

/**
 * 進捗イベントの型定義
 * ストリーム中のツール実行状況やタスク進捗をDiscordに通知するために使う
 */
export type ProgressEvent = {
  type: "tool_progress";
  toolName: string;
  elapsedSeconds: number;
} | {
  type: "tool_summary";
  summary: string;
} | {
  type: "task_started";
  description: string;
} | {
  type: "task_completed";
  summary: string;
  status: "completed" | "failed" | "stopped";
} | {
  // Claudeのテキスト出力（考え中の内容）
  type: "assistant_text";
  text: string;
} | {
  // ツール呼び出し（名前と入力パラメータ）
  type: "tool_call";
  toolName: string;
  input: Record<string, unknown>;
} | {
  // ツール実行結果
  type: "tool_result";
  toolName: string;
  output: string;
  isError: boolean;
};

/**
 * 進捗コールバック関数の型
 */
export type ProgressCallback = (event: ProgressEvent) => void;

/**
 * ワークスペース設定
 * Discordカテゴリとローカルディレクトリのマッピング
 */
export type WorkspaceConfig = {
  name: string;
  directory: string;
  categoryId: string;
};

/** 永続化するセッションデータの型 */
type PersistedData = {
  sessions: Record<string, string>;
  channelModels: Record<string, string>;
  workspaces: Record<string, WorkspaceConfig>;
  channelCategoryCache: Record<string, string | null>;
  // 会話履歴（タイムスタンプはISO文字列で保存）
  conversationHistory: Record<string, Array<{
    timestamp: string;
    userPrompt: string;
    assistantResponse: string;
  }>>;
};

/**
 * チャンネルごとのClaude Codeセッションを管理するクラス
 * セッションIDを保持し、会話の継続を可能にする
 * ワークスペース単位でのルーティングもサポート
 */
/** 会話の1ターン */
type ConversationTurn = {
  timestamp: Date;
  userPrompt: string;
  assistantResponse: string;
};

export class ClaudeSessionManager {
  // チャンネルID → セッションIDのマップ
  private sessions: Map<string, string> = new Map();
  // チャンネルID → モデル名のマップ（チャンネルごとのモデル設定）
  private channelModels: Map<string, string> = new Map();
  // ワークスペース一覧（カテゴリID → ワークスペース設定）
  private workspaces: Map<string, WorkspaceConfig> = new Map();
  // チャンネルID → カテゴリID のキャッシュ（ルーティング高速化）
  private channelCategoryCache: Map<string, string | null> = new Map();
  // チャンネルID → 会話履歴（メモリ保存用）
  private conversationHistory: Map<string, ConversationTurn[]> = new Map();
  private defaultWorkDir: string;
  private defaultModel: string;
  // セッションデータの保存先ファイルパス
  private persistPath: string;

  constructor(workDir: string, defaultModel: string) {
    this.defaultWorkDir = workDir;
    this.defaultModel = defaultModel;
    this.persistPath = join(workDir, ".sessions.json");
    this.load();
  }

  // ========================================
  // メモリ管理（RAG）
  // ========================================

  /** メモリファイルの保存ディレクトリ */
  private get memoryDir(): string {
    return join(this.defaultWorkDir, "memory");
  }

  /**
   * 会話履歴をタイムスタンプ付きMarkdownファイルに保存する
   */
  saveMemory(channelId: string): string | null {
    const history = this.conversationHistory.get(channelId);
    if (!history || history.length === 0) return null;

    if (!existsSync(this.memoryDir)) {
      mkdirSync(this.memoryDir, { recursive: true });
    }

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const filename = `memory_${now.getFullYear()}_${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}.md`;
    const filePath = join(this.memoryDir, filename);

    const lines = [
      `# 会話メモリ ${now.toLocaleString("ja-JP")}`,
      "",
      ...history.flatMap((turn) => [
        `## ${turn.timestamp.toLocaleString("ja-JP")}`,
        "",
        `**ユーザー**: ${turn.userPrompt}`,
        "",
        `**アシスタント**: ${turn.assistantResponse}`,
        "",
      ]),
    ];

    writeFileSync(filePath, lines.join("\n"), "utf-8");
    console.log(`[メモリ] 保存: ${filename} (${history.length}ターン)`);
    return filename;
  }

  /**
   * ユーザーのクエリに関連するメモリファイルをキーワード検索して返す
   */
  private searchMemories(query: string): string {
    if (!existsSync(this.memoryDir)) return "";

    const files = readdirSync(this.memoryDir)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .reverse(); // 新しい順

    if (files.length === 0) return "";

    // クエリを単語に分割（2文字以上）
    const keywords = query
      .toLowerCase()
      .split(/[\s、。！？,.!?\n]+/)
      .filter((w) => w.length >= 2);

    if (keywords.length === 0) return "";

    // 各ファイルのスコアを計算
    const scored = files.map((file) => {
      const content = readFileSync(join(this.memoryDir, file), "utf-8");
      const lower = content.toLowerCase();
      const score = keywords.filter((k) => lower.includes(k)).length;
      return { file, content, score };
    });

    // スコア上位3件を取得（最低1件一致）
    const relevant = scored
      .filter((f) => f.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    if (relevant.length === 0) return "";

    console.log(`[RAG] ${relevant.length}件のメモリが一致: ${relevant.map((f) => f.file).join(", ")}`);

    return [
      "<past_memories>",
      "以下は過去の会話から検索された関連メモリです:",
      ...relevant.map((f) => `\n### ${f.file}\n${f.content}`),
      "</past_memories>",
    ].join("\n");
  }

  /**
   * セッションデータをファイルから読み込む
   */
  private load(): void {
    if (!existsSync(this.persistPath)) return;
    try {
      const raw = readFileSync(this.persistPath, "utf-8");
      const data: PersistedData = JSON.parse(raw);
      this.sessions = new Map(Object.entries(data.sessions || {}));
      this.channelModels = new Map(Object.entries(data.channelModels || {}));
      this.workspaces = new Map(Object.entries(data.workspaces || {}));
      this.channelCategoryCache = new Map(Object.entries(data.channelCategoryCache || {}));
      // 会話履歴を復元（タイムスタンプをDateに変換）
      for (const [channelId, turns] of Object.entries(data.conversationHistory || {})) {
        this.conversationHistory.set(
          channelId,
          turns.map((t) => ({ ...t, timestamp: new Date(t.timestamp) }))
        );
      }
      console.log(`セッションデータを読み込みました（${this.sessions.size}件、履歴${this.conversationHistory.size}チャンネル）`);
    } catch {
      console.error("セッションデータの読み込みに失敗しました（新規作成します）");
    }
  }

  /**
   * セッションデータをファイルに保存する
   */
  private save(): void {
    try {
      const data: PersistedData = {
        sessions: Object.fromEntries(this.sessions),
        channelModels: Object.fromEntries(this.channelModels),
        workspaces: Object.fromEntries(this.workspaces),
        channelCategoryCache: Object.fromEntries(this.channelCategoryCache),
        // 会話履歴（タイムスタンプをISO文字列に変換して保存）
        conversationHistory: Object.fromEntries(
          Array.from(this.conversationHistory.entries()).map(([k, v]) => [
            k,
            v.map((t) => ({ ...t, timestamp: t.timestamp.toISOString() })),
          ])
        ),
      };
      writeFileSync(this.persistPath, JSON.stringify(data, null, 2), "utf-8");
    } catch {
      console.error("セッションデータの保存に失敗しました");
    }
  }

  /**
   * 追加システムプロンプトを取得する
   * system.md（性格・口調）と context.md（プロジェクト情報）を結合して返す
   * どちらも任意。なければ環境変数 SYSTEM_PROMPT にフォールバック
   */
  private getExtraSystemPrompt(): string {
    const parts: string[] = [];

    // ボットのルートから読み込む（WORKDIRのworkspaceフォルダとは別）
    const files: { path: string; label: string }[] = [
      { path: join(BOT_ROOT, "identify.md"), label: "性格・口調" },
      { path: join(BOT_ROOT, "context.md"), label: "プロジェクト情報" },
    ];

    for (const { path, label } of files) {
      if (existsSync(path)) {
        try {
          const content = readFileSync(path, "utf-8").trim();
          if (content) {
            parts.push(content);
            console.log(`[システムプロンプト] ${label}: ${path}`);
          }
        } catch {
          console.error(`${path} の読み込みに失敗しました`);
        }
      }
    }

    if (parts.length > 0) return parts.join("\n\n---\n\n");

    return process.env.SYSTEM_PROMPT || "";
  }

  // ========================================
  // ワークスペース管理
  // ========================================

  /**
   * ワークスペースを登録する
   */
  addWorkspace(config: WorkspaceConfig): void {
    this.workspaces.set(config.categoryId, config);
    this.save();
  }

  /**
   * ワークスペースを削除する
   */
  removeWorkspace(categoryId: string): boolean {
    const result = this.workspaces.delete(categoryId);
    this.save();
    return result;
  }

  /**
   * 全ワークスペースを取得する
   */
  getWorkspaces(): WorkspaceConfig[] {
    return Array.from(this.workspaces.values());
  }

  /**
   * カテゴリIDからワークスペースを取得する
   */
  getWorkspaceByCategoryId(categoryId: string): WorkspaceConfig | undefined {
    return this.workspaces.get(categoryId);
  }

  /**
   * チャンネルの親カテゴリIDを設定する（Discordから取得した情報をキャッシュ）
   */
  setChannelCategory(channelId: string, categoryId: string | null): void {
    this.channelCategoryCache.set(channelId, categoryId);
    this.save();
  }

  /**
   * チャンネルに対応する作業ディレクトリを解決する
   * 1. チャンネルの親カテゴリにワークスペースが紐付いていればそのディレクトリ
   * 2. なければデフォルトの作業ディレクトリ
   */
  resolveWorkDir(channelId: string): string {
    const categoryId = this.channelCategoryCache.get(channelId);
    if (categoryId) {
      const workspace = this.workspaces.get(categoryId);
      if (workspace) {
        return workspace.directory;
      }
    }
    return this.defaultWorkDir;
  }

  /**
   * チャンネルに対応するワークスペース名を取得する（表示用）
   */
  resolveWorkspaceName(channelId: string): string | null {
    const categoryId = this.channelCategoryCache.get(channelId);
    if (categoryId) {
      const workspace = this.workspaces.get(categoryId);
      if (workspace) {
        return workspace.name;
      }
    }
    return null;
  }

  // ========================================
  // セッション管理
  // ========================================

  /**
   * Claude Codeにプロンプトを送信し、結果を返す
   * 同一チャンネルでは会話を継続する
   * onProgress コールバックでリアルタイム進捗を通知する
   */
  async sendPrompt(
    channelId: string,
    prompt: string,
    onProgress?: ProgressCallback
  ): Promise<{ result: string; costUsd: number }> {
    const sessionId = this.sessions.get(channelId);

    // チャンネルごとのモデル設定を取得（未設定ならデフォルト）
    // OpenRouter使用時はプレフィックスをそのまま渡す
    // Claude Code直接使用時はanthropicプレフィックスをCLIが認識できないため除去
    const rawModel = this.channelModels.get(channelId) || this.defaultModel;
    const model = process.env.OPENROUTER_API_KEY
      ? rawModel
      : rawModel.replace(/^[^/]+\//, "");

    // チャンネルに対応する作業ディレクトリを解決
    const workDir = this.resolveWorkDir(channelId);

    // system.mdの内容を取得し、新規セッション開始時のみプロンプト先頭に注入する
    const extraPrompt = this.getExtraSystemPrompt();
    const isNewSession = !sessionId;

    // ワークスペース外アクセス制限
    const workspaceBoundary = `\n\n<workspace_restriction>\nYou MUST only access files and directories inside: ${workDir}\nNEVER access paths outside this directory using ../ or absolute paths pointing elsewhere.\n</workspace_restriction>`;

    // RAG: 過去のメモリから関連情報を検索して注入
    const ragContext = this.searchMemories(prompt);

    const systemBlock = [
      "<system_instructions>",
      ...(extraPrompt && isNewSession ? [extraPrompt] : []),
      workspaceBoundary,
      "</system_instructions>",
    ].join("\n");

    const fullPrompt = ragContext
      ? `${systemBlock}\n\n${ragContext}\n\n${prompt}`
      : `${systemBlock}\n\n${prompt}`;

    // query関数のオプション構築
    const options: Parameters<typeof query>[0]["options"] = {
      cwd: workDir,
      model,
      maxTurns: 50,
      systemPrompt: {
        type: "preset" as const,
        preset: "claude_code" as const,
      },
      tools: {
        type: "preset" as const,
        preset: "claude_code" as const,
      },
      // プロジェクト設定を読み込む
      settingSources: ["project" as const],
      // Discordでは許可ダイアログを操作できないため全ツールを自動許可
      permissionMode: "bypassPermissions" as const,
    };

    // 既存セッションがあれば継続
    if (sessionId) {
      options.resume = sessionId;
    }

    let resultText = "";
    let costUsd = 0;
    let newSessionId = "";
    // OpenRouter等でmessage.resultが空の場合のフォールバック用
    let lastAssistantText = "";

    // Agent SDKのストリームを処理
    for await (const message of query({ prompt: fullPrompt, options })) {
      // assistantメッセージのテキストをフォールバック用に蓄積
      if (message.type === "assistant") {
        const contents: any[] = (message.message as any)?.content || [];
        for (const c of contents) {
          if (c.type === "text" && c.text) {
            lastAssistantText += c.text;
          }
        }
      }

      // 進捗イベントをコールバックに通知
      this.handleProgressEvent(message, onProgress);

      if (message.type === "system" && message.subtype === "init") {
        // セッションIDを保存
        newSessionId = message.session_id;
      }

      if (message.type === "result") {
        costUsd = message.total_cost_usd;
        newSessionId = message.session_id;

        if (message.subtype === "success") {
          // OpenRouter等ではmessage.resultが空になる場合があるのでフォールバック
          // SDKのmessage.resultは現バージョンでは常に空のため、lastAssistantTextをフォールバックとして使用
          resultText = message.result || lastAssistantText;
          // 会話履歴に記録（RAG用）
          const history = this.conversationHistory.get(channelId) || [];
          history.push({
            timestamp: new Date(),
            userPrompt: prompt,
            assistantResponse: resultText,
          });
          this.conversationHistory.set(channelId, history);
        } else if (message.subtype === "error_max_turns") {
          // ターン上限に達した場合、途中の回答があれば表示する
          const partial = "result" in message && message.result ? message.result : "";
          resultText = partial
            ? `${partial}\n\n⚠️ ターン上限に達しました。続きは改めて質問してください。`
            : "⚠️ 処理が長くなりすぎました。より具体的な質問に分割してお試しください。";
        } else if (message.subtype === "error_context_window_exceeded") {
          // コンテキスト上限に達した場合は会話履歴を保存してセッションをリセット
          const savedFile = this.saveMemory(channelId);
          this.sessions.delete(channelId);
          this.conversationHistory.delete(channelId);
          this.save();
          const memoryNote = savedFile
            ? `\n💾 会話履歴を \`${savedFile}\` に保存しました。`
            : "";
          resultText = `⚠️ 会話が長くなりすぎてコンテキスト上限に達しました。\nセッションをリセットしました。もう一度質問してください。${memoryNote}`;
        } else {
          // その他のエラー
          resultText = `エラーが発生しました: ${message.subtype}`;
          if ("errors" in message && message.errors.length > 0) {
            resultText += `\n${message.errors.join("\n")}`;
          }
        }
      }
    }

    // セッションIDを更新して永続化
    if (newSessionId) {
      this.sessions.set(channelId, newSessionId);
      this.save();
    }

    return { result: resultText, costUsd };
  }

  /**
   * ストリームイベントから進捗情報を抽出してコールバックに通知する
   */
  private handleProgressEvent(
    message: SDKMessage,
    onProgress?: ProgressCallback
  ): void {
    if (!onProgress) return;

    // Claudeのテキスト出力とツール呼び出しをキャプチャ
    if (message.type === "assistant") {
      const contents: any[] = message.message?.content || [];
      for (const c of contents) {
        if (c.type === "text" && c.text) {
          onProgress({ type: "assistant_text", text: c.text });
        }
        if (c.type === "tool_use") {
          onProgress({
            type: "tool_call",
            toolName: c.name,
            input: c.input || {},
          });
        }
      }
    }

    // ツール実行結果をキャプチャ
    if (message.type === "tool_result") {
      const contents: any[] = message.content || [];
      const output = contents
        .filter((c: any) => c.type === "text")
        .map((c: any) => c.text)
        .join("\n");
      onProgress({
        type: "tool_result",
        toolName: message.tool_use_id || "",
        output: output.slice(0, 500),
        isError: message.is_error || false,
      });
    }

    // ツール実行中の進捗（例: Bashコマンド実行中, ファイル読み込み中）
    if (message.type === "tool_progress") {
      onProgress({
        type: "tool_progress",
        toolName: message.tool_name,
        elapsedSeconds: message.elapsed_time_seconds,
      });
    }

    // ツール実行後のサマリー（例: 「ファイルを3つ読みました」）
    if (message.type === "tool_use_summary") {
      onProgress({
        type: "tool_summary",
        summary: message.summary,
      });
    }

    // サブタスク開始
    if (
      message.type === "system" &&
      message.subtype === "task_started"
    ) {
      onProgress({
        type: "task_started",
        description: message.description,
      });
    }

    // サブタスク完了
    if (
      message.type === "system" &&
      message.subtype === "task_notification"
    ) {
      onProgress({
        type: "task_completed",
        summary: message.summary,
        status: message.status,
      });
    }
  }

  /**
   * チャンネルのセッションをクリアする
   * 会話履歴があればメモリに保存してから削除する
   */
  clearSession(channelId: string): { cleared: boolean; savedFile: string | null } {
    const savedFile = this.saveMemory(channelId);
    const cleared = this.sessions.delete(channelId);
    this.conversationHistory.delete(channelId);
    this.save();
    return { cleared, savedFile };
  }

  /**
   * チャンネルのモデルを変更する
   * セッションはそのまま継続（コンテキストを維持しつつモデルだけ切り替え）
   */
  setModel(channelId: string, model: string): void {
    this.channelModels.set(channelId, model);
    this.save();
  }

  /**
   * チャンネルで使用中のモデル名を取得する
   */
  getModel(channelId: string): string {
    return this.channelModels.get(channelId) || this.defaultModel;
  }

  /**
   * 全セッションをクリアする
   */
  clearAllSessions(): void {
    this.sessions.clear();
    this.channelModels.clear();
  }

  /**
   * チャンネルにアクティブなセッションがあるか確認
   */
  hasSession(channelId: string): boolean {
    return this.sessions.has(channelId);
  }
}
