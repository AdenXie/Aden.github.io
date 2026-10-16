const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { latestPosts, buildLatestPosts } = require('../tools/build-latest-posts.cjs');

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
