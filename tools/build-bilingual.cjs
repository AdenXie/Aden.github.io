'use strict';
// Translate rendered text, never markup, scripts, code, or MathJax output.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cheerio = require('cheerio');
const acorn = require('acorn');
const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const CACHE = path.join(ROOT, '.translation-cache');
const VERSION = 'niutrans-en-v1';
const hasChinese = text => /[\u3400-\u9fff]/u.test(text);
const hash = text => crypto.createHash('sha256').update(VERSION + text).digest('hex');
const protectedSelector = 'script,style,pre,code,math,mjx-container,.MathJax,.MathJax_Display,.katex,textarea,[translate="no"]';
function scriptSegments(source) {
  const result = [];
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if ((node.type === 'Literal' && typeof node.value === 'string') || node.type === 'TemplateElement') {
      const value = node.type === 'Literal' ? node.value : node.value.raw;
      const texts = [...new Set(value.match(/[\u3400-\u9fff][\u3400-\u9fff，。；：、（） ·…/-]*/gu) || [])];
      if (texts.length || value === 'zh-CN') result.push({ node, value, texts });
      return;
    }
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') visit(value);
  }
  visit(acorn.parse(source, { ecmaVersion: 'latest' }));
  return result;
}
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory()
    ? (e.name === 'en' ? [] : files(path.join(dir, e.name))) : [path.join(dir, e.name)]);
}
function slots($) {
  const result = [];
  $('*').each((_, el) => {
    if ($(el).closest(protectedSelector).length) return;
    for (const node of el.children || []) {
      if (node.type === 'text' && hasChinese(node.data)) result.push({ text: node.data.trim(), set: text => { node.data = node.data.replace(node.data.trim(), () => text); } });
    }
    for (const attr of ['title', 'alt', 'placeholder', 'aria-label', 'data-name']) {
      if (hasChinese($(el).attr(attr) || '')) result.push({ text: $(el).attr(attr), set: text => $(el).attr(attr, text) });
    }
    if (el.name === 'meta' && /description|title/.test($(el).attr('name') || $(el).attr('property') || '') && hasChinese($(el).attr('content') || '')) {
      result.push({ text: $(el).attr('content'), set: text => $(el).attr('content', text) });
    }
  });
  return result;
}
function urlFor(file) { return '/' + path.relative(PUBLIC, file).replaceAll('\\', '/').replace(/index\.html$/, ''); }
function decorate($, original, english, available) {
  $('.aden-language-switch').remove();
  const nav = $('<nav class="aden-language-switch" aria-label="Language"><a lang="zh-CN">中文</a><span> / </span><a lang="en">English</a></nav>');
  nav.find('[lang="zh-CN"]').attr('href', original).attr('aria-current', english ? 'false' : 'page');
  nav.find('[lang="en"]').attr('href', available ? '/en' + original : '/en/').attr('aria-current', english ? 'page' : 'false');
  if (!available && !english) nav.find('[lang="en"]').attr('title', '本页译文暂未生成，查看英文首页');
  const header = $('.navbar-content').first();
  if (header.length) header.append(nav); else $('body').prepend(nav);
  // Each language has its own script/config state. Use normal static navigation.
  $('a[href]').attr('data-no-swup', '');
  $('head').append('<link rel="stylesheet" href="/css/bilingual.css">');
  $('link[rel="alternate"][hreflang]').remove();
  if (available) $('head').append(`<link rel="alternate" hreflang="zh-CN" href="https://blog.adenxie.com.cn${original}"><link rel="alternate" hreflang="en" href="https://blog.adenxie.com.cn/en${original}">`);
  if (english) {
    $('html').attr('lang', 'en');
    $('link[rel="canonical"]').attr('href', 'https://blog.adenxie.com.cn/en' + original);
    $('meta[property="og:url"]').attr('content', 'https://blog.adenxie.com.cn/en' + original);
    $('.aden-language-switch a').attr('data-no-swup', '');
    $('script[src]').each((_, el) => {
      const src = $(el).attr('src');
      if (['/js/cyber-weather.js', '/js/cyber-exchange.js', '/js/world-time.js'].includes(src)) $(el).attr('src', '/en' + src);
    });
    $('script:not([src])').each((_, el) => {
      // Theme's generated search configuration must load the English index.
      el.children?.forEach(n => { if (n.type === 'text') n.data = n.data.replace(/(["'])search\.xml\1/g, '"en/search.xml"').replace(/"language":"zh-CN"/g, '"language":"en"'); });
    });
    const notice = $('<p class="aden-translation-notice">Machine-translated with NiuTrans. <a>Read the Chinese original</a>.</p>');
    notice.find('a').attr('href', original);
    const content = $('.article-content, .post-content, main').first();
    if (content.length) content.prepend(notice); else $('.navbar-container').after(notice);
  }
}
async function translate(text, key, appId) {
  const params = { from: 'zh', to: 'en', appId, srcText: text, timestamp: String(Date.now()) };
  const signed = { ...params, apikey: key };
  params.authStr = crypto.createHash('md5').update(Object.keys(signed).sort().map(k => `${k}=${signed[k]}`).join('&')).digest('hex');
  const response = await fetch('https://api.niutrans.com/v2/text/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params), signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw new Error(`Translation HTTP ${response.status}`);
  const data = await response.json();
  if (!data.tgtText || data.errorCode) throw new Error(`Translation error ${data.errorCode || 'empty'}`);
  return data.tgtText;
}
async function main() {
  fs.mkdirSync(CACHE, { recursive: true });
  const cacheFile = path.join(CACHE, 'segments.json');
  const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};
  const pages = files(PUBLIC).filter(f => f.endsWith('.html')).map(file => {
    const html = fs.readFileSync(file, 'utf8'); const $ = cheerio.load(html);
    return { file, html, $, slots: slots($), url: urlFor(file) };
  });
  const scripts = ['cyber-weather.js', 'cyber-exchange.js', 'world-time.js'].map(name => {
    const source = fs.readFileSync(path.join(PUBLIC, 'js', name), 'utf8');
    return { name, source, segments: scriptSegments(source) };
  });
  const pending = [...new Set([...scripts.flatMap(s => s.segments.flatMap(n => n.texts)), ...pages.flatMap(p => p.slots.map(s => s.text))])].filter(t => !cache[hash(t)]);
  const key = process.env.NIUTRANS_API_KEY, appId = process.env.NIUTRANS_APP_ID;
  const budget = Number(process.env.TRANSLATION_CHAR_LIMIT || 160000);
  const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  const usageFile = path.join(CACHE, 'usage.json');
  const previous = fs.existsSync(usageFile) ? JSON.parse(fs.readFileSync(usageFile, 'utf8')) : {};
  let used = previous.day === day ? previous.used : 0, translated = 0, failed = 0;
  const save = () => { fs.writeFileSync(cacheFile, JSON.stringify(cache)); fs.writeFileSync(usageFile, JSON.stringify({ day, used })); };
  console.log(`Translation: ${pages.length} pages, ${pending.length} uncached segments; credentials ${key && appId ? 'present' : 'absent'}`);
  let next = 0;
  async function worker() {
    while (key && appId && next < pending.length && failed < 3) {
    const text = pending[next++];
    if (used + text.length > budget) return;
    // Count before attempting: uncertain network outcomes must not bypass the cap.
    used += text.length; save();
    try {
      const chunks = text.match(/[\s\S]{1,4500}/gu) || [];
      const outputs = [];
      for (const chunk of chunks) { outputs.push(await translate(chunk, key, appId)); await new Promise(r => setTimeout(r, 220)); }
      cache[hash(text)] = outputs.join(''); translated++; save();
      if (translated % 50 === 0) console.log(`Translated ${translated}/${pending.length} segments`);
    } catch (e) { console.warn(e.message); failed++; }
    }
  }
  await Promise.all(Array.from({ length: 4 }, () => worker()));
  const ready = new Set(pages.filter(p => p.slots.every(s => cache[hash(s.text)])).map(p => p.url));
  for (const script of scripts) {
    let source = script.source;
    for (const { node, value, texts } of [...script.segments].reverse()) {
      let translated = value === 'zh-CN' ? 'en-GB' : value;
      for (const text of texts.sort((a,b) => b.length-a.length)) translated = translated.replaceAll(text, cache[hash(text)] || text);
      const encoded = node.type === 'Literal' ? JSON.stringify(translated) : translated.replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
      source = source.slice(0, node.start) + encoded + source.slice(node.end);
    }
    acorn.parse(source, { ecmaVersion: 'latest' });
    fs.mkdirSync(path.join(PUBLIC, 'en/js'), { recursive: true });
    fs.writeFileSync(path.join(PUBLIC, 'en/js', script.name), source);
  }
  // Keep the last fully translated page if an update cannot be completed.
  for (const p of pages) {
    const snapshot = path.join(CACHE, 'pages', path.relative(PUBLIC, p.file));
    if (ready.has(p.url)) {
      for (const s of p.slots) s.set(cache[hash(s.text)]);
      fs.mkdirSync(path.dirname(snapshot), { recursive: true }); fs.writeFileSync(snapshot, p.$.html());
    } else if (fs.existsSync(snapshot)) ready.add(p.url);
  }
  for (const p of pages) {
    if (ready.has(p.url)) {
      const snapshot = path.join(CACHE, 'pages', path.relative(PUBLIC, p.file));
      const en = cheerio.load(fs.readFileSync(snapshot, 'utf8'));
      en('a[href]').each((_, el) => {
        const href = en(el).attr('href');
        try {
          const u = new URL(href, 'https://blog.adenxie.com.cn' + p.url);
          if (u.origin === 'https://blog.adenxie.com.cn' && ready.has(decodeURI(u.pathname).replace(/index\.html$/, ''))) en(el).attr('href', '/en' + u.pathname + u.search + u.hash);
        } catch (_) { /* Non-web links stay unchanged. */ }
      });
      decorate(en, p.url, true, true);
      if (!p.slots.every(s => cache[hash(s.text)])) en('.aden-translation-notice').prepend('This translation may be older than the Chinese original. ');
      const out = path.join(PUBLIC, 'en', path.relative(PUBLIC, p.file));
      fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, en.html());
    }
    const zh = cheerio.load(p.html);
    if (ready.has('/') || ready.has(p.url)) decorate(zh, p.url, false, ready.has(p.url));
    fs.writeFileSync(p.file, zh.html());
  }
  const xml = cheerio.load('<search></search>', { xmlMode: true });
  for (const p of pages.filter(p => ready.has(p.url) && /^\/\d{4}\/\d{2}\/\d{2}\//.test(p.url))) {
    const en = cheerio.load(fs.readFileSync(path.join(PUBLIC, 'en', path.relative(PUBLIC,p.file)), 'utf8'));
    const entry = xml('<entry><title/><url/><content/></entry>');
    entry.find('title').text(en('title').text()); entry.find('url').text('/en' + p.url);
    entry.find('content').text(en('.article-content, .post-content').first().text()); xml('search').append(entry);
  }
  fs.mkdirSync(path.join(PUBLIC, 'en'), { recursive: true });
  fs.writeFileSync(path.join(PUBLIC, 'en/search.xml'), xml.xml());
  console.log(`Bilingual build: ${ready.size}/${pages.length} English pages; ${translated} new segments; ${used} characters attempted today.`);
  save();
}
module.exports = { slots, hash, decorate, scriptSegments };
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
