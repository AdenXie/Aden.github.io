const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { tradingDay, mergeHistory, quoteDay, MAX_DAYS } = require('../tools/lib/boc-history.cjs');
const { previousHistory, serialize } = require('../tools/collect-exchange.cjs');

test('small-hours quotes close the previous trading day; Monday small hours stay Monday', () => {
  assert.equal(tradingDay('2026-11-20 23:55:56'), '2026-11-20');
  assert.equal(tradingDay('2026-11-21 00:30:00'), '2026-11-20'); // Saturday 00:30 is Friday's close
  assert.equal(tradingDay('2026-11-23 01:00:00'), '2026-11-23'); // Monday 01:00 is not Sunday
  assert.equal(tradingDay('2026-11-23 10:30:00'), '2026-11-23');
  assert.equal(tradingDay('2026/11/23 10:30:00'), null);
});

test('merge keeps one sorted entry per day, the later source winning, and drops bad rows', () => {
  const merged = mergeHistory(
    [['2026-11-19', 445.65, 449.19], ['2026-11-18', 446, 450]],
    [['2026-11-19', 444, 448], ['2026-11-20', 442.31, 445.83], ['bad', 1, 2], ['2026-11-21', 450, 440]],
    [quoteDay({ publishedAt: '2026-11-21 00:10:00', spotBuy: 442.5, spotSell: 446 })]
  );
  assert.deepEqual(merged, [['2026-11-18', 446, 450], ['2026-11-19', 444, 448], ['2026-11-20', 442.5, 446]]);
});

test('merge is capped to the newest days', () => {
  const days = Array.from({ length: MAX_DAYS + 5 }, (_, i) => [new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10), 400, 401]);
  const merged = mergeHistory(days);
  assert.equal(merged.length, MAX_DAYS);
  assert.equal(merged.at(-1)[0], days.at(-1)[0]);
});

test('collector starts from the seed when no snapshot exists but refuses to write blind', async () => {
  assert.deepEqual(await previousHistory(async () => ({ status: 404, ok: false })), []);
  assert.deepEqual(await previousHistory(async () => ({ status: 200, ok: true, json: async () => ({ history: [['2026-11-20', 1, 2]] }) })), [['2026-11-20', 1, 2]]);
  let calls = 0;
  await assert.rejects(previousHistory(async () => { calls += 1; throw new Error('offline'); }), /could not be read/);
  assert.equal(calls, 3);
});

test('serialized snapshot is valid JSON with history one day per line', () => {
  const text = serialize({ currency: 'AUD', history: [['2026-11-19', 1, 2], ['2026-11-20', 1, 2]] });
  assert.deepEqual(JSON.parse(text).history, [['2026-11-19', 1, 2], ['2026-11-20', 1, 2]]);
  assert.match(text, /\n {4}\["2026-11-20",1,2\]\n/);
});

test('seed history is valid, sorted and recent', () => {
  const seed = JSON.parse(fs.readFileSync(path.join(__dirname, '../tools/data/aud-cny-history-seed.json'), 'utf8'));
  assert.deepEqual(mergeHistory(seed), seed);
  assert(seed.length >= 30);
});

const apiDir = path.join(__dirname, '../source/api');
function loadApi(snapshot) {
  const modules = {};
  const load = name => {
    if (modules[name]) return modules[name].exports;
    const module = modules[name] = { exports: {} };
    const context = vm.createContext({ module, exports: module.exports, require: p => load(path.basename(p)),
      fetch: async () => ({ ok: true, json: async () => snapshot }), AbortController, Date, console: { warn() {} }, setTimeout, clearTimeout });
    vm.runInContext(fs.readFileSync(path.join(apiDir, name), 'utf8'), context);
    return module.exports;
  };
  return load;
}
const respond = async handler => {
  const response = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { this.body = JSON.parse(body); } };
  await handler({ method: 'GET' }, response);
  return response;
};
const snapshot = () => ({ currency: 'AUD', quoteCurrency: 'CNY', officialUnit: 'CNY per 100 AUD', spotBuy: 442.31, spotSell: 445.83,
  publishedAt: '2026-11-20 23:55:56', source: { url: 'https://www.bankofchina.com/sourcedb/whpj/' }, fetchedAt: new Date().toISOString(), stale: false,
  history: [['2026-11-19', 445.65, 449.19], ['2026-11-20', 442.31, 445.83], ['x', 1, 2]] });

test('quote endpoint leaves history out; history endpoint returns only valid days with the same caching', async () => {
  const load = loadApi(snapshot());
  const quote = await respond(load('aud-cny.js'));
  assert.equal(quote.statusCode, 200); assert.equal(quote.body.history, undefined);
  const history = await respond(load('aud-cny-history.js'));
  assert.equal(history.statusCode, 200);
  assert.deepEqual(history.body.days, [['2026-11-19', 445.65, 449.19], ['2026-11-20', 442.31, 445.83]]);
  assert.equal(history.body.officialUnit, 'CNY per 100 AUD');
  assert.match(history.headers['Vercel-CDN-Cache-Control'], /s-maxage=/);
});

test('the card assigns quotes to the same trading day as the collector', () => {
  const script = fs.readFileSync(path.join(__dirname, '../source/js/cyber-exchange.js'), 'utf8');
  const source = script.match(/function tradingDay\(publishedAt\) \{[\s\S]*?\n  \}/)[0];
  const cardDay = vm.runInNewContext(`(${source})`);
  for (const at of ['2026-11-20 23:55:56', '2026-11-21 00:30:00', '2026-11-23 01:00:00', '2026-11-23 10:30:00', 'bad'])
    assert.equal(cardDay(at), tradingDay(at));
});
