# Cron スケジューラー

`crontab.yaml` を編集することで、AIへの定期/単発指示を設定できます。
ファイルを保存するとボットが自動で再読み込みします（再起動不要）。

---

## ジョブの種類

### 🔄 繰り返しジョブ（type: repeat）

指定した曜日・時刻に繰り返し実行されます。

```yaml
- id: daily-report
  description: 毎日の日報
  type: repeat
  schedule:
    time: "18:00"    # 実行時刻（HH:MM）
    days: 平日        # 曜日指定（下記参照）
  channel_id: "1234567890"
  prompt: |
    今日の作業をまとめてください。
  enabled: true
```

**daysの書き方:**

| 書き方         | 意味                    |
|--------------|-------------------------|
| `毎日`        | 毎日                    |
| `平日`        | 月〜金                  |
| `週末`        | 土・日                  |
| `月`          | 毎週月曜                |
| `月,水,金`    | 月・水・金              |
| `月・水・金`   | 月・水・金（全角区切りも可） |

**毎月N日に実行したい場合:**

```yaml
schedule:
  time: "10:00"
  month_day: 1    # 毎月1日（daysより優先）
```

---

### 📅 単発ジョブ（type: once）

指定した日時に1回だけ実行されます。
実行後は `completed_once.json` に記録され、再実行されません。

```yaml
- id: meeting-reminder
  description: 会議リマインダー
  type: once
  schedule:
    datetime: "2026-03-15 09:00"    # YYYY-MM-DD HH:MM
  channel_id: "1234567890"
  prompt: |
    10時から会議があります。アジェンダを確認してください。
  enabled: true
```

---

## 共通設定項目

| フィールド      | 説明                                        |
|--------------|---------------------------------------------|
| `id`         | ジョブのユニークなID（半角英数字・ハイフン推奨） |
| `description`| ジョブの説明（Discordに表示される）           |
| `type`       | `repeat`（繰り返し）または `once`（単発）    |
| `channel_id` | 送信先DiscordチャンネルID                    |
| `prompt`     | AIへの指示（`|` を使うと複数行で書ける）      |
| `enabled`    | `true` で有効、`false` で無効               |

---

## チャンネルIDの確認

Discordで `/cron-id` コマンドを実行するとIDが表示されます。

---

## スラッシュコマンド

| コマンド          | 説明                              |
|-----------------|-----------------------------------|
| `/cron-list`    | 登録済みジョブの一覧を表示           |
| `/cron-reload`  | crontab.yaml を手動で再読み込み     |
| `/cron-id`      | 現在のチャンネルIDを表示            |
