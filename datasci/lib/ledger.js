/**
 * 台帳（datasci/ledger.json）
 *
 * GAS 版はスプレッドシートだったが、ここでは JSON をリポジトリに置く。
 * 同じ論文を二度取り上げないための記録で、履歴も git に残る。
 * 記事にしなかった論文（PDF が取れない・テーマ外）も残す。**二度と取りに行かないため**。
 */
const fs = require('fs');
const path = require('path');

const STATUS = {
  DONE: '記事にした',
  SKIPPED: '対象外',
  FAILED: '失敗'
};

/** 日付は日本時間で持つ（UTC のままだと朝の実行で前日になる） */
function jstDate() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function load(file) {
  try {
    const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn('台帳を読めませんでした（新しく作ります）: ' + e.message);
    return [];
  }
}

function save(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(rows, null, 2) + '\n', 'utf8');
}

/** OpenAlex の ID と DOI の両方で照合する */
function knownKeys(rows) {
  const keys = new Set();
  rows.forEach((r) => {
    if (r.id) keys.add(String(r.id).toLowerCase());
    if (r.doi) keys.add('doi:' + String(r.doi).toLowerCase());
  });
  return keys;
}

function isKnown(keys, paper) {
  if (keys.has(String(paper.id).toLowerCase())) return true;
  return !!paper.doi && keys.has('doi:' + String(paper.doi).toLowerCase());
}

function record(paper, status, extra = {}) {
  return {
    id: paper.id,
    doi: paper.doi,
    title: paper.title,
    venue: paper.venue,
    year: paper.year,
    citedBy: paper.citedBy,
    status,
    date: jstDate(),
    ...extra
  };
}

/** その日にもう記事を作っていれば true（1日1本を守る） */
function madeToday(rows, today) {
  return rows.some((r) => r.status === STATUS.DONE && r.date === today);
}

module.exports = { load, save, knownKeys, isKnown, record, madeToday, jstDate, STATUS };
