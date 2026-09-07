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
 * arXIV から論文を検索
 */
async function searchPapersFromArxiv() {
  try {
    console.log('📚 arXIV から論文を検索中...\n');

    // cs.CY (Computers and Society) に限定したうえで教育系キーワードで絞る
    const keywords = ['education', 'educational', 'learning', 'teaching', 'classroom', 'student'];
    const keywordQuery = keywords.map(k => `abs:"${k}"`).join(' OR ');
    const query = `cat:cs.CY AND (${keywordQuery})`;
    const url = `http://export.arxiv.org/api/query?search_query=${encodeURIComponent(query)}&start=0&max_results=1&sortBy=submittedDate&sortOrder=descending`;

    const response = await axios.get(url);
    const xml = response.data;

    // 最初の entry タグを抽出
    const entryMatch = xml.match(/<entry>([\s\S]*?)<\/entry>/);

    if (!entryMatch) {
      console.log('❌ entry タグが見つかりません');
      return null;
    }

    const entry = entryMatch[1];

    // タグをパース（複数の author タグがあるため最初のものを使用）
    const titleMatch = entry.match(/<title>(.*?)<\/title>/);
    const authorMatch = entry.match(/<author>\s*<name>(.*?)<\/name>/);
    const summaryMatch = entry.match(/<summary>([\s\S]*?)<\/summary>/);
    const idMatch = entry.match(/<id>(http:\/\/arxiv\.org\/abs\/[\d.]+)/);
    const publishedMatch = entry.match(/<published>([\d-]+)/);

    if (titleMatch && summaryMatch && idMatch) {
      const paper = {
        title: titleMatch[1].trim(),
        author: authorMatch ? authorMatch[1].trim() : 'Unknown',
        authors: authorMatch ? authorMatch[1].trim() : 'Unknown',
        summary: summaryMatch[1].trim(),
        url: idMatch[1],
        arxivUrl: idMatch[1],
        arxivId: idMatch[1].split('/').pop(),
        published: publishedMatch ? publishedMatch[1] : 'Unknown'
      };

      console.log(`✅ 論文を見つけました:`);
      console.log(`   タイトル: ${paper.title}\n`);

      return paper;
    }

    return null;

  } catch (error) {
    console.error(`❌ 論文検索エラー: ${error.message}`);
    return null;
  }
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
      console.error('論文が見つかりませんでした');
      return false;
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
  runFullPipeline().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { runFullPipeline };
