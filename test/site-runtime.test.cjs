const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function harness() {
  const document = new EventTarget(), window = new EventTarget();
  const roots = new Map();
  Object.assign(document, { readyState: 'complete', hidden: false, querySelector: selector => roots.get(selector) });
  let intervals = 0;
  const context = vm.createContext({ window, document, AbortController, console, requestAnimationFrame: fn => fn(), setTimeout, clearTimeout,
    setInterval: () => { intervals++; return intervals; }, clearInterval: id => { if (id) intervals--; } });
  vm.runInContext(fs.readFileSync('source/js/site-runtime.js', 'utf8'), context);
  return { document, window, roots, api: window.AdenSite, intervals: () => intervals };
}
test('repeat registrations mount once; pagehide cancels work and pageshow remounts', () => {
  const h = harness(); let mounts = 0, cleanups = 0, signal;
  h.roots.set('#widget', {});
  const start = (_, scope) => { mounts++; signal = scope.signal; return () => cleanups++; };
  h.api.register('widget', '#widget', start); h.api.register('widget', '#widget', start);
  assert.equal(mounts, 1);
  h.window.dispatchEvent(new Event('pagehide')); assert.equal(signal.aborted, true); assert.equal(cleanups, 1);
  h.window.dispatchEvent(new Event('pageshow')); assert.equal(mounts, 2); assert.equal(signal.aborted, false);
});
test('clocks pause while hidden and update immediately when visible', () => {
  const h = harness(); let renders = 0;
  h.roots.set('#widget', {});
  h.api.register('widget', '#widget', (_, scope) => scope.clock(() => renders++));
  assert.equal(renders, 1); assert.equal(h.intervals(), 1);
  h.document.hidden = true; h.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(h.intervals(), 0); assert.equal(renders, 1);
  h.document.hidden = false; h.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(renders, 2); assert.equal(h.intervals(), 1);
  h.window.dispatchEvent(new Event('pagehide')); assert.equal(h.intervals(), 0);
});
test('retry delay resolves immediately when navigation cancels it', async () => {
  const h = harness(), controller = new AbortController();
  const pending = h.api.delay(10000, controller.signal);
  controller.abort(); await pending;
});
