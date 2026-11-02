const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { transformSync } = require('esbuild');
const sharp = require('sharp');
const { altitude } = require('../source/js/world-time.js');

// Run the production module's pure geometry / scheduler with the installed r170
// math classes, without pretending a Node canvas can validate a GPU shader.
const source = fs.readFileSync(path.join(__dirname, '../source/js/scenes/world-globe.js'), 'utf8').replace("from '/js/vendor/three-0.170.0.module.min.js'", "from 'three'");
const context = { module: { exports: {} }, require };
vm.runInNewContext(transformSync(source, { format: 'cjs', target: 'es2020' }).code, context);
const { geoVector, quality, frameLoop, layoutLabels } = context.module.exports;
const THREE = require('three');

test('globe coordinates align with the equirectangular texture and solar altitude', () => {
  assert.ok(geoVector(0, 0).distanceTo({ x: 1, y: 0, z: 0 }) < 1e-10);
  assert.ok(geoVector(-90, 0).distanceTo({ x: 0, y: 0, z: 1 }) < 1e-10);
  assert.ok(geoVector(0, 90).distanceTo({ x: 0, y: 1, z: 0 }) < 1e-10);
  const sun = { lon: -70, lat: -15 };
  for (const [lon, lat] of [[151.21, -33.87], [-0.13, 51.51], [-180, 0], [180, 0], [120, 80]]) {
    const dot = geoVector(lon, lat).dot(geoVector(sun.lon, sun.lat));
    assert.ok(Math.abs(Math.asin(dot) * 180 / Math.PI - altitude(sun, lat, lon)) < 1e-10);
  }
});

test('phone, low-memory and data-saving profiles cap pixel density, textures and frame rate', () => {
  const desktop = quality({ dpr: 3 });
  assert.equal(desktop.dpr, 1.5); assert.equal(desktop.texture, 2048); assert.equal(desktop.fps, 45);
  for (const hints of [{ coarse: true }, { memory: 2 }, { saveData: true }]) {
    const phone = quality({ dpr: 3, ...hints });
    assert.equal(phone.dpr, 1.25); assert.equal(phone.texture, 1024); assert.equal(phone.fps, 30);
    assert.ok(phone.segments < desktop.segments && phone.stars < desktop.stars);
  }
});

test('phone labels prioritize the current view and retain the clustered Australian and US cities', () => {
  const cities = require('../lib/world-time-cities.json');
  for (const [lon, lat, wanted, selected] of [
    [145, -30, ['sydney', 'melbourne', 'hobart', 'brisbane', 'perth', 'auckland']],
    [-100, 35, ['new-york', 'toronto', 'champaign', 'atlanta', 'los-angeles']],
    [-74.01, 40.71, ['new-york', 'toronto', 'champaign', 'atlanta', 'los-angeles'], 'new-york']
  ]) {
    const width = 320, height = 288;
    const camera = new THREE.OrthographicCamera(-1.3 * width / height, 1.3 * width / height, 1.3, -1.3, 0.1, 100);
    const direction = geoVector(lon, lat);
    camera.position.copy(direction).multiplyScalar(5); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
    const items = cities.map(city => {
      const unit = geoVector(city.lon, city.lat), point = unit.clone().multiplyScalar(1.018).project(camera);
      return { id: city.id, x: (point.x + 1) * width / 2, y: (1 - point.y) * height / 2, facing: unit.dot(direction), w: city.name.length * 11 + 4, h: 20, selected: city.id === selected };
    }).filter(item => item.facing > 0.005);
    const placed = layoutLabels(items, width, height);
    for (const id of wanted) assert.ok(placed.some(item => item.id === id), `${lon}/${lat}: ${id} must stay visible`);
    for (const a of placed) for (const b of placed) {
      if (a.id === b.id) continue;
      assert.ok(a.left + a.w + 2 <= b.left - 2 || b.left + b.w + 2 <= a.left - 2 || a.top + a.h + 2 <= b.top - 2 || b.top + b.h + 2 <= a.top - 2, `${a.id}/${b.id}: labels must not overlap`);
    }
    for (const item of placed) {
      const dx = Math.max(item.left - item.x, item.x - item.left - item.w, 0);
      const dy = Math.max(item.top - item.y, item.y - item.top - item.h, 0);
      assert.ok(Math.hypot(dx, dy) <= 24, `${item.id}: label must stay next to its city point`);
    }
  }
});

function scheduler(options = {}) {
  let id = 0;
  const pending = new Map(), draws = [];
  const state = { visible: true, moving: true };
  const loop = frameLoop((time, elapsed) => draws.push({ time, elapsed }), {
    fps: 45, running: () => state.visible, moving: () => state.moving,
    request: cb => { pending.set(++id, cb); return id; }, cancel: id => pending.delete(id), ...options
  });
  return { state, loop, draws, pending, step(time) { const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach(cb => cb(time)); } };
}

test('renderer respects a 45 fps budget on a 60 Hz display without falling to 30 fps', () => {
  const s = scheduler(); s.loop.wake();
  for (let frame = 0; frame < 60; frame++) s.step(frame * 1000 / 60);
  assert.ok(s.draws.length >= 44 && s.draws.length <= 46, String(s.draws.length));
  assert.equal(s.pending.size, 1);
  s.loop.dispose(); assert.equal(s.pending.size, 0);
});

test('paused / reduced-motion rendering draws on demand and queues no idle RAF', () => {
  const s = scheduler(); s.state.moving = false; s.loop.wake(); s.step(0);
  assert.equal(s.draws.length, 1); assert.equal(s.pending.size, 0);
  s.loop.wake(); s.loop.wake(); assert.equal(s.pending.size, 1);
  s.step(100); assert.equal(s.draws.length, 2); assert.equal(s.pending.size, 0);
});

test('offscreen / hidden work stops, resume does not jump, and disposal cannot restart', () => {
  const s = scheduler(); s.loop.wake(); s.step(0); s.step(40);
  s.state.visible = false; s.loop.stop(); s.loop.wake();
  assert.equal(s.pending.size, 0);
  s.state.visible = true; s.loop.wake(); s.step(360000);
  assert.equal(s.draws.at(-1).elapsed, 0);
  s.loop.dispose(); s.loop.wake(); assert.equal(s.pending.size, 0);
});

test('local NASA textures meet the transfer and GPU resolution budgets', async () => {
  for (const [width, budget] of [[1024, 80000], [2048, 260000]]) {
    let total = 0;
    for (const name of ['day', 'night']) {
      const file = path.join(__dirname, `../source/images/earth/${name}-${width}-v1.webp`);
      const meta = await sharp(file).metadata();
      assert.equal(meta.width, width); assert.equal(meta.height, width / 2);
      total += fs.statSync(file).size;
    }
    assert.ok(total < budget, `${width} texture bytes: ${total}`);
  }
});
