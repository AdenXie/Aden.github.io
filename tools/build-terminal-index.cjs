'use strict';
// The site terminal's file system (source/js/terminal.js): every post's title, path, date,
// categories, tags and a short description, per language. Loaded only when the terminal opens,
// so it stays far smaller than search.xml.
const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');
const { postFiles } = require('./build-latest-posts.cjs');

const clip = (text, max) => {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? clean.slice(0, max - 1) + '…' : clean;
};

function readIndex(root, prefix) {
  return postFiles(root).map(file => {
    const $ = cheerio.load(fs.readFileSync(file, 'utf8'));
    const title = ($('meta[property="og:title"]').attr('content') || '').trim();
    const url = prefix + '/' + path.relative(root, path.dirname(file)).replaceAll('\\', '/') + '/';
    // The permalink carries the Beijing date; published_time is UTC.
    const date = (url.match(/\/(\d{4})\/(\d{2})\/(\d{2})\//) || []).slice(1).join('-');
    const categories = $('.article-categories a').map((_, a) => $(a).text().trim()).get().filter(Boolean);
    const tags = $('meta[property="article:tag"]').map((_, m) => $(m).attr('content')).get().filter(Boolean);
    const brief = $('.article-categories a[href$="/daily/"]').length > 0;
    return { t: title, u: url, d: date, c: [...new Set(categories)], g: [...new Set(tags)], b: brief || undefined,
      s: clip($('.article-content p').filter((_, p) => $(p).text().trim().length > 20).first().text(), 100) };
  }).filter(post => post.t && post.d).sort((a, b) => b.d.localeCompare(a.d) || a.u.localeCompare(b.u));
}

function buildTerminalIndex(publicDir = path.resolve(__dirname, '../public')) {
  for (const [dir, prefix] of [[publicDir, ''], [path.join(publicDir, 'en'), '/en']]) {
    const posts = readIndex(dir, prefix);
    fs.writeFileSync(path.join(dir, 'terminal-index.json'), JSON.stringify({ schemaVersion: 1, posts }));
    console.log(`terminal-index.json (${prefix || 'zh'}): ${posts.length} posts`);
  }
}

module.exports = { buildTerminalIndex, readIndex };
if (require.main === module) buildTerminalIndex(process.argv[2] && path.resolve(process.argv[2]));
