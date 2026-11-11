(() => {
  'use strict';
  if (window.AdenBlogActivity) return;
  window.AdenBlogActivity = true;
  const dayMs = 86400000;

  function mount(root, { signal }) {
    const en = root.dataset.language === 'en';
    const locale = en ? 'en' : 'zh-CN';
    const status = root.querySelector('[data-activity-status]');
    const grid = root.querySelector('[data-activity-grid]');
    const months = root.querySelector('[data-activity-months]');
    const scroll = root.querySelector('[data-activity-scroll]');
    const detail = root.querySelector('[data-activity-detail]');
    const dateLabel = new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' });
    const monthLabel = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' });
    const updateLabel = new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'Asia/Shanghai' });
    grid.replaceChildren();
    months.replaceChildren();
    root.querySelector('[data-activity-content]').hidden = true;
    status.textContent = en ? 'Loading contributions…' : '正在加载贡献记录…';

    function render(data) {
      const { posts, prs, prsAsOf } = data;
      const first = Date.parse(data.start);
      const last = Date.parse(data.end);
      if (last - first !== 363 * dayMs || !Array.isArray(posts)) throw new Error('Invalid activity dates');
      const repo = 'https://github.com/AdenXie/Aden.github.io';
      const events = new Map();
      const record = (entry, kind) => {
        const entries = events.get(entry.date) || [];
        entries.push({ ...entry, kind });
        events.set(entry.date, entries);
      };
      posts.forEach(entry => record(entry, 'post'));
      prs?.forEach(entry => record(entry, 'pr'));
      root.querySelector('[data-activity-posts]').textContent = posts.length;
      root.querySelector('[data-activity-prs]').textContent = prs?.length ?? '—';

      const cells = [];
      const offset = (new Date(first).getUTCDay() + 6) % 7;
      for (let i = 0; i < offset; i++) grid.append(document.createElement('span'));
      const describe = entries => {
        const commits = entries.filter(entry => entry.kind === 'post').length;
        const pulls = entries.length - commits;
        return en
          ? `${commits} article commits · ${prs ? pulls + ' merged PRs' : 'PR data unavailable'}`
          : `${commits} 次文章提交 · ${prs ? pulls + ' 个已合并 PR' : 'PR 数据暂不可用'}`;
      };

      let selected;
      function select(index, focus = false) {
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

        const entries = events.get(cell.dataset.date) || [];
        const body = document.createElement('div');
        body.className = 'blog-activity-selection';
        const heading = document.createElement('strong');
        heading.textContent = dateLabel.format(first + index * dayMs);
        const counts = document.createElement('span');
        counts.textContent = describe(entries);
        body.append(heading, counts);
        if (entries.length) {
          const list = document.createElement('ul');
          for (const { kind, id, title } of entries) {
            const item = document.createElement('li');
            const link = document.createElement('a');
            link.href = kind === 'pr' ? `${repo}/pull/${encodeURIComponent(id)}` : `${repo}/commit/${encodeURIComponent(id)}`;
            link.textContent = kind === 'pr' ? `PR #${id} · ${title}` : title;
            item.append(link);
            list.append(item);
          }
          body.append(list);
        }
        detail.replaceChildren(body);
      }

      let lastMonthColumn = -3;
      for (let index = 0; index < 364; index++) {
        const date = new Date(first + index * dayMs);
        const iso = date.toISOString().slice(0, 10);
        const entries = events.get(iso) || [];
        const column = Math.floor((offset + index) / 7) + 1;
        if ((index === 0 || date.getUTCDate() === 1) && column - lastMonthColumn >= 3) {
          const label = document.createElement('span');
          label.style.gridColumn = column;
          label.textContent = monthLabel.format(date);
          months.append(label);
          lastMonthColumn = column;
        }
        const button = document.createElement('button');
        button.type = 'button';
        button.tabIndex = -1;
        button.dataset.date = iso;
        button.dataset.level = Math.min(entries.length, 4);
        button.setAttribute('aria-label', `${dateLabel.format(date)} · ${describe(entries)}`);
        button.setAttribute('aria-pressed', 'false');
        button.addEventListener('click', () => select(index), { signal });
        button.addEventListener('keydown', event => {
          const shift = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 }[event.key];
          if (shift === undefined) return;
          event.preventDefault();
          select(Math.max(0, Math.min(cells.length - 1, index + shift)), true);
        }, { signal });
        cells.push(button);
        grid.append(button);
      }

      if (prsAsOf) {
        const updated = updateLabel.format(new Date(prsAsOf));
        status.textContent = en ? `PR data checked on ${updated}.` : `PR 数据更新于 ${updated}。`;
      } else {
        status.textContent = en ? 'PR data is temporarily unavailable.' : 'PR 数据暂不可用。';
      }
      root.querySelector('[data-activity-content]').hidden = false;
      select(cells.length - 1);
      scroll.scrollLeft = scroll.scrollWidth;
    }

    fetch('/about/activity.json', { signal }).then(response => {
      if (!response.ok) throw new Error('Activity request failed');
      return response.json();
    }).then(data => {
      if (!signal.aborted) render(data);
    }).catch(() => {
      if (!signal.aborted) status.textContent = en ? 'Contribution data is temporarily unavailable.' : '贡献数据暂不可用。';
    });
  }

  window.AdenSite.register('blog-activity', '[data-blog-activity]', mount);
})();
