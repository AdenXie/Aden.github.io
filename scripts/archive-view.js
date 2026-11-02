'use strict';

// Archive and category pages: a title, then year and month sections with one line per post
// (archive, and each category's own list), and a card grid for the category index. The views live
// in lib/views and replace the theme's views at generation time, as scripts/brief-split.js does for
// the daily section. Tags, the daily list and the other shared post lists keep the theme's markup.
const fs = require('node:fs');
const path = require('node:path');

const VIEWS = {
  'pages/archive/archive.ejs': 'archive.ejs',
  'pages/archive/post-index.ejs': 'post-index.ejs',
  'pages/category/categories.ejs': 'categories.ejs',
  'pages/category/category-detail.ejs': 'category-detail.ejs',
  'pages/tag/tags.ejs': 'tags.ejs',
  'pages/tag/tag-detail.ejs': 'tag-detail.ejs',
};
const TIME_ZONE = 'Asia/Shanghai';
const MAJOR_CATEGORY = 10;
const COMMON_TAG = 3;

const toDate = value => (value && typeof value.toDate === 'function' ? value.toDate() : new Date(value));
const list = value => (Array.isArray(value) ? value : value.toArray());

// Newest first; posts on the same day keep a stable order by title.
function sortPosts(posts) {
  return [...posts].sort((a, b) => toDate(b.date) - toDate(a.date) || String(a.title).localeCompare(String(b.title)));
}

function yearAndMonth(date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit' }).formatToParts(date);
  return { year: parts.find(part => part.type === 'year').value, month: parts.find(part => part.type === 'month').value };
}

function monthName(month, english) {
  if (!english) return `${Number(month)} 月`;
  return new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: TIME_ZONE }).format(new Date(Date.UTC(2026, Number(month) - 1, 15)));
}

// [{ year, count, months: [{ month, name, posts }] }], newest year and month first.
function groupPosts(posts, english = false) {
  const years = new Map();
  for (const post of sortPosts(list(posts))) {
    const { year, month } = yearAndMonth(toDate(post.date));
    if (!years.has(year)) years.set(year, { year, count: 0, months: new Map() });
    const group = years.get(year);
    group.count += 1;
    if (!group.months.has(month)) group.months.set(month, { month, name: monthName(month, english), posts: [] });
    group.months.get(month).posts.push(post);
  }
  return [...years.values()].map(group => ({ ...group, months: [...group.months.values()] }));
}

// One card per top-level category, the largest first. Each card keeps its three newest posts.
function categoryCards(categories) {
  return list(categories)
    .filter(category => !category.parent && category.posts.length > 0)
    .map(category => {
      const posts = sortPosts(list(category.posts));
      return { name: category.name, path: category.path, count: posts.length, recent: posts.slice(0, 3), latest: toDate(posts[0].date), major: posts.length >= MAJOR_CATEGORY };
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

// Tags split into common (3 or more posts) and the rest (1 or 2), each sorted by count, then by name.
function tagTiers(tags, english = false) {
  const collator = new Intl.Collator(english ? 'en' : 'zh-Hans-CN', { sensitivity: 'base', numeric: true });
  const all = list(tags).filter(tag => tag.posts.length > 0).map(tag => ({ name: tag.name, path: tag.path, count: tag.posts.length, major: tag.posts.length >= MAJOR_CATEGORY }));
  const byCount = (a, b) => b.count - a.count || collator.compare(a.name, b.name);
  return {
    common: all.filter(tag => tag.count >= COMMON_TAG).sort(byCount),
    other: all.filter(tag => tag.count < COMMON_TAG).sort(byCount),
    total: all.length,
  };
}

if (typeof hexo !== 'undefined') {
  hexo.extend.helper.register('aden_archive_groups', groupPosts);
  hexo.extend.helper.register('aden_category_cards', categoryCards);
  hexo.extend.helper.register('aden_tag_tiers', tagTiers);
  hexo.extend.filter.register('before_generate', function () {
    for (const [target, file] of Object.entries(VIEWS)) {
      this.theme.setView(target, fs.readFileSync(path.join(__dirname, '../lib/views', file), 'utf8'));
    }
  });
}

module.exports = { VIEWS, groupPosts, categoryCards, tagTiers, monthName, sortPosts };
