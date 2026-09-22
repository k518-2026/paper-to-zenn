/**
 * 下書きの記事を「公開」にする
 *
 *   node datasci/publish.js                いちばん新しい下書きを公開にする
 *   node datasci/publish.js datasci-w123   記事を指定する
 *   node datasci/publish.js --list         下書きの一覧を出す
 *
 * 記事は下書き（published: false）として作られる。**公開するかどうかは人が決める。**
 * Zenn は「人が主体となって情報を発信する場」を掲げ、公開前に内容を検証することを求めている。
 * 目を通し、必要なら自分の見解を書き足してから公開する。
 *
 * ファイルを書き換えるだけ。コミットとプッシュはワークフロー（zenn-publish.yml）か手元で行う。
 */
const fs = require('fs');
const path = require('path');
const config = require('./config');

const ROOT = path.join(__dirname, '..');
const dir = () => path.join(ROOT, config.paths.articles);

function isDraft(text) {
  return /^---\n[\s\S]*?\npublished:\s*false\s*$/m.test(String(text).replace(/\r\n/g, '\n'));
}

/** 下書きの記事（新しい順） */
function drafts() {
  return fs.readdirSync(dir())
    .filter((f) => f.startsWith(config.zenn.slugPrefix) && f.endsWith('.md'))
    .filter((f) => isDraft(fs.readFileSync(path.join(dir(), f), 'utf8')))
    .map((f) => ({ file: f, at: fs.statSync(path.join(dir(), f)).mtimeMs }))
    .sort((a, b) => b.at - a.at)
    .map((x) => x.file);
}

/** フロントマターの published を true にする。変えたら true */
function publish(file) {
  const before = fs.readFileSync(file, 'utf8');
  const after = before.replace(/^(published:\s*)false\s*$/m, '$1true');
  if (after === before) return false;
  fs.writeFileSync(file, after, 'utf8');
  return true;
}

function main() {
  const args = process.argv.slice(2);
  const list = drafts();

  if (args.includes('--list')) {
    console.log(list.length ? '下書きの記事:\n  ' + list.join('\n  ') : '下書きはありません。');
    return;
  }

  const name = args.filter((a) => !a.startsWith('--'))[0] || '';
  const target = name ? (name.endsWith('.md') ? name : name + '.md') : list[0];
  if (!target) throw new Error('公開できる下書きがありません。');

  const file = path.join(dir(), target);
  if (!fs.existsSync(file)) throw new Error('記事が見つかりません: ' + target);

  if (!publish(file)) throw new Error(target + ' は下書きではありません（すでに公開）。');
  console.log('公開にしました: ' + config.paths.articles + '/' + target);
  console.log('Zenn は投稿数の上限（直近24時間）があるため、すぐに出ないことがあります。');
}

if (require.main === module) {
  try { main(); } catch (e) { console.error('失敗しました: ' + e.message); process.exit(1); }
}

module.exports = { drafts, publish, isDraft };
