require('dotenv').config();
const axios = require('axios');

/**
 * Bluesky API を使用して投稿
 */
async function postToBluesky(paper, summary) {
  try {
    console.log('📤 Bluesky に投稿を開始します...\n');

    // Bluesky API クライアント
    const client = axios.create({
      baseURL: 'https://bsky.social/xrpc',
      timeout: 10000
    });

    // 認証
    console.log('🔐 Bluesky にログイン中...');
    const authResponse = await client.post('/com.atproto.server.createSession', {
      identifier: process.env.BLUESKY_EMAIL,
      password: process.env.BLUESKY_PASSWORD
    });

    const { accessJwt, did } = authResponse.data;
    console.log('✅ ログイン成功\n');

    // 認証トークンを設定
    client.defaults.headers.common['Authorization'] = `Bearer ${accessJwt}`;

    // 投稿テキストを作成（300文字以内）
    console.log('📝 投稿を作成中...');

    const arxivId = paper.arxivUrl.split('/').pop();
    const postText = `【論文】${paper.title.substring(0, 30)}...

📖 著者: ${paper.authors.substring(0, 20)}
📅 ${paper.published}

要約: ${summary.substring(0, 130)}...

🔗 https://arxiv.org/abs/${arxivId}

#教育 #ICT #研究`;

    console.log(`📊 文字数: ${postText.length}/300`);

    // URL リンクカード
    const now = new Date().toISOString();
    const urlStart = postText.indexOf('https://arxiv.org');
    const urlEnd = urlStart + `https://arxiv.org/abs/${arxivId}`.length;

    const record = {
      text: postText,
      createdAt: now,
      facets: [
        {
          index: {
            byteStart: urlStart,
            byteEnd: urlEnd
          },
          features: [
            {
              $type: 'app.bsky.richtext.facet#link',
              uri: `https://arxiv.org/abs/${arxivId}`
            }
          ]
        }
      ]
    };

    // 投稿
    console.log('🚀 Bluesky に投稿中...');
    const postResponse = await client.post('/com.atproto.repo.createRecord', {
      repo: did,
      collection: 'app.bsky.feed.post',
      record: record
    });

    const { uri } = postResponse.data;
    console.log('✅ Bluesky に投稿完了！');
    console.log(`📄 投稿 URI: ${uri}`);
    console.log(`🔗 投稿リンク: https://bsky.app/profile/${did.split('#')[0]}/post/${uri.split('/').pop()}\n`);

    return true;

  } catch (error) {
    console.error(`\n❌ Bluesky への投稿に失敗: ${error.message}\n`);
    if (error.response?.data) {
      console.error('エラー詳細:', error.response.data);
    }
    return false;
  }
}

/**
 * メイン処理
 */
async function main(paper, summary) {
  console.log('\n📱 Bluesky への投稿プロセス\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (!paper || !summary) {
    console.error('❌ 論文データまたは要約データが不足しています');
    return false;
  }

  try {
    const posted = await postToBluesky(paper, summary);

    if (posted) {
      console.log('✅ Bluesky への投稿が完了しました!');
      return true;
    } else {
      console.log('⚠️ Bluesky への投稿に問題が発生しました');
      return false;
    }

  } catch (error) {
    console.error(`\n❌ エラー: ${error.message}\n`);
    return false;
  }
}

module.exports = {
  postToBluesky,
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

  main(testPaper, testSummary);
}
