/* Shared lifecycle for site widgets. Loaded before page-specific scripts. */
(() => {
  'use strict';
  if (window.AdenSite) return;
  const widgets = new Map(), scripts = new Map();
  function afterPaint(callback, signal) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (signal.aborted) return;
      if (window.requestIdleCallback) requestIdleCallback(() => { if (!signal.aborted) callback(); }, { timeout: 1200 });
      else setTimeout(() => { if (!signal.aborted) callback(); }, 0);
    }));
  }
  function destroy(widget) {
    widget.controller?.abort();
    widget.cleanup?.();
    widget.root = null;
    widget.cleanup = null;
  }
  function mount(widget) {
    const root = document.querySelector(widget.selector);
    if (root && root === widget.root && !widget.controller.signal.aborted) return;
    destroy(widget);
    if (!root) return;
    widget.root = root;
    const controller = new AbortController();
    widget.controller = controller;
    const signal = controller.signal;
    widget.cleanup = widget.start(root, {
      signal,
      afterPaint: callback => afterPaint(callback, signal),
      clock(callback) {
        let timer;
        const refresh = () => { clearInterval(timer); timer = null; if (!document.hidden && !signal.aborted) { callback(); timer = setInterval(callback, 1000); } };
        document.addEventListener('visibilitychange', refresh, { signal });
        signal.addEventListener('abort', () => clearInterval(timer), { once: true });
        refresh();
      }
    });
  }
  const mountAll = () => widgets.forEach(mount);
  function register(name, selector, start) {
    if (widgets.has(name)) { mount(widgets.get(name)); return; }
    const widget = { selector, start };
    widgets.set(name, widget);
    if (document.readyState !== 'loading') mount(widget);
  }
  function delay(ms, signal) {
    return new Promise(resolve => {
      if (signal?.aborted) { resolve(); return; }
      const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); };
      const timer = setTimeout(done, ms);
      signal?.addEventListener('abort', done, { once: true });
    });
  }
  function loadScript(url) {
    if (scripts.has(url)) return scripts.get(url);
    const pending = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const timeout = setTimeout(() => { script.remove(); scripts.delete(url); reject(new Error('Script timeout')); }, 15000);
      script.src = url; script.async = true;
      script.onload = () => { clearTimeout(timeout); resolve(); };
      script.onerror = () => { clearTimeout(timeout); script.remove(); scripts.delete(url); reject(new Error('Script unavailable')); };
      document.head.append(script);
    });
    scripts.set(url, pending);
    return pending;
  }
  function loadStyle(url) {
    if (scripts.has(url)) return scripts.get(url);
    const pending = new Promise((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = url;
      link.onload = resolve;
      link.onerror = () => { link.remove(); scripts.delete(url); reject(new Error('Style unavailable')); };
      document.head.append(link);
    });
    scripts.set(url, pending);
    return pending;
  }
  // Fade in lazy images when their real source arrives; placeholders and cached
  // images that load before this listener simply show as before.
  document.addEventListener('load', event => {
    const img = event.target;
    if (img instanceof HTMLImageElement && img.dataset.src && img.src === new URL(img.dataset.src, location.href).href) img.classList.add('aden-image-in');
  }, true);
  window.AdenSite = { register, loadScript, delay };
  document.addEventListener('DOMContentLoaded', mountAll, { once: true });
  window.addEventListener('pageshow', mountAll);
  window.addEventListener('pagehide', () => widgets.forEach(destroy));
  const briefView = url => new URL(url, location.href).pathname.match(/^\/(en\/)?daily\/(list\/)?$/);
  const slideBrief = (offset, entering) => {
    const daily = document.querySelector('.aden-daily');
    const pane = daily?.querySelector(':scope > :is(.home-content-container, .archive-container)');
    if (!pane?.animate || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const rest = { transform: 'translateX(0)', opacity: 1 };
    const edge = { transform: `translateX(${offset}px)`, opacity: .35 };
    daily.classList.add('aden-daily-sliding');
    const animation = pane.animate(entering ? [edge, rest] : [rest, edge], {
      duration: entering ? 180 : 100,
      easing: entering ? 'ease-out' : 'ease-in'
    });
    return animation.finished.catch(() => {}).finally(() => daily.classList.remove('aden-daily-sliding'));
  };
  let bound;
  const bind = swup => {
    if (!swup?.hooks || bound === swup) return;
    bound = swup;
    const briefSwitches = new WeakMap();
    swup.hooks.before('visit:start', visit => {
      const from = briefView(visit.from.url), to = briefView(visit.to.url);
      if (!from || !to || from[1] !== to[1] || from[2] === to[2]) return;
      visit.animation.animate = false;
      visit.scroll.reset = false;
      briefSwitches.set(visit, { direction: to[2] ? 1 : -1, focus: !!visit.trigger.el?.closest('.aden-daily-views') });
    });
    swup.hooks.before('content:replace', async visit => {
      const change = briefSwitches.get(visit);
      if (change) await slideBrief(-24 * change.direction, false);
      widgets.forEach(destroy);
    });
    swup.hooks.on('page:view', visit => {
      mountAll();
      const change = briefSwitches.get(visit);
      if (!change) return;
      if (change.focus) document.querySelector('.aden-daily-views [aria-current="page"]')?.focus({ preventScroll: true });
      slideBrief(24 * change.direction, true);
    });
  };
  bind(window.swup);
  window.addEventListener('redefine:swup:ready', event => bind(event.detail?.swup || window.swup));
  // Every page carries only this button; the chat panel, its styles and the first
  // /api/chat request load when a visitor opens it (or follows an old /chat/ link).
  // Home hero title "decodes" from noise once per visit to the homepage.
  register('hero-decode', '.home-banner-container .description', (root, scope) => {
    const node = [...root.childNodes].find(n => n.nodeType === Node.TEXT_NODE && n.data.trim());
    if (!node || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const original = node.data, glyphs = '01<>/\\[]{}#*+=_-?';
    const order = [...original].map((ch, i) => (ch.trim() ? 160 + i * 55 + Math.random() * 120 : 0));
    const start = performance.now();
    root.classList.add('is-decoding');
    let frame;
    const restore = () => { cancelAnimationFrame(frame); node.data = original; root.classList.remove('is-decoding'); };
    const tick = now => {
      const t = now - start;
      node.data = [...original].map((ch, i) => (t >= order[i] ? ch : glyphs[Math.floor(Math.random() * glyphs.length)])).join('');
      if (t < Math.max(...order)) frame = requestAnimationFrame(tick); else restore();
    };
    frame = requestAnimationFrame(tick);
    scope.signal.addEventListener('abort', restore, { once: true });
    return restore;
  });
  // Ask AI in the dock. The field works before the chat script arrives: the first focus loads the chat's
  // script and styles, and a question sent before then waits in the form (data-queued) until the chat
  // script mounts and sends it. On phones a compact button opens the field over the dock; a tap outside
  // the dock and the chat panel, or Escape, closes it again and keeps the draft.
  register('ask', '#aden-ask', (form, scope) => {
    const signal = scope.signal;
    const input = form.querySelector('.aden-ask-input'), send = form.querySelector('.aden-ask-send');
    const dock = form.closest('.right-side-tools-container'), opener = dock?.querySelector('.aden-ask-open');
    if (!input || !send) return;
    const english = document.documentElement.lang.startsWith('en');
    const placeholder = input.placeholder, failed = english ? 'Chat failed to load. Try again.' : '聊天加载失败，请重试';
    let loading = null;
    // After a failed load, a later successful one restores the hint (the chat may set its own on mount).
    const load = () => loading ||= Promise.all([loadStyle(form.dataset.style), loadScript(form.dataset.script)]).then(() => {
      if (input.placeholder === failed) input.placeholder = placeholder;
    }, error => {
      loading = null;
      input.placeholder = failed;
      throw error;
    });
    const sync = () => { if (!form.classList.contains('is-working')) send.disabled = !input.value.trim(); };
    input.addEventListener('input', sync, { signal });
    form.addEventListener('focusin', () => { load().catch(() => {}); }, { signal });
    form.addEventListener('submit', event => {
      if (window.AdenChat) return;
      event.preventDefault();
      if (!input.value.trim()) return;
      form.dataset.queued = '';
      load().catch(() => { delete form.dataset.queued; });
    }, { signal });
    const setAsking = asking => {
      if (!dock) return;
      dock.classList.toggle('is-asking', asking);
      opener?.setAttribute('aria-expanded', String(asking));
      if (asking) input.focus({ preventScroll: true });
    };
    opener?.addEventListener('click', () => setAsking(true), { signal });
    document.addEventListener('pointerdown', event => {
      if (!dock?.classList.contains('is-asking') || dock.contains(event.target) || event.target.closest?.('#aden-chat')) return;
      setAsking(false);
    }, { signal });
    form.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !dock?.classList.contains('is-asking') || document.querySelector('#aden-chat:not([hidden])')) return;
      setAsking(false);
      opener?.focus({ preventScroll: true });
    }, { signal });
    sync();
    if (new URLSearchParams(location.search).get('chat') === 'open') {
      if (opener?.getClientRects().length) setAsking(true);
      else input.focus({ preventScroll: true });
    }
    return () => dock?.classList.remove('is-asking');
  });
  // The menu button mirrors the theme's drawer state; Escape closes the drawer through the
  // theme's own toggle and returns focus to the button, as it does for the search popup.
  register('navbar-menu', '.navbar-container', (header, scope) => {
    const bar = header.querySelector('.navbar-bar'), drawer = header.querySelector('#navbar-drawer');
    if (!bar || !drawer) return;
    // On phones the header's bars are hidden and the dock's menu button opens the drawer instead.
    const triggers = () => [bar, document.querySelector('.aden-dock-menu')].filter(Boolean);
    const shown = button => typeof button.getClientRects !== 'function' || button.getClientRects().length > 0;
    const visibleTrigger = () => triggers().find(shown) || bar;
    let wasOpen = false;
    const sync = () => {
      const open = document.body.classList.contains('navbar-drawer-show');
      for (const button of triggers()) button.setAttribute('aria-expanded', String(open));
      // The dock's button doubles as the way back out of the drawer on phones.
      const dockMenu = document.querySelector('.aden-dock-menu'), english = document.documentElement?.lang?.startsWith('en');
      dockMenu?.setAttribute('aria-label', open ? (english ? 'Close menu' : '关闭菜单') : (english ? 'Menu' : '菜单'));
      const focusWasInDrawer = drawer.contains(document.activeElement);
      drawer.inert = !open;
      if (open && !wasOpen) drawer.querySelector('a')?.focus({ preventScroll: true });
      if (wasOpen && !open && focusWasInDrawer) visibleTrigger().focus({ preventScroll: true });
      wasOpen = open;
    };
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', () => {
      if (!triggers().some(shown)) document.body.classList.remove('navbar-drawer-show');
    }, { signal: scope.signal });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !document.body.classList.contains('navbar-drawer-show') || document.querySelector('.search-pop-overlay.active')) return;
      bar.click();
      visibleTrigger().focus({ preventScroll: true });
    }, { signal: scope.signal });
    sync();
    return () => observer.disconnect();
  });
  register('search-popup', '.search-pop-overlay', (overlay, scope) => {
    const input = overlay.querySelector('.search-input');
    const clear = overlay.querySelector('button.search-input-field-pre');
    const close = overlay.querySelector('button.popup-btn-close');
    if (!input || !clear || !close) return;
    const triggers = [...document.querySelectorAll('button.search-popup-trigger')];
    let opener = null;
    let wasOpen = false;
    const syncClear = () => { clear.hidden = !input.value; };
    const sync = () => {
      const open = overlay.classList.contains('active');
      overlay.inert = !open;
      for (const trigger of triggers) trigger.setAttribute('aria-expanded', String(open));
      if (open && !wasOpen) {
        document.body.classList.remove('navbar-drawer-show');
        syncClear();
        input.focus({ preventScroll: true });
      }
      if (!open && wasOpen && opener?.isConnected) opener.focus({ preventScroll: true });
      wasOpen = open;
    };
    for (const trigger of triggers) trigger.addEventListener('click', () => { opener = trigger; }, { signal: scope.signal });
    const observer = new MutationObserver(sync);
    observer.observe(overlay, { attributes: true, attributeFilter: ['class'] });
    input.addEventListener('input', syncClear, { signal: scope.signal });
    clear.addEventListener('click', () => { clear.hidden = true; }, { signal: scope.signal });
    overlay.addEventListener('keydown', event => {
      if (!wasOpen || event.isComposing || event.altKey || event.metaKey || event.ctrlKey) return;
      const hits = [...overlay.querySelectorAll('.aden-search-hit')];
      const index = hits.indexOf(document.activeElement);
      if (event.key === 'Tab') {
        const items = [close, input, ...(!clear.hidden ? [clear] : []), ...hits];
        if (event.shiftKey && document.activeElement === items[0]) {
          event.preventDefault();
          items.at(-1).focus();
        } else if (!event.shiftKey && document.activeElement === items.at(-1)) {
          event.preventDefault();
          items[0].focus();
        }
      } else if (event.key === 'ArrowDown' && (event.target === input || index >= 0) && hits[index + 1]) {
        event.preventDefault();
        hits[index + 1].focus();
      } else if (event.key === 'ArrowUp' && index >= 0) {
        event.preventDefault();
        (hits[index - 1] || input).focus();
      }
    }, { signal: scope.signal });
    sync();
    return () => observer.disconnect();
  });
  // Bottom dock (lib/styles/dock.css). The theme's tool items are <li role="button">: Enter and Space click
  // them. The menu button opens the header drawer through the theme's own toggle. The settings toggle
  // reports the popover state. On phones the dock slides away while the reader moves on through the page
  // and comes back when they scroll back up; it stays while it holds keyboard focus, a popover or the drawer is open,
  // or the chat is open. Desktop keeps it in place.
  register('dock', '.right-side-tools-container', (dock, scope) => {
    const signal = scope.signal;
    const settings = dock.querySelector('.toggle-tools-list'), popover = dock.querySelector('.hidden-tools-list');
    dock.addEventListener('keydown', event => {
      const item = event.target.closest?.('li[role="button"]');
      if (!item || (event.key !== 'Enter' && event.key !== ' ')) return;
      event.preventDefault();
      item.click();
    }, { signal });
    dock.querySelector('.aden-dock-menu')?.addEventListener('click', () => document.querySelector('.navbar-container .navbar-bar')?.click(), { signal });
    let popoverObserver;
    if (settings && popover) {
      const syncSettings = () => settings.setAttribute('aria-expanded', String(popover.classList.contains('show')));
      popoverObserver = new MutationObserver(syncSettings);
      popoverObserver.observe(popover, { attributes: true, attributeFilter: ['class'] });
      syncSettings();
      document.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || !popover.classList.contains('show')) return;
        settings.click();
        settings.focus({ preventScroll: true });
      }, { signal });
    }
    const phone = window.matchMedia('(max-width: 768px)');
    const pinned = () => Boolean(dock.querySelector(':focus-visible, .aden-ask-input:focus, .aden-ask.is-working')) || dock.classList.contains('is-asking') || popover?.classList.contains('show') || document.body.classList.contains('navbar-drawer-show') || document.documentElement.classList.contains('aden-chat-open');
    // Browsers already deliver scroll events at most once per frame, and the work here is one class toggle.
    let lastY = window.scrollY;
    const update = () => {
      const y = window.scrollY, delta = y - lastY;
      if (!phone.matches || pinned() || y < 120) { dock.classList.remove('aden-dock-away'); lastY = y; return; }
      if (Math.abs(delta) < 8) return;
      dock.classList.toggle('aden-dock-away', delta > 0);
      lastY = y;
    };
    window.addEventListener('scroll', update, { passive: true, signal });
    dock.addEventListener('focusin', () => dock.classList.remove('aden-dock-away'), { signal });
    return () => { popoverObserver?.disconnect(); dock.classList.remove('aden-dock-away'); };
  });
  // APlayer draws its icon-only buttons without names. Name them in the page language; the play
  // button says "Pause" while playing (APlayer marks the container with aplayer-play / aplayer-pause).
  const APLAYER_NAMES = {
    'volume-down': ['音量', 'Volume'],
    'volume-up': ['音量', 'Volume'],
    order: ['播放顺序', 'Play order'],
    loop: ['循环', 'Loop'],
    menu: ['播放列表', 'Playlist'],
    lrc: ['歌词', 'Lyrics'],
    forward: ['下一首', 'Next track'],
    back: ['上一首', 'Previous track'],
  };
  register('aplayer-names', '#aplayer', (player, scope) => {
    const en = document.documentElement.lang.startsWith('en');
    const name = () => {
      for (const button of player.querySelectorAll('button.aplayer-icon')) {
        const kind = [...button.classList].find(item => item.startsWith('aplayer-icon-'))?.slice('aplayer-icon-'.length);
        const label = kind ? APLAYER_NAMES[kind] : (player.classList.contains('aplayer-play') ? ['暂停', 'Pause'] : ['播放', 'Play']);
        if (label) button.setAttribute('aria-label', en ? label[1] : label[0]);
      }
    };
    const observer = new MutationObserver(name);
    observer.observe(player, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    name();
    return () => observer.disconnect();
  });
  register('comments', '#twikoo-comment', (root, scope) => {
    let started = false;
    const start = async () => {
      if (started || scope.signal.aborted) return;
      started = true;
      try {
        await loadScript('/vendor/twikoo/twikoo.all.min.js');
        if (!scope.signal.aborted && root.isConnected) await window.twikoo.init({ el: '#twikoo-comment', envId: root.dataset.env, region: root.dataset.region || undefined, path: location.pathname });
      } catch {
        if (scope.signal.aborted) return;
        started = false;
        root.replaceChildren();
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.textContent = document.documentElement.lang.startsWith('en') ? 'Retry loading comments' : '重新加载评论';
        retry.addEventListener('click', start, { signal: scope.signal });
        root.append(retry);
      }
    };
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { observer.disconnect(); start(); } }, { rootMargin: '300px' });
      observer.observe(root);
      return () => observer.disconnect();
    }
    scope.afterPaint(start);
  });
})();
