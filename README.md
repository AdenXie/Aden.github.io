# The Aden Family

这是 `blog.adenxie.com.cn` 的 Hexo 源码，使用 Redefine 主题。15 篇历史文章已从原 GitHub Pages 成品站恢复为 Markdown，并保留原网址、发布日期、标签、正文和图片。

## 本地预览

需要 Node.js 20 或更高版本：

```bash
npm install
npm run server
```

浏览器打开 `http://localhost:4000`。

## 发布

```bash
npm run release
```

该命令会清理旧产物、重新生成站点，并发布到 `AdenXie/Aden.github.io` 的 `main` 分支。源码保存在同一仓库的 `source` 分支。

## 写新文章

```bash
npx hexo new "文章标题"
```

生成的 Markdown 位于 `source/_posts/`。编辑完成后先运行 `npm run server` 检查，再运行 `npm run release` 发布。
