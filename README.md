# Aden's Space

> 一个记录科技、数码体验、系统实践、经济学学习与日常观察的个人博客。

**访问网站：** [blog.adenxie.com.cn](https://blog.adenxie.com.cn)

## 关于本站

Aden's Space 创建于 2021 年，并在 2026 年完成了一次全面重建。这里既保留了早期的设备体验、系统教程和个人观点，也持续收录经济学学习笔记、专题文章与每日简报。

网站内容主要包括：

- 手机、平板、电脑等消费电子产品的体验与选购观察；
- Windows、Android 与设备生态相关的配置和实践教程；
- 经济学课程笔记、专题分析及个人思考；
- 科技、商业、政策与全球动态每日简报；
- 建站过程、AI Agent 协作和个人阶段性记录。

## 网站功能

- **中英双语：** 中文内容为主，并为已有译文提供独立英文页面和搜索索引；
- **内容导航：** 支持全文搜索、分类、标签、文章目录和相关推荐；
- **首页实时信息：** 根据访客位置显示天气，并展示中国银行 AUD/CNY 现汇牌价快照；
- **世界时间：** 集中查看多个城市的当地时间、日期与时差；
- **阅读体验：** 响应式布局、深浅色模式、代码高亮、数学公式和图片懒加载；
- **互动功能：** 支持文章评论、背景音乐和友链页面。

汇率仅供个人非商业展示，实际交易价格以中国银行官方渠道为准。天气、汇率、评论、音乐及统计等功能依赖对应的外部服务，暂时不可用时会保留缓存或显示明确的离线状态。

## 技术与部署

本站使用 [Hexo](https://hexo.io/) 和 [Redefine](https://github.com/EvanNotFound/hexo-theme-redefine) 构建，并针对双语页面、动态卡片和加载性能进行了定制：

- `source` 分支保存文章、配置、测试和构建工具；
- `main` 分支保存自动生成的静态网站，即当前分支；
- GitHub Actions 负责测试、构建、部署及工作日汇率快照更新；
- GitHub Pages 与 Vercel 托管成品站，Vercel Functions 提供天气和汇率读取接口。

`main` 分支内容由发布流程生成，请不要直接修改。需要查看源码或参与维护，请切换到 [`source` 分支](https://github.com/AdenXie/Aden.github.io/tree/source)。

## 许可说明

本站采用分项许可：

- **原创文字与原创图片：** 除另有标注外，AdenXie 的原创文字与原创图片采用 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans)，可在署名、非商业性使用和相同方式共享等条件下分享、改编。
- **代码：** 继续采用上游 Redefine 的 [GPL-3.0](LICENSE)（SPDX：`GPL-3.0-only`），对应源码位于 [`source` 分支](https://github.com/AdenXie/Aden.github.io/tree/source)。内容许可的非商业限制不适用于 GPL 代码。
- **第三方作品：** 引用文字、第三方图片与截图、字体、音乐、依赖及外部数据仍遵循原有权利与许可。

完整适用范围和例外见 [LICENSE-CONTENT.md](LICENSE-CONTENT.md)，CC 完整法律文本见 [LICENSES/CC-BY-NC-SA-4.0.txt](LICENSES/CC-BY-NC-SA-4.0.txt)。

正文、标题与导航使用小米 [MiSans](https://hyperos.mi.com/font/zh/)，品牌字保留主题自带的 Chillax；代码等宽字体与图标字体保留。MiSans 使用官方 Unicode 分包，由小米字体服务按需提供，字体文件未作裁剪、改名或修改；使用遵循 [MiSans 字体许可协议](https://hyperos.mi.com/font/zh/download/)，各页页脚均有字体来源说明。
