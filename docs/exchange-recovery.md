# 汇率卡片数据链路

2026-09-17：生产环境访问中行返回 502，原始错误为 `source_timeout`；延长超时并同时请求两个官方域名后，Vercel 仍无法取得数据。本机同一页面可读，数据格式正确。不能依赖某一次接口成功来判断长期恢复。

## 获取与缓存

- `lib/workflows/exchange-rates.yml` 在构建后复制到默认分支 main 的 `.github/workflows`，每小时第 7、37 分钟由 GitHub Actions 直接读取中行官方页面。平台调度可能延迟。
- `tools/collect-exchange.cjs` 使用与接口相同的官方解析器，不安装依赖；失败不写入数据，保留上次成功记录。
- 成功结果保存在独立 `exchange-rates` 分支的 `aud-cny.json`，不触发博客重建。生成的 `vercel.json` 禁止这个数据分支触发 Vercel 部署。
- `/api/aud-cny` 优先读取三小时内的官方采集副本；副本不可用或过期时再尝试中行两个官方域名。数据源仍是中国银行现汇牌价，不混用市场中间价。
- 七天内的旧副本仅在直连失败时作为明确标识的旧数据展示；返回 `no-store`，不重新授予 CDN 缓存有效期。浏览器也不会将旧数据重新缓存为新数据。
- `publishedAt` 是中行发布时间，`fetchedAt` 是真实采集时间，转发不修改这两个时间。页面保留原有三小时缓存策略。

## 核验与维护

1. 在 GitHub Actions 打开 `Refresh official BOC exchange quote`，可用 `Run workflow` 手动采集；查看两个步骤是否均成功。
2. 检查数据分支中 `fetchedAt` 是否更新，再请求 `/api/aud-cny?v=4`，核对 `stale` 与中行发布时间。
3. 如果采集失败，检查该工作流日志；如果副本存在而接口仍失败，检查 Vercel 的 `[aud-cny]` 日志。
4. `npm test` 覆盖官方备用域名、正文超时、副本新旧状态、无效时间、冷启动失败和客户端缓存恢复。
5. 首次安装或修改采集工作流时，先通过有工作流写入权限的 GitHub 连接把同一文件放到 main 的 `.github/workflows/exchange-rates.yml`；日常构建令牌只能保留已有工作流，不能新增或修改。不要为此扩大日常令牌权限。

Vercel 数据分支隔离配置依据：https://vercel.com/docs/project-configuration/git-configuration#gitdeploymentenabled
