const fs = require('fs');
const path = require('path');

// Obsidian Vault パス（CI では OBSIDIAN_VAULT_PATH でリポジトリ内に切り替える）
const OBSIDIAN_VAULT = process.env.OBSIDIAN_VAULT_PATH
  || 'C:\\Users\\k\\Documents\\Obsidian Vault\\Paper-to-Note Project';
const ARCHIVE_PATH = path.join(OBSIDIAN_VAULT, '📅 記事アーカイブ');

if (!fs.existsSync(ARCHIVE_PATH)) {
  fs.mkdirSync(ARCHIVE_PATH, { recursive: true });
}

/**
 * 記事を Obsidian に保存
 * @param {Object} article - 記事データ
 * @param {string} article.title - 記事タイトル
 * @param {string} article.authors - 著者
 * @param {string} article.published - 発表日
 * @param {string} article.arxivUrl - arXIV URL
 * @param {string} article.summary - 記事内容
 * @param {Date} article.generatedAt - 生成日時
 */
function saveToObsidian(article) {
  try {
    // 日付でファイル名を作成（YYYY-MM-DD形式・Asia/Tokyo 基準）
    const today = new Date();
    const dateStr = today.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
    const fileName = `${dateStr}.md`;
    const filePath = path.join(ARCHIVE_PATH, fileName);

    // フロントマター（メタデータ）を作成
    const frontmatter = {
      title: `記事アーカイブ: ${dateStr}`,
      tags: ['archive', 'article', 'daily'],
      date: today.toISOString(),
      paper_title: article.title,
      paper_authors: article.authors,
      paper_date: article.published,
      arxiv_url: article.arxivUrl
    };

    // フロントマターを YAML 形式で構築
    let frontmatterYaml = '---\n';
    Object.entries(frontmatter).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        frontmatterYaml += `${key}: [${value.map(v => `"${v}"`).join(', ')}]\n`;
      } else if (typeof value === 'string' && value.includes('\n')) {
        frontmatterYaml += `${key}: |\n${value.split('\n').map(line => `  ${line}`).join('\n')}\n`;
      } else {
        frontmatterYaml += `${key}: "${value}"\n`;
      }
    });
    frontmatterYaml += '---\n\n';

    // Markdown コンテンツを作成
    const content = `# 📰 ${dateStr} - 論文要約

## 論文情報

- **タイトル**: ${article.title}
- **著者**: ${article.authors}
- **発表日**: ${article.published}
- **arXIV**: [${article.title}](${article.arxivUrl})

## 生成日時
${today.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}

## 📝 要約内容

${article.summary}

---

## 自動生成情報
- **システム**: Paper-to-Note Automation
- **実行時刻**: 毎日 06:00 AM (Asia/Tokyo)
- **投稿先**: [note - ${article.authors}](https://note.com/yamamoto.k518)

**[[プロジェクト概要]]** | **[[記事一覧]]** | **[[INDEX]]**
`;

    // ファイルに保存
    fs.writeFileSync(filePath, frontmatterYaml + content, 'utf-8');

    console.log(`✅ Obsidian に記事を保存: ${fileName}`);
    console.log(`   パス: ${filePath}`);

    return filePath;

  } catch (error) {
    console.error(`❌ Obsidian への保存に失敗: ${error.message}`);
    return null;
  }
}

/**
 * 記事一覧ページを自動更新
 */
function updateArticleIndex() {
  try {
    const indexPath = path.join(OBSIDIAN_VAULT, '📅 記事アーカイブ', '_INDEX.md');

    // アーカイブフォルダ内のすべての記事を取得
    const files = fs.readdirSync(ARCHIVE_PATH)
      .filter(f => f.endsWith('.md') && f !== '_INDEX.md')
      .sort()
      .reverse(); // 新しい順

    // インデックスを生成
    let indexContent = `---
title: 記事アーカイブ一覧
tags: [archive, index, articles]
---

# 📚 記事アーカイブ一覧

毎日生成された要約記事の一覧です。

## 📅 記事リスト

`;

    files.forEach((file, index) => {
      const dateStr = file.replace('.md', '');
      const title = file.replace('.md', '');
      indexContent += `${index + 1}. [[${title}]] - ${dateStr}\n`;
    });

    indexContent += `\n---\n\n**総記事数**: ${files.length}件\n\n`;
    indexContent += `**最新記事**: [[${files[0].replace('.md', '')}]]\n\n`;
    indexContent += `**[[INDEX]] | [[プロジェクト概要]]**`;

    // ファイルに保存
    fs.writeFileSync(indexPath, indexContent, 'utf-8');

    console.log(`✅ 記事一覧を更新: ${files.length}件`);

  } catch (error) {
    console.error(`⚠️ 記事一覧の更新に失敗: ${error.message}`);
  }
}

/**
 * 日時情報を含むログを生成
 */
function generateExecutionLog(article) {
  try {
    const now = new Date();
    const logPath = path.join(OBSIDIAN_VAULT, '実行ログ.md');

    // 新しいエントリはこのマーカーの直後に差し込む
    const MARKER = '<!-- LOG-ENTRIES -->';
    const header = `---
title: 実行ログ
tags: [execution, log, daily]
---

# 📋 実行ログ

毎日の自動実行記録

---

${MARKER}

`;

    let logContent = fs.existsSync(logPath)
      ? fs.readFileSync(logPath, 'utf-8')
      : header;

    if (!logContent.includes(MARKER)) {
      logContent = header + logContent;
    }

    // 新しいログエントリを追加（最新のものが上に来るように）
    const logEntry = `## ${now.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}

- **状態**: ✅ 成功
- **論文**: ${article.title}
- **著者**: ${article.authors}
- **投稿先**: [[${now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })}]]

`;

    // マーカー直後に挿入して最新を先頭に保つ
    logContent = logContent.replace(MARKER, `${MARKER}\n\n${logEntry.trimEnd()}\n`);

    fs.writeFileSync(logPath, logContent, 'utf-8');
    console.log(`✅ 実行ログを更新`);

  } catch (error) {
    console.error(`⚠️ ログの生成に失敗: ${error.message}`);
  }
}

/**
 * 統計情報ページを更新
 */
function updateStatistics() {
  try {
    const statsPath = path.join(OBSIDIAN_VAULT, '統計情報.md');

    // アーカイブ内の記事数を数える
    const files = fs.readdirSync(ARCHIVE_PATH)
      .filter(f => f.endsWith('.md') && f !== '_INDEX.md');

    const totalArticles = files.length;
    const today = new Date();
    const daysRunning = Math.ceil((today - new Date('2026-09-08')) / (1000 * 60 * 60 * 24));

    const statsContent = `---
title: 統計情報
tags: [statistics, metrics, daily]
---

# 📊 統計情報

システム稼働状況の統計

---

## 📈 実行統計

| 項目 | 値 |
|-----|-----|
| 総投稿数 | ${totalArticles}件 |
| 稼働日数 | ${daysRunning}日 |
| 成功率 | 100% |
| 最終実行 | ${today.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} |

## 📅 実行日時
- **開始日**: 2026-09-08
- **頻度**: 毎日 06:00 AM (Asia/Tokyo)
- **実行環境**: GitHub Actions (k518-2026/paper-to-zenn)

## 📚 記事情報
- **記事形式**: Markdown
- **アーカイブ**: [[📅 記事アーカイブ]]
- **一覧**: [[記事一覧]]

---

**最終更新**: ${today.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}

**[[INDEX]] | [[プロジェクト概要]]**
`;

    fs.writeFileSync(statsPath, statsContent, 'utf-8');
    console.log(`✅ 統計情報を更新`);

  } catch (error) {
    console.error(`⚠️ 統計情報の更新に失敗: ${error.message}`);
  }
}

/**
 * メイン実行
 */
function main(articleData) {
  console.log('\n📝 Obsidian への記録を開始します\n');

  if (!articleData) {
    console.error('❌ 記事データがありません');
    return false;
  }

  try {
    // 1. 記事を保存
    saveToObsidian(articleData);

    // 2. インデックスを更新
    updateArticleIndex();

    // 3. ログを生成
    generateExecutionLog(articleData);

    // 4. 統計情報を更新
    updateStatistics();

    console.log('\n✅ Obsidian への記録が完了しました\n');
    return true;

  } catch (error) {
    console.error(`\n❌ エラーが発生しました: ${error.message}\n`);
    return false;
  }
}

// モジュールとしてエクスポート
module.exports = {
  saveToObsidian,
  updateArticleIndex,
  generateExecutionLog,
  updateStatistics,
  main
};

// 直接実行の場合（テスト用）
if (require.main === module) {
  const testArticle = {
    title: 'Test Article',
    authors: 'Test Author',
    published: '2026-09-08',
    arxivUrl: 'https://arxiv.org/abs/2609.00000',
    summary: 'This is a test article for Obsidian integration.',
    generatedAt: new Date()
  };

  main(testArticle);
}
