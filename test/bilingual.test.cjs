const { test } = require('node:test');
const assert = require('node:assert/strict');
const cheerio = require('cheerio');
const { slots, decorate, scriptSegments, cached, mergeAuthoredContent } = require('../tools/build-bilingual.cjs');
const { MODEL, ENDPOINT, translate, parseOutput } = require('../tools/lib/openrouter-translation.cjs');
const deepl = require('../tools/lib/deepl-translation.cjs');
const { hasSameAnchors } = require('../tools/lib/translation-anchors.cjs');
const { translateBatch } = require('../tools/build-bilingual.cjs');

test('translation leaves formulas, code, URLs and markup intact', () => {
  const $ = cheerio.load('<html><head><title>标题</title></head><body><p>正文<a href="https://example.org/中文">来源</a></p><pre>中文代码</pre><mjx-container><svg><text>数学</text></svg></mjx-container><img src="/中文.jpg" alt="照片"></body></html>');
  const texts = slots($).map(s => s.text);
  assert.deepEqual(texts.sort(), ['标题','正文','来源','照片'].sort());
  for (const s of slots($)) s.set('<script>unsafe</script>');
  assert.equal($('body script').length, 0);
  assert.equal($('pre').text(), '中文代码');
  assert.equal($('mjx-container').text(), '数学');
  assert.equal($('a').attr('href'), 'https://example.org/中文');
  assert.equal($('img').attr('src'), '/中文.jpg');
});
test('English has matching original link, canonical URL and isolated widget scripts', () => {
  const $ = cheerio.load('<html><head><link rel="canonical" href="/"></head><body><div class="navbar-content"></div><main>Text</main><script src="/js/world-time.js"></script></body></html>');
  decorate($, '/world-time/', true, true);
  assert.equal($('html').attr('lang'), 'en');
  assert.equal($('link[rel="canonical"]').attr('href'), 'https://blog.adenxie.com.cn/en/world-time/');
  assert.equal($('.aden-language-switch [lang="zh-CN"]').attr('href'), '/world-time/');
  assert.equal($('script').attr('src'), '/en/js/world-time.js');
});
test('script parsing translates strings rather than identifiers, regex or expressions', () => {
  const nodes = scriptSegments('const x = "天气"; const y = `温度 ${value} °C`; const z = /中文/;');
  assert.deepEqual(nodes.flatMap(n => n.texts), ['天气','温度 ']);
});
test('script translation segments retain numbers in Chinese currency phrases and disclaimers', () => {
  const nodes = scriptSegments('const unit = "人民币 / 100澳元"; const disclaimer = "仅供个人展示，汇率单位为每100澳元"; const x = `${amount} 100`;');
  assert.deepEqual(nodes.flatMap(n => n.texts), ['人民币 / 100澳元', '仅供个人展示，汇率单位为每100澳元']);
  assert.equal(nodes.some(n => n.texts.includes('100')), false);
});

test('OpenRouter sends the selected free model and accepts reordered JSON IDs', async () => {
  let request;
  const items = [{ text: '价格是 42 元，访问 https://example.org', context: '产品说明' }, { text: '支持 Windows 11' }];
  const result = await translate(items, 'test-secret', async (url, options) => {
    request = { url, ...options, body: JSON.parse(options.body) };
    return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ translations: [
      { id: 1, text: 'Supports Windows 11' }, { id: 0, text: 'Costs 42 yuan; visit https://example.org' },
    ] }) } }] }) };
  });
  assert.equal(request.url, ENDPOINT);
  assert.equal(request.body.model, MODEL);
  assert.equal(request.body.max_tokens, 2048);
  assert.deepEqual(request.body.reasoning, { enabled: false });
  assert.equal(request.headers.Authorization, 'Bearer test-secret');
  assert.equal('response_format' in request.body, false);
  assert.deepEqual(result, ['Costs 42 yuan; visit https://example.org', 'Supports Windows 11']);
});

test('OpenRouter rejects malformed, shifted, incomplete and truncated outputs', async () => {
  const item = [{ text: '共有 12 台设备' }];
  for (const content of ['not json', '{"translations":[{"id":0,"text":""}]}', '{"translations":[{"id":1,"text":"There are 12 devices"}]}']) {
    assert.throws(() => parseOutput(content, item));
  }
  await assert.rejects(translate(item, 'x', async () => ({ ok: false, status: 429 })), /HTTP 429/);
  await assert.rejects(translate(item, 'x', async () => ({ ok: true, json: async () => ({ choices: [{ finish_reason: 'length', message: { content: '{"translations":[]}' } }] }) })), /truncated/);
  await assert.rejects(translate(item, 'x', async () => ({ ok: true, json: async () => ({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [] } }] }) })), /unsupported finish reason/);
  await assert.rejects(translate(item, 'x', async () => ({ ok: true, json: async () => ({ choices: [{ finish_reason: 'content_filter', message: { content: '{}' } }] }) })), /unsupported finish reason/);
});

test('OpenRouter rejects changed URLs and numeric anchors', () => {
  assert.throws(() => parseOutput('{"translations":[{"id":0,"text":"There are 13 devices"}]}', [{ text: '共有 12 台设备' }]));
  assert.throws(() => parseOutput('{"translations":[{"id":0,"text":"Read https://wrong.example"}]}', [{ text: '访问 https://example.org' }]));
});

test('OpenRouter reports HTTP-200 provider errors without exposing the API key or raw payload', async () => {
  await assert.rejects(translate([{ text: '示例' }], 'test-secret', async () => ({
    ok: true,
    json: async () => ({ error: { code: 400, message: 'Provider returned error', metadata: { raw: JSON.stringify({ error: { message: 'Rejected test-secret parameter' }, headers: 'do not log this' }) } } }),
  })), error => error.message.includes('API 400') && error.message.includes('Rejected [redacted] parameter') && !error.message.includes('test-secret') && !error.message.includes('do not log this'));
});

test('anchors accept English month names and thousands separators but still reject changed numbers', () => {
  assert.equal(hasSameAnchors('根据 2026 年 9 月 29 日董事会决议', 'According to the board decision of 29 September 2026'), true);
  assert.equal(hasSameAnchors('重点关注 10 月底 CPI、12 月 RBA 决议', 'Watch end-October CPI and the December RBA decision'), true);
  assert.equal(hasSameAnchors('09 月数据', 'Sept. data'), true);
  assert.equal(hasSameAnchors('上限 160000 字符', 'a limit of 160,000 characters'), true);
  assert.equal(hasSameAnchors('9 月加息 25bp', 'October hike of 25bp'), false);
  assert.equal(hasSameAnchors('共有 9 台设备', 'There are September devices'), false);
  assert.equal(hasSameAnchors('共有 12 台设备', 'There are 13 devices'), false);
});

test('DeepL picks the free or pro host and sends Chinese-to-British-English requests', async () => {
  assert.equal(deepl.endpointFor('abc:fx'), deepl.FREE_ENDPOINT);
  assert.equal(deepl.endpointFor('abc'), deepl.PRO_ENDPOINT);
  let request;
  const result = await translateBatch([{ text: '天气 42' }, { text: '访问 https://example.org' }], 'key:fx', async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return { ok: true, status: 200, json: async () => ({ translations: [{ text: 'Weather 42' }, { text: 'Visit https://example.org' }] }) };
  });
  assert.equal(request.url, deepl.FREE_ENDPOINT);
  assert.equal(request.options.headers.Authorization, 'DeepL-Auth-Key key:fx');
  assert.deepEqual(request.body.text, ['天气 42', '访问 https://example.org']);
  assert.equal(request.body.source_lang, 'ZH');
  assert.equal(request.body.target_lang, 'EN-GB');
  assert.deepEqual(result, { outputs: ['Weather 42', 'Visit https://example.org'], provider: 'deepl', model: deepl.MODEL });
});

test('DeepL rejects only the items that fail integrity checks', async () => {
  const outputs = await deepl.translate([{ text: '共有 12 台设备' }, { text: '天气' }, { text: '访问 https://example.org' }], 'key', async () => ({
    ok: true, status: 200, json: async () => ({ translations: [{ text: 'There are 13 devices' }, { text: 'Weather' }, { text: 'Visit https://wrong.example' }] }),
  }));
  assert.deepEqual(outputs, [null, 'Weather', null]);
  await assert.rejects(deepl.translate([{ text: '天气' }], 'key', async () => ({ ok: true, status: 200, json: async () => ({ translations: [] }) })), error => /wrong number/.test(error.message) && !error.fatal);
});

test('DeepL backs off on 429/5xx, honours Retry-After and stops the run when limits persist', async () => {
  const waits = [];
  let calls = 0;
  const output = await deepl.translate([{ text: '天气' }], 'key', async () => {
    calls++;
    if (calls === 1) return { ok: false, status: 429, headers: { get: name => (name === 'retry-after' ? '3' : null) } };
    if (calls === 2) return { ok: false, status: 503, headers: { get: () => null } };
    return { ok: true, status: 200, json: async () => ({ translations: [{ text: 'Weather' }] }) };
  }, { sleep: async ms => waits.push(ms) });
  assert.deepEqual(output, ['Weather']);
  assert.deepEqual(waits, [3000, 6000]);
  calls = 0;
  await assert.rejects(deepl.translate([{ text: '天气' }], 'key', async () => { calls++; return { ok: false, status: 429 }; }, { sleep: async () => {} }), error => error.fatal && /HTTP 429/.test(error.message));
  assert.equal(calls, 3);
});

test('DeepL quota, credential and missing-key failures are fatal and never expose the key', async () => {
  for (const [status, pattern] of [[456, /quota/], [403, /key rejected/], [401, /key rejected/]]) {
    await assert.rejects(deepl.translate([{ text: '天气' }], 'secret-key', async () => ({ ok: false, status })), error => error.fatal && pattern.test(error.message) && !error.message.includes('secret-key'));
  }
  let calls = 0;
  await assert.rejects(deepl.translate([{ text: '天气' }], '', async () => { calls++; }), error => error.fatal && /missing/.test(error.message));
  assert.equal(calls, 0);
});

test('cache lookups keep the existing translation namespace', () => {
  const crypto = require('node:crypto');
  const text = '已发布旧文';
  const current = crypto.createHash('sha256').update('openrouter-nemotron-en-v1' + text).digest('hex');
  assert.equal(cached({ [current]: 'Cached translation' }, text), 'Cached translation');
  assert.equal(cached({ unrelated: 'Unrelated cache entry' }, text), undefined);
});

test('authored article content and list cards update inside old translated snapshots', () => {
  const url = '/2026/10/18/device-note/';
  const oldArticle = '<html><head><title>Old title</title><meta name="description" content="Old summary"></head><body><h1 class="article-title-cover">Old title</h1><div class="article-content">Old prose</div><div class="toc-content-container">Old TOC</div></body></html>';
  const currentArticle = '<html><head><title>Current title</title><meta name="description" content="Current summary"></head><body><h1 class="article-title-cover">Current title</h1><div class="article-content">Current prose</div><div class="toc-content-container">Current TOC</div></body></html>';
  const mergedArticle = cheerio.load(mergeAuthoredContent(oldArticle, currentArticle, [url], true));
  assert.equal(mergedArticle('title').text(), 'Current title');
  assert.equal(mergedArticle('meta[name="description"]').attr('content'), 'Current summary');
  assert.equal(mergedArticle('.article-content').text(), 'Current prose');
  assert.equal(mergedArticle('.toc-content-container').text(), 'Current TOC');
  const oldList = '<ul><li class="home-article-item"><a href="/2026/10/18/device-note/">Old title</a><p>Old summary</p></li></ul>';
  const currentList = '<ul><li class="home-article-item"><a href="/2026/10/18/device-note/">Current title</a><p>Current summary</p></li></ul>';
  const mergedList = cheerio.load(mergeAuthoredContent(oldList, currentList, [url], false));
  assert.match(mergedList('li').text(), /Current titleCurrent summary/);
  assert.doesNotMatch(mergedList('li').text(), /Old title|Old summary/);
});
