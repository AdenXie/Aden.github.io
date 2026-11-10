'use strict';
// Builds the home sky's data from third-party sources (see source/images/sky/NOTICE.txt):
//   node tools/build-sky-data.cjs <source dir>
// The source dir holds, unchanged from upstream:
//   stars.6.json, constellations.lines.json  d3-celestial data/ (BSD-3-Clause)
//   mw.f32                                     NASA SVS milkyway_2020_4k.exr as raw
//                                              float32 RGB, 4096x2048, rows bottom-up
//                                              (tools/sky-exr-to-raw.py in Blender).
//   mwgal.f32                                  milkyway_2020_8k_gal.exr, galactic latitude
//                                              -46 to +30 only (same script, "-46 30"):
//                                              8192x1730.
// Writes source/images/sky/: stars-v1.bin, milkyway-2048-v1.webp (whole sky, equatorial,
// the faint base) and milkyway-band-{4096,8192}-v1.webp (the band in galactic
// coordinates, l = 0 at the centre growing to the left, b from BAND[0] at the bottom to
// BAND[1] at the top; scenes/sky.js uses the same range).
//
// stars-v1.bin, little-endian:
//   header  uint32 starCount, segmentCount, dustCount
//   stars   uint16 ra, int16 dec, uint8 mag, uint8 colour      (catalogue, brightest first)
//   lines   uint16 ra, int16 dec, uint16 ra, int16 dec          (constellation figure segments)
//   dust    uint16 ra, int16 dec, uint8 mag                     (faint stars, shuffled)
// ra: degrees / 360 * 65536; dec: degrees / 90 * 32767; mag: (mag + 2) * 25; colour: (B-V + 0.5) * 100.
// All J2000 equatorial. Dust stars are drawn where the Milky Way image is bright, so the
// band reads as countless stars rather than only a glow.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const src = process.argv[2];
if (!src) throw new Error('usage: node tools/build-sky-data.cjs <source dir>');
const out = path.join(__dirname, '../source/images/sky');
fs.mkdirSync(out, { recursive: true });

const W = 4096, H = 2048, DUST = 24000;
const GW = 8192, GH = 1730, BAND = [-46, 30];
const ra16 = lon => Math.round((((lon % 360) + 360) % 360) / 360 * 65536) % 65536;
const dec16 = d => Math.round(Math.max(-90, Math.min(90, d)) / 90 * 32767);
const u8 = v => Math.max(0, Math.min(255, Math.round(v)));

// Milky Way: linear light with the faint sky background (40th percentile) taken off as a
// black point and the 99.9th percentile near white; the scene decodes it as sRGB and sets
// its own exposure. The black point keeps dark sky dark and the files small.
const raw = new Float32Array(fs.readFileSync(path.join(src, 'mw.f32')).buffer.slice(0));
if (raw.length !== W * H * 3) throw new Error(`mw.f32: expected ${W * H * 3} floats, got ${raw.length}`);
const lum = new Float32Array(W * H);
for (let i = 0; i < W * H; i++) lum[i] = (raw[i * 3] + raw[i * 3 + 1] + raw[i * 3 + 2]) / 3;
const sorted = Float32Array.from(lum).sort();
const black = sorted[Math.floor(sorted.length * 0.4)];
const white = sorted[Math.floor(sorted.length * 0.999)];
// Linear float RGB (bottom-up) to gamma-encoded 8-bit (top-down) with the shared levels.
function tone(data, w, h, scale = 1) {
  const rgb = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    const row = (h - 1 - y) * w;
    for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
      rgb[(y * w + x) * 3 + c] = u8(255 * Math.pow(Math.min(1, Math.max(0, data[(row + x) * 3 + c] * scale - black) / (white - black)), 1 / 2.2));
    }
  }
  return rgb;
}
const rgb = tone(raw, W, H);

// The 8k file stores flux per (four times smaller) pixel: match it to the 4k levels by the
// median ratio over bright sky both cover, so the band and the base blend seamlessly.
const gal = new Float32Array(fs.readFileSync(path.join(src, 'mwgal.f32')).buffer.slice(0));
if (gal.length !== GW * GH * 3) throw new Error(`mwgal.f32: expected ${GW * GH * 3} floats, got ${gal.length}`);
const GAL_TO_EQ = [[-0.0548755604, 0.4941094279, -0.867666149], [-0.8734370902, -0.44482963, -0.1980763734], [-0.4838350155, 0.7469822445, 0.4559837762]];
const galScale = (() => {
  const R = Math.PI / 180, ratios = [];
  let s = 1;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < 20000; k++) {
    const l = rnd() * 360, b = BAND[0] + rnd() * (BAND[1] - BAND[0]);
    const g = [Math.cos(b * R) * Math.cos(l * R), Math.cos(b * R) * Math.sin(l * R), Math.sin(b * R)];
    const e = GAL_TO_EQ.map(row => row[0] * g[0] + row[1] * g[1] + row[2] * g[2]);
    const ra = Math.atan2(e[1], e[0]) / R, dec = Math.asin(e[2]) / R;
    const ex = Math.floor((((0.5 - ra / 360) % 1) + 1) % 1 * W), ey = Math.min(H - 1, Math.floor((dec + 90) / 180 * H));
    const gx = Math.floor((((0.5 - l / 360) % 1) + 1) % 1 * GW), gy = Math.min(GH - 1, Math.floor((b - BAND[0]) / (BAND[1] - BAND[0]) * GH));
    const a = lum[ey * W + ex], c = (gal[(gy * GW + gx) * 3] + gal[(gy * GW + gx) * 3 + 1] + gal[(gy * GW + gx) * 3 + 2]) / 3;
    if (a > 0.05 && c > 0) ratios.push(a / c);
  }
  return ratios.sort((x, y) => x - y)[ratios.length >> 1];
})();
const band = tone(gal, GW, GH, galScale);

// Dust: rejection-sample pixels by brightness (area-weighted by cos(dec)), plus a floor
// so the dark sky is not empty.
let seed = 20261111;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const mean = sorted.reduce((s, v) => s + v, 0) / sorted.length;
const dust = [];
while (dust.length < DUST) {
  const x = rand() * W, y = rand() * H;
  const dec = 90 - (y / H) * 180;
  if (rand() > Math.cos(dec * Math.PI / 180)) continue;
  const l = lum[(H - 1 - Math.floor(y)) * W + Math.floor(x)];
  if (rand() > Math.min(1, (0.35 * mean + Math.pow(l / white, 1.15)) * 2.2)) continue;
  // Image centre is RA 0h, RA grows to the left.
  const ra = (0.5 - x / W) * 360;
  // Fainter stars are more numerous: magnitudes 6.2 to 8.6, skewed faint.
  dust.push([ra, dec, 8.6 - 2.4 * Math.pow(rand(), 2.2)]);
}

const stars = require(path.join(src, 'stars.6.json')).features
  .map(f => [f.geometry.coordinates[0], f.geometry.coordinates[1], f.properties.mag, parseFloat(f.properties.bv)])
  .sort((a, b) => a[2] - b[2]);
const segments = [];
for (const f of require(path.join(src, 'constellations.lines.json')).features) {
  for (const line of f.geometry.coordinates) for (let i = 1; i < line.length; i++) segments.push([...line[i - 1], ...line[i]]);
}

const buf = Buffer.alloc(12 + stars.length * 6 + segments.length * 8 + dust.length * 5);
let o = 0;
for (const n of [stars.length, segments.length, dust.length]) { buf.writeUInt32LE(n, o); o += 4; }
for (const [ra, dec, mag, bv] of stars) {
  buf.writeUInt16LE(ra16(ra), o); buf.writeInt16LE(dec16(dec), o + 2);
  buf.writeUInt8(u8((mag + 2) * 25), o + 4); buf.writeUInt8(u8(((Number.isFinite(bv) ? bv : 0.6) + 0.5) * 100), o + 5);
  o += 6;
}
for (const [r1, d1, r2, d2] of segments) {
  buf.writeUInt16LE(ra16(r1), o); buf.writeInt16LE(dec16(d1), o + 2); buf.writeUInt16LE(ra16(r2), o + 4); buf.writeInt16LE(dec16(d2), o + 6);
  o += 8;
}
for (const [ra, dec, mag] of dust) {
  buf.writeUInt16LE(ra16(ra), o); buf.writeInt16LE(dec16(dec), o + 2); buf.writeUInt8(u8((mag + 2) * 25), o + 4);
  o += 5;
}
fs.writeFileSync(path.join(out, 'stars-v1.bin'), buf);

// Denoise by brightness: the faint background is mostly sensor-like grain that a black
// level would shatter into blotches, so it takes a heavy blur; the bright band keeps its
// detail.
async function denoise(pixels, w, h, sigma) {
  const raw3 = { raw: { width: w, height: h, channels: 3 } };
  const soft = await sharp(pixels, raw3).blur(sigma).raw().toBuffer();
  const mixed = Buffer.alloc(pixels.length);
  for (let i = 0; i < w * h; i++) {
    const l = (soft[i * 3] + soft[i * 3 + 1] + soft[i * 3 + 2]) / 765;
    const t = Math.min(1, Math.max(0, (l - 0.1) / 0.3)), k = t * t * (3 - 2 * t);
    for (let c = 0; c < 3; c++) mixed[i * 3 + c] = u8(soft[i * 3 + c] + (pixels[i * 3 + c] - soft[i * 3 + c]) * k);
  }
  return sharp(mixed, raw3);
}

(async () => {
  for (const old of ['milkyway-4096-v1.webp']) fs.rmSync(path.join(out, old), { force: true });
  await (await denoise(rgb, W, H, 10)).resize(2048, 1024).blur(0.6).webp({ quality: 72, smartSubsample: true }).toFile(path.join(out, 'milkyway-2048-v1.webp'));
  // The 8k map is grainy pixel to pixel; a 3x3 median keeps the dust-lane edges that a
  // blur would soften and brings the file from ~2.4 MB to ~0.65 MB.
  const bandRaw = await (await denoise(band, GW, GH, 20)).median(3).raw().toBuffer();
  for (const width of [4096, 8192]) {
    await sharp(bandRaw, { raw: { width: GW, height: GH, channels: 3 } }).resize(width, Math.round(GH * width / GW)).webp({ quality: 72, smartSubsample: true }).toFile(path.join(out, `milkyway-band-${width}-v1.webp`));
  }
  console.log('band scale', galScale.toFixed(3));
  for (const f of fs.readdirSync(out)) console.log(f, fs.statSync(path.join(out, f)).size);
  console.log(`stars ${stars.length}, segments ${segments.length}, dust ${dust.length}`);
})();
