// Home banner scene: the real sky over the visitor's country right now (China when the
// country is unknown), always as a dark night: catalogue stars, faint constellation
// figures, the Milky Way, the bright planets and a generic ridge line. The camera faces
// whichever way shows the most Milky Way. No labels and no interaction beyond a slight
// pointer parallax. Loaded by scene-loader.js; mount() returns a dispose function.
// Data: tools/build-sky-data.cjs; credits in /images/sky/NOTICE.txt.
import * as THREE from '/js/vendor/three-0.170.0.module.min.js';
import { placeOf, horizonBasis, planets, viewAzimuth, decodeSky, equatorial, bvColor, PLANET_COLORS } from '/js/scenes/sky-math.js';

const RAD = Math.PI / 180;
const WEATHER_CACHE = 'aden-visitor-weather-v2'; // written by cyber-weather.js
const COUNTRY_CACHE = 'aden-sky-country';
const LOCATION_WAIT_MS = 1200;

function cachedCountry() {
  try {
    const own = sessionStorage.getItem(COUNTRY_CACHE);
    if (own) return own;
    const country = JSON.parse(sessionStorage.getItem(WEATHER_CACHE))?.payload?.location?.country;
    return typeof country === 'string' && /^[A-Z]{2}$/i.test(country) ? country : null;
  } catch { return null; }
}
function rememberCountry(country) {
  try { sessionStorage.setItem(COUNTRY_CACHE, country); } catch { /* optional */ }
}

// Altitude-dependent dimming and reddening near the horizon (airmass, extinction ~0.25 mag).
const EXTINCTION_GLSL = /* glsl */ `
float airmass(float s) { return 1.0 / (max(s, 0.0) + 0.025 * exp(-11.0 * max(s, 0.0))); }
vec3 extinct(vec3 c, float s) {
  float x = airmass(s) - 1.0;
  return c * vec3(pow(10.0, -0.4 * 0.20 * x), pow(10.0, -0.4 * 0.27 * x), pow(10.0, -0.4 * 0.38 * x));
}`;

// The loader's lite settings (lower pixel ratio, fewer stars) made phones visibly soft;
// this scene is light enough to draw at full sharpness everywhere, so lite only lowers
// the frame rate (the sky barely moves).
export function mount(container, { lite = false } = {}) {
  const fps = lite ? 30 : 60;
  const controller = new AbortController();
  let disposed = false, stop = () => {};
  const country = cachedCountry();
  const located = country ? Promise.resolve(country) : new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), LOCATION_WAIT_MS);
    addEventListener('aden:visitor-location', e => { clearTimeout(timer); resolve(e.detail?.country || null); }, { once: true, signal: controller.signal });
  });
  // Milky Way in two layers: a small whole-sky base for the faint glow and the band in
  // galactic coordinates at full detail (8192 wide, ~57 MB on the GPU; 4096 on devices
  // reporting under 4 GB).
  const loader = new THREE.TextureLoader();
  const textures = Promise.all([
    loader.loadAsync('/images/sky/milkyway-2048-v1.webp'),
    loader.loadAsync(`/images/sky/milkyway-band-${(navigator.deviceMemory ?? 8) < 4 ? 4096 : 8192}-v1.webp`),
  ]);
  const data = fetch('/images/sky/stars-v1.bin', { signal: controller.signal }).then(r => {
    if (!r.ok) throw new Error(`sky data ${r.status}`);
    return r.arrayBuffer();
  });
  Promise.all([data, textures, located]).then(([buffer, maps, first]) => {
    if (disposed) { maps.forEach(m => m.dispose()); return; }
    stop = build(container, { fps, sky: decodeSky(buffer), maps, country: first, signal: controller.signal });
  }).catch(() => {});
  return () => { disposed = true; controller.abort(); stop(); };
}

function build(container, { fps, sky, maps, country, signal }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.domElement.className = 'aden-scene-canvas';
  container.prepend(renderer.domElement);
  const dpr = renderer.getPixelRatio();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x010207);
  const camera = new THREE.PerspectiveCamera(66, 1, 0.1, 3000);
  camera.rotation.order = 'YXZ';
  const uniforms = { uTime: { value: 0 }, uDpr: { value: dpr } };
  const colorOut = '\n#include <colorspace_fragment>\n'; // a directive needs its own line

  // Night sky glow in the horizon frame: near-black at the zenith, a faint cool airglow
  // band and a warmer haze in the last few degrees.
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(2000, 64, 32), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        float s = vDir.y;
        if (s < 0.0) { gl_FragColor = vec4(vec3(0.002, 0.0025, 0.004), 1.0); ${colorOut} return; }
        vec3 col = vec3(0.0012, 0.0018, 0.0045);
        col += vec3(0.004, 0.008, 0.016) * exp(-max(s, 0.0) * 5.0);
        col += vec3(0.030, 0.026, 0.026) * exp(-max(s, 0.0) * 30.0);
        gl_FragColor = vec4(col, 1.0);
        ${colorOut}
      }`
  })));

  // Everything fixed to the stars lives in this group; its rotation is the sky at the
  // current time and place.
  const celestial = new THREE.Group();
  scene.add(celestial);

  // Milky Way. Base: equirectangular, RA 0h at the centre growing to the left. Band:
  // galactic longitude 0 at the centre growing to the left, latitude -46 (bottom) to +30
  // (top), as tools/build-sky-data.cjs writes it.
  for (const map of maps) {
    map.colorSpace = THREE.SRGBColorSpace;
    map.generateMipmaps = false;
    map.minFilter = THREE.LinearFilter;
    map.wrapS = THREE.RepeatWrapping;
  }
  celestial.add(new THREE.Mesh(new THREE.SphereGeometry(1500, 96, 48), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending,
    uniforms: { uBase: { value: maps[0] }, uBand: { value: maps[1] }, uExposure: { value: 1.25 }, uFloor: { value: 0.012 }, uSaturation: { value: 0.68 } },
    vertexShader: 'varying vec3 vEq; varying float vS; void main() { vEq = normalize(position); vS = normalize((modelMatrix * vec4(position, 1.0)).xyz).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */ `
      uniform sampler2D uBase; uniform sampler2D uBand; uniform float uExposure; uniform float uFloor; uniform float uSaturation;
      varying vec3 vEq; varying float vS;
      ${EXTINCTION_GLSL}
      void main() {
        const float TAU = 6.28318530718, PI = 3.14159265359;
        float ra = atan(vEq.y, vEq.x), dec = asin(clamp(vEq.z, -1.0, 1.0));
        vec3 base = texture2D(uBase, vec2(fract(0.5 - ra / TAU), 0.5 + dec / PI)).rgb;
        // The equirectangular base pinches into streaks at the celestial poles; fade its
        // last ~20 degrees there (the band covers the Milky Way near them).
        base *= smoothstep(0.985, 0.93, abs(vEq.z));
        // Equatorial to galactic (J2000).
        vec3 g = vec3(dot(vec3(-0.0548755604, -0.8734370902, -0.4838350155), vEq),
                      dot(vec3(0.4941094279, -0.4448296300, 0.7469822445), vEq),
                      dot(vec3(-0.8676661490, -0.1980763734, 0.4559837762), vEq));
        float l = atan(g.y, g.x), b = degrees(asin(clamp(g.z, -1.0, 1.0)));
        vec3 band = texture2D(uBand, vec2(fract(0.5 - l / TAU), (b + 46.0) / 76.0)).rgb;
        vec3 col = mix(base, band, smoothstep(-46.0, -40.0, b) * (1.0 - smoothstep(24.0, 30.0, b)));
        // Black level: the image's faint background goes to black.
        col = max(col - uFloor, 0.0) / (1.0 - uFloor) * uExposure;
        // Muted colour: the dust lanes stay warm without turning orange.
        col = mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, uSaturation);
        col = extinct(col, vS) * smoothstep(-0.02, 0.06, vS);
        gl_FragColor = vec4(col, 1.0);
        ${colorOut}
      }`
  })));

  // Stars: catalogue (to magnitude 6) and the fainter dust drawn from the Milky Way.
  {
    const dust = sky.dust;
    const n = sky.stars.length + dust.length;
    const pos = new Float32Array(n * 3), mag = new Float32Array(n), col = new Float32Array(n * 3), phase = new Float32Array(n);
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    [...sky.stars, ...dust].forEach(([ra, dec, m, bv], i) => {
      pos.set(equatorial(ra, dec).map(v => v * 1000), i * 3);
      mag[i] = m;
      col.set(bv === undefined ? bvColor(0.3 + rand() * 0.9) : bvColor(bv), i * 3);
      phase[i] = rand() * 6.2832;
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aMag', new THREE.BufferAttribute(mag, 1));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    celestial.add(new THREE.Points(g, starMaterial(uniforms, true)));
  }

  // Constellation figures, barely there.
  {
    const pos = new Float32Array(sky.segments.length * 6);
    sky.segments.forEach(([r1, d1, r2, d2], i) => pos.set([...equatorial(r1, d1), ...equatorial(r2, d2)].map(v => v * 1200), i * 6));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    celestial.add(new THREE.LineSegments(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: 'varying float vS; void main() { vS = normalize((modelMatrix * vec4(position, 1.0)).xyz).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `varying float vS; void main() { gl_FragColor = vec4(vec3(0.62, 0.74, 0.95) * 0.016 * smoothstep(0.03, 0.2, vS), 1.0); ${colorOut} }`
    })));
  }

  // Planets: same sprite as the stars, no twinkle, positions refreshed with the clock.
  const planetGeo = new THREE.BufferGeometry();
  const planetPos = new Float32Array(15), planetMag = new Float32Array(5), planetCol = new Float32Array(15);
  planetGeo.setAttribute('position', new THREE.BufferAttribute(planetPos, 3));
  planetGeo.setAttribute('aMag', new THREE.BufferAttribute(planetMag, 1));
  planetGeo.setAttribute('aColor', new THREE.BufferAttribute(planetCol, 3));
  planetGeo.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(5), 1));
  const planetPoints = new THREE.Points(planetGeo, starMaterial(uniforms, false));
  planetPoints.frustumCulled = false;
  celestial.add(planetPoints);

  // Generic ridge line: three layers of procedural hills, nearest darkest.
  // Draw order (nothing writes depth): glow, Milky Way, figures, stars, planets, far to near hills.
  celestial.children.forEach((child, i) => { child.renderOrder = 1 + i; });
  let layer = 10;
  for (const [radius, peak, seedOffset, tint] of [[900, 4.2, 1.7, 0.010], [500, 3.4, 5.3, 0.005], [260, 2.4, 9.1, 0.0015]]) {
    const geo = new THREE.CylinderGeometry(radius, radius, radius * 0.3, 256, 1, true);
    geo.translate(0, -radius * 0.05, 0);
    const hills = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      side: THREE.BackSide, transparent: true, depthWrite: false,
      vertexShader: 'varying vec3 vPos; void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */ `
        varying vec3 vPos;
        float h1(float n) { return fract(sin(n) * 43758.5453); }
        float n1(float x) { float i = floor(x), f = fract(x); return mix(h1(i), h1(i + 1.0), f * f * (3.0 - 2.0 * f)); }
        void main() {
          float az = atan(vPos.x, -vPos.z) + ${seedOffset.toFixed(1)};
          float ridge = 0.0, a = 0.55, f = 3.0;
          for (int i = 0; i < 6; i++) { ridge += a * n1(az * f + float(i) * 7.3); f *= 2.15; a *= 0.5; }
          float elev = atan(vPos.y, ${radius.toFixed(1)}) / ${RAD};
          float top = (ridge - 0.12) * ${peak.toFixed(2)};
          float edge = fwidth(elev);
          float inside = 1.0 - smoothstep(top - edge, top + edge, elev);
          if (inside <= 0.0) discard;
          gl_FragColor = vec4(vec3(${tint}, ${tint * 1.2}, ${tint * 1.6}), inside);
          ${colorOut}
        }`
    }));
    hills.renderOrder = layer++;
    scene.add(hills);
  }

  // Place and time. The sky is rotated to the current time every 10 s; a late
  // country (first visit, weather still loading) eases the sky over instead of jumping.
  let place = placeOf(country), lookAz = null;
  const targetQ = new THREE.Quaternion(), basisM = new THREE.Matrix4();
  function aim(now = Date.now()) {
    const b = horizonBasis(place[0], place[1], now);
    basisM.makeBasis(new THREE.Vector3(...b[0]), new THREE.Vector3(...b[1]), new THREE.Vector3(...b[2]));
    targetQ.setFromRotationMatrix(basisM);
    if (lookAz === null) lookAz = viewAzimuth(b, place[0], { halfWidth: hfov() / 2 });
    planets(now).forEach((p, i) => {
      planetPos.set(equatorial(p.ra, p.dec).map(v => v * 1000), i * 3);
      planetMag[i] = p.mag;
      planetCol.set(PLANET_COLORS[p.name], i * 3);
    });
    planetGeo.attributes.position.needsUpdate = planetGeo.attributes.aMag.needsUpdate = planetGeo.attributes.aColor.needsUpdate = true;
  }

  function hfov() { return 2 * Math.atan(Math.tan(camera.fov * RAD / 2) * camera.aspect) / RAD; }
  // Horizon about four fifths of the way down; wider field on portrait screens.
  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = camera.aspect < 1 ? 78 : 66;
    camera.updateProjectionMatrix();
  }
  const sizing = new ResizeObserver(resize);
  sizing.observe(container);
  resize();

  aim();
  celestial.quaternion.copy(targetQ);
  let yaw = lookAz;
  if (!country) {
    addEventListener('aden:visitor-location', e => {
      const code = e.detail?.country;
      if (typeof code !== 'string') return;
      rememberCountry(code);
      const next = placeOf(code);
      if (next === place) return;
      place = next;
      lookAz = null;
      aim();
    }, { once: true, signal });
  } else rememberCountry(country);
  const clock = setInterval(() => aim(), 10000);

  const pointer = new THREE.Vector2();
  const onPointer = e => pointer.set(e.clientX / innerWidth - 0.5, e.clientY / innerHeight - 0.5);
  addEventListener('pointermove', onPointer, { passive: true, signal });

  let last = 0, next = 0, onScreen = true, shown = false;
  const look = new THREE.Vector2();
  function frame(now) {
    if (now < next - 1) return;
    next = next + 1000 / fps < now ? now + 1000 / fps : next + 1000 / fps;
    const dt = Math.min(now - last, 100);
    last = now;
    uniforms.uTime.value += dt / 1000;
    const ease = 1 - (1 - 0.05) ** (dt / 33.3), slow = 1 - (1 - 0.02) ** (dt / 33.3);
    celestial.quaternion.slerp(targetQ, slow);
    yaw += ((((lookAz - yaw) % 360) + 540) % 360 - 180) * slow;
    look.x += (pointer.x - look.x) * ease;
    look.y += (pointer.y - look.y) * ease;
    const pitch = Math.atan(0.58 * Math.tan(camera.fov * RAD / 2)) / RAD;
    camera.rotation.set((pitch - look.y * 1.2) * RAD, (-yaw - look.x * 2.4) * RAD, 0);
    camera.position.set(look.x * 6, -look.y * 2, 0);
    renderer.render(scene, camera);
    if (!shown) { shown = true; container.classList.add('aden-scene-ready'); }
  }
  const update = () => renderer.setAnimationLoop(onScreen && !document.hidden ? frame : null);
  const visibility = new IntersectionObserver(entries => { onScreen = entries[0].isIntersecting; update(); });
  visibility.observe(container);
  document.addEventListener('visibilitychange', update, { signal });
  update();

  return () => {
    renderer.setAnimationLoop(null);
    clearInterval(clock);
    visibility.disconnect();
    sizing.disconnect();
    container.classList.remove('aden-scene-ready');
    scene.traverse(o => { o.geometry?.dispose(); [].concat(o.material || []).forEach(m => m.dispose()); });
    maps.forEach(m => m.dispose());
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  };
}

// Point sprites sized and weighted by magnitude: a tight core plus a soft halo on the
// bright ones; twinkle grows toward the horizon (planets do not twinkle).
function starMaterial(uniforms, twinkle) {
  return new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform float uTime; uniform float uDpr;
      attribute float aMag; attribute vec3 aColor; attribute float aPhase;
      varying vec3 vColor; varying float vCore;
      ${EXTINCTION_GLSL}
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        float s = normalize(world.xyz).y;
        float flux = pow(10.0, -0.4 * (aMag - 6.0));
        float t = clamp((6.6 - aMag) / 8.0, 0.0, 1.0);
        float size = 1.5 + 9.5 * pow(t, 1.7);
        float a = clamp(0.30 * pow(flux, 0.42), 0.05, 2.2);
        ${twinkle ? 'a *= 1.0 - (0.10 + 0.45 * (1.0 - smoothstep(0.0, 0.5, s))) * (0.5 + 0.5 * sin(uTime * (1.7 + fract(aPhase * 3.1) * 2.5) + aPhase));' : ''}
        vColor = extinct(aColor, s) * a * smoothstep(-0.01, 0.03, s);
        vCore = 1.0 / max(size, 1.0);
        gl_PointSize = size * uDpr * (s > -0.02 ? 1.0 : 0.0);
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor; varying float vCore;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float core = exp(-r * r / (vCore * vCore * 2.2 + 0.02));
        float halo = exp(-r * 4.0) * 0.35;
        gl_FragColor = vec4(vColor * (core + halo) * (1.0 - smoothstep(0.8, 1.0, r)), 1.0);
        #include <colorspace_fragment>
      }`
  });
}
