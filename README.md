# Aden's Space

这是 `blog.adenxie.com.cn` 的 Hexo 源码，使用 Redefine 主题。15 篇历史文章已从原 GitHub Pages 成品站恢复为 Markdown，并保留原网址、发布日期、标签、正文和图片。

站点成品保存在 GitHub 仓库的 `main` 分支，供 GitHub Pages 和 Vercel 同步部署；自定义域名目前指向 Vercel。源码保存在 `source` 分支。

## 本地预览

需要 Node.js 22 或更高版本：

```bash
npm ci
npm run build:site
npm run preview
```

浏览器打开 `http://127.0.0.1:4000`。这是完整的优化后静态预览；本地静态服务不运行 Vercel 的天气、汇率接口，卡片会显示对应离线状态。写文章时也可以使用 `npm run server`，但该开发预览不包含最终双语处理及资源优化。

## 发布

```bash
npm test
npm run build:site
git add .
git commit -m "更新文章"
git push origin source
```

推送到 `source` 分支后，仓库现有的 Hexo 部署工作流会构建站点并更新 `main` 分支；GitHub Pages 与 Vercel 随后同步正式站。此工作流只负责构建和部署，不会自动生成文章。

生产构建只有一个入口：`npm run build:site`。它依次准备主题适配层、清理输出、构建中文与英文界面、读取翻译缓存生成双语页面、优化资源并检查引用。GitHub Actions 使用同一个入口；`npm run release` 会在构建成功后执行部署。单独的 `build`、`build:english` 保留供调试，不能代替生产构建。

英文翻译沿用 `.translation-cache`；没有凭据时不会调用翻译服务。已有完整译文会保留，新页面缺少翻译时不会冒充完整英文页面。详见 `tools/BILINGUAL.md`。

## 维护位置

- `source/_posts`：文章；`source/api`：天气及汇率接口，接口约定未变。
- `lib/README.main.md`：成品分支首页说明；生产构建会把它复制为 `main` 分支的 `README.md`，不要直接修改生成文件。
- `lib/styles/base.css`：颜色、字体、导航和首页基础外观；`home-cards.css`：天气及汇率卡片；`pages.css`：正文样式及最后生效的响应式规则。三份样式按此顺序合并，保留原有优先级。不要在生成的 `public/css` 中改样式。
- `source/js/site-runtime.js`：组件挂载、销毁、可见时钟、可取消延迟及评论按需加载。各组件保留自己的数据校验、缓存期限和错误文案。
- `tools/prepare-site.cjs`、`lib/theme`：针对 Redefine 2.9.0 的小范围适配。上游安装包不修改，生成的 `themes/redefine` 不入库。升级主题需先审阅差异、调整适配代码及 `lib/theme-adapter-checksums.json`，再测试；校验失败不能直接绕过。
- `lib/images/home-hero-original.jpg`：当前首页原图，构建产生 640、960、1280、1920 像素宽的 WebP。来源是原有图床地址；`source/images/home-hero.jpg` 是另一张旧照片，不作为新背景输入。
- `tools/optimize-site.cjs`：双语生成后的统一资源处理；`tools/subset-icons.cjs`：从 HTML 和脚本收集常用图标，生成小字体，完整字体继续保留作其他图标的回退。

搜索首次打开才取索引，评论接近屏幕才初始化，播放器保持原界面且点击后才下载音频。主题与评论客户端脚本、字体和背景从同域加载；评论数据、音乐、统计和一言仍使用原服务。首页缩略图接近屏幕再加载，并保留无 JavaScript 的图片回退。

## 验证

```bash
npm test
npm run build:site
node tools/verify-browser.cjs
node tools/benchmark.cjs public after
```

浏览器检查和测速使用本机 Chrome（通过 Playwright），不上传内容、不发布评论。结果与截图在忽略入库的 `.perf`；测速需要保留一份改动前的静态目录，通过 `node tools/benchmark.cjs <目录> before` 获取对照。每档网络冷启动三次，详情和当前结果见 `docs/performance.md`。

每日简报不再定时发布。需要发布时，在 Codex 中调用本机的 `$aden-blog-daily-publish` Skill，选择使用已有新闻/汇率报告，或重新检索生成报告；检查草稿并确认后才会写入 GitHub。

## 写新文章

```bash
npx hexo new "文章标题"
```

生成的 Markdown 位于 `source/_posts/`。编辑完成后按上面的“发布”步骤操作即可。
