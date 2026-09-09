require('dotenv').config();
const fs = require('fs');
const path = require('path');

const { findPaper } = require('./fetch-jstage');
const { generateOchiaiSummary } = require('./generate-ochiahi-summary');
const { postToZenn } = require('./post-to-zenn');
const { postToWordPress } = require('./post-to-wordpress');

/**
 * 国内論文（J-STAGE）→ 要約 → WordPress + Zenn
 *
 *   ステップ1  J-STAGE から未投稿の論文を1件取る（日本語要旨つき）
 *   ステップ2  Claude で落合陽一式に要約する
 *   ステップ3  Zenn 記事を articles/ に書き出す
 *   ステップ4  WordPress へメール投稿する
 *   ステップ5  投稿済みとして posted.json に記録する
 *
 * 記録は投稿が済んでから行う。順序を逆にすると、投稿に失敗した論文が
 * 「投稿済み」になって二度と拾えなくなる。
 */

function repoRoot() {
  return process.env.ZENN_REPO_PATH || path.join(__dirname, '..');
}

function postedFilePath() {
  return path.join(repoRoot(), 'posted.json');
}

function loadPosted() {
  const file = postedFilePath();
  if (!fs.existsSync(file)) return { posted: [] };
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (!Array.isArray(data.posted)) data.posted = [];
    return data;
  } catch (error) {
    console.error(`⚠️ posted.json の読み込みに失敗、新規作成します: ${error.message}`);
    return { posted: [] };
  }
}

/** 旧レコード（arXiv 時代の arxivId）も含めて突き合わせる */
function postedIds(data) {
  return data.posted.map(p => p.id || p.arxivId).filter(Boolean);
}

function recordPosted(paper, extra) {
  const data = loadPosted();
  data.posted.unshift({
    id: paper.id,
    doi: paper.doi || '',
    title: paper.title,
    source: 'J-STAGE',
    theme: paper.theme || '',
    url: paper.url,
    postedAt: new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }),
    ...extra
  });

  const file = postedFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  console.log(`✅ 投稿済みとして記録しました（累計 ${data.posted.length} 件）\n`);
}

const line = () => console.log('━'.repeat(50) + '\n');

async function runFullPipeline() {
  console.log('\n🚀 J-STAGE → 要約 → WordPress + Zenn\n');
  line();

  // --- ステップ1: 論文を取る ---
  console.log('【ステップ 1】論文検索（J-STAGE）');
  line();

  const themeOffset = Number(process.env.THEME_OFFSET || 0);
  const paper = await findPaper(postedIds(loadPosted()), themeOffset);

  if (!paper) {
    console.log('投稿対象がないため終了します\n');
    return;
  }

  console.log(`📄 ${paper.title}`);
  console.log(`   ${paper.authors} / ${paper.journal} ${paper.year}\n`);

  // --- ステップ2: 要約 ---
  line();
  console.log('【ステップ 2】要約生成');
  line();

  const { summary } = await generateOchiaiSummary(paper);

  // --- ステップ3・4: 投稿 ---
  // 片方が落ちても、もう片方は試す。どちらも落ちたら記録しない
  const results = { zenn: null, wordpress: null };
  const errors = [];

  if (process.env.SKIP_ZENN !== 'true') {
    line();
    console.log('【ステップ 3】Zenn 記事の書き出し');
    line();
    try {
      const r = await postToZenn(paper, summary);
      results.zenn = r.slug;
    } catch (error) {
      errors.push(`Zenn: ${error.message}`);
      console.error(`❌ Zenn 記事の作成に失敗: ${error.message}\n`);
    }
  }

  if (process.env.SKIP_WORDPRESS !== 'true') {
    line();
    console.log('【ステップ 4】WordPress へ投稿');
    line();
    try {
      results.wordpress = await postToWordPress(paper, summary);
    } catch (error) {
      errors.push(`WordPress: ${error.message}`);
      console.error(`❌ WordPress への投稿に失敗: ${error.message}\n`);
    }
  }

  // --- ステップ5: 記録 ---
  line();
  console.log('【ステップ 5】記録');
  line();

  if (!results.zenn && !results.wordpress) {
    // どこにも出せていないので記録しない。次回この論文を再試行できる
    throw new Error(`すべての投稿に失敗しました / ${errors.join(' / ')}`);
  }

  recordPosted(paper, {
    zennSlug: results.zenn || '',
    wordpress: results.wordpress ? '送信済み' : ''
  });

  console.log('🎉 完了');
  console.log(`   Zenn: ${results.zenn || '（スキップまたは失敗）'}`);
  console.log(`   WordPress: ${results.wordpress ? '送信済み' : '（スキップまたは失敗）'}\n`);

  // 片方だけ失敗した場合も、CI に気づかせるため異常終了させる
  if (errors.length) {
    throw new Error(`一部の投稿に失敗しました / ${errors.join(' / ')}`);
  }
}

if (require.main === module) {
  runFullPipeline().catch(error => {
    console.error(`\n❌ パイプラインが失敗しました: ${error.message}\n`);
    process.exit(1);
  });
}

module.exports = { runFullPipeline };
