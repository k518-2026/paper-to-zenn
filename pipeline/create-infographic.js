const fs = require('fs');
const path = require('path');

/**
 * 論文情報からインフォグラフィック（SVG）を生成
 * @param {Object} paper - 論文データ
 * @returns {string} SVG コンテンツ
 */
function createInfographic(paper) {
  try {
    console.log('🎨 インフォグラフィックを作成中...\n');

    // 論文タイトルを縮約
    const shortTitle = paper.title.length > 50
      ? paper.title.substring(0, 47) + '...'
      : paper.title;

    // 著者名を縮約
    const shortAuthors = paper.authors.length > 60
      ? paper.authors.substring(0, 57) + '...'
      : paper.authors;

    // SVG でインフォグラフィックを生成
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <!-- 背景 -->
  <defs>
    <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#667eea;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#764ba2;stop-opacity:1" />
    </linearGradient>
  </defs>

  <rect width="1200" height="630" fill="url(#grad1)"/>

  <!-- タイトルバー -->
  <rect x="0" y="0" width="1200" height="100" fill="#ffffff" opacity="0.95"/>

  <!-- 論文タイトル -->
  <text x="50" y="50" font-size="36" font-weight="bold" fill="#333333" font-family="Arial, sans-serif">
    📚 論文要約
  </text>

  <!-- メインコンテンツ背景 -->
  <rect x="40" y="120" width="1120" height="470" fill="#ffffff" rx="15" opacity="0.95"/>

  <!-- 左側：論文情報 -->
  <g>
    <!-- タイトルセクション -->
    <text x="80" y="170" font-size="24" font-weight="bold" fill="#667eea" font-family="Arial, sans-serif">
      📖 タイトル
    </text>
    <text x="80" y="210" font-size="18" fill="#333333" font-family="Arial, sans-serif" word-spacing="5">
      ${shortTitle}
    </text>

    <!-- 著者セクション -->
    <text x="80" y="260" font-size="24" font-weight="bold" fill="#667eea" font-family="Arial, sans-serif">
      👥 著者
    </text>
    <text x="80" y="300" font-size="16" fill="#666666" font-family="Arial, sans-serif">
      ${shortAuthors}
    </text>

    <!-- 日付セクション -->
    <text x="80" y="350" font-size="24" font-weight="bold" fill="#667eea" font-family="Arial, sans-serif">
      📅 発表日
    </text>
    <text x="80" y="390" font-size="18" fill="#333333" font-family="Arial, sans-serif" font-weight="bold">
      ${paper.published}
    </text>
  </g>

  <!-- 右側：ハイライト情報 -->
  <g>
    <!-- ハイライトボックス1 -->
    <rect x="650" y="160" width="480" height="120" fill="#f0f4ff" rx="10" stroke="#667eea" stroke-width="2"/>
    <text x="680" y="190" font-size="18" font-weight="bold" fill="#667eea" font-family="Arial, sans-serif">
      🔍 主要テーマ
    </text>
    <text x="680" y="230" font-size="14" fill="#333333" font-family="Arial, sans-serif">
      ICT活用教育 | デジタル学習
    </text>
    <text x="680" y="255" font-size="14" fill="#333333" font-family="Arial, sans-serif">
      教育技術 | 学習成果
    </text>

    <!-- ハイライトボックス2 -->
    <rect x="650" y="310" width="480" height="140" fill="#fff0f4" rx="10" stroke="#764ba2" stroke-width="2"/>
    <text x="680" y="340" font-size="18" font-weight="bold" fill="#764ba2" font-family="Arial, sans-serif">
      💡 要約のポイント
    </text>
    <text x="680" y="380" font-size="13" fill="#333333" font-family="Arial, sans-serif">
      教育の未来を形作る最新研究
    </text>
    <text x="680" y="405" font-size="13" fill="#333333" font-family="Arial, sans-serif">
      実践的な学習戦略の提示
    </text>
    <text x="680" y="430" font-size="13" fill="#333333" font-family="Arial, sans-serif">
      デジタル時代の教育課題に対応
    </text>
  </g>

  <!-- フッター -->
  <rect x="0" y="610" width="1200" height="20" fill="#333333"/>
  <text x="50" y="622" font-size="12" fill="#ffffff" font-family="Arial, sans-serif">
    📰 Paper-to-Note Daily | arXIV 論文要約 | ${new Date().toLocaleDateString('ja-JP')}
  </text>

  <!-- arXIV リンク情報 -->
  <text x="900" y="622" font-size="12" fill="#ffffff" font-family="Arial, sans-serif" text-anchor="end">
    🔗 詳細は note.com/yamamoto.k518 で
  </text>
</svg>`;

    return svg;

  } catch (error) {
    console.error(`❌ インフォグラフィック生成エラー: ${error.message}`);
    return null;
  }
}

/**
 * SVG を画像ファイルで保存
 * @param {string} svgContent - SVG コンテンツ
 * @param {string} filename - 保存ファイル名
 * @returns {string} 保存パス
 */
function saveSvgImage(svgContent, filename = null) {
  try {
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
    const defaultFilename = `infographic_${today}.svg`;
    const filepath = path.join(__dirname, 'infographics', filename || defaultFilename);

    // infographics フォルダを作成
    const dir = path.dirname(filepath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // SVG ファイルを保存
    fs.writeFileSync(filepath, svgContent, 'utf-8');
    console.log(`✅ インフォグラフィックを保存: ${filepath}`);

    return filepath;

  } catch (error) {
    console.error(`❌ ファイル保存エラー: ${error.message}`);
    return null;
  }
}

/**
 * SVG を PNG に変換（Zenn は SVG 非対応のため）
 * @param {string} svgPath - 変換元 SVG のパス
 * @returns {Promise<string|null>} PNG の保存パス
 */
async function convertSvgToPng(svgPath) {
  const { chromium } = require('playwright');
  let browser;

  try {
    const pngPath = svgPath.replace(/\.svg$/i, '.png');
    const svgContent = fs.readFileSync(svgPath, 'utf-8');

    browser = await chromium.launch();
    const page = await browser.newPage({
      viewport: { width: 1200, height: 630 },
      deviceScaleFactor: 2
    });

    await page.setContent(
      `<body style="margin:0">${svgContent}</body>`,
      { waitUntil: 'load' }
    );
    await page.screenshot({ path: pngPath });

    console.log(`✅ PNG に変換: ${path.basename(pngPath)}`);
    return pngPath;

  } catch (error) {
    console.error(`⚠️ PNG 変換エラー: ${error.message}`);
    return null;

  } finally {
    if (browser) await browser.close();
  }
}

/**
 * インフォグラフィック情報を JSON で保存
 */
function saveInfographicMetadata(paper, svgPath) {
  try {
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
    const metadataPath = path.join(__dirname, 'infographics', `${today}_metadata.json`);

    const metadata = {
      date: new Date().toISOString(),
      paper: {
        title: paper.title,
        authors: paper.authors,
        published: paper.published,
        arxivUrl: paper.arxivUrl
      },
      infographic: {
        path: svgPath,
        format: 'SVG',
        width: 1200,
        height: 630
      },
      postedTo: {
        x: false,
        note: false
      }
    };

    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
    console.log(`📝 メタデータを保存: ${metadataPath}`);

    return metadata;

  } catch (error) {
    console.error(`⚠️ メタデータ保存エラー: ${error.message}`);
    return null;
  }
}

/**
 * メイン処理
 */
function main(paperData) {
  console.log('\n🎨 インフォグラフィック生成プロセス\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (!paperData) {
    console.error('❌ 論文データがありません');
    return false;
  }

  try {
    // 1. SVG を生成
    const svgContent = createInfographic(paperData);
    if (!svgContent) {
      return false;
    }

    // 2. SVG を保存
    const svgPath = saveSvgImage(svgContent);
    if (!svgPath) {
      return false;
    }

    // 3. メタデータを保存
    const metadata = saveInfographicMetadata(paperData, svgPath);

    console.log('\n✅ インフォグラフィック生成完了！\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    return { svgPath, metadata };

  } catch (error) {
    console.error(`\n❌ エラー: ${error.message}\n`);
    return false;
  }
}

module.exports = {
  createInfographic,
  saveSvgImage,
  convertSvgToPng,
  saveInfographicMetadata,
  main
};

// テスト用
if (require.main === module) {
  const testPaper = {
    title: 'Students\' Perception of Big Data Engineering in Higher Education Curricula',
    authors: 'Ioana-Georgiana Ciuciu, Petrescu Manuela-Andreea',
    published: '2026-09-04',
    arxivUrl: 'https://arxiv.org/abs/2609.05160'
  };

  main(testPaper);
}
