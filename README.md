# paper-to-zenn

Zenn（[zenn.dev/k518](https://zenn.dev/k518)）に出す記事の置き場所です。
Zenn は GitHub 連携でこのリポジトリを見ており、`articles/` に Markdown を置くと記事になります。

記事は毎日1本、GitHub Actions が自動で作ります。**海外のオープンアクセス論文を選び、
本文の PDF を読んで日本語で紹介する**という中身です。

## 何が動いているか

| ワークフロー | 内容 | 実行 |
|---|---|---|
| [DataSci to Zenn](.github/workflows/datasci.yml) | 統計・機械学習の**手法そのもの**を扱う直近2年の論文を、被引用数の多い順に1本選んで紹介記事にする | 毎日 07:00（日本時間）+ 手動 |

処理の流れと設定は [`datasci/README.md`](datasci/README.md) にあります。

```
OpenAlex で候補を検索 → PDF を取得 → pdftotext で本文を文字にする
  → Gemini が6観点（問題設定／既存手法との違い／手法の中身／検証／使いどころ／次に読む論文）で執筆
  → 日本語版 Wikipedia で専門用語の項目を確認してリンク
  → articles/datasci-<OpenAlexID>.md を書いてコミット
```

**1日1本だけ**作ります。Zenn はこのアカウントで新規公開が1日1本前後で頭打ちになるため、
多く置いても順番待ちが増えるだけだからです。

## フォルダ

| 場所 | 中身 |
|---|---|
| `articles/` | Zenn の記事（Markdown）。自動生成と手動のものが混在しています |
| `books/` | Zenn の本 |
| `images/` | 記事で使う画像 |
| `datasci/` | 記事を作るプログラムと台帳（`ledger.json`）。[説明はこちら](datasci/README.md) |
| `obsidian/` | 作業記録の控え |
| `posted.json` | 旧システムが投稿済みの論文を記録していたファイル（現在は使っていません） |

## 記事の入れ替え

- **手で記事を足す**: `articles/` に Markdown を置いて push すれば公開されます
- **記事を取り下げる**: ファイルを消して push します。未公開のものはそのまま消えます
- **自動生成を止める**: Actions → DataSci to Zenn → 右上の「…」→ Disable workflow

## これまでの経緯

- 2026-09-15 まで: J-STAGE（国内論文）→ Zenn + WordPress の仕組みが動いていました（`daily-paper.yml`）
- 2026-09-15: 後継として Google Apps Script の仕組みに移行
- 2026-09-22: Zenn が1日1本しか公開されず順番待ちが溜まったため、Zenn 向けを分離する方針に
- 2026-09-23: このリポジトリ内で完結する `datasci/` を新設。旧ワークフローと旧コードは削除しました
  （中身は git の履歴に残っています）

## ライセンス

コードは [LICENSE](LICENSE) に従います。記事の本文は紹介対象の論文の著作権者に帰属する部分を含みます。
各記事の末尾に、AI による要約であることと原論文へのリンクを入れています。
