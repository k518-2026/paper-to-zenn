/**
 * 記事の組み立て（Zenn の Markdown）
 *
 * ・書誌は `著者，"タイトル，" 誌名，vol.，no.，ページ，年` の形にして、論文へのリンクにする
 * ・用語リンクは本文の最初の1回だけ。長い用語を先に張る（短い語が長い語の一部を食わないように）
 * ・Zenn はタイトル70字超でデプロイ全体が止まる。slug は 12〜50 文字の英小文字・数字・-_
 */
const config = require('../config');

function authorsLabel(paper) {
  const authors = paper.authors || [];
  if (!authors.length) return '';
  return authors.length >= 4 ? authors.slice(0, 3).join(', ') + ', et al.' : authors.join(', ');
}

/** 著者，"タイトル，" 誌名，vol. 8，no. 2，pp. 97–110，2019 */
function citationText(paper) {
  const parts = [];
  const who = authorsLabel(paper);
  if (who) parts.push(who);
  parts.push('"' + String(paper.title || '').replace(/\.$/, '') + '，"');
  if (paper.venue) parts.push(paper.venue);
  if (paper.volume) parts.push('vol. ' + paper.volume);
  if (paper.issue) parts.push('no. ' + paper.issue);
  if (paper.pages) parts.push((String(paper.pages).includes('–') ? 'pp. ' : 'p. ') + paper.pages);
  if (paper.year) parts.push(String(paper.year));
  // 閉じ引用符の後ろは読点ではなく空白（… "タイトル，" 誌名 …）
  return parts.join('，').replace('，"，', '，" ');
}

function citedByText(paper, asOf) {
  return '被引用数: ' + Number(paper.citedBy || 0).toLocaleString('en-US') + '（OpenAlex, ' + asOf + ' 時点）';
}

function escapeMarkdown(text) {
  return String(text || '').replace(/([\[\]])/g, '\\$1');
}

/**
 * 本文に用語リンクを張る。目印には `{{wikilink:N}}` のような普通の文字を使う
 * （`\u0000` のような制御文字を書くと、編集ツールが実際の文字に変えてしまい壊れた）
 */
function linkifyTerms(text, links) {
  let out = escapeMarkdown(text);
  const used = [];
  [...links].sort((a, b) => b.term.length - a.term.length).forEach((link, i) => {
    const term = escapeMarkdown(link.term);
    const at = out.indexOf(term);
    if (at === -1) return;
    out = out.slice(0, at) + '{{wikilink:' + i + '}}' + out.slice(at + term.length);
    used[i] = link;
  });
  return out.replace(/\{\{wikilink:(\d+)\}\}/g, (m, i) => {
    const link = used[Number(i)];
    return link ? '[' + escapeMarkdown(link.term) + '](' + link.url + ')' : m;
  });
}

function zennSlug(paperId) {
  const base = (config.zenn.slugPrefix + String(paperId)).toLowerCase().replace(/[^a-z0-9_-]/g, '');
  return base.length >= 12 ? base.slice(0, 50) : (base + '-paper').slice(0, 50);
}

/** Zenn はタイトルが70字を超えるとデプロイ全体が止まる */
function zennTitle(title) {
  const t = config.zenn.titlePrefix + String(title || '');
  const chars = Array.from(t);
  return chars.length <= 70 ? t : chars.slice(0, 69).join('') + '…';
}

function disclaimer() {
  return 'この記事は、論文の本文（オープンアクセス版の PDF）をもとに AI が要約・翻訳したものです。' +
         '正確な内容は原論文をご確認ください。書誌と被引用数は OpenAlex によります。';
}

function buildMarkdown(paper, article, asOf) {
  const front = [
    '---',
    'title: "' + zennTitle(article.titleJa || paper.title).replace(/"/g, '') + '"',
    'emoji: "' + config.zenn.emoji + '"',
    'type: "' + config.zenn.type + '"',
    'topics: [' + config.zenn.topics.map((t) => '"' + t + '"').join(',') + ']',
    'published: true',
    '---',
    ''
  ];

  const head = [
    config.articleLead,
    '',
    '**原題**: ' + escapeMarkdown(paper.title) + '  ',
    '[' + escapeMarkdown(citationText(paper)) + '](' + paper.url + ')  ',
    citedByText(paper, asOf),
    ''
  ];

  const body = [];
  config.sections.forEach((s) => {
    body.push('## ' + s.heading, '');
    body.push(linkifyTerms(article.sections[s.key] || '', article.links), '');
    if (s.lead) {
      article.nextReads.forEach((n) => {
        body.push('- [' + escapeMarkdown(citationText(n.paper)) + '](' + n.paper.url + ')  ');
        body.push('  ' + citedByText(n.paper, asOf) + '  ');
        body.push('  ' + escapeMarkdown(n.reason));
      });
      if (article.nextReads.length) body.push('');
    }
  });

  return front.concat(head, body, [':::message', disclaimer(), ':::', '']).join('\n');
}

// ============================================================
// HTML（WordPress のメール投稿用）
// ============================================================

function escapeHtml(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 異体字セレクタとゼロ幅接合子。**正規表現リテラルに直接書かない**
// （編集ツールが実際の見えない文字に変えてしまい、あとで読めなくなる）
const INVISIBLE = new RegExp('[\\uFE00-\\uFE0F\\u200D]', 'g');
const SURROGATE_PAIR = new RegExp('[\\uD800-\\uDBFF][\\uDC00-\\uDFFF]', 'g');

/** WordPress は4バイト文字（絵文字）が化けるので落とす */
function stripAstral(text) {
  return String(text == null ? '' : text)
    .replace(SURROGATE_PAIR, '')
    .replace(INVISIBLE, '')
    .replace(/ {2,}/g, ' ');
}

/** 本文に用語リンクを張る（HTML 版）。別ウィンドウで開く */
function linkifyHtml(text, links) {
  let out = escapeHtml(text);
  const used = [];
  [...links].sort((a, b) => b.term.length - a.term.length).forEach((link, i) => {
    const term = escapeHtml(link.term);
    const at = out.indexOf(term);
    if (at === -1) return;
    out = out.slice(0, at) + '{{wikilink:' + i + '}}' + out.slice(at + term.length);
    used[i] = link;
  });
  return out.replace(/\{\{wikilink:(\d+)\}\}/g, (m, i) => {
    const link = used[Number(i)];
    return link
      ? '<a href="' + escapeHtml(link.url) + '" target="_blank" rel="noopener">' + escapeHtml(link.term) + '</a>'
      : m;
  });
}

function htmlLink(url, label) {
  return '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener">' + escapeHtml(label) + '</a>';
}

/**
 * WordPress のメール投稿に送る本文。
 * **`<hr>` と `--` は入れない**（署名とみなされ、それ以降が記事から消える）。
 * 末尾のショートコードは WordPress が解釈するので、記事本文には出ない。
 */
function buildHtml(paper, article, asOf, wp) {
  const out = [];
  out.push('<p>' + escapeHtml(config.articleLead) + '</p>');
  out.push('<p><strong>原題</strong>: ' + escapeHtml(paper.title) + '<br />' +
           htmlLink(paper.url, citationText(paper)) + '<br />' +
           escapeHtml(citedByText(paper, asOf)) + '</p>');

  config.sections.forEach((s) => {
    out.push('<h2>' + escapeHtml(s.heading) + '</h2>');
    out.push('<p>' + linkifyHtml(article.sections[s.key] || '', article.links) + '</p>');
    if (s.lead && article.nextReads.length) {
      out.push('<ul>');
      article.nextReads.forEach((n) => {
        out.push('<li>' + htmlLink(n.paper.url, citationText(n.paper)) + '<br />' +
                 escapeHtml(citedByText(n.paper, asOf)) + '<br />' + escapeHtml(n.reason) + '</li>');
      });
      out.push('</ul>');
    }
  });

  out.push('<p><small>' + escapeHtml(disclaimer()) + '</small></p>');
  out.push(shortcodes(wp));

  return stripAstral(out.join('\n'));
}

/** WordPress が解釈する指定（本文には出ない） */
function shortcodes(wp) {
  const out = [];
  if (wp.category) out.push('[category ' + wp.category + ']');
  if (wp.tags) out.push('[tags ' + wp.tags + ']');
  if (wp.draft) out.push('[status draft]');
  if (!wp.publicize) out.push('[publicize off]');
  out.push('[end]');   // これ以降（メールの署名など）を本文に含めない
  return out.join('\n');
}

/**
 * 書き上げた記事（Zenn の Markdown）を WordPress の本文に直す。
 * 記事を作り直さずに投稿だけ試したいとき（send-wp.js）に使う。
 */
function markdownToHtml(markdown, wp) {
  // Windows で取り出すと改行が CRLF になっている。先にそろえないと段落に分けられない
  const body = String(markdown).replace(/\r\n/g, '\n').replace(/^---\n[\s\S]*?\n---\n/, '');
  const out = [];
  let list = [];

  const inline = (text) => escapeHtml(text)
    .replace(/\\([\[\]])/g, '$1')                                        // Markdown の逃がしを戻す
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) =>
      '<a href="' + url + '" target="_blank" rel="noopener">' + label + '</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/  $/gm, '<br />');

  const flushList = () => {
    if (!list.length) return;
    out.push('<ul>' + list.map((li) => '<li>' + li + '</li>').join('') + '</ul>');
    list = [];
  };

  body.split(/\n{2,}/).forEach((block) => {
    const text = block.replace(/\s+$/, '');
    if (!text.trim()) return;

    if (/^## /.test(text)) { flushList(); out.push('<h2>' + escapeHtml(text.replace(/^## /, '')) + '</h2>'); return; }
    if (/^:::/.test(text)) {                                             // :::message … ::: は注記
      flushList();
      const note = text.replace(/^:::\w*\n?/, '').replace(/\n?:::$/, '').trim();
      if (note) out.push('<p><small>' + inline(note) + '</small></p>');
      return;
    }
    if (/^- /.test(text)) {
      // **タグを足してからエスケープしない**。先に inline()（逃がし＋リンク＋行末の <br />）を通し、
      // 残った改行だけを落とす。逆にすると <br /> が記事に文字で出る（2026-09-23 に WordPress で発生）
      text.split(/\n(?=- )/).forEach((item) => list.push(inline(item.replace(/^- /, '')).replace(/\n\s*/g, '')));
      return;
    }
    flushList();
    out.push('<p>' + inline(text).replace(/\n/g, '') + '</p>');
  });
  flushList();

  out.push(shortcodes(wp));
  return stripAstral(out.join('\n'));
}

module.exports = {
  buildMarkdown, buildHtml, markdownToHtml, shortcodes,
  citationText, citedByText, authorsLabel, linkifyTerms, linkifyHtml,
  zennSlug, zennTitle, escapeMarkdown, escapeHtml, stripAstral, disclaimer
};
