// About page: the past 52 weeks of article commits (and merged PRs, when there are any)
// as a calendar. Data: /about/activity.json from tools/build-blog-activity.cjs. Cells run
// cool to hot in the site's two signal colours; the calendar arrives as a diagonal wave
// when it scrolls into view, and choosing a day sends a small ripple out from it.
(() => {
  'use strict';
  if (window.AdenBlogActivity) return;
  window.AdenBlogActivity = true;
  const dayMs = 86400000;
  const REPO = 'https://github.com/AdenXie/Aden.github.io';

  function mount(root, { signal }) {
    const en = root.dataset.language === 'en';
    const locale = en ? 'en' : 'zh-CN';
    const summary = root.querySelector('[data-activity-summary]');
    const content = root.querySelector('[data-activity-content]');
    const grid = root.querySelector('[data-activity-grid]');
    const months = root.querySelector('[data-activity-months]');
    const scroll = root.querySelector('[data-activity-scroll]');
    const detail = root.querySelector('[data-activity-detail]');
    const note = root.querySelector('[data-activity-note]');
    const dateLabel = new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' });
    const monthLabel = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' });
    const updateLabel = new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'Asia/Shanghai' });
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    grid.replaceChildren();
    months.replaceChildren();
    content.hidden = true;
    summary.textContent = en ? 'Loading contributions…' : '正在加载贡献记录…';

    // Commit subjects read "post: publish daily brief 2026-11-12" or "post: publish <title>".
    function entryView({ kind, title }) {
      if (kind === 'pr') return { tag: 'PR', text: title };
      const text = String(title).replace(/^post:\s*(publish\s+)?/i, '').trim();
      const brief = /^daily brief\b/i.exec(text);
      if (brief) return { tag: en ? 'Brief' : '简报', text: (en ? 'Daily brief' : '每日简报') + text.slice(brief[0].length).replace(/^\s*/, ' · ') };
      return { tag: en ? 'Article' : '文章', text: text.charAt(0).toUpperCase() + text.slice(1) };
    }

    function strong(value) {
      const b = document.createElement('strong');
      b.textContent = value;
      return b;
    }

    function render(data) {
      const { posts, prs, prsAsOf } = data;
      const first = Date.parse(data.start);
      const last = Date.parse(data.end);
      if (last - first !== 363 * dayMs || !Array.isArray(posts)) throw new Error('Invalid activity dates');
      const events = new Map();
      const record = (entry, kind) => {
        const list = events.get(entry.date) || [];
        list.push({ ...entry, kind });
        events.set(entry.date, list);
      };
      posts.forEach(entry => record(entry, 'post'));
      prs?.forEach(entry => record(entry, 'pr'));
      const showPrs = Array.isArray(prs) && prs.length > 0;

      // Active days and the longest run of consecutive active days.
      let longest = 0, run = 0;
      for (let i = 0; i < 364; i++) {
        run = events.has(new Date(first + i * dayMs).toISOString().slice(0, 10)) ? run + 1 : 0;
        longest = Math.max(longest, run);
      }
      // Each clause stays on one line; narrow screens wrap between clauses.
      const clause = (...nodes) => {
        const span = document.createElement('span');
        span.className = 'blog-activity-clause';
        span.append(...nodes);
        return span;
      };
      const plural = (n, word) => `${word}${n === 1 ? '' : 's'}`;
      const clauses = en
        ? [clause(strong(posts.length), ` article ${plural(posts.length, 'commit')}`), clause(' on ', strong(events.size), ` ${plural(events.size, 'day')}`), clause(' · longest streak ', strong(longest), ` ${plural(longest, 'day')}`)]
        : [clause(strong(posts.length), ' 次文章提交，'), clause('分布在 ', strong(events.size), ' 天'), clause(' · 最长连续 ', strong(longest), ' 天')];
      if (showPrs) clauses.push(clause(' · ', strong(prs.length), en ? ` merged ${plural(prs.length, 'PR')}` : ' 个已合并 PR'));
      summary.replaceChildren(...clauses);
      note.textContent = showPrs && prsAsOf ? (en ? `PRs checked ${updateLabel.format(new Date(prsAsOf))}` : `PR 更新于 ${updateLabel.format(new Date(prsAsOf))}`) : '';

      const describe = list => {
        const commits = list.filter(entry => entry.kind === 'post').length;
        const pulls = list.length - commits;
        if (!list.length) return en ? 'No contributions' : '没有贡献';
        const text = en ? `${commits} article commit${commits === 1 ? '' : 's'}` : `${commits} 次文章提交`;
        return pulls ? text + (en ? ` · ${pulls} merged PR${pulls === 1 ? '' : 's'}` : ` · ${pulls} 个已合并 PR`) : text;
      };

      const cells = [];
      const offset = (new Date(first).getUTCDay() + 6) % 7; // weeks start on Monday
      for (let i = 0; i < offset; i++) grid.append(document.createElement('span'));
      const place = index => ({ col: Math.floor((offset + index) / 7), row: (offset + index) % 7 });

      let selected;
      function select(index, { focus = false, ripple = true } = {}) {
        const cell = cells[index];
        if (!cell || cell === selected) return;
        if (selected) {
          selected.tabIndex = -1;
          selected.setAttribute('aria-pressed', 'false');
        }
        selected = cell;
        cell.tabIndex = 0;
        cell.setAttribute('aria-pressed', 'true');
        if (focus) {
          cell.focus({ preventScroll: true });
          cell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
        if (ripple && !calm) rippleFrom(index);

        const list = events.get(cell.dataset.date) || [];
        const body = document.createElement('div');
        body.className = 'blog-activity-selection';
        const head = document.createElement('p');
        head.className = 'blog-activity-day';
        const date = document.createElement('strong');
        date.textContent = dateLabel.format(first + index * dayMs);
        const counts = document.createElement('span');
        counts.textContent = describe(list);
        head.append(date, counts);
        body.append(head);
        if (list.length) {
          // Plain blocks rather than a list: the theme styles article lists heavily.
          const rows = document.createElement('div');
          rows.className = 'blog-activity-entries';
          for (const entry of list) {
            const view = entryView(entry);
            const row = document.createElement('div');
            const tag = document.createElement('span');
            tag.className = 'blog-activity-tag';
            tag.dataset.kind = entry.kind === 'pr' ? 'pr' : view.tag === (en ? 'Brief' : '简报') ? 'brief' : 'article';
            tag.textContent = view.tag;
            const link = document.createElement('a');
            link.href = entry.kind === 'pr' ? `${REPO}/pull/${encodeURIComponent(entry.id)}` : `${REPO}/commit/${encodeURIComponent(entry.id)}`;
            link.target = '_blank';
            link.rel = 'noopener';
            link.textContent = view.text;
            row.append(tag, link);
            rows.append(row);
          }
          body.append(rows);
        }
        detail.replaceChildren(body);
      }

      // A short pulse spreading from the chosen day to its neighbours.
      let rippleTimer;
      function rippleFrom(index) {
        const origin = place(index);
        clearTimeout(rippleTimer);
        grid.classList.remove('is-rippling');
        cells.forEach((cell, i) => {
          const p = place(i);
          const distance = Math.hypot(p.col - origin.col, p.row - origin.row);
          if (distance <= 4.5) cell.style.setProperty('--ripple', `${Math.round(distance * 55)}ms`);
          else cell.style.removeProperty('--ripple');
        });
        void grid.offsetWidth; // restart the animation
        grid.classList.add('is-rippling');
        rippleTimer = setTimeout(() => grid.classList.remove('is-rippling'), 900);
      }

      let lastMonthColumn = -3;
      for (let index = 0; index < 364; index++) {
        const date = new Date(first + index * dayMs);
        const iso = date.toISOString().slice(0, 10);
        const list = events.get(iso) || [];
        const { col, row } = place(index);
        if ((index === 0 || date.getUTCDate() === 1) && col + 1 - lastMonthColumn >= 3) {
          const label = document.createElement('span');
          label.style.gridColumn = col + 1;
          label.textContent = monthLabel.format(date);
          months.append(label);
          lastMonthColumn = col + 1;
        }
        const button = document.createElement('button');
        button.type = 'button';
        button.tabIndex = -1;
        button.dataset.date = iso;
        button.dataset.level = Math.min(list.length, 3);
        // Entrance wave runs along the diagonal: left to right, top to bottom.
        button.style.setProperty('--wave', `${col * 15 + row * 26}ms`);
        button.setAttribute('aria-label', `${dateLabel.format(date)} · ${describe(list)}`);
        button.setAttribute('aria-pressed', 'false');
        button.addEventListener('click', () => select(index), { signal });
        button.addEventListener('keydown', event => {
          const shift = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 }[event.key];
          if (shift === undefined) return;
          event.preventDefault();
          select(Math.max(0, Math.min(cells.length - 1, index + shift)), { focus: true });
        }, { signal });
        cells.push(button);
        grid.append(button);
      }

      content.hidden = false;
      // Open on the latest day with something to show (today is often still empty).
      let latest = cells.length - 1;
      while (latest > 0 && cells[latest].dataset.level === '0') latest--;
      select(cells[latest].dataset.level === '0' ? cells.length - 1 : latest, { ripple: false });
      scroll.scrollLeft = scroll.scrollWidth;

      if (!calm && 'IntersectionObserver' in window) {
        const seen = new IntersectionObserver(entries => {
          if (!entries.some(entry => entry.isIntersecting)) return;
          seen.disconnect();
          grid.classList.add('is-waving');
          setTimeout(() => grid.classList.remove('is-waving'), 1900);
        }, { threshold: 0.4 });
        seen.observe(grid);
        signal.addEventListener('abort', () => seen.disconnect(), { once: true });
      }
    }

    fetch('/about/activity.json', { signal }).then(response => {
      if (!response.ok) throw new Error('Activity request failed');
      return response.json();
    }).then(data => {
      if (!signal.aborted) render(data);
    }).catch(() => {
      if (!signal.aborted) summary.textContent = en ? 'Contribution data is temporarily unavailable.' : '贡献数据暂不可用。';
    });
  }

  window.AdenSite.register('blog-activity', '[data-blog-activity]', mount);
})();
