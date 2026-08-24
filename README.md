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
npm run server
git add .
git commit -m "更新文章"
git push
npm run release
```

前三条 Git 命令会把源码备份到同一仓库的 `source` 分支；`npm run release` 会清理旧产物、重新生成站点并发布到 `main` 分支。Vercel 的 Git 集成随后会自动同步正式站。

## 写新文章

```bash
npx hexo new "文章标题"
```

生成的 Markdown 位于 `source/_posts/`。编辑完成后按上面的“发布”步骤操作即可。
