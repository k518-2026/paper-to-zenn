require('dotenv').config();
const fs = require('fs');
const path = require('path');

/**
 * X 投稿テキストを生成してファイルに保存
 * @param {Object} paper - 論文データ
 * @param {string} summary - 要約テキスト
 * @param {string} imagePath - インフォグラフィック画像パス
 */
async function generateXPostFile(paper, summary, imagePath) {
  try {
    console.log('\n📱 X 投稿テキスト生成\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // 短いテキスト（140文字以内）
    const shortText = `📚 教育論文の自動要約を開始！最新の学習技術研究を毎日投稿 🔗 note.com/yamamoto.k518 #教育 #ICT`;

    // 長いテキスト（参考用）
    const longText = `📚 新しい論文が追加されました!

📖 "${paper.title}"

👥 著者: ${paper.authors}
📅 公開日: ${paper.published}

📝 要約:
${summary.substring(0, 200)}...

🔗 詳細は note.com/yamamoto.k518 で確認できます

#教育 #ICT活用 #研究 #論文要約`;

    // 投稿データを構造化
    const postData = {
      timestamp: new Date().toISOString(),
      paper: {
        title: paper.title,
        authors: paper.authors,
        published: paper.published,
        arxivUrl: paper.arxivUrl
      },
      posts: {
        short: {
          text: shortText,
          charCount: shortText.length,
          maxChars: 140,
          note: 'X 無料版の 140 文字制限対応'
        },
        long: {
          text: longText,
          charCount: longText.length,
          note: '参考用の長めバージョン'
        }
      },
      infographic: imagePath ? path.basename(imagePath) : null,
      instructions: {
        method1: 'X にログインして、以下のテキストをコピペして投稿',
        method2: 'または、X API を使用して自動投稿（API キーが必要）'
      }
    };

    // ファイルに保存
    const postsDir = path.join(__dirname, 'posts');
    if (!fs.existsSync(postsDir)) {
      fs.mkdirSync(postsDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filePath = path.join(postsDir, `x-post-${timestamp}.json`);

    fs.writeFileSync(filePath, JSON.stringify(postData, null, 2));

    console.log('✅ 投稿テキストを保存しました\n');
    console.log(`📍 ファイル: ${filePath}\n`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('📝 短いバージョン（推奨）:\n');
    console.log(shortText);
    console.log(`\n📊 文字数: ${shortText.length}/140\n`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('💡 X への投稿方法:\n');
    console.log('1️⃣ https://x.com に手動でログイン');
    console.log('2️⃣ 上記のテキストをコピー');
    console.log('3️⃣ ツイート作成フォームにペースト');
    console.log('4️⃣ インフォグラフィックを添付（必要に応じて）');
    console.log('5️⃣ 「投稿」をクリック\n');

    if (imagePath && fs.existsSync(imagePath)) {
      console.log(`📎 インフォグラフィック: ${path.basename(imagePath)}`);
      console.log(`📍 パス: ${imagePath}\n`);
    }

    console.log('⚠️ 今後 X API を設定した場合、自動投稿に対応予定です。\n');

    return true;

  } catch (error) {
    console.error(`\n❌ エラー: ${error.message}\n`);
    return false;
  }
}

/**
 * メイン処理
 */
async function main(paper, summary, imagePath = null) {
  if (!paper || !summary) {
    console.error('❌ 論文データまたは要約データが不足しています');
    return false;
  }

  return await generateXPostFile(paper, summary, imagePath);
}

module.exports = {
  generateXPostFile,
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

  const testSummary = 'この論文は大学教育におけるビッグデータ工学の学生の認識について調査しています。教育技術とデジタル学習の重要性が強調されています。';
  const testImagePath = 'E:\\paper-to-note\\infographics\\infographic_2026-09-07.svg';

  main(testPaper, testSummary, testImagePath);
}
