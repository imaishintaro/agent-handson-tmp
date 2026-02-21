import { query } from "@anthropic-ai/claude-agent-sdk";

/**
 * チャンネルごとのClaude Codeセッションを管理するクラス
 * セッションIDを保持し、会話の継続を可能にする
 */
export class ClaudeSessionManager {
  // チャンネルID → セッションIDのマップ
  private sessions: Map<string, string> = new Map();
  private workDir: string;
  private model: string;

  constructor(workDir: string, model: string) {
    this.workDir = workDir;
    this.model = model;
  }

  /**
   * Claude Codeにプロンプトを送信し、結果を返す
   * 同一チャンネルでは会話を継続する
   */
  async sendPrompt(
    channelId: string,
    prompt: string
  ): Promise<{ result: string; costUsd: number }> {
    const sessionId = this.sessions.get(channelId);

    // query関数のオプション構築
    const options: Parameters<typeof query>[0]["options"] = {
      cwd: this.workDir,
      model: this.model,
      maxTurns: 10,
      // Claude Codeのシステムプロンプトとツールを使用
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
      // ファイル編集は自動許可（Discordでの承認UIが難しいため）
      permissionMode: "acceptEdits" as const,
    };

    // 既存セッションがあれば継続
    if (sessionId) {
      options.resume = sessionId;
    }

    let resultText = "";
    let costUsd = 0;
    let newSessionId = "";

    // Agent SDKのストリームを処理
    for await (const message of query({ prompt, options })) {
      if (message.type === "system" && message.subtype === "init") {
        // セッションIDを保存
        newSessionId = message.session_id;
      }

      if (message.type === "result") {
        if (message.subtype === "success") {
          resultText = message.result;
          costUsd = message.total_cost_usd;
        } else {
          // エラー時
          resultText = `エラーが発生しました: ${message.subtype}`;
          if ("errors" in message && message.errors.length > 0) {
            resultText += `\n${message.errors.join("\n")}`;
          }
          costUsd = message.total_cost_usd;
        }
        newSessionId = message.session_id;
      }
    }

    // セッションIDを更新
    if (newSessionId) {
      this.sessions.set(channelId, newSessionId);
    }

    return { result: resultText, costUsd };
  }

  /**
   * チャンネルのセッションをクリアする
   */
  clearSession(channelId: string): boolean {
    return this.sessions.delete(channelId);
  }

  /**
   * 全セッションをクリアする
   */
  clearAllSessions(): void {
    this.sessions.clear();
  }

  /**
   * チャンネルにアクティブなセッションがあるか確認
   */
  hasSession(channelId: string): boolean {
    return this.sessions.has(channelId);
  }
}
