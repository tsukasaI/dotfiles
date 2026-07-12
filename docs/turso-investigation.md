# Turso ログ DB 調査(メモリシステム蒸留ソース化の実現可能性)

調査日: 2026-07-11。すべて `cc-logs` DB に対する読み取り専用クエリと、Turso/Cloudflare の公式ページから実測。DDL/DML は一切実行していない。

## 1. スキーマ概要と蒸留に使えるカラムの評価

`claude-code/hooks/save-transcript.ts` が作成する3テーブル(`turso db shell cc-logs ".schema"` で確認済み):

```sql
CREATE TABLE sessions (
  session_id TEXT PRIMARY KEY,
  project_dir TEXT, git_branch TEXT, model TEXT, claude_version TEXT,
  started_at TEXT, ended_at TEXT, end_reason TEXT,
  input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0,
  num_user_messages INTEGER DEFAULT 0, num_assistant_messages INTEGER DEFAULT 0
);
CREATE TABLE transcript_raw (
  session_id TEXT PRIMARY KEY,
  transcript_jsonl TEXT,   -- セッション全体の生イベントを1本のJSONLテキストとして保持
  size_bytes INTEGER,
  FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);
CREATE TABLE session_days (
  session_id TEXT, day TEXT, message_count INTEGER DEFAULT 0,
  PRIMARY KEY (session_id, day),
  FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);
```

**取れるもの**: セッションID、開始/終了時刻、プロジェクトディレクトリ、gitブランチ、モデル名、トークン数、日次メッセージ数。

**取れない(不足)もの**: ロール別・ツール呼び出し別の列は存在しない。個別メッセージの role/tool_use/timestamp は `transcript_raw.transcript_jsonl` の生JSONLの中にしかなく、SQLの `WHERE` で「role=assistant のメッセージだけ」のような絞り込みはできない。取り出したブロブをアプリ側で1行ずつパースする必要がある。

実データで確認(最新セッション `e1d93efd-...`, 2026-06-27):
```
{"type":"mode","mode":"normal","sessionId":"e1d93efd-..."}
{"type":"permission-mode","permissionMode":"default","sessionId":"e1d93efd-..."}
{"type":"bridge-session","sessionId":"e1d93efd-...","bridgeSessionId":"cse_..."}
```
行は追記順=時系列順になっている。よって「特定セッションを時系列で再構成する」クエリは書けるが、中身はSQLの絞り込みではなく単純な取得+クライアント側パースになる:
```sql
SELECT transcript_jsonl FROM transcript_raw WHERE session_id = ?;
-- 取得後、改行区切りでJSONをパースすれば追記順=時系列順で再構成できる(実データで確認済み)
```

もう一点: `project_dir` は hook 入力の `cwd` をそのまま格納しており、gitリモートURLのような正規化されたリポジトリ識別子ではない。同じリポジトリでも clone 先のパスが違えば別の文字列になる。プロジェクト単位で集約したい場合は正規化が別途必要。

## 2. サイズ・増加ペースの実測値と保持可能年数

`turso db show cc-logs`: **240 MB**(`transcript_raw.size_bytes` の合計 238,852,771 B とほぼ一致)。

行数: `sessions`=381, `transcript_raw`=378, `session_days`=546。データの時間範囲は `2026-01-21` 〜 `2026-06-27`(約5ヶ月)。

> 注: `push-to-turso.sh` は手動実行専用(Claudeのプロセスツリーから意図的に除外)なので、Turso側のデータは「最後に手動push した時点」までしか反映されない。直近の push は 2026-06-27 頃で、調査日(2026-07-11)時点でローカルの `logs.db` には未push分が2週間程度溜まっている可能性が高い。増加ペースはこの「データが存在する直近4週間」(週番号 W22〜W25)を基準に算出した。

週次(`started_at` 基準、`sessions` と `transcript_raw` を JOIN):

| 週 | セッション数 | 合計バイト数 |
|---|---|---|
| W25 | 22 | 11,317,473 |
| W24 | 18 | 11,524,204 |
| W23 | 7 | 1,950,482 |
| W22 | 15 | 5,945,539 |
| **4週合計** | **62** | **30,737,698** |

月間増加ペース(4週=28日 → 30日換算、×30/28):
- セッション数: 62 × 30/28 ≈ **66件/月**
- バイト数: 30,737,698 × 30/28 ≈ **32.9 MB/月**

無料枠ストレージ 5 GB(=5,120 MB、出典は3節)に対し、残り容量は 5,120 − 240 = 4,880 MB。
**保持可能年数 ≈ 4,880 MB ÷ 32.9 MB/月 ÷ 12 ≈ 12.4年**(現在のペースが変わらない前提)。利用量が今後2〜4倍に増えても3〜6年は保持できる計算で、ストレージは当面ボトルネックにならない。

## 3. 週次蒸留のコスト見積もり

`sessions`+`transcript_raw`+`session_days` の全行数は現時点で計 1,305 行。週次蒸留バッチが「直近1週間分を読む」設計でも、「安全側に全表スキャンする」設計でも、読み取り行数は数百〜（将来数年後でも）数千行のオーダーに収まる。

無料枠の月間 read は **5億行**(4節参照)。月4回の蒸留バッチを回しても消費は 4回 × 数千行 ≈ 1万行未満で、**無料枠に対する割合は実質 0.00X% 以下**。読み取りコストは無視できるレベル。

書き込み側(`push-to-turso.sh` の手動push)も、月66セッション分 ≈ 200行/月程度で、無料枠の月間write 1,000万行に対しても無視できる。

## 4. read-only トークンと Workers 接続の可否

**read-only トークン**: `turso db tokens create cc-logs --read-only` で発行可能(確認のみ、実行はしていない)。`--permissions`/`-p all:data_read` によるテーブル単位の細かい権限指定も可能。`-e`/`--expiration` で有効期限も指定できる。

**Cloudflare Workers からの接続**: 公式にサポートされている。
- Cloudflare公式ドキュメントに Turso 専用の third-party integration ページとチュートリアルが存在する([Workers — Turso integration](https://developers.cloudflare.com/workers/databases/third-party-integrations/turso/)、[tutorial](https://developers.cloudflare.com/workers/tutorials/connect-to-turso-using-workers/))。
- Workers ランタイムは生TCPソケットを持てないため、`@libsql/client` ではなく **`@libsql/client/web`**(fetchベース)を import する必要がある(Turso公式SDKリファレンス: https://docs.turso.tech/sdk/ts/reference)。
- より新しい **`@tursodatabase/serverless`** パッケージも Workers/Vercel Edge/Deno Deploy 向けに fetch のみで動作する後継として案内されている([Turso Blog](https://turso.tech/blog/introducing-turso-serverless-javascript-driver))。

出典(2026-07-11時点、公式ページを直接取得して確認):
- Turso Pricing: https://turso.tech/pricing
- Cloudflare Workers — Turso integration: https://developers.cloudflare.com/workers/databases/third-party-integrations/turso/
- Turso TS SDK Reference: https://docs.turso.tech/sdk/ts/reference

**Turso 無料枠(2026-07-11時点、`turso.tech/pricing`)**:

| 項目 | 無料枠 |
|---|---|
| ストレージ | 5 GB |
| 月間 row reads | 5億行 |
| 月間 row writes | 1,000万行 |
| DB数 | 無制限(下記リスク参照) |
| 月間 sync(embedded replica帯域相当) | 3 GB |
| Point-in-time restore | 1日分 |

## 5. 判断が必要な点・リスク

- **push-to-turso.sh の手動運用がボトルネック**: Turso側のデータ鮮度は「最後に手動pushした時刻」に依存する(現状 2026-06-27 時点、約2週間ラグ)。週次蒸留を自動化するなら、(a) push-to-turso.sh を安全な形で自動化する、(b) 蒸留パイプライン自体はローカル `logs.db` を直接読み、Turso は長期コールドストレージ専用にする、のどちらかを決める必要がある。CLAUDE.md には push-to-turso.sh を「Claudeのプロセスツリーから意図的に除外」と明記されており、(a) の自動化は既存の設計方針と衝突する可能性がある。
- **per-message構造の欠如**: 蒸留に role/tool_use 単位の粒度が必要な場合、SQLクエリだけでは完結せず、`transcript_jsonl` を毎回アプリ側でパースする処理が要る。これは実装コストの話であり、Turso側の制約ではない。
- **`project_dir` の非正規性**: プロジェクト単位で集約したい場合、`cwd` ベースの文字列はリポジトリ識別子として不安定(同一リポジトリでも clone パスが違えば別値になる)。正規化が必要なら別途方針を決める。
- **DB数上限の表記ゆれ**: 調査中、Turso pricing ページの抽出結果に「DB数:100」と「無制限」の不一致が一度出た(ページ内の一貫しない表示が原因と思われる)。`cc-logs` 1つしか使わない前提なら影響はないが、複数DB運用を検討する場合は pricing ページを直接確認すること。
- **増加ペースの前提**: 上記の月間ペース(66セッション/32.9MB)は直近4週間(かつ実際にpush済みの期間)のみに基づく外挿。利用頻度が今後大きく変わる(新規プロジェクト増加、他マシンからの利用開始など)場合は再計測が必要。
