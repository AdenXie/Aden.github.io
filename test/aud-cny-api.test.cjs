const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../source/api/aud-cny.js'), 'utf8');
const html = `<table><tr data-currency='澳大利亚元'><td>澳大利亚元</td><td>475.31</td><td>475.31</td><td>479.09</td><td>479.09</td><td>478.41</td><td>2026/09/17 12:33:38</td></tr></table>`;
function setup(fetch, snapshot = null) {
  const timers = [], logs = [];
  const context = vm.createContext({ module: { exports: {} },
    fetch: (url, options) => url.includes('raw.githubusercontent.com')
      ? Promise.resolve({ ok: Boolean(snapshot), json: async () => snapshot }) : fetch(url, options), AbortController, Date,
    console: { warn: (...args) => logs.push(args) },
    setTimeout(fn, ms) { timers.push(ms); return setTimeout(fn, 20); }, clearTimeout });
  vm.runInContext(source, context);
  return { timers, logs, async request(method = 'GET') {
    const response = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { this.body = JSON.parse(body); } };
    await context.module.exports({ method }, response);
    return response;
  } };
}
const stalled = signal => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true }));

test('official alternate recovers when primary stalls and cancels losing request', async () => {
  let primarySignal;
  const h = setup(async (url, { signal }) => {
    if (url.includes('bankofchina.com')) { primarySignal = signal; return stalled(signal); }
    return { ok: true, text: async () => html };
  });
  const r = await h.request();
  assert.equal(r.statusCode, 200); assert.equal(r.body.spotBuy, 475.31);
  assert.equal(r.body.spotSell, 479.09); assert.equal(r.body.stale, false);
  assert.equal(primarySignal.aborted, true); assert.deepEqual(h.timers, [2000, 12000]);
});

test('invalid primary HTML cannot beat a valid alternate', async () => {
  const h = setup(async url => ({ ok: true, text: async () => url.includes('bankofchina') ? '<html>error</html>' : html }));
  assert.equal((await h.request()).body.spotBuy, 475.31);
});

test('body stalls on both official hosts have one bounded deadline and useful error', async () => {
  const h = setup(async (_, { signal }) => ({ ok: true, text: () => stalled(signal) }));
  const r = await h.request();
  assert.equal(r.statusCode, 502); assert.equal(r.body.error, 'source_timeout');
  assert.match(r.headers['Cache-Control'], /no-store/); assert.equal(h.logs.length, 1);
});

test('warm fallback keeps original timestamp and cannot receive a fresh CDN lifetime', async () => {
  let fail = false;
  const h = setup(async () => { if (fail) throw new Error('unreachable'); return { ok: true, text: async () => html }; });
  const first = await h.request(); fail = true;
  const r = await h.request();
  assert.equal(r.statusCode, 200); assert.equal(r.body.stale, true);
  assert.equal(r.body.fetchedAt, first.body.fetchedAt);
  assert.equal(r.body.publishedAt, first.body.publishedAt);
  assert.match(r.headers['Cache-Control'], /no-store/);
  assert.equal(r.headers['Vercel-CDN-Cache-Control'], undefined);
});

test('cold failures stay errors and non-GET requests never contact BOC', async () => {
  let calls = 0;
  const h = setup(async () => { calls++; throw new Error('unreachable'); });
  assert.equal((await h.request('POST')).statusCode, 405); assert.equal(calls, 0);
  const r = await h.request(); assert.equal(r.statusCode, 502); assert.equal(r.body.error, 'source_unavailable');
});

const snapshotQuote = () => ({ currency: 'AUD', quoteCurrency: 'CNY', officialUnit: 'CNY per 100 AUD',
  spotBuy: 475.31, spotSell: 479.09, publishedAt: '2026-09-17 12:33:38',
  source: { url: 'https://www.bankofchina.com/sourcedb/whpj/' }, fetchedAt: new Date().toISOString(), stale: false });

test('fresh official collector snapshot works even when Vercel cannot reach either bank host', async () => {
  let calls = 0; const quote = snapshotQuote();
  const h = setup(async () => { calls++; throw new Error('blocked'); }, quote);
  const r = await h.request(); assert.equal(r.statusCode, 200); assert.equal(calls, 0);
  assert.equal(r.body.fetchedAt, quote.fetchedAt); assert.equal(r.body.stale, false);
});

test('old collector snapshot is explicitly stale and not CDN-cacheable when direct fetch fails', async () => {
  const quote = { ...snapshotQuote(), fetchedAt: new Date(Date.now() - 4 * 3600000).toISOString() };
  const h = setup(async () => { throw new Error('blocked'); }, quote);
  const r = await h.request(); assert.equal(r.body.stale, true); assert.equal(r.body.fetchedAt, quote.fetchedAt);
  assert.match(r.headers['Cache-Control'], /no-store/);
});

test('invalid, future and expired collector data cannot masquerade as a fresh quote', async () => {
  for (const quote of [{ ...snapshotQuote(), source: { url: 'https://example.com' } },
    { ...snapshotQuote(), fetchedAt: new Date(Date.now() + 3600000).toISOString() },
    { ...snapshotQuote(), fetchedAt: new Date(Date.now() - 8 * 86400000).toISOString() }]) {
    const h = setup(async () => { throw new Error('blocked'); }, quote);
    assert.equal((await h.request()).statusCode, 502);
  }
});
