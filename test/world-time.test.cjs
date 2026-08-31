const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');
const { snapshot, offsetLabel, compare } = require('../source/js/world-time.js');
const cities = require('../lib/world-time-cities.json');
const map = require('../lib/world-time-map.json');
const at = (date, zone) => snapshot(new Date(date), zone);

test('exactly the requested 21 distinct cities, with valid coordinates and IANA zones', () => {
  assert.equal(cities.length, 21);
  assert.equal(new Set(cities.map(c => c.id)).size, 21);
  assert.deepEqual(cities.map(c => c.name).sort(), ['多伦多','洛杉矶','纽约','华盛顿','亚特兰大','香槟','伦敦','莫斯科','斯德哥尔摩','迪拜','香港','北京','东京','新加坡','珀斯','悉尼','墨尔本','奥克兰','首尔','布里斯班','霍巴特'].sort());
  for (const city of cities) {
    assert.ok(city.lon >= -180 && city.lon <= 180 && city.lat > -60 && city.lat < 85);
    assert.match(at('2026-09-01T00:00:00Z', city.zone).time, /^\d\d:\d\d:\d\d$/);
  }
});
test('Champaign uses US Central time, Stockholm follows DST, and Dubai stays at UTC+4', () => {
  for (const [id, zone, winter, summer] of [
    ['champaign', 'America/Chicago', -360, -300],
    ['stockholm', 'Europe/Stockholm', 60, 120],
    ['dubai', 'Asia/Dubai', 240, 240]
  ]) {
    const city = cities.find(c => c.id === id);
    assert.equal(city.zone, zone);
    assert.equal(at('2026-01-15T12:00:00Z', city.zone).offset, winter);
    assert.equal(at('2026-07-15T12:00:00Z', city.zone).offset, summer);
  }
});
test('Sydney and New York compare date as well as time, not hours modulo 24', () => {
  const local = at('2026-09-01T00:00:00Z', 'Australia/Sydney');
  const remote = at('2026-09-01T00:00:00Z', 'America/New_York');
  assert.equal(local.time, '10:00:00');
  assert.equal(remote.time, '20:00:00');
  assert.deepEqual(compare(local, remote), { difference: '比你慢 14 小时', dayDifference: '当地日期比你早 1 天' });
});
test('southern summer changes the Sydney / New York difference to 16 hours', () => {
  assert.equal(compare(at('2026-01-15T12:00:00Z', 'Australia/Sydney'), at('2026-01-15T12:00:00Z', 'America/New_York')).difference, '比你慢 16 小时');
});
test('Brisbane has no DST; Sydney differs in January but matches in July', () => {
  assert.equal(compare(at('2026-01-15T00:00:00Z', 'Australia/Sydney'), at('2026-01-15T00:00:00Z', 'Australia/Brisbane')).difference, '比你慢 1 小时');
  assert.equal(compare(at('2026-07-15T00:00:00Z', 'Australia/Sydney'), at('2026-07-15T00:00:00Z', 'Australia/Brisbane')).difference, '与你的本地时间相同');
});
test('London and New York use their distinct DST transition dates', () => {
  assert.equal(at('2026-03-08T06:59:59Z', 'America/New_York').offset, -300);
  assert.equal(at('2026-03-08T07:00:00Z', 'America/New_York').offset, -240);
  assert.equal(at('2026-03-29T00:59:59Z', 'Europe/London').offset, 0);
  assert.equal(at('2026-03-29T01:00:00Z', 'Europe/London').offset, 60);
});
test('local device zones may have fractional offsets, even though selected cities do not', () => {
  const remote = at('2026-09-01T00:00:00Z', 'Asia/Kathmandu');
  assert.equal(remote.offset, 345);
  assert.equal(offsetLabel(remote.offset), 'UTC+05:45');
  assert.equal(compare(at('2026-09-01T00:00:00Z', 'UTC'), remote).difference, '比你快 5 小时 45 分钟');
});
test('midnight and milliseconds do not introduce a 24-hour offset', () => {
  const midnight = at('2026-08-31T16:00:00.950Z', 'Asia/Shanghai');
  assert.equal(midnight.time, '00:00:00');
  assert.equal(midnight.offset, 480);
  assert.equal(offsetLabel(-420), 'UTC−07:00');
});
test('international date-line comparison can span two calendar days', () => {
  assert.equal(compare(at('2026-01-01T10:30:00Z', 'Pacific/Pago_Pago'), at('2026-01-01T10:30:00Z', 'Pacific/Kiritimati')).dayDifference, '当地日期比你晚 2 天');
});
test('all America eastern cities keep their separate names but share current time', () => {
  const times = cities.filter(c => ['toronto','new-york','washington','atlanta'].includes(c.id)).map(c => at('2026-09-01T00:00:00Z', c.zone).time);
  assert.equal(new Set(times).size, 1);
});
test('tag renders accessible markers and buttons; assets are scoped to the page', () => {
  let render;
  const filename = path.join(__dirname, '../scripts/world-time.js');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: name => require(path.resolve(path.dirname(filename), name)),
    hexo: { extend: { filter: { register() {} }, tag: { register: (name, fn) => { assert.equal(name, 'world_time'); render = fn; } } } }
  });
  const html = render();
  assert.equal((html.match(/class="wt-marker"/g) || []).length, 21);
  assert.equal((html.match(/<button type="button"/g) || []).length, 21);
  assert.ok(html.includes('WORLD TIME / 21 CITIES'));
  assert.ok(!html.includes('圣路易斯'));
  assert.ok(html.includes('data-swup-reload-script'));
  assert.ok(html.includes('Natural Earth'));
  assert.ok(!html.includes('iframe'));
  const runtime = fs.readFileSync(path.join(__dirname, '../source/js/world-time.js'), 'utf8');
  assert.doesNotMatch(runtime, /\bfetch\(|XMLHttpRequest|geolocation|localStorage/);
  const css = fs.readFileSync(path.join(__dirname, '../source/css/world-time.css'), 'utf8');
  const total = Buffer.byteLength(html + runtime + css);
  assert.ok(total < 60000, `uncompressed page feature size: ${total}`);
  assert.ok(zlib.gzipSync(html + runtime + css).length < 20000);
  const config = fs.readFileSync(path.join(__dirname, '../_config.redefine.yml'), 'utf8');
  assert.ok(!config.includes('/js/world-time.js') && !config.includes('/css/world-time.css'));
  assert.ok(map.path.length < 25000);
});

test('global search keeps the world-time summary without map or code; other articles stay untouched', async () => {
  const filename = path.join(__dirname, '../scripts/world-time.js');
  let init, wrapped;
  const untouched = '<entry><title>Other</title><url>/about/index.html</url><content><![CDATA[Original content]]></content></entry>';
  const xml = `<search>${untouched}<entry><url>/world-time/index.html</url><content><![CDATA[<svg>large map</svg>]]></content></entry><entry><url>/css/world-time.css</url><content><![CDATA[CSS]]></content></entry><entry><url>/js/world-time.js</url><content><![CDATA[JS]]></content></entry></search>`;
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: name => require(path.resolve(path.dirname(filename), name)),
    hexo: { extend: { tag: { register() {} }, filter: { register: (name, fn) => { assert.equal(name, 'after_init'); init = fn; } } } }
  });
  init.call({ config: { search: { path: 'search.xml' } }, extend: { generator: { get: () => async () => ({ path: 'search.xml', data: xml }), register: (name, fn) => { assert.equal(name, 'xml'); wrapped = fn; } } } });
  const result = await wrapped({});
  assert.ok(result.data.includes(untouched));
  assert.ok(result.data.includes('多伦多') && result.data.includes('霍巴特'));
  assert.ok(!result.data.includes('large map') && !result.data.includes('/css/world-time') && !result.data.includes('/js/world-time'));
});
