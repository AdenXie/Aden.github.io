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
