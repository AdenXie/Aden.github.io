'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { MODEL, translate, hasSameAnchors } = require('./lib/openrouter-translation.cjs');
const CACHE_VERSION = 'openrouter-nemotron-en-v1';

const samples = [
  { text: '我最初是喜欢 Opus 5.5 的。模型更强，价格又降了，这当然值得高兴。我同时订阅着 Claude Pro 和 ChatGPT Plus，也实际使用 Claude Code 和 Codex，有理由期待竞争最后能给用户带来实惠。', context: '公开文章开头，涉及模型、产品和作者态度。' },
  { text: '所以，40% 不是一张价格表上可以直接读出的统一折扣。它混合了不同 Token 类别的降价和特定任务下的消耗变化。换一个缓存比例，换一个推理档位，换一种任务，这个百分比就可能变化。', context: '公开文章讨论 40% 成本说法的限制。' },
  { text: '这组个人记录没有统一任务、验收结果和返工时间，却清楚显示了我的使用组合如何消耗资源。它给了我继续追问的理由。消费者也有权从自己的工作出发理解产品，而不必永远停留在厂商挑选的成功案例里。链接：[原文](https://blog.adenxie.com.cn/2026/10/18/2026-10-18-claude-opus-5-5-pricing-myth/)', context: '公开文章的保留态度、否定性限定和 Markdown 链接。' },
];

function existingTranslation(text, cacheDir) {
  const file = path.join(cacheDir || '', 'segments.json');
  if (!cacheDir || !fs.existsSync(file)) return null;
  const key = crypto.createHash('sha256').update(CACHE_VERSION + text).digest('hex');
  const cache = JSON.parse(fs.readFileSync(file, 'utf8'));
  return cache[key] ? { source: 'Historical cached translation', text: cache[key] } : null;
}

async function main() {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY is not configured');
  const outputs = await translate(samples, key);
  for (let i = 0; i < samples.length; i++) {
    const old = existingTranslation(samples[i].text, process.env.TRANSLATION_CACHE_DIR);
    console.log(`\nProbe ${i + 1} (${MODEL})`);
    console.log(`Source: ${samples[i].text}`);
    console.log(`OpenRouter: ${outputs[i]}`);
    console.log(`Integrity: ${hasSameAnchors(samples[i].text, outputs[i]) ? 'PASS' : 'FAIL'}`);
    console.log(old ? `${old.source}: ${old.text}` : 'Historical cached translation: none');
  }
}

if (require.main === module) main().catch(error => { console.error(`Translation probe failed: ${error.message}`); process.exitCode = 1; });
module.exports = { samples, existingTranslation };
