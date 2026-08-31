(() => {
  'use strict';

  const formatters = new Map();
  function formatter(zone, kind) {
    const key = `${zone}/${kind}`;
    if (!formatters.has(key)) {
      const options = kind === 'parts'
        ? { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }
        : kind === 'time'
          ? { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }
          : { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' };
      formatters.set(key, new Intl.DateTimeFormat(kind === 'date' ? 'zh-CN' : 'en-GB', { ...options, timeZone: zone }));
    }
    return formatters.get(key);
  }

  function snapshot(now, zone) {
    const p = Object.fromEntries(formatter(zone, 'parts').formatToParts(now).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
    const midnight = Date.UTC(p.year, p.month - 1, p.day);
    const wallTime = midnight + ((p.hour * 60 + p.minute) * 60 + p.second) * 1000;
    const offset = Math.round((wallTime - Math.floor(now.getTime() / 1000) * 1000) / 60000);
    return { time: formatter(zone, 'time').format(now), date: formatter(zone, 'date').format(now), day: midnight / 86400000, offset };
  }

  function offsetLabel(minutes) {
    if (!minutes) return 'UTC+00:00';
    const value = Math.abs(minutes);
    return `UTC${minutes < 0 ? '−' : '+'}${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  }

  function compare(local, remote) {
    const delta = remote.offset - local.offset;
    const minutes = Math.abs(delta);
    const duration = [Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)} 小时` : '', minutes % 60 ? `${minutes % 60} 分钟` : ''].filter(Boolean).join(' ');
    const days = remote.day - local.day;
    return {
      difference: delta === 0 ? '与你的本地时间相同' : `比你${delta > 0 ? '快' : '慢'} ${duration}`,
      dayDifference: days === 0 ? '与你处于同一天' : `当地日期比你${days > 0 ? '晚' : '早'} ${Math.abs(days)} 天`
    };
  }

  // Pure helpers are exported only for Node regression tests.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { snapshot, offsetLabel, compare };
    return;
  }
  // Swup may execute the page script again. Reuse a single lifecycle controller.
  if (window.AdenWorldTime) { window.AdenWorldTime.mount(); return; }

  let active = null;
  let boundSwup = null;
  function destroy() {
    if (!active) return;
    clearInterval(active.timer);
    active.listeners.abort();
    active = null;
  }

  function mount() {
    const root = document.getElementById('world-time');
    if (active?.root === root && root?.isConnected) return;
    destroy();
    if (!root) return;

    const cities = Array.from(root.querySelectorAll('button[data-zone]')).map(button => ({ id: button.dataset.city, name: button.dataset.name, zone: button.dataset.zone }));
    let localZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    let selected = cities.find(city => city.zone === localZone) || cities.find(city => city.id === 'sydney') || cities[0];
    const nodes = Object.fromEntries(Array.from(root.querySelectorAll('[data-wt]')).map(node => [node.dataset.wt, node]));
    const listeners = new AbortController();
    active = { root, listeners, timer: null };

    function set(name, text) {
      if (nodes[name].textContent !== text) nodes[name].textContent = text;
    }
    function renderClock(kind, state, zone, now) {
      set(`${kind}-time`, state.time);
      nodes[`${kind}-time`].dateTime = now.toISOString();
      set(`${kind}-date`, state.date);
      set(`${kind}-zone`, `${zone} · ${offsetLabel(state.offset)}`);
    }
    function render() {
      if (!root.isConnected || document.hidden) return;
      const now = new Date();
      localZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      try {
        const local = snapshot(now, localZone);
        renderClock('local', local, localZone, now);
        const remote = snapshot(now, selected.zone);
        renderClock('remote', remote, selected.zone, now);
        const comparison = compare(local, remote);
        set('difference', `${selected.name} · ${comparison.difference}`);
        set('day-difference', comparison.dayDifference);
      } catch (_) {
        set('remote-time', '--:--:--');
        set('remote-date', '浏览器暂不支持这个时区');
        set('remote-zone', selected.zone);
        set('difference', '请更新浏览器后重试');
        set('day-difference', '');
      }
    }
    function select(id) {
      const city = cities.find(item => item.id === id);
      if (!city) return;
      selected = city;
      set('remote-name', city.name);
      for (const marker of root.querySelectorAll('[data-city]')) {
        marker.setAttribute('aria-pressed', String(marker.dataset.city === city.id));
      }
      render();
    }
    function selectTarget(event) {
      const target = event.target.closest?.('[data-city]');
      if (target && root.contains(target)) select(target.dataset.city);
    }
    root.addEventListener('pointerover', event => {
      if (event.pointerType !== 'touch') selectTarget(event);
    }, { signal: listeners.signal });
    root.addEventListener('click', selectTarget, { signal: listeners.signal });
    root.addEventListener('focusin', selectTarget, { signal: listeners.signal });
    root.addEventListener('keydown', event => {
      if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('.wt-marker')) {
        event.preventDefault();
        selectTarget(event);
      }
    }, { signal: listeners.signal });
    function startClock() {
      clearInterval(active?.timer);
      if (!active || active.root !== root || document.hidden) return;
      render();
      active.timer = setInterval(render, 1000);
    }
    document.addEventListener('visibilitychange', startClock, { signal: listeners.signal });
    select(selected.id);
    startClock();
  }

  function bindSwup(swup) {
    if (!swup?.hooks || boundSwup === swup) return;
    boundSwup = swup;
    swup.hooks.before('content:replace', destroy);
    swup.hooks.on('page:view', mount);
  }
  window.AdenWorldTime = { mount, destroy };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
  if (window.swup?.hooks) bindSwup(window.swup);
  else window.addEventListener('redefine:swup:ready', event => bindSwup(event.detail?.swup || window.swup), { once: true });
})();
