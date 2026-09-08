'use strict';

// Use Redefine's own locale keys for menus when rendering the English shell.
// These are site configuration labels, not article content.
hexo.extend.filter.register('before_generate', function () {
  if (this.config.language !== 'en') return;
  const keys = { '首页': 'home', '归档': 'archives', '标签': 'tags', '关于': 'about', '友链': 'links', '世界时间': 'World Time' };
  const links = this.theme.config.navbar.links;
  this.theme.config.navbar.links = Object.fromEntries(Object.entries(links).map(([name, value]) => [keys[name] || name, value]));
});
