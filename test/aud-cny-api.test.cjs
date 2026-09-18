const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../source/api/aud-cny.js'), 'utf8');
const quote = () => ({ currency: 'AUD', quoteCurrency: 'CNY', officialUnit: 'CNY per 100 AUD',
  spotBuy: 475.31, spotSell: 479.09, publishedAt: '2026-09-17 12:33:38',
  source: { url: 'https://www.bankofchina.com/sourcedb/whpj/' }, fetchedAt: new Date().toISOString(), stale: false });
const stalled = signal => new Promise((_, reject) => signal.addEventListener('abort',
  () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true }));
function setup(fetch) {
  const calls = [], timers = [];
  const context = vm.createContext({ module: { exports: {} },
    fetch: (url, options) => { calls.push(url); return fetch(url, options); }, AbortController, Date,
    console: { warn() {} },
    setTimeout(fn, ms) { timers.push(ms); return setTimeout(fn, 20); }, clearTimeout });
  vm.runInContext(source, context);
  return { calls, timers, async request(method = 'GET') {
    const response = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { this.body = JSON.parse(body); } };
    await context.module.exports({ method }, response);
    assert(calls.every(url => url === 'https://raw.githubusercontent.com/AdenXie/Aden.github.io/exchange-rates/aud-cny.json'),
      'Vercel must never contact a bank host');
    return response;
  } };
}
test('fresh snapshot is the only upstream request and retains acquisition time', async () => {
  const q = quote();
  const h = setup(async () => ({ ok: true, json: async () => q }));
  const r = await h.request();
  assert.equal(r.statusCode, 200); assert.equal(r.body.fetchedAt, q.fetchedAt);
  assert.equal(r.body.stale, false); assert.equal(h.calls.length, 1);
  assert.deepEqual(h.timers, [2000]); assert.match(r.headers['Vercel-CDN-Cache-Control'], /s-maxage=/);
});
test('old snapshot is returned immediately as stale with no fresh CDN lifetime', async () => {
  const q = { ...quote(), fetchedAt: new Date(Date.now() - 4 * 3600000).toISOString() };
  const h = setup(async () => ({ ok: true, json: async () => q }));
  const r = await h.request();
  assert.equal(r.statusCode, 200); assert.equal(r.body.stale, true);
  assert.equal(r.body.fetchError, 'snapshot_stale'); assert.equal(r.body.fetchedAt, q.fetchedAt);
  assert.equal(h.calls.length, 1); assert.match(r.headers['Cache-Control'], /no-store/);
});
test('GitHub failure reuses only a previously validated snapshot and does not redate it', async () => {
  let fail = false;
  const h = setup(async () => { if (fail) throw Error('offline'); return { ok: true, json: async () => quote() }; });
  const first = await h.request(); fail = true;
  const r = await h.request();
  assert.equal(r.body.fetchedAt, first.body.fetchedAt); assert.equal(r.body.stale, true);
  assert.equal(r.body.fetchError, 'snapshot_unavailable'); assert.match(r.headers['Cache-Control'], /no-store/);
});
test('missing, invalid, future and expired snapshots fail without trying BOC', async () => {
  for (const q of [null, {}, { ...quote(), source: { url: 'https://example.com' } },
    { ...quote(), fetchedAt: new Date(Date.now() + 3600000).toISOString() },
    { ...quote(), fetchedAt: new Date(Date.now() - 8 * 86400000).toISOString() }]) {
    const h = setup(async () => ({ ok: Boolean(q), json: async () => q }));
    const r = await h.request();
    assert.equal(r.statusCode, 502); assert.equal(r.body.error, 'snapshot_unavailable');
    assert.equal(h.calls.length, 1); assert.match(r.headers['Cache-Control'], /no-store/);
  }
});
test('snapshot body timeout ends within its single budget, without a bank fallback', async () => {
  const h = setup(async (_, { signal }) => ({ ok: true, json: () => stalled(signal) }));
  const r = await h.request(); assert.equal(r.statusCode, 502);
  assert.equal(r.body.error, 'snapshot_unavailable'); assert.deepEqual(h.timers, [2000]);
  assert.equal(h.calls.length, 1);
});
test('non-GET requests do not fetch even the snapshot', async () => {
  const h = setup(async () => { throw Error('unexpected'); });
  assert.equal((await h.request('POST')).statusCode, 405); assert.equal(h.calls.length, 0);
});
