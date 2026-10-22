'use strict';

// Daily briefs (category 每日简报) stay off the home list so it shows the long-form
// articles. They get their own section: /daily/ as one page of cards (the home card
// markup) and /daily/list/ as a timeline (the archive markup). Briefs stay in
// archives, tags and search; the home page gets a one-line "latest brief" strip at
// build time (tools/lib/brief-strip.cjs).
const fs = require('node:fs');
const path = require('node:path');
const pagination = require('hexo-pagination');
const { recent } = require('../tools/lib/brief-strip.cjs');

const BRIEF_CATEGORY = '每日简报';
const isBrief = post => post.categories.toArray().some(category => category.name === BRIEF_CATEGORY);

// Same as hexo-generator-index (order, sticky, pagination), minus the briefs.
function articleIndex(locals) {
  const config = this.config;
  const posts = locals.posts.sort(config.index_generator.order_by).filter(post => !isBrief(post));
  posts.data.sort((a, b) => (b.sticky || 0) - (a.sticky || 0));
  const paginationDir = config.index_generator.pagination_dir || config.pagination_dir || 'page';
  return pagination(config.index_generator.path || '', posts, {
    perPage: config.index_generator.per_page,
    layout: config.index_generator.layout || ['index', 'archive'],
    format: paginationDir + '/%d/',
    data: { __index: true }
  });
}

function dailyPages(locals) {
  const english = this.config.language === 'en';
  const briefs = locals.posts.sort('-date').filter(isBrief);
  const count = briefs.length, lately = count ? recent(briefs.map(post => post.date.toISOString())) : 0;
  const data = {
    type: 'daily',
    title: english ? 'Daily Brief' : '每日简报',
    daily_meta: english ? `${count} issues · ${lately} in the last 30 days` : `共 ${count} 期 · 近 30 天 ${lately} 期`,
    // News for the briefs is gathered by AI; say so, and that it is not the author's views.
    daily_note: english ? "News sourced by AI; not the author's views." : '本栏目的新闻检索由 AI 完成，内容不代表作者立场。',
    daily_labels: english ? { views: 'View', cards: 'Cards', list: 'List' } : { views: '显示方式', cards: '卡片', list: '列表' }
  };
  // perPage 0: every brief on one page; cover images load lazily as they scroll in.
  const cards = pagination('daily/', briefs, { perPage: 0, layout: ['page'], data: { ...data, daily_view: 'cards' } });
  return [...cards, { path: 'daily/list/', layout: ['page'], data: { ...data, daily_view: 'list', path: 'daily/list/', posts: briefs } }];
}

if (typeof hexo !== 'undefined') {
  hexo.extend.generator.register('index', articleIndex);
  hexo.extend.generator.register('daily', dailyPages);
  // The theme picks a page's body partial by type; give "daily" pages our own view.
  // Done before generation, once the theme and its helpers have loaded.
  hexo.extend.filter.register('before_generate', function () {
    this.theme.setView('pages/daily/daily.ejs', fs.readFileSync(path.join(__dirname, '../lib/views/daily.ejs'), 'utf8'));
    const themePartial = this.extend.helper.get('getPagePartialPath');
    if (themePartial.dailyAware) return;
    const partial = function (page) {
      return page.type === 'daily' ? 'pages/daily/daily' : themePartial.call(this, page);
    };
    partial.dailyAware = true;
    this.extend.helper.register('getPagePartialPath', partial);
  });
}

module.exports = { BRIEF_CATEGORY, isBrief, articleIndex, dailyPages };
