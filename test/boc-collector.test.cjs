const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../tools/lib/boc-rates.cjs'), 'utf8');
const html = "<tr data-currency='澳大利亚元'><td>澳大利亚元</td><td>475.31</td><td>475.31</td><td>479.09</td><td>479.09</td><td>478.41</td><td>2026/09/17 12:33:38</td></tr>";
function setup(fetch) {
  const context = vm.createContext({ module: { exports: {} }, fetch, AbortController, Date,
    setTimeout: fn => setTimeout(fn, 20), clearTimeout });
  vm.runInContext(source, context);
  return context.module.exports;
}
const stall = signal => new Promise((_, reject) => signal.addEventListener('abort',
  () => reject(Object.assign(Error('aborted'), { name: 'AbortError' })), { once: true }));
test('Actions collector still reads alternate official host and cancels stalled primary', async () => {
  let signal;
  const collector = setup(async (url, options) => {
    if (url.includes('bankofchina.com')) { signal = options.signal; return stall(signal); }
    return { ok: true, text: async () => html };
  });
  const q = await collector.fetchOfficialRates();
  assert.equal(q.spotBuy, 475.31); assert.equal(q.spotSell, 479.09);
  assert.equal(q.officialUnit, 'CNY per 100 AUD'); assert.equal(signal.aborted, true);
});
test('collector validates HTML before accepting the first response', async () => {
  const collector = setup(async url => ({ ok: true, text: async () => url.includes('bankofchina') ? 'invalid' : html }));
  assert.equal((await collector.fetchOfficialRates()).spotSell, 479.09);
});
test('collector body stalls are bounded and do not produce a snapshot', async () => {
  const collector = setup(async (_, { signal }) => ({ ok: true, text: () => stall(signal) }));
  await assert.rejects(collector.fetchOfficialRates(), { name: 'AbortError' });
});
