// Home banner scene: Saturn from just outside the A ring, ring plane at 35 degrees.
// Procedural only (no models or textures). Loaded by scene-loader.js on capable
// desktops; mount() returns a dispose function that frees the GPU context.
import * as THREE from '/js/vendor/three-0.170.0.module.min.js';

const R = 10, RING_IN = 12, RING_OUT = 23;

// Ring optical depth by radius (C, B, Cassini division, A, Encke gap); shared by the
// ring, the planet's ring shadow and the rock placement.
const RING_GLSL = /* glsl */ `
float hash1(float n) { return fract(sin(n) * 43758.5453123); }
float noise1(float x) { float i = floor(x), f = fract(x); return mix(hash1(i), hash1(i + 1.0), f * f * (3.0 - 2.0 * f)); }
float ringDensity(float r) {
  float d = smoothstep(12.0, 12.6, r) * (1.0 - smoothstep(14.6, 15.0, r)) * 0.22
          + smoothstep(14.8, 15.3, r) * (1.0 - smoothstep(19.2, 19.45, r)) * 0.95
          + smoothstep(20.15, 20.4, r) * (1.0 - smoothstep(22.4, 22.85, r)) * 0.72;
  d *= 1.0 - (1.0 - smoothstep(0.0, 0.09, abs(r - 21.9))) * 0.92;
  float bands = 0.62 + 0.25 * noise1(r * 9.0) + 0.18 * noise1(r * 41.0) - 0.1 * noise1(r * 130.0);
  return clamp(d * bands, 0.0, 1.0);
}`;
function ringDensity(r) {
  const s = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const d = s(12, 12.6, r) * (1 - s(14.6, 15, r)) * 0.22 + s(14.8, 15.3, r) * (1 - s(19.2, 19.45, r)) * 0.95 + s(20.15, 20.4, r) * (1 - s(22.4, 22.85, r)) * 0.72;
  return d * (1 - (1 - s(0, 0.09, Math.abs(r - 21.9))) * 0.92);
}
const NOISE3 = /* glsl */ `
float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float noise3(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x), mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x), mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * noise3(p); p *= 2.03; a *= 0.5; } return s; }`;
const PASS_POS = 'varying vec3 vPos; void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';

export function mount(container, { fps = 30, maxDpr = 1.5, lite = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, maxDpr));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.domElement.className = 'aden-scene-canvas';
  container.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x04070d);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 2000);
  const home = new THREE.Vector3(-1.5, 1.6, 31);
  camera.position.copy(home);
  // The banner title sits on the left, so the planet is framed on the right.
  const target = new THREE.Vector3(-7.5, 1.0, 0);
  const system = new THREE.Group();
  system.rotation.set(0.12, 0, -35 * Math.PI / 180);
  scene.add(system);

  const sunWorld = new THREE.Vector3(-0.85, 0.42, -0.45).normalize();
  const uniforms = { uTime: { value: 0 }, uSun: { value: new THREE.Vector3() }, uCam: { value: new THREE.Vector3() } };
  const shaderOut = '#include <tonemapping_fragment>\n#include <colorspace_fragment>';

  // Planet: rippled latitude bands, soft terminator, ring shadow, thin rim light.
  system.add(new THREE.Mesh(new THREE.SphereGeometry(R, 160, 80), new THREE.ShaderMaterial({
    uniforms, vertexShader: PASS_POS,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun; uniform vec3 uCam; uniform float uTime; varying vec3 vPos;
      ${RING_GLSL}
      ${NOISE3}
      void main() {
        vec3 n = normalize(vPos);
        float lat = n.y;
        float y = lat + (fbm(vec3(n.x * 4.0 + uTime * 0.003, lat * 14.0, n.z * 4.0)) - 0.5) * 0.035;
        float aa = fwidth(y);
        float b = (0.5 + 0.5 * sin(y * 18.0)) * 0.5 + (0.5 + 0.5 * sin(y * 57.0 + 1.3)) * 0.28
                + (0.5 + 0.5 * sin(y * 163.0 + 0.4)) * (1.0 - smoothstep(0.004, 0.012, aa)) * 0.14
                + noise3(vec3(y * 420.0, 0.0, 0.0)) * (1.0 - smoothstep(0.0015, 0.005, aa)) * 0.08;
        vec3 col = mix(vec3(0.50, 0.38, 0.24), vec3(0.90, 0.80, 0.60), smoothstep(0.2, 0.85, b));
        col = mix(col, vec3(0.97, 0.92, 0.80), smoothstep(0.12, 0.0, abs(y)) * 0.45);
        col *= 0.93 + 0.14 * fbm(vec3(n.x * 9.0 + uTime * 0.002, y * 60.0, n.z * 9.0));
        col = mix(col, vec3(0.50, 0.57, 0.60), smoothstep(0.80, 0.97, abs(lat)));
        float ndl = dot(n, uSun);
        float light = smoothstep(-0.12, 0.35, ndl);
        if (uSun.y * vPos.y < 0.0) light *= 1.0 - ringDensity(length((vPos + uSun * (-vPos.y / uSun.y)).xz)) * 0.85;
        float rim = pow(1.0 - max(dot(n, normalize(uCam - vPos)), 0.0), 3.0);
        gl_FragColor = vec4(col * light * 0.9 + col * 0.015 + vec3(0.95, 0.82, 0.6) * rim * 0.35 * smoothstep(-0.2, 0.4, ndl), 1.0);
        ${shaderOut}
      }`
  })));

  // Ring sheet: bands, Keplerian grain drift, planet shadow, dim unlit face.
  const ringGeo = new THREE.RingGeometry(RING_IN, RING_OUT, 360, 1);
  ringGeo.rotateX(-Math.PI / 2);
  system.add(new THREE.Mesh(ringGeo, new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide, vertexShader: PASS_POS,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun; uniform vec3 uCam; uniform float uTime; varying vec3 vPos;
      ${RING_GLSL}
      float hash2(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main() {
        float r = length(vPos.xz), d = ringDensity(r);
        if (d < 0.01) discard;
        float th = atan(vPos.z, vPos.x) + uTime * 0.02 * pow(r / 20.0, -1.5);
        float grain = hash2(floor(vec2(r * 140.0, th * 1400.0)));
        vec3 col = mix(vec3(0.62, 0.54, 0.43), vec3(0.90, 0.82, 0.68), noise1(r * 23.0));
        float b = dot(vPos, uSun), h = b * b - dot(vPos, vPos) + ${(R * R).toFixed(1)};
        float lit = (h > 0.0 && -b + sqrt(h) > 0.0) ? 0.04 : 1.0;
        float face = uSun.y * uCam.y > 0.0 ? 1.0 : 0.35 * (1.0 - d) + 0.05;
        gl_FragColor = vec4(col * lit * face * (0.85 + 0.3 * grain) * 0.85, d * (0.62 + 0.25 * grain));
        ${shaderOut}
      }`
  })));

  // Rocks: orbit and tumble in the vertex shader; thin cyan rim in the fragment shader.
  let seed = 11;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const gauss = () => (rand() + rand() + rand() - 1.5) / 1.5;
  function rockGeometry(detail, s) {
    const g = new THREE.IcosahedronGeometry(1, detail), p = g.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      v.multiplyScalar(1 + 0.28 * Math.sin(v.x * 3.1 + s) * Math.cos(v.y * 2.7 - s) + 0.14 * Math.sin(v.z * 5.3 + s * 2));
      p.setXYZ(i, v.x, v.y * 0.82, v.z);
    }
    g.computeVertexNormals();
    return g;
  }
  function rockField(count, geometry, place) {
    const orbit = new Float32Array(count * 4), spin = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const [r, y, size] = place();
      orbit.set([r, rand() * Math.PI * 2, y, size], i * 4);
      spin.set([gauss(), gauss(), gauss()], i * 3);
    }
    geometry.setAttribute('aOrbit', new THREE.InstancedBufferAttribute(orbit, 4));
    geometry.setAttribute('aSpin', new THREE.InstancedBufferAttribute(spin, 3));
    const material = new THREE.MeshStandardMaterial({ color: 0xc9c3ba, roughness: 0.92, flatShading: true });
    material.onBeforeCompile = shader => {
      shader.uniforms.uTime = uniforms.uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          uniform float uTime; attribute vec4 aOrbit; attribute vec3 aSpin;
          mat3 rotAxis(vec3 a, float t) {
            float s = sin(t), c = cos(t), o = 1.0 - c;
            return mat3(o*a.x*a.x + c, o*a.x*a.y + a.z*s, o*a.z*a.x - a.y*s, o*a.x*a.y - a.z*s, o*a.y*a.y + c, o*a.y*a.z + a.x*s, o*a.z*a.x + a.y*s, o*a.y*a.z - a.x*s, o*a.z*a.z + c);
          }`)
        .replace('#include <beginnormal_vertex>', `
          float th = aOrbit.y + uTime * 0.02 * pow(aOrbit.x / 20.0, -1.5);
          mat3 spin = rotAxis(normalize(aSpin + 0.001), uTime * 0.25 * length(aSpin) + aOrbit.y * 9.0);
          vec3 objectNormal = spin * normal;`)
        .replace('#include <begin_vertex>', 'vec3 transformed = spin * (position * aOrbit.w) + vec3(cos(th) * aOrbit.x, aOrbit.z, -sin(th) * aOrbit.x);');
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(0.09, 0.84, 0.91) * pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 3.0) * 0.18;`);
    };
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.frustumCulled = false; // positions come from the shader
    return mesh;
  }
  system.add(
    rockField(lite ? 3500 : 7000, rockGeometry(0, 1.3), () => {
      let r;
      do { r = RING_IN + rand() * (RING_OUT - RING_IN); } while (rand() > ringDensity(r));
      return [r, gauss() * 0.04, rand() < 0.015 ? 0.05 + rand() * 0.08 : 0.006 + rand() * 0.018];
    }),
    rockField(lite ? 220 : 450, rockGeometry(2, 4.1), () => [25 + rand() * 18, gauss() * 1.6, 0.03 + Math.pow(rand(), 4) * 0.32])
  );
  scene.add(new THREE.HemisphereLight(0x5a7c93, 0x0a0d12, 0.35));
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.1);
  sun.position.copy(sunWorld).multiplyScalar(100);
  scene.add(sun);

  // Stars on a far sphere, slow twinkle.
  {
    const n = 2600, pos = new Float32Array(n * 3), size = new Float32Array(n), phase = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const z = rand() * 2 - 1, t = rand() * Math.PI * 2, k = Math.sqrt(1 - z * z);
      pos.set([k * Math.cos(t) * 900, z * 900, k * Math.sin(t) * 900], i * 3);
      size[i] = 0.6 + Math.pow(rand(), 6) * 2.6;
      phase[i] = rand() * 6.28;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    scene.add(new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: { uTime: uniforms.uTime, uDpr: { value: renderer.getPixelRatio() } }, transparent: true, depthWrite: false,
      vertexShader: 'uniform float uTime; uniform float uDpr; attribute float aSize; attribute float aPhase; varying float vA; void main() { vA = 0.55 + 0.45 * sin(uTime * 0.8 + aPhase); gl_PointSize = aSize * uDpr * 1.6; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'varying float vA; void main() { gl_FragColor = vec4(vec3(0.82, 0.9, 1.0), vA * smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5))); }'
    })));
  }

  // Sizing follows the banner; narrow banners back the camera off to keep the rings in.
  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    home.z = 31 / Math.min(1, camera.aspect / 1.5);
    camera.position.z = home.z;
  }
  const sizing = new ResizeObserver(resize);
  sizing.observe(container);
  resize();

  const pointer = new THREE.Vector2();
  const onPointer = e => pointer.set(e.clientX / innerWidth - 0.5, e.clientY / innerHeight - 0.5);
  addEventListener('pointermove', onPointer, { passive: true });

  // Runs only while the banner is on screen and the tab is visible; capped frame rate.
  const inverse = new THREE.Matrix4();
  let last = 0, onScreen = true, shown = false;
  function frame(now) {
    if (now - last < 1000 / fps - 2) return;
    uniforms.uTime.value += Math.min(now - last, 100) / 1000;
    last = now;
    camera.position.x += (home.x + pointer.x * 3 - camera.position.x) * 0.05;
    camera.position.y += (home.y - pointer.y * 1.2 - camera.position.y) * 0.05;
    camera.lookAt(target);
    system.updateMatrixWorld();
    inverse.copy(system.matrixWorld).invert();
    uniforms.uSun.value.copy(sunWorld).transformDirection(inverse);
    uniforms.uCam.value.copy(camera.position).applyMatrix4(inverse);
    renderer.render(scene, camera);
    if (!shown) { shown = true; container.classList.add('aden-scene-ready'); }
  }
  const update = () => renderer.setAnimationLoop(onScreen && !document.hidden ? frame : null);
  const visibility = new IntersectionObserver(entries => { onScreen = entries[0].isIntersecting; update(); });
  visibility.observe(container);
  document.addEventListener('visibilitychange', update);
  update();

  return () => {
    renderer.setAnimationLoop(null);
    visibility.disconnect();
    sizing.disconnect();
    document.removeEventListener('visibilitychange', update);
    removeEventListener('pointermove', onPointer);
    container.classList.remove('aden-scene-ready');
    scene.traverse(o => { o.geometry?.dispose(); [].concat(o.material || []).forEach(m => m.dispose()); });
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  };
}
