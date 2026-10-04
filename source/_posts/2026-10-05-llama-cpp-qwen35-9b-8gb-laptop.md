---
title: "只需要 8G 显存，你就可以在笔记本部署一个 30 tk/s 速度的多模态 AI"
date: 2026-10-05 12:00:00
categories:
  - AI 与科技
tags:
  - 本地大模型
  - llama.cpp
  - Qwen
  - 多模态
  - 教程
cover: https://qianwen-res.oss-accelerate.aliyuncs.com/logo_qwen3.5.png
---

我的笔记本是一台很普通的游戏本：Ryzen 7 8845H、16GB 内存、RTX 4060 Laptop，显存只有 8GB。按很多人的印象，这个配置跑本地大模型只能“玩玩”。

但我现在每天双击一个启动文件，浏览器就会打开一个聊天页面：能看图、能看视频、能切换思考深度、能调用本机工具，文字生成速度实测约 **31 tokens/s**，全程不联网，也不花一分钱 API 费用。跑在里面的是 **Qwen3.5-9B**，推理框架是 **llama.cpp**。

这篇文章分三部分：我是怎么选框架和模型的；一份面向新手、每一条命令都写出来的安装教程；以及我踩过的坑和对应的解决办法。

<!-- more -->

## 先说结论：最终跑起来的是什么

| 项目 | 我的配置 |
| --- | --- |
| 操作系统 | Windows x64 |
| CPU | AMD Ryzen 7 8845H |
| 显卡 | NVIDIA GeForce RTX 4060 Laptop，8GB 显存 |
| 内存 | 16GB |
| 推理程序 | llama.cpp b10909，Windows CUDA 12.4 预编译包 |
| 模型 | Qwen3.5-9B，Q4_K_M 量化（约 5.75 GiB） |
| 多模态组件 | 配套的 BF16 mmproj（约 0.86 GiB） |
| 上下文长度 | 4096 tokens |
| 访问方式 | 浏览器打开 `http://127.0.0.1:8080`，或 OpenAI 兼容接口 |

实测数据（都是我这台机器当时的记录，不是实验室基准）：

| 配置 | 生成速度 | 整块显卡的显存占用 |
| --- | --- | --- |
| Qwen3.5-9B，纯文字，8K 上下文 | 约 31.3 tokens/s | 6429 MiB / 8188 MiB |
| Qwen3.5-9B，加载多模态组件，4K 上下文 | 短回复时网页显示约 34.6 tokens/s | 7364 MiB / 8188 MiB |
| 对照：Gemma 4 E4B，多模态，8K 上下文 | 约 51–54 tokens/s | 5209 MiB / 8188 MiB |

两点说明。第一，标题里的“30 tk/s”来自纯文字模式的那次测试；多模态模式下那个 34.6 只生成了 5 个词元，太短，只能说明“速度在同一量级”，不能当正式成绩。第二，`nvidia-smi` 显示的是整块显卡的占用，包含桌面和浏览器，不等于模型独占的显存。

## 为什么是 llama.cpp

本地跑大模型的工具很多，我最后用的是 [llama.cpp](https://github.com/ggml-org/llama.cpp)，看中的是这几点：

- **不用编译，也不用装 Python 环境。** 官方发布页直接提供 Windows + CUDA 的预编译压缩包，解压就能用。我全程没有装 CUDA Toolkit，也没有编译任何 C++ 代码。
- **一个程序把事情做完。** `llama-server.exe` 启动后，同时提供网页聊天界面和 OpenAI 兼容的 API，别的客户端可以直接接进来。
- **用的是 GGUF 量化模型。** 9B 的模型量化到 Q4_K_M 之后不到 6 GiB，8GB 显存放得下。
- **参数全部摆在明面上。** 上下文多长、多少层放进显卡、缓存用什么精度，都是命令行参数，显存不够时知道该调哪个。

代价是它不像一些图形化工具那样“点一下就好”，需要敲几条命令。这也是我写这篇教程的原因。

## 为什么最后选了 Qwen3.5-9B

我不是一开始就选对的，中间换过三次：

1. **最先下的是 Qwen3-8B。** 下到一半我改了主意，中断了下载，它从头到尾没有跑起来过。
2. **第一个真正跑起来的是 Google 的 Gemma 4 E4B**（官方 QAT Q4_0 量化版）。它很快，在我的机器上有 51–54 tokens/s，显存只占 5.2GB 左右，带多模态还能开 8K 上下文。
3. **最后换成了 Qwen3.5-9B。** 速度掉到 31 tokens/s 左右，显存也更紧张，但我想要的是综合能力更强的那个。

换之前我把几个 8GB 显存能考虑的模型放在一起比过：Qwen3.5-4B、Gemma 4 E4B、Qwen3.5-9B、Gemma 4 12B、gpt-oss-20b。需要坦白的是，那张对比图里只有 Gemma 4 E4B 的速度是我实测的，其他模型的速度是按硬件估算的，能力分也是拼合各家公开基准得到的参考值，测试条件并不统一。它帮我做了取舍，但不是一份严谨的排行榜。

真正让我下决心的是 Qwen 官方模型卡里的数据。下面这张图来自 [Qwen3.5-9B 的官方模型卡](https://huggingface.co/Qwen/Qwen3.5-9B)，是 Qwen3.5 小尺寸模型与其他模型的得分对比：

![Qwen 官方模型卡中的基准对比图：Qwen3.5 小尺寸模型与其他模型的得分](https://qianwen-res.oss-accelerate-overseas.aliyuncs.com/Qwen3.5/Figures/qwen3.5_small_size_score.png)

*图片来源：Qwen 官方模型卡。*

模型卡里还有完整的分数表，我摘几行有代表性的。先看纯语言能力，对比对象是参数量大得多的模型：

| 测试 | GPT-OSS-120B | GPT-OSS-20B | Qwen3-30B-A3B（思考） | **Qwen3.5-9B** | Qwen3.5-4B |
| --- | ---: | ---: | ---: | ---: | ---: |
| MMLU-Pro（知识） | 80.8 | 74.8 | 80.9 | **82.5** | 79.1 |
| C-Eval（中文知识） | 76.2 | 71.4 | 87.4 | **88.2** | 85.1 |
| GPQA Diamond（科学推理） | 80.1 | 71.5 | 73.4 | **81.7** | 76.2 |
| IFEval（指令遵循） | 88.9 | 88.2 | 88.9 | **91.5** | 89.8 |
| LongBench v2（长文本） | 48.2 | 45.6 | 44.8 | **55.2** | 50.0 |
| LiveCodeBench v6（编程） | 82.7 | 74.6 | 66.0 | 65.6 | 55.8 |

再看视觉理解，对比对象是两个云端的轻量模型和上一代 30B 的视觉模型：

| 测试 | GPT-5-Nano | Gemini-2.5-Flash-Lite | Qwen3-VL-30B-A3B | **Qwen3.5-9B** | Qwen3.5-4B |
| --- | ---: | ---: | ---: | ---: | ---: |
| MMMU（多学科图文） | 75.8 | 73.4 | 76.0 | **78.4** | 77.6 |
| MathVision（看图做数学） | 62.2 | 52.1 | 65.7 | **78.9** | 74.6 |
| OCRBench（文字识别） | 75.3 | 82.5 | 83.9 | **89.2** | 85.0 |
| RealWorldQA（真实场景问答） | 71.8 | 72.2 | 77.4 | **80.3** | 79.5 |
| VideoMME（带字幕视频） | 71.7 | 74.6 | 79.9 | **84.5** | 83.5 |

读这些数字要注意三件事：

- 这是 **Qwen 官方公布的成绩**，测的是完整精度的模型。我本地跑的是 Q4_K_M 量化版，上下文也只开了 4096，实际表现会打折扣，我没有在自己机器上复测这些基准。
- 它不是全面领先。编程类测试（LiveCodeBench、OJBench）里，9B 明显不如 GPT-OSS-120B，这在表里看得很清楚。
- 对我来说关键的是另外两点：一个 9B 的模型在知识、指令遵循和长文本上能追平甚至超过上一代 30B 的模型；而且它原生支持看图和看视频，不用另外找一个视觉模型。

一句话总结我的取舍：**Gemma 4 E4B 更快更省显存，Qwen3.5-9B 更全面。** 如果你更在意速度，或者显存只有 6GB，前者是很好的选择；本文后面的步骤换个模型文件同样适用。

## 开始之前：你需要准备什么

- 一台 **Windows 64 位** 电脑，带 **NVIDIA 显卡，显存 8GB 左右**，并且已经装好显卡驱动。
- 大约 **8GB 的空闲硬盘空间**（程序约 0.6GB，模型约 6.6GB）。
- 能访问 GitHub 和 Hugging Face 的网络。模型文件有 6GB 多，网速慢的话要有耐心。

本文所有命令都在 **PowerShell** 里运行。打开方式：按 `Win` 键，输入 `powershell`，回车。把命令整段复制进去再按回车即可。命令里行尾的反引号 `` ` `` 表示“这一行还没完”，整段一起粘贴就不会出错。

所有文件都会放在“文档”文件夹下的 `llama.cpp` 目录里，命令会自动找到你自己的“文档”路径，不需要手动改用户名。

## 第一步：确认硬件

先看看显卡和显存是不是符合要求：

```powershell
nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader
```

正常会输出一行类似 `NVIDIA GeForce RTX 4060 Laptop GPU, 8188 MiB, ...` 的内容。再看一下 CPU 和内存：

```powershell
Get-CimInstance Win32_Processor |
    Select-Object Name, NumberOfCores, NumberOfLogicalProcessors

Get-CimInstance Win32_ComputerSystem |
    Select-Object @{Name='RAM_GiB';Expression={
        [math]::Round($_.TotalPhysicalMemory / 1GB, 1)
    }}
```

**可能遇到的问题**

- **提示找不到 `nvidia-smi`**：说明没装 NVIDIA 驱动，或者这台电脑没有 NVIDIA 显卡。先去 NVIDIA 官网装驱动。
- **显存要以 `nvidia-smi` 为准**。Windows 自带的 `Win32_VideoController.AdapterRAM` 在一些机器上不能正确显示大显存。另外，同样叫 RTX 4060，笔记本版和桌面版、8GB 版和其他版本并不一样，别只看型号名。

## 第二步：下载并解压 llama.cpp

我固定使用 **b10909** 这个版本，而不是“最新版”。原因很简单：教程里的每一步我都是在这个版本上验证的，过几个月“最新版”可能已经是另一个样子。

需要下载**两个**压缩包，缺一不可：一个是 llama.cpp 程序本身，一个是它依赖的 CUDA 运行库。下面这段命令会建好目录、下载、解压：

```powershell
$ErrorActionPreference = 'Stop'
$llamaRoot = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'llama.cpp'
$downloadDir = Join-Path $llamaRoot 'downloads'
$modelDir = Join-Path $llamaRoot 'models'
$binDir = Join-Path $llamaRoot 'bin'

New-Item -ItemType Directory -Force -Path $downloadDir, $modelDir, $binDir | Out-Null

curl.exe -L --fail --retry 3 --progress-bar `
    -o (Join-Path $downloadDir 'llama-b10909-bin-win-cuda-12.4-x64.zip') `
    'https://github.com/ggml-org/llama.cpp/releases/download/b10909/llama-b10909-bin-win-cuda-12.4-x64.zip'
if ($LASTEXITCODE -ne 0) { throw 'llama.cpp 下载失败' }

curl.exe -L --fail --retry 3 --progress-bar `
    -o (Join-Path $downloadDir 'cudart-llama-bin-win-cuda-12.4-x64.zip') `
    'https://github.com/ggml-org/llama.cpp/releases/download/b10909/cudart-llama-bin-win-cuda-12.4-x64.zip'
if ($LASTEXITCODE -ne 0) { throw 'CUDA 运行库下载失败' }

Expand-Archive -LiteralPath (Join-Path $downloadDir 'llama-b10909-bin-win-cuda-12.4-x64.zip') `
    -DestinationPath $binDir -Force
Expand-Archive -LiteralPath (Join-Path $downloadDir 'cudart-llama-bin-win-cuda-12.4-x64.zip') `
    -DestinationPath $binDir -Force
```

两个压缩包分别约 254MB 和 391MB。解压完，确认程序能认到显卡：

```powershell
Set-Location $binDir
.\llama-cli.exe --list-devices
.\llama-server.exe --version
```

第一条应该列出你的 NVIDIA 显卡，第二条应该输出包含 `build 10909` 的版本号。

**可能遇到的问题**

- **一定要写 `curl.exe`，不要只写 `curl`**。在旧版 Windows PowerShell 里，`curl` 是另一个命令的别名，参数完全不同，会直接报错。
- **只下了一个压缩包**：程序会因为缺少 CUDA 的 DLL 而无法使用显卡。两个包都要解压到同一个 `bin` 目录。
- **关掉 PowerShell 后变量会丢失**。如果你中途关了窗口，重新打开后要先把上面定义 `$llamaRoot`、`$downloadDir`、`$modelDir`、`$binDir` 的那几行再运行一次。
- 这里的“CUDA 12.4”只是这个预编译包自带的运行环境，**不需要**你另外安装 CUDA Toolkit。

## 第三步：下载模型

需要两个文件，都来自 [Bartowski 的 Qwen3.5-9B GGUF 仓库](https://huggingface.co/bartowski/Qwen_Qwen3.5-9B-GGUF)：

| 文件 | 作用 | 大小 |
| --- | --- | ---: |
| `Qwen_Qwen3.5-9B-Q4_K_M.gguf` | 主模型 | 约 5.75 GiB |
| `mmproj-Qwen_Qwen3.5-9B-bf16.gguf` | 多模态组件，让模型能“看”图片和视频 | 约 0.86 GiB |

```powershell
$qwenModel = Join-Path $modelDir 'Qwen_Qwen3.5-9B-Q4_K_M.gguf'
$qwenMmproj = Join-Path $modelDir 'mmproj-Qwen_Qwen3.5-9B-bf16.gguf'

curl.exe -L --fail --retry 5 --continue-at - --progress-bar `
    -o $qwenModel `
    'https://huggingface.co/bartowski/Qwen_Qwen3.5-9B-GGUF/resolve/main/Qwen_Qwen3.5-9B-Q4_K_M.gguf?download=true'
if ($LASTEXITCODE -ne 0) { throw 'Qwen 主模型下载失败' }

curl.exe -L --fail --retry 5 --continue-at - --progress-bar `
    -o $qwenMmproj `
    'https://huggingface.co/bartowski/Qwen_Qwen3.5-9B-GGUF/resolve/main/mmproj-Qwen_Qwen3.5-9B-bf16.gguf?download=true'
if ($LASTEXITCODE -ne 0) { throw 'Qwen 多模态组件下载失败' }
```

命令里的 `--continue-at -` 是断点续传：下载中途断了，把同一条命令再运行一次，会从断掉的地方接着下，不用从头再来。

### 校验文件是否完整

6GB 的文件下载出错并不罕见，而一个损坏的模型文件会导致各种莫名其妙的加载失败。所以下完之后务必校验一次：

```powershell
$expectedHashes = @{
    'Qwen_Qwen3.5-9B-Q4_K_M.gguf' = 'd784ce9eda1a5a7b51e8f705a9e6310844bf4f173654d115823c775fdea56d43'
    'mmproj-Qwen_Qwen3.5-9B-bf16.gguf' = 'd89c4bc142d02ed64aeed5c0a358bdead9109f21f4ada03a6b2df17a1aa94d9e'
}

foreach ($modelName in $expectedHashes.Keys) {
    $modelPath = Join-Path $modelDir $modelName
    $actualHash = (Get-FileHash -LiteralPath $modelPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $expectedHashes[$modelName]) {
        throw "模型哈希不匹配：$modelName"
    }
    [pscustomobject]@{ File=$modelName; Verified=$true; SHA256=$actualHash }
}
```

两个文件都显示 `Verified = True` 就没问题。这两个哈希值是我下载时校验通过的值。

**可能遇到的问题**

- **提示“模型哈希不匹配”**：有两种可能。一是文件没下完或者下坏了，重新运行下载命令续传，再校验。二是仓库作者后来更新了文件（下载地址里的 `main` 指向的是仓库的最新状态），这种情况下去仓库页面核对文件的 SHA-256 即可。
- **下载一半不想要了**：直接按 `Ctrl+C` 中断。留下的半截文件扩展名虽然是 `.gguf`，但并不能用，别拿它去加载，删掉或者改个名字（我当时改成了 `.partial`）以免以后搞混。
- **文件大小对不上**：PowerShell 里的 `1GB` 实际是 1024³ 字节，所以它算出来的是 GiB。网页上写的 GB 和它会差一点，属于正常现象。

## 第四步：第一次启动

先在命令行里直接启动，确认一切正常，再去做双击启动的文件。

```powershell
Set-Location $binDir
.\llama-server.exe -m $qwenModel --mmproj $qwenMmproj `
    -ngl 99 -c 4096 -np 1 `
    --cache-type-k q8_0 --cache-type-v q8_0 `
    --image-min-tokens 1024 `
    --reasoning off `
    --host 127.0.0.1 --port 8080
```

窗口里会滚动很多加载信息。等它安静下来、出现服务器开始监听的提示后，用浏览器打开：

```text
http://127.0.0.1:8080
```

你会看到一个聊天页面。随便问一句话，再试着拖一张图片进去让它描述。停止模型的方法是回到 PowerShell 窗口按 `Ctrl+C`。

这些参数分别是什么意思：

| 参数 | 含义 |
| --- | --- |
| `-m` | 主模型文件的路径 |
| `--mmproj` | 多模态组件的路径。必须用和主模型配套的那个，不能混用别的模型的 |
| `-ngl 99` | 尽可能把模型的所有层都放进显卡。不是说模型有 99 层 |
| `-c 4096` | 上下文长度，也就是一次对话里模型能“记住”的总量。这是运行时的设置，不是模型的上限 |
| `-np 1` | 同一时间只处理一个请求，省资源 |
| `--cache-type-k/v q8_0` | 让对话缓存用更省显存的精度。它和模型本身的量化是两回事 |
| `--image-min-tokens 1024` | 处理图片时使用的最少词元数 |
| `--reasoning off` | 默认关闭“思考”。后面会讲怎么改成可以在网页上切换 |
| `--host 127.0.0.1` | 只允许本机访问，不向局域网或互联网开放 |
| `--port 8080` | 网页和接口使用的端口 |

**可能遇到的问题**

- **显存不够、加载失败或者特别卡**：8GB 显存加载多模态组件后只剩不到 1GB 余量（我这里整块显卡占到 7364 MiB）。先关掉占显存的程序，比如游戏、其他 AI 软件、开了很多标签页的浏览器。还不行的话，把 `-c 4096` 改小，或者去掉 `--mmproj $qwenMmproj` 这一段只跑文字。
- **只想聊文字、想要更长的上下文**：去掉 `--mmproj` 那一段，把 `-c` 改成 `8192`。我测到的 31.3 tokens/s 就是这个配置，显存占用 6429 MiB。文字和多模态用的是同一个模型，区别只在于加不加载视觉组件。
- **网页打不开**：模型加载需要一点时间，等窗口里的加载信息停下来再刷新。也可以在另一个 PowerShell 窗口里运行 `Invoke-RestMethod 'http://127.0.0.1:8080/health'` 看服务是否就绪。
- **提示端口被占用**：说明 8080 已经有程序在用，很可能是你之前启动的那一份还没关。把 `--port 8080` 换成别的数字，比如 `8089`，网址也相应改掉。
- **不要同时开两份**：两个模型服务即使用不同端口，抢的也是同一块显卡的显存，8GB 根本不够分。
- **“多模态”指的是图片和视频**。我这个配置下界面里的音频选项是不可用的。

## 第五步：做一个双击就能启动的文件

每次都敲那么长的命令太麻烦，做一个启动文件，以后双击就行。

下面这段 PowerShell 命令会在 `llama.cpp` 目录下生成 `start-qwen.cmd`。它是我自己日常用的启动器去掉“自定义网页”和“Agent”两项之后的简化版，那两项放在后面的进阶部分讲。

```powershell
$launcherPath = Join-Path $llamaRoot 'start-qwen.cmd'
$launcherText = @'
@echo off
setlocal
title Qwen3.5 9B Multimodal - llama.cpp

set "ROOT=%~dp0"
set "BIN=%ROOT%bin"
set "MODEL=%ROOT%models\Qwen_Qwen3.5-9B-Q4_K_M.gguf"
set "MMPROJ=%ROOT%models\mmproj-Qwen_Qwen3.5-9B-bf16.gguf"

if not exist "%BIN%\llama-server.exe" goto missing_files
if not exist "%MODEL%" goto missing_files
if not exist "%MMPROJ%" goto missing_files

cd /d "%BIN%"
echo Starting Qwen3.5 9B multimodal chat with NVIDIA GPU acceleration...
echo The chat page will open at http://127.0.0.1:8080
echo Close this window or press Ctrl+C to stop the model.
echo.

start "" powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 6; Start-Process 'http://127.0.0.1:8080'"
"%BIN%\llama-server.exe" -m "%MODEL%" --mmproj "%MMPROJ%" -ngl 99 -c 4096 -np 1 --cache-type-k q8_0 --cache-type-v q8_0 --image-min-tokens 1024 --reasoning off --host 127.0.0.1 --port 8080

echo.
echo Qwen3.5 has stopped. Press any key to close this window.
pause >nul
exit /b

:missing_files
echo ERROR: One or more llama.cpp or model files are missing.
echo Installation folder: %ROOT%
echo.
pause
exit /b 1
'@

$launcherText = $launcherText -replace "`r?`n", "`r`n"
[IO.File]::WriteAllText($launcherPath, $launcherText, [Text.Encoding]::ASCII)
```

之后在“文档\llama.cpp”文件夹里双击 `start-qwen.cmd`，会弹出一个黑色窗口加载模型，6 秒后自动打开浏览器。关掉那个黑色窗口，模型就停了。

这个文件做了几件事：先检查程序和模型文件在不在，缺了就停下来告诉你；用 `cd /d` 切换目录，这样放在别的盘符也能用；启动命令写成一整行；最后用 `pause` 保证出错时窗口不会一闪而过。

**可能遇到的问题：双击后窗口一闪就没了，或者“没有反应”**

这是我踩得最久的一个坑。我的第一版启动文件双击后什么都没发生。不要靠猜，先把报错抓出来：

```powershell
cmd.exe /d /c "call `"$launcherPath`""
```

我当时看到的是这样的输出：

```text
'NVIDIA' is not recognized as an internal or external command
'-NoProfile' is not recognized as an internal or external command
The system cannot find the path specified.
```

也就是说，CMD 把本来属于同一条命令的片段拆开，当成了一条条独立的命令去执行。这和模型、显卡驱动都没有关系，问题出在批处理文件的文本本身：编码、换行符和用 `^` 续行的写法。我没有逐项做对照实验，所以不敢断言是哪一个字符导致的，但下面这套做法之后就再没出过问题：

1. **文件内容只用英文（ASCII）。** 中文说明另外写在别的文档里。文件名可以是中文，但文件里面不要写中文。
2. **换行符用 Windows 的 CRLF。**
3. **启动命令写成一整行**，不用 `^` 换行。
4. **保留 `pause`**，这样出错时能看到报错。

上面生成启动文件的那段命令，最后两行做的正是第 1、2 条。如果你是用记事本手动编辑的，改完后可以用下面的命令检查并修正：

```powershell
$launcherText = [IO.File]::ReadAllText($launcherPath)
if ($launcherText -match '[^\x00-\x7F]') {
    throw '启动器里还有非英文字符，请先删掉'
}
$launcherText = $launcherText -replace "`r?`n", "`r`n"
[IO.File]::WriteAllText($launcherPath, $launcherText, [Text.Encoding]::ASCII)
```

还有一个小细节：自动打开浏览器用的是固定 6 秒延时，并不是真的检测到模型加载完成。如果网页先打开而模型还没准备好，等几秒刷新一下就行。

到这里，一个能看图的本地 AI 已经可以日常使用了。后面的内容都是可选的。

## 第六步：看看它到底有多快

想知道自己机器上的真实速度，可以让服务器自己报数。模型运行着的时候，另开一个 PowerShell 窗口：

```powershell
$body = @{
    model = 'qwen3.5-9b'
    messages = @(@{ role='user'; content='请用中文列出五条提高专注力的建议，每条一句话，直接回答。' })
    temperature = 0.7
    top_p = 0.8
    max_tokens = 256
    stream = $false
    chat_template_kwargs = @{ enable_thinking=$false }
} | ConvertTo-Json -Depth 8

$resp = Invoke-RestMethod -Uri 'http://127.0.0.1:8080/v1/chat/completions' `
    -Method Post -ContentType 'application/json; charset=utf-8' `
    -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 120

[pscustomobject]@{
    Reply = $resp.choices[0].message.content
    CompletionTokens = $resp.usage.completion_tokens
    SpeedTokensPerSec = [math]::Round($resp.timings.predicted_per_second, 1)
} | Format-List

nvidia-smi --query-gpu=memory.used,memory.total,utilization.gpu --format=csv,noheader
```

`SpeedTokensPerSec` 就是生成速度。

**读数时的注意事项**

- **回答太短的测试不算数。** 只生成几个词元时速度波动很大，至少让它生成一两百个词元。
- **别把“提示词处理速度”当成生成速度。** 网页上有时会显示上千词元/秒的数字，那是模型读入你的问题的速度，不是它写回答的速度。
- **速度会受很多因素影响**：笔记本是否插电、电源模式、温度、上下文长度、是否开启思考。两次测出来不一样很正常。

## 进阶一：让网页可以切换“思考模式”

Qwen3.5 支持“思考”：回答前先推理一段，适合数学、代码这类问题，但日常聊天会显得慢。前面的启动命令用 `--reasoning off` 把它默认关掉了。更理想的是在网页里随时切换。

问题是，b10909 这个版本的网页在**桌面端只加载一个模型时**，“+”菜单里漏掉了 Reasoning（思考）子菜单。要分清三件事：模型支不支持切换思考、服务器默认开还是关、网页有没有给你开关。前两项都没问题，缺的只是网页上的菜单。这个结论只针对 b10909，不代表之后的版本也有同样的问题；修复方式参考了上游的 [PR #27985](https://github.com/ggml-org/llama.cpp/pull/27985)。

先确认接口本身确实能按请求关闭思考（模型运行时，在另一个窗口执行）：

```powershell
$chatBody = @{
    model = 'Qwen_Qwen3.5'
    messages = @(@{ role='user'; content='Reply with OK only.' })
    stream = $false
    max_tokens = 16
    reasoning_format = 'auto'
    chat_template_kwargs = @{ enable_thinking=$false }
} | ConvertTo-Json -Depth 8

$chatReply = Invoke-RestMethod `
    -Method Post -Uri 'http://127.0.0.1:8080/v1/chat/completions' `
    -ContentType 'application/json; charset=utf-8' `
    -Body ([Text.Encoding]::UTF8.GetBytes($chatBody)) -TimeoutSec 60

[pscustomobject]@{
    Content = $chatReply.choices[0].message.content
    Reasoning = $chatReply.choices[0].message.reasoning_content
    Finish = $chatReply.choices[0].finish_reason
}
```

我这里得到的是 `Content = OK`，`Reasoning` 为空。说明只要网页把选择传给服务器就行。

接下来要自己构建一份网页。这一步需要先安装 [Git](https://git-scm.com/) 和 [Node.js](https://nodejs.org/)（我用的是 Node v22.15.0、npm 10.9.2）。只构建网页前端，不需要编译 C++。

**1. 下载对应版本的源码**

```powershell
$sourceRoot = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'llama-source-b10909'
if (Test-Path -LiteralPath $sourceRoot) { throw '源码目录已存在，请换一个目录' }
git clone --depth 1 --branch b10909 https://github.com/ggml-org/llama.cpp.git $sourceRoot
```

**2. 改一个文件**

用任意文本编辑器打开：

```text
tools/ui/src/lib/components/app/chat/ChatForm/ChatFormActions/ChatFormActionAdd/ChatFormActionAddDropdown.svelte
```

把导入语句改成同时引入思考子菜单组件：

```diff
- import { ChatFormActionAddToolsSubmenu, McpLogo } from '$lib/components/app';
+ import {
+   ChatFormActionAddReasoningSubmenu,
+   ChatFormActionAddToolsSubmenu,
+   McpLogo
+ } from '$lib/components/app';
```

然后在桌面端的附加菜单里把它渲染出来，并加一条分隔线：

```svelte
<ChatFormActionAddReasoningSubmenu />
<DropdownMenu.Separator />
```

这个组件源码里本来就有，只是这个菜单没有用上它，所以这只是把现成的东西接回去，不是自己发明一套新机制。

**3. 安装依赖、检查、构建**

```powershell
Set-Location (Join-Path $sourceRoot 'tools\ui')
npm ci
npm run check
npm run build
```

`npm run check` 的结果应该是 0 个错误、0 个警告。构建时可能出现“文件体积超过警告阈值”的提示，那只是提醒，不是错误。

**4. 把构建结果放到安装目录**

```powershell
$uiDist = Join-Path $sourceRoot 'tools\ui\dist'
$webuiDir = Join-Path $llamaRoot 'webui'
New-Item -ItemType Directory -Force -Path $webuiDir | Out-Null
Get-ChildItem -LiteralPath $uiDist -Force |
    Copy-Item -Destination $webuiDir -Recurse -Force
```

**5. 修改启动命令**

把启动命令里的 `--reasoning off` 换成：

```text
--reasoning auto --path "%WEBUI%"
```

并在启动文件前面的变量部分加一行 `set "WEBUI=%ROOT%webui"`。如果是在 PowerShell 里直接启动，就写成 `--reasoning auto --path (Join-Path $llamaRoot 'webui')`。

重启后，点输入框左下角的“+”，就能看到 Reasoning 菜单，可以在关闭、低、中、高、最大之间切换。

**可能遇到的问题**

- **`--path` 一定要加。** 不加的话，程序打开的还是它内置的那份没有菜单的网页，你会以为修改没生效。
- **改完网页没变化**：这个网页会被浏览器缓存。按 `Ctrl+F5` 强制刷新；如果页面提示“有可用更新”，点“刷新”。
- **复制文件时用了 `Copy-Item -LiteralPath (Join-Path $uiDist '*')` 结果什么都没复制**：`-LiteralPath` 的意思就是“按字面理解路径”，不会展开 `*`。要像上面那样先用 `Get-ChildItem` 列出来再复制。
- **思考等级不是越高越好。** 低、中、高对应的思考预算是 512、2048、8192 个词元。但我的总上下文只有 4096，“高”档的 8192 根本放不下。普通聊天选“关闭”，数学、代码或复杂推理选“中”就够了。

## 进阶二：开启 Agent 工具

llama.cpp 的这个版本可以让模型调用本机工具。做法是在**原来完整的启动命令里**加上 `--agent`，不是另外启动一个只带 `--agent` 的进程：

```diff
- --reasoning auto --path "%WEBUI%" --host 127.0.0.1 --port 8080
+ --reasoning auto --agent --path "%WEBUI%" --host 127.0.0.1 --port 8080
```

不同版本的参数可能不一样，先看看自己这个版本的帮助里有没有它：

```powershell
& (Join-Path $binDir 'llama-server.exe') --help 2>&1 |
    Select-String -Pattern '^--agent|\s--agent|--tools' -Context 0,3
```

启动后可以查一下工具是否就绪：

```powershell
$serverProps = Invoke-RestMethod 'http://127.0.0.1:8080/props'
$serverTools = Invoke-RestMethod 'http://127.0.0.1:8080/tools'
[pscustomobject]@{
    Vision = $serverProps.modalities.vision
    ToolCount = @($serverTools).Count
    Tools = (@($serverTools) | ForEach-Object { $_.name }) -join ', '
}
```

我这里服务端有 7 个工具：读取文件、搜索文件、搜索文件内容、执行命令、写入文件、编辑文件、查看运行环境信息。网页里还会多出 2 个浏览器端的工具，所以界面上显示的总数是 9，和接口返回的 7 并不矛盾。

**这里必须说安全问题。** 开了 Agent，模型就能读写你电脑上的文件、执行命令，它不再只是一个聊天窗口。所以：

- 保持 `--host 127.0.0.1`，**不要**改成 `0.0.0.0`，不要把它暴露到局域网或公网。
- 只监听本机也不代表绝对安全。让模型处理来路不明的网页或文档时，里面可能藏着诱导它执行操作的文字。
- 不需要工具的时候，就别加 `--agent`。

我只验证了工具能正常加载、菜单能显示，并没有为了测试让模型去执行写文件或危险命令。

## 进阶三：把网页界面改成中文

b10909 的网页界面是英文的，而且很多文字是直接写死在源码里的，没有现成的“语言”选项可以切换。我的做法是在源码层面翻译，再重新构建，流程和上面修复思考菜单一样。

具体来说，我写了一个脚本，用 Svelte 编译器和 TypeScript 的语法分析读取源码，按一份中英对照字典替换界面上的文字，然后人工补上脚本处理不了的动态文字（比如“最多 2,048 词元”这种拼出来的句子）。翻译范围包括聊天页、侧边栏、设置页、思考菜单、工具菜单、生成进度和统计信息。

字典有几百条，这里不贴了，只说几条对想自己动手的人有用的经验：

- **只翻译界面文字，不要动程序内部用的字符串。** 像思考等级的 `off`、`medium`，工具的函数名，接口参数名，这些是程序之间约定好的，翻译了就会出错。我中途就误把一个内部用的前缀字符串翻译了，检查时才发现并改回去。
- **不能只靠“搜索英文然后替换”。** 就算用了语法分析，也得一条一条看语义。
- **翻译前先备份。** 我保留了一份修复过思考菜单的英文版网页，随时可以换回去。
- **改完要跑检查和测试。** 项目自带的 674 项单元测试在翻译后全部通过；之后我又补了少量文字，重新做了检查、构建和浏览器验证。
- 模型的回答、你输入的内容、工具返回的结果不会被翻译，汉化的只是界面。

最后的效果是：聊天、设置、思考模式、工具菜单和生成进度都是中文，模型和启动参数完全没变。

## 接入其他软件

`llama-server` 提供的是 OpenAI 兼容接口，所以很多支持自定义接口地址的客户端都能直接连：

- 接口地址（Base URL）：`http://127.0.0.1:8080/v1`
- 模型名：用下面的命令查，不要照着文件名猜
- API Key：服务器没有设置密钥。如果客户端要求必须填，随便填一个占位值能不能用，取决于那个客户端

```powershell
Invoke-RestMethod 'http://127.0.0.1:8080/v1/models'
Invoke-RestMethod 'http://127.0.0.1:8080/health'
```

用 PowerShell 直接调用的例子（注意中文要按 UTF-8 发送，否则会乱码）：

```powershell
$modelList = Invoke-RestMethod 'http://127.0.0.1:8080/v1/models'
$actualModelId = $modelList.data[0].id
$requestJson = @{
    model = $actualModelId
    messages = @(@{ role='user'; content='请用中文介绍一下你自己。' })
    stream = $false
    max_tokens = 256
    chat_template_kwargs = @{ enable_thinking=$false }
} | ConvertTo-Json -Depth 8

Invoke-RestMethod -Method Post `
    -Uri 'http://127.0.0.1:8080/v1/chat/completions' `
    -ContentType 'application/json; charset=utf-8' `
    -Body ([Text.Encoding]::UTF8.GetBytes($requestJson))
```

模型没启动时，这些命令会报连接错误，这是正常的，它们不会帮你启动模型。

## 以后想换别的模型

流程是一样的：

1. 确认你的 llama.cpp 版本支持那个模型。
2. 按显存大小选量化版本和上下文长度。
3. 从可信的仓库下载完整的 GGUF 文件并校验。
4. 如果是多模态模型，下载**和它配套**的 mmproj；纯文字模型不需要。
5. 先停掉正在运行的模型，再改启动命令里的 `-m` 和 `--mmproj`。建议先换个端口试跑，确认没问题再改日常用的启动文件。

```powershell
& (Join-Path $binDir 'llama-server.exe') `
    -m (Join-Path $modelDir 'YOUR-MODEL.gguf') `
    -ngl 99 -c 4096 -np 1 `
    --host 127.0.0.1 --port 8089
```

`YOUR-MODEL.gguf` 是占位名，要换成真实的文件名。另外，“思考开关”是 Qwen 的聊天模板支持的功能，不是所有模型都有，换模型后要重新确认。

## 常见问题速查

| 现象 | 原因和处理 |
| --- | --- |
| 提示找不到 `nvidia-smi` | 没装 NVIDIA 驱动，先装驱动 |
| `curl` 报参数错误 | 写成 `curl.exe` |
| 程序不用显卡，速度极慢 | 检查 CUDA 运行库那个压缩包有没有解压到 `bin`；用 `llama-cli.exe --list-devices` 确认能认到显卡 |
| 模型加载失败 | 先校验 SHA-256，排除文件损坏 |
| 显存不足 | 关掉其他占显存的程序；减小 `-c`；去掉 `--mmproj` 只跑文字 |
| 双击启动文件一闪而过 | 用 `cmd.exe /d /c "call 文件路径"` 抓报错；文件内容只用英文、CRLF 换行、启动命令写成一行 |
| 浏览器打开是空白或连不上 | 模型还在加载，等几秒刷新；或查询 `/health` |
| 端口被占用 | 上一份没关，或者换一个 `--port` |
| 回答前总要“想”很久 | 启动参数用 `--reasoning off`，或在网页的思考菜单里选“关闭” |
| 改了网页但看不到变化 | 确认启动参数里有 `--path`；按 `Ctrl+F5` 强制刷新 |
| 复制文件时 `*` 不生效 | `-LiteralPath` 不展开通配符，改用 `Get-ChildItem ... \| Copy-Item` |
| 想删掉旧模型 | 确认新模型已经下载、校验、能加载之后再删。我用的是移到回收站，而不是直接永久删除 |

## 写在最后

回头看，这件事并不需要多强的硬件，也不需要懂深度学习。真正花时间的地方有三处：选模型时在“快”和“全面”之间做取舍，被一个批处理文件的编码问题卡住，以及弄清楚“思考开关不见了”到底是模型的问题、服务器的问题还是网页的问题。把这三处讲清楚，剩下的只是按顺序敲命令。

几点提醒：

- 文中的速度和显存数字是我这台机器当时的记录，换一台电脑、换一个电源模式都会不一样。
- 模型的基准分数来自 Qwen 官方，测的是完整精度的模型；我本地跑的是量化版，没有复测。
- 本地模型同样会一本正经地说错话，重要的信息要自己核对。

## 参考资料

- [llama.cpp b10909 发布页](https://github.com/ggml-org/llama.cpp/releases/tag/b10909)
- [llama.cpp b10909 服务端文档](https://github.com/ggml-org/llama.cpp/blob/b10909/tools/server/README.md)
- [llama.cpp b10909 网页源码](https://github.com/ggml-org/llama.cpp/tree/b10909/tools/ui)
- [思考菜单的修复：PR #27985](https://github.com/ggml-org/llama.cpp/pull/27985) 与 [issue #27981](https://github.com/ggml-org/llama.cpp/issues/27981)
- [Qwen3.5-9B 官方模型卡](https://huggingface.co/Qwen/Qwen3.5-9B)（基准数据与对比图的来源）
- [Qwen3.5-9B GGUF（Bartowski 量化）](https://huggingface.co/bartowski/Qwen_Qwen3.5-9B-GGUF)
- [Gemma 4 E4B 官方 QAT GGUF](https://huggingface.co/google/gemma-4-E4B-it-qat-q4_0-gguf)
