const { test } = require('node:test');
const assert = require('node:assert/strict');
const cheerio = require('cheerio');
const { slots, decorate, scriptSegments } = require('../tools/build-bilingual.cjs');

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
