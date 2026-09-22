/**
 * 専門用語のリンク（日本語版 Wikipedia）
 *
 * ・項目が実在するかを必ず API で確かめる（「効果量」「認知負荷理論」は項目が無かった）
 * ・曖昧さ回避のページには張らない
 * ・**項目が実在しても意味が違うことがある**（「信頼性」は工学の項目）。
 *   冒頭の文を取り、記事の文脈と合うかを Gemini に判定させる
 */
const { fetchRetry } = require('./http');
const { generateJson } = require('./gemini');

const API = 'https://ja.wikipedia.org/w/api.php';

/** 実在する項目だけ {term, title, url, extract} で返す */
async function verifyTerms(terms) {
  const wanted = terms.filter((t) => t.term && t.wikiTitle);
  if (!wanted.length) return [];

  const params = new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2', redirects: '1',
    prop: 'pageprops|extracts', exintro: '1', explaintext: '1', exchars: '300', exlimit: '20',
    titles: wanted.map((t) => t.wikiTitle).join('|')
  });
  const res = await fetchRetry(API + '?' + params.toString(), {}, { attempts: 2 });
  if (!res.ok) throw new Error('Wikipedia APIエラー(' + res.status + ')');
  const json = await res.json();

  const pages = ((json.query || {}).pages) || [];
  const byTitle = {};
  pages.forEach((p) => { byTitle[String(p.title).toLowerCase()] = p; });
  // 転送された項目は元の名前でも引けるようにする
  ((json.query || {}).redirects || []).forEach((r) => {
    const to = byTitle[String(r.to).toLowerCase()];
    if (to) byTitle[String(r.from).toLowerCase()] = to;
  });
  ((json.query || {}).normalized || []).forEach((n) => {
    const to = byTitle[String(n.to).toLowerCase()];
    if (to) byTitle[String(n.from).toLowerCase()] = to;
  });

  const out = [];
  wanted.forEach((t) => {
    const page = byTitle[t.wikiTitle.toLowerCase()];
    if (!page || page.missing) return;
    if ((page.pageprops || {}).disambiguation !== undefined) return;   // 曖昧さ回避
    out.push({
      term: t.term,
      title: page.title,
      url: 'https://ja.wikipedia.org/wiki/' + encodeURIComponent(page.title),
      extract: String(page.extract || '').trim()
    });
  });
  return out;
}

/** 項目の意味が記事の文脈と合うかを Gemini に判定させ、合わないものを外す */
async function dropWrongSenses(article) {
  const links = article.links.filter((l) => l.extract);
  if (!links.length) {
    article.links.forEach((l) => { delete l.extract; });
    return;
  }

  const body = Object.values(article.sections).join('\n').slice(0, 2000);
  const ask = links.map((l, i) => `[${i + 1}] 用語「${l.term}」→ 項目「${l.title}」\n  冒頭: ${l.extract}`).join('\n');
  const schema = {
    type: 'OBJECT',
    properties: {
      results: { type: 'ARRAY', items: { type: 'OBJECT',
        properties: { number: { type: 'INTEGER' }, fits: { type: 'BOOLEAN' } }, required: ['number', 'fits'] } }
    },
    required: ['results']
  };

  try {
    const judged = await generateJson([{
      text: '【用語の意味の確認】次の記事で使った用語に、日本語版 Wikipedia の項目を結び付けてよいかを判定してください。\n' +
            '項目の冒頭の文が、記事での使われ方と同じ意味であれば fits は true、別の分野の別の意味なら false。\n\n' +
            '記事の本文（抜粋）:\n' + body + '\n\n候補:\n' + ask
    }], schema);

    const bad = new Set((judged.results || []).filter((r) => r.fits === false).map((r) => Number(r.number)));
    const dropped = [];
    article.links = article.links.filter((l) => {
      const i = links.indexOf(l);
      if (i >= 0 && bad.has(i + 1)) { dropped.push(l.term + '→' + l.title); return false; }
      return true;
    });
    if (dropped.length) article.warnings.push('意味が合わないリンクを外した: ' + dropped.join(', '));
  } catch (e) {
    article.warnings.push('用語の意味を確認できなかったためリンクなし: ' + e.message.slice(0, 120));
    article.links = [];
  }
  article.links.forEach((l) => { delete l.extract; });   // 台帳には残さない
}

module.exports = { verifyTerms, dropWrongSenses };
