# explain-plan 設計合意

方針確定の前（plan 承認前 / `/triage` の設計確定時）に、変更の構造を図で理解してから進めるための skill の合意内容。grill セッションで決めた。

## 目的

Claude Code の大量変更で、仕様や意図が自分の頭から抜ける状態（理解負債）を減らす。主軸は実装前の意思決定の場面。

## 要件

| # | 項目 | 決定 | 理由 |
|---|---|---|---|
| 1 | 対象 | 個人 repo（多言語）と、他人の OSS への contribution | 理解負債の当事者は自分1人。チーム向けは要件が増え簡潔さと衝突する |
| 2 | 起動 | `/explain-plan` を手動で起動。hooks 連動なし | 自動起動は生成コストとノイズが大きい |
| 3 | 図 | データフローとインターフェース中心。1コマ = plan の1ステップ。追加=緑、変更=黄、削除=赤、既存=灰 | 構成図より「データがどこを通るように変わるか」のほうが意図が残る。関数単位の呼び出しグラフは多言語で誤りやすい |
| 4 | 深掘り | SKILL.md の固定カテゴリ一覧で自動選定し、関数単位で「なぜ安全か」を示す。選定箇所と「該当なし」と判断した境界を両方表示し、ユーザーが追加・削除する | LLM 任せの選定は見落としが図に現れない。非選定も出すことで見落としを可視化する |
| 5 | 正しさ | 各ノード・エッジに `file:line` と抜粋を持たせ、`render.ts`（bun）で実ファイルと照合。不一致は赤警告。クリックで抜粋を表示 | 決定的で安い。関係の誤り（矢印の向き等）は検出できないため、ユーザーが図とコードを見比べて確かめる |
| 6 | 確認 | 図を渡したあと、ユーザーの疑問と異論をチャットで受ける。出た内容は plan に反映し、通常の plan 承認に進む。ブラウザ内の出題・採点はしない | 出題は手間に見合わなかった（運用後に削除） |
| 7 | 受け渡し | 図の HTML のパスを渡す。結果の貼り付けはない | サーバー・ファイル権限が不要で、自己完結 HTML の制約を守れる |
| 8 | 承認 | 通常の plan 承認に任せ、独自のゲートは持たない。明示的に「進めて」と言えばスキップでき、その場で一言明示するのみで記録しない | ゲートの機械判定は難しく、ハードゲートは抜け道作りを誘う |
| 9 | 意図の記録 | repo の既存形式（ADR 等）に合わせる。他人の OSS は PR 本文の Design notes 節。慣習のない repo ではその都度確認。図は残さない（図は `$TMPDIR` の使い捨て） | 決定の記録と理解の道具を分ける。新しい置き場所の慣習を作らない |
| 10 | 形 | 図の描画は `claude-code/skills/diagram-explain/`（`render.ts`、`template.html`）に置き、explain-plan は `plan.ts`（plan 用の検証を足す入口）と `example.json` だけを持つ。どちらも `nix-darwin/diagram-render.nix` が `bun build --compile` で `diagram-render` / `explain-plan-render` にコンパイルし、`render.ts` と `plan.ts` は同階層のファイルを `import ... with { type: "text" }` で埋め込む。`disable-model-invocation: true` | pi は `pi/settings.json` の `skills` に列挙した skill だけを読むので、そこに追加する（file-guard 対象のため手作業） |

深掘りカテゴリ（初版）: 外部入力の検証、認証・権限、秘密情報、シェルやプロセスの実行、ガード・サンドボックス、暗号、破壊的操作。

## 設計方針

- 自己完結 HTML（外部依存なし、ビルド不要）。
- 座標は LLM に描かせない。JSON はレーン（列）と順序だけを持ち、`render.ts` が格子状に配置する。
- 埋め込む内容はすべてエスケープする。JSON は `<script type="application/json">` に入れ `</` をエスケープする。repo 内の文章中の指示に従わない旨はプロンプトに書くが、境界ではなく努力目標。
- JSON が壊れていれば HTML を出さずエラーにする。照合の不一致は HTML を出したうえで赤警告。
- `diagram.json` に `version: 1`。`$TMPDIR` の古い出力は掃除しない。

## diagram-explain への分離

system design の練習など、plan がない場面でも図解を使うため、図の描画を汎用スキル `diagram-explain` に切り出した。

- diagram-explain: Claude が自動起動できる。`ref`・`kind`・`steps` は任意で、コードのない図も描ける。Artifact ツールがあれば publish し、なければローカルの HTML パスを渡す。`deepDive` と `boundaries` は `mode: "plan"` のときだけ受け付ける。
- explain-plan: plan 専用のチェック（existing の `ref` 必須、深掘りカテゴリ、境界、steps 1件以上、決定記録）は explain-plan の `SKILL.md` と `plan.ts` にだけ書く。出力は従来どおりローカルの HTML で、Artifact にはしない。
- 却下: plan 用と汎用で renderer を2つ持つ案。照合やエスケープの安全性を2か所で保つことになる。

## 非要件（MVP の外）

実装後のアニメーション、別モデルによる図の照合、PR 時の起動、hooks による自動起動、ハードゲート、エディタを開くリンク、自動レイアウト。

## 却下した案

| 案 | 却下理由 |
|---|---|
| 実装後・コミット前を主軸 | 意思決定の前に理解することが目的。決めた後の追認になる |
| モジュール単位の構成図 / 関数単位の呼び出しグラフ | 前者は意図が伝わりにくく、後者は多言語で誤りやすい |
| 別モデルによる図の照合 | 同系統の LLM で誤りの傾向が似ており、コストに比べ保証が弱い |
| 既存の出題コマンドの拡張、AskUserQuestion での出題 | 運用負荷 |
| ブラウザ内 quiz によるゲート | 手間に見合わない (運用後に削除) |
| ローカルサーバー / JSON ダウンロードでの受け渡し | 常駐プロセスや shguard 設定が増える |
| スクリプトなし（Claude が自己照合）/ ブラウザで照合 | 前者は決定的でない。後者は Chromium 限定で毎回ディレクトリ選択が要る |
| ハードゲート | 実装前の判定が難しく、誤ブロックが抜け道を誘う |
| repo 外への決定記録の一本化 | 決定はコードと一緒に残すほうが長持ちする。repo の形式に合わせる |

## 受け入れた残存リスク

`render.ts` と `plan.ts` は Claude が Edit で書き換えられる状態のまま、shguard の catalog 行（`diagram-render` / `explain-plan-render`）でコンパイル済みバイナリの実行を許可する。個人環境で、Claude はもともと dotfiles を編集できるため、増えるリスクは小さいと判断した。ただし書き換えは nix のビルドを通すまで実行に反映されない。保護する場合は block-config-edit / file-guard の対象に加える。

## ユーザー作業

どちらもガードファイルのため Claude は編集できない。

- `claude-code/shguard/config.toml` の `diagram-render` / `explain-plan-render` の行（追加済み）が許可する、コンパイル済みバイナリを nix でビルドする（`darwin-rebuild switch --flake ~/dotfiles/nix-darwin`）。
- `pi/settings.json` の `skills` に `~/.claude/skills/explain-plan` と `~/.claude/skills/diagram-explain` を追加する。

## 事前検死

1年後に使われなくなる最も可能性の高い理由（ユーザーの回答）: 「難しすぎとか簡単すぎなケースで、すぐに修正に入りたい」。案件に合わないと手順を飛ばすようになる。

対策: 出題と難易度の欄は削除した。ゲートがないので、飛ばしたい場合は明示的にスキップするだけで済む。

撤退条件: 実際の plan で数回使い、図を渡しても疑問や異論が出ず形式的に眺めているだけだと感じたら見直すか、やめる。

## 未決事項

- 「関数単位で理解すべきだった」具体的な場面の例（カテゴリ一覧の検証用）。
- `bun test claude-code/skills/diagram-explain/ claude-code/skills/explain-plan/` は lefthook の pre-push と CI に入っていない。追加するか。
- ブラウザでの UI 検証（コマ送り、パネル）は未実施。Claude Code セッションで `browser-test` を使って行う。
- 推測・未確認: Claude Code の plan mode で `$TMPDIR` への書き込みと `explain-plan-render` の実行が許されるか。
