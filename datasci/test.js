/**
 * 自己検査（GitHub Actions でも実行する）
 *
 *   node datasci/test.js         通信を偽物に差し替えて、検索 → 記事 → Markdown を通しで動かす
 *   node datasci/test.js --live  OpenAlex・PDF・Wikipedia だけ本物に当てる（Gemini は呼ばない）
 *
 * 確かめていないこと: Gemini の出力の質、Zenn の見え方（実物で確かめる）
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const LIVE = process.argv.includes('--live');
const checks = [];
function check(name, ok, detail) {
  checks.push([name, !!ok]);
  if (!ok) console.log('  NG ' + name + (detail !== undefined ? '  → ' + String(detail).slice(0, 300) : ''));
}

const config = require('./config');
const render = require('./lib/render');
const ledgerLib = require('./lib/ledger');
const gemini = require('./lib/gemini');

// ============================================================
// 偽の外部サービス
// ============================================================

function work(n, over = {}) {
  return {
    id: 'https://openalex.org/W100' + n,
    doi: '10.1000/test.' + n,
    title: 'Study number ' + n + ' on shrinkage estimators',
    publication_year: 2025,
    cited_by_count: 500 - n,
    biblio: { volume: '12', issue: n % 2 ? '3' : null, first_page: '100', last_page: '120' },
    authorships: ['Alice Adams', 'Bob Brown', 'Carol Clark', 'Dan Doe'].slice(0, n % 2 ? 4 : 2).map((x) => ({ author: { display_name: x } })),
    primary_location: { source: { display_name: 'Journal of Statistical Software', type: 'journal' }, landing_page_url: 'https://pub/' + n },
    best_oa_location: { pdf_url: 'https://repo/paper' + n + '.pdf', license: 'cc-by' },
    locations: [],
    referenced_works: ['https://openalex.org/W9001'],
    type: 'article', language: 'en',
    ...over
  };
}

const geminiArticle = (over = {}) => ({
  relevant: true,
  relevanceReason: '推定量の改良を提案する手法論文',
  titleJa: '「縮小推定」の新しい当てはめ方',
  sections: Object.fromEntries(config.sections.map((s) => [s.key,
    (s.key === 'validation' ? '短い説明です。'
      : ('縮小推定と過学習について説明します。既存手法との違いと計算の要点を、式の意味がわかるように述べます。').repeat(3))])),
  nextReads: [{ number: 1, reason: '土台になった推定量の論文で、仮定の置き方を比べられます。' }, { number: 9, reason: '範囲外' }],
  terms: [{ term: '縮小推定', wikiTitle: '縮小推定' }, { term: '過学習', wikiTitle: '過学習' }, { term: '本文に無い語', wikiTitle: 'x' }],
  intro: '推定量を縮めると何が変わるのか。' + 'ここが紹介文です。'.repeat(6),
  ...over
});

function jsonResponse(body, status = 200) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300, status,
    json: async () => JSON.parse(text),
    text: async () => text,
    arrayBuffer: async () => new TextEncoder().encode(text).buffer,
    clone() { return this; }
  };
}

function makeFetch(state) {
  return async (url, opts = {}) => {
    const u = String(url);
    state.calls.push(u);

    if (u.startsWith('https://api.openalex.org/works')) {
      const q = new URL(u).searchParams;
      const filter = q.get('filter') || '';
      state.filter = state.filter || filter;
      if (filter.startsWith('openalex:W9001')) return jsonResponse({ results: [work(91, { id: 'https://openalex.org/W9001', title: 'Foundations of shrinkage' })] });
      if (filter.startsWith('cites:')) return jsonResponse({ results: [work(92, { id: 'https://openalex.org/W9003', title: 'Ants use shrinkage too' })] });
      const page = Number(q.get('page') || 1);
      // 2番は PDF が返らない、3番はテーマ外、1番が記事になる
      // 4番は「1日1本」を確かめるための余り（1回目は1番で止まるので手を付けない）
      return jsonResponse({ meta: { count: 4 }, results: page === 1 ? [work(2), work(3), work(1), work(4)] : [] });
    }
    if (u === 'https://repo/paper2.pdf') return jsonResponse('<html>login</html>');   // PDF ではない
    if (/^https:\/\/repo\/paper\d\.pdf$/.test(u)) {
      const buf = Buffer.concat([Buffer.from('%PDF-1.7 '), Buffer.alloc(2048, 0x20)]);
      return { ok: true, status: 200, arrayBuffer: async () => buf, text: async () => '', clone() { return this; } };
    }
    if (u.includes('generativelanguage.googleapis.com')) {
      const payload = JSON.parse(opts.body);
      const parts = payload.contents[0].parts;
      const text = parts.map((p) => p.text || '').join('\n');
      const hasSchema = !!(payload.generationConfig || {}).responseSchema;
      state.gemini.push({ hasBody: text.includes('【論文本文】'), text, hasSchema });
      if (state.gemini503 > 0) { state.gemini503--; return jsonResponse('busy', 503); }
      // スキーマを受け付けない場合を模す（400）。スキーマなしなら通る
      if (state.gemini400 > 0 && hasSchema) { state.gemini400--; return jsonResponse('Invalid JSON payload: responseSchema', 400); }
      if (text.includes('【用語の意味の確認】')) {
        state.senseChecked = true;
        return geminiReply({ results: [{ number: 1, fits: true }, { number: 2, fits: false }] });
      }
      if (!text.includes('【論文本文】')) return geminiReply({ validation: 'この観点を書き直しました。'.repeat(14) });
      const n = (text.match(/原題: Study number (\d)/) || [])[1];
      return geminiReply(geminiArticle(n === '3' ? { relevant: false, relevanceReason: '応用研究' } : {}));
    }
    if (u.startsWith('https://ja.wikipedia.org/w/api.php')) {
      return jsonResponse({ query: { pages: [
        { title: '縮小推定', pageid: 1, extract: '縮小推定とは、推定量を原点方向に縮める方法である。' },
        { title: '過学習', pageid: 2, extract: '過学習とは、訓練データに適合しすぎる現象である。' },
        { title: 'x', missing: true }
      ] } });
    }
    throw new Error('偽物に無い URL: ' + u);
  };
}

const geminiReply = (obj) => jsonResponse({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] });

function newState() {
  return { calls: [], gemini: [], gemini503: 0, gemini400: 0, senseChecked: false, filter: '' };
}

// ============================================================
// 1. 部品
// ============================================================

function unitTests() {
  const p4 = { authors: ['A One', 'B Two', 'C Three', 'D Four'], title: 'T', venue: 'J', volume: '8', issue: '2', pages: '97–110', year: '2019' };
  check('書誌: 4人以上は et al.、全角の区切り',
        render.citationText(p4) === 'A One, B Two, C Three, et al.，"T，" J，vol. 8，no. 2，pp. 97–110，2019', render.citationText(p4));
  const p1 = { authors: ['A One'], title: 'T.', venue: 'J', volume: '8', issue: '', pages: '422', year: '2017' };
  check('書誌: 号が無ければ飛ばす・1ページは p.・末尾のピリオドを落とす',
        render.citationText(p1) === 'A One，"T，" J，vol. 8，p. 422，2017', render.citationText(p1));
  check('被引用数は3桁区切り', render.citedByText({ citedBy: 2781 }, '2026-09-23') === '被引用数: 2,781（OpenAlex, 2026-09-23 時点）');

  const links = [{ term: '推定', url: 'https://ja.wikipedia.org/wiki/A' }, { term: '縮小推定', url: 'https://ja.wikipedia.org/wiki/B' }];
  const md = render.linkifyTerms('縮小推定は推定の一種です。縮小推定は便利です。', links);
  check('リンク: 長い用語を先に張り、同じ語は最初の1回だけ',
        md === '[縮小推定](https://ja.wikipedia.org/wiki/B)は[推定](https://ja.wikipedia.org/wiki/A)の一種です。縮小推定は便利です。', md);
  check('リンク: 角括弧を逃がす', render.linkifyTerms('式 [1] を使う', []) === '式 \\[1\\] を使う');

  // 書いた記事から WordPress の本文に直す（send-wp.js が使う）
  (function () {
    const md = [
      '---', 'title: "【論文紹介】ためし"', 'emoji: "📈"', '---', '',
      'リード文です。', '',
      '**原題**: Title  ', '[書誌](https://doi.org/x)  ', '被引用数: 3（OpenAlex, 2026-09-23 時点）', '',
      '## (1) 何を解くための手法か', '', '本文です。式 \\[1\\] を使います。', '',
      '## (6) 次に読む論文', '', '導入文です。', '',
      '- [論文A](https://doi.org/a)  \n  被引用数: 9  \n  理由です。',
      '- [論文B](https://doi.org/b)  \n  被引用数: 8  \n  別の理由です。', '',
      ':::message', '免責です。', ':::', ''
    ].join('\n');
    const wp = { category: '論文紹介', tags: 'a,b', draft: true, publicize: false };
    const html = render.markdownToHtml(md, wp);
    check('Markdown→HTML: フロントマターを落とす', !html.includes('title:') && !html.includes('emoji'), html.slice(0, 80));
    check('Markdown→HTML: 見出しと段落', html.includes('<h2>(1) 何を解くための手法か</h2>') && html.includes('<p>リード文です。</p>'));
    check('Markdown→HTML: リンクは別ウィンドウ',
          html.includes('<a href="https://doi.org/x" target="_blank" rel="noopener">書誌</a>'), html.slice(0, 300));
    check('Markdown→HTML: 次に読む論文は箇条書き',
          (html.match(/<li>/g) || []).length === 2 && html.includes('<ul>') && html.includes('理由です。'));
    // タグを足してからエスケープすると、<br /> が記事に文字で出る（2026-09-23 に WordPress で発生）
    check('Markdown→HTML: タグが文字で出ない（エスケープの順番）',
          !html.includes('&lt;br') && !html.includes('&lt;a ') && !html.includes('&lt;strong'), html);
    check('Markdown→HTML: 箇条書きの中も改行は <br /> になる',
          /<li><a [^>]+>論文A<\/a><br \/>被引用数: 9<br \/>理由です。<\/li>/.test(html),
          (html.match(/<li>.*?<\/li>/) || [])[0]);
    check('Markdown→HTML: 逃がした角括弧を戻す', html.includes('式 [1] を使います'), html);
    check('Markdown→HTML: 注記（:::message）は小さい文字に', html.includes('<small>免責です。</small>'));
    check('Markdown→HTML: 下書き指定とショートコード',
          html.includes('[status draft]') && html.includes('[category 論文紹介]') && html.trim().endsWith('[end]'));
    check('Markdown→HTML: CRLF でも段落に分かれる',
          render.markdownToHtml(md.replace(/\n/g, '\r\n'), wp) === html);
  })();

  check('slug の形式', /^[a-z0-9_-]{12,50}$/.test(render.zennSlug('W2597900308')), render.zennSlug('W2597900308'));
  check('タイトルは70字以内', Array.from(render.zennTitle('あ'.repeat(100))).length <= 70);

  const rows = [ledgerLib.record({ id: 'W1', doi: '10.1/A' }, ledgerLib.STATUS.DONE)];
  const keys = ledgerLib.knownKeys(rows);
  check('台帳: ID でも DOI でも既出と分かる',
        ledgerLib.isKnown(keys, { id: 'W1', doi: '' }) && ledgerLib.isKnown(keys, { id: 'W9', doi: '10.1/a' }) &&
        !ledgerLib.isKnown(keys, { id: 'W9', doi: '10.1/B' }));
  check('台帳: その日に作ったかを見る',
        ledgerLib.madeToday([{ status: ledgerLib.STATUS.DONE, date: '2026-09-23' }], '2026-09-23') &&
        !ledgerLib.madeToday([{ status: ledgerLib.STATUS.SKIPPED, date: '2026-09-23' }], '2026-09-23'));

  check('和訳タイトル: 全体を囲む鉤括弧だけ外す',
        gemini.unwrapQuotes('「学びの研究」') === '学びの研究' && gemini.unwrapQuotes('「自己調整」の研究') === '「自己調整」の研究');
  check('字数は空白を除いて数える', gemini.jaLength(' あい うえ\nお ') === 5);

  const filter = require('./lib/openalex').candidateFilter();
  const fromYear = new Date().getFullYear() - 1;
  check('検索条件: OA・英語・学術誌・直近2年・指定トピック',
        filter.includes('is_oa:true') && filter.includes('language:en') && filter.includes('primary_location.source.type:journal') &&
        filter.includes('publication_year:>' + (fromYear - 1)) && filter.includes(config.topics[0]), filter);
  check('指示文に技術寄りの書かせ方が入る',
        gemini.buildPrompt({ title: 't', authors: [], venue: 'J', year: '2025', citedBy: 1 }, [])
          .includes('ハイパーパラメータ・計算量'));
}

// ============================================================
// 2. 通し（検索 → PDF → Gemini → Wikipedia → Markdown）
// ============================================================

async function flowTest() {
  const state = newState();
  global.fetch = makeFetch(state);
  process.env.GEMINI_API_KEY = 'test-key';

  const run = require('./run');
  // メールの送り口は最初から偽物にしておく（設定が無いのに送ろうとしたら捕まえるため）
  let sentMail = null;
  const wp = require('./lib/wordpress');
  const realTransport = wp.createTransport;
  wp.createTransport = () => ({ sendMail: async (m) => { sentMail = m; return { messageId: '<test>' }; } });
  ['WP_POST_EMAIL', 'SMTP_USER', 'SMTP_PASSWORD'].forEach((k) => { delete process.env[k]; });

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'datasci-test-'));
  run.options.root = tmp;
  run.options.dryRun = false;
  run.options.force = false;
  run.deps.extractText = () => 'Abstract\nWe study shrinkage. ' + 'Method and results. '.repeat(400) + '\nReferences\nStein (1956).';
  run.deps.now = () => new Date('2026-09-23T07:00:00+09:00');

  config.geminiRoundWaitMs = 10;             // 待ち時間はテストでは詰める
  state.gemini503 = 1;                       // 1回目は混雑。切り替えて成功する
  state.gemini400 = 1;                       // 次はスキーマを受け付けない。スキーマなしで通す
  // 例外で落ちるとテストが黙って終わるので、必ず受けてから判定する
  let made = null;
  let threw = null;
  try { made = await run.main(); } catch (e) { threw = e; }
  check('記事作成が例外で終わらない', !threw, threw && threw.message);

  check('記事を1本だけ作る', made && made.path === 'articles/datasci-w1001.md', made && made.path);
  check('混雑（503）でもモデルを切り替えて書き上げる', state.gemini.length >= 2);
  check('スキーマで 400 が返ったらスキーマなしで出し直す',
        state.gemini.some((c) => c.hasSchema) && state.gemini.some((c) => !c.hasSchema),
        JSON.stringify(state.gemini.map((c) => c.hasSchema)));

  const file = path.join(tmp, 'articles/datasci-w1001.md');
  const md = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  check('記事をファイルに書く', md.length > 500, md.length);
  check('フロントマター', /^---\ntitle: "【論文紹介】「縮小推定」の新しい当てはめ方"\nemoji: "📈"\ntype: "idea"\ntopics: \["論文紹介","データ分析","機械学習","統計"\]\npublished: true\n---/.test(md), md.slice(0, 200));
  check('技術寄りの見出しが並ぶ', md.includes('## (3) 手法の中身：仕組みと計算の要点') && md.includes('## (6) 次に読む論文'));
  check('書誌と被引用数と論文リンク', md.includes('[Alice Adams, Bob Brown, Carol Clark, et al.，"Study number 1 on shrinkage estimators，"') &&
        md.includes('](https://doi.org/10.1000/test.1)') && md.includes('被引用数: 499（OpenAlex, 2026-09-23 時点）'), md.slice(200, 700));
  check('免責を入れる', md.includes(':::message') && md.includes('AI が要約・翻訳したもの'));

  check('字数が外れた観点だけ書き直す（本文なしの問い合わせ）',
        state.gemini.some((c) => !c.hasBody && c.text.includes('【validation】')), state.gemini.map((c) => c.hasBody).join());
  check('本文は参考文献リストを落として渡す',
        state.gemini[0].text.includes('（参考文献リストは省略）') && !state.gemini[0].text.includes('Stein (1956)'));
  check('用語: 実在し、意味も合うものだけリンク（無い項目・意味違いは外す）',
        md.includes('[縮小推定](https://ja.wikipedia.org/wiki/%E7%B8%AE%E5%B0%8F%E6%8E%A8%E5%AE%9A)') && !md.includes('過学習]('), state.senseChecked);
  check('次に読む論文: 範囲外の番号は落とす', (md.match(/^- \[/gm) || []).length === 1, md.match(/^- \[.*/gm));

  // WordPress へのメール投稿（同じ記事を送る）
  check('WordPress: 設定が無ければ送らない', sentMail === null && made && !made.wpSentAt, JSON.stringify(sentMail));
  {
    Object.assign(process.env, { WP_POST_EMAIL: 'secret@post.wordpress.com', SMTP_USER: 'me@example.com', SMTP_PASSWORD: 'pw' });

    const paper = { title: 'Study number 1 on shrinkage estimators', authors: ['Alice Adams'], venue: 'J', volume: '1',
                    issue: '', pages: '1–9', year: '2025', citedBy: 499, url: 'https://doi.org/10.1000/test.1' };
    const article = {
      titleJa: '「縮小推定」の新しい当てはめ方',
      sections: Object.fromEntries(config.sections.map((s) => [s.key, '縮小推定と過学習の話です。<script>'])),
      links: [{ term: '縮小推定', url: 'https://ja.wikipedia.org/wiki/%E7%B8%AE%E5%B0%8F%E6%8E%A8%E5%AE%9A' }],
      nextReads: [{ paper: { title: 'Foundations', authors: ['B'], venue: 'J2', year: '2020', citedBy: 10, url: 'https://doi.org/x' },
                    reason: '土台の論文です。' }]
    };
    await wp.sendArticle(paper, article, '2026-09-23');

    check('WordPress: 件名は【論文紹介】＋和訳タイトル', sentMail.subject === '【論文紹介】「縮小推定」の新しい当てはめ方', sentMail.subject);
    check('WordPress: 宛先と差出人', sentMail.to === 'secret@post.wordpress.com' && sentMail.from.includes('me@example.com'), sentMail.from);
    const html = sentMail.html;
    check('WordPress: 見出しと書誌と被引用数',
          html.includes('<h2>(3) 手法の中身：仕組みと計算の要点</h2>') &&
          html.includes('href="https://doi.org/10.1000/test.1" target="_blank" rel="noopener"') &&
          html.includes('被引用数: 499（OpenAlex, 2026-09-23 時点）'), html.slice(0, 200));
    check('WordPress: 用語リンクは別ウィンドウ',
          html.includes('<a href="https://ja.wikipedia.org/wiki/%E7%B8%AE%E5%B0%8F%E6%8E%A8%E5%AE%9A" target="_blank" rel="noopener">縮小推定</a>'));
    check('WordPress: タグを逃がす（生の script を入れない）', html.includes('&lt;script&gt;') && !html.includes('<script>'));
    check('WordPress: ショートコードを末尾に付ける',
          html.includes('[category 論文紹介]') && html.includes('[tags 論文紹介,データ分析,機械学習,統計]') &&
          html.includes('[publicize off]') && html.trim().endsWith('[end]'), html.slice(-120));
    check('WordPress: <hr> と -- を入れない（署名扱いで本文が消える）', !/<hr|(^|\n)--/.test(html));
    check('WordPress: 次に読む論文も入る', html.includes('<li>') && html.includes('土台の論文です。'));

    wp.createTransport = realTransport;
    ['WP_POST_EMAIL', 'SMTP_USER', 'SMTP_PASSWORD'].forEach((k) => { delete process.env[k]; });
  }

  const rows = JSON.parse(fs.readFileSync(path.join(tmp, config.paths.ledger), 'utf8'));
  check('台帳: PDF なし・テーマ外・記事 が残る',
        rows.length === 3 && rows[0].note === 'PDF を取得できない' && /テーマ外/.test(rows[1].note) &&
        rows[2].status === ledgerLib.STATUS.DONE && rows[2].slug === 'datasci-w1001', JSON.stringify(rows.map((r) => [r.id, r.status])));
  check('台帳: 記事の URL と日付を残す',
        rows[2].url === 'https://zenn.dev/k518/articles/datasci-w1001' && rows[2].date === '2026-09-23', JSON.stringify(rows[2]));

  // 同じ日にもう一度動かしても作らない（1日1本）
  const before = state.gemini.length;
  const again = await run.main();
  check('同じ日の2回目は何もしない（1日1本）',
        again === null && state.gemini.length === before &&
        !fs.existsSync(path.join(tmp, 'articles/datasci-w1004.md')), state.gemini.length - before);
  // 全モデルが混雑しても、間を置いて巡り直す（2026-09-23 の初回実行で4モデルとも 503 だった）
  {
    const before = state.gemini.length;
    // 1巡目（4モデル × 2回）は全滅。2巡目で収まる
    state.gemini503 = config.geminiModels.length * 2;
    let out = null;
    let busyThrew = null;
    try { out = await gemini.generateJson([{ text: '【論文本文】ためし' }], null); } catch (e) { busyThrew = e; }
    check('全モデルが混雑しても、間を置いて巡り直して書ける',
          !busyThrew && out && out.relevant === true && state.gemini.length - before > config.geminiModels.length,
          (busyThrew && busyThrew.message.slice(0, 80)) || (state.gemini.length - before) + ' 回呼んだ');
  }

  // Gemini が最後まで混雑していたら Claude に回す（鍵があるときだけ）
  {
    const claudeLib = require('./lib/claude');
    const realCreate = claudeLib.createClient;
    const rounds = config.geminiRounds;
    config.geminiRounds = 1;                       // すぐ最後の巡回にする
    state.gemini503 = 99;

    let asked = null;
    claudeLib.createClient = () => ({ messages: { create: async (req) => {
      asked = req;
      return { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"relevant":true,"来た":"Claude"}' }] };
    } } });

    process.env.ANTHROPIC_API_KEY = 'test-key';
    let out = null;
    let claudeThrew = null;
    try { out = await gemini.generateJson([{ text: '【論文本文】ためし' }], null); } catch (e) { claudeThrew = e; }
    check('Gemini が混雑したままなら Claude に回す',
          !claudeThrew && out && out['来た'] === 'Claude' && asked && asked.model === 'claude-sonnet-5' &&
          asked.output_config.effort === 'medium' && gemini.usedModel() === 'claude-sonnet-5',
          (claudeThrew && claudeThrew.message.slice(0, 80)) || JSON.stringify(asked && asked.model));

    delete process.env.ANTHROPIC_API_KEY;
    let noKeyThrew = null;
    try { await gemini.generateJson([{ text: '【論文本文】ためし' }], null); } catch (e) { noKeyThrew = e; }
    check('鍵が無ければ Claude に回さず、混雑として終わる',
          !!noKeyThrew && /Gemini APIエラー\(503\)/.test(noKeyThrew.message), noKeyThrew && noKeyThrew.message.slice(0, 60));

    claudeLib.createClient = realCreate;
    config.geminiRounds = rounds;
    state.gemini503 = 0;
  }

  // --force なら作る（手で動かすとき用）
  run.options.force = true;
  const forced = await run.main();
  check('--force なら同じ日でももう1本作る', forced && forced.path === 'articles/datasci-w1004.md', forced && forced.path);
  run.options.force = false;

  fs.rmSync(tmp, { recursive: true, force: true });
}

// ============================================================
// 3. 実データ（--live）
// ============================================================

async function liveTest() {
  const openalex = require('./lib/openalex');
  const { fetchPdf, extractText } = require('./lib/pdf');
  const { verifyTerms } = require('./lib/wikipedia');

  const result = await openalex.searchCandidates(1);
  console.log('検索条件に合う論文: ' + result.total.toLocaleString('en-US') + ' 件');
  result.papers.slice(0, 5).forEach((p) => console.log('   ' + String(p.citedBy).padStart(4) + '  ' + p.year + '  ' + p.title.slice(0, 70)));
  check('実データ: 候補が取れる', result.papers.length >= 10 && result.total > 500, result.total);

  let text = '';
  let tried = 0;
  for (const paper of result.papers.slice(0, 4)) {
    tried++;
    const pdf = await fetchPdf(paper);
    if (!pdf) continue;
    text = extractText(pdf);
    if (text.length > config.pdfTextMinChars) {
      console.log(`   PDF から本文 ${text.length.toLocaleString('en-US')} 字（${paper.title.slice(0, 50)}）`);
      break;
    }
  }
  check('実データ: PDF から本文を取り出せる（pdftotext）', text.length > config.pdfTextMinChars, text.length + ' 字 / ' + tried + ' 本試行');

  const wiki = await verifyTerms([
    { term: '過学習', wikiTitle: '過学習' }, { term: '存在しない項目', wikiTitle: 'ぜったいに存在しない項目名XYZ' }]);
  // 「過学習」は「過剰適合」への転送。転送先の項目名が返るのが正しい
  check('実データ: Wikipedia は実在する項目だけ返す（転送も追う）',
        wiki.length === 1 && wiki[0].term === '過学習' && wiki[0].title === '過剰適合' && wiki[0].extract.length > 20,
        JSON.stringify(wiki.map((w) => [w.term, w.title])));
}

(async () => {
  if (LIVE) await liveTest();
  else { unitTests(); await flowTest(); }
  const ng = checks.filter((c) => !c[1]);
  console.log('\n' + (checks.length - ng.length) + ' / ' + checks.length + ' OK' + (ng.length ? '（NG ' + ng.length + '）' : ''));
  process.exit(ng.length ? 1 : 0);
})();
