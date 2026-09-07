require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * 落合陽一式論文要約フォーマットで要約を構造化
 */
function formatOchiaiSummary(paper, summary) {
  // Claude が生成済みの落合陽一式5項目要約をそのまま本文にする
  return `## 落合陽一式論文要約\n\n${summary}\n`;
}

/**
 * Zenn に投稿（GitHub リポジトリを使用、インフォグラフィック付き）
 */
async function postToZenn(paper, summary, infographicPath) {
  try {
    console.log('📤 Zenn に投稿を開始します...\n');

    const repoName = process.env.GITHUB_REPO || 'paper-to-zenn';
    // CI ではリポジトリ自体が作業ディレクトリなので ZENN_REPO_PATH で差し替える
    const repoPath = process.env.ZENN_REPO_PATH || path.join(__dirname, repoName);

    // 記事のスラッグを生成（Zenn 規則: a-z0-9・ハイフン・アンダースコアのみ、12〜50文字）
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
    const titlePart = paper.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 30)
      .replace(/-+$/, '');
    const slug = `${today}-${titlePart}`.substring(0, 50).replace(/-+$/, '');

    // 落合陽一式要約を生成
    console.log('📝 落合陽一式論文要約フォーマットで生成中...');
    const ochaiSummary = formatOchiaiSummary(paper, summary);

    // インフォグラフィックをコピー
    let imageUrl = '';
    if (infographicPath && fs.existsSync(infographicPath)) {
      console.log('🖼️ インフォグラフィックをコピー中...');
      const imagesDir = path.join(repoPath, 'images');
      if (!fs.existsSync(imagesDir)) {
        fs.mkdirSync(imagesDir, { recursive: true });
      }

      const imageName = `${today}-infographic${path.extname(infographicPath)}`;
      const imageDest = path.join(imagesDir, imageName);
      fs.copyFileSync(infographicPath, imageDest);
      imageUrl = `\n![インフォグラフィック](/images/${imageName})\n`;
      console.log(`✅ インフォグラフィックをコピー: ${imageName}`);
    }

    // Markdown ファイルを生成
    const markdownContent = `---
title: "【論文要約】${paper.title}"
emoji: "📚"
type: "idea"
topics: ["教育", "ICT", "研究", "論文要約"]
published: true
---

## 論文情報

| 項目 | 内容 |
|------|------|
| **タイトル** | ${paper.title} |
| **著者** | ${paper.authors} |
| **発表日** | ${paper.published} |
| **arXIV** | [${paper.arxivUrl}](${paper.arxivUrl}) |

---

${imageUrl}

---

${ochaiSummary}

---

## 参考資料

- 【元論文】[arXIV](${paper.arxivUrl})
- 【関連記事】Obsidian Vault に記録済み
- 【SNS投稿】Bluesky で毎日配信中

---

**作成日**: ${new Date().toISOString()}
**自動投稿**: Paper-to-Note Automation System

*このコンテンツは毎日自動で生成・投稿されています。*
`;

    // リポジトリが存在しない場合はクローン
    if (!fs.existsSync(repoPath)) {
      console.log(`🔗 リポジトリをクローン中: ${repoName}`);
      try {
        execSync(`git clone https://github.com/${process.env.GITHUB_USERNAME || 'k518-2026'}/${repoName}.git "${repoPath}"`, {
          cwd: __dirname,
          stdio: 'inherit'
        });
      } catch (e) {
        console.log(`⚠️ リポジトリのクローンに失敗。ローカルで記事を生成します。`);
      }
    }

    // articles ディレクトリを作成
    const articlesDir = path.join(repoPath, 'articles');
    if (!fs.existsSync(articlesDir)) {
      fs.mkdirSync(articlesDir, { recursive: true });
    }

    // Markdown ファイルを保存
    const filePath = path.join(articlesDir, `${slug}.md`);
    fs.writeFileSync(filePath, markdownContent, 'utf-8');
    console.log(`✅ Markdown ファイルを生成: ${slug}.md`);

    // CI ではワークフロー側がコミット・プッシュを行うのでスキップ
    if (process.env.SKIP_GIT_PUSH === 'true') {
      console.log('⏭️ Git 操作をスキップ（CI 側でコミットします）\n');
      return true;
    }

    // Git コマンドで push
    console.log('\n🚀 GitHub にプッシュ中...');

    try {
      // Git 設定
      execSync('git config user.email "yamamoto.k518@gmail.com"', { cwd: repoPath });
      execSync('git config user.name "Paper-to-Note Bot"', { cwd: repoPath });

      // ステージング
      execSync('git add .', { cwd: repoPath });

      // コミット（変更がない場合はスキップ）
      try {
        execSync(`git commit -m "Add article: ${slug}"`, { cwd: repoPath });
      } catch (e) {
        if (!e.message.includes('nothing to commit')) {
          throw e;
        }
      }

      // リモート URL を設定（トークンは push 時にのみ使用し、.git/config には残さない）
      const githubUser = process.env.GITHUB_USERNAME || 'k518-2026';
      const token = process.env.GITHUB_TOKEN;

      if (!token) {
        throw new Error('GITHUB_TOKEN が未設定です。GitHub はパスワード認証を廃止しているため Personal Access Token が必要です');
      }

      try {
        execSync('git remote remove origin', { cwd: repoPath, stdio: 'ignore' });
      } catch (e) {
        // リモートがない場合はスキップ
      }

      execSync(`git remote add origin https://github.com/${githubUser}/${repoName}.git`, { cwd: repoPath });

      // プッシュ（認証情報は URL に埋め込まず一時的に渡す）
      const authUrl = `https://${githubUser}:${token}@github.com/${githubUser}/${repoName}.git`;
      execSync(`git push ${authUrl} main`, { cwd: repoPath, stdio: 'pipe' });

      console.log('✅ GitHub にプッシュ完了！');
      console.log(`🔗 リポジトリ: https://github.com/${githubUser}/${repoName}`);
      console.log(`📄 記事: ${slug}.md\n`);

    } catch (gitError) {
      // トークンがログに残らないよう伏字化
      const safeMessage = (gitError.message || '')
        .replace(/(gh[ps]_|github_pat_)[A-Za-z0-9_]+/g, '$1***')
        .replace(/https:\/\/[^@\s]+@/g, 'https://***@');
      console.log(`⚠️ Git プッシュに失敗: ${safeMessage}`);
      console.log(`✅ ただし Markdown ファイルは生成されました: ${filePath}`);
      console.log('📝 手動で GitHub にアップロードしてください\n');
    }

    console.log('✅ Zenn への投稿準備が完了しました！');
    console.log(`💡 Zenn が GitHub リポジトリを監視して自動で記事を公開します\n`);

    return true;

  } catch (error) {
    console.error(`\n❌ Zenn への投稿に失敗: ${error.message}\n`);
    return false;
  }
}

/**
 * メイン処理
 */
async function main(paper, summary) {
  console.log('\n📝 Zenn への投稿プロセス\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (!paper || !summary) {
    console.error('❌ 論文データまたは要約データが不足しています');
    return false;
  }

  try {
    const posted = await postToZenn(paper, summary);

    if (posted) {
      console.log('✅ Zenn への投稿が完了しました!');
      return true;
    } else {
      console.log('⚠️ Zenn への投稿に問題が発生しました');
      return false;
    }

  } catch (error) {
    console.error(`\n❌ エラー: ${error.message}\n`);
    return false;
  }
}

module.exports = {
  postToZenn,
  main
};

// テスト用
if (require.main === module) {
  const testPaper = {
    title: 'Students\' Perception of Big Data Engineering in Higher Education Curricula',
    authors: 'Ioana-Georgiana Ciuciu, Petrescu Manuela-Andreea',
    published: '2026-09-04',
    arxivUrl: 'https://arxiv.org/abs/2609.05160'
  };

  const testSummary = 'この論文は大学教育におけるビッグデータ工学の学生の認識について調査しています。教育技術とデジタル学習の重要性が強調されています。';

  main(testPaper, testSummary);
}
