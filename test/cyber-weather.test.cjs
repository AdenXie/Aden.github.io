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

function harness({ cached = null, blocked = false, responses = [fixture()], deviceTimeZone = 'Asia/Shanghai' } = {}) {
  const calls = [];
  const removed = [];
  const nodes = new Map();
  const classes = new Set();
  const timers = [];
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
    Intl: { DateTimeFormat: function (locale, options) { return new Intl.DateTimeFormat(locale, { timeZone: deviceTimeZone, ...options }); } }, Date, AbortController,
    console: { warn() {} },
    window: { setTimeout(fn, ms) { timers.push(ms); return setTimeout(fn, ms === 1500 ? 0 : 30); }, clearTimeout, addEventListener() {} },
    document: { readyState: 'loading', addEventListener() {} },
    sessionStorage: {
      getItem() { if (blocked) throw new Error('Storage blocked'); return stored; },
      setItem(_, value) { if (blocked) throw new Error('Storage blocked'); stored = value; },
      removeItem(key) { if (blocked) throw new Error('Storage blocked'); removed.push(key); stored = null; }
    },
    fetch: async (url, options) => {
      const result = responses[calls.length];
      calls.push(url);
      if (result instanceof Error) throw result;
      if (typeof result === 'function') return result(options);
      if (result?.status) return { ok: false, status: result.status, json: async () => result.body };
      return { ok: true, json: async () => result };
    }
  });
  // Expose private functions only inside this test VM; the shipped file stays an IIFE.
  vm.runInContext(script.replace(/\}\)\(\);\s*$/, 'globalThis.loadWeatherForTest = loadWeather; })();'), context);
  return {
    run: () => context.loadWeatherForTest(card), calls, removed, classes, timers,
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

test('temporary network failure retries the same IP weather endpoint once', async () => {
  const h = harness({ responses: [new Error('network'), fixture()] });
  await h.run();
  assert.deepEqual(h.calls, ['/api/visitor-weather', '/api/visitor-weather']);
  assert.equal(h.text('[data-weather="status"]'), 'LOCATION LINK / IP APPROX');
  assert.deepEqual(h.timers, [15000, 1500, 15000]);
});

test('invalid response renders a data error without retrying or changing device timezone', async () => {
  const h = harness({ responses: [{}] });
  await h.run();
  assert.equal(h.calls.length, 1);
  assert.equal(h.text('.cyber-condition'), '天气服务返回的数据异常');
  assert.equal(h.text('[data-location="timezone"]'), 'Asia/Shanghai');
  assert.equal(h.text('[data-location="name"]'), '设备时间');
  assert.ok(h.classes.has('is-offline'));
});

test('blocked storage plus both network failures still renders offline', async () => {
  const h = harness({ blocked: true, responses: [new Error('timeout'), new Error('offline')] });
  await h.run();
  assert.equal(h.calls.length, 2);
  assert.equal(h.text('[data-weather="status"]'), 'LOCATION LINK / OFFLINE · 设备时间');
  assert.equal(h.text('.cyber-condition'), '无法连接天气服务，请检查网络');
});

for (const [code, status, message, attempts] of [
  ['location_unavailable', 503, '暂时无法识别 IP 所在地区', 1],
  ['weather_timeout', 502, '天气数据源响应超时', 2],
  ['weather_unavailable', 502, '天气数据源暂不可用', 2],
  [null, 404, '天气接口不存在（404）', 1],
  [null, 403, '天气请求被拒绝', 1],
  [null, 429, '天气请求过于频繁，请稍后再试', 1]
]) {
  test(`weather HTTP ${status} / ${code} has a specific message and bounded retry`, async () => {
    const response = { status, body: { error: code } };
    const h = harness({ responses: [response, response], deviceTimeZone: 'Europe/London' });
    await h.run();
    assert.equal(h.calls.length, attempts);
    assert.equal(h.text('.cyber-condition'), message);
    assert.equal(h.text('[data-location="timezone"]'), 'Europe/London');
  });
}

test('old Sydney fallback cache is ignored', async () => {
  const payload = fixture();
  payload.location.source = 'fallback';
  const h = harness({ cached: JSON.stringify({ savedAt: Date.now(), payload }) });
  await h.run();
  assert.equal(h.calls.length, 1);
  assert.equal(h.text('[data-weather="status"]'), 'LOCATION LINK / IP APPROX');
});

test('response body timeout retries once and preserves the device timezone', async () => {
  const stalled = ({ signal }) => ({ ok: true, json: () => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
  }) });
  const h = harness({ responses: [stalled, stalled] });
  await h.run();
  assert.deepEqual(h.timers, [15000, 1500, 15000]);
  assert.equal(h.text('.cyber-condition'), '连接天气服务超时');
  assert.equal(h.text('[data-location="timezone"]'), 'Asia/Shanghai');
});
