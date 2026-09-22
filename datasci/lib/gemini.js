/**
 * 記事の執筆（Gemini）
 *
 * 守らせていること:
 *   ・PDF に書かれていないことを書かない
 *   ・「次に読むべき論文」はコードが OpenAlex から取った実在の候補から番号で選ばせる
 *   ・URL は書かせない（リンクはすべてコード側で付ける）
 *   ・テーマに合わない論文は relevant=false で返させ、記事にしない
 *
 * 字数はモデルに守らせきれないので、外れた観点だけ本文なしの軽い問い合わせで書き直させる。
 */
const { fetchRetry, httpError, requireEnv } = require('./http');
const config = require('../config');

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/';

let lastModel = '';
const usedModel = () => lastModel;

function articleSchema() {
  const sectionProps = {};
  config.sections.forEach((s) => { sectionProps[s.key] = { type: 'STRING' }; });
  return {
    type: 'OBJECT',
    properties: {
      relevant: { type: 'BOOLEAN' },
      relevanceReason: { type: 'STRING' },
      titleJa: { type: 'STRING' },
      sections: { type: 'OBJECT', properties: sectionProps, required: config.sections.map((s) => s.key) },
      nextReads: {
        type: 'ARRAY',
        items: { type: 'OBJECT', properties: { number: { type: 'INTEGER' }, reason: { type: 'STRING' } },
                 required: ['number', 'reason'] }
      },
      terms: {
        type: 'ARRAY',
        items: { type: 'OBJECT', properties: { term: { type: 'STRING' }, wikiTitle: { type: 'STRING' } },
                 required: ['term', 'wikiTitle'] }
      },
      intro: { type: 'STRING' }
    },
    required: ['relevant', 'relevanceReason', 'titleJa', 'sections', 'nextReads', 'terms', 'intro']
  };
}

function buildPrompt(paper, readings) {
  const min = config.sectionMinChars;
  const max = config.sectionMaxChars;
  const list = readings.length
    ? readings.map((r, i) => `[${i + 1}] ${r.title} / ${r.venue} / ${r.year} / 被引用数 ${r.citedBy} / ${r.relation}`).join('\n')
    : '（候補なし）';

  return [
    `あなたは${config.writerRole}です。`,
    '【論文本文】として渡したものは学術論文の本文です（PDF から取り出した文字）。' +
    `日本の${config.reader}向けに、この論文を紹介する記事の材料を作ってください。` +
    '文字にしたときに図表の数値や改行が崩れていることがあるので、読み取れない数値は使わないでください。',
    '',
    '【最初に判定すること】',
    'relevant: この論文が次の条件に当てはまれば true、当てはまらなければ false。',
    '  条件: ' + config.relevanceRule,
    'relevanceReason: 判定の理由を日本語で1文。',
    'false の場合も、ほかの項目は空文字や空配列で構いませんが、必ず JSON で返してください。',
    '',
    `【sections（6観点）】すべて日本語の「です・ます」調。各観点 ${min}〜${max} 字（空白を除く）。` +
    // 範囲だけを示すと下限に寄るので、真ん中あたりを目安として示す
    `下限ぎりぎりにならないよう、${Math.round(min + (max - min) / 3)}〜${Math.round(min + (max - min) * 2 / 3)} 字くらいを目安にする` +
    '（nextLead は下の指定に従う）。',
    '数値（精度・誤差・データ件数など）は、本文にその値として書かれているものだけを使う。別の箇所の数値を組み合わせない。',
    config.sections.map((s) => `- ${s.key}: ${s.guide}`).join('\n'),
    '',
    '【nextReads】下の候補から1〜3本を選び、number に候補番号、reason にこの論文との関係と読む価値を 60〜120 字で書く。',
    '候補に無い論文を挙げてはいけません。',
    '候補は外部データベースから機械的に取ったもので、無関係な論文が混ざります。' +
    '手法の論文は、その手法を使っただけの応用研究（生態学・医学などの個別分野の知見が主題のもの）に引用されがちです。' +
    'そうした応用研究や、統計ソフトの解説・教科書は選ばないでください。ふさわしい候補が無ければ空配列でよい。',
    list,
    '',
    '【terms】記事の本文に出てくる専門用語のうち、日本語版 Wikipedia に項目がありそうなものを最大' +
    `${config.wikiLinkMax}個。term は記事に書いた通りの表記、wikiTitle は Wikipedia の項目名。` +
    '一般語（データ・精度・モデルなど）は選ばない。実在しない項目を推測で書かない（コード側で確かめて、無ければ張らない）。',
    '',
    '【intro】SNS とページ冒頭に使う紹介文。100〜160 字。何が新しいのかが一読でわかるように。',
    '',
    '【titleJa】論文タイトルの和訳。60 字以内。全体を鉤括弧で囲まない。',
    '',
    '【書誌（参考情報。本文には書かない）】',
    '原題: ' + paper.title,
    '著者: ' + paper.authors.slice(0, 6).join(', '),
    '掲載誌: ' + paper.venue + ' (' + paper.year + ')',
    '被引用数: ' + paper.citedBy
  ].join('\n');
}

/** モデルを順に試す。503（混雑）と429（上限）と404（名前違い）で切り替える */
async function generateJson(parts, schema) {
  const key = requireEnv('GEMINI_API_KEY');
  const models = config.geminiModels;
  let res = null;

  for (let i = 0; i < models.length; i++) {
    lastModel = models[i];
    res = await callModel(key, models[i], parts, schema);
    if (res.ok) break;
    const quota = res.status === 429 && /exceeded your current quota/i.test(await res.clone().text());
    if (quota) console.warn(`  ${models[i]} は1日の上限に達しています。`);
    if (![503, 429, 404].includes(res.status) || i === models.length - 1) break;
    console.warn(`  ${models[i]} が使えないため ${models[i + 1]} に切り替えます（${res.status}）`);
  }

  if (!res.ok) throw await httpError('Gemini APIエラー', res);
  const json = await res.json();
  const cand = (json.candidates || [])[0];
  const text = ((cand || {}).content ? (cand.content.parts || []).map((p) => p.text || '').join('') : '').trim();
  if (!text) throw new Error('Gemini の応答が空です: ' + JSON.stringify(json).slice(0, 300));
  try {
    return JSON.parse(text.replace(/^```json\s*|\s*```$/g, ''));
  } catch (e) {
    throw new Error('Gemini の応答が JSON ではありません: ' + text.slice(0, 300));
  }
}

function callModel(key, model, parts, schema) {
  const generationConfig = {
    temperature: config.temperature,
    maxOutputTokens: config.maxOutputTokens,
    responseMimeType: 'application/json'
  };
  if (schema) generationConfig.responseSchema = schema;

  return fetchRetry(ENDPOINT + encodeURIComponent(model) + ':generateContent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },   // キーは URL に載せない
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig })
  }, {
    attempts: 2,
    timeoutMs: 180000,
    // 1日の上限は待っても戻らない。1分あたりの上限と混雑だけ待つ
    shouldRetry: async (r) => {
      if (r.ok) return false;
      if (r.status === 429) return !/exceeded your current quota/i.test(await r.clone().text());
      return r.status === 503 || r.status >= 500;
    }
  });
}

/** 空白を除いた日本語の字数 */
function jaLength(s) {
  return String(s || '').replace(/\s/g, '').length;
}

/** 論文1本から記事の材料を作る */
async function writeArticle(paper, pdfText, readings) {
  const main = require('./pdf').dropReferenceList(pdfText);
  const clipped = main.length > config.pdfTextMaxChars;
  const body = {
    text: '【論文本文】' + (main.length < pdfText.length ? '（参考文献リストは省略）' : '') +
          (clipped ? '（長いので後半を省略）' : '') + '\n' + main.slice(0, config.pdfTextMaxChars)
  };

  const raw = await generateJson([body, { text: buildPrompt(paper, readings) }], articleSchema());
  const article = normalize(raw, readings);
  article.model = usedModel();
  if (article.relevant) await fixSectionLengths(article);
  return article;
}

function unwrapQuotes(s) {
  const t = String(s || '').trim();
  // 全体を囲んでいるときだけ外す（途中で閉じる鉤括弧は残す）
  if (/^[「『"'][\s\S]*[」』"']$/.test(t) && !/[」』]/.test(t.slice(1, -1))) return t.slice(1, -1).trim();
  return t;
}

function normalize(raw, readings) {
  const sections = {};
  config.sections.forEach((s) => { sections[s.key] = String((raw.sections || {})[s.key] || '').trim(); });

  const seen = {};
  const nextReads = (raw.nextReads || [])
    .map((n) => ({ number: Number(n.number), reason: String(n.reason || '').trim() }))
    .filter((n) => {
      const p = readings[n.number - 1];
      if (!p || seen[n.number]) return false;
      seen[n.number] = true;
      return true;
    })
    .slice(0, 3)
    .map((n) => ({ paper: readings[n.number - 1], reason: n.reason }));

  const bodyText = Object.values(sections).join('');
  const terms = (raw.terms || [])
    .map((t) => ({ term: String(t.term || '').trim(), wikiTitle: String(t.wikiTitle || '').trim() }))
    .filter((t) => t.term && t.wikiTitle && bodyText.includes(t.term))   // 本文に無い語は張らない
    .slice(0, config.wikiLinkMax);

  return {
    relevant: !!raw.relevant,
    relevanceReason: String(raw.relevanceReason || '').trim(),
    titleJa: unwrapQuotes(raw.titleJa),
    sections,
    nextReads,
    terms,
    intro: String(raw.intro || '').trim(),
    links: [],
    warnings: []
  };
}

/** 字数が外れた観点だけ、本文なしで書き直させる（nextLead は後ろにリストが付くので対象外） */
async function fixSectionLengths(article) {
  const bad = config.sections.filter((s) => {
    if (s.lead) return false;
    const n = jaLength(article.sections[s.key]);
    return n < config.sectionMinChars || n > config.sectionMaxChars;
  });
  if (!bad.length) return;

  const ask = bad.map((s) => `【${s.key}】現在 ${jaLength(article.sections[s.key])} 字\n${article.sections[s.key]}`).join('\n\n');
  const schema = {
    type: 'OBJECT',
    properties: Object.fromEntries(bad.map((s) => [s.key, { type: 'STRING' }])),
    required: bad.map((s) => s.key)
  };
  try {
    const fixed = await generateJson([{
      text: '次の文章を、内容を変えずに' + config.sectionMinChars + '〜' + config.sectionMaxChars +
            '字（空白を除く）に直してください。事実や数値を足さないこと。日本語の「です・ます」調。\n\n' + ask
    }], schema);
    bad.forEach((s) => {
      const t = String(fixed[s.key] || '').trim();
      if (t) article.sections[s.key] = t;
    });
  } catch (e) {
    // 字数は付加価値。直せなくても記事は捨てない
    article.warnings.push('字数の調整に失敗: ' + e.message.slice(0, 120));
  }
}

module.exports = { writeArticle, generateJson, jaLength, buildPrompt, articleSchema, usedModel, unwrapQuotes };
