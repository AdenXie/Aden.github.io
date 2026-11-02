'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const cheerio = require('cheerio');
const { postFiles, readPosts } = require('./build-latest-posts.cjs');
function checkOutput(directory = 'public') {
  const root = path.resolve(directory);
  assert(fs.existsSync(path.join(root, 'README.md')), 'Missing generated main-branch README');
  for (const file of ['LICENSE', 'LICENSE-CONTENT.md', 'LICENSES/CC-BY-NC-SA-4.0.txt']) assert(fs.existsSync(path.join(root, file)), `Missing licence document: ${file}`);
  const files = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]);
  assert.equal(files(root).filter(file => file.endsWith('.map')).length, 0, 'Production output contains source maps');
  const exists = url => {
    if (!url?.startsWith('/') || url.startsWith('//')) return;
    const filename = path.join(root, decodeURI(url.split(/[?#]/)[0]));
    assert(fs.existsSync(filename), `Missing generated resource: ${url}`);
  };
  assert(!fs.existsSync(path.join(root, 'chat')) && !fs.existsSync(path.join(root, 'en/chat')), 'Retired chat page was generated');
  for (const dir of ['', 'en']) {
    const feed = JSON.parse(fs.readFileSync(path.join(root, dir, 'latest-posts.json'), 'utf8'));
    assert(feed.posts.length > 0 && feed.posts.every(p => p.title && p.date && p.url.startsWith('https://blog.adenxie.com.cn/')), `Invalid ${dir}/latest-posts.json`);
    assert(feed.latestBrief?.url?.startsWith('https://blog.adenxie.com.cn/'), `${dir}/latest-posts.json lacks the latest brief`);
    // Home page 1 carries the brief strip; the article list itself has no briefs.
    const $home = cheerio.load(fs.readFileSync(path.join(root, dir, 'index.html'), 'utf8'));
    assert.equal($home('.aden-brief-strip').length, 1, `${dir}/index.html brief strip`);
    exists($home('.aden-brief-strip a.aden-brief-latest').attr('href'));
  }
  // A theme error during rendering leaves a post page without title or date (Hexo logs it but
  // still writes the page), which also hides that post from latest-posts.json.
  for (const dir of ['', 'en']) {
    const pageDir = path.join(root, dir);
    const readable = new Set(readPosts(pageDir).map(p => p.url));
    for (const file of postFiles(pageDir)) {
      const url = 'https://blog.adenxie.com.cn/' + path.relative(pageDir, path.dirname(file)).replaceAll('\\', '/') + '/';
      assert(readable.has(url), `${file}: post page has no title or date (failed render?)`);
    }
  }
  // Daily briefs, found from their own pages, must not appear in the home article list.
  const briefPaths = new Set([['', ''], ['en', '/en']].flatMap(([dir, prefix]) => readPosts(path.join(root, dir), prefix).filter(p => p.brief).map(p => new URL(p.url).pathname)));
  assert(briefPaths.size > 0, 'No daily briefs found');
  // 3D scenes load by URL from scene-loader.js and import three.js by URL, so a
  // renamed file or a three.js upgrade would only fail in the browser.
  for (const scene of ['saturn', 'store']) {
    const file = path.join(root, 'js/scenes', `${scene}.js`);
    assert(fs.existsSync(file), `Missing scene ${scene}`);
    for (const [, url] of fs.readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)) exists(url);
  }
  exists('/js/scene-loader.js');
  let pages = 0;
  for (const file of files(root).filter(f => f.endsWith('.html'))) {
    const $ = cheerio.load(fs.readFileSync(file, 'utf8')); pages++;
    $('script[src],link[rel="stylesheet"],img[src^="/"]').each((_, el) => exists($(el).attr(el.tagName === 'link' ? 'href' : 'src')));
    assert.equal($('script[src*="hexo-theme-redefine@"],link[href*="hexo-theme-redefine@"]').length, 0);
    assert.equal($('script[src*="/js/site-runtime.js"]').length, 1, file);
    assert.equal($('script[src*="/js/language-preference.js"]').length, 1, file);
    assert.equal($('script[data-aden-analytics]').length, 1, file);
    assert.equal($('.aden-font-credit a[href="https://hyperos.mi.com/font/zh/download/"]').length, 1, `${file}: missing MiSans credit`);
    assert.equal($('.aden-license-notice a[rel="license"][href="https://creativecommons.org/licenses/by-nc-sa/4.0/"]').length, 1, `${file}: missing content licence`);
    assert.equal($('.aden-license-notice a[href="https://github.com/AdenXie/Aden.github.io/blob/main/LICENSE"]').length, 1, `${file}: missing code licence`);
    const copyright = $('.article-copyright-info-container').not('[data-aden-custom-license]');
    if (copyright.length) assert(!/版权所有 © AdenXie，禁止转载。|All Rights Reserved © AdenXie/.test(copyright.text()), `${file}: stale all-rights-reserved notice`);
    assert.equal($('link[rel="preconnect"][href="https://cdn-file.hyperos.mi.com"][crossorigin]').length, 1, `${file}: missing font preconnect`);
    assert(!/"preload":true/.test($.html()), `Eager search in ${file}`);
    if (!$('#world-time').length) assert.equal($('script[src*="/world-time.js"]').length, 0);
    // Chat: one launcher per page, assets deferred until it is used, no trace of the retired page.
    assert.equal($('script[src*="/js/chat.js"],link[href*="/css/chat.css"],#aden-chat').length, 0, file);
    assert.equal($('a[href$="/chat/"]').length, 0, file);
    const launcher = $('body > #aden-chat-launcher[hidden]');
    assert.equal(launcher.length, 1, file);
    assert.equal(launcher.attr('aria-label'), $('html').attr('lang')?.startsWith('en') ? 'Open AI chat' : '打开 AI 聊天', file);
    assert.match(launcher.attr('data-script'), /^\/js\/chat\.js\?v=[a-f0-9]{12}$/, file);
    assert.match(launcher.attr('data-style'), /^\/css\/chat\.css\?v=[a-f0-9]{12}$/, file);
    exists(launcher.attr('data-script')); exists(launcher.attr('data-style'));
    const home = $('.home-content-container').not('.aden-daily .home-content-container');
    if (!home.length) assert.equal($('script[src*="cyber-weather.js"],script[src*="cyber-exchange.js"]').length, 0);
    assert.equal($('script[src*="cdnjs.cloudflare.com/ajax/libs/twikoo"]').length, 0);
    if ($('.home-banner-background').length) assert.equal($('link[data-aden-hero]').length, 1, file);
    // Chinese only: when translation is unavailable an English page keeps its previous
    // snapshot, which must not block the Chinese release.
    if (!$('html').attr('lang')?.startsWith('en')) home.find('.home-article-title a').each((_, el) => assert(!briefPaths.has($(el).attr('href')), `${file}: daily brief in the home list`));
    assert.equal($('a[href$="/categories/daily/"]').length, 0, `${file}: link to the redirected brief category`);
    assert.equal($('.markdown-body > table:not(.not-markdown)').length, 0, `${file}: article table without scroll frame`);
    // Later home pages keep only the blurred fixed background, without the banner itself.
    if ($('.home-banner-container').length) {
      const english = $('html').attr('lang')?.startsWith('en');
      assert.equal($('.home-banner-actions .home-project-link').length, 1, file);
      assert.deepEqual($('.home-banner-actions .home-project-link').map((_, el) => $(el).attr('href')).get(),
        [english ? 'https://adenxie.com.cn/en/' : 'https://adenxie.com.cn/'], file);
      assert.deepEqual($('.home-banner-actions .home-project-link span').map((_, el) => $(el).html()).get(),
        [english ? 'My homepage' : '我的主页'], file);
      assert.deepEqual($('.home-banner-actions .home-project-link').map((_, el) => $(el).attr('aria-label')).get(),
        [english ? 'Visit my homepage' : '访问我的主页'], file);
    }
    // Keyboard entry points: the hero route, search and menu are real controls with names.
    if ($('.home-banner-container').length) {
      assert.equal($('.home-banner-container a.aden-read-route[href="#home-articles"]').length, 1, `${file}: hero route to the post list`);
      assert.equal($('#home-articles').length, 1, `${file}: post list anchor`);
      assert.equal($('button.navbar-bar[aria-controls="navbar-drawer"][aria-expanded="false"][aria-label]').length, 1, `${file}: menu button`);
      assert.equal($('#navbar-drawer').length, 1, `${file}: menu drawer`);
      assert.equal($('.search-popup-trigger').not('button').length, 0, `${file}: search trigger is not a button`);
      assert.equal($('.search-popup-trigger[aria-label]').length, 2, `${file}: named search buttons`);
      // The sidebar copies (文章归档, 主题标签, 关于 Aden) repeat navbar pages on the mobile menu.
      const drawerText = $('#navbar-drawer .drawer-navbar-list').text();
      for (const duplicate of ['文章归档', '主题标签', '关于 Aden']) assert(!drawerText.includes(duplicate), `${file}: duplicate menu row ${duplicate}`);
    }
    // Excerpt headings stay below the card title (h3) on the home list only.
    for (const heading of $('.aden-home-list .home-article-content h1, .aden-home-list .home-article-content h2, .aden-home-list .home-article-content h3').toArray()) assert.fail(`${file}: excerpt heading above card title level`);
  }
  const siteCSS = files(path.join(root, 'css')).filter(f => /site-.*\.css$/.test(f));
  for (const file of siteCSS) {
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/url\(["']?(\/[^)'"\s]+)/g)) exists(match[1]);
  }
  // MiSans uses the official, content-addressed Unicode slices without modifying font files.
  for (const file of siteCSS) {
    const css = fs.readFileSync(file, 'utf8');
    assert(/font-family:["']?MiSans VF/.test(css), `${file}: missing MiSans`);
    assert(css.includes('https://cdn-file.hyperos.mi.com/mi-font-service/misans_vf/'), `${file}: missing official MiSans slices`);
    assert(css.includes('unicode-range:'), `${file}: missing on-demand font ranges`);
    assert(!/Newsreader|Plus Jakarta Sans|Aden Han|Geist Variable/.test(css), `${file}: retired prose font remains`);
    assert(css.includes('Chillax-Variable'), `${file}: missing theme branding font`);
  }
  for (const family of ['reading', 'Geist']) assert(!fs.existsSync(path.join(root, 'fonts', family)), `Retired font directory: ${family}`);
  assert(fs.existsSync(path.join(root, 'fonts/Chillax/Chillax-Variable.woff2')), 'Missing theme branding font');
  console.log(`Verified ${pages} pages: local asset paths, scoped scripts, lazy search, comment wiring and reading fonts.`);
  return pages;
}
module.exports = { checkOutput };
if (require.main === module) checkOutput(process.argv[2]);
