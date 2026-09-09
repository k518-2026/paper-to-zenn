require('dotenv').config();
const nodemailer = require('nodemailer');

/**
 * WordPress.com の「メール投稿」機能へ記事を送る。
 *
 * 件名がそのまま記事タイトル、本文が記事本文になる。
 * カテゴリや公開状態は本文末尾のショートコードで指定する。
 *
 * 【WordPress 側の制約】
 * 4バイト文字（絵文字）は「?」に化ける。保存経路が utf8mb4 に対応していないため、
 * 送る側で落とすしかない。▶ ■ などBMP内の記号は3バイトなので影響を受けない。
 *
 * 【必要な環境変数】
 *   WP_POST_EMAIL     … 設定→執筆→メール投稿 で発行される秘密のアドレス
 *   SMTP_USER         … 送信元アドレス（Gmail なら自分のアドレス）
 *   SMTP_PASSWORD     … Gmail はアプリパスワード。通常のパスワードでは送れない
 *   SMTP_HOST/PORT    … 任意。既定は Gmail
 */

const CONFIG = {
  category: process.env.WP_CATEGORY || '論文紹介',
  tags: process.env.WP_TAGS || '論文,教育,J-STAGE',
  draft: String(process.env.WP_DRAFT || '').toLowerCase() === 'true',
  publicize: String(process.env.WP_PUBLICIZE || '').toLowerCase() === 'true'
};

/** BMP外（UTF-8で4バイト）の文字を取り除く */
function stripAstral(s) {
  return String(s == null ? '' : s)
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')
    .replace(/[\uFE00-\uFE0F\u200D]/g, '')
    .replace(/ {2,}/g, ' ');
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 要約テキスト（Markdown 混じり）を素朴に HTML へ変換する */
function toHtmlParagraphs(text) {
  return String(text)
    .split(/\n{2,}/)
    .map(block => {
      const t = block.trim();
      if (!t) return '';
      const html = escapeHtml(t)
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n/g, '<br>');
      return `<p>${html}</p>`;
    })
    .filter(Boolean)
    .join('\n');
}

function buildBody(paper, summary) {
  const parts = [];

  parts.push('<h2>論文情報</h2>');
  parts.push('<ul>');
  parts.push(`<li>タイトル: ${escapeHtml(paper.title)}</li>`);
  if (paper.authors) parts.push(`<li>著者: ${escapeHtml(paper.authors)}</li>`);
  if (paper.journal) parts.push(`<li>掲載誌: ${escapeHtml(paper.journal)}（${escapeHtml(paper.year)}年）</li>`);
  if (paper.doi) parts.push(`<li>DOI: ${escapeHtml(paper.doi)}</li>`);
  parts.push('</ul>');

  parts.push('<h2>要約</h2>');
  parts.push(toHtmlParagraphs(summary));

  parts.push(`<p><a href="${escapeHtml(paper.url)}" target="_blank" rel="noopener">▶ J-STAGE で元の論文を読む</a></p>`);

  parts.push('<hr />');
  parts.push('<p><small>この記事は論文の要旨をもとに自動生成しています。'
    + '正確な内容は元論文をご確認ください。</small></p>');

  // WordPress.com のメール投稿が解釈する指定子。記事本文には出力されない
  if (CONFIG.category) parts.push(`[category ${CONFIG.category}]`);
  if (CONFIG.tags) parts.push(`[tags ${CONFIG.tags}]`);
  if (CONFIG.draft) parts.push('[status draft]');
  if (!CONFIG.publicize) parts.push('[publicize off]');
  parts.push('[end]');  // これ以降（署名など）を本文に含めない

  return stripAstral(parts.join('\n'));
}

async function postToWordPress(paper, summary) {
  const to = process.env.WP_POST_EMAIL;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;

  if (!to || !user || !pass) {
    throw new Error('WP_POST_EMAIL / SMTP_USER / SMTP_PASSWORD が設定されていません');
  }

  console.log('📤 WordPress にメール投稿します...');

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 465),
    secure: Number(process.env.SMTP_PORT || 465) === 465,
    auth: { user, pass }
  });

  const info = await transporter.sendMail({
    from: `"論文紹介Bot" <${user}>`,
    to,
    subject: stripAstral(paper.title),
    text: 'このメールはHTMLで作成されています。テキスト版は用意していません。',
    html: buildBody(paper, summary)
  });

  console.log(`✅ WordPress へ送信しました${CONFIG.draft ? '（下書き）' : ''}: ${info.messageId}\n`);
  return info.messageId;
}

module.exports = { postToWordPress, buildBody, stripAstral };
