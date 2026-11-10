'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const load = () => import(pathToFileURL(path.join(__dirname, '../source/js/scenes/sky-math.js')).href);
const near = (a, b, tol, label) => assert(Math.abs(a - b) <= tol, `${label}: ${a} vs ${b} (±${tol})`);
const angle = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

test('sidereal time matches GMST at J2000 and advances a sidereal day', async () => {
  const m = await load();
  const j2000 = Date.UTC(2000, 0, 1, 12);
  near(m.siderealDegrees(j2000, 0), 280.46061837, 1e-6, 'GMST J2000');
  near(m.siderealDegrees(j2000, 151.21), (280.46061837 + 151.21) % 360, 1e-6, 'LST Sydney');
  near(angle(m.siderealDegrees(j2000 + 86164091, 0), 280.46061837), 0, 0.01, 'one sidereal day later');
});

test('horizon frame: pole at the latitude, a star at the zenith when LST = RA and lat = dec', async () => {
  const m = await load();
  const t = Date.UTC(2026, 10, 11, 10);
  for (const lat of [51.5, -33.87, 1.35]) {
    const basis = m.horizonBasis(lat, 0, t);
    const [alt, az] = m.altAz(m.toHorizon(basis, [0, 0, 1]));
    near(alt, lat, 1e-9, `north pole altitude at ${lat}`);
    if (lat > 0) near(az, 0, 1e-9, 'pole due north');
    const lst = m.siderealDegrees(t, 0);
    near(m.altAz(m.toHorizon(basis, m.equatorial(lst, lat)))[0], 90, 1e-6, 'zenith star');
    // On the equator six hours east of the meridian: rising due east.
    const [ea, eaz] = m.altAz(m.toHorizon(basis, m.equatorial(lst + 90, 0)));
    near(ea, 0, 1e-9, 'east point altitude');
    near(eaz, 90, 1e-9, 'east point azimuth');
  }
  // Rotation stays orthonormal.
  const b = m.horizonBasis(-33.87, 151.21, t);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    near(b[i].reduce((s, v, k) => s + v * b[j][k], 0), i === j ? 1 : 0, 1e-12, 'orthonormal');
  }
});

test('planets: the 2020 great conjunction and the 2020 Mars opposition', async () => {
  const m = await load();
  const at = (ms, name) => m.planets(ms).find(p => p.name === name);
  const sep = (a, b) => {
    const [x, y] = [m.equatorial(a.ra, a.dec), m.equatorial(b.ra, b.dec)];
    return Math.acos(x.reduce((s, v, i) => s + v * y[i], 0)) * 180 / Math.PI;
  };
  const dec21 = Date.UTC(2020, 11, 21, 18);
  assert(sep(at(dec21, 'jupiter'), at(dec21, 'saturn')) < 0.25, 'Jupiter and Saturn within a quarter degree');
  near(at(dec21, 'jupiter').ra, 302.5, 1, 'Jupiter RA (ecliptic longitude 300.3, about 20h10m)');
  const mars = at(Date.UTC(2020, 9, 13), 'mars');
  near(mars.ra, 20.5, 2, 'Mars RA at opposition');
  near(mars.dec, 5.5, 2, 'Mars dec at opposition');
  near(mars.mag, -2.6, 0.4, 'Mars magnitude at opposition');
  const venus = at(Date.UTC(2026, 10, 11), 'venus');
  assert(venus.mag < -3.5 && venus.mag > -5, `Venus magnitude ${venus.mag}`);
});

test('places: country codes, case-insensitive, Sydney otherwise', async () => {
  const m = await load();
  assert.deepEqual(m.placeOf('AU'), [-33.87, 151.21]);
  assert.deepEqual(m.placeOf('cn'), m.placeOf('CN'));
  assert.notDeepEqual(m.placeOf('CN'), m.DEFAULT_PLACE);
  for (const c of [undefined, null, '', 'XX', 42, '__proto__', 'constructor']) assert.deepEqual(m.placeOf(c), m.DEFAULT_PLACE, String(c));
});

test('view azimuth: toward the Milky Way when it is up, else the equator', async () => {
  const m = await load();
  // Sydney, mid-July 22:00 local: the galactic centre is overhead, so the view is not the fallback.
  const winter = Date.UTC(2026, 6, 15, 12);
  const az = m.viewAzimuth(m.horizonBasis(-33.87, 151.21, winter), -33.87);
  assert(az >= 0 && az < 360);
  const gc = m.altAz(m.toHorizon(m.horizonBasis(-33.87, 151.21, winter), m.equatorial(266.4, -28.9)));
  assert(gc[0] > 60, `galactic centre altitude ${gc[0]}`);
  for (let h = 0; h < 24; h += 3) {
    const v = m.viewAzimuth(m.horizonBasis(51.5, 0, Date.UTC(2026, 0, 1, h)), 51.5);
    assert(Number.isFinite(v) && v >= 0 && v < 360, `azimuth ${v}`);
  }
});

test('stars-v1.bin decodes: Sirius brightest, counts match the header, lines in range', async () => {
  const m = await load();
  const file = fs.readFileSync(path.join(__dirname, '../source/images/sky/stars-v1.bin'));
  const sky = m.decodeSky(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
  assert.equal(file.length, 12 + sky.stars.length * 6 + sky.segments.length * 8 + sky.dust.length * 5);
  assert(sky.stars.length > 4000 && sky.segments.length > 600 && sky.dust.length > 10000);
  const [ra, dec, mag, bv] = sky.stars[0];
  near(ra, 101.29, 0.05, 'Sirius RA');
  near(dec, -16.72, 0.05, 'Sirius dec');
  near(mag, -1.44, 0.04, 'Sirius mag');
  near(bv, 0, 0.02, 'Sirius B-V');
  for (const [r1, d1, r2, d2] of sky.segments) assert(r1 >= 0 && r1 < 360 && r2 >= 0 && r2 < 360 && Math.abs(d1) <= 90 && Math.abs(d2) <= 90);
  for (const s of sky.dust) assert(s[2] >= 6 && s[2] <= 8.7);
});

test('star colours run blue to orange', async () => {
  const m = await load();
  const [blue, sun, red] = [m.bvColor(-0.3), m.bvColor(0.65), m.bvColor(1.8)];
  assert(blue[2] > blue[0] && red[0] > red[2] && sun[0] >= sun[2]);
  assert.deepEqual(m.bvColor(5), m.bvColor(2));
});
