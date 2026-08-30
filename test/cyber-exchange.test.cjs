const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '../source/js/cyber-exchange.js'), 'utf8');
const quote = () => ({ currency: 'AUD', officialUnit: 'CNY per 100 AUD', spotBuy: 480.69,
  spotSell: 484.51, publishedAt: '2026-08-30 10:30:00', stale: false });

function harness({ responses = [quote()], cached = null, blocked = false } = {}) {
  let stored = cached;
  const calls = [], timers = [], nodes = new Map(), classes = new Set();
  const card = { isConnected: true, querySelector(selector) {
    if (!nodes.has(selector)) nodes.set(selector, { textContent: '' });
    return nodes.get(selector);
  }, classList: { add: (...values) => values.forEach(v => classes.add(v)), remove: (...values) => values.forEach(v => classes.delete(v)) } };
  const context = vm.createContext({ Date, AbortController,
    document: { readyState: 'loading', addEventListener() {} },
    window: { addEventListener() {}, clearTimeout, setTimeout(fn, ms) {
      timers.push(ms); return setTimeout(fn, ms === 1500 ? 0 : 30);
    } },
    localStorage: {
      getItem() { if (blocked) throw new Error('blocked'); return stored; },
      setItem(_, value) { if (blocked) throw new Error('blocked'); stored = value; },
      removeItem() { if (blocked) throw new Error('blocked'); stored = null; }
    },
    fetch: async (url, options) => {
      const result = responses[calls.length]; calls.push(url);
      if (result instanceof Error) throw result;
      if (typeof result === 'function') return result(options);
      if (result?.status) return { ok: false, status: result.status, json: async () => result.body };
      return { ok: true, json: async () => result };
    }
  });
  vm.runInContext(script.replace(/\}\)\(\);\s*$/, 'globalThis.loadQuoteForTest = loadQuote; })();'), context);
  return { run: () => context.loadQuoteForTest(card), calls, timers, classes,
    text: key => card.querySelector(`[data-exchange="${key}"]`).textContent };
}

test('live per-100 AUD quote still renders when all localStorage operations are blocked', async () => {
  const h = harness({ blocked: true }); await h.run();
  assert.equal(h.text('buy'), '¥480.69');
  assert.equal(h.text('sell'), '¥484.51');
  assert.match(h.text('status'), /三小时缓存/);
});

test('valid three-hour browser cache avoids requests', async () => {
  const h = harness({ cached: JSON.stringify({ savedAt: Date.now(), payload: quote() }) });
  await h.run(); assert.equal(h.calls.length, 0); assert.match(h.text('status'), /缓存牌价/);
});

test('network failure retries once and can recover', async () => {
  const h = harness({ responses: [new Error('network'), quote()] }); await h.run();
  assert.deepEqual(h.calls, ['/api/aud-cny?v=2', '/api/aud-cny?v=2']);
  assert.deepEqual(h.timers, [15000, 1500, 15000]);
  assert.ok(h.classes.has('is-online'));
});

for (const [code, status, message, attempts] of [
  ['source_timeout', 502, '中行牌价源响应超时', 2],
  ['source_unavailable', 502, '中行牌价源读取失败', 2],
  [null, 404, '汇率接口不存在（404）', 1],
  [null, 403, '汇率请求被拒绝', 1],
  [null, 429, '汇率请求过于频繁', 1]
]) {
  test(`exchange HTTP ${status} / ${code} has a specific message and bounded retry`, async () => {
    const result = { status, body: { error: code } };
    const h = harness({ responses: [result, result] }); await h.run();
    assert.equal(h.calls.length, attempts); assert.ok(h.text('status').includes(message));
    assert.match(h.text('status'), /暂无可用缓存/);
  });
}

test('expired-but-usable quote retains prices, original publication time and failure reason', async () => {
  const h = harness({ cached: JSON.stringify({ savedAt: Date.now() - 4 * 3600000, payload: quote() }),
    responses: [new Error('network'), new Error('network')] });
  await h.run(); assert.equal(h.text('buy'), '¥480.69');
  assert.match(h.text('status'), /无法连接汇率服务.*显示缓存牌价.*2026-08-30 10:30/);
  assert.ok(h.classes.has('is-stale'));
});

test('server stale quote includes its source failure reason', async () => {
  const h = harness({ responses: [{ ...quote(), stale: true, fetchError: 'source_timeout' }] });
  await h.run(); assert.match(h.text('status'), /中行牌价源响应超时.*显示缓存牌价/);
});

test('invalid quote produces a data error without retrying', async () => {
  const h = harness({ responses: [{}] }); await h.run();
  assert.equal(h.calls.length, 1); assert.match(h.text('status'), /返回的数据异常/);
});

test('response body timeout uses the extended budget and only one retry', async () => {
  const stalled = ({ signal }) => ({ ok: true, json: () => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
  }) });
  const h = harness({ responses: [stalled, stalled] }); await h.run();
  assert.deepEqual(h.timers, [15000, 1500, 15000]);
  assert.match(h.text('status'), /连接汇率服务超时/);
});
