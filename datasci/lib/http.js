/** 通信の共通部分。再試行と、よくある失敗の見分け方 */

const USER_AGENT = 'paper-to-zenn-datasci/1.0 (mailto:yamamoto.k518@gmail.com)';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 一時的な失敗（429・5xx・通信断）だけ待って試し直す。
 * shouldRetry を渡すと、応答の中身を見て再試行の可否を決められる（OpenAlex の枠切れなど）。
 */
async function fetchRetry(url, options = {}, { attempts = 3, shouldRetry = null, timeoutMs = 60000 } = {}) {
  let last = null;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, {
        ...options,
        headers: { 'User-Agent': USER_AGENT, ...(options.headers || {}) },
        signal: AbortSignal.timeout(timeoutMs)
      });
      const retryable = shouldRetry ? await shouldRetry(res) : (res.status === 429 || res.status >= 500);
      if (!retryable || i === attempts) return res;
      last = new Error(`HTTP ${res.status}`);
    } catch (e) {
      if (i === attempts) throw e;
      last = e;
    }
    const wait = 2000 * i + Math.floor(Math.random() * 1000);
    console.log(`  再試行します(${i}/${attempts - 1}, ${wait}ms待機): ${last.message}`);
    await sleep(wait);
  }
  throw last;
}

async function httpError(label, res) {
  const body = await res.text().catch(() => '');
  const e = new Error(`${label}(${res.status}): ${body.slice(0, 300)}`);
  e.status = res.status;
  e.body = body;
  return e;
}

function requireEnv(name) {
  const v = (process.env[name] || '').trim();
  if (!v) throw new Error(`${name} が設定されていません（GitHub の Settings → Secrets → Actions で登録します）`);
  return v;
}

module.exports = { fetchRetry, httpError, requireEnv, sleep, USER_AGENT };
