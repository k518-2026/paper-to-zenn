/**
 * OpenAlex（論文の検索と書誌）
 *
 * 1回の問い合わせごとに料金がかかる（2026-09-14 時点で $0.0001）。
 * 無料アカウントの API キーで1日 $1 が自分専用になる。キーなしの枠（1日 $0.10）は
 * 接続元 IP ごとに分け合うので、共有サーバーからだとすぐ尽きる。
 * キーは URL に載せず Authorization ヘッダで送る（ログに残さないため）。
 */
const { fetchRetry, httpError } = require('./http');
const config = require('../config');

const ENDPOINT = 'https://api.openalex.org/works';
const SELECT = 'id,doi,title,publication_year,cited_by_count,biblio,authorships,' +
               'primary_location,best_oa_location,locations,referenced_works,type,language';

async function callOpenAlex(params) {
  const url = ENDPOINT + '?' + new URLSearchParams(params).toString();
  const key = (process.env.OPENALEX_API_KEY || '').trim();
  const headers = key ? { Authorization: 'Bearer ' + key } : {};

  const res = await fetchRetry(url, { headers }, {
    attempts: 3,
    // 1日の枠切れ（budget）は再試行しても数時間戻らない
    shouldRetry: async (r) => {
      if (r.status !== 429) return r.status >= 500;
      const body = await r.clone().text();
      return !/budget|Insufficient/i.test(body);
    }
  });

  if (res.ok) return res.json();
  const body = await res.clone().text();
  if (res.status === 429 && /budget|Insufficient/i.test(body)) {
    throw new Error('OpenAlex の1日の利用枠を使い切りました（日本時間9時に戻ります）。' +
                    (key ? '' : 'OPENALEX_API_KEY を登録すると1日 $1 が専用になります。'));
  }
  throw await httpError('OpenAlex APIエラー', res);
}

/** 共通の絞り込み + テーマ。直近 recentYears 年に限る */
function candidateFilter() {
  const fromYear = new Date().getFullYear() - (config.recentYears - 1);
  return [
    'is_oa:true',
    'type:article',
    'language:en',
    'has_pdf_url:true',
    'primary_location.source.type:journal',
    'publication_year:>' + (fromYear - 1),
    'primary_topic.id:' + config.topics.join('|')
  ].join(',');
}

/** 被引用数の多い順に候補を1ページ分 */
async function searchCandidates(page = 1) {
  const json = await callOpenAlex({
    filter: candidateFilter(),
    sort: 'cited_by_count:desc',
    'per-page': String(config.perPage),
    page: String(page),
    select: SELECT
  });
  return {
    total: (json.meta || {}).count || 0,
    papers: (json.results || []).map(toPaper).filter((p) => p.title)
  };
}

function shortId(url) {
  return String(url || '').replace(/^https?:\/\/openalex\.org\//, '');
}

function cleanTitle(s) {
  return String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().replace(/\.$/, '');
}

function pageRange(first, last) {
  const f = String(first || '').trim();
  const l = String(last || '').trim();
  if (!f) return '';
  return (!l || l === f) ? f : f + '–' + l;
}

function toPaper(w) {
  const src = (w.primary_location && w.primary_location.source) || {};
  const b = w.biblio || {};
  const doi = String(w.doi || '').replace(/^https?:\/\/doi\.org\//i, '');

  // PDF の候補は複数ある。出版社版が弾かれてもリポジトリ版が取れることがある
  const pdfUrls = [];
  [w.best_oa_location].concat(w.locations || []).forEach((loc) => {
    const u = loc && loc.pdf_url;
    if (u && !pdfUrls.includes(u)) pdfUrls.push(u);
  });

  const landing = (w.primary_location && w.primary_location.landing_page_url) ||
                  (w.best_oa_location && w.best_oa_location.landing_page_url) || '';

  return {
    id: shortId(w.id),
    doi,
    title: cleanTitle(w.title || w.display_name),
    authors: (w.authorships || []).map((a) => String((a.author || {}).display_name || '').trim()).filter(Boolean),
    venue: cleanTitle(src.display_name || ''),
    volume: String(b.volume || ''),
    issue: String(b.issue || ''),
    pages: pageRange(b.first_page, b.last_page),
    year: String(w.publication_year || ''),
    citedBy: Number(w.cited_by_count) || 0,
    license: String((w.best_oa_location && w.best_oa_location.license) ||
                    (w.primary_location && w.primary_location.license) || ''),
    url: doi ? 'https://doi.org/' + doi : landing,
    pdfUrls,
    referencedWorks: (w.referenced_works || []).map(shortId)
  };
}

/**
 * 「次に読むべき論文」の候補。**実在する論文だけから選ばせる**ため、
 * この論文が引用している文献（土台）と、この論文を引用している論文（その後）を取る。
 */
async function readingCandidates(paper) {
  const out = [];
  const seen = { [paper.id]: true };

  const add = (list, relation) => {
    list.forEach((p) => {
      if (seen[p.id] || !p.title || !p.venue) return;
      seen[p.id] = true;
      out.push({ ...p, relation });
    });
  };

  const refs = paper.referencedWorks.slice(0, config.referenceLookupMax);
  if (refs.length) {
    try {
      const json = await callOpenAlex({
        filter: 'openalex:' + refs.join('|') + ',type:article',
        sort: 'cited_by_count:desc',
        'per-page': String(config.readingFromReferences),
        select: SELECT
      });
      add((json.results || []).map(toPaper), '引用している文献');
    } catch (e) {
      console.warn('  参考文献の取得に失敗（引用側だけで続けます）: ' + e.message);
    }
  }

  try {
    const json = await callOpenAlex({
      filter: 'cites:' + paper.id + ',type:article',
      sort: 'cited_by_count:desc',
      'per-page': String(config.readingFromCiting),
      select: SELECT
    });
    add((json.results || []).map(toPaper), 'この論文を引用している後続研究');
  } catch (e) {
    console.warn('  被引用論文の取得に失敗: ' + e.message);
  }
  return out;
}

module.exports = { searchCandidates, readingCandidates, candidateFilter, toPaper, callOpenAlex };
