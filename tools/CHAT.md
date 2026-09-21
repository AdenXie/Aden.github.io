# 临时 AI 聊天维护

页面：`/chat/`、`/en/chat/`。模型和 API Key 由 Vercel 环境变量提供；源码只固定 AMD Radeon Cloud 的 API 地址，使用 OpenAI-compatible Chat Completions 和流式输出。

## 启用

在 Vercel 的 `greatadens-projects / aden-github-io` 项目中打开 Settings → Environment Variables，配置：

| 名称 | 值 | 环境 |
| --- | --- | --- |
| `AI_API_KEY` | AMD Radeon Cloud 的 API Key（`rc-` 开头） | Production；需要预览时同时选择 Preview |
| `AI_MODEL` | `Qwen3.8-27B` | Production；需要预览时同时选择 Preview |

保存后，在 Deployments 中对最新 **main 分支 Production 部署**选择 Redeploy。环境变量只作用于新部署。不要重新部署 source 分支，它不是生成的网站。不要把 Key 写进 Hexo 配置、前端脚本、GitHub 或对话记录；也不需要把 Key 提供给 GitHub Actions。迁移期间，后端仍兼容现有的 `BIGMODEL_API_KEY` Secret 名称，但建议把它的值替换为 AMD Key 后再迁移到 `AI_API_KEY`。

临时关闭：将 `CHAT_ENABLED` 设为 `false` 并重新部署；删除 Key 同样会关闭聊天。无 Key 时页面仍可正常访问，输入和发送关闭，接口不调用模型。

## 隐私与限额

- 当前页面内可追问；刷新、离开、清空以及浏览器后退恢复时销毁对话。不使用 localStorage、sessionStorage、IndexedDB、Cookie 或数据库保存消息。
- 服务端仅在处理请求期间持有消息，不记录正文、回答或密钥；响应 `Cache-Control: no-store`。AMD Radeon Cloud 自己的数据保留政策不由本站控制。
- 单条输入 4000 字符、一次上下文 24000 字符、最多 10 轮；回答最多 2048 tokens / 16000 字符，服务端 60 秒超时。Vercel 函数上限 65 秒。
- 服务端单实例每个来源每分钟最多 5 次请求，仅暂存一分钟的哈希 IP 计数。它不是跨实例全局配额；AMD 公共免费模型还会按 API Key、IP、模型并发和平台容量限流，接口会转发上游 429 的 `Retry-After` 响应头，调用方可据此等待。
- 公开使用应在 Vercel Firewall 为 `/api/chat` 的 POST 配置按 IP 的固定窗口限速（建议 5 次 / 60 秒），并核对模型账户额度。WAF 规则属于平台配置，不会随 Git 发布。多 IP 访问仍可能耗尽免费额度，不承诺无限服务。

## 构建与测试

修改源码分支 source。`npm test` 后使用 `npm run build:site`；源文件 `source/api/chat.js` 被输出为 `public/api/chat.js`，由 Vercel 执行。GitHub Pages 只提供静态页面，聊天须经本站 Vercel 域名访问。

`node tools/verify-chat.cjs` 在本地静态预览上模拟模型响应，检查中英文、手机/桌面、流式响应、取消、清空、页面往返与不持久化。真实模型验证需要在已设置 Key 的 Vercel 部署上完成；不使用真实密钥运行模拟测试。

界面脚本和样式仅在聊天页加载；复用 `AdenSite` 挂载/销毁，模型内容使用文本节点及小范围 Markdown 排版，不执行 HTML、不自动加载模型给出的图片。没有新运行时依赖。

源码固定 API 地址：`https://developer.amd.com.cn/radeon/api/v1/chat/completions`

AMD 文档：[API overview](https://amd-aim.github.io/radeon-cloud-docs/api/overview/)、[Chat completions](https://amd-aim.github.io/radeon-cloud-docs/api/chat-completions/)、[Qwen3.8-27B](https://amd-aim.github.io/radeon-cloud-docs/models/qwen3-8-27b/)。
