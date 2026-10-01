---
title: "Gemini 4 Argon：我喜欢 Gemini 的理由，这一次都写在了 Argon 里"
date: 2026-10-01 14:44:00
categories:
  - AI 与科技
tags:
  - Gemini
  - Google DeepMind
  - 大模型
  - AI Agent
cover: https://storage.googleapis.com/gweb-uniblog-publish-prod/images/g4_30-09-26_key-art_blog.width-1600.format-webp.webp
---

昨天，Google 正式公布了 **Gemini 4 Argon**。

严格来说，这还不是一次“所有人现在就能用”的常规发布。Argon 正在通过 Fairwind Program 先交到一批可信网络安全防御者手中，Google 也在参与美国政府的预发布模型访问流程；付费 API 用户和 Google AI Ultra 用户会是下一批，但 Google 没有给出明确日期。

可如果只把它理解成一次谨慎的灰度上线，又会低估这次更新。因为从 Google 公布的设计目标、内部使用案例，到已经出现的第三方测试，Argon 都在尝试回答一个比“聊天更聪明了吗”更重要的问题：

**一个前沿模型，能不能在几十分钟、几小时，甚至更长的任务里持续工作，自己发现问题、调用工具、反思、修改，并真的把事情做完？**

这恰好也是我一直喜欢 Gemini 的地方。相比只追求对话里的惊艳感，我更喜欢 Google 把多模态、长上下文、工具调用和真实工作流揉成一个完整系统的方向。Argon 可能还不是每一项测试里的第一名，但它是目前最像这种思路最终形态的一代 Gemini。

<!-- more -->

## 先看最夸张的变化：100 万 token 的输出上限

Gemini 4 Argon 最容易抓住眼球的参数，是 Google 把最大**输出**从此前的 64K token 一口气提高到 **1M token**。

这里要特别强调“输出”两个字。它不是简单说模型可以读一百万 token，而是意味着一次长任务的推理、工具调用和生成轨迹，可以拥有比过去大得多的空间。Google 的解释也很直接：当模型可以在单次 trajectory 里持续思考并生成数十万 token 时，一些过去必须拆成很多轮、不断人工续接的复杂任务，理论上可以一次完成。

这对普通聊天当然没有必要，但对代码迁移、深度研究、财务尽调、长视频分析和 Agent 工作流却非常重要。

价格同样很有侵略性。Google 宣布 Argon 的首发 API 价格为 **$2 / 100 万输入 token、$10 / 100 万输出 token**，缓存输入再打 95% 折扣；首发优惠结束后会恢复到 **$4 / $20**。按照 [Artificial Analysis 的测算](https://artificialanalysis.ai/articles/gemini-4-argon-google-top-three-labs)，Argon 在当前优惠价下完成一项 Intelligence Index 任务平均约花 $1.99，大约是 GPT-6 Astra 的 60%。

但这个价格优势有一个很值得注意的细节：Argon 并不是靠“少想一点”省钱。Artificial Analysis 观察到它平均每项任务会生成约 **62K 输出 token**，而 Astra 大约是 27K。也就是说，Argon 更像是一个愿意花很长时间推理的模型，只是 Google 暂时把 token 单价压得足够低。

## 它到底有多强？答案是：很强，但不是“全榜单横扫”

Google 的官方发布页给了一张非常漂亮的对比表：

![Gemini 4 Argon 官方 benchmark 对比表](https://storage.googleapis.com/gweb-uniblog-publish-prod/original_images/gemini-4-argon_table_blog.gif)

[官方评测方法](https://deepmind.google/models/evals-methodology/gemini-4-argon)里有一个必须先说明的 caveat：Gemini 以外的模型分数大多来自各家公开或自报结果，部分 Argon 成绩则由 Google 自己运行，因此这不是所有模型在完全相同 harness 下的一次统一盲测。

即便如此，几组数据还是非常有代表性。

| 测试 | Gemini 4 Argon | 主要对手 | 我怎么看 |
| --- | ---: | ---: | --- |
| DeepSWE v1.1 | **77.9%** | Opus 5.5 74.2%，Astra 74.1% | 长周期软件工程非常强 |
| Zapier AutomationBench | **51.29%** | Sonnet 5.5 44.75%，Opus 5.5 42.47%，Astra 41.4% | 目前最亮眼的一项真实业务 Agent 测试 |
| Artificial Analysis Intelligence Index | **53** | Astra 53，Opus 5.5 58 | 综合智能进入第一梯队，但不是第一 |
| Terminal-Bench 4.0 | **约 57%** | Astra 59%，Opus 5.5 60%，Sonnet 5.5 64% | 终端式 coding agent 仍落后 |
| Vals Finance Agent v2 | **65.40%** | 当前榜单第 1 | 金融多步骤研究很突出 |
| LVBench | **91.7%** | Google 称为 SOTA | 长视频理解延续 Gemini 的传统优势 |

其中我最看重的是 [Zapier AutomationBench](https://zapier.com/benchmarks)。它不是问模型几道数学题，而是给 Agent 一间模拟公司：CRM、邮件、表格、工单、汇率、重复客户名和隐藏在旧邮件里的规则全部混在一起，最后直接检查模型有没有把现实状态改对。Argon High 的 **51.29%** 比 Claude Opus 5.5 的 42.47% 和 GPT-6 Astra 的 41.4% 高出一截。

这类测试比单轮问答更接近我想要的 AI：不是“回答得像懂了”，而是真的把事情做完。

但另一边，[Artificial Analysis](https://artificialanalysis.ai/models/gemini-4-argon) 给 Argon 的综合 Intelligence Index 是 **53**，与 GPT-6 Astra 基本持平，却仍低于 Claude Opus 5.5 的 58。Terminal-Bench 4 上，它也没有超过 Anthropic 和 OpenAI 的顶尖模型。

所以这次最准确的描述不是“Gemini 全面夺冠”，而是：**Google 终于重新拥有了一个没有明显代差、并且在长任务和 Agent 工作流上有自己优势区间的旗舰模型。**

## 我最喜欢的部分，其实不是 benchmark，而是 Google 已经拿它干了什么

Google 这次给出的内部案例，比传统跑分更有说服力。

第一是量子算法优化。Google 称 Argon 帮助量子计算团队优化限制关键应用性能的子程序时空资源，也就是 **qubits × gates**，其中一个案例在几分钟内把性能提高了 **40%**，超过已发表的基准。

第二是数据中心内存。一个 Argon Agent 团队分析了整个 Google 集群的 profiling telemetry，自动寻找并应用内存优化。Google 预计这些改动完全推开后可以先释放 **300 TiB 以上内存**，总节省量可能达到 **500 TiB 到 1 PiB**。

第三，也是我觉得最有“Google 味”的一项，是大规模 C/C++ → Rust 迁移。

Argon Agent 正在参与从 re2、libgav1 这类数万行代码库，到 **Fuchsia Zircon 内核 80 万行以上代码**的迁移。当然，这些关键系统不会让模型写完就直接上线，Google 明确说仍会经过自动化和人工审计、仿真测试和 review。

其中 libgav1 的案例尤其漂亮：Argon 基于已有 Rust 移植版，进行了多轮 profile-guided 实验、分析编译器输出，再把 **3.2 万行 SIMD 代码**替换成更安全、能够让编译器自动向量化的 Rust。最终版本的视频输出完全一致，性能比原 Rust 移植版快 **2.7 倍**，进一步逼近高度优化的 C++ 版本。

这些例子都来自 [Google 官方发布](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-4-argon/)，目前还不能当作完全独立验证。但它们至少说明了一件事：Google 不是把 Argon 当成一个更会聊天的网页模型，而是真的在拿它碰自己的基础设施、编译器、内核和研究工作。

这也是为什么我会天然更喜欢 Gemini 这条路线。

## 还有一个很有意思的变化：Argon 似乎更愿意承认“我不知道”

Artificial Analysis 的 AA-Omniscience 测试里，Argon 的 hallucination rate 只有 **15%**，是 Intelligence Index 得分 45 以上模型里最低的一档；GPT-6 Astra 是 51%，GPT-6.1 Sol 是 54%。

但这不等于 Google “解决了幻觉”。

同一测试里，Argon 的准确率是 **50%**，反而低于 Astra 的 63%。更准确的解释是：Argon 在不知道时更倾向于停止猜测，而不是硬编一个答案。

我其实非常喜欢这种取舍。对于真正要拿去做研究、金融、法律或者工程工作的模型来说，“我不确定”常常比一个流畅但错误的答案更有价值。

Reddit 上发布后的讨论也很有代表性。一边是大量“Gemini is back”的兴奋；另一边最常见的抱怨恰恰不是性能，而是：**这么好的模型，为什么现在大多数人还用不到？** [r/GeminiAI 的发布讨论](https://www.reddit.com/r/GeminiAI/comments/1wufgo3/gemini_4_argon_our_next_era_of_frontier/)和 [r/singularity 的讨论](https://www.reddit.com/r/singularity/comments/1wufeu8/introducing_gemini_4_argon/)里，都能看到这种“跑分很香，但先让我用上”的矛盾情绪。

这其实也是 Argon 目前最大的现实问题。

## 它离“最强模型”还差在哪里？

第一，**你现在基本用不到它。**

Argon 首先给 Fairwind 的可信网络安全合作方，普通开发者、企业和消费者还在等待。对于一个旗舰模型来说，不能被广泛真实使用，就意味着我们仍然缺少大量来自代码库、生产环境和日常长对话的外部样本。Google 给出的“rolling out soon”很好听，但在真正开放 API 之前，它依然带着一点发布会产品的味道。

第二，**编程并非每一个维度都领先。**

Google 自己的对比里，Argon 在 DeepSWE 很漂亮，但在 FrontierSWE v2、Terminal-Bench 4.0、PostTrainBench、Terminal-Bench Science 和 OSWorld-2.0 等测试上仍输给 Astra 或 Opus。尤其 Terminal-Bench 这种强工具、强执行的 coding agent 场景，是 Anthropic 目前仍然非常稳的优势区。

第三，**“更长的思考”同时也是成本和延迟。**

Argon 在 Artificial Analysis 的综合测试里会吐出明显更多 token。首发优惠价让这件事现在看起来很划算，但标准价格恢复到 $4/$20 以后，优势会缩小。真正的企业成本不是“每百万 token 多少钱”，而是**解决一个任务到底要多少钱、多久，以及失败后要不要重跑**。

第四，**它不是综合智能榜的绝对第一。**

Artificial Analysis 的 53 分足以让 Google 回到最前沿，但 Opus 5.5 目前仍是 58。换句话说，如果你只想问“谁在一张综合智能榜上最高”，答案并不是 Argon；如果你问“谁在复杂业务自动化、长轨迹任务和 Google 擅长的多模态场景里最值得关注”，Argon 就会变得非常有竞争力。

## Gemini 回来了，但我更愿意说：Gemini 终于长成了自己想成为的样子

我对 Gemini 的偏爱一直不完全来自排行榜。

从原生多模态、超长上下文，到 Google Search、Workspace、Android、Cloud，再到现在越来越完整的 Agent 工具链，Gemini 最吸引我的地方始终是：Google 很少只把模型当成一个聊天框，它想做的是一个能够看到、理解、检索、执行，并长期参与真实工作的通用助手。

Argon 把这种路线推到了目前最激进的位置。

它有 100 万 token 的最大输出，有非常强的长周期软件工程和企业自动化成绩，也已经被 Google 自己拿去优化量子算法、数据中心内存和几十万行级别的系统代码；与此同时，它仍会在 Terminal-Bench、FrontierSWE 这类硬核执行测试里输给竞争对手，第三方综合榜也没有把它放在绝对第一。

我反而觉得这让它更可信。

如果一款模型刚发布时每张图都是第一，那我会先怀疑图是怎么选的。Argon 现在呈现出来的样子更像一个真正有“能力形状”的模型：它有特别强的地方，也有清晰的短板。

而对我来说，最令人期待的不是 Google 又拿回了多少个 SOTA，而是它终于再次拿出了一款让我愿意等着亲手使用的 Gemini 旗舰。

等 Argon 真正开放 API 和 Ultra 之后，我最想做的第一件事，不是再跑一遍 benchmark，而是给它一个足够长、足够脏、需要反复试错的真实项目，然后看看它到底能不能从头走到尾。

那才是这代模型真正的考试。

---

**主要参考与延伸阅读：**

- [Google：Gemini 4 Argon 官方发布](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-4-argon/)
- [Google DeepMind：Argon 评测方法与结果说明](https://deepmind.google/models/evals-methodology/gemini-4-argon)
- [Artificial Analysis：Gemini 4 Argon 独立测试](https://artificialanalysis.ai/articles/gemini-4-argon-google-top-three-labs)
- [Artificial Analysis：Argon 模型页](https://artificialanalysis.ai/models/gemini-4-argon)
- [Zapier AutomationBench](https://zapier.com/benchmarks)
- [Vals AI：Gemini 4 Argon](https://www.vals.ai/models/google_gemini-4-argon)
- [Google 官方 X 发布帖](https://x.com/Google/status/2105388143902175529)
- [Reuters：Gemini 4 Argon 发布与有限开放](https://www.reuters.com/legal/litigation/google-announces-gemini-4-flagship-ai-model-after-months-delays-2026-09-30/)

封面图：Google 官方 Gemini 4 Argon key art，来自 [@Google 的 X 发布帖](https://x.com/Google/status/2105388143902175529)，图片由 Google 官方 CDN 托管。
