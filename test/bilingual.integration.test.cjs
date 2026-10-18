'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const cheerio = require('cheerio');
const { latestPosts } = require('../tools/build-latest-posts.cjs');
const { slots, hash } = require('../tools/build-bilingual.cjs');

const REPO = path.resolve(__dirname, '..');
function write(root, name, content) {
  const file = path.join(root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function runHexo(root, args) {
  const result = spawnSync(process.execPath, [path.join(REPO, 'node_modules/hexo/bin/hexo'), ...args], {
    cwd: root,
    env: { ...process.env, NODE_PATH: path.join(REPO, 'node_modules'), TZ: 'Asia/Shanghai' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

test('Hexo authored translation overrides old snapshots and stays aligned across site outputs', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'myblog-bilingual-'));
  t.after(() => {
    if (process.env.KEEP_BILINGUAL_FIXTURE !== '1') {
      const link = path.join(root, 'node_modules');
      if (fs.existsSync(link)) fs.rmSync(link, { force: true });
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  const chinese = `---\ntitle: 校订稿测试原文\ndate: 2026-10-18 12:00:00\nslug: authored-fixture\ndescription: 中文摘要。\n---\n\n中文正文。\n\n## 中文章节\n\n链接 [原文](https://example.org/source)。\n`;
  const sourceHash = crypto.createHash('sha256').update(chinese).digest('hex');
  const staleHash = sourceHash === '0'.repeat(64) ? '1'.repeat(64) : '0'.repeat(64);
  const authored = `---\ntitle: Current English title\ndescription: Current English summary.\nsource_hash: "${staleHash}"\n---\n\nCurrent English body with a preserved [source link](https://example.org/source) and 引用原文。\n\n<!--more-->\n\n## English section\n\nCurrent authored section.\n`;
  write(root, 'source/_posts/authored-fixture.md', chinese);
  write(root, 'translations/en/authored-fixture.md', authored);
  write(root, '_config.yml', `title: Fixture Blog\nlanguage: zh-CN\ntimezone: Asia/Shanghai\nfuture: true\nurl: https://blog.adenxie.com.cn\nroot: /\npermalink: :year/:month/:day/:slug/\nsource_dir: source\npublic_dir: public\ntheme: fixture\ndefault_layout: post\n`);
  write(root, '_config.english.yml', 'language: en\npublic_dir: .english-theme\n');
  write(root, 'package.json', JSON.stringify({ name: 'fixture', version: '1.0.0', private: true, hexo: { version: '7.3.0' }, dependencies: { hexo: '7.3.0', 'hexo-generator-index': '4.0.0', 'hexo-renderer-ejs': '2.0.0', 'hexo-renderer-marked': '7.0.0' } }));
  fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(root, 'node_modules'), 'junction');
  write(root, 'themes/fixture/_config.yml', 'navbar:\n  links:\n    首页: /\n');
  write(root, 'themes/fixture/layout/post.ejs', `<!doctype html><html lang="<%= config.language %>"><head><title><%= page.title %> | Fixture Blog</title><link rel="canonical" href="/<%= page.path %>"><meta name="description" content="<%= page.description %>"><meta property="og:url" content="/<%= page.path %>"><meta property="og:title" content="<%= page.title %>"><meta property="og:description" content="<%= page.description %>"><meta property="article:published_time" content="<%= page.date.toISOString() %>"><meta property="article:modified_time" content="<%= page.updated.toISOString() %>"></head><body><header>未翻译的 UI</header><main><h1 class="article-title-regular"><%= page.title %></h1><div class="article-content"><%- page.content %></div><nav class="toc-content-container"><%- toc(page.content, { list_number: false }) %></nav></main></body></html>`);
  write(root, 'themes/fixture/layout/index.ejs', `<!doctype html><html lang="<%= config.language %>"><head><title>Fixture homepage</title></head><body><header>未翻译的 UI</header><ul><% site.posts.toArray().forEach(post => { %><li class="home-article-item"><a href="/<%= post.path %>"><%= post.title %></a><div class="home-article-content"><%- render(post.excerpt, "markdown") %></div></li><% }); %></ul></body></html>`);
  write(root, 'themes/fixture/layout/archive.ejs', `<!doctype html><html lang="<%= config.language %>"><head><title>Fixture archive</title></head><body><header>未翻译的 UI</header><% site.posts.toArray().forEach(post => { %><div class="article-item"><a href="/<%= post.path %>"><%= post.title %></a><div><%- render(post.excerpt, "markdown") %></div></div><% }); %></body></html>`);
  write(root, 'source/archive/index.md', '---\ntitle: Archive\nlayout: archive\n---\n');
  write(root, 'source/other/index.md', '---\ntitle: Other page\nlayout: archive\n---\n');
  for (const name of ['cyber-weather.js', 'cyber-exchange.js', 'world-time.js']) write(root, `source/js/${name}`, 'const message = "天气";\n');
  write(root, 'scripts/english-theme.js', fs.readFileSync(path.join(REPO, 'scripts/english-theme.js'), 'utf8'));

  runHexo(root, ['generate']);
  runHexo(root, ['generate', '--config', '_config.yml,_config.english.yml', '--force']);
  assert.ok(fs.existsSync(path.join(root, 'public')), `Hexo fixture output missing under ${root}; contents: ${fs.readdirSync(root).join(', ')}`);
  const cache = path.join(root, '.translation-cache');
  fs.mkdirSync(path.join(cache, 'pages', '2026/10/18/authored-fixture'), { recursive: true });
  fs.mkdirSync(path.join(cache, 'pages', 'archive'), { recursive: true });
  fs.mkdirSync(path.join(cache, 'pages', 'other'), { recursive: true });
  fs.writeFileSync(path.join(cache, 'segments.json'), '{}');
  fs.writeFileSync(path.join(cache, 'pages', 'index.html'), '<html><body><header>Today\'s pick</header><ul><li class="home-article-item"><a href="/2026/10/18/authored-fixture/">Stale title</a><p>Stale summary</p></li></ul></body></html>');
  fs.writeFileSync(path.join(cache, 'pages', 'archive/index.html'), '<html><body><div class="article-item"><a href="/2026/10/18/authored-fixture/">Stale title</a><p>Stale summary</p></div></body></html>');
  fs.writeFileSync(path.join(cache, 'pages', 'other/index.html'), '<html><body><p>Retained fully translated snapshot</p></body></html>');
  fs.writeFileSync(path.join(cache, 'pages', '2026/10/18/authored-fixture/index.html'), '<html><head><title>Stale title</title><meta name="description" content="Stale summary"></head><body><header>Translated header</header><h1 class="article-title-cover">Stale title</h1><div class="article-content">Stale body</div><nav class="toc-content-container">Stale TOC</nav></body></html>');

  const testKey = 'fixture-key-must-not-appear-in-logs';
  const env = { ...process.env, BILINGUAL_ROOT: root, BILINGUAL_PUBLIC: path.join(root, 'public'), BILINGUAL_ENGLISH_THEME: path.join(root, '.english-theme'), BILINGUAL_CACHE: cache, OPENROUTER_API_KEY: testKey };
  const builder = JSON.stringify(path.join(REPO, 'tools/build-bilingual.cjs'));
  const bilingual = spawnSync(process.execPath, ['-e', `global.fetch = async () => ({ ok: false, status: 429 }); require(${builder}).main()`], { cwd: root, env, encoding: 'utf8' });
  assert.equal(bilingual.status, 0, `${bilingual.stdout}\n${bilingual.stderr}`);
  assert.match(`${bilingual.stdout}\n${bilingual.stderr}`, /OpenRouter HTTP 429/);
  assert.doesNotMatch(`${bilingual.stdout}\n${bilingual.stderr}`, new RegExp(testKey));

  const englishArticlePath = path.join(root, 'public/en/2026/10/18/authored-fixture/index.html');
  const article = cheerio.load(fs.readFileSync(englishArticlePath, 'utf8'));
  assert.match(article('title').text(), /Current English title/);
  assert.equal(article('meta[name="description"]').attr('content'), 'Current English summary.');
  assert.equal(article('link[rel="canonical"]').attr('href'), 'https://blog.adenxie.com.cn/en/2026/10/18/authored-fixture/');
  assert.equal(article('meta[property="og:url"]').attr('content'), 'https://blog.adenxie.com.cn/en/2026/10/18/authored-fixture/');
  assert.ok(article('meta[property="article:published_time"]').attr('content'));
  assert.ok(article('meta[property="article:modified_time"]').attr('content'));
  assert.match(article('.article-content').text(), /Current English body/);
  assert.match(article('.article-content').text(), /引用原文/);
  assert.match(article('.toc-content-container').text(), /English section/);
  assert.equal(article('.article-content a[href="https://example.org/source"]').attr('href'), 'https://example.org/source');
  assert.match(article('.aden-translation-notice').text(), /Chinese original has changed/);
  assert.match(article('header').text(), /Translated header/);

  const home = cheerio.load(fs.readFileSync(path.join(root, 'public/en/index.html'), 'utf8'));
  assert.match(home('.home-article-item').text(), /Current English titleCurrent English body/);
  assert.match(home('.home-article-item').text(), /引用原文/);
  assert.doesNotMatch(home('.home-article-item').text(), /Current English summary/);
  assert.doesNotMatch(home('.home-article-item').text(), /Stale/);
  assert.match(home('header').text(), /Today.s pick/);
  const archive = cheerio.load(fs.readFileSync(path.join(root, 'public/en/archive/index.html'), 'utf8'));
  assert.match(archive('.article-item').text(), /Current English titleCurrent English body/);
  assert.match(archive('.article-item').text(), /引用原文/);
  assert.doesNotMatch(archive('.article-item').text(), /Stale/);
  assert.match(fs.readFileSync(path.join(cache, 'pages/other/index.html'), 'utf8'), /Retained fully translated snapshot/);
  assert.match(fs.readFileSync(path.join(root, 'public/en/other/index.html'), 'utf8'), /Retained fully translated snapshot/);

  const search = fs.readFileSync(path.join(root, 'public/en/search.xml'), 'utf8');
  assert.match(search, /Current English title/);
  assert.match(search, /Current English body/);
  assert.match(fs.readFileSync(path.join(root, 'public/2026/10/18/authored-fixture/index.html'), 'utf8'), /中文正文/);
  assert.deepEqual(latestPosts(path.join(root, 'public/en'), '/en').map(post => post.title), ['Current English title']);
  assert.equal(fs.readFileSync(path.join(cache, 'pages', '2026/10/18/authored-fixture/index.html'), 'utf8').includes('Stale body'), true);

  // A reviewed post must not freeze unrelated homepage updates once the
  // surrounding machine-translated segments become complete.
  const nativeHomePath = path.join(root, '.english-theme/index.html');
  const currentHome = cheerio.load(fs.readFileSync(nativeHomePath, 'utf8'));
  currentHome('body').append('<section data-new-home-content>New unrelated homepage content</section>');
  const segmentCache = {};
  for (const slot of slots(currentHome)) segmentCache[hash(slot.text)] = 'Current translated UI';
  fs.writeFileSync(nativeHomePath, currentHome.html());
  fs.writeFileSync(path.join(cache, 'segments.json'), JSON.stringify(segmentCache));
  const refreshed = spawnSync(process.execPath, ['-e', `global.fetch = async () => ({ ok: false, status: 429 }); require(${builder}).main()`], { cwd: root, env, encoding: 'utf8' });
  assert.equal(refreshed.status, 0, `${refreshed.stdout}\n${refreshed.stderr}`);
  const refreshedHome = cheerio.load(fs.readFileSync(path.join(root, 'public/en/index.html'), 'utf8'));
  assert.equal(refreshedHome('[data-new-home-content]').text(), 'New unrelated homepage content');
  assert.match(refreshedHome('.home-article-item').text(), /Current English title/);
  assert.match(fs.readFileSync(path.join(cache, 'pages/index.html'), 'utf8'), /New unrelated homepage content/);
});
