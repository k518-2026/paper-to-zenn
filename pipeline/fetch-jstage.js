require('dotenv').config();
const axios = require('axios');

/**
 * J-Stage から国内論文を1件取り、日本語要旨まで揃えて返す。
 *
 * 【なぜ abst 検索なのか】
 * J-Stage の検索APIは要旨を返さない（タイトル・著者・誌名・巻号・DOIのみ）。
 * 要旨は記事ページの <meta name="abstract"> から取るしかないが、
 * 古い論文には要旨が電子化されていないものが多い。
 *
 * 実測（キーワード「協同学習」・各6件）:
 *   text 検索 … 2,285件ヒット / 要旨が取れたのは 2件
 *   abst 検索 …   224件ヒット / 要旨が取れたのは 6件（全件）
 *
 * abst は要旨を対象に検索するので、要旨を持つ論文しか返らない。
 * 候補数は減るが、無駄な記事ページ取得が消える。
 */

const API = 'https://api.jstage.jst.go.jp/searchapi/do';

// 連絡先を User-Agent に入れておくのが公開APIに対する作法
const UA = 'PaperToZenn/2.0 (+https://github.com/k518-2026/paper-to-zenn)';

// 記事ページを連続で叩かないための間隔
const PAGE_INTERVAL_MS = 1500;

/** 日替わりで回すテーマ。abst 検索に使う日本語キーワード */
const THEMES = [
  { id: 'edu-psychology', label: '教育心理学', keyword: '教育心理' },
  { id: 'cooperative',    label: '協同学習',   keyword: '協同学習' },
  { id: 'active',         label: '主体的な学び', keyword: 'アクティブラーニング' },
  { id: 'motivation',     label: '学習意欲',   keyword: '学習意欲' },
  { id: 'ict',            label: 'ICT活用',    keyword: 'ICT 授業' },
  { id: 'lesson-study',   label: '授業研究',   keyword: '授業研究' },
  { id: 'assessment',     label: '学習評価',   keyword: '学習評価' },
  { id: 'special-needs',  label: '特別支援教育', keyword: '特別支援教育' },
  { id: 'teacher',        label: '教師教育',   keyword: '教員養成' },
  { id: 'literacy',       label: '読解と学力', keyword: '読解力' }
];

const MIN_ABSTRACT_LEN = 200;   // これより短い要旨は要約に値しない
const MAX_ABSTRACT_LEN = 4000;  // 要約モデルに渡す前の上限
const SEARCH_COUNT = 50;        // 1回に取る候補数
const MAX_PAGE_FETCH = 12;      // 1回の実行で開く記事ページの上限

/** 通日でテーマを選ぶ。ランダムにしないのは、何日も回ってこないテーマを作らないため */
function pickTheme(offset = 0) {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const day = Math.floor((now - start) / 86400000);
  return THEMES[(day + offset) % THEMES.length];
}

async function fetchXml(url) {
  const res = await axios.get(url, {
    headers: { 'User-Agent': UA },
    timeout: 30000,
    responseType: 'text',
    validateStatus: () => true
  });
  if (res.status !== 200) {
    throw new Error(`J-Stage が HTTP ${res.status} を返しました`);
  }
  return res.data;
}

const unescapeHtml = (s) => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
  .replace(/&amp;/g, '&');   // &amp; は最後。先に戻すと &amp;lt; が壊れる

const clean = (s) => unescapeHtml(String(s || '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

/** entry の <ja> と <en> を取り出す。日本語が無ければ英語で代用する */
function pickLang(entry, tag) {
  const block = entry.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  if (!block) return { ja: '', en: '' };
  const inner = block[1];
  const ja = inner.match(/<ja>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/ja>/);
  const en = inner.match(/<en>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/en>/);
  return { ja: clean(ja && ja[1]), en: clean(en && en[1]) };
}

function parseEntry(entry) {
  const title = pickLang(entry, 'article_title');
  const link = pickLang(entry, 'article_link');
  const journal = pickLang(entry, 'material_title');

  const url = link.ja || link.en;
  if (!url) return null;

  // 著者名は <name><![CDATA[登藤 直弥]]></name> の形。
  // CDATA を先に外さないと、タグ除去が <![CDATA[...]]> ごと名前を消してしまう
  const authors = [];
  const authorBlock = entry.match(/<author>([\s\S]*?)<\/author>/);
  if (authorBlock) {
    const jaNames = authorBlock[1].match(/<ja>([\s\S]*?)<\/ja>/);
    const src = jaNames ? jaNames[1] : authorBlock[1];
    const nameRe = /<name>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/name>/g;
    let m;
    while ((m = nameRe.exec(src)) !== null) {
      const name = clean(m[1]);
      if (name) authors.push(name);
    }
  }

  const pick = (tag) => (entry.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)) || [])[1] || '';

  return {
    title: title.ja || title.en,
    titleEn: title.en,
    authors: authors.filter(Boolean).join(', ') || '著者情報なし',
    journal: journal.ja || journal.en,
    year: pick('pubyear'),
    volume: pick('prism:volume'),
    number: pick('prism:number'),
    startPage: pick('prism:startingPage'),
    doi: pick('prism:doi'),
    url,
    id: pick('prism:doi') || url
  };
}

/**
 * 候補を検索する。要旨を対象にした abst 検索を使う。
 * pubyearfrom を付けると近年に寄るが、候補が痩せるので既定は緩めにしている。
 */
async function searchCandidates(theme, { yearFrom } = {}) {
  const params = new URLSearchParams({
    service: '3',
    abst: theme.keyword,
    count: String(SEARCH_COUNT)
  });
  if (yearFrom) params.set('pubyearfrom', String(yearFrom));

  const xml = await fetchXml(`${API}?${params.toString()}`);
  const total = (xml.match(/<opensearch:totalResults>(\d+)/) || [])[1] || '0';
  const entries = xml.split('<entry>').slice(1);

  const papers = entries.map(parseEntry).filter(Boolean);
  // API は発行年順に返さないので、新しいものから見るよう自前で並べ替える
  papers.sort((a, b) => Number(b.year || 0) - Number(a.year || 0));

  console.log(`🔍 「${theme.label}」（abst:${theme.keyword}）${total} 件ヒット / ${papers.length} 件を候補に`);
  return papers;
}

/**
 * 記事ページから日本語要旨を取る。
 * J-Stage の記事ページには <meta name="abstract"> がある。
 */
async function fetchAbstract(url) {
  const res = await axios.get(url, {
    headers: { 'User-Agent': UA },
    timeout: 30000,
    responseType: 'text',
    validateStatus: () => true
  });
  if (res.status !== 200) return '';

  const m = String(res.data).match(/<meta\s+name="abstract"\s+content="([\s\S]*?)"\s*\/?>/i);
  return m ? clean(m[1]) : '';
}

/**
 * 未投稿かつ要旨が十分にある論文を1件返す。無ければ null。
 * postedIds には posted.json に記録済みの ID（DOI or URL）を渡す。
 */
async function findPaper(postedIds, themeOffset = 0) {
  const theme = pickTheme(themeOffset);
  console.log(`📚 本日のテーマ: ${theme.label}\n`);

  const posted = new Set(postedIds);
  let candidates = await searchCandidates(theme);

  // 近年に寄せたい場合はここで絞る。候補が尽きたら全期間に戻す
  const recent = candidates.filter(p => Number(p.year || 0) >= new Date().getFullYear() - 5);
  const ordered = recent.concat(candidates.filter(p => !recent.includes(p)));

  let opened = 0;
  for (const paper of ordered) {
    if (posted.has(paper.id)) continue;
    if (opened >= MAX_PAGE_FETCH) {
      console.log(`ℹ️ 記事ページの取得上限（${MAX_PAGE_FETCH}件）に達しました。今回は見送ります。`);
      return null;
    }

    opened++;
    const abstract = await fetchAbstract(paper.url);
    await new Promise(r => setTimeout(r, PAGE_INTERVAL_MS));

    if (abstract.length < MIN_ABSTRACT_LEN) {
      console.log(`  × ${paper.year} ${paper.title.slice(0, 30)} … 要旨 ${abstract.length}字`);
      continue;
    }

    console.log(`  ○ ${paper.year} ${paper.title.slice(0, 30)} … 要旨 ${abstract.length}字\n`);
    return {
      ...paper,
      theme: theme.label,
      abstract: abstract.slice(0, MAX_ABSTRACT_LEN),
      published: paper.year || '不明'
    };
  }

  console.log('ℹ️ 未投稿で要旨のある論文が見つかりませんでした。\n');
  return null;
}

module.exports = { findPaper, searchCandidates, fetchAbstract, pickTheme, THEMES };
