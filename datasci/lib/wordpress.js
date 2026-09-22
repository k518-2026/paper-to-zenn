/**
 * WordPress.com のメール投稿
 *
 * 件名がそのまま記事タイトル、本文が記事本文になる。カテゴリや公開状態は
 * 本文末尾のショートコード（[category] [tags] [publicize off] [end]）で指定する。
 *
 * 注意:
 *   ・**本文に `<hr>` や `--` を入れない**。署名とみなされ、それ以降が記事から消える
 *   ・4バイト文字（絵文字）は化けるので送る前に落とす（render.stripAstral）
 *   ・記事の URL は返ってこない。確かめたいときはブログの RSS で探す
 *
 * 必要な環境変数（このリポジトリの Secrets にすでにある）:
 *   WP_POST_EMAIL … 設定 → 執筆 → メール投稿 の秘密のアドレス
 *   SMTP_USER     … 送信元（Gmail なら自分のアドレス）
 *   SMTP_PASSWORD … Gmail はアプリパスワード
 *   SMTP_HOST / SMTP_PORT … 任意。既定は Gmail（smtp.gmail.com:465）
 */
const config = require('../config');
const { buildHtml, stripAstral } = require('./render');

/** テストが差し替えられるように、送信の口を分けてある */
function createTransport() {
  const nodemailer = require('nodemailer');
  const port = Number(process.env.SMTP_PORT || 465);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
  });
}

function available() {
  return ['WP_POST_EMAIL', 'SMTP_USER', 'SMTP_PASSWORD']
    .every((k) => (process.env[k] || '').trim());
}

/** 記事をメールで送る。送れたら件名を返す */
async function sendArticle(paper, article, asOf) {
  const subject = stripAstral(config.wordpress.titlePrefix + (article.titleJa || paper.title));
  const html = buildHtml(paper, article, asOf, config.wordpress);

  const info = await module.exports.createTransport().sendMail({
    from: '"' + config.wordpress.senderName + '" <' + process.env.SMTP_USER + '>',
    to: process.env.WP_POST_EMAIL,
    subject,
    text: 'このメールはHTMLで作成されています。',
    html
  });
  return { subject, messageId: (info || {}).messageId || '' };
}

module.exports = { sendArticle, createTransport, available };
