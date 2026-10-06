# ja-lint の検出範囲を広げる候補: natural-japanese と textlint 系の調査メモ

## 問題の所在

`ja-lint` skill (7ec440a) は yomiyasu の `yomiyasu_lint.py` だけを取り込んでおり、検出範囲は語彙・比喩動詞・フィラー・絵文字・太字/箇条書き比率・文末の繰り返しに限られる。当面はこれで足りるという判断だが、他の日本語 lint を調べた結果を、必要になったときに見返せるよう残しておく（調査日 2026-10-03）。

yomiyasu が拾わないもの: 文のリズムの単調さ、段落構造の均一さ、翻訳調、読みの負荷（長文・漢字連続）、表記ゆれ、助詞の重複。意味の水増しや根拠のない言い切りは、どの決定論的 lint でも拾えない。

## 調査結果

星数・ライセンス・最終 push 日は GitHub API で確認したもの。それ以外は調査エージェントがページ表示から取得した値で、未検証。

### AI 臭に特化

| ツール | 方式 | 備考 |
|---|---|---|
| [coji/natural-japanese](https://github.com/coji/natural-japanese) | 形態素解析 (sudachipy) の `lint.py`、Agent Skill | 星 1,845、MIT、最終 push 2026-09-04（確認済み）。報告のみ。リズム・定型句・「〜ではなく」多用・翻訳調・読みの負荷を検出。依存は uv と sudachipy。第三者検証では技術記事の誤検知が 56.7%（`--genre tech` で 44.2%）。職務経歴書での値は未確認。 |
| [textlint-rule-preset-ai-writing](https://github.com/textlint-ja/textlint-rule-preset-ai-writing) | textlint の 5 ルール | 星 1,151、MIT、最終 push 2026-06-16（確認済み）。機械的な箇条書き、誇張表現、強調の重複、英語風コロンを検出。「表層しか拾わない」という作者評あり。 |
| [iKora128/stop-ai-slop-jp](https://github.com/iKora128/stop-ai-slop-jp) | LLM 判断のみ | 星 467、MIT。報告のみのモードあり。決定論的ではない。 |
| [gonta223/humanizer-ja](https://github.com/gonta223/humanizer-ja) ほか humanizer 系 | LLM 判断のみ | 書き換えが中心。職務経歴書では数字や事実が動くおそれがある（推測）。 |
| [KANNOHI1/humanizer-jp](https://github.com/KANNOHI1/humanizer-jp) | LLM ベース | 職務経歴書を明示的に対象にするが、星 0 で実績なし。 |

英語向けの `conorbronsdon/avoid-ai-writing` は、検出エンジンが空白区切りで語を数えるため日本語では動かない（第三者の検証記事による）。

### 従来型（決定論的な文体 lint）

- textlint（Node 20+、CLI / CI / MCP `npx textlint --mcp`）に、次のルールを足して使う。
  - `textlint-rule-preset-ja-technical-writing`（26 ルール。1文 100 字、読点 3 つ、漢字連続 6 字などの制限は職務経歴書には厳しすぎる可能性がある。推測）
  - `textlint-rule-preset-ja-spacing`
  - `textlint-rule-no-doubled-joshi`
  - `textlint-rule-prh`（辞書による表記ゆれ。`--fix` 対応）
- RedPen は Java が必要で、Claude Code からは textlint より呼びにくい（推測）。

## 推奨される対応方針

必要になるまで着手しない。着手する場合の候補:

1. natural-japanese の `lint.py` を、ja-lint と同じ方式（コミット固定、報告のみ、LICENSE 同梱）で取り込む。ja-lint に統合するか別 skill にするかは未決。取り込む前に、職務経歴書風の文章で誤検知の出方を確認する。
2. textlint に ai-writing プリセットと prh を足し、職務経歴書向けに ja-technical-writing を緩めた設定で運用する。

どちらも yomiyasu と検出範囲が重なりにくいため、置き換えではなく併用になる。

## 補足

- 取り込み時の注意: Edit/Write は `\u` + 4 桁のエスケープを文字に変換する。リテラルのエスケープを残したいときは `\u2600` の形で書く（7ec440a の `learned` 参照）。
- 取り込んだスクリプトは `git hash-object` が上流の blob と一致することを確認する。
