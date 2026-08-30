const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '../source/js/cyber-weather.js'), 'utf8');
const fixture = () => ({
  location: { label: 'Nanjing', timezone: 'Asia/Shanghai' },
  current: {
    temperature_2m: 25, weather_code: 3, apparent_temperature: 26,
    relative_humidity_2m: 70, wind_speed_10m: 5
  },
  daily: { sunset: ['2026-08-31T18:30'] }
});

function harness({ cached = null, blocked = false, responses = [fixture()] } = {}) {
  const calls = [];
  const removed = [];
  const nodes = new Map();
  const classes = new Set();
  const card = {
    isConnected: true,
    setAttribute() {},
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, { textContent: '' });
      return nodes.get(selector);
    },
    classList: { add: value => classes.add(value), remove: value => classes.delete(value) }
  };
  let stored = cached;
  const context = vm.createContext({
    Intl, Date, AbortController,
    console: { warn() {} },
    window: { setTimeout, clearTimeout, addEventListener() {} },
    document: { readyState: 'loading', addEventListener() {} },
    sessionStorage: {
      getItem() { if (blocked) throw new Error('Storage blocked'); return stored; },
      setItem(_, value) { if (blocked) throw new Error('Storage blocked'); stored = value; },
      removeItem(key) { if (blocked) throw new Error('Storage blocked'); removed.push(key); stored = null; }
    },
    fetch: async url => {
      const result = responses[calls.length];
      calls.push(url);
      if (result instanceof Error) throw result;
      return { ok: true, json: async () => result };
    }
  });
  // Expose private functions only inside this test VM; the shipped file stays an IIFE.
  vm.runInContext(script.replace(/\}\)\(\);\s*$/, 'globalThis.loadWeatherForTest = loadWeather; })();'), context);
  return {
    run: () => context.loadWeatherForTest(card), calls, removed, classes,
    text: selector => card.querySelector(selector).textContent,
    stored: () => stored
  };
}

test('blocked reads, removals and writes still fetch and render live weather', async () => {
  const h = harness({ blocked: true });
  await h.run();
  assert.deepEqual(h.calls, ['/api/visitor-weather']);
  assert.equal(h.text('.cyber-temperature'), '25°');
  assert.equal(h.text('[data-weather="status"]'), 'LOCATION LINK / IP APPROX');
});

const corruptEntries = [
  ['broken JSON', '{'],
  ['empty payload', JSON.stringify({ savedAt: Date.now(), payload: {} })],
  ['missing location', JSON.stringify({ savedAt: Date.now(), payload: { current: fixture().current } })],
  ['empty current weather', JSON.stringify({ savedAt: Date.now(), payload: { ...fixture(), current: {} } })],
  ['invalid timezone', JSON.stringify({ savedAt: Date.now(), payload: { ...fixture(), location: { timezone: 'invalid' } } })],
  ['expired cache', JSON.stringify({ savedAt: Date.now() - 600001, payload: fixture() })],
  ['future timestamp', JSON.stringify({ savedAt: Date.now() + 600000, payload: fixture() })],
  ['nonnumeric timestamp', JSON.stringify({ savedAt: String(Date.now()), payload: fixture() })]
];

for (const [name, cached] of corruptEntries) {
  test(`${name} is discarded and live weather is requested`, async () => {
    const h = harness({ cached });
    await h.run();
    assert.equal(h.calls.length, 1);
    assert.equal(h.removed.length, 1);
    assert.equal(h.text('[data-weather="status"]'), 'LOCATION LINK / IP APPROX');
    assert.ok(JSON.parse(h.stored()).payload.current);
  });
}

test('valid fresh cache renders without a network request', async () => {
  const h = harness({ cached: JSON.stringify({ savedAt: Date.now(), payload: fixture() }) });
  await h.run();
  assert.equal(h.calls.length, 0);
  assert.equal(h.text('[data-weather="status"]'), 'LOCATION LINK / CACHED');
});

test('malformed optional sunset does not interrupt cached rendering', async () => {
  const payload = { ...fixture(), daily: { sunset: [123] } };
  const h = harness({ cached: JSON.stringify({ savedAt: Date.now(), payload }) });
  await h.run();
  assert.equal(h.calls.length, 0);
  assert.equal(h.text('[data-weather="sunset"]'), '--:--');
  assert.equal(h.text('[data-weather="status"]'), 'LOCATION LINK / CACHED');
});

test('invalid primary response uses the Sydney fallback', async () => {
  const h = harness({ responses: [{}, fixture()] });
  await h.run();
  assert.equal(h.calls.length, 2);
  assert.equal(h.text('[data-weather="status"]'), 'LOCATION LINK / SYDNEY FALLBACK');
});

test('invalid primary and fallback responses render offline, not locating', async () => {
  const h = harness({ responses: [{}, {}] });
  await h.run();
  assert.equal(h.calls.length, 2);
  assert.equal(h.text('.cyber-condition'), '气象数据暂不可用');
  assert.ok(h.classes.has('is-offline'));
});

test('blocked storage plus both network failures still renders offline', async () => {
  const h = harness({ blocked: true, responses: [new Error('timeout'), new Error('offline')] });
  await h.run();
  assert.equal(h.calls.length, 2);
  assert.equal(h.text('[data-weather="status"]'), 'LOCATION LINK / OFFLINE');
});
