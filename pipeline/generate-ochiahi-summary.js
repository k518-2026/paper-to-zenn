require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');

/**
 * 落合陽一式論文要約フォーマットで Claude に要約させる
 */
async function generateOchiaiSummary(paper) {
  try {
    console.log('🤖 Claude で落合陽一式論文要約を生成中...\n');

    const client = new Anthropic();

    const prompt = `以下の論文について、「落合陽一式論文要約フォーマット」に従って要約してください。

【論文情報】
タイトル: ${paper.title}
著者: ${paper.authors}
発表日: ${paper.published}
arXIV: ${paper.arxivUrl}

【論文の概要（英語）】
${paper.summary}

---

【要求フォーマット】
以下の5つの視点から、日本語で要約してください。各項目は2-3文程度。

1. **先行研究と比べてどこがすごい？**
   - この論文の新規性は何か？
   - 既存研究とどう違うのか？

2. **技術や手法のキモはどこ？**
   - 論文の中核となる方法論・技術は何か？
   - なぜそれが重要なのか？

3. **どうやって有効だと検証した？**
   - どのような実験・調査を行ったのか？
   - 結果は何を示しているのか？

4. **議論はある？**
   - この論文の限界は何か？
   - 今後の課題は？

5. **次に読むべき論文は？**
   - この論文の関連分野で参考になる論文は？
   - どのような論文を読むべきか？

---

日本語で構造的に答えてください。`;

    const message = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 4000,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    const summary = message.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n')
      .trim();

    if (!summary) {
      throw new Error('Claude から本文が返りませんでした');
    }

    console.log(`✅ 落合陽一式論文要約を生成完了（${summary.length}文字）\n`);
    return summary;

  } catch (error) {
    console.error(`❌ 要約生成エラー: ${error.message}`);
    return null;
  }
}

/**
 * メイン処理
 */
async function main() {
  const testPaper = {
    title: 'Students\' Perception of Big Data Engineering in Higher Education Curricula',
    authors: 'Ioana-Georgiana Ciuciu, Petrescu Manuela-Andreea',
    published: '2026-09-04',
    arxivUrl: 'https://arxiv.org/abs/2609.05160',
    summary: `Recent advances in automatic rigging now deliver animation-ready 3D assets at scale, yet generating the motion to drive them remains a bottleneck. Existing learned animators are topology-constrained: they rely on category-specific templates or require per-skeleton fine-tuning and reference motions at inference. We present UniMate, a unified foundation model that synthesizes articulated motion for arbitrary skeletons from a rigged 3D asset and a text prompt, with no test-time optimization or per-...`
  };

  const summary = await generateOchiaiSummary(testPaper);

  if (summary) {
    console.log('\n' + '='.repeat(60));
    console.log('📝 落合陽一式論文要約フォーマット\n');
    console.log('='.repeat(60));
    console.log(summary);
    console.log('='.repeat(60));
  }
}

if (require.main === module) {
  main();
}

module.exports = { generateOchiaiSummary };
