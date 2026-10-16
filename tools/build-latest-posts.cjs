'use strict';
// Small per-language feeds for other sites (e.g. adenxie.com.cn), so they need not download search.xml.
const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');
const SITE = 'https://blog.adenxie.com.cn';
const LIMIT = 5;
function postFiles(root) {
  const result = [];
  const walk = (dir, depth) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      // Permalink is :year/:month/:day/:title/.
      if (depth < 3 && !/^\d+$/.test(e.name)) continue;
      const next = path.join(dir, e.name);
      if (depth === 3) { if (fs.existsSync(path.join(next, 'index.html'))) result.push(path.join(next, 'index.html')); } else walk(next, depth + 1);
    }
  };
  if (fs.existsSync(root)) walk(root, 0);
  return result;
}
function latestPosts(root, prefix = '', limit = LIMIT) {
  return postFiles(root).map(file => {
    const $ = cheerio.load(fs.readFileSync(file, 'utf8'));
    const title = ($('meta[property="og:title"]').attr('content') || $('title').text().replace(/\s*\|\s*Aden's Space\s*$/, '')).trim();
    const date = $('meta[property="article:published_time"]').attr('content');
    const url = SITE + prefix + '/' + path.relative(root, path.dirname(file)).replaceAll('\\', '/') + '/';
    return { title, date, url };
  }).filter(p => p.title && p.date).sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
}
function buildLatestPosts(publicDir = path.resolve(__dirname, '../public')) {
  const generatedAt = new Date().toISOString();
  for (const [lang, dir, prefix] of [['zh-CN', publicDir, ''], ['en', path.join(publicDir, 'en'), '/en']]) {
    const posts = latestPosts(dir, prefix);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'latest-posts.json'), JSON.stringify({ schemaVersion: 1, lang, generatedAt, posts }, null, 2));
    console.log(`latest-posts.json (${lang}): ${posts.length} posts`);
  }
}
module.exports = { latestPosts, buildLatestPosts };
if (require.main === module) buildLatestPosts(process.argv[2] && path.resolve(process.argv[2]));
