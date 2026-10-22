'use strict';
// "Latest daily brief" strip on the first home page (zh and en). Written into the
// built HTML after translation, so it costs no script or request at runtime; the
// home list itself leaves briefs out (scripts/brief-split.js).
const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');
const { readPosts } = require('../build-latest-posts.cjs');

const TEXT = {
  zh: { all: '全部简报', stats: (count, recent) => `共 ${count} 期 · 近 30 天 ${recent} 期`, label: '最新简报' },
  en: { all: 'All briefs', stats: (count, recent) => `${count} issues · ${recent} in the last 30 days`, label: 'Latest brief' }
};

const day = iso => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });

// Days with a brief in the 30 days ending on the newest one; a missed day does not
// reset it the way a streak would.
function recent(dates, span = 30) {
  const last = Date.parse(day(dates[0]));
  return new Set(dates.map(day).filter(d => last - Date.parse(d) < span * 86400000)).size;
}

// "每日简报｜2026-10-22：主线" / "Daily Briefing | 22 October 2026: Headline" -> headline only.
const headline = title => title.replace(/^(?:每日简报|Daily Brief(?:ing)?)\s*[|｜][^:：]*[：:]\s*/i, '');

function stripHtml(briefs, lang, prefix) {
  const text = TEXT[lang], latest = briefs[0];
  const link = new URL(latest.url).pathname;
  const $ = cheerio.load('<aside class="aden-brief-strip" translate="no"></aside>', null, false);
  $('aside')
    .attr('aria-label', text.label)
    .append($('<span class="aden-brief-tag">DAILY BRIEF</span>'))
    .append($('<a class="aden-brief-latest"></a>').attr('href', link)
      .append($('<time></time>').attr('datetime', latest.date).text(day(latest.date).slice(5)))
      .append($('<span class="aden-brief-title"></span>').text(headline(latest.title))))
    .append($('<span class="aden-brief-stats"></span>').text(text.stats(briefs.length, recent(briefs.map(b => b.date)))))
    .append($('<a class="aden-brief-all"></a>').attr('href', `${prefix}/daily/`).text(`${text.all} →`));
  return $.html();
}

function injectBriefStrip(publicDir) {
  for (const [lang, dir, prefix] of [['zh', publicDir, ''], ['en', path.join(publicDir, 'en'), '/en']]) {
    const home = path.join(dir, 'index.html');
    const briefs = readPosts(dir, prefix).filter(post => post.brief);
    if (!briefs.length || !fs.existsSync(home)) continue;
    const $ = cheerio.load(fs.readFileSync(home, 'utf8'));
    $('.aden-brief-strip').remove();
    $('.home-content-container .home-article-list').before(stripHtml(briefs, lang, prefix));
    fs.writeFileSync(home, $.html());
  }
}

module.exports = { injectBriefStrip, recent, headline };
