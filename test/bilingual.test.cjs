const { test } = require('node:test');
const assert = require('node:assert/strict');
const cheerio = require('cheerio');
const { slots, decorate, scriptSegments, cached, mergeAuthoredContent } = require('../tools/build-bilingual.cjs');
const { MODEL, ENDPOINT, translate, parseOutput } = require('../tools/lib/openrouter-translation.cjs');

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

test('OpenRouter reuses historical segment entries without copying them into its namespace', () => {
  const text = '已发布旧文';
  const digest = require('node:crypto').createHash('sha256').update('niutrans-en-v1' + text).digest('hex');
  const cache = { [digest]: 'Previously published translation' };
  assert.equal(cached(cache, text), 'Previously published translation');
  assert.equal(Object.keys(cache).length, 1);
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
