const fs = require('fs');
const path = require('path');

/**
 * 論文情報からインフォグラフィック（SVG）を生成
 * @param {Object} paper - 論文データ
 * @returns {string} SVG コンテンツ
 */
const FONTS = "'Noto Sans CJK JP','Noto Sans JP','Yu Gothic','Hiragino Sans','Meiryo',sans-serif";

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 全角は1、半角は0.55として文字幅を概算する */
function visualWidth(str) {
  let w = 0;
  for (const ch of str) w += /[　-ヿ一-鿿＀-｠]/.test(ch) ? 1 : 0.55;
  return w;
}

const CJK = /[　-ヿ一-鿿＀-｠]/;
/** 行頭に置けない文字（句読点・閉じ括弧） */
const NO_LINE_START = /[、。，．）」』】〉》〕｝〙〗！？：；ー]/;
/** 行末に置けない文字（開き括弧） */
const NO_LINE_END = /[（「『【〈《〔｛〘〖]/;

/**
 * 指定幅（em単位）で折り返す
 * 日本語は単語間に空白がないため、空白ではなく文字単位で改行位置を決める
 */
function wrapText(str, maxUnits, maxLines) {
  const chars = [...str.trim()];
  const lines = [];
  let line = '';

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (visualWidth(line + ch) <= maxUnits) {
      line += ch;
      continue;
    }

    // 行頭禁則: 句読点や閉じ括弧が次行の先頭に来るならこの行に含める
    if (NO_LINE_START.test(ch)) {
      line += ch;
      continue;
    }

    // 欧文の途中なら直前の空白まで戻して単語を割らない
    let carry = '';
    if (!CJK.test(ch) && ch !== ' ') {
      const lastSpace = line.lastIndexOf(' ');
      if (lastSpace > maxUnits * 0.4) {
        carry = line.slice(lastSpace + 1);
        line = line.slice(0, lastSpace);
      }
    }

    // 行末禁則: 開き括弧で終わるなら次行へ送る
    if (NO_LINE_END.test(line[line.length - 1])) {
      carry = line[line.length - 1] + carry;
      line = line.slice(0, -1);
    }

    lines.push(line.trim());
    line = carry + ch;

    if (lines.length === maxLines) {
      lines[maxLines - 1] = lines[maxLines - 1].replace(/[\s、。,.;:]+$/, '') + '…';
      return lines;
    }
  }

  if (line.trim()) lines.push(line.trim());
  return lines;
}

/** 落合式要約から「どんなもの？」の本文を1文取り出す */
function extractConcept(summary) {
  if (!summary) return null;

  const section = summary.match(/##\s*0\.[^\n]*\n+([\s\S]*?)(?=\n#{1,3}\s|\n---|$)/);
  let text = section ? section[1] : null;

  if (!text) {
    // 見出し・強調・箇条書きを除いた最初の段落を使う
    const para = summary
      .split(/\n\s*\n/)
      .map(p => p.trim())
      .find(p => p && !p.startsWith('#') && !p.startsWith('-') && !p.startsWith('**') && !p.startsWith('>'));
    text = para || null;
  }
  if (!text) return null;

  return text
    .replace(/\*\*/g, '')
    .replace(/[*`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function createInfographic(paper, summary) {
  try {
    console.log('🎨 インフォグラフィックを作成中...\n');

    // 描画幅 1056px を font-size で割った値が1行あたりの上限
    const titleLines = wrapText(paper.title, 23, 3);

    const concept = extractConcept(summary);
    const conceptLines = concept ? wrapText(concept, 47, 4) : [];

    const authors = paper.authors.length > 44
      ? paper.authors.substring(0, 43) + '…'
      : paper.authors;

    const today = new Date().toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' });

    // タイトルは行数に応じて上に伸ばし、下の要素と衝突させない
    const titleTop = 214 - (titleLines.length - 1) * 30;

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0B1220"/>
      <stop offset="55%" stop-color="#141E33"/>
      <stop offset="100%" stop-color="#1B2942"/>
    </linearGradient>
    <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#38BDF8"/>
      <stop offset="100%" stop-color="#818CF8"/>
    </linearGradient>
    <radialGradient id="glow" cx="88%" cy="8%" r="55%">
      <stop offset="0%" stop-color="#38BDF8" stop-opacity="0.30"/>
      <stop offset="100%" stop-color="#38BDF8" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#glow)"/>

  <!-- 左端のアクセント -->
  <rect x="0" y="0" width="8" height="630" fill="url(#accent)"/>

  <!-- ヘッダー -->
  <text x="72" y="86" font-family=${JSON.stringify(FONTS)} font-size="15" font-weight="700"
        fill="#7DD3FC" letter-spacing="3.5">arXiv · cs.CY</text>
  <text x="1128" y="86" font-family=${JSON.stringify(FONTS)} font-size="15" font-weight="600"
        fill="#64748B" text-anchor="end" letter-spacing="1.5">Paper-to-Note Daily</text>
  <line x1="72" y1="108" x2="1128" y2="108" stroke="#1E293B" stroke-width="1"/>

  <!-- 論文タイトル -->
  <text x="72" y="${titleTop}" font-family=${JSON.stringify(FONTS)} font-size="44" font-weight="700" fill="#F1F5F9">
${titleLines.map((l, i) => `    <tspan x="72" dy="${i === 0 ? 0 : 60}">${escapeXml(l)}</tspan>`).join('\n')}
  </text>

  <!-- 概要（要約が無い場合は描画しない） -->
${conceptLines.length ? `  <rect x="72" y="306" width="5" height="${conceptLines.length * 38 - 8}" rx="2.5" fill="url(#accent)"/>
  <text x="102" y="332" font-family=${JSON.stringify(FONTS)} font-size="21" fill="#CBD5E1">
${conceptLines.map((l, i) => `    <tspan x="102" dy="${i === 0 ? 0 : 38}">${escapeXml(l)}</tspan>`).join('\n')}
  </text>` : ''}

  <!-- メタ情報 -->
  <line x1="72" y1="498" x2="1128" y2="498" stroke="#1E293B" stroke-width="1"/>

  <text x="72" y="536" font-family=${JSON.stringify(FONTS)} font-size="13" font-weight="700"
        fill="#475569" letter-spacing="2">AUTHOR</text>
  <text x="72" y="566" font-family=${JSON.stringify(FONTS)} font-size="20" fill="#E2E8F0">${escapeXml(authors)}</text>

  <text x="700" y="536" font-family=${JSON.stringify(FONTS)} font-size="13" font-weight="700"
        fill="#475569" letter-spacing="2">SUBMITTED</text>
  <text x="700" y="566" font-family=${JSON.stringify(FONTS)} font-size="20" fill="#E2E8F0">${escapeXml(paper.published)}</text>

  <text x="920" y="536" font-family=${JSON.stringify(FONTS)} font-size="13" font-weight="700"
        fill="#475569" letter-spacing="2">arXiv ID</text>
  <text x="920" y="566" font-family=${JSON.stringify(FONTS)} font-size="20" fill="#7DD3FC">${escapeXml(paper.arxivId || '—')}</text>

  <text x="1128" y="600" font-family=${JSON.stringify(FONTS)} font-size="13"
        fill="#334155" text-anchor="end">${escapeXml(today)}</text>
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
