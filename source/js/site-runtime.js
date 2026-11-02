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
  let bound;
  const bind = swup => {
    if (!swup?.hooks || bound === swup) return;
    bound = swup;
    swup.hooks.before('content:replace', () => widgets.forEach(destroy));
    swup.hooks.on('page:view', mountAll);
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
  register('chat-launcher', '#aden-chat-launcher', (button, scope) => {
    const label = button.getAttribute('aria-label');
    let loading = false;
    const toggle = async () => {
      if (loading) return;
      loading = true; button.setAttribute('aria-busy', 'true');
      try {
        await Promise.all([loadStyle(button.dataset.style), loadScript(button.dataset.script)]);
        button.setAttribute('aria-label', label);
        if (!scope.signal.aborted) document.dispatchEvent(new CustomEvent('aden-chat:toggle'));
      } catch {
        button.setAttribute('aria-label', document.documentElement.lang.startsWith('en') ? 'Chat failed to load. Click to retry.' : '聊天加载失败，点击重试');
      } finally { loading = false; button.removeAttribute('aria-busy'); }
    };
    button.hidden = false;
    button.addEventListener('click', toggle, { signal: scope.signal });
    if (new URLSearchParams(location.search).get('chat') === 'open' && button.getAttribute('aria-expanded') !== 'true') toggle();
  });
  // The menu button mirrors the theme's drawer state; Escape closes the drawer through the
  // theme's own toggle and returns focus to the button, as it does for the search popup.
  register('navbar-menu', '.navbar-container', (header, scope) => {
    const bar = header.querySelector('.navbar-bar'), drawer = header.querySelector('#navbar-drawer');
    if (!bar || !drawer) return;
    let wasOpen = false;
    const sync = () => {
      const open = document.body.classList.contains('navbar-drawer-show');
      bar.setAttribute('aria-expanded', String(open));
      if (open && !wasOpen) drawer.querySelector('a')?.focus({ preventScroll: true });
      if (wasOpen && !open && drawer.contains(document.activeElement)) bar.focus({ preventScroll: true });
      wasOpen = open;
    };
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !document.body.classList.contains('navbar-drawer-show')) return;
      bar.click();
      bar.focus({ preventScroll: true });
    }, { signal: scope.signal });
    sync();
    return () => observer.disconnect();
  });
  register('search-popup', '.search-pop-overlay', (overlay, scope) => {
    let opener = null;
    const observer = new MutationObserver(() => {
      if (overlay.classList.contains('active')) { if (!overlay.contains(document.activeElement)) opener = document.activeElement; return; }
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    });
    observer.observe(overlay, { attributes: true, attributeFilter: ['class'] });
    // The theme focuses the input 500ms after opening, which can land after a quick Escape while
    // the overlay is still fading out; send that focus back to the control that opened the popup.
    document.addEventListener('focusin', event => {
      if (!overlay.classList.contains('active') && opener?.isConnected && overlay.contains(event.target)) opener.focus({ preventScroll: true });
    }, { signal: scope.signal });
    return () => observer.disconnect();
  });
  // On phones the chat launcher fades while an article is being scrolled and returns once the reader
  // pauses, so it is not sitting over the line being read. Its position and look do not change.
  register('article-reading', '.article-content', () => {
    const launcher = document.getElementById('aden-chat-launcher');
    if (!launcher || !window.matchMedia('(max-width: 768px)').matches) return;
    let timer = 0;
    const onScroll = () => {
      launcher.setAttribute('data-scrolling', '');
      clearTimeout(timer);
      timer = setTimeout(() => launcher.removeAttribute('data-scrolling'), 900);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      clearTimeout(timer);
      launcher.removeAttribute('data-scrolling');
    };
  });
  // On phones the chat launcher steps aside while the previous/next links of an article are on screen.
  register('article-end', '.article-nav', nav => {
    const launcher = document.getElementById('aden-chat-launcher');
    if (!launcher || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(entries => {
      launcher.toggleAttribute('data-yield', entries.some(entry => entry.isIntersecting));
    }, { rootMargin: '0px 0px -90px 0px' });
    observer.observe(nav);
    return () => {
      observer.disconnect();
      launcher.removeAttribute('data-yield');
    };
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
