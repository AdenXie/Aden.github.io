const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { latestPosts, buildLatestPosts } = require('../tools/build-latest-posts.cjs');
const { injectBriefStrip, headline, recent } = require('../tools/lib/brief-strip.cjs');

function page(root, rel, title, date) {
  const dir = path.join(root, rel);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), `<html><head><meta property="og:title" content="${title}"><meta property="article:published_time" content="${date}"></head></html>`);
}
test('latest posts are newest first, per language, and skip non-post pages', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'latest-'));
  page(root, '2026/10/01/a', 'A &amp; B', '2026-10-01T00:00:00.000Z');
  page(root, '2026/10/03/c', '“C”', '2026-10-03T00:00:00.000Z');
  page(root, '2026/09/30/b', 'B', '2026-09-30T00:00:00.000Z');
  page(root, 'about', 'About', '2026-10-05T00:00:00.000Z');
  page(root, 'en/2026/10/01/a', 'A in English', '2026-10-01T00:00:00.000Z');
  assert.deepEqual(latestPosts(root, '', 2), [
    { title: '“C”', date: '2026-10-03T00:00:00.000Z', url: 'https://blog.adenxie.com.cn/2026/10/03/c/' },
    { title: 'A & B', date: '2026-10-01T00:00:00.000Z', url: 'https://blog.adenxie.com.cn/2026/10/01/a/' },
  ]);
  buildLatestPosts(root);
  const en = JSON.parse(fs.readFileSync(path.join(root, 'en/latest-posts.json'), 'utf8'));
  assert.equal(en.lang, 'en');
  assert.deepEqual(en.posts.map(p => p.url), ['https://blog.adenxie.com.cn/en/2026/10/01/a/']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'latest-posts.json'), 'utf8')).posts.length, 3);
});

test('briefs leave the article feed and the home list, and get their own strip', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'briefs-'));
  const brief = '<span class="article-categories"><a href="/categories/daily/">每日简报</a></span>';
  const write = (rel, title, date, extra = '') => {
    fs.mkdirSync(path.join(root, rel), { recursive: true });
    // Every page links the brief category from the navbar; only the article meta counts.
    fs.writeFileSync(path.join(root, rel, 'index.html'), `<html><head><meta property="og:title" content="${title}"><meta property="article:published_time" content="${date}"></head><body><nav><a href="/categories/daily/">简报</a></nav>${extra}</body></html>`);
  };
  write('2026/10/20/b1', '每日简报｜2026-10-20：旧', '2026-10-20T01:00:00.000Z', brief);
  write('2026/10/22/b3', '每日简报｜2026-10-22：主线', '2026-10-22T01:00:00.000Z', brief);
  write('2026/10/21/b2', '每日简报｜2026-10-21：中', '2026-10-21T01:00:00.000Z', brief);
  write('2026/10/18/b0', '每日简报｜2026-10-18：更早', '2026-10-18T01:00:00.000Z', brief);
  write('2026/10/19/a', '一篇文章', '2026-10-19T01:00:00.000Z');
  assert.deepEqual(latestPosts(root).map(p => p.title), ['一篇文章']);
  fs.writeFileSync(path.join(root, 'index.html'), '<html><body><div class="home-content-container"><ul class="home-article-list"></ul></div></body></html>');
  injectBriefStrip(root);
  injectBriefStrip(root);
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.equal((html.match(/class="aden-brief-strip"/g) || []).length, 1);
  assert.match(html, /href="\/2026\/10\/22\/b3\/"><time datetime="[^"]+">10-22<\/time><span class="aden-brief-title">主线<\/span>/);
  assert.match(html, /共 4 期 · 近 30 天 4 期/);
  assert.ok(html.indexOf('aden-brief-strip') < html.indexOf('home-article-list'));
  assert.equal(headline('Daily Brief | 2026-10-22: Talks resume'), 'Talks resume');
  assert.equal(recent(['2026-10-22T01:00:00.000Z', '2026-10-21T01:00:00.000Z', '2026-09-23T01:00:00.000Z', '2026-09-22T01:00:00.000Z']), 3);
});
