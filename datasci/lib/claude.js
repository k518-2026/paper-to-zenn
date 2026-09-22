/**
 * Claude（Gemini が全部混雑したときの逃げ道）
 *
 * Gemini は無料枠だが、混雑（503）が続くと記事を作れずに終わる（2026-09-23 に実際に発生）。
 * 全モデルを巡っても駄目なときだけここへ回す。従量課金なので、混雑した日だけ費用が出る。
 *
 * 鍵は ANTHROPIC_API_KEY（このリポジトリの Secrets に既にある）。
 */
const config = require('../config');

/** テストが差し替えられるように、client を作る場所を分けてある */
function createClient() {
  const Anthropic = require('@anthropic-ai/sdk');
  return new Anthropic();   // ANTHROPIC_API_KEY を環境から読む
}

function available() {
  return !!(process.env.ANTHROPIC_API_KEY || '').trim();
}

/**
 * Gemini と同じ形（parts の配列）を受け取り、JSON を返す。
 * スキーマは指示文で守らせる（Gemini 用の指示文にも JSON で返すよう書いてある）。
 */
async function generateJson(parts) {
  const client = module.exports.createClient();
  const text = parts.map((p) => p.text || '').join('\n');

  const res = await client.messages.create({
    model: config.claude.model,
    max_tokens: config.claude.maxTokens,
    output_config: { effort: config.claude.effort },
    system: '求められた項目だけを JSON で返してください。前置き・説明・コードブロックの印は付けないこと。',
    messages: [{ role: 'user', content: text }]
  });

  if (res.stop_reason === 'refusal') {
    throw new Error('Claude が応答を断りました（' + ((res.stop_details || {}).category || '理由不明') + '）');
  }

  const body = (res.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  if (!body) throw new Error('Claude の応答が空です');
  try {
    return JSON.parse(body.replace(/^```json\s*|\s*```$/g, ''));
  } catch (e) {
    throw new Error('Claude の応答が JSON ではありません: ' + body.slice(0, 300));
  }
}

module.exports = { generateJson, createClient, available };
