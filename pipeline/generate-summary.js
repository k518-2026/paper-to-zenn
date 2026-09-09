require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');

/**
 * 論文の要約を Claude に作らせる。
 *
 * 材料は J-STAGE から取った日本語要旨だけなので、
 * 書かれていないことを推測させない指示を強めにしている。
 */

const MODEL = 'claude-opus-5';

function client() {
  return new Anthropic();
}

function textOf(message) {
  return message.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim();
}

async function generateSummary(paper) {
  console.log('🤖 Claude で論文の要約を生成中...\n');

  const prompt = `以下の論文について、要旨をもとに日本語で要約してください。

【論文情報】
タイトル: ${paper.title}
著者: ${paper.authors}
掲載誌: ${paper.journal}（${paper.year}年）
URL: ${paper.url}

【論文の要旨】
${paper.abstract}

---

【要求フォーマット】
以下の5つの見出しで、各2〜3文程度にまとめてください。

1. **どんな研究？**
   何を明らかにしようとした研究か。対象と場面（校種・教科・人数など、要旨に書かれている範囲で）。

2. **何が新しい？**
   要旨が主張している新規性・位置づけ。

3. **手法のキモはどこ？**
   中核となる方法（調査・実験・分析の設計）。

4. **何が示された？**
   結果として明らかになったこと。

5. **現場・実務への示唆と、残された論点**
   使えそうな点と、要旨から読み取れる限界。

---

【厳守事項】

- **要旨に書かれていないことを書かないでください。** 数値・対象人数・統計的有意性などは、
  要旨に明記されている場合だけ触れてください。
- **実在しない論文名や研究者名を挙げないでください。** 具体的な文献の推薦は不要です。
- 要旨から判断できない項目は、推測で埋めずに「要旨からは判断できない」と書いてください。
- 専門用語は必要な範囲で使ってよいですが、初出時に短く補足してください。
- Markdown の見出し（##）は使わず、上記の番号と太字だけで構成してください。`;

  const message = await client().messages.create({
    model: MODEL,
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }]
  });

  const summary = textOf(message);
  if (!summary) throw new Error('Claude の応答が空でした');

  console.log('✅ 要約を生成しました\n');
  return { summary };
}

/**
 * 英語タイトルを日本語に訳す。
 *
 * J-STAGE の論文はたいてい日本語タイトルを持つが、英語のみの論文もある。
 * その場合だけ呼ぶ（日本語タイトルがあるなら訳す必要はない）。
 */
async function translateTitle(title, abstract) {
  console.log('🌐 英語タイトルを和訳中...');

  const prompt = `次の学術論文のタイトルを日本語に訳してください。

タイトル: ${title}

参考（論文の要旨）:
${String(abstract || '').slice(0, 800)}

【条件】
- 訳文だけを1行で出力してください。前置きや説明、引用符は不要です。
- 専門用語はその分野で通用する訳語を使ってください。
- 原題に無い情報を足さないでください。
- 全角40文字以内に収めてください。長い副題は削って構いません。`;

  const message = await client().messages.create({
    model: MODEL,
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }]
  });

  const translated = textOf(message).split('\n')[0].replace(/^["'「『]|["'」』]$/g, '').trim();
  if (!translated) {
    console.log('⚠️ 和訳が取れなかったので原題のまま進みます\n');
    return '';
  }

  console.log(`✅ 和訳: ${translated}\n`);
  return translated;
}

module.exports = { generateSummary, translateTitle };
