require('dotenv').config();
const fs = require('fs');
const path = require('path');

/**
 * Zenn 記事を articles/ に書き出す。
 *
 * Zenn はリポジトリの articles/*.md を検知して公開するので、
 * ここでは「ファイルを置く」までを担当し、コミットとプッシュは
 * CI（GitHub Actions）側に任せる。
 */

function repoRoot() {
  // CI ではリポジトリ自体が作業ディレクトリなので ZENN_REPO_PATH で差し替える
  return process.env.ZENN_REPO_PATH || path.join(__dirname, '..');
}

/**
 * Zenn のスラッグ規則: a-z0-9 とハイフン・アンダースコアのみ、12〜50文字。
 * 日本語タイトルはそのまま使えないので、日付 + DOI の末尾で作る。
 */
function buildSlug(paper, today) {
  const tail = String(paper.doi || paper.id || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .slice(-3)
    .join('-');

  const slug = `${today}-jstage-${tail}`
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 50)
    .replace(/-+$/, '');

  // 12文字に満たない場合の保険
  return slug.length >= 12 ? slug : `${slug}-paper`.substring(0, 50);
}

/** front matter の title は " を含められないので全角に寄せる */
function safeTitle(title) {
  return String(title).replace(/"/g, '”').replace(/\r?\n/g, ' ').trim();
}

function buildMarkdown(paper, summary) {
  const topics = ['教育', '論文要約', '教育心理学', 'jstage'];

  const info = [
    '| 項目 | 内容 |',
    '|------|------|',
    `| **タイトル** | ${paper.title} |`,
    `| **著者** | ${paper.authors} |`,
    `| **掲載誌** | ${paper.journal}${paper.volume ? ` ${paper.volume}(${paper.number || 0})` : ''} |`,
    `| **発行年** | ${paper.year} |`
  ];
  if (paper.doi) info.push(`| **DOI** | ${paper.doi} |`);
  info.push(`| **J-STAGE** | [記事ページ](${paper.url}) |`);

  return `---
title: "【論文要約】${safeTitle(paper.title)}"
emoji: "📚"
type: "idea"
topics: ${JSON.stringify(topics)}
published: true
---

## 論文情報

${info.join('\n')}

---

${summary}

---

## 元論文

- [${paper.title}](${paper.url})（J-STAGE）

---

:::message
この記事は J-STAGE で公開されている論文の**要旨をもとに自動生成**しています。
要旨に書かれていない内容は含めていませんが、正確な内容は必ず元論文をご確認ください。
:::

**作成日**: ${new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })}
`;
}

async function postToZenn(paper, summary) {
  console.log('📤 Zenn 記事を作成します...');

  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  const slug = buildSlug(paper, today);

  const dir = path.join(repoRoot(), 'articles');
  fs.mkdirSync(dir, { recursive: true });

  const file = path.join(dir, `${slug}.md`);
  fs.writeFileSync(file, buildMarkdown(paper, summary), 'utf-8');

  console.log(`✅ 記事を書き出しました: articles/${slug}.md\n`);
  return { slug, file };
}

module.exports = { postToZenn, buildMarkdown, buildSlug };
