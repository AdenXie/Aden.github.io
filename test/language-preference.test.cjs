const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require.resolve('../source/js/language-preference.js'), 'utf8');

function visit({ path = '/', language = 'en-AU', preferred, blocked = false, english = true } = {}) {
  let handler, redirected, stored;
  class Element { closest() { return this.choice; } }
  const location = new URL('https://blog.adenxie.com.cn' + path);
  location.replace = url => { redirected = url; };
  vm.runInNewContext(source, {
    Element, URL, location, navigator: { languages: [language], language },
    document: {
      addEventListener: (_, listener) => { handler = listener; },
      currentScript: { dataset: english ? { englishHome: '/en/' } : {} },
    },
    localStorage: {
      getItem: () => { if (blocked) throw new Error('blocked'); return preferred; },
      setItem: (key, value) => { if (blocked) throw new Error('blocked'); stored = { key, value }; },
    },
  });
  return { redirected, click(lang, href) {
    const target = new Element();
    target.choice = { lang, href };
    handler({ target });
    return { stored, href: target.choice.href };
  } };
}

test('entry homepage chooses English and preserves query/fragment', () => {
  assert.equal(visit({ path: '/?from=link#main' }).redirected, 'https://blog.adenxie.com.cn/en/?from=link#main');
  assert.equal(visit({ path: '/index.html' }).redirected, 'https://blog.adenxie.com.cn/en/');
  for (const language of ['zh-CN', 'zh-TW', 'zh-HK', 'fr-FR', '']) assert.equal(visit({ language }).redirected, undefined);
});

test('manual preference wins over browser language', () => {
  assert.equal(visit({ preferred: 'zh' }).redirected, undefined);
  assert.equal(visit({ preferred: 'en', language: 'zh-CN' }).redirected, 'https://blog.adenxie.com.cn/en/');
});

test('explicit pages never redirect; unavailable English and blocked storage are safe', () => {
  for (const path of ['/en/', '/en/2026/article/', '/2026/article/', '/archives/']) assert.equal(visit({ path, preferred: 'en' }).redirected, undefined);
  assert.equal(visit({ english: false }).redirected, undefined);
  assert.equal(visit({ blocked: true }).redirected, 'https://blog.adenxie.com.cn/en/');
  assert.equal(visit({ path: '/?lang=zh', blocked: true }).redirected, undefined);
  assert.equal(visit({ path: '/?lang=zh', preferred: 'en' }).redirected, undefined);
  assert.equal(visit({ path: '/?lang=en', preferred: 'zh' }).redirected, 'https://blog.adenxie.com.cn/en/?lang=en');
});

test('language buttons retain links and remember only language preference', () => {
  const page = visit({ path: '/2026/article/?from=link#section' });
  assert.deepEqual(page.click('en', 'https://blog.adenxie.com.cn/en/2026/article/'), {
    stored: { key: 'aden-blog-language', value: 'en' },
    href: 'https://blog.adenxie.com.cn/en/2026/article/?from=link#section',
  });
  assert.equal(page.click('zh-CN', 'https://blog.adenxie.com.cn/2026/article/').stored.value, 'zh');
  assert.doesNotThrow(() => visit({ blocked: true }).click('zh-CN', 'https://blog.adenxie.com.cn/'));
  assert.equal(visit({ blocked: true }).click('zh-CN', 'https://blog.adenxie.com.cn/').href, 'https://blog.adenxie.com.cn/?lang=zh');
});
