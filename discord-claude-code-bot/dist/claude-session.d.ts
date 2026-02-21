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
    type: "assistant_text";
    text: string;
} | {
    type: "tool_call";
    toolName: string;
    input: Record<string, unknown>;
} | {
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
/**
 * チャンネルごとのClaude Codeセッションを管理するクラス
 * セッションIDを保持し、会話の継続を可能にする
 * ワークスペース単位でのルーティングもサポート
 */
export declare class ClaudeSessionManager {
    private sessions;
    private channelModels;
    private workspaces;
    private channelCategoryCache;
    private defaultWorkDir;
    private defaultModel;
    private persistPath;
    constructor(workDir: string, defaultModel: string);
    /**
     * セッションデータをファイルから読み込む
     */
    private load;
    /**
     * セッションデータをファイルに保存する
     */
    private save;
    /**
     * 追加システムプロンプトを取得する
     * system.md（性格・口調）と context.md（プロジェクト情報）を結合して返す
     * どちらも任意。なければ環境変数 SYSTEM_PROMPT にフォールバック
     */
    private getExtraSystemPrompt;
    /**
     * ワークスペースを登録する
     */
    addWorkspace(config: WorkspaceConfig): void;
    /**
     * ワークスペースを削除する
     */
    removeWorkspace(categoryId: string): boolean;
    /**
     * 全ワークスペースを取得する
     */
    getWorkspaces(): WorkspaceConfig[];
    /**
     * カテゴリIDからワークスペースを取得する
     */
    getWorkspaceByCategoryId(categoryId: string): WorkspaceConfig | undefined;
    /**
     * チャンネルの親カテゴリIDを設定する（Discordから取得した情報をキャッシュ）
     */
    setChannelCategory(channelId: string, categoryId: string | null): void;
    /**
     * チャンネルに対応する作業ディレクトリを解決する
     * 1. チャンネルの親カテゴリにワークスペースが紐付いていればそのディレクトリ
     * 2. なければデフォルトの作業ディレクトリ
     */
    resolveWorkDir(channelId: string): string;
    /**
     * チャンネルに対応するワークスペース名を取得する（表示用）
     */
    resolveWorkspaceName(channelId: string): string | null;
    /**
     * Claude Codeにプロンプトを送信し、結果を返す
     * 同一チャンネルでは会話を継続する
     * onProgress コールバックでリアルタイム進捗を通知する
     */
    sendPrompt(channelId: string, prompt: string, onProgress?: ProgressCallback): Promise<{
        result: string;
        costUsd: number;
    }>;
    /**
     * ストリームイベントから進捗情報を抽出してコールバックに通知する
     */
    private handleProgressEvent;
    /**
     * チャンネルのセッションをクリアする
     */
    clearSession(channelId: string): boolean;
    /**
     * チャンネルのモデルを変更する
     * セッションもクリアして新しいモデルで再開する
     */
    setModel(channelId: string, model: string): void;
    /**
     * チャンネルで使用中のモデル名を取得する
     */
    getModel(channelId: string): string;
    /**
     * 全セッションをクリアする
     */
    clearAllSessions(): void;
    /**
     * チャンネルにアクティブなセッションがあるか確認
     */
    hasSession(channelId: string): boolean;
}
