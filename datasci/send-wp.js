/**
 * WordPress への投稿だけを試す
 *
 *   node datasci/send-wp.js                いちばん新しい記事を下書きとして送る
 *   node datasci/send-wp.js datasci-w123   記事を指定して送る（slug かファイル名）
 *   node datasci/send-wp.js --publish      下書きではなく公開して送る
 *   node datasci/send-wp.js --show         送らずに、送る中身（件名と本文）を表示する
 *
 * 記事は作り直さない（Gemini を使わない）。すでに articles/ にある Markdown を
 * WordPress の本文に直して送るだけなので、メールの設定だけを確かめられる。
 * 既定は **下書き** なので、確かめ終わるまでブログには出ない。
 */
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { markdownToHtml, stripAstral } = require('./lib/render');
const wordpress = require('./lib/wordpress');

const ROOT = path.join(__dirname, '..');

function articleFile(name) {
  const dir = path.join(ROOT, config.paths.articles);
  if (name) {
    const file = path.join(dir, name.endsWith('.md') ? name : name + '.md');
    if (!fs.existsSync(file)) throw new Error('記事が見つかりません: ' + path.relative(ROOT, file));
    return file;
  }
  // 指定が無ければ、この仕組みが作ったいちばん新しい記事
  const mine = fs.readdirSync(dir)
    .filter((f) => f.startsWith(config.zenn.slugPrefix) && f.endsWith('.md'))
    .map((f) => ({ f, at: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.at - a.at);
  if (!mine.length) throw new Error('記事がまだありません（' + config.zenn.slugPrefix + '*.md）');
  return path.join(dir, mine[0].f);
}

/** フロントマターの title から件名を作る */
function subjectOf(markdown, fallback) {
  const m = String(markdown).replace(/\r\n/g, '\n').match(/^---\n[\s\S]*?\btitle:\s*"([^"]+)"/);
  return stripAstral(m ? m[1] : config.wordpress.titlePrefix + fallback);
}

async function main() {
  const args = process.argv.slice(2);
  const publish = args.includes('--publish');
  const show = args.includes('--show');
  const name = args.filter((a) => !a.startsWith('--'))[0] || '';

  const file = articleFile(name);
  const markdown = fs.readFileSync(file, 'utf8');
  const subject = subjectOf(markdown, path.basename(file, '.md'));
  const html = markdownToHtml(markdown, { ...config.wordpress, draft: !publish });

  console.log('記事: ' + path.relative(ROOT, file));
  console.log('件名: ' + subject);
  console.log('扱い: ' + (publish ? '公開' : '下書き（--publish で公開にできます）'));

  if (show) {
    console.log('\n---- ここから本文 ----\n' + html + '\n---- ここまで ----');
    return;
  }
  if (!wordpress.available()) {
    throw new Error('WP_POST_EMAIL / SMTP_USER / SMTP_PASSWORD が設定されていません');
  }

  const info = await wordpress.createTransport().sendMail({
    from: '"' + config.wordpress.senderName + '" <' + process.env.SMTP_USER + '>',
    to: process.env.WP_POST_EMAIL,
    subject,
    text: 'このメールはHTMLで作成されています。',
    html
  });
  console.log('送りました: ' + ((info || {}).messageId || '(ID なし)'));
  console.log('WordPress の「投稿一覧」で確認してください（下書きなら下書きに入ります）。');
}

if (require.main === module) {
  main().catch((e) => {
    console.error('失敗しました: ' + e.message);
    process.exit(1);
  });
}

module.exports = { articleFile, subjectOf };
