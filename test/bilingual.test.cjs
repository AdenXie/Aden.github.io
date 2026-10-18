const { test } = require('node:test');
const assert = require('node:assert/strict');
const cheerio = require('cheerio');
const { slots, decorate, scriptSegments, cached, mergeAuthoredContent } = require('../tools/build-bilingual.cjs');
const { MODEL, ENDPOINT, translate, parseOutput } = require('../tools/lib/openrouter-translation.cjs');
const google = require('../tools/lib/google-translation.cjs');
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

test('Google joins every translated response segment and preserves anchored tokens', async () => {
  let requestUrl;
  const result = await google.translateText('天气 42 https://example.org', async url => {
    requestUrl = new URL(url);
    return { ok: true, headers: { get: () => 'application/json; charset=utf-8' }, json: async () => [[['Weather ', '天气'], ['42 ', '42']], 'zh-CN'] };
  });
  assert.equal(requestUrl.origin + requestUrl.pathname, google.ENDPOINT);
  assert.equal(requestUrl.searchParams.get('client'), 'gtx');
  assert.equal(requestUrl.searchParams.get('dt'), 't');
  assert.equal(requestUrl.searchParams.get('sl'), 'zh-CN');
  assert.equal(requestUrl.searchParams.get('tl'), 'en');
  assert.equal(result, 'Weather 42 https://example.org');
});

test('Google splits long requests by encoded URL length without losing source characters', async () => {
  const source = `${'天气，'.repeat(1200)}结束`;
  const chunks = google.chunksFor(source, 1200);
  assert.ok(chunks.length > 1);
  assert.equal(chunks.map(chunk => chunk.text).join(''), source);
  const observed = [];
  let englishIndex = 0;
  const result = await google.translateText(source, async url => {
    const parsed = new URL(url);
    observed.push(parsed.searchParams.get('q'));
    return { ok: true, json: async () => [[[`English block ${englishIndex++}`, '']], 'zh-CN'] };
  }, { maxUrlLength: 1200 });
  assert.deepEqual(observed, chunks.filter(chunk => !chunk.protected).map(chunk => chunk.text));
  assert.equal(result, Array(chunks.length).fill(0).map((_, index) => `English block ${index}`).join(' '));
  assert.equal(google.joinChunks(['First sentence.', 'Second sentence.']), 'First sentence. Second sentence.');
  assert.ok(observed.every(chunk => new URL(`${google.ENDPOINT}?${new URLSearchParams({ client: 'gtx', dt: 't', sl: 'zh-CN', tl: 'en', q: chunk })}`).href.length <= 1200));
});

test('Google keeps long URLs and numeric anchors intact while splitting nearby text', async () => {
  const url = `https://example.org/${'longpath'.repeat(300)}`;
  const source = `开始 1,234.56% ${url} 结束`;
  const parts = google.chunksFor(source, 1200);
  const urlPart = parts.find(part => part.protected);
  assert.equal(urlPart.text, url);
  assert.ok(parts.some(part => part.text.includes('1,234.56%')));
  assert.ok(parts.filter(part => !part.protected).every(part => new URL(`${google.ENDPOINT}?${new URLSearchParams({ client: 'gtx', dt: 't', sl: 'zh-CN', tl: 'en', q: part.text })}`).href.length <= 1200));
  const requested = [];
  const output = await google.translateText(source, async requestUrl => {
    const q = new URL(requestUrl).searchParams.get('q');
    requested.push(q);
    return { ok: true, json: async () => [[[/结束/u.test(q) ? ' finish' : 'Start 1,234.56% ', q]], 'zh-CN'] };
  }, { maxUrlLength: 1200 });
  assert.equal(requested.some(q => q.includes(url)), false);
  assert.equal(output, `Start 1,234.56% ${url} finish`);
});

test('Google preserves whitespace around URLs without translating blank or English-only chunks', async () => {
  let calls = 0;
  const result = await google.translateText('天气 https://one.example/ https://two.example/ 42 CPU', async url => {
    calls++;
    assert.equal(new URL(url).searchParams.get('q'), '天气 ');
    return { ok: true, json: async () => [[['Weather', '天气 ']]] };
  });
  assert.equal(calls, 1);
  assert.equal(result, 'Weather https://one.example/ https://two.example/ 42 CPU');
  const suffix = await google.translateText('https://example.org/ 结束', async () => ({ ok: true, json: async () => [[['Finish', '结束']]] }));
  assert.equal(suffix, 'https://example.org/ Finish');
});

test('Google rejects HTML, error objects, empty results and changed URL anchors', async () => {
  await assert.rejects(google.translateText('天气', async () => ({ ok: true, headers: { get: () => 'text/html' } })), /non-JSON/);
  await assert.rejects(google.translateText('天气', async () => ({ ok: true, json: async () => ({ error: 'blocked' }) })), /invalid response/);
  await assert.rejects(google.translateText('天气', async () => ({ ok: true, json: async () => [[], null] })), /invalid response/);
  assert.throws(() => google.parseResponse([[['Weather', '天气'], null]]), /malformed translation segment/);
  await assert.rejects(google.translateText('设备 42', async () => ({ ok: true, json: async () => [[['Devices 43', '']], null] })), /integrity checks/);
});

test('Google retries a temporary failure once and does not expose its request URL', async () => {
  let calls = 0;
  const output = await google.translateText('天气', async url => {
    calls++;
    assert.equal(String(url).startsWith(google.ENDPOINT), true);
    if (calls === 1) return { ok: false, status: 503 };
    return { ok: true, json: async () => [[['Weather', '天气']], null] };
  });
  assert.equal(calls, 2);
  assert.equal(output, 'Weather');
});

test('OpenRouter retries one temporary failure, then falls back to Google; missing key uses Google', async () => {
  for (const status of [429, 503]) {
    let openCalls = 0;
    let googleCalls = 0;
    const fetchMock = async url => {
      if (String(url).startsWith(ENDPOINT)) {
        openCalls++;
        return { ok: false, status };
      }
      googleCalls++;
      return { ok: true, json: async () => [[['Weather 42', '天气 42']], null] };
    };
    const fallback = await translateBatch([{ text: '天气 42' }], 'test-key', fetchMock);
    assert.deepEqual(fallback, { outputs: ['Weather 42'], provider: 'google', model: 'google-translate-gtx' });
    assert.equal(openCalls, 2);
    assert.equal(googleCalls, 1);
    openCalls = 0;
    const noKey = await translateBatch([{ text: '天气 42' }], '', fetchMock);
    assert.equal(noKey.provider, 'google');
    assert.equal(openCalls, 0);
    assert.equal(googleCalls, 2);
  }
});

test('OpenRouter validation failures fall back to Google without a model retry', async () => {
  let openCalls = 0;
  const result = await translateBatch([{ text: '天气 42' }], 'key', async url => {
    if (String(url).startsWith(ENDPOINT)) {
      openCalls++;
      return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: '{"translations":[]}' } }] }) };
    }
    return { ok: true, json: async () => [[['Weather 42', '天气 42']], null] };
  });
  assert.equal(openCalls, 1);
  assert.equal(result.provider, 'google');
  assert.equal(result.outputs[0], 'Weather 42');
});

test('OpenRouter retries a provider-reported HTTP-200 503 before Google fallback', async () => {
  let openCalls = 0;
  const result = await translateBatch([{ text: '天气 42' }], 'key', async url => {
    if (String(url).startsWith(ENDPOINT)) {
      openCalls++;
      return { ok: true, json: async () => ({ error: { code: 503, message: 'provider unavailable' } }) };
    }
    return { ok: true, json: async () => [[['Weather 42', '天气 42']]] };
  });
  assert.equal(openCalls, 2);
  assert.equal(result.provider, 'google');
  assert.equal(result.outputs[0], 'Weather 42');
});

test('OpenRouter reads only translations in its current cache namespace', () => {
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
