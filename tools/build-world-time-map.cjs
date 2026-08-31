// Maintenance only: node tools/build-world-time-map.cjs
// Prints the simplified map JSON; normal Hexo builds never download map data.
// Source: Natural Earth 1:110m land, public domain.
const source = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_110m_land.geojson';

function simplify(points, tolerance = 1.2) {
  if (points.length <= 2) return points;
  const a = points[0], b = points[points.length - 1];
  const dx = b[0] - a[0], dy = b[1] - a[1];
  let max = tolerance * tolerance, split = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const t = dx || dy ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy))) : 0;
    const d = (p[0] - a[0] - t * dx) ** 2 + (p[1] - a[1] - t * dy) ** 2;
    if (d > max) { max = d; split = i; }
  }
  return split ? [...simplify(points.slice(0, split + 1), tolerance).slice(0, -1), ...simplify(points.slice(split), tolerance)] : [a, b];
}

(async () => {
  const response = await fetch(source);
  if (!response.ok) throw new Error(`Map download failed: ${response.status}`);
  const data = await response.json();
  const paths = [];
  for (const feature of data.features) {
    const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    for (const polygon of polygons) {
      const ring = polygon[0];
      if (Math.max(...ring.map(p => p[1])) < -60) continue;
      const points = ring.map(([lon, lat]) => [(lon + 180) * 1000 / 360, (85 - lat) * 460 / 145]);
      const area = Math.abs(points.reduce((n, p, i) => { const q = points[(i + 1) % points.length]; return n + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
      if (area < 6) continue;
      const simple = simplify(points);
      if (simple.length < 4) continue;
      paths.push('M' + simple.map(p => p.map(v => +v.toFixed(1)).join(',')).join('L') + 'Z');
    }
  }
  console.log(JSON.stringify({ source, license: 'Public domain — Natural Earth', viewBox: '0 0 1000 460', path: paths.join('') }));
})().catch(error => { console.error(error); process.exitCode = 1; });
