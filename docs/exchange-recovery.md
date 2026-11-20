# 汇率卡片数据链路

2026-09-17：生产环境访问中行返回 502，原始错误为 `source_timeout`；延长超时并同时请求两个官方域名后，Vercel 仍无法取得数据。本机同一页面可读，数据格式正确。不能依赖某一次接口成功来判断长期恢复。

## 获取与缓存

- `.github/workflows/exchange-rates.yml` 在默认分支 source 上，由 source 上的这份触发定时任务，北京时间周一至周五每小时第 7、37 分钟触发；周六、周日不创建定时任务。手动运行始终允许采集。平台调度可能延迟。
- `tools/collect-exchange.cjs` 使用 `tools/lib/boc-rates.cjs` 中的官方采集与解析逻辑，不安装依赖；失败不写入数据，保留上次成功记录。该代码仅供 GitHub Actions 使用，不部署到 Vercel。
- 成功结果保存在独立 `exchange-rates` 分支的 `aud-cny.json`，不触发博客重建。生成的 `vercel.json` 禁止这个数据分支触发 Vercel 部署。
- `/api/aud-cny` 只读取 GitHub Actions 生成的快照，单次请求上限两秒，不再直连中行。数据源仍是中国银行现汇牌价，不混用市场中间价。
- 三小时至七天内的旧快照明确标识为未更新，返回 `no-store`，不重新授予 CDN 缓存有效期。GitHub 无法读取时，可显示函数内上次验证通过且未超过七天的快照；冷启动无可用快照则返回 502 `snapshot_unavailable`。浏览器也不会将旧数据重新缓存为新数据。
- `publishedAt` 是中行发布时间，`fetchedAt` 是真实采集时间，转发不修改这两个时间。页面保留原有三小时缓存策略。

## 历史走势

- 快照 `aud-cny.json` 里带 `history`：`[北京交易日, 现汇买入价, 现汇卖出价]`，旧到新，每日只留当天最后一次牌价，最多 400 天。北京时间 06:00 前的牌价算前一个交易日（中行过午夜仍在发布）。规则在 `tools/lib/boc-history.cjs`，卡片里有一份同样的 `tradingDay`，测试保证两者一致。
- 采集时先读上一份快照里的历史再合并新牌价，所以采集工作流本身不用改。上一份快照读不到（不是 404）就整次失败、不写入，避免写出一份没有历史的快照把历史抹掉；404 视为首次运行，从种子开始。
- `tools/data/aud-cny-history-seed.json` 是 2026-09-17 起从 `exchange-rates` 分支提交记录里恢复的每日数据，每次采集都会并入，即使快照被意外覆盖也能补回这段。中行网站的历史牌价查询页（srh.bankofchina.com）目前返回 404，没有更早的数据来源。
- `/api/aud-cny-history` 只返回历史，缓存规则同 `/api/aud-cny`；`/api/aud-cny` 不再带 `history` 字段。聊天的汇率工具附带近 30 个交易日的卖出价最高、最低和涨跌。

## 核验与维护

1. 在 GitHub Actions 打开 `Refresh official BOC exchange quote`，可用 `Run workflow` 手动采集；查看两个步骤是否均成功。
2. 检查数据分支中 `fetchedAt` 是否更新，再请求 `/api/aud-cny?v=4`，核对 `stale` 与中行发布时间。
3. 如果采集失败，检查该工作流日志；如果副本存在而接口仍失败，检查 Vercel 的 `[aud-cny]` 日志。
4. `npm test` 覆盖官方备用域名、正文超时、副本新旧状态、无效时间、冷启动失败和客户端缓存恢复。
5. 构建会把同一文件原样复制到 main 的 `.github/workflows/`（main 上已有这份，非默认分支不会定时触发）。日常构建令牌只能原样保留已有工作流，不能新增、修改或删除；所以修改采集工作流时，先由有工作流写入权限的 GitHub 连接把改后的文件同时放到 main，再推送 source，否则部署推送 main 会被拒。不要为此扩大日常令牌权限。

Vercel 数据分支隔离配置依据：https://vercel.com/docs/project-configuration/git-configuration#gitdeploymentenabled
