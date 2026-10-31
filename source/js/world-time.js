(() => {
  'use strict';

  const formatters = new Map();
  function formatter(zone, kind) {
    const key = `${zone}/${kind}`;
    if (!formatters.has(key)) {
      const options = kind === 'parts'
        ? { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }
        : kind === 'time'
          ? { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }
          : { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' };
      formatters.set(key, new Intl.DateTimeFormat(kind === 'date' ? 'zh-CN' : 'en-GB', { ...options, timeZone: zone }));
    }
    return formatters.get(key);
  }

  function snapshot(now, zone) {
    const p = Object.fromEntries(formatter(zone, 'parts').formatToParts(now).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
    const midnight = Date.UTC(p.year, p.month - 1, p.day);
    const wallTime = midnight + ((p.hour * 60 + p.minute) * 60 + p.second) * 1000;
    const offset = Math.round((wallTime - Math.floor(now.getTime() / 1000) * 1000) / 60000);
    return { time: formatter(zone, 'time').format(now), date: formatter(zone, 'date').format(now), day: midnight / 86400000, offset };
  }

  function offsetLabel(minutes) {
    if (!minutes) return 'UTC+00:00';
    const value = Math.abs(minutes);
    return `UTC${minutes < 0 ? '−' : '+'}${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  }

  function compare(local, remote) {
    const delta = remote.offset - local.offset;
    const minutes = Math.abs(delta);
    const duration = [Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)} 小时` : '', minutes % 60 ? `${minutes % 60} 分钟` : ''].filter(Boolean).join(' ');
    const days = remote.day - local.day;
    return {
      difference: delta === 0 ? '与你的本地时间相同' : `比你${delta > 0 ? '快' : '慢'} ${duration}`,
      dayDifference: days === 0 ? '与你处于同一天' : `当地日期比你${days > 0 ? '晚' : '早'} ${Math.abs(days)} 天`
    };
  }

  // Day and night: a low-precision solar position (well under 0.1° for this map),
  // recomputed once a minute. Same projection as the land path: 85°N..60°S on 0..460.
  const RAD = Math.PI / 180;
  const project = (lon, lat) => [(lon + 180) * 1000 / 360, (85 - lat) * 460 / 145];
  function subsolar(date) {
    const d = date.getTime() / 86400000 - 10957.5;
    const g = (357.529 + 0.98560028 * d) * RAD;
    const L = (280.459 + 0.98564736 * d + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
    const e = (23.439 - 0.00000036 * d) * RAD;
    const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) / RAD;
    const gmst = 280.46061837 + 360.98564736629 * d;
    return { lat: Math.asin(Math.sin(e) * Math.sin(L)) / RAD, lon: ((ra - gmst) % 360 + 540) % 360 - 180 };
  }
  // Sun altitude in degrees at a place.
  function altitude(sun, lat, lon) {
    const h = Math.sin(lat * RAD) * Math.sin(sun.lat * RAD) + Math.cos(lat * RAD) * Math.cos(sun.lat * RAD) * Math.cos((lon - sun.lon) * RAD);
    return Math.asin(Math.max(-1, Math.min(1, h))) / RAD;
  }
  // Region where the sun is below `degrees`. It always reaches the pole facing away
  // from the sun, so each meridian has one crossing, found by bisection.
  function shade(sun, degrees) {
    const at = { lat: Math.abs(sun.lat) < 0.01 ? 0.01 : sun.lat, lon: sun.lon };
    const pole = at.lat > 0 ? -90 : 90;
    const edge = [];
    for (let lon = -180; lon <= 180; lon += 2) {
      let dark = pole, light = -pole;
      if (altitude(at, pole, lon) < degrees) {
        for (let i = 0; i < 16; i++) {
          const mid = (dark + light) / 2;
          if (altitude(at, mid, lon) < degrees) dark = mid; else light = mid;
        }
      } else light = pole;
      edge.push(project(lon, light).map(v => Math.round(v * 10) / 10).join(','));
    }
    const line = 'M' + edge.join('L');
    const beyond = pole < 0 ? 600 : -140;
    return { line, fill: `${line}L1000,${beyond}L0,${beyond}Z` };
  }
  // Sun altitudes of the stacked night layers: each step darkens a little more.
  const TWILIGHT = [0, -3, -6, -9, -12, -15, -18];
  function phase(height) {
    return height > -0.83 ? 'day' : height > -12 ? 'twilight' : 'night';
  }

  // Pure helpers are exported only for Node regression tests.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { snapshot, offsetLabel, compare, subsolar, altitude, shade, phase };
    return;
  }
  // Swup may execute the page script again. Reuse a single lifecycle controller.
  if (window.AdenWorldTime) return;

  let active = null;
  function destroy() {
    if (!active) return;
    clearInterval(active.timer);
    active.listeners.abort();
    active = null;
  }

  // Rotating globe on a 2D canvas (orthographic). It reuses the land path already
  // in the SVG, draws up to 60 frames a second, and runs only while shown and on screen.
  // With reduced motion it does not spin; dragging still turns it.
  function createGlobe(root, markers, onPick, signal) {
    const canvas = root.querySelector('.wt-globe');
    const ctx = canvas?.getContext('2d');
    if (!ctx) return null;
    const unit = (lon, lat) => [Math.cos(lat * RAD) * Math.cos(lon * RAD), Math.cos(lat * RAD) * Math.sin(lon * RAD), Math.sin(lat * RAD)];
    const rings = root.querySelector('.wt-land').getAttribute('d').split('M').filter(Boolean).map(ring =>
      ring.replace('Z', '').split('L').map(pair => { const [x, y] = pair.split(',').map(Number); return unit(x * 0.36 - 180, 85 - y * 145 / 460); }));
    const grid = [];
    for (let lon = -180; lon < 180; lon += 30) grid.push(Array.from({ length: 37 }, (_, i) => unit(lon, i * 5 - 90)));
    for (let lat = -60; lat <= 60; lat += 30) grid.push(Array.from({ length: 73 }, (_, i) => unit(i * 5, lat)));
    for (const marker of markers) marker.unit = unit(marker.lon, marker.lat);
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let lon0 = 0, lat0 = 20, zoom = 1, goal = null, hold = 0, sunUnit = null, selectedId = null;
    let colors = {}, size = 0, scale = 1, frame = 0, last = 0, next = 0, onScreen = false, dirty = true, drag = null;
    const interval = 1000 / 60;

    // Fixed starfield and an inclined orbit, both in view space around the globe.
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const stars = Array.from({ length: 140 }, () => {
      const z = random() * 2 - 1, t = random() * Math.PI * 2, k = Math.sqrt(1 - z * z);
      return { unit: [k * Math.cos(t), k * Math.sin(t), z], alpha: 0.25 + random() * 0.55, size: random() < 0.15 ? 1.6 : 1, speed: 0.0008 + random() * 0.002, offset: random() * 6.3 };
    });
    const orbitAt = t => [1.34 * Math.cos(t), 1.34 * Math.sin(t) * 0.28, 1.34 * Math.sin(t) * 0.96];
    const orbit = Array.from({ length: 97 }, (_, i) => orbitAt(i * Math.PI / 48));

    let cl, sl, cp, sp;
    const view = w => {
      const u = w[0] * cl + w[1] * sl;
      return [w[1] * cl - w[0] * sl, cp * w[2] - sp * u, sp * w[2] + cp * u];
    };
    function trace(points) {
      let open = false;
      for (const w of points) {
        const [x, y, z] = view(w);
        if (z < 0) { open = false; continue; }
        if (open) ctx.lineTo(x, y); else { ctx.moveTo(x, y); open = true; }
      }
    }
    // A land ring cut at the horizon: where it leaves the visible side it follows
    // the rim to where it comes back, instead of folding hidden points onto the rim.
    function landRing(points) {
      const seen = points.map(view);
      const first = seen.findIndex(p => p[2] >= 0);
      if (first < 0) return;
      let prev = null, exit = 0;
      for (let i = 0; i <= seen.length; i++) {
        const p = seen[(first + i) % seen.length];
        if (prev && (prev[2] >= 0) !== (p[2] >= 0)) {
          const t = prev[2] / (prev[2] - p[2]);
          const angle = Math.atan2(prev[1] + (p[1] - prev[1]) * t, prev[0] + (p[0] - prev[0]) * t);
          if (p[2] < 0) { ctx.lineTo(Math.cos(angle), Math.sin(angle)); exit = angle; }
          else {
            const turn = ((angle - exit) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
            ctx.arc(0, 0, 1, exit, exit + turn, turn < 0);
          }
        }
        if (p[2] >= 0) i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]);
        prev = p;
      }
      ctx.closePath();
    }
    // Part of the visible disk where the sun is below `degrees`: the visible arc of
    // that small circle, closed along the rim on the side away from the sun.
    function cap(s, degrees, lineOnly) {
      const sh = Math.sin(degrees * RAD), ch = Math.cos(degrees * RAD);
      const n = Math.hypot(s[0], s[1]);
      const a = n < 1e-6 ? [1, 0, 0] : [s[1] / n, -s[0] / n, 0];
      const b = [s[1] * a[2] - s[2] * a[1], s[2] * a[0] - s[0] * a[2], s[0] * a[1] - s[1] * a[0]];
      const ring = Array.from({ length: 96 }, (_, i) => {
        const t = i * Math.PI / 48, c = Math.cos(t) * ch, d = Math.sin(t) * ch;
        return [s[0] * sh + a[0] * c + b[0] * d, s[1] * sh + a[1] * c + b[1] * d, s[2] * sh + a[2] * c + b[2] * d];
      });
      const start = ring.findIndex((p, i) => p[2] >= 0 && ring[(i + 95) % 96][2] < 0);
      ctx.beginPath();
      if (start < 0) {
        if (lineOnly) return false;
        if (ring[0][2] >= 0) ring.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
        else if (s[2] < sh) ctx.arc(0, 0, 1, 0, Math.PI * 2);
        return ring[0][2] >= 0 || s[2] < sh;
      }
      const arc = [];
      for (let i = start; ring[i % 96][2] >= 0 && arc.length < 96; i++) arc.push(ring[i % 96]);
      arc.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
      if (lineOnly) return true;
      const from = Math.atan2(arc.at(-1)[1], arc.at(-1)[0]), to = Math.atan2(arc[0][1], arc[0][0]);
      const mid = from + ((to - from + Math.PI * 2) % (Math.PI * 2)) / 2;
      ctx.arc(0, 0, 1, from, to, Math.cos(mid) * s[0] + Math.sin(mid) * s[1] >= sh);
      return true;
    }
    // The sun as a body beside the globe, placed along its real direction. When the
    // night side faces the viewer it sits behind the globe and only its corona shows.
    function drawSun(x, y, size, alpha, time) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(x, y);
      const corona = ctx.createRadialGradient(0, 0, size * 0.6, 0, 0, size * 4.2);
      corona.addColorStop(0, 'rgb(255 200 90 / 42%)');
      corona.addColorStop(0.35, 'rgb(255 170 60 / 12%)');
      corona.addColorStop(1, 'rgb(255 170 60 / 0%)');
      ctx.fillStyle = corona;
      ctx.beginPath(); ctx.arc(0, 0, size * 4.2, 0, Math.PI * 2); ctx.fill();
      ctx.rotate(time * 0.00015);
      ctx.fillStyle = 'rgb(255 190 80 / 30%)';
      ctx.beginPath();
      for (let i = 0; i < 12; i++) {
        const angle = i * Math.PI / 6, reach = size * (i % 2 ? 1.9 : 2.5) * (1 + 0.08 * Math.sin(time * 0.002 + i));
        ctx.moveTo(Math.cos(angle - 0.08) * size, Math.sin(angle - 0.08) * size);
        ctx.lineTo(Math.cos(angle) * reach, Math.sin(angle) * reach);
        ctx.lineTo(Math.cos(angle + 0.08) * size, Math.sin(angle + 0.08) * size);
      }
      ctx.fill();
      const body = ctx.createRadialGradient(-size * 0.3, -size * 0.3, 0, 0, 0, size);
      body.addColorStop(0, '#fffbe8');
      body.addColorStop(0.5, '#ffd84a');
      body.addColorStop(1, '#ff9a2e');
      ctx.fillStyle = body;
      ctx.beginPath(); ctx.arc(0, 0, size, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    // Orbit ring with one satellite; the part behind the globe is drawn first.
    function drawOrbit(cx, cy, r, front, time) {
      ctx.beginPath();
      let open = false;
      for (const p of orbit) {
        if ((p[2] >= 0) !== front) { open = false; continue; }
        if (open) ctx.lineTo(cx + p[0] * r, cy - p[1] * r); else { ctx.moveTo(cx + p[0] * r, cy - p[1] * r); open = true; }
      }
      ctx.setLineDash([2 * scale, 5 * scale]);
      ctx.strokeStyle = colors.rim; ctx.lineWidth = scale; ctx.stroke();
      ctx.setLineDash([]);
      const p = orbitAt(time * 0.00035);
      if ((p[2] >= 0) !== front) return;
      const x = cx + p[0] * r, y = cy - p[1] * r;
      ctx.fillStyle = colors.cyan;
      ctx.fillRect(x - 2 * scale, y - 2 * scale, 4 * scale, 4 * scale);
      ctx.font = `500 ${9 * scale}px ${colors.mono}`;
      ctx.globalAlpha = 0.7;
      ctx.fillText('SAT-07', x + 6 * scale, y - 4 * scale);
      ctx.globalAlpha = 1;
    }
    function draw(time) {
      dirty = false;
      cl = Math.cos(lon0 * RAD); sl = Math.sin(lon0 * RAD); cp = Math.cos(lat0 * RAD); sp = Math.sin(lat0 * RAD);
      const width = canvas.width, height = canvas.height, cx = width / 2, cy = height / 2, r = height * 0.38 * zoom, px = 1 / r;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = colors.star;
      for (const star of stars) {
        const [x, y] = view(star.unit), sx = cx + x * height * 0.95, sy = cy - y * height * 0.95;
        if (Math.hypot(sx - cx, sy - cy) < r * 1.05) continue;
        ctx.globalAlpha = star.alpha * (still ? 1 : 0.7 + 0.3 * Math.sin(time * star.speed + star.offset));
        ctx.fillRect(sx, sy, star.size * scale, star.size * scale);
      }
      ctx.globalAlpha = 1;
      const sun = sunUnit ? view(sunUnit) : null;
      const sunX = sun && cx + sun[0] * r * 1.75, sunY = sun && cy - sun[1] * r * 1.08, sunSize = r * 0.14;
      if (sun && sun[2] < 0) drawSun(sunX, sunY, sunSize, 1, time);
      drawOrbit(cx, cy, r, false, time);
      const halo = ctx.createRadialGradient(cx, cy, r * 0.96, cx, cy, r * 1.18);
      halo.addColorStop(0, colors.glow);
      halo.addColorStop(1, 'rgb(24 213 232 / 0%)');
      ctx.fillStyle = halo;
      ctx.beginPath(); ctx.arc(cx, cy, r * 1.18, 0, Math.PI * 2); ctx.fill();
      ctx.setTransform(r, 0, 0, -r, cx, cy);
      ctx.save();
      ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2);
      ctx.fillStyle = colors.ocean; ctx.fill(); ctx.clip();
      ctx.beginPath(); for (const line of grid) trace(line);
      ctx.strokeStyle = colors.grid; ctx.lineWidth = 0.8 * scale * px; ctx.stroke();
      ctx.beginPath(); for (const ring of rings) landRing(ring);
      ctx.fillStyle = colors.land; ctx.fill();
      ctx.strokeStyle = colors.coast; ctx.lineWidth = 0.6 * scale * px; ctx.stroke();
      if (sun) {
        ctx.fillStyle = colors.night;
        for (const degrees of TWILIGHT) if (cap(sun, degrees)) ctx.fill();
        // Sunlit side: a soft highlight around the point under the sun.
        const glow = ctx.createRadialGradient(sun[0], sun[1], 0, sun[0], sun[1], 0.9);
        glow.addColorStop(0, `rgb(255 216 74 / ${Math.max(0, sun[2]) * 24}%)`);
        glow.addColorStop(1, 'rgb(255 216 74 / 0%)');
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
      if (sun) {
        // The terminator: visible arc of the great circle facing the sun.
        if (cap(sun, 0, true)) { ctx.strokeStyle = colors.edge; ctx.lineWidth = 1.3 * scale * px; ctx.stroke(); }
        // Back light: with the sun behind, the rim on its side glows.
        if (sun[2] < 0) {
          const angle = Math.atan2(sun[1], sun[0]), strength = Math.min(1, -sun[2] * 1.4);
          ctx.beginPath(); ctx.arc(0, 0, 1, angle - 1.4 - strength * 1.8, angle + 1.4 + strength * 1.8);
          ctx.strokeStyle = `rgb(255 190 90 / ${25 + strength * 35}%)`; ctx.lineWidth = (1 + strength * 1.2) * scale * px; ctx.stroke();
        }
      }
      ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2);
      ctx.strokeStyle = colors.rim; ctx.lineWidth = scale * px; ctx.stroke();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      drawOrbit(cx, cy, r, true, time);
      if (sun && sun[2] >= 0) {
        // In front of the globe: fade out as it would cover the disk.
        const gap = Math.hypot(sunX - cx, sunY - cy) / r - 1 - sunSize / r;
        if (gap > -0.2) drawSun(sunX, sunY, sunSize, Math.min(1, (gap + 0.2) / 0.35), time);
      }
      drawCities(cx, cy, r, still ? 0.5 : (time % 1800) / 1800);
      ctx.font = `500 ${9 * scale}px ${colors.mono}`;
      ctx.fillStyle = colors.hud;
      const deg = (value, plus, minus) => `${Math.abs(value).toFixed(1)}°${value < 0 ? minus : plus}`;
      const lon = ((lon0 % 360) + 540) % 360 - 180;
      ctx.fillText(`VIEW ${deg(lat0, 'N', 'S')} ${deg(lon, 'E', 'W')}`, 12 * scale, height - 12 * scale);
      ctx.textAlign = 'right';
      ctx.fillText(sun && sun[2] < 0 ? 'SUN · BEHIND' : 'DRAG TO ROTATE', width - 12 * scale, height - 12 * scale);
      ctx.textAlign = 'left';
    }
    // Dots for every visible city; names in blue, the selected one in yellow.
    // Labels that would overlap one already placed are skipped (selected goes first).
    function drawCities(cx, cy, r, pulse) {
      const placed = [];
      const visible = markers.map(marker => {
        const [x, y, z] = view(marker.unit);
        marker.screen = z > 0.05 ? [cx + x * r, cy - y * r] : null;
        return marker;
      }).filter(marker => marker.screen).sort((a, b) => (b.id === selectedId) - (a.id === selectedId));
      for (const marker of visible) {
        const [mx, my] = marker.screen, chosen = marker.id === selectedId, night = marker.node.dataset.phase !== 'day';
        if (night) {
          // City lights on the dark side.
          const lights = ctx.createRadialGradient(mx, my, 0, mx, my, 9 * scale);
          lights.addColorStop(0, 'rgb(255 190 90 / 55%)');
          lights.addColorStop(1, 'rgb(255 190 90 / 0%)');
          ctx.fillStyle = lights; ctx.fillRect(mx - 9 * scale, my - 9 * scale, 18 * scale, 18 * scale);
        }
        ctx.beginPath(); ctx.arc(mx, my, (chosen ? 4.5 : 2.6) * scale, 0, Math.PI * 2);
        ctx.fillStyle = chosen ? colors.signal : night ? '#ffb347' : colors.cyan;
        ctx.fill();
        if (chosen) {
          ctx.strokeStyle = colors.signal; ctx.lineWidth = 1.3 * scale;
          ctx.beginPath(); ctx.arc(mx, my, (6 + pulse * 14) * scale, 0, Math.PI * 2);
          ctx.globalAlpha = 0.8 * (1 - pulse); ctx.stroke(); ctx.globalAlpha = 1;
        }
      }
      for (const marker of visible) {
        const [mx, my] = marker.screen, chosen = marker.id === selectedId;
        const name = marker.node.querySelector('text').textContent;
        ctx.font = `${chosen ? 700 : 500} ${(chosen ? 12 : 10) * scale}px ${colors.font}`;
        const box = [mx + 7 * scale, my - 7 * scale, ctx.measureText(name).width + 2 * scale, 13 * scale];
        if (placed.some(b => box[0] < b[0] + b[2] && b[0] < box[0] + box[2] && box[1] < b[1] + b[3] && b[1] < box[1] + box[3])) continue;
        placed.push(box);
        ctx.lineWidth = 3 * scale; ctx.lineJoin = 'round'; ctx.strokeStyle = colors.ocean;
        ctx.strokeText(name, box[0], my + 4 * scale);
        ctx.fillStyle = chosen ? colors.signal : colors.label;
        ctx.fillText(name, box[0], my + 4 * scale);
      }
    }
    function tick(time) {
      frame = 0;
      if (!onScreen || !root.isConnected) return;
      if (time >= next - 1) {
        next = next + interval < time ? time + interval : next + interval;
        const elapsed = Math.min(time - last, 200);
        last = time;
        if (goal) {
          const delta = ((goal[0] - lon0) % 360 + 540) % 360 - 180;
          const step = 1 - (1 - 0.18) ** (elapsed / 66);
          lon0 += delta * step; lat0 += (goal[1] - lat0) * step;
          if (Math.abs(delta) < 0.2 && Math.abs(goal[1] - lat0) < 0.2) goal = null;
        } else if (!still && !drag && time > hold) lon0 -= elapsed * 0.004;
        if (dirty || goal || drag || !still) draw(time);
      }
      if (goal || drag || dirty || !still) frame = requestAnimationFrame(tick);
    }
    const wake = () => { dirty = true; if (!frame && onScreen) frame = requestAnimationFrame(tick); };
    function resize() {
      scale = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.round(canvas.clientWidth * scale);
      if (width && width !== size) { size = canvas.width = width; canvas.height = Math.round(width * 0.62); wake(); }
    }
    const zoomInput = root.querySelector('.wt-zoom input');
    zoomInput?.addEventListener('input', () => { zoom = Number(zoomInput.value) || 1; wake(); }, { signal });
    function palette() {
      const style = getComputedStyle(root), get = name => style.getPropertyValue(name).trim();
      const dark = document.documentElement.classList.contains('dark');
      // The globe keeps its own palette per theme; light mode needs stronger contrast.
      const next = dark ? {
        ocean: '#08111b', land: '#2a3a48', coast: '#4f6678', night: 'rgb(2 6 20 / 13%)', edge: 'rgb(255 216 74 / 75%)',
        label: '#5fd7ff', star: '#cfe8ff', hud: 'rgb(150 200 220 / 70%)', grid: 'rgb(127 140 160 / 16%)', rim: 'rgb(24 213 232 / 45%)', glow: 'rgb(24 213 232 / 14%)'
      } : {
        ocean: '#dbe7f1', land: '#9db0c2', coast: '#6f8396', night: 'rgb(25 45 85 / 7%)', edge: 'rgb(196 128 0 / 85%)',
        label: '#0a6fa8', star: '#7d8ea4', hud: 'rgb(50 70 95 / 80%)', grid: 'rgb(70 90 120 / 14%)', rim: 'rgb(10 111 168 / 45%)', glow: 'rgb(10 111 168 / 12%)'
      };
      Object.assign(next, { cyan: dark ? get('--aden-cyan') : '#0a6fa8', signal: dark ? get('--aden-signal') : '#b37700', font: get('--aden-body-font') || 'sans-serif', mono: get('--aden-mono-font') || 'monospace' });
      if (JSON.stringify(next) !== JSON.stringify(colors)) { colors = next; wake(); }
    }
    canvas.addEventListener('pointerdown', event => {
      drag = { x: event.clientX, y: event.clientY, lon: lon0, lat: lat0, moved: 0 };
      canvas.setPointerCapture(event.pointerId);
      goal = null; wake();
    }, { signal });
    canvas.addEventListener('pointermove', event => {
      if (!drag) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
      const degrees = 180 / canvas.clientWidth;
      lon0 = drag.lon - dx * degrees;
      lat0 = Math.max(-60, Math.min(60, drag.lat + dy * degrees));
      dirty = true;
    }, { signal });
    const release = event => {
      if (!drag) return;
      if (drag.moved < 5) {
        const box = canvas.getBoundingClientRect(), x = (event.clientX - box.left) * scale, y = (event.clientY - box.top) * scale;
        const hit = markers.filter(m => m.screen).map(m => [Math.hypot(m.screen[0] - x, m.screen[1] - y), m]).sort((a, b) => a[0] - b[0])[0];
        if (hit && hit[0] < 16 * scale) onPick(hit[1].id);
      }
      drag = null; hold = performance.now() + 4000; wake();
    };
    canvas.addEventListener('pointerup', release, { signal });
    canvas.addEventListener('pointercancel', release, { signal });
    const visibility = new IntersectionObserver(entries => { onScreen = entries[0].isIntersecting; if (onScreen) wake(); });
    const sizing = new ResizeObserver(resize);
    visibility.observe(canvas); sizing.observe(canvas);
    signal.addEventListener('abort', () => { visibility.disconnect(); sizing.disconnect(); cancelAnimationFrame(frame); }, { once: true });
    palette();
    return {
      palette,
      sun(next) { sunUnit = unit(next.lon, next.lat); wake(); },
      focus(id, instant) {
        const marker = markers.find(item => item.id === id);
        selectedId = id;
        if (!marker) return;
        goal = [marker.lon, Math.max(-35, Math.min(35, marker.lat * 0.7))];
        if (instant) { [lon0, lat0] = goal; goal = null; }
        hold = performance.now() + 4000;
        wake();
      }
    };
  }

  function mount(_root, scope) {
    const root = document.getElementById('world-time');
    if (active?.root === root && root?.isConnected) return;
    destroy();
    if (!root) return;

    const cities = Array.from(root.querySelectorAll('button[data-zone]')).map(button => ({ id: button.dataset.city, name: button.dataset.name, zone: button.dataset.zone }));
    let localZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    let selected = cities.find(city => city.zone === localZone) || cities.find(city => city.id === 'sydney') || cities[0];
    const nodes = Object.fromEntries(Array.from(root.querySelectorAll('[data-wt]')).map(node => [node.dataset.wt, node]));
    const listeners = new AbortController();
    active = { root, listeners, timer: null };

    function set(name, text) {
      if (nodes[name].textContent !== text) nodes[name].textContent = text;
    }
    function renderClock(kind, state, zone, now) {
      set(`${kind}-time`, state.time);
      nodes[`${kind}-time`].dateTime = now.toISOString();
      set(`${kind}-date`, state.date);
      set(`${kind}-zone`, `${zone} · ${offsetLabel(state.offset)}`);
    }
    const markers = Array.from(root.querySelectorAll('.wt-marker')).map(node => ({ node, id: node.dataset.city, lon: Number(node.dataset.lon), lat: Number(node.dataset.lat) }));
    const nights = root.querySelectorAll('.wt-night');
    const terminator = root.querySelector('.wt-terminator');
    const sunMark = root.querySelector('#wt-sun');
    const phaseText = { day: '☀ 白天', twilight: '◐ 晨昏', night: '☾ 夜晚' };
    let sun = null, minute = -1;
    const globe = createGlobe(root, markers, id => select(id), listeners.signal);
    function setView(name) {
      const flat = name === 'flat' || !globe;
      root.classList.toggle('wt-globe-on', !flat);
      for (const button of root.querySelectorAll('[data-view]')) button.setAttribute('aria-pressed', String((button.dataset.view === 'flat') === flat));
    }
    root.addEventListener('click', event => {
      const button = event.target.closest?.('[data-view]');
      if (button) setView(button.dataset.view);
    }, { signal: listeners.signal });
    setView('flat');
    function renderDaylight(now) {
      const current = Math.floor(now.getTime() / 60000);
      if (current !== minute) {
        minute = current;
        sun = subsolar(now);
        globe?.sun(sun);
        TWILIGHT.forEach((degrees, i) => {
          const region = shade(sun, degrees);
          nights[i].setAttribute('d', region.fill);
          if (i === 0) terminator.setAttribute('d', region.line);
        });
        const [x, y] = project(sun.lon, sun.lat);
        sunMark.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
        sunMark.setAttribute('visibility', 'visible');
        for (const marker of markers) marker.node.dataset.phase = phase(altitude(sun, marker.lat, marker.lon));
        const deg = (value, plus, minus) => `${Math.abs(value).toFixed(1)}°${value < 0 ? minus : plus}`;
        set('sun', `SUBSOLAR ${deg(sun.lat, 'N', 'S')} ${deg(sun.lon, 'E', 'W')}`);
      }
      const marker = markers.find(item => item.id === selected.id);
      set('remote-phase', marker ? phaseText[marker.node.dataset.phase] : '');
    }
    function render() {
      if (!root.isConnected || document.hidden) return;
      const now = new Date();
      renderDaylight(now);
      globe?.palette();
      localZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      try {
        const local = snapshot(now, localZone);
        renderClock('local', local, localZone, now);
        const remote = snapshot(now, selected.zone);
        renderClock('remote', remote, selected.zone, now);
        const comparison = compare(local, remote);
        set('difference', `${selected.name} · ${comparison.difference}`);
        set('day-difference', comparison.dayDifference);
      } catch (_) {
        set('remote-time', '--:--:--');
        set('remote-date', '浏览器暂不支持这个时区');
        set('remote-zone', selected.zone);
        set('difference', '请更新浏览器后重试');
        set('day-difference', '');
      }
    }
    function select(id) {
      const city = cities.find(item => item.id === id);
      if (!city) return;
      selected = city;
      set('remote-name', city.name);
      globe?.focus(city.id, !sun);
      for (const marker of root.querySelectorAll('[data-city]')) {
        marker.setAttribute('aria-pressed', String(marker.dataset.city === city.id));
      }
      render();
    }
    function selectTarget(event) {
      const target = event.target.closest?.('[data-city]');
      if (target && root.contains(target)) select(target.dataset.city);
    }
    root.addEventListener('click', selectTarget, { signal: listeners.signal });
    root.addEventListener('keydown', event => {
      if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('.wt-marker')) {
        event.preventDefault();
        selectTarget(event);
      }
    }, { signal: listeners.signal });
    select(selected.id);
    scope.clock(render);
    return destroy;
  }

  window.AdenWorldTime = { destroy };
  window.AdenSite.register('world-time', '#world-time', mount);
})();
