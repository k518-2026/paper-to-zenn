/**
 * データ分析の最新手法 → Zenn（1日1本）
 *
 *   node datasci/run.js            記事を1本作って articles/ に書き、台帳を更新する
 *   node datasci/run.js --dry-run  ファイルを書かずに、できた記事を画面に出す
 *   node datasci/run.js --force    その日すでに作っていても、もう1本作る
 *
 * 流れ: OpenAlex で候補 → 台帳に無いものの PDF → pdftotext → Gemini（6観点・和訳・用語・紹介文）
 *       → 日本語版 Wikipedia で用語を確認 → Zenn の Markdown を書き出す
 *
 * Zenn は新規公開が1日1本前後で頭打ちになるので、**1日1本**しか作らない。
 * コミットとプッシュは GitHub Actions のワークフローが行う。
 *
 * 外部とのやり取りは deps にまとめてある（test.js が差し替える）。
 */
const fs = require('fs');
const path = require('path');
const config = require('./config');
const openalex = require('./lib/openalex');
const pdfLib = require('./lib/pdf');
const gemini = require('./lib/gemini');
const wikipedia = require('./lib/wikipedia');
const { buildMarkdown, zennSlug } = require('./lib/render');
const ledger = require('./lib/ledger');

const ROOT = path.join(__dirname, '..');

const deps = {
  searchCandidates: openalex.searchCandidates,
  readingCandidates: openalex.readingCandidates,
  fetchPdf: pdfLib.fetchPdf,
  extractText: pdfLib.extractText,
  writeArticle: gemini.writeArticle,
  verifyTerms: wikipedia.verifyTerms,
  dropWrongSenses: wikipedia.dropWrongSenses,
  now: () => new Date()
};

const options = {
  dryRun: process.argv.includes('--dry-run'),
  force: process.argv.includes('--force'),
  root: ROOT
};

/** 日本時間の日付（UTC のままだと朝の実行で前日になる） */
function today() {
  return new Date(deps.now().getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

async function main() {
  const ledgerFile = path.join(options.root, config.paths.ledger);
  const rows = ledger.load(ledgerFile);
  const known = ledger.knownKeys(rows);

  if (!options.force && ledger.madeToday(rows, today())) {
    console.log('今日の記事はもうあります（1日1本）。何もしません。');
    return null;
  }

  let made = null;
  let tries = 0;

  for (let page = 1; page <= config.maxSearchPages && !made; page++) {
    const result = await deps.searchCandidates(page);
    if (page === 1) console.log('検索条件に合う論文: ' + Number(result.total).toLocaleString('en-US') + ' 件');
    if (!result.papers.length) break;

    for (const paper of result.papers) {
      if (made || tries >= config.maxTriesPerRun) break;
      if (ledger.isKnown(known, paper)) continue;
      tries++;
      known.add(String(paper.id).toLowerCase());

      console.log(`\n候補: ${paper.title}（${paper.year}・被引用 ${paper.citedBy}）`);
      made = await tryPaper(paper, rows);
    }
  }

  if (options.dryRun) console.log('\n[--dry-run] ファイルは書いていません。');
  else ledger.save(ledgerFile, rows);

  if (!made) {
    console.log(`\n記事にできる論文が見つかりませんでした（${tries} 本試しました）。`);
    process.exitCode = 1;
    return null;
  }
  console.log(`\n記事を書きました: ${made.path}\n  ${made.titleJa}`);
  return made;
}

/** 論文1本を記事にする。できたら {path, titleJa, markdown}、飛ばしたら null */
async function tryPaper(paper, rows) {
  const pdf = await deps.fetchPdf(paper);
  if (!pdf) {
    rows.push(ledger.record(paper, ledger.STATUS.SKIPPED, { note: 'PDF を取得できない' }));
    return null;
  }
  console.log(`  PDF ${Math.round(pdf.bytes / 1024)}KB`);

  const text = deps.extractText(pdf);
  if (text.length < config.pdfTextMinChars) {
    rows.push(ledger.record(paper, ledger.STATUS.SKIPPED, { note: `本文の文字を取り出せない（${text.length} 字）` }));
    console.log(`  本文を取り出せませんでした（${text.length} 字）`);
    return null;
  }
  console.log(`  本文 ${text.length.toLocaleString('en-US')} 字`);

  const readings = await deps.readingCandidates(paper);
  const article = await deps.writeArticle(paper, text, readings);
  console.log(`  モデル: ${article.model}`);

  if (!article.relevant) {
    rows.push(ledger.record(paper, ledger.STATUS.SKIPPED, { note: 'テーマ外: ' + article.relevanceReason }));
    console.log('  テーマ外として飛ばしました: ' + article.relevanceReason);
    return null;
  }

  // 用語リンクは付加価値。確かめられなければ張らない（推測で張るよりよい）
  try {
    article.links = await deps.verifyTerms(article.terms);
    await deps.dropWrongSenses(article);
  } catch (e) {
    article.links = [];
    article.warnings.push('Wikipedia の確認に失敗したためリンクなし: ' + e.message.slice(0, 120));
  }

  const slug = zennSlug(paper.id);
  const rel = config.paths.articles + '/' + slug + '.md';
  const file = path.join(options.root, rel);
  if (fs.existsSync(file)) {
    rows.push(ledger.record(paper, ledger.STATUS.SKIPPED, { note: '同じ slug の記事がすでにある', slug }));
    console.log('  すでに同じ記事があります: ' + rel);
    return null;
  }

  const markdown = buildMarkdown(paper, article, today());
  console.log('  字数: ' + config.sections.map((s) => s.heading.slice(0, 3) + ' ' + gemini.jaLength(article.sections[s.key]) + '字').join(' / '));
  console.log('  用語リンク ' + article.links.length + ' / 次に読む論文 ' + article.nextReads.length +
              (article.warnings.length ? '\n  注意: ' + article.warnings.join(' / ') : ''));

  if (options.dryRun) {
    console.log('\n---- ここから記事 ----\n' + markdown + '---- ここまで ----');
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, markdown, 'utf8');
  }

  rows.push(ledger.record(paper, ledger.STATUS.DONE, {
    slug,
    titleJa: article.titleJa,
    url: 'https://zenn.dev/' + config.zenn.user + '/articles/' + slug,
    model: article.model,
    note: article.warnings.join(' / ')
  }));
  return { path: rel, titleJa: article.titleJa, markdown };
}

if (require.main === module) {
  main().catch((e) => {
    console.error('失敗しました: ' + e.message);
    process.exit(1);
  });
}

module.exports = { main, tryPaper, deps, options, today };
