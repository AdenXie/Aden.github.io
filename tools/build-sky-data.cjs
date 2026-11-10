'use strict';
// Builds the home sky's data from third-party sources (see source/images/sky/NOTICE.txt):
//   node tools/build-sky-data.cjs <source dir>
// The source dir holds, unchanged from upstream:
//   stars.6.json, constellations.lines.json  d3-celestial data/ (BSD-3-Clause)
//   mw.f32                                     NASA SVS milkyway_2020_4k.exr as raw
//                                              float32 RGB, 4096x2048, rows bottom-up
//                                              (tools/sky-exr-to-raw.py in Blender).
// Writes source/images/sky/: stars-v1.bin and milkyway-{2048,4096}-v1.webp.
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
const rgb = Buffer.alloc(W * H * 3);
for (let y = 0; y < H; y++) {
  const row = (H - 1 - y) * W; // flip to top-down
  for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++) {
    rgb[(y * W + x) * 3 + c] = u8(255 * Math.pow(Math.min(1, Math.max(0, raw[(row + x) * 3 + c] - black) / (white - black)), 1 / 2.2));
  }
}

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

(async () => {
  // Denoise by brightness: the faint background is mostly sensor-like grain that a black
  // level would shatter into blotches, so it takes a heavy blur; the bright band keeps
  // its detail. Then a light blur for the dust lanes' grain and the file size.
  const raw3 = { raw: { width: W, height: H, channels: 3 } };
  const soft = await sharp(rgb, raw3).blur(10).raw().toBuffer();
  const mixed = Buffer.alloc(rgb.length);
  for (let i = 0; i < W * H; i++) {
    const l = (soft[i * 3] + soft[i * 3 + 1] + soft[i * 3 + 2]) / 765;
    const t = Math.min(1, Math.max(0, (l - 0.1) / 0.3)), w = t * t * (3 - 2 * t);
    for (let c = 0; c < 3; c++) mixed[i * 3 + c] = u8(soft[i * 3 + c] + (rgb[i * 3 + c] - soft[i * 3 + c]) * w);
  }
  for (const width of [2048, 4096]) {
    // A light blur drops pixel-level grain (the dust stars draw that) and most of the file size.
    await sharp(mixed, raw3).resize(width, width / 2).blur(width === 4096 ? 1 : 0.6).webp({ quality: 72, smartSubsample: true }).toFile(path.join(out, `milkyway-${width}-v1.webp`));
  }
  for (const f of fs.readdirSync(out)) console.log(f, fs.statSync(path.join(out, f)).size);
  console.log(`stars ${stars.length}, segments ${segments.length}, dust ${dust.length}`);
})();
