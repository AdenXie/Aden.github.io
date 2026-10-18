'use strict';
// Translate rendered text, never markup, scripts, code, or MathJax output.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cheerio = require('cheerio');
const acorn = require('acorn');
const openrouter = require('./lib/openrouter-translation.cjs');
const google = require('./lib/google-translation.cjs');
const ROOT = path.resolve(process.env.BILINGUAL_ROOT || path.join(__dirname, '..'));
const PUBLIC = path.resolve(process.env.BILINGUAL_PUBLIC || path.join(ROOT, 'public'));
const ENGLISH_THEME = path.resolve(process.env.BILINGUAL_ENGLISH_THEME || path.join(ROOT, '.english-theme'));
const CACHE = path.resolve(process.env.BILINGUAL_CACHE || path.join(ROOT, '.translation-cache'));
const VERSION = 'openrouter-nemotron-en-v1';
const hasChinese = text => /[\u3400-\u9fff]/u.test(text);
const hash = text => crypto.createHash('sha256').update(VERSION + text).digest('hex');
const cached = (cache, text) => cache[hash(text)];
const retryableOpenRouter = error => error instanceof TypeError || error.name === 'AbortError' || error.name === 'TimeoutError' || /OpenRouter (?:HTTP|API) (429|5\d\d)|fetch failed|network|timed? ?out|timeout/iu.test(error.message);
async function translateBatch(items, key, fetchImpl = fetch, googleTranslate = google.translate) {
  if (key) {
    try {
      let outputs;
      for (let attempt = 0; ; attempt++) {
        try { outputs = await openrouter.translate(items, key, fetchImpl); break; }
        catch (error) {
          if (attempt === 0 && retryableOpenRouter(error)) continue;
          throw error;
        }
      }
      return { outputs, provider: 'openrouter', model: openrouter.MODEL };
    } catch (error) {
      logAuthFailure(error);
      console.warn(`OpenRouter failed; trying Google Translate: ${error.message}`);
    }
  }
  const outputs = await googleTranslate(items, fetchImpl);
  return { outputs, provider: 'google', model: 'google-translate-gtx' };
}
function logAuthFailure(error) {
  if (/OpenRouter HTTP (401|403)|API (401|403)/u.test(error.message)) console.warn(`OpenRouter credentials rejected (HTTP ${error.message.match(/(?:HTTP |API )(401|403)/u)?.[1] || '401/403'}); using Google Translate fallback`);
}
const protectedSelector = 'script,style,pre,code,math,mjx-container,.MathJax,.MathJax_Display,.katex,textarea,[translate="no"]';
function scriptSegments(source) {
  const result = [];
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if ((node.type === 'Literal' && typeof node.value === 'string') || node.type === 'TemplateElement') {
      const value = node.type === 'Literal' ? node.value : node.value.raw;
      const texts = [...new Set(value.match(/[\u3400-\u9fff][\u3400-\u9fff\d，。；：、（） ·…/-]*/gu) || [])];
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
      if (node.type === 'text' && hasChinese(node.data)) result.push({ text: node.data.trim(), context: $(el).closest('p,li,h1,h2,h3,h4,blockquote,figcaption').first().text().trim().slice(0, 1000), authoredToc: $(el).closest('.toc-content-container').length > 0, set: text => { node.data = node.data.replace(node.data.trim(), () => text); } });
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
  $('.aden-translation-notice').remove();
  const nav = $('<nav class="aden-language-switch" aria-label="Language"><a lang="zh-CN">中文</a><span> / </span><a lang="en">English</a></nav>');
  nav.find('[lang="zh-CN"]').attr('href', original).attr('aria-current', english ? 'false' : 'page');
  nav.find('[lang="en"]').attr('href', available ? '/en' + original : '/en/').attr('aria-current', english ? 'page' : 'false');
  if (!available && !english) nav.find('[lang="en"]').attr('title', '本页译文暂未生成，查看英文首页');
  const header = $('.navbar-content').first();
  if (header.length) header.append(nav); else $('body').prepend(nav);
  // Each language has its own script/config state. Use normal static navigation.
  // Same-page anchors (table of contents, footnotes) stay with Swup: the theme's APlayer bundle
  // hijacks "#..." links and cannot find headings whose ids are not ASCII, so without Swup
  // the address bar changes but the page never scrolls.
  $('a[href]').filter((_, el) => !/^#./.test($(el).attr('href'))).attr('data-no-swup', '');
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
      el.children?.forEach(n => {
        if (n.type !== 'text') return;
        n.data = n.data.replace(/window\.theme\s*=\s*(\{[^\n]*\});/, (match, json) => {
          const theme = JSON.parse(json);
          if (theme.home_banner?.subtitle) {
            theme.home_banner.subtitle.text = ['Technology, experience and independent thinking', 'Real experiences. A personal perspective.'];
            if (theme.home_banner.subtitle.hitokoto) theme.home_banner.subtitle.hitokoto.enable = false;
          }
          return `window.theme = ${JSON.stringify(theme)};`;
        });
      });
    });
    const notice = $('<p class="aden-translation-notice">Automatically translated. <a>Read the Chinese original</a>.</p>');
    notice.find('a').attr('href', original);
    const content = $('.article-content, .post-content, .home-content-container').first();
    if (content.length) content.prepend(notice); else $('.navbar-container').after(notice);
  }
}
function mergeAuthoredContent(snapshotHtml, currentHtml, authoredUrls, isAuthoredPage) {
  const old = cheerio.load(snapshotHtml);
  const current = cheerio.load(currentHtml);
  if (isAuthoredPage) {
    for (const selector of ['title', 'meta[name="description"]', 'meta[property="og:title"]', 'meta[property="og:description"]', 'meta[property="og:url"]', 'meta[property="article:published_time"]', 'meta[property="article:modified_time"]', 'link[rel="canonical"]', '.article-title-cover, .article-title-regular', '.article-content', '.toc-content-container']) {
      const fresh = current(selector).first();
      if (!fresh.length) continue;
      const target = old(selector).first();
      if (target.length) target.replaceWith(fresh.clone());
      else if (selector.startsWith('meta[') || selector.startsWith('link[')) old('head').append(fresh.clone());
    }
  } else {
    const roots = ['.home-article-item', '.article-item'];
    for (const href of authoredUrls) {
      const freshLink = current('a[href]').filter((_, el) => {
        try { return new URL(current(el).attr('href'), 'https://blog.adenxie.com.cn').pathname.replace(/index\.html$/, '') === href; } catch { return false; }
      }).first();
      const oldLink = old('a[href]').filter((_, el) => {
        try { return new URL(old(el).attr('href'), 'https://blog.adenxie.com.cn').pathname.replace(/index\.html$/, '') === href; } catch { return false; }
      }).first();
      if (!freshLink.length || !oldLink.length) continue;
      const selector = roots.find(s => freshLink.closest(s).length && oldLink.closest(s).length);
      if (selector) oldLink.closest(selector).replaceWith(freshLink.closest(selector).clone());
    }
  }
  return old.html();
}
async function main() {
  fs.mkdirSync(CACHE, { recursive: true });
  const cacheFile = path.join(CACHE, 'segments.json');
  const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};
  const sourcesFile = path.join(CACHE, 'sources.json');
  const sources = fs.existsSync(sourcesFile) ? JSON.parse(fs.readFileSync(sourcesFile, 'utf8')) : {};
  const pages = files(PUBLIC).filter(f => f.endsWith('.html')).map(file => {
    const zhHtml = fs.readFileSync(file, 'utf8');
    const nativeFile = path.join(ENGLISH_THEME, path.relative(PUBLIC, file));
    // Fail safely instead of quietly falling back to machine-translated chrome.
    const $ = cheerio.load(fs.readFileSync(nativeFile, 'utf8'));
    const authored = $('.article-content [data-aden-authored-english="true"]').length > 0;
    const pageSlots = slots($);
    return { file, zhHtml, html: $.html(), $, slots: authored ? pageSlots.filter(slot => !slot.authoredToc) : pageSlots, url: urlFor(file), authored };
  });
  const authoredUrls = new Set(pages.filter(p => p.authored).map(p => p.url.replace(/index\.html$/, '')));
  for (const p of pages) {
    p.authoredRelated = p.authored || p.$('a[href]').toArray().some(el => {
      try { return authoredUrls.has(new URL(p.$(el).attr('href'), 'https://blog.adenxie.com.cn' + p.url).pathname.replace(/index\.html$/, '')); }
      catch { return false; }
    });
  }
  const scripts = ['cyber-weather.js', 'cyber-exchange.js', 'world-time.js'].map(name => {
    const source = fs.readFileSync(path.join(PUBLIC, 'js', name), 'utf8');
    return { name, source, segments: scriptSegments(source) };
  });
  const allSegments = [...scripts.flatMap(s => s.segments.flatMap(n => n.texts.map(text => [text, { text, context: '' }]))), ...pages.flatMap(p => p.slots.map(s => [s.text, s]))];
  const pending = [...new Map(allSegments).values()].filter(item => !cached(cache, item.text));
  const key = process.env.OPENROUTER_API_KEY;
  const budget = Number(process.env.TRANSLATION_CHAR_LIMIT || 160000);
  const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  const usageFile = path.join(CACHE, 'usage.json');
  const previous = fs.existsSync(usageFile) ? JSON.parse(fs.readFileSync(usageFile, 'utf8')) : {};
  let used = previous.day === day ? previous.used : 0, translated = 0, failed = 0;
  const save = () => { fs.writeFileSync(cacheFile, JSON.stringify(cache)); fs.writeFileSync(sourcesFile, JSON.stringify(sources)); fs.writeFileSync(usageFile, JSON.stringify({ day, used })); };
  console.log(`Translation: ${pages.length} pages, ${pending.length} uncached segments; primary OpenRouter, fallback Google Translate; API key ${key ? 'present' : 'absent'}`);
  let next = 0;
  async function worker() {
    while (next < pending.length && failed < 3) {
    const batch = [pending[next++]];
    let length = batch[0].text.length;
    while (next < pending.length && batch.length < 4 && length + pending[next].text.length + 1 < 6000) {
      length += pending[next].text.length + 1; batch.push(pending[next++]);
    }
    if (used + length > budget) return;
    // Count before attempting: uncertain network outcomes must not bypass the cap.
    used += length; save();
    try {
      const { outputs, provider, model } = await translateBatch(batch, key, fetch);
      batch.forEach((item,i) => {
        const id = hash(item.text);
        cache[id] = outputs[i];
        sources[id] = { provider, model, translated_at: new Date().toISOString() };
      });
      translated += batch.length; save();
      console.log(`Translated ${translated}/${pending.length} segments (${provider})`);
    } catch (e) { console.warn(e.message); failed++; }
    }
  }
  await worker();
  const complete = new Set(pages.filter(p => p.slots.every(s => cached(cache, s.text))).map(p => p.url));
  const ready = new Set([...pages.filter(p => p.authored || fs.existsSync(path.join(CACHE, 'pages', path.relative(PUBLIC, p.file)))).map(p => p.url), ...complete]);
  for (const script of scripts) {
    let source = script.source;
    for (const { node, value, texts } of [...script.segments].sort((a,b) => b.node.start - a.node.start)) {
      let translated = value === 'zh-CN' ? 'en-GB' : value;
      for (const text of texts.sort((a,b) => b.length-a.length)) translated = translated.replaceAll(text, cached(cache, text) ?? text);
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
    for (const s of p.slots) if (cached(cache, s.text)) s.set(cached(cache, s.text));
    if (complete.has(p.url)) {
      fs.mkdirSync(path.dirname(snapshot), { recursive: true }); fs.writeFileSync(snapshot, p.$.html());
    }
  }
  for (const p of pages) {
    if (ready.has(p.url)) {
      const snapshot = path.join(CACHE, 'pages', path.relative(PUBLIC, p.file));
      const snapshotHtml = fs.existsSync(snapshot) ? fs.readFileSync(snapshot, 'utf8') : null;
      let selectedHtml;
      if (p.authored) selectedHtml = snapshotHtml ? mergeAuthoredContent(snapshotHtml, p.$.html(), [p.url], true) : p.$.html();
      else if (snapshotHtml && p.authoredRelated) selectedHtml = mergeAuthoredContent(snapshotHtml, p.$.html(), [...authoredUrls], false);
      else selectedHtml = snapshotHtml || p.$.html();
      const en = cheerio.load(selectedHtml);
      en('a[href]').each((_, el) => {
        const href = en(el).attr('href');
        // Same-page anchors must stay "#id": the theme's table of contents looks headings up by it.
        if (href.startsWith('#')) return;
        try {
          const u = new URL(href, 'https://blog.adenxie.com.cn' + p.url);
          const pathname = decodeURI(u.pathname).replace(/index\.html$/, '');
          const target = ready.has(pathname) ? pathname : ready.has(pathname + '/') ? pathname + '/' : null;
          if (u.origin === 'https://blog.adenxie.com.cn' && target) en(el).attr('href', '/en' + encodeURI(target) + u.search + u.hash);
        } catch (_) { /* Non-web links stay unchanged. */ }
      });
      decorate(en, p.url, true, true);
      if (!p.authored && !p.slots.every(s => cached(cache, s.text))) en('.aden-translation-notice').prepend('This translation may be older than the Chinese original. ');
      if (p.authored) {
        const needsReview = en('[data-aden-needs-review="true"]').length > 0;
        en('.aden-translation-notice').text(needsReview ? 'The Chinese original has changed. Please review this English copy. ' : 'English copy edited independently. Review it when the Chinese original changes. ').append('<a>Read the Chinese original</a>').find('a').attr('href', p.url);
      }
      const out = path.join(PUBLIC, 'en', path.relative(PUBLIC, p.file));
      fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, en.html());
    }
    const zh = cheerio.load(p.zhHtml);
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
module.exports = { slots, hash, decorate, scriptSegments, cached, mergeAuthoredContent, translateBatch, main };
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
