import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { createHash } from "crypto";
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
  /**
   * AIを使って会話テキストを要約する。
   * OpenRouter利用時はOpenRouter API、それ以外はAnthropic Messages APIを使用。
   * 失敗した場合は null を返す（呼び出し元が生データにフォールバック）。
   */
  private async summarizeWithAI(conversationText: string): Promise<string | null> {
    // summary_rule.md があればその内容を要約ルールとして使用する
    const summaryRulePath = join(BOT_ROOT, "summary_rule.md");
    const summaryRule = existsSync(summaryRulePath)
      ? readFileSync(summaryRulePath, "utf-8").trim()
      : null;

    const prompt = summaryRule
      ? `以下のルールに従って、会話履歴を要約してください。\n\n${summaryRule}\n\n---\n\n以下が会話履歴です:\n\n${conversationText}`
      : `以下の会話履歴を日本語で要約してください。\n重要な情報・決定事項・未解決の課題を保持しつつ簡潔にまとめてください。\n\n${conversationText}`;

    try {
      if (process.env.OPENROUTER_API_KEY) {
        // OpenRouter経由（.envのMODELをそのまま使用）
        const model = this.defaultModel;
        const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: prompt }],
            max_tokens: 1024,
          }),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "(読み取れず)");
          console.error(`[メモリ] OpenRouter要約API失敗: HTTP ${res.status} — ${body}`);
          return null;
        }
        const data = await res.json() as any;
        return data.choices?.[0]?.message?.content || null;
      } else {
        // Anthropic Messages API（CLIセッショントークンまたはAPIキー）
        const token = process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY;
        if (!token) {
          console.error("[メモリ] 要約失敗: APIキーが見つかりません");
          return null;
        }
        // Anthropic直接の場合はプレフィックス（anthropic/等）を除去
        const model = this.defaultModel.replace(/^[^/]+\//, "");
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": token,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            max_tokens: 1024,
            messages: [{ role: "user", content: prompt }],
          }),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "(読み取れず)");
          console.error(`[メモリ] Anthropic要約API失敗: HTTP ${res.status} — ${body}`);
          return null;
        }
        const data = await res.json() as any;
        return data.content?.[0]?.text || null;
      }
    } catch (err) {
      console.error("[メモリ] 要約中に例外:", err);
      return null;
    }
  }

  async saveMemory(channelId: string): Promise<string | null> {
    const history = this.conversationHistory.get(channelId);
    if (!history || history.length === 0) return null;

    if (!existsSync(this.memoryDir)) {
      mkdirSync(this.memoryDir, { recursive: true });
    }

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const filename = `memory_${now.getFullYear()}_${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}.md`;
    const filePath = join(this.memoryDir, filename);

    // 会話テキストを構築
    const conversationText = history.map((t) =>
      `[${t.timestamp.toLocaleString("ja-JP")}]\nユーザー: ${t.userPrompt}\nアシスタント: ${t.assistantResponse}`
    ).join("\n\n---\n\n");

    // AI要約を生成
    console.log(`[メモリ] AI要約を生成中... (${history.length}ターン)`);
    const summary = await this.summarizeWithAI(conversationText);
    if (summary) {
      console.log("[メモリ] AI要約: 成功");
    } else {
      console.warn("[メモリ] AI要約: 失敗（生データで保存）");
    }

    // 要約成功時は要約のみ保存。失敗時のみ生の会話履歴をフォールバックとして保存。
    const lines = summary
      ? [
          `# 会話メモリ ${now.toLocaleString("ja-JP")}`,
          "",
          summary,
        ]
      : [
          `# 会話メモリ ${now.toLocaleString("ja-JP")}`,
          "",
          ...history.flatMap((turn) => [
            `### ${turn.timestamp.toLocaleString("ja-JP")}`,
            "",
            `**ユーザー**: ${turn.userPrompt}`,
            "",
            `**アシスタント**: ${turn.assistantResponse}`,
            "",
          ]),
        ];

    writeFileSync(filePath, lines.join("\n"), "utf-8");
    console.log(`[メモリ] 保存: ${filename} (${history.length}ターン, AI要約: ${summary ? "あり" : "なし"})`);
    return filename;
  }

  // ========================================
  // ベクトル検索（RAG）
  // ========================================

  /** エンベディングキャッシュの保存先 */
  private get embeddingsPath(): string {
    return join(this.memoryDir, ".embeddings.json");
  }

  /** エンベディングキャッシュを読み込む */
  private loadEmbeddingsCache(): Record<string, { hash: string; vector: number[] }> {
    if (!existsSync(this.embeddingsPath)) return {};
    try {
      return JSON.parse(readFileSync(this.embeddingsPath, "utf-8"));
    } catch {
      return {};
    }
  }

  /** エンベディングキャッシュを保存する */
  private saveEmbeddingsCache(cache: Record<string, { hash: string; vector: number[] }>): void {
    try {
      writeFileSync(this.embeddingsPath, JSON.stringify(cache), "utf-8");
    } catch {
      // キャッシュ保存失敗は無視（次回再計算するだけ）
    }
  }

  /** テキストのMD5ハッシュを計算する（キャッシュ無効化用） */
  private hashContent(content: string): string {
    return createHash("md5").update(content).digest("hex");
  }

  /**
   * テキストをベクトルに変換する（OpenAI互換 Embedding API）
   * EMBEDDING_API_KEY が未設定の場合は null を返す
   */
  private async embedText(text: string): Promise<number[] | null> {
    const apiKey = process.env.EMBEDDING_API_KEY;
    if (!apiKey) return null;

    const baseUrl = (process.env.EMBEDDING_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
    const model = process.env.EMBEDDING_MODEL || "text-embedding-3-small";

    try {
      const res = await fetch(`${baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ input: text, model }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.error(`[RAG] Embedding API失敗: HTTP ${res.status} — ${body}`);
        return null;
      }
      const data = await res.json() as any;
      return data.data?.[0]?.embedding || null;
    } catch (err) {
      console.error("[RAG] Embedding API例外:", err);
      return null;
    }
  }

  /** コサイン類似度を計算する（-1〜1、高いほど類似） */
  private cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }

  /**
   * ユーザーのクエリに関連するメモリファイルを検索して返す。
   * EMBEDDING_API_KEY が設定されていればベクトル検索、未設定ならキーワード検索にフォールバック。
   */
  private async searchMemories(query: string): Promise<string> {
    if (!existsSync(this.memoryDir)) return "";

    // memory_*.md のみ対象（CLAUDE.md 等は除外）
    const files = readdirSync(this.memoryDir)
      .filter((f) => /^memory_.*\.md$/.test(f))
      .sort()
      .reverse(); // 新しい順

    if (files.length === 0) return "";

    // ── ベクトル検索 ─────────────────────────────────────────
    const queryVector = await this.embedText(query.slice(0, 1000));

    if (queryVector) {
      const cache = this.loadEmbeddingsCache();
      let cacheUpdated = false;

      // 各メモリファイルのエンベディングを計算/キャッシュ更新
      for (const file of files) {
        const filePath = join(this.memoryDir, file);
        const content = readFileSync(filePath, "utf-8");
        const hash = this.hashContent(content);

        if (!cache[file] || cache[file].hash !== hash) {
          const vector = await this.embedText(content.slice(0, 4000));
          if (vector) {
            cache[file] = { hash, vector };
            cacheUpdated = true;
          }
        }
      }

      if (cacheUpdated) this.saveEmbeddingsCache(cache);

      // コサイン類似度でランキング（上位3件、閾値0.5以上）
      const MIN_SIMILARITY = 0.5;
      const scored = files
        .filter((f) => cache[f]?.vector)
        .map((file) => ({
          file,
          content: readFileSync(join(this.memoryDir, file), "utf-8"),
          similarity: this.cosineSimilarity(queryVector, cache[file].vector),
        }))
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 3)
        .filter((f) => f.similarity >= MIN_SIMILARITY);

      if (scored.length === 0) return "";

      console.log(`[RAG] ベクトル検索: ${scored.length}件 (類似度: ${scored.map((f) => f.similarity.toFixed(2)).join(", ")})`);

      return [
        "<past_memories>",
        "以下は過去の会話から検索された関連メモリです:",
        ...scored.map((f) => `\n### ${f.file}\n${f.content}`),
        "</past_memories>",
      ].join("\n");
    }

    // ── キーワード検索（フォールバック） ──────────────────────
    const keywords = query
      .toLowerCase()
      .split(/[\s、。！？,.!?\n]+/)
      .filter((w) => w.length >= 2);

    if (keywords.length === 0) return "";

    const scored = files.map((file) => {
      const content = readFileSync(join(this.memoryDir, file), "utf-8");
      const lower = content.toLowerCase();
      const score = keywords.filter((k) => lower.includes(k)).length;
      return { file, content, score };
    });

    const relevant = scored
      .filter((f) => f.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    if (relevant.length === 0) return "";

    console.log(`[RAG] キーワード検索: ${relevant.length}件 (${relevant.map((f) => f.file).join(", ")})`);

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

    // RAG: 過去のメモリから関連情報を検索して注入（ベクトル/キーワード自動切替）
    const ragContext = await this.searchMemories(prompt);

    // このシステムの制約: 1ユーザーメッセージにつき1返信のみ送れる。
    // 「確認するね」などの宣言だけで返信を終わらせず、
    // 確認・調査した結果も必ず同じ返信内に含めること。
    const responseConstraint =
      "<reply_constraint>\n" +
      "このDiscordボットは1メッセージにつき1回しか返信できません。\n" +
      "「確認するね」「調べるね」などの確認後の結果も、必ず同じ返信の中に含めてください。\n" +
      "宣言だけして終わるのではなく、宣言＋結果を1つの返信にまとめること。\n" +
      "</reply_constraint>";

    const systemBlock = [
      "<system_instructions>",
      ...(extraPrompt && isNewSession ? [extraPrompt] : []),
      workspaceBoundary,
      responseConstraint,
      "</system_instructions>",
    ].join("\n");

    const fullPrompt = ragContext
      ? `${systemBlock}\n\n${ragContext}\n\n${prompt}`
      : `${systemBlock}\n\n${prompt}`;

    // コンテキストサイズをコンソールに出力
    const promptChars = fullPrompt.length;
    const ragChars = ragContext ? ragContext.length : 0;
    console.log(
      `[Context] プロンプト: ${promptChars.toLocaleString()}文字` +
      (ragChars > 0 ? ` (RAG: ${ragChars.toLocaleString()}文字含む)` : "") +
      (sessionId ? " | セッション継続中" : " | 新規セッション")
    );

    // query関数のオプション構築
    const options: Parameters<typeof query>[0]["options"] = {
      cwd: workDir,
      model,
      maxTurns: 50,
      // 拡張思考（extended thinking）を無効化する
      // 有効のままだとAIが回答をthinkingブロック内に格納し、
      // 可視テキストとして出力されなくなる問題が発生するため
      thinking: { type: "disabled" as const },
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

      // コンテキスト圧縮直前にメモリを保存する
      if (
        message.type === "system" &&
        (message as any).subtype === "status" &&
        (message as any).status === "compacting"
      ) {
        console.log("[Compact] コンテキスト圧縮を検出。メモリに保存します...");
        const savedFile = await this.saveMemory(channelId);
        if (savedFile) {
          console.log(`[Compact] 保存完了: ${savedFile}`);
        }
      }

      if (message.type === "result") {
        costUsd = message.total_cost_usd;
        newSessionId = message.session_id;

        // 実トークン数をコンソールに出力
        const usage = (message as any).usage;
        if (usage) {
          const inputTokens: number = usage.input_tokens ?? 0;
          const outputTokens: number = usage.output_tokens ?? 0;
          const cacheRead: number = usage.cache_read_input_tokens ?? 0;
          const cacheCreate: number = usage.cache_creation_input_tokens ?? 0;
          let tokenLog = `[Token] input=${inputTokens.toLocaleString()} output=${outputTokens.toLocaleString()} total=${(inputTokens + outputTokens).toLocaleString()}`;
          if (cacheRead > 0 || cacheCreate > 0) {
            tokenLog += ` (cache_read=${cacheRead.toLocaleString()} cache_write=${cacheCreate.toLocaleString()})`;
          }
          console.log(tokenLog);
        }

        if (message.subtype === "success") {
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
          const savedFile = await this.saveMemory(channelId);
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
  async clearSession(channelId: string): Promise<{ cleared: boolean; savedFile: string | null }> {
    const savedFile = await this.saveMemory(channelId);
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
