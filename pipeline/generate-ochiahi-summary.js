require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');

/**
 * 落合陽一式論文要約フォーマットで Claude に要約させる。
 *
 * 入力は J-Stage から取った国内論文（日本語の要旨）。
 * 要旨だけを材料にするので、書かれていないことを推測させない指示を強めている。
 */
async function generateOchiaiSummary(paper) {
  console.log('🤖 Claude で落合陽一式論文要約を生成中...\n');

  const client = new Anthropic();

  const prompt = `以下の論文について、「落合陽一式論文要約フォーマット」に従って要約してください。

【論文情報】
タイトル: ${paper.title}
著者: ${paper.authors}
掲載誌: ${paper.journal}（${paper.year}年）
URL: ${paper.url}

【論文の要旨】
${paper.abstract}

---

【要求フォーマット】
以下の5つの視点から、日本語で要約してください。各項目は2〜3文程度。

1. **どんな研究？**
   - 何を明らかにしようとした研究か
   - 対象と場面（校種・教科・人数など、要旨に書かれている範囲で）

2. **先行研究と比べてどこが新しい？**
   - 要旨が主張している新規性・位置づけ

3. **手法のキモはどこ？**
   - 中核となる方法（調査・実験・分析の設計）

4. **どうやって有効だと示した？**
   - 結果として何が示されたか

5. **教育現場への示唆と、残された論点**
   - 現場で使えそうな点
   - 要旨から読み取れる限界や、この要旨だけでは分からない点

---

【厳守事項】

- **要旨に書かれていないことを書かないでください。** 数値・対象人数・統計的有意性などは、
  要旨に明記されている場合だけ触れてください。
- **実在しない論文名や研究者名を挙げないでください。** 「次に読むべき論文」のような
  具体的な文献の推薦は不要です。関連しそうな「分野・観点」に留めてください。
- 要旨から判断できない項目は、推測で埋めずに「要旨からは判断できない」と書いてください。
- 専門用語は避け、教育に関わる読者が直感的に理解できる言葉にしてください。
- Markdown の見出し（##）は使わず、上記の1〜5の番号と太字だけで構成してください。`;

  const message = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = message.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim();

  if (!text) throw new Error('Claude の応答が空でした');

  console.log('✅ 要約を生成しました\n');
  return { summary: text };
}

module.exports = { generateOchiaiSummary };
