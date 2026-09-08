require('dotenv').config();
const axios = require('axios');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// 各モジュールをインポート
const { saveToObsidian, updateArticleIndex, generateExecutionLog, updateStatistics } = require('./save-to-obsidian');
const { createInfographic, saveSvgImage, convertSvgToPng, saveInfographicMetadata } = require('./create-infographic');
const { generateXPostFile } = require('./post-to-x-simple');
const { postToBluesky } = require('./post-to-bluesky');
const { postToZenn } = require('./post-to-zenn');
const { postToHatena } = require('./post-to-hatena');
const { generateOchiaiSummary } = require('./generate-ochiahi-summary');

/**
 * 投稿済み論文の記録ファイル
 * CI ではリポジトリにコミットされるため実行間で状態が持続する
 */
function postedFilePath() {
  const repoRoot = process.env.ZENN_REPO_PATH
    || path.join(__dirname, process.env.GITHUB_REPO || 'paper-to-zenn');
  return path.join(repoRoot, 'posted.json');
}

function loadPostedIds() {
  const file = postedFilePath();
  if (!fs.existsSync(file)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return (data.posted || []).map(p => p.arxivId);
  } catch (error) {
    console.error(`⚠️ posted.json の読み込みに失敗: ${error.message}`);
    return [];
  }
}

function recordPosted(paper) {
  const file = postedFilePath();
  let data = { posted: [] };

  if (fs.existsSync(file)) {
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (!Array.isArray(data.posted)) data.posted = [];
    } catch (error) {
      console.error(`⚠️ posted.json の読み込みに失敗、新規作成します: ${error.message}`);
      data = { posted: [] };
    }
  }

  data.posted.unshift({
    arxivId: paper.arxivId,
    title: paper.title,
    postedAt: new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
  });

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  console.log(`✅ 投稿済みとして記録: ${paper.arxivId}（累計 ${data.posted.length} 件）`);
}

/**
 * arXIV の entry XML を論文オブジェクトに変換
 */
function parseEntry(entry) {
  const title = entry.match(/<title>([\s\S]*?)<\/title>/);
  const author = entry.match(/<author>\s*<name>(.*?)<\/name>/);
  const summary = entry.match(/<summary>([\s\S]*?)<\/summary>/);
  const id = entry.match(/<id>(http:\/\/arxiv\.org\/abs\/[\d.]+)/);
  const published = entry.match(/<published>([\d-]+)/);

  if (!title || !summary || !id) return null;

  return {
    title: title[1].trim().replace(/\s+/g, ' '),
    author: author ? author[1].trim() : 'Unknown',
    authors: author ? author[1].trim() : 'Unknown',
    summary: summary[1].trim(),
    url: id[1],
    arxivUrl: id[1],
    arxivId: id[1].split('/').pop(),
    published: published ? published[1] : 'Unknown'
  };
}

/**
 * arXIV から未投稿の論文を1件検索
 * 既出を避けるため候補を複数取得し、投稿済みでない最新のものを返す
 */
async function searchPapersFromArxiv() {
  console.log('📚 arXIV から論文を検索中...\n');

  // cs.CY (Computers and Society) に限定したうえで教育系キーワードで絞る
  const keywords = ['education', 'educational', 'learning', 'teaching', 'classroom', 'student'];
  const keywordQuery = keywords.map(k => `abs:"${k}"`).join(' OR ');
  const query = `cat:cs.CY AND (${keywordQuery})`;
  const url = `http://export.arxiv.org/api/query?search_query=${encodeURIComponent(query)}&start=0&max_results=30&sortBy=submittedDate&sortOrder=descending`;

  // arXIV はレート制限が厳しいので待機しつつ再試行する
  let response;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      response = await axios.get(url, {
        timeout: 30000,
        headers: { 'User-Agent': 'paper-to-zenn/1.0 (https://github.com/k518-2026/paper-to-zenn)' }
      });
      break;
    } catch (error) {
      const status = error.response && error.response.status;
      if (attempt === 4) {
        // 検索できないことは「新着なし」とは違う。握りつぶさず失敗させる
        throw new Error(`arXIV への問い合わせに失敗しました（${status || error.message}）`);
      }
      const waitSec = attempt * 15;
      console.log(`   ⏳ ${status || error.message} のため ${waitSec} 秒待機して再試行 (${attempt}/3)`);
      await new Promise(r => setTimeout(r, waitSec * 1000));
    }
  }

  const entries = response.data.match(/<entry>[\s\S]*?<\/entry>/g) || [];
  if (entries.length === 0) {
    throw new Error('arXIV の検索結果が空です（クエリが壊れている可能性があります）');
  }

  const postedIds = loadPostedIds();
  console.log(`   候補 ${entries.length} 件 / 投稿済み ${postedIds.length} 件`);

  for (const entry of entries) {
    const paper = parseEntry(entry);
    if (!paper) continue;
    if (postedIds.includes(paper.arxivId)) continue;

    console.log(`✅ 未投稿の論文を見つけました:`);
    console.log(`   タイトル: ${paper.title}`);
    console.log(`   arXIV ID: ${paper.arxivId}\n`);
    return paper;
  }

  console.log('ℹ️ 候補はすべて投稿済みです。新しい論文が出るまで何もしません。\n');
  return null;
}

/**
 * 要約を生成（落合陽一式フォーマット）
 */
async function generateSummary(paper) {
  try {
    console.log('📝 要約を生成中...\n');

    // Claude API で落合陽一式要約を生成
    const ochiaiSummary = await generateOchiaiSummary(paper);

    if (!ochiaiSummary) {
      throw new Error('要約が空のため処理を中止します（空記事の投稿を防止）');
    }

    const summary = {
      title: paper.title,
      authors: paper.authors,
      published: paper.published,
      summary: ochiaiSummary,
      summaryEnglish: paper.summary.substring(0, 300),
      arxivUrl: paper.arxivUrl,
      generatedAt: new Date().toISOString(),
      method: 'ochihai-claude'
    };

    console.log(`✅ 要約を生成完了（落合陽一式フォーマット）\n`);
    return summary;

  } catch (error) {
    console.error(`❌ 要約生成エラー: ${error.message}`);
    return null;
  }
}

/**
 * フルパイプライン実行
 */
async function runFullPipeline() {
  console.log('\n🚀 完全パイプライン実行\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  try {
    // 1. 論文検索
    console.log('【ステップ 1】 論文検索');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    const paper = await searchPapersFromArxiv();
    if (!paper) {
      // 重複投稿を出すより、何もしない方が良い
      console.log('投稿対象がないため終了します\n');
      return true;
    }

    // 2. 要約生成
    console.log('\n【ステップ 2】 要約生成');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    const summary = await generateSummary(paper);
    if (!summary) {
      return false;
    }

    // 3. インフォグラフィック作成
    console.log('\n【ステップ 3】 インフォグラフィック作成');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    const infographicPath = await createAndSaveInfographic(paper);

    // 4. Obsidian に記録
    console.log('\n【ステップ 4】 Obsidian に記録');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    saveToObsidian(summary);
    updateArticleIndex();
    generateExecutionLog(summary);
    updateStatistics();

    // ここで投稿済みとして記録する。以降の配信が一部失敗しても再実行で
    // 全チャンネルに重複を撒かないことを優先する（失敗はログで確認する）
    recordPosted(paper);

    // 5. Bluesky に投稿
    if (process.env.AUTO_POST_TO_BLUESKY === 'true') {
      console.log('\n【ステップ 5】 Bluesky に投稿');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      await postToBluesky(paper, summary.summary);
    }

    // 6. Zenn に投稿
    if (process.env.AUTO_POST_TO_ZENN === 'true') {
      console.log('\n【ステップ 6】 Zenn に投稿');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      await postToZenn(paper, summary.summary, infographicPath);
    }

    // 7. はてなブログに投稿
    if (process.env.AUTO_POST_TO_HATENA === 'true') {
      console.log('\n【ステップ 7】 はてなブログに投稿');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      // 画像は Zenn リポジトリにコミットされる PNG を raw URL で参照する
      const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
      const owner = process.env.GITHUB_USERNAME || 'k518-2026';
      const repo = process.env.GITHUB_REPO || 'paper-to-zenn';
      const imageUrl = infographicPath
        ? `https://raw.githubusercontent.com/${owner}/${repo}/main/images/${today}-infographic.png`
        : undefined;

      // HATENA_DRAFT=true で下書き投稿（公開せず動作確認したいとき用）
      await postToHatena(paper, summary.summary, {
        imageUrl,
        draft: process.env.HATENA_DRAFT === 'true'
      });
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n🎉 すべてのステップが完了しました！\n');

    return true;

  } catch (error) {
    console.error(`\n❌ パイプラインエラー: ${error.message}\n`);
    return false;
  }
}

/**
 * インフォグラフィックを作成して保存
 */
async function createAndSaveInfographic(paper) {
  try {
    const svgContent = createInfographic(paper);
    if (!svgContent) {
      return null;
    }

    const svgPath = saveSvgImage(svgContent);
    saveInfographicMetadata(paper, svgPath);

    // Zenn は SVG 非対応のため PNG に変換して返す
    const pngPath = await convertSvgToPng(svgPath);
    return pngPath || svgPath;

  } catch (error) {
    console.error(`⚠️ インフォグラフィック作成エラー: ${error.message}`);
    return null;
  }
}

/**
 * X 投稿ファイルを生成
 */
async function postToXWithInfographic(paper, summary, imagePath) {
  try {
    console.log('📁 X 投稿テキストを生成中...\n');
    return await generateXPostFile(paper, summary, imagePath);
  } catch (error) {
    console.error(`❌ X 投稿ファイル生成エラー: ${error.message}\n`);
    return false;
  }
}

/**
 * note 投稿手順を表示
 */
function displayNotePostInstructions(summary) {
  console.log('💡 note への手動投稿手順:\n');
  console.log('1️⃣ https://note.com/my/notes/create にアクセス');
  console.log('2️⃣ タイトル: 【論文要約】' + summary.title);
  console.log('3️⃣ 本文に以下をコピペ:\n');
  console.log(summary.summary);
  console.log('\n4️⃣ 「公開」をクリック\n');
}

// メイン実行
if (require.main === module) {
  runFullPipeline()
    .then(ok => {
      // 失敗を CI に伝えるため終了コードを立てる
      if (!ok) process.exit(1);
    })
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

module.exports = { runFullPipeline };
