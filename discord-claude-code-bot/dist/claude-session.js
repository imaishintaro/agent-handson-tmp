"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClaudeSessionManager = void 0;
const claude_agent_sdk_1 = require("@anthropic-ai/claude-agent-sdk");
const fs_1 = require("fs");
const path_1 = require("path");
// ボット本体のルートディレクトリ（identify.md / context.md の置き場所）
// dist/ の一つ上がプロジェクトルート
const BOT_ROOT = (0, path_1.join)(__dirname, "..");
/**
 * チャンネルごとのClaude Codeセッションを管理するクラス
 * セッションIDを保持し、会話の継続を可能にする
 * ワークスペース単位でのルーティングもサポート
 */
class ClaudeSessionManager {
    // チャンネルID → セッションIDのマップ
    sessions = new Map();
    // チャンネルID → モデル名のマップ（チャンネルごとのモデル設定）
    channelModels = new Map();
    // ワークスペース一覧（カテゴリID → ワークスペース設定）
    workspaces = new Map();
    // チャンネルID → カテゴリID のキャッシュ（ルーティング高速化）
    channelCategoryCache = new Map();
    defaultWorkDir;
    defaultModel;
    // セッションデータの保存先ファイルパス
    persistPath;
    constructor(workDir, defaultModel) {
        this.defaultWorkDir = workDir;
        this.defaultModel = defaultModel;
        this.persistPath = (0, path_1.join)(workDir, ".sessions.json");
        this.load();
    }
    /**
     * セッションデータをファイルから読み込む
     */
    load() {
        if (!(0, fs_1.existsSync)(this.persistPath))
            return;
        try {
            const raw = (0, fs_1.readFileSync)(this.persistPath, "utf-8");
            const data = JSON.parse(raw);
            this.sessions = new Map(Object.entries(data.sessions || {}));
            this.channelModels = new Map(Object.entries(data.channelModels || {}));
            this.workspaces = new Map(Object.entries(data.workspaces || {}));
            this.channelCategoryCache = new Map(Object.entries(data.channelCategoryCache || {}));
            console.log(`セッションデータを読み込みました（${this.sessions.size}件）`);
        }
        catch {
            console.error("セッションデータの読み込みに失敗しました（新規作成します）");
        }
    }
    /**
     * セッションデータをファイルに保存する
     */
    save() {
        try {
            const data = {
                sessions: Object.fromEntries(this.sessions),
                channelModels: Object.fromEntries(this.channelModels),
                workspaces: Object.fromEntries(this.workspaces),
                channelCategoryCache: Object.fromEntries(this.channelCategoryCache),
            };
            (0, fs_1.writeFileSync)(this.persistPath, JSON.stringify(data, null, 2), "utf-8");
        }
        catch {
            console.error("セッションデータの保存に失敗しました");
        }
    }
    /**
     * 追加システムプロンプトを取得する
     * system.md（性格・口調）と context.md（プロジェクト情報）を結合して返す
     * どちらも任意。なければ環境変数 SYSTEM_PROMPT にフォールバック
     */
    getExtraSystemPrompt() {
        const parts = [];
        // ボットのルートから読み込む（WORKDIRのworkspaceフォルダとは別）
        const files = [
            { path: (0, path_1.join)(BOT_ROOT, "identify.md"), label: "性格・口調" },
            { path: (0, path_1.join)(BOT_ROOT, "context.md"), label: "プロジェクト情報" },
        ];
        for (const { path, label } of files) {
            if ((0, fs_1.existsSync)(path)) {
                try {
                    const content = (0, fs_1.readFileSync)(path, "utf-8").trim();
                    if (content) {
                        parts.push(content);
                        console.log(`[システムプロンプト] ${label}: ${path}`);
                    }
                }
                catch {
                    console.error(`${path} の読み込みに失敗しました`);
                }
            }
        }
        if (parts.length > 0)
            return parts.join("\n\n---\n\n");
        return process.env.SYSTEM_PROMPT || "";
    }
    // ========================================
    // ワークスペース管理
    // ========================================
    /**
     * ワークスペースを登録する
     */
    addWorkspace(config) {
        this.workspaces.set(config.categoryId, config);
        this.save();
    }
    /**
     * ワークスペースを削除する
     */
    removeWorkspace(categoryId) {
        const result = this.workspaces.delete(categoryId);
        this.save();
        return result;
    }
    /**
     * 全ワークスペースを取得する
     */
    getWorkspaces() {
        return Array.from(this.workspaces.values());
    }
    /**
     * カテゴリIDからワークスペースを取得する
     */
    getWorkspaceByCategoryId(categoryId) {
        return this.workspaces.get(categoryId);
    }
    /**
     * チャンネルの親カテゴリIDを設定する（Discordから取得した情報をキャッシュ）
     */
    setChannelCategory(channelId, categoryId) {
        this.channelCategoryCache.set(channelId, categoryId);
        this.save();
    }
    /**
     * チャンネルに対応する作業ディレクトリを解決する
     * 1. チャンネルの親カテゴリにワークスペースが紐付いていればそのディレクトリ
     * 2. なければデフォルトの作業ディレクトリ
     */
    resolveWorkDir(channelId) {
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
    resolveWorkspaceName(channelId) {
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
    async sendPrompt(channelId, prompt, onProgress) {
        const sessionId = this.sessions.get(channelId);
        // チャンネルごとのモデル設定を取得（未設定ならデフォルト）
        const model = this.channelModels.get(channelId) || this.defaultModel;
        // チャンネルに対応する作業ディレクトリを解決
        const workDir = this.resolveWorkDir(channelId);
        // system.mdの内容を取得し、新規セッション開始時のみプロンプト先頭に注入する
        // （appendSystemPromptはClaude Codeプリセットに上書きされるため、直接注入する）
        const extraPrompt = this.getExtraSystemPrompt();
        const isNewSession = !sessionId;
        // ワークスペース外アクセス制限の指示を常に付加する
        const workspaceBoundary = `\n\n<workspace_restriction>\nYou MUST only access files and directories inside: ${workDir}\nNEVER access paths outside this directory using ../ or absolute paths pointing elsewhere.\n</workspace_restriction>`;
        const fullPrompt = (extraPrompt && isNewSession)
            ? `<system_instructions>\n${extraPrompt}${workspaceBoundary}\n</system_instructions>\n\n${prompt}`
            : `<system_instructions>${workspaceBoundary}\n</system_instructions>\n\n${prompt}`;
        // query関数のオプション構築
        const options = {
            cwd: workDir,
            model,
            maxTurns: 50,
            systemPrompt: {
                type: "preset",
                preset: "claude_code",
            },
            tools: {
                type: "preset",
                preset: "claude_code",
            },
            // プロジェクト設定を読み込む
            settingSources: ["project"],
            // ファイル編集は自動許可（Discordでの承認UIが難しいため）
            permissionMode: "acceptEdits",
        };
        // 既存セッションがあれば継続
        if (sessionId) {
            options.resume = sessionId;
        }
        let resultText = "";
        let costUsd = 0;
        let newSessionId = "";
        // Agent SDKのストリームを処理
        for await (const message of (0, claude_agent_sdk_1.query)({ prompt: fullPrompt, options })) {
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
                    resultText = message.result;
                }
                else if (message.subtype === "error_max_turns") {
                    // ターン上限に達した場合、途中の回答があれば表示する
                    const partial = "result" in message && message.result ? message.result : "";
                    resultText = partial
                        ? `${partial}\n\n⚠️ ターン上限に達しました。続きは改めて質問してください。`
                        : "⚠️ 処理が長くなりすぎました。より具体的な質問に分割してお試しください。";
                }
                else {
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
    handleProgressEvent(message, onProgress) {
        if (!onProgress)
            return;
        // Claudeのテキスト出力とツール呼び出しをキャプチャ
        if (message.type === "assistant") {
            const contents = message.message?.content || [];
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
            const contents = message.content || [];
            const output = contents
                .filter((c) => c.type === "text")
                .map((c) => c.text)
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
        if (message.type === "system" &&
            message.subtype === "task_started") {
            onProgress({
                type: "task_started",
                description: message.description,
            });
        }
        // サブタスク完了
        if (message.type === "system" &&
            message.subtype === "task_notification") {
            onProgress({
                type: "task_completed",
                summary: message.summary,
                status: message.status,
            });
        }
    }
    /**
     * チャンネルのセッションをクリアする
     */
    clearSession(channelId) {
        const result = this.sessions.delete(channelId);
        this.save();
        return result;
    }
    /**
     * チャンネルのモデルを変更する
     * セッションもクリアして新しいモデルで再開する
     */
    setModel(channelId, model) {
        this.channelModels.set(channelId, model);
        // モデル変更時はセッションをリセット（新モデルで開始するため）
        this.sessions.delete(channelId);
        this.save();
    }
    /**
     * チャンネルで使用中のモデル名を取得する
     */
    getModel(channelId) {
        return this.channelModels.get(channelId) || this.defaultModel;
    }
    /**
     * 全セッションをクリアする
     */
    clearAllSessions() {
        this.sessions.clear();
        this.channelModels.clear();
    }
    /**
     * チャンネルにアクティブなセッションがあるか確認
     */
    hasSession(channelId) {
        return this.sessions.has(channelId);
    }
}
exports.ClaudeSessionManager = ClaudeSessionManager;
