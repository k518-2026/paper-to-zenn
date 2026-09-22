# datasci — データ分析の最新手法を Zenn に（1日1本）

統計・機械学習の**手法そのもの**を扱う最近の論文を1日1本選び、本文 PDF を Gemini に読ませて
技術寄りの6観点で紹介する記事を書き、`articles/datasci-*.md` に置く。
Zenn はこのリポジトリを見て公開する。

GitHub Actions（`.github/workflows/datasci.yml`）が毎日 07:00（日本時間）に動かし、
できた記事と台帳をコミットする。**GAS は使わない。**

## 流れ

```
OpenAlex   直近2年・オープンアクセス・英語・学術誌・指定トピックを被引用数の多い順に
           （トピック: 発展的な統計手法 / 統計的推測 / ベイズ推測 / 因果推論 / ベイズモデリング /
             機械学習とアルゴリズム / 機械学習とデータ分類）
PDF        pdf_url から取得。**先頭4バイトが %PDF か**を必ず確かめる（HTML が返ることが多い）
pdftotext  本文を文字にする（3,000 字未満なら画像だけの PDF とみなして飛ばす）
OpenAlex   参考文献と被引用論文を「次に読む論文」の候補にする（実在の論文だけから選ばせるため）
Gemini     6観点・和訳タイトル・専門用語・紹介文を JSON で。テーマ外なら relevant=false で飛ばす
           字数が外れた観点だけ、本文なしの軽い問い合わせで書き直させる
Wikipedia  用語の項目が実在するか、意味が記事と合うかを確かめる（合わなければ張らない）
Markdown   articles/datasci-<OpenAlexID>.md を書く
WordPress  同じ記事を HTML にしてメール投稿（設定があるときだけ。失敗しても Zenn の記事は残す）
台帳       datasci/ledger.json に記録（記事にしなかった論文も残し、二度と取りに行かない）
```

## 手元で動かす

```bash
node datasci/test.js            # 自己検査（通信は偽物。外部パッケージ不要）
node datasci/test.js --live     # OpenAlex・PDF・Wikipedia だけ本物に当てる（Gemini は呼ばない）
node datasci/run.js --dry-run   # 記事を作ってログに出すだけ（ファイルは書かない。GEMINI_API_KEY が要る）
node datasci/run.js --force     # その日すでに作っていても、もう1本作る

node datasci/send-wp.js --show  # WordPress に送る中身（件名と本文）を表示するだけ
node datasci/send-wp.js         # いちばん新しい記事を **下書き** として WordPress に送る
node datasci/send-wp.js --publish datasci-w123   # 記事を指定して公開で送る
```

`send-wp.js` は記事を作り直さない（Gemini を使わない）。すでに書いた Markdown を WordPress の本文に
直して送るだけなので、**メールの設定だけを確かめたいとき**に使う。既定は下書きなのでブログには出ない。
GitHub では「WordPress だけ試す」ワークフロー（`wp-test.yml`）を手動実行しても同じことができる。

`--live` と本番の実行には `pdftotext`（poppler）が要る。Actions では apt で入れている。

## Secrets（リポジトリの Settings → Secrets and variables → Actions）

| 名前 | 要否 | 中身 |
|---|---|---|
| `GEMINI_API_KEY` | 必須 | Google AI Studio のキー |
| `OPENALEX_API_KEY` | ほぼ必須 | https://openalex.org/settings/api で発行（無料・1日 $1 分）。無いと共有 IP の枠（1日 $0.10）を取り合ってすぐ 429 になる |
| `ANTHROPIC_API_KEY` | 任意 | **Gemini の全モデルが混雑したときだけ** Claude Sonnet 5 で書く（1記事 10 円前後）。無ければその日は記事なしで終わる |
| `WP_POST_EMAIL` `SMTP_USER` `SMTP_PASSWORD` | 任意 | 同じ記事を WordPress にもメールで投稿する。3つ揃っていないときは Zenn だけ |

## 決めごと・注意点

- **1日1本**。Zenn はこのアカウントで新規公開が1日1本前後しか進まない（2026-09-14 実測）。
  多くコミットすると順番待ちが溜まる（実際に8本コミットして公開5本・未公開3本になった）
- **「最新」は直近2年の中で被引用数の多い順**。公開日順にすると被引用数がほぼ0で当たり外れが大きい
- **Zenn はタイトル70字超でデプロイ全体が止まる**。slug は 12〜50 文字の英小文字・数字・`-_`
- **手法の論文は、その手法を使っただけの応用研究に引用されやすい**（生態学・医学など）。
  「次に読む論文」で選ばせないよう指示文で断っている
- **用語リンクは推測で張らない**。実在を API で確かめ、さらに意味が合うかを Gemini に判定させる
  （項目が実在しても意味が違うことがある。「信頼性」は工学の項目だった）
- 記事の見出し画像は付けない（Zenn は絵文字がカードに出る）

## ファイル

```
datasci/
  config.js        テーマ・観点・本数などの設定
  run.js           実行の入口（外部とのやり取りは deps にまとめてあり、テストが差し替える）
  test.js          自己検査
  ledger.json      台帳（自動で更新される）
  lib/
    http.js        再試行つきの fetch
    openalex.js    検索・書誌・次に読む論文の候補
    pdf.js         PDF の取得と pdftotext
    gemini.js      記事の生成と字数の調整
    wikipedia.js   用語の実在と意味の確認
    render.js      書誌・用語リンク・Zenn の Markdown・WordPress の HTML
    wordpress.js   メール投稿（<hr> と -- は入れない。署名扱いで本文が消える）
```
