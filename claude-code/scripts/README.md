# Claude Code ログの Turso 送信（手動 store-and-forward / sh 版）

Claude Code のセッションログは hook (`../hooks/save-transcript.ts`) が**ローカル SQLite に
追記するだけ**で、ネットワークも認証トークンも使いません。Turso への送信は、ユーザーが任意の
タイミングで `push-to-turso.sh` を**手で実行**する独立スクリプトに分離しています。

## なぜ手動分離なのか（セキュリティ方針）

hook も Claude の Bash も**同一ユーザー・同一プロセスツリー**で動くため、hook 側でトークンを
扱うと Claude の実行文脈にトークンが露出します。バイナリ化やシェル変数でもこの「同一プリンシパル」
問題は解消できません。そこで:

- **トークンを Claude Code のプロセスツリーに一切乗せない。** 送信はユーザーが自分のシェルで手動実行する。
- このスクリプトは認証に **`turso` CLI のセッション（`turso auth login`）** を使う。
  トークンを env / ファイル / keychain から読み込まないので、**トークンが env を経由すらしない**。
- トークン・URL の実値は**コード/設定/リポジトリに一切置かない**。
- 単一ユーザー Mac では「同一ユーザーの全プロセスが CLI 認証セッションにアクセスできる」という
  OS 的制約は残る。本構成の達成目標は **「AI（Claude）にトークンを渡さない」**こと。

> 以前 keychain に登録した `turso-cc-url` / `turso-cc-token` は、この sh 版では**使いません**
> （CLI 認証を使うため）。残置しても、不要なら削除しても構いません。

## 必要なもの

- `turso` CLI（`turso auth login` 済み）
- `sqlite3`

## セットアップ（すべてユーザーが実行。Claude は実行しません）

```bash
# 1. ログイン（未ログインなら）
turso auth login

# 2. DB 作成（初回のみ）
turso db create cc-logs
turso db show cc-logs --url        # 接続先の確認（任意）
# トークンは CLI セッションが扱うため、本スクリプト用に db tokens create は不要。
```

DB 名を変えたい場合は環境変数 `TURSO_DB_NAME` で上書きできます（既定 `cc-logs`）。

## 普段の挙動

- セッション終了時、hook がローカル `~/.local/share/claude-logs/logs.db` に追記するだけ。
- トークン・ネットワークは使わない。Claude の文脈にトークンは載らない。

## 送信手順（ユーザーが手動実行）

```bash
# まずは安全側：送信＋件数照合のみ。ローカルは削除しない
bash claude-code/scripts/push-to-turso.sh --keep-local

# 問題なければ本番：送信→照合OKならローカルの送信済み行を物理削除し、VACUUM で容量回収
bash claude-code/scripts/push-to-turso.sh
```

### スクリプトの動作

1. ローカル DB の **WAL 整合スナップショット**を取得（`.backup`）。hook の追記とレースしない。
2. Turso にスキーマを用意（`CREATE TABLE IF NOT EXISTS`、ローカルと同一カラム）。
3. スナップショットの全行を `INSERT OR IGNORE` で送信。INSERT文は SQL の `quote()` 関数で
   自前生成するため、複数行・制御文字を含む transcript 本文も libSQL 互換で安全に送れる
   （`turso db shell` は `.bail`/atomicなBEGIN-COMMIT/`unistr()` を扱えないため、これらに依存しない）。
4. **削除ゲート**＝送信が成功（exit 0）**かつ**、スナップショットの `session_id` に限定した
   Turso 側件数がローカルと一致する（＝このバッチが確実に入った）ときのみ削除へ進む。
5. **スナップショットに在った行だけ**をローカルから物理削除（送信後に増えた行は残す）し、
   `VACUUM` で空き容量を回収。

| フラグ | 挙動 |
|---|---|
| (なし) | 送信 → 照合 → 送信済み行をローカルから物理削除 → `VACUUM` |
| `--keep-local` | 送信 → 照合まで。**削除しない**（初回の検証向け、推奨） |

### 冪等性についての注意

INSERT文を `quote()` で自前生成しているため `INSERT OR IGNORE` を安全に使える。
`turso db shell` は各文を自動コミットする（`BEGIN/COMMIT` がアトミックにならない）が、
`OR IGNORE` のおかげで**途中で失敗しても、原因を直して再実行すれば既存行はスキップされ残りだけ送られる**
（再実行で冪等）。削除はスナップショット限定の件数照合ゲートを通過した場合のみ行う。

## Turso のデータにアクセスする（分析・閲覧）

認証は同じく `turso auth login` セッション。トークンの受け渡しは不要。

```bash
# 対話シェル（sqlite と同様に SQL を打てる）
turso db shell cc-logs

# 単発クエリ
turso db shell cc-logs "SELECT count(*) FROM sessions;"
turso db shell cc-logs "SELECT model, count(*) n, sum(output_tokens) out FROM sessions GROUP BY model ORDER BY out DESC;"
turso db shell cc-logs "SELECT day, sum(message_count) FROM session_days GROUP BY day ORDER BY day DESC LIMIT 14;"

# CSV で取り出してローカル分析へ
turso db shell cc-logs ".mode csv" "SELECT * FROM sessions;" > sessions.csv
```

別ツールから繋ぐ場合（Datasette / BI / スクリプト等）は、その時だけ接続情報を取得して使う:

```bash
turso db show cc-logs --url            # libsql:// の URL
turso db tokens create cc-logs         # 読み取り用トークン（用途別に発行。使い終わったら失効）
```

> 分析用に発行したトークンは Claude のセッションに貼らないこと。必要なら別シェルで使い、
> 不要になったら `turso db tokens invalidate cc-logs` で失効させる。
> 注: `turso db shell` への dot-command は限定的（`.mode` は可、`.bail` などは不可）。

## トークン / セッションのローテーション（マシン移行・漏洩懸念時）

CLI セッションを使うため、ローテーションは CLI 側で行います。

```bash
turso auth logout
turso auth login            # 新しい認証セッションを取得
# 必要なら旧トークンを失効
turso db tokens invalidate cc-logs
```

> `turso db tokens invalidate` はその DB の既存トークンをすべて失効させます。CLI セッションを
> 含む可能性があるため、失効後は `turso auth login` で再認証してください。
