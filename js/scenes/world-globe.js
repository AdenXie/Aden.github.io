// World-time globe. Shared by both languages; loaded only after choosing the globe.
// NASA imagery is local, resolution-limited, and historical, not live weather.
import * as THREE from '/js/vendor/three-0.170.0.module.min.js';

const RAD = Math.PI / 180;
const VERTEX = `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

// Matches SphereGeometry's equirectangular UVs: north up, Greenwich at u = .5.
export function geoVector(lon, lat) {
  const c = Math.cos(lat * RAD);
  return new THREE.Vector3(c * Math.cos(lon * RAD), Math.sin(lat * RAD), -c * Math.sin(lon * RAD));
}

export function quality({ coarse = false, memory = 8, dpr = 1, saveData = false } = {}) {
  const lite = coarse || memory < 4 || saveData;
  return { lite, fps: lite ? 30 : 45, dpr: Math.min(dpr, lite ? 1.25 : 1.5), texture: lite ? 1024 : 2048, segments: lite ? 96 : 128, stars: lite ? 160 : 360 };
}

// Preserve the original globe's point-adjacent names and selected-first order.
// Try a few nearby positions for a cluster; never move names out to side rails.
export function layoutLabels(items, width, height) {
  const placed = [], boxes = [];
  const overlap = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
  for (const item of [...items].sort((a, b) => Number(b.selected) - Number(a.selected) || b.facing - a.facing)) {
    const { x, y, w, h } = item;
    const candidates = [
      [x + 7, y - h / 2], [x - w - 7, y - h / 2],
      [x - w / 2, y - h - 5], [x - w / 2, y + 5],
      [x + 7, y - h - 5], [x - w - 7, y - h - 5],
      [x + 7, y + 5], [x - w - 7, y + 5]
    ];
    for (const shift of [-24, 24, -32, 32]) {
      candidates.push([x + 7, y - h / 2 + shift], [x - w - 7, y - h / 2 + shift]);
    }
    // Keep a nearby valid placement stable as the globe rotates.
    if (item.previous) candidates.unshift([x + item.previous[0], y + item.previous[1]]);
    for (const [left, top] of candidates) {
      if (left < 3 || top < 3 || left + w > width - 3 || top + h > height - 3) continue;
      const box = [left - 2, top - 2, w + 4, h + 4];
      if (boxes.some(other => overlap(box, other))) continue;
      boxes.push(box);
      placed.push({ ...item, left, top });
      break;
    }
  }
  return placed;
}

// A stopped scene has no pending RAF, including when merely offscreen. In reduced
// motion / paused mode it draws only in response to an interaction or state update.
export function frameLoop(draw, { fps, running, moving, request = requestAnimationFrame, cancel = cancelAnimationFrame }) {
  let frame = 0, last = -Infinity, next = 0, dirty = true, disposed = false;
  function tick(now) {
    frame = 0;
    if (disposed || !running()) return;
    if (now >= next - 0.5) {
      next = next + 1000 / fps < now ? now + 1000 / fps : next + 1000 / fps;
      const elapsed = Number.isFinite(last) ? Math.min(now - last, 100) : 0;
      last = now;
      if (dirty || moving()) { dirty = false; draw(now, elapsed); }
    }
    if (dirty || moving()) frame = request(tick);
  }
  return {
    wake() {
      dirty = true;
      if (!disposed && running() && !frame) frame = request(tick);
    },
    stop() { cancel(frame); frame = 0; last = -Infinity; next = 0; },
    dispose() { disposed = true; cancel(frame); frame = 0; }
  };
}

export async function mount(root, markers, onPick, signal) {
  const canvas = root.querySelector('.wt-globe');
  const stage = canvas.parentElement;
  const english = document.documentElement.lang.startsWith('en');
  const pick = (zh, en) => english ? en : zh;
  const profile = quality({ coarse: matchMedia('(pointer: coarse)').matches || matchMedia('(max-width: 640px)').matches, memory: navigator.deviceMemory ?? 8, dpr: devicePixelRatio || 1, saveData: navigator.connection?.saveData });
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const inspect = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const metrics = inspect ? { frames: 0, cpuTotal: 0, disposed: false, firstFrame: 0 } : null;
  if (inspect) window.__worldGlobeMetrics = metrics;
  const resources = new Set(), bitmaps = new Set(), labels = [], labelSizes = [];
  let renderer, loop, sizing, visibility, disposed = false, onScreen = false, theme;
  let width = 0, height = 0, lon = 145, lat = -20, zoom = Number(root.querySelector('.wt-zoom input').value) || 1;
  let target = null, drag = null, hold = 0, paused = motion.matches, selectedId = null;
  const track = value => { resources.add(value); return value; };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (metrics) metrics.disposed = true;
    loop?.dispose(); sizing?.disconnect(); visibility?.disconnect();
    resources.forEach(value => value.dispose());
    bitmaps.forEach(bitmap => bitmap.close()); bitmaps.clear();
    labels.forEach(label => label.remove());
    renderer?.dispose(); renderer?.forceContextLoss();
    // A lost WebGL context cannot be reused when returning through Swup/BFCache.
    const fresh = canvas.cloneNode(false);
    for (const key of Object.keys(fresh.dataset)) if (key.startsWith('globe')) delete fresh.dataset[key];
    canvas.replaceWith(fresh);
  };
  signal.addEventListener('abort', dispose, { once: true });
  if (signal.aborted) { dispose(); throw new DOMException('Aborted', 'AbortError'); }

  try {
    // A dense sphere and soft atmospheric rim avoid paying for a multisampled
    // full-size framebuffer; DPR is capped separately for both quality tiers.
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'low-power' });
    renderer.setPixelRatio(profile.dpr);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      if (!disposed) root.dispatchEvent(new CustomEvent('aden:globe-error'));
    }, { signal });

    async function texture(kind) {
      const response = await fetch(`/images/earth/${kind}-${profile.texture}-v1.webp`, { signal, cache: 'force-cache' });
      if (!response.ok) throw new Error('Earth texture unavailable');
      const image = await createImageBitmap(await response.blob(), { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      if (disposed || signal.aborted) { image.close(); throw new DOMException('Aborted', 'AbortError'); }
      bitmaps.add(image);
      const map = track(new THREE.Texture(image));
      map.colorSpace = THREE.SRGBColorSpace;
      map.flipY = false;
      map.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      map.needsUpdate = true;
      return map;
    }
    const [day, night] = await Promise.all([texture('day'), texture('night')]);
    if (disposed || signal.aborted) throw new DOMException('Aborted', 'AbortError');

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-2, 2, 1.3, -1.3, 0.1, 100);
    const sun = new THREE.Vector3(1, 0, 0);
    const uniforms = { uDay: { value: day }, uNight: { value: night }, uSun: { value: sun }, uLightTheme: { value: 0 } };
    const sphere = track(new THREE.SphereGeometry(1, profile.segments, profile.segments / 2));
    const surface = track(new THREE.ShaderMaterial({
      uniforms, vertexShader: VERTEX, transparent: true,
      fragmentShader: `
        uniform sampler2D uDay;
        uniform sampler2D uNight;
        uniform vec3 uSun;
        uniform float uLightTheme;
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vWorld;
        void main() {
          vec3 n = normalize(vNormal);
          vec3 eye = normalize(cameraPosition - vWorld);
          float altitude = dot(n, uSun);
          float daylight = smoothstep(-0.10, 0.16, altitude);
          vec3 albedo = texture2D(uDay, vUv).rgb;
          vec3 lights = texture2D(uNight, vUv).rgb;
          float diffuse = 0.18 + 0.92 * pow(max(altitude, 0.0), 0.65);
          // The night composite includes a dim geographic base. Suppress its
          // neutral polar ice rather than presenting white snow as city lights.
          float cityLight = smoothstep(0.003, 0.08, lights.r - lights.b * 1.25);
          vec3 nightside = albedo * mix(0.055, 0.10, uLightTheme) + lights * cityLight * 2.2;
          vec3 color = mix(nightside, albedo * diffuse, daylight);
          float ocean = smoothstep(0.015, 0.08, albedo.b - max(albedo.r, albedo.g));
          float reflection = pow(max(dot(reflect(-uSun, n), eye), 0.0), 70.0);
          color += vec3(0.42, 0.67, 0.80) * reflection * ocean * daylight * 0.35;
          float facing = max(dot(n, eye), 0.0);
          float edge = pow(1.0 - facing, 3.5);
          color += vec3(0.06, 0.28, 0.55) * edge * (0.12 + 0.38 * daylight);
          float coverage = smoothstep(0.0, max(fwidth(facing) * 1.4, 0.001), facing);
          gl_FragColor = vec4(color, coverage);
          #include <colorspace_fragment>
        }`
    }));
    scene.add(new THREE.Mesh(sphere, surface));

    // One thin atmospheric shell; no bloom passes, shadows, or full-screen effects.
    const atmosphere = track(new THREE.ShaderMaterial({
      uniforms, vertexShader: VERTEX, side: THREE.BackSide, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending,
      fragmentShader: `
        uniform vec3 uSun;
        varying vec3 vNormal;
        varying vec3 vWorld;
        void main() {
          vec3 n = normalize(vNormal);
          float facing = abs(dot(n, normalize(cameraPosition - vWorld)));
          float rim = pow(1.0 - facing, 3.0);
          float day = smoothstep(-0.25, 0.4, dot(n, uSun));
          vec3 tint = mix(vec3(0.36, 0.17, 0.045), vec3(0.12, 0.48, 0.95), day);
          float coverage = smoothstep(0.0, max(fwidth(facing) * 1.6, 0.001), facing);
          gl_FragColor = vec4(tint, rim * (0.12 + 0.60 * day) * coverage);
          #include <colorspace_fragment>
        }`
    }));
    const air = new THREE.Mesh(sphere, atmosphere);
    air.scale.setScalar(1.025); air.renderOrder = 1; scene.add(air);

    let seed = 19;
    const random = () => (seed = seed * 16807 % 2147483647) / 2147483647;
    const starPositions = new Float32Array(profile.stars * 3);
    for (let i = 0; i < profile.stars; i++) {
      const y = random() * 2 - 1, angle = random() * Math.PI * 2, r = Math.sqrt(1 - y * y) * 25;
      starPositions.set([r * Math.cos(angle), y * 25, r * Math.sin(angle)], i * 3);
    }
    const starGeometry = track(new THREE.BufferGeometry());
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const starMaterial = track(new THREE.PointsMaterial({ color: 0x9abed0, size: 0.012, transparent: true, opacity: 0.7, depthWrite: false }));
    const stars = new THREE.Points(starGeometry, starMaterial);
    stars.renderOrder = -2; scene.add(stars);

    // Geographic city points share one draw call. Native city buttons below the
    // map remain the accessible alternative to pointer picking on the sphere.
    const cityPositions = new Float32Array(markers.length * 3), cityColors = new Float32Array(markers.length * 3);
    const labelLayer = stage.querySelector('.wt-globe-labels');
    labelLayer.removeAttribute('aria-hidden');
    labelLayer.setAttribute('role', 'group');
    labelLayer.setAttribute('aria-label', pick('地球上的城市', 'Cities on the globe'));
    for (const [i, marker] of markers.entries()) {
      marker.unit = geoVector(marker.lon, marker.lat);
      marker.unit.clone().multiplyScalar(1.012).toArray(cityPositions, i * 3);
      const label = document.createElement('button'); label.type = 'button';
      label.className = 'wt-globe-label';
      label.textContent = marker.node.querySelector('text').textContent;
      label.setAttribute('aria-label', pick(`查看${label.textContent}时间`, `View ${label.textContent} time`));
      label.addEventListener('click', () => onPick(marker.id), { signal });
      label.addEventListener('focus', () => { hold = Infinity; }, { signal });
      label.addEventListener('blur', () => { hold = performance.now() + 4500; }, { signal });
      labelLayer.append(label); labels.push(label);
    }
    const cityGeometry = track(new THREE.BufferGeometry());
    cityGeometry.setAttribute('position', new THREE.BufferAttribute(cityPositions, 3));
    cityGeometry.setAttribute('color', new THREE.BufferAttribute(cityColors, 3));
    const dotCanvas = document.createElement('canvas'); dotCanvas.width = dotCanvas.height = 16;
    const dot = dotCanvas.getContext('2d'); dot.fillStyle = '#ffffff'; dot.beginPath(); dot.arc(8, 8, 7, 0, Math.PI * 2); dot.fill();
    const cityMaterial = track(new THREE.PointsMaterial({ size: 0.019, map: track(new THREE.CanvasTexture(dotCanvas)), alphaTest: 0.3, transparent: true, vertexColors: true, depthWrite: false }));
    const cityPoints = new THREE.Points(cityGeometry, cityMaterial);
    cityPoints.renderOrder = 3; scene.add(cityPoints);
    const selectionMaterial = track(new THREE.MeshBasicMaterial({ color: 0xf2e94e, side: THREE.DoubleSide, transparent: true, opacity: 0.85, depthWrite: false }));
    const selection = new THREE.Mesh(track(new THREE.RingGeometry(0.023, 0.031, 32)), selectionMaterial);
    selection.visible = false; selection.renderOrder = 4; scene.add(selection);

    // A restrained orbit and small solar-panel satellite retain the old globe's
    // character. The line is depth-tested, so the planet hides the far half.
    const orbit = new THREE.Group(); orbit.rotation.set(0.55, 0.15, -0.18); scene.add(orbit);
    const orbitPoints = Array.from({ length: 128 }, (_, i) => new THREE.Vector3(Math.cos(i * Math.PI / 64) * 1.3, 0, Math.sin(i * Math.PI / 64) * 1.3));
    const orbitMaterial = track(new THREE.LineBasicMaterial({ color: 0x35acbf, transparent: true, opacity: 0.18, depthWrite: false }));
    const orbitLine = new THREE.LineLoop(track(new THREE.BufferGeometry().setFromPoints(orbitPoints)), orbitMaterial);
    orbitLine.renderOrder = 2; orbit.add(orbitLine);
    const satellite = new THREE.Group(); orbit.add(satellite);
    satellite.add(new THREE.Mesh(track(new THREE.BoxGeometry(0.023, 0.025, 0.028)), track(new THREE.MeshBasicMaterial({ color: 0xc4d8dd }))));
    const panels = new THREE.Mesh(track(new THREE.BoxGeometry(0.09, 0.005, 0.025)), track(new THREE.MeshBasicMaterial({ color: 0x327b98 })));
    satellite.add(panels);

    const glowCanvas = document.createElement('canvas'); glowCanvas.width = glowCanvas.height = 64;
    const glow = glowCanvas.getContext('2d'), gradient = glow.createRadialGradient(32, 32, 1, 32, 32, 32);
    gradient.addColorStop(0, '#fffbea'); gradient.addColorStop(0.1, '#ffe4a0'); gradient.addColorStop(0.22, '#ffbb5370'); gradient.addColorStop(1, '#ffb34700');
    glow.fillStyle = gradient; glow.fillRect(0, 0, 64, 64);
    const sunSprite = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: track(new THREE.CanvasTexture(glowCanvas)), blending: THREE.AdditiveBlending, depthWrite: false })));
    sunSprite.scale.setScalar(0.65); sunSprite.renderOrder = 5; scene.add(sunSprite);

    const pauseButton = root.querySelector('[data-globe-pause]');
    function syncPause() {
      pauseButton.disabled = false;
      pauseButton.textContent = paused ? pick('继续旋转', 'Resume rotation') : pick('暂停旋转', 'Pause rotation');
      pauseButton.setAttribute('aria-pressed', String(paused));
    }
    function pause(value) { paused = value; target = null; syncPause(); loop.wake(); }
    pauseButton.addEventListener('click', () => pause(!paused), { signal });
    motion.addEventListener('change', () => { if (motion.matches) pause(true); }, { signal });

    function palette() {
      const dark = document.documentElement.classList.contains('dark');
      if (theme === dark) return;
      theme = dark; uniforms.uLightTheme.value = dark ? 0 : 1;
      starMaterial.opacity = dark ? 0.65 : 0.24;
      starMaterial.color.set(dark ? 0x9abed0 : 0x405e73);
      orbitMaterial.color.set(dark ? 0x35acbf : 0x21667d);
      orbitMaterial.opacity = dark ? 0.18 : 0.28;
      selectionMaterial.color.set(dark ? 0xf2e94e : 0xa86600);
      for (const [i, marker] of markers.entries()) new THREE.Color(marker.id === selectedId ? (dark ? 0xf2e94e : 0xa86600) : (dark ? 0x4ac9ef : 0x00658b)).toArray(cityColors, i * 3);
      cityGeometry.attributes.color.needsUpdate = true;
      loop?.wake();
    }

    const viewDirection = new THREE.Vector3(), screen = new THREE.Vector3(), zAxis = new THREE.Vector3(0, 0, 1);
    let satelliteAngle = 0, nextLabels = 0;
    function measureLabels() {
      if (disposed) return;
      labels.forEach(label => { label.hidden = false; });
      labels.forEach((label, i) => { labelSizes[i] = [label.offsetWidth, label.offsetHeight]; });
      labels.forEach(label => { label.hidden = true; });
      nextLabels = 0; loop?.wake();
    }
    function updateLabels(now) {
      if (now < nextLabels && !target && !drag) return;
      nextLabels = now + 100; // Keep DOM work at 10 Hz while the sphere renders smoothly.
      viewDirection.copy(camera.position).normalize();
      const visible = markers.map((marker, i) => {
        const facing = marker.unit.dot(viewDirection);
        const front = facing > 0.005;
        if (front) {
          screen.copy(marker.unit).multiplyScalar(1.018).project(camera);
          marker.screen = [(screen.x + 1) * width / 2, (1 - screen.y) * height / 2];
          if (marker.screen[0] < -10 || marker.screen[0] > width + 10 || marker.screen[1] < -10 || marker.screen[1] > height + 10) marker.screen = null;
        } else marker.screen = null;
        return { marker, i, facing };
      }).filter(item => item.marker.screen);
      const layout = layoutLabels(visible.map(({ marker, i, facing }) => ({
        id: marker.id, i, facing, selected: marker.id === selectedId,
        x: marker.screen[0], y: marker.screen[1], w: labelSizes[i]?.[0] || 40, h: labelSizes[i]?.[1] || 20,
        previous: marker.labelOffset
      })), width, height);
      const shown = new Set(layout.map(item => item.i));
      for (let i = 0; i < labels.length; i++) {
        labels[i].hidden = !shown.has(i);
      }
      for (const item of layout) {
        const { i, left, top, x, y } = item;
        const marker = markers[i], label = labels[i];
        label.hidden = false;
        label.classList.toggle('is-selected', marker.id === selectedId);
        label.setAttribute('aria-pressed', String(marker.id === selectedId));
        label.style.transform = `translate(${left.toFixed(1)}px,${top.toFixed(1)}px)`;
        marker.labelOffset = [left - x, top - y];
      }
    }

    // Local preview diagnostics only: CPU submission time is not GPU frame time.
    let samples = 0, cost = 0, measuredAt = 0;
    function draw(now, elapsed) {
      const started = inspect ? performance.now() : 0;
      if (target) {
        const delta = ((target[0] - lon) % 360 + 540) % 360 - 180;
        const follow = 1 - Math.exp(-elapsed / 180);
        lon += delta * follow; lat += (target[1] - lat) * follow;
        if (Math.abs(delta) < 0.08 && Math.abs(target[1] - lat) < 0.08) target = null;
      } else if (!paused && !drag && now > hold) lon -= elapsed * 0.003;
      camera.position.copy(geoVector(lon, lat)).multiplyScalar(5);
      camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
      if (!paused && !drag) satelliteAngle += elapsed * 0.00018;
      satellite.position.set(Math.cos(satelliteAngle) * 1.3, 0, Math.sin(satelliteAngle) * 1.3);
      satellite.rotation.y = -satelliteAngle;
      renderer.render(scene, camera);
      updateLabels(now);
      // Uploads are complete; release decoded CPU bitmaps. Context loss falls back
      // to the flat map rather than trying to restore these closed image sources.
      bitmaps.forEach(bitmap => bitmap.close()); bitmaps.clear();
      if (inspect) {
        const cpu = performance.now() - started;
        samples++; cost += cpu;
        metrics.frames++; metrics.cpuTotal += cpu;
        if (!metrics.firstFrame) metrics.firstFrame = performance.now();
        if (now - measuredAt > 1000) {
          canvas.dataset.globeStats = JSON.stringify({ frames: renderer.info.render.frame, fpsCap: profile.fps, dpr: renderer.getPixelRatio(), texture: profile.texture, drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles, textures: renderer.info.memory.textures, cpuMs: Number((cost / samples).toFixed(2)) });
          measuredAt = now; samples = 0; cost = 0;
        }
      }
    }
    loop = frameLoop(draw, { fps: profile.fps, running: () => onScreen && !document.hidden && root.isConnected && !signal.aborted, moving: () => !paused || Boolean(target || drag) });
    function resize() {
      width = canvas.clientWidth; height = canvas.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      const half = 1.3 / zoom, aspect = width / height;
      camera.left = -half * aspect; camera.right = half * aspect; camera.top = half; camera.bottom = -half;
      camera.updateProjectionMatrix(); nextLabels = 0; loop.wake();
      measureLabels();
    }
    sizing = new ResizeObserver(resize); sizing.observe(canvas);
    visibility = new IntersectionObserver(entries => {
      onScreen = entries[0].isIntersecting;
      if (onScreen) loop.wake(); else loop.stop();
    }); visibility.observe(canvas);
    document.addEventListener('visibilitychange', () => { if (document.hidden) loop.stop(); else loop.wake(); }, { signal });
    root.querySelector('.wt-zoom input').addEventListener('input', event => { zoom = Number(event.target.value) || 1; resize(); }, { signal });
    function focus(id, instant = false) {
      selectedId = id;
      const marker = markers.find(item => item.id === id);
      if (!marker) return;
      target = [marker.lon, Math.max(-50, Math.min(50, marker.lat))];
      if (instant || motion.matches || paused) { [lon, lat] = target; target = null; }
      selection.visible = true;
      selection.position.copy(marker.unit).multiplyScalar(1.017);
      selection.quaternion.setFromUnitVectors(zAxis, marker.unit);
      hold = labelLayer.contains(document.activeElement) ? Infinity : performance.now() + 4500;
      theme = null; palette(); nextLabels = 0; loop.wake();
    }
    canvas.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, lon, lat, moved: 0 };
      canvas.setPointerCapture(event.pointerId); target = null; loop.wake();
    }, { signal });
    canvas.addEventListener('pointermove', event => {
      if (!drag || drag.id !== event.pointerId) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
      lon = drag.lon - dx * 180 / width;
      lat = Math.max(-75, Math.min(75, drag.lat + dy * 140 / height));
      nextLabels = 0; loop.wake();
    }, { signal });
    function release(event) {
      if (!drag || event.pointerId !== drag.id) return;
      if (event.type === 'pointerup' && drag.moved < 6) {
        const box = canvas.getBoundingClientRect(), x = event.clientX - box.left, y = event.clientY - box.top;
        const hit = markers.filter(marker => marker.screen).map(marker => [Math.hypot(marker.screen[0] - x, marker.screen[1] - y), marker]).sort((a, b) => a[0] - b[0])[0];
        if (hit && hit[0] < (profile.lite ? 24 : 18)) onPick(hit[1].id);
      }
      drag = null; hold = performance.now() + 4500; loop.wake();
    }
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(event, release, { signal });
    window.addEventListener('blur', () => { drag = null; loop.wake(); }, { signal });
    canvas.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', ' '].includes(event.key)) return;
      event.preventDefault(); target = null;
      if (event.key === ' ') return pause(!paused);
      if (event.key === 'ArrowLeft') lon -= 8;
      if (event.key === 'ArrowRight') lon += 8;
      if (event.key === 'ArrowUp') lat = Math.min(75, lat + 8);
      if (event.key === 'ArrowDown') lat = Math.max(-75, lat - 8);
      if (['+', '=', '-'].includes(event.key)) {
        const input = root.querySelector('.wt-zoom input');
        zoom = Math.max(Number(input.min), Math.min(Number(input.max), zoom + (event.key === '-' ? -0.1 : 0.1)));
        input.value = String(zoom); resize();
      }
      hold = performance.now() + 4500; nextLabels = 0; loop.wake();
    }, { signal });
    document.fonts.ready.then(() => measureLabels());
    syncPause(); palette(); resize();
    canvas.dataset.globeRenderer = 'three';
    return { dispose, palette, focus, sun(next) { sun.copy(geoVector(next.lon, next.lat)); sunSprite.position.copy(sun).multiplyScalar(1.85); loop.wake(); } };
  } catch (error) {
    dispose();
    throw error;
  }
}
