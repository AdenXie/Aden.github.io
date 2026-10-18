'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const yaml = require('js-yaml');

const authoredUrls = new Set();
const reviewUrls = new Set();
function authoredEnglishPage(url) { return authoredUrls.has(url); }

// Use Redefine's own locale keys for menus when rendering the English shell.
// These are site configuration labels, not article content.
hexo.extend.filter.register('before_generate', async function () {
  if (this.config.language !== 'en') return;
  authoredUrls.clear();
  reviewUrls.clear();
  const authoredDir = path.resolve(this.base_dir, 'translations/en');
  if (fs.existsSync(authoredDir)) {
    for (const post of this.model('Post').toArray()) {
      const sourceName = path.basename(post.source || post.full_source || '', '.md');
      const file = path.join(authoredDir, `${sourceName}.md`);
      if (!sourceName || !fs.existsSync(file)) continue;
      const raw = fs.readFileSync(file, 'utf8');
      const match = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/);
      if (!match) throw new Error(`Invalid English translation front matter: ${file}`);
      const front = yaml.load(match[1]) || {};
      if (!front.title || !front.description || typeof front.source_hash !== 'string' || !/^[a-f\d]{64}$/i.test(front.source_hash)) throw new Error(`English translation requires title, description and a 64-character SHA-256 source_hash: ${file}`);
      const sourceFile = path.resolve(this.base_dir, 'source/_posts', `${sourceName}.md`);
      const sourceText = fs.readFileSync(sourceFile, 'utf8').replace(/\r\n?/g, '\n');
      const currentHash = crypto.createHash('sha256').update(sourceText).digest('hex');
      post.title = front.title;
      post.description = front.description;
      post._content = match[2];
      post.content = match[2];
      delete post.excerpt;
      delete post.more;
      authoredUrls.add(`/${post.path}`.replace(/\/{2,}/g, '/'));
      if (front.source_hash !== currentHash) reviewUrls.add(`/${post.path}`.replace(/\/{2,}/g, '/'));
      await this.post.render(post.full_source, post);
      await post.save();
    }
  }
  const keys = { '首页': 'home', '归档': 'archives', '标签': 'tags', '关于': 'about', '友链': 'links', '世界时间': 'World Time' };
  const links = this.theme.config.navbar.links;
  this.theme.config.navbar.links = Object.fromEntries(Object.entries(links).map(([name, value]) => [keys[name] || name, value]));
}, 5);

hexo.extend.filter.register('after_post_render', function (data) {
  if (this.config.language !== 'en' || !authoredEnglishPage(`/${data.path}`.replace(/\/{2,}/g, '/'))) return data;
  const review = reviewUrls.has(`/${data.path}`.replace(/\/{2,}/g, '/')) ? ' data-aden-needs-review="true"' : '';
  data.content = `<div translate="no" data-aden-authored-english="true"${review}>${data.content}</div>`;
  if (typeof data.excerpt === 'string' && !data.excerpt.trim()) data.excerpt = data.description || '';
  if (typeof data.excerpt === 'string' && data.excerpt) data.excerpt = `<div translate="no" data-aden-authored-summary="true">${data.excerpt}</div>`;
  return data;
}, 11);
