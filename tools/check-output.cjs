'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const cheerio = require('cheerio');
function checkOutput(directory = 'public') {
  const root = path.resolve(directory);
  assert(fs.existsSync(path.join(root, 'README.md')), 'Missing generated main-branch README');
  const files = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]);
  assert.equal(files(root).filter(file => file.endsWith('.map')).length, 0, 'Production output contains source maps');
  const exists = url => {
    if (!url?.startsWith('/') || url.startsWith('//')) return;
    const filename = path.join(root, decodeURI(url.split(/[?#]/)[0]));
    assert(fs.existsSync(filename), `Missing generated resource: ${url}`);
  };
  let pages = 0;
  for (const file of files(root).filter(f => f.endsWith('.html'))) {
    const $ = cheerio.load(fs.readFileSync(file, 'utf8')); pages++;
    $('script[src],link[rel="stylesheet"],img[src^="/"]').each((_, el) => exists($(el).attr(el.tagName === 'link' ? 'href' : 'src')));
    assert.equal($('script[src*="hexo-theme-redefine@"],link[href*="hexo-theme-redefine@"]').length, 0);
    assert.equal($('script[src*="/js/site-runtime.js"]').length, 1, file);
    assert(!/"preload":true/.test($.html()), `Eager search in ${file}`);
    if (!$('#world-time').length) assert.equal($('script[src*="/world-time.js"]').length, 0);
    if (!$('#aden-chat').length) assert.equal($('script[src*="/js/chat.js"],link[href*="/css/chat.css"]').length, 0);
    else assert.match($('#aden-chat h2').text(), $('html').attr('lang')?.startsWith('en') ? /What/ : /想聊/);
    if (!$('.home-content-container').length) assert.equal($('script[src*="cyber-weather.js"],script[src*="cyber-exchange.js"]').length, 0);
    assert.equal($('script[src*="cdnjs.cloudflare.com/ajax/libs/twikoo"]').length, 0);
    if ($('.home-banner-background').length) assert.equal($('link[data-aden-hero]').length, 1);
  }
  for (const file of files(path.join(root, 'css')).filter(f => /site-.*\.css$/.test(f))) {
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/url\(["']?(\/[^)'"\s]+)/g)) exists(match[1]);
  }
  console.log(`Verified ${pages} pages: local asset paths, scoped scripts, lazy search and comment wiring.`);
  return pages;
}
module.exports = { checkOutput };
if (require.main === module) checkOutput(process.argv[2]);
