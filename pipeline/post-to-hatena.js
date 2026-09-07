require('dotenv').config();
const axios = require('axios');
const crypto = require('crypto');

/**
 * WSSE 認証ヘッダを生成
 * ユーザー名ははてなID、パスワードは詳細設定の API キー（アカウントのパスワードではない）
 */
function buildWsseHeader(username, apiKey) {
  const nonce = crypto.randomBytes(20);
  const created = new Date().toISOString();
  const digest = crypto
    .createHash('sha1')
    .update(Buffer.concat([nonce, Buffer.from(created + apiKey)]))
    .digest('base64');

  return `UsernameToken Username="${username}", PasswordDigest="${digest}", Nonce="${nonce.toString('base64')}", Created="${created}"`;
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * はてなブログに投稿
 * @param {Object} paper - 論文情報
 * @param {string} summary - 落合陽一式要約（Markdown）
 * @param {Object} [options]
 * @param {boolean} [options.draft=false] - 下書きとして投稿するか
 * @param {string} [options.imageUrl] - 冒頭に挿入する画像 URL
 * @param {'html'|'markdown'} [options.format='html'] - html はこちらで変換して送るためブログの編集モードに依存しない
 * @param {string} [options.titlePrefix] - タイトルの接頭辞（比較テスト用）
 */
async function postToHatena(paper, summary, options = {}) {
  const { draft = false, imageUrl, format = 'html', titlePrefix = '' } = options;

  try {
    console.log('📤 はてなブログに投稿を開始します...\n');

    const hatenaId = process.env.HATENA_ID;
    const blogId = process.env.HATENA_BLOG_ID;
    const apiKey = process.env.HATENA_API_KEY;

    if (!hatenaId || !blogId || !apiKey) {
      throw new Error('HATENA_ID / HATENA_BLOG_ID / HATENA_API_KEY が未設定です');
    }

    const body = [
      imageUrl ? `![インフォグラフィック](${imageUrl})\n` : '',
      '## 論文情報\n',
      `- **タイトル**: ${paper.title}`,
      `- **著者**: ${paper.authors}`,
      `- **発表日**: ${paper.published}`,
      `- **arXIV**: ${paper.arxivUrl}\n`,
      '---\n',
      summary,
      '\n---\n',
      '*この記事は arXIV の新着論文から自動生成されています。*'
    ].filter(Boolean).join('\n');

    // html は marked で変換して送る（ブログの編集モード設定に左右されない）
    const contentType = format === 'html' ? 'text/html' : 'text/plain';
    const content = format === 'html' ? require('marked').parse(body) : body;

    const xml = `<?xml version="1.0" encoding="utf-8"?>
<entry xmlns="http://www.w3.org/2005/Atom" xmlns:app="http://www.w3.org/2007/app">
  <title>${escapeXml(titlePrefix + '【論文要約】' + paper.title)}</title>
  <author><name>${escapeXml(hatenaId)}</name></author>
  <content type="${contentType}">${escapeXml(content)}</content>
  <category term="論文要約" />
  <category term="教育" />
  <category term="ICT" />
  <app:control>
    <app:draft>${draft ? 'yes' : 'no'}</app:draft>
  </app:control>
</entry>`;

    const url = `https://blog.hatena.ne.jp/${hatenaId}/${blogId}/atom/entry`;

    console.log(`🔐 WSSE 認証で投稿中${draft ? '（下書き）' : ''}...`);

    const response = await axios.post(url, xml, {
      headers: {
        'X-WSSE': buildWsseHeader(hatenaId, apiKey),
        'Content-Type': 'application/atom+xml;type=entry'
      }
    });

    const entryUrl = (response.data.match(/<link rel="alternate" type="text\/html" href="([^"]+)"/) || [])[1];

    console.log('✅ はてなブログに投稿完了！');
    if (entryUrl) console.log(`🔗 ${entryUrl}`);
    if (draft) console.log('📝 下書きです。管理画面から確認してください。');
    console.log('');

    return entryUrl || true;

  } catch (error) {
    const status = error.response ? ` (HTTP ${error.response.status})` : '';
    console.error(`❌ はてなブログへの投稿に失敗${status}: ${error.message}`);
    if (error.response && error.response.status === 401) {
      console.error('   → API キーを確認してください（アカウントのパスワードでは認証できません）');
    }
    return false;
  }
}

module.exports = { postToHatena };
