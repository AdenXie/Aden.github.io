# Aden's Space

这是 `blog.adenxie.com.cn` 的 Hexo 源码，使用 Redefine 主题。15 篇历史文章已从原 GitHub Pages 成品站恢复为 Markdown，并保留原网址、发布日期、标签、正文和图片。

站点成品保存在 GitHub 仓库的 `main` 分支，供 GitHub Pages 和 Vercel 同步部署；自定义域名目前指向 Vercel。源码保存在 `source` 分支。

## 本地预览

需要 Node.js 20 或更高版本：

```bash
npm install
npm run server
```

浏览器打开 `http://localhost:4000`。

## 发布

```bash
npm run clean
npm run build
git add .
git commit -m "更新文章"
git push origin source
```

推送到 `source` 分支后，仓库现有的 Hexo 部署工作流会构建站点并更新 `main` 分支；GitHub Pages 与 Vercel 随后同步正式站。此工作流只负责构建和部署，不会自动生成文章。

每日简报不再定时发布。需要发布时，在 Codex 中调用本机的 `$aden-blog-daily-publish` Skill，选择使用已有新闻/汇率报告，或重新检索生成报告；检查草稿并确认后才会写入 GitHub。

## 写新文章

```bash
npx hexo new "文章标题"
```

生成的 Markdown 位于 `source/_posts/`。编辑完成后按上面的“发布”步骤操作即可。
