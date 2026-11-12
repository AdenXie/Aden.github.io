'use strict';

const fs = require('node:fs');
const path = require('node:path');

hexo.extend.filter.register('before_generate', async function () {
  if (this.config.language !== 'en') return;
  const page = this.model('Page').findOne({ source: 'about/index.md' });
  if (!page) return;
  page.title = 'About';
  page._content = fs.readFileSync(path.join(this.base_dir, 'translations/en/about.md'), 'utf8');
  page.content = page._content;
  await this.post.render(path.join(this.source_dir, page.source), page);
  page.content = `<div translate="no" data-aden-authored-english="true">${page.content}</div>`;
  await page.save();
}, 5);

hexo.extend.tag.register('blog_activity', function () {
  const en = hexo.config.language === 'en';
  const weekdays = (en ? ['Mon', '', 'Wed', '', 'Fri', '', ''] : ['一', '', '三', '', '五', '', '']).map(day => `<span>${day}</span>`).join('');
  const swatches = [0, 1, 2, 3].map(level => `<i data-level="${level}"></i>`).join('');
  return `<link rel="stylesheet" href="/css/blog-activity.css">
<section class="blog-activity" data-blog-activity data-language="${en ? 'en' : 'zh'}" aria-labelledby="blog-activity-title">
  <h2 id="blog-activity-title">${en ? 'Blog contributions' : '博客贡献'}</h2>
  <p class="blog-activity-lede">${en ? 'Article commits and merged pull requests over the past 52 weeks.' : '最近 52 周的文章提交和已合并 PR。'}</p>
  <div class="blog-activity-panel">
    <p class="blog-activity-summary" data-activity-summary role="status">${en ? 'Contribution data is unavailable.' : '贡献数据暂不可用。'}</p>
    <div data-activity-content hidden>
      <div class="blog-activity-scroll" data-activity-scroll>
        <div class="blog-activity-calendar">
          <div class="blog-activity-weekdays" aria-hidden="true">${weekdays}</div>
          <div>
            <div class="blog-activity-months" data-activity-months aria-hidden="true"></div>
            <div class="blog-activity-grid" data-activity-grid role="group" aria-label="${en ? 'Daily contributions. Use arrow keys to move between dates.' : '每日贡献。使用方向键切换日期。'}"></div>
          </div>
        </div>
      </div>
      <div class="blog-activity-foot">
        <span data-activity-note></span>
        <span class="blog-activity-legend" aria-hidden="true">${en ? 'Less' : '少'} ${swatches} ${en ? 'More' : '多'}</span>
      </div>
      <div class="blog-activity-detail" data-activity-detail aria-live="polite"></div>
    </div>
  </div>
</section>
<script src="/js/blog-activity.js" defer data-swup-reload-script></script>`;
});
