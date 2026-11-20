// 404 page scene: "404 Mart", an original rainy street corner. Built from primitives
// and canvas-drawn signs, so nothing is downloaded but three.js. Static parts are
// merged per material after construction; rain and shelf goods are instanced.
// Loaded by scene-loader.js on capable desktops; mount() returns a dispose function.
import * as THREE from '/js/vendor/three-0.170.0.module.min.js';

const TEXT = {
  zh: { hint: '拖动旋转 · 点招牌开关灯 · 点售货机买一罐 · 点店门回首页', open: '营业中', closed: '打烊了', vend: 'ガコン — 掉出来一罐' },
  en: { hint: 'Drag to look around · sign: lights · vending machine: a drink · door: home', open: 'Open', closed: 'Closed for the night', vend: 'Clunk — one can' }
};

// Concatenates indexed geometries (position/normal/uv, plus colour when given).
function mergeGeometries(list, colors) {
  let vertices = 0, indices = 0;
  for (const g of list) { vertices += g.attributes.position.count; indices += g.index.count; }
  const position = new Float32Array(vertices * 3), normal = new Float32Array(vertices * 3), uv = new Float32Array(vertices * 2), index = new Uint32Array(indices);
  const color = colors && new Float32Array(vertices * 3);
  let v = 0, i = 0;
  list.forEach((g, n) => {
    const count = g.attributes.position.count;
    position.set(g.attributes.position.array, v * 3);
    normal.set(g.attributes.normal.array, v * 3);
    uv.set(g.attributes.uv.array, v * 2);
    if (color) for (let k = 0; k < count; k++) colors[n].toArray(color, (v + k) * 3);
    const src = g.index.array;
    for (let k = 0; k < src.length; k++) index[i + k] = src[k] + v;
    v += count;
    i += src.length;
  });
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(position, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (color) merged.setAttribute('color', new THREE.BufferAttribute(color, 3));
  merged.setIndex(new THREE.BufferAttribute(index, 1));
  return merged;
}

// Bakes plain static meshes into a few draws. Untextured, unlit-by-emission, opaque
// parts share one material per surface finish, with their colours moved into the
// vertices; anything else merges only with an identical look. Materials the scene
// changes later (userData.live) group by identity so those changes still apply.
function mergeStatic(scene, keep) {
  const plain = m => m.isMeshStandardMaterial && !m.map && !m.emissiveMap && !m.transparent && !m.wireframe && !m.userData.live && m.emissive.getHex() === 0;
  const look = m => m.userData.live ? m.uuid : plain(m)
    ? ['plain', m.roughness.toFixed(1), m.metalness.toFixed(1), m.flatShading].join('|')
    : [m.type, m.color?.getHex(), m.emissive?.getHex(), m.emissiveIntensity, m.roughness, m.metalness, m.map?.uuid, m.emissiveMap?.uuid,
      m.transparent, m.opacity, m.wireframe, m.blending, m.side, m.depthWrite, m.flatShading].join('|');
  const groups = new Map();
  scene.updateMatrixWorld(true);
  for (const mesh of [...scene.children]) {
    if (!mesh.isMesh || mesh.isInstancedMesh || Array.isArray(mesh.material) || keep.has(mesh) || !mesh.geometry.index) continue;
    const key = look(mesh.material);
    if (!groups.has(key)) groups.set(key, { plain: plain(mesh.material), parts: [] });
    groups.get(key).parts.push(mesh);
  }
  for (const { plain: tinted, parts } of groups.values()) {
    if (parts.length < 2) continue;
    const first = parts[0].material;
    const material = tinted
      ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: first.roughness, metalness: first.metalness, flatShading: first.flatShading })
      : first;
    const geometry = mergeGeometries(parts.map(m => m.geometry.clone().applyMatrix4(m.matrixWorld)), tinted && parts.map(m => m.material.color));
    // Source materials may still be used by unmerged parts (e.g. the fridge's sides), so only geometry is freed here.
    for (const m of parts) { scene.remove(m); m.geometry.dispose(); }
    scene.add(new THREE.Mesh(geometry, material));
  }
}

export function mount(container, { fps = 30, maxDpr = 1.5 } = {}) {
  const english = document.documentElement.lang?.startsWith('en');
  const text = TEXT[english ? 'en' : 'zh'];
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, maxDpr));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.domElement.className = 'aden-scene-canvas';
  // Horizontal drags turn the view; vertical swipes still scroll the page on touch screens.
  renderer.domElement.style.touchAction = 'pan-y';
  container.prepend(renderer.domElement);
  const hint = document.createElement('p');
  hint.className = 'aden-store-hint';
  hint.textContent = text.hint;
  const toast = document.createElement('p');
  toast.className = 'aden-store-toast';
  toast.setAttribute('aria-live', 'polite');
  container.append(hint, toast);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05080e);
  scene.fog = new THREE.Fog(0x05080e, 22, 48);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
  const target = new THREE.Vector3(0.4, 1.4, -0.6);

  // Canvas-drawn texture; draw(ctx, w, h) paints it.
  function canvasTexture(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }

  const time = { value: 0 };
  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });
  const box = (w, h, d, material, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    m.position.set(x, y, z);
    scene.add(m);
    return m;
  };

  // Canvas-drawn texture; draw(ctx, w, h) paints it.
  function canvasTexture(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }

  // ---- Base, road and sidewalk ----
  box(15, 0.5, 10, mat(0x0a0e15, { roughness: 0.6 }), 0, -0.25, 0);
  // Wet asphalt: low roughness so the lamp and shop glow streak across it.
  const road = box(15, 0.02, 4.2, mat(0x10141b, { roughness: 0.28, metalness: 0.35 }), 0, 0.01, 2.75);
  box(15, 0.14, 2.3, mat(0x2a2f37, { roughness: 0.7 }), 0, 0.07, -0.05);
  box(15, 0.16, 0.12, mat(0x8d939b), 0, 0.08, 1.12);
  const paint = mat(0xd9dde2, { roughness: 0.6 });
  for (let i = 0; i < 6; i++) box(0.45, 0.012, 3.2, paint, 1.2 + i * 0.8, 0.03, 2.8);
  for (let i = 0; i < 4; i++) box(1.1, 0.012, 0.1, paint, -6.4 + i * 1.8, 0.03, 2.75);

  // ---- Shop shell: open front, about 3 m of floor behind the glass ----
  const wall = mat(0xd5d9de, { roughness: 0.8 });
  const BACK = -4.1, FRONT = -0.95, MID = (BACK + FRONT) / 2, DEPTH = FRONT - BACK;
  box(0.3, 3.3, DEPTH, wall, -3.05, 1.79, MID);
  box(0.3, 3.3, DEPTH, wall, 3.05, 1.79, MID);
  box(6.4, 3.3, 0.3, wall, 0, 1.79, BACK);
  box(6.4, 0.3, DEPTH, wall, 0, 3.3, MID);
  box(6.4, 0.9, 0.2, wall, 0, 2.99, -1.05);
  const frameMat = mat(0x3c434c, { roughness: 0.5, metalness: 0.4 });
  for (const x of [-1.2, 0.6, 1.8]) box(0.08, 2.4, 0.08, frameMat, x, 1.35, -0.92);
  box(6.0, 0.08, 0.08, frameMat, 0, 2.52, -0.92);

  // Floor tiles.
  const tiles = canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#e9e5db'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#c9c3b5'; g.lineWidth = 3;
    for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, h); g.moveTo(0, i * 64); g.lineTo(w, i * 64); g.stroke(); }
  });
  tiles.wrapS = tiles.wrapT = THREE.RepeatWrapping;
  tiles.repeat.set(6, 3);
  box(5.8, 0.05, DEPTH - 0.1, mat(0xffffff, { map: tiles, roughness: 0.35 }), 0, 0.17, MID);

  // Ceiling light strips (dimmed when the shop "closes").
  const ceilingMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6e8, emissiveIntensity: 1.4 });
  for (const z of [-1.5, -2.5, -3.5]) box(5.2, 0.04, 0.14, ceilingMat, 0, 3.12, z);

  // Drink fridges along the back wall: glass doors with rows of bottles.
  const fridgeTexture = canvasTexture(1024, 384, (g, w, h) => {
    g.fillStyle = '#e8f3f6'; g.fillRect(0, 0, w, h);
    const drinks = ['#2d7dd2', '#e84855', '#f9dc5c', '#3bb273', '#f07ab2', '#ff8c42', '#7a5cd6', '#ffffff'];
    for (let door = 0; door < 6; door++) {
      const x0 = door * (w / 6);
      for (let row = 0; row < 4; row++) {
        const y = 30 + row * 88;
        g.fillStyle = '#b6c4c9'; g.fillRect(x0, y + 66, w / 6, 4);
        for (let k = 0; k < 7; k++) {
          g.fillStyle = drinks[(door * 3 + row * 5 + k) % drinks.length];
          g.fillRect(x0 + 12 + k * 22, y + 18, 14, 48);
          g.fillRect(x0 + 15 + k * 22, y + 8, 8, 12);
        }
      }
      g.fillStyle = '#5b6770'; g.fillRect(x0, 0, 6, h); g.fillRect(x0 + w / 6 - 26, h / 2 - 40, 6, 80);
    }
  });
  const interiorMat = new THREE.MeshStandardMaterial({ map: fridgeTexture, emissive: 0xffffff, emissiveMap: fridgeTexture, emissiveIntensity: 0.5 });
  // Plain body (merged with the walls) plus one lit front face: one draw instead of six.
  box(5.6, 2.1, 0.55, wall, 0, 1.25, BACK + 0.45);
  const fridge = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 2.1), interiorMat);
  fridge.position.set(0, 1.25, BACK + 0.73);
  scene.add(fridge);

  // Two gondola shelves with products on both faces (one InstancedMesh for all items).
  const shelfMat = mat(0xf2f0ea);
  const gondolas = [[-1.05, -2.25], [-1.05, -3.05]];
  for (const [x, z] of gondolas) {
    box(3.0, 0.08, 0.5, shelfMat, x, 0.25, z);
    box(3.0, 1.3, 0.06, shelfMat, x, 0.85, z);
    for (const y of [0.55, 0.9, 1.25]) box(3.0, 0.03, 0.5, shelfMat, x, y, z);
  }
  {
    const palette = [0xe2534a, 0xf2b640, 0x3fa7d6, 0x59c27a, 0xf07ab2, 0xffffff, 0x8b6cd8, 0xff8c42].map(c => new THREE.Color(c));
    const items = [];
    for (const [gx, gz] of gondolas) for (const side of [-1, 1]) for (const y of [0.25, 0.55, 0.9, 1.25]) {
      for (let x = gx - 1.38; x < gx + 1.4; x += 0.13 + Math.random() * 0.05) {
        const h = 0.12 + Math.random() * 0.16;
        items.push([x, y + 0.04 + h / 2, gz + side * 0.13, 0.09, h, 0.16]);
      }
    }
    const products = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat(0xffffff, { roughness: 0.6 }), items.length);
    const m = new THREE.Matrix4();
    items.forEach(([x, y, z, w, h, d], i) => {
      products.setMatrixAt(i, m.makeScale(w, h, d).setPosition(x, y, z));
      products.setColorAt(i, palette[i % palette.length]);
    });
    scene.add(products);
  }

  // Checkout counter by the door: register, card reader, a warm hot-snack case.
  box(1.7, 0.95, 0.6, mat(0xf4f1ea), 2.05, 0.65, -2.0);
  box(0.6, 0.95, 1.1, mat(0xf4f1ea), 2.75, 0.65, -2.55);
  box(1.8, 0.04, 0.68, mat(0x6b7480, { roughness: 0.4 }), 2.05, 1.14, -2.0);
  box(0.34, 0.2, 0.3, mat(0x2b3138), 1.55, 1.26, -2.05);
  const screenMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x18d5e8, emissiveIntensity: 0.9 });
  const screen = box(0.28, 0.18, 0.02, screenMat, 1.55, 1.46, -1.95);
  screen.rotation.x = -0.35;
  box(0.5, 0.36, 0.4, new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xffa040, emissiveIntensity: 0.7, transparent: true, opacity: 0.8 }), 2.45, 1.34, -2.0);
  // Cigarette / lottery wall behind the counter.
  const backShelf = canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#20262d'; g.fillRect(0, 0, w, h);
    const c = ['#f2f2f2', '#d64545', '#3a7bd5', '#e8c547', '#4caf7a'];
    for (let r = 0; r < 6; r++) for (let k = 0; k < 8; k++) { g.fillStyle = c[(r + k * 2) % c.length]; g.fillRect(10 + k * 30, 12 + r * 40, 22, 28); }
  });
  const backShelfMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.2), new THREE.MeshStandardMaterial({ map: backShelf, emissive: 0xffffff, emissiveMap: backShelf, emissiveIntensity: 0.35 }));
  backShelfMesh.position.set(2.89, 1.9, -2.6);
  backShelfMesh.rotation.y = -Math.PI / 2;
  scene.add(backShelfMesh);
  // Magazine rack under the left window and a stack of baskets by the door.
  box(1.6, 0.8, 0.3, mat(0x9aa3ad), -2.1, 0.6, -1.15);
  const mags = canvasTexture(256, 64, (g, w, h) => { ['#e2534a', '#3fa7d6', '#f2b640', '#59c27a', '#f07ab2', '#ffffff', '#8b6cd8', '#ff8c42'].forEach((c, i) => { g.fillStyle = c; g.fillRect(i * 32 + 2, 4, 28, h - 8); }); });
  const magFront = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.35), new THREE.MeshStandardMaterial({ map: mags }));
  magFront.position.set(-2.1, 0.88, -0.99);
  scene.add(magFront);
  for (let i = 0; i < 4; i++) box(0.42, 0.06, 0.3, mat(0xd6283a), 0.25, 0.25 + i * 0.07, -1.25);
  // Glass: barely there, a slight blue sheen.
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(5.9, 2.3), new THREE.MeshStandardMaterial({ color: 0x9fc7d8, transparent: true, opacity: 0.12, roughness: 0.05, metalness: 0.6 }));
  glass.position.set(0, 1.33, -0.9);
  scene.add(glass);
  // Door: the click target that leads home.
  const door = box(1.12, 2.3, 0.04, new THREE.MeshStandardMaterial({ color: 0xbfe6ee, transparent: true, opacity: 0.18, roughness: 0.05 }), 1.2, 1.33, -0.88);
  door.userData.action = 'home';

  // ---- Signs ----
  const signTexture = canvasTexture(1024, 160, (g, w, h) => {
    g.fillStyle = '#f7f6f1'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#0b5f6b'; g.fillRect(0, h - 22, w, 22);
    g.fillStyle = '#f2e94e'; g.fillRect(0, h - 22, w * 0.18, 22);
    g.beginPath(); g.arc(86, 70, 46, 0, Math.PI * 2); g.fillStyle = '#0b5f6b'; g.fill();
    g.fillStyle = '#f2e94e'; g.font = 'bold 44px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('404', 86, 72);
    g.textAlign = 'left'; g.fillStyle = '#121820'; g.font = 'bold 76px sans-serif'; g.fillText('404 MART', 160, 64);
    g.font = '22px monospace'; g.fillStyle = '#56636e'; g.fillText('LOST & FOUND · 迷路便利店', 166, 116);
    g.fillStyle = '#0b5f6b'; g.fillRect(w - 230, 22, 200, 96);
    g.fillStyle = '#f7f6f1'; g.font = 'bold 60px sans-serif'; g.fillText('24H', w - 200, 72);
  });
  const signMat = new THREE.MeshStandardMaterial({ map: signTexture, emissive: 0xffffff, emissiveMap: signTexture, emissiveIntensity: 1.1 });
  box(6.5, 0.95, 0.22, mat(0xdedede), 0, 3.02, -0.82);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(6.5, 0.95), signMat);
  sign.position.set(0, 3.02, -0.705);
  sign.userData.action = 'lights';
  scene.add(sign);
  const stripe = box(6.5, 0.07, 0.24, new THREE.MeshStandardMaterial({ color: 0x18d5e8, emissive: 0x18d5e8, emissiveIntensity: 1.2 }), 0, 2.5, -0.82);

  const bladeTexture = canvasTexture(128, 512, (g, w, h) => {
    g.fillStyle = '#0d1d27'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#18d5e8'; g.lineWidth = 6; g.strokeRect(6, 6, w - 12, h - 12);
    g.fillStyle = '#f2e94e'; g.font = 'bold 64px sans-serif'; g.textAlign = 'center'; g.fillText('24', w / 2, 92); g.font = 'bold 34px sans-serif'; g.fillText('H', w / 2, 136);
    g.fillStyle = '#e8f4f7'; g.font = 'bold 50px sans-serif';
    ['迷', '路', '便', '利'].forEach((ch, i) => g.fillText(ch, w / 2, 220 + i * 70));
  });
  const bladeMat = new THREE.MeshStandardMaterial({ map: bladeTexture, emissive: 0xffffff, emissiveMap: bladeTexture, emissiveIntensity: 1 });
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.0, 0.1), bladeMat);
  blade.position.set(3.45, 3.1, -0.7);
  scene.add(blade);

  // ---- Vending machine: click for a can ----
  const vendTexture = canvasTexture(256, 512, (g, w, h) => {
    g.fillStyle = '#c8202c'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#f5f1e6'; g.fillRect(16, 20, w - 32, 280);
    const cans = ['#2d7dd2', '#e84855', '#f9dc5c', '#3bb273', '#1b1b1e', '#ff8c42'];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) {
      g.fillStyle = cans[(r + c) % cans.length]; g.fillRect(28 + c * 34, 34 + r * 66, 22, 44);
      g.fillStyle = '#18d5e8'; g.fillRect(30 + c * 34, 84 + r * 66, 18, 6);
    }
    g.fillStyle = '#1a1a1e'; g.fillRect(36, 400, w - 72, 60);
    g.fillStyle = '#f2e94e'; g.font = 'bold 26px sans-serif'; g.textAlign = 'center'; g.fillText('つめた〜い', w / 2, 350);
  });
  const vendMat = new THREE.MeshStandardMaterial({ map: vendTexture, emissive: 0xffffff, emissiveMap: vendTexture, emissiveIntensity: 0.55 });
  box(0.95, 1.9, 0.7, mat(0xb51c27), 4.0, 1.09, -0.75);
  const vending = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 1.9), vendMat);
  vending.position.set(4.0, 1.09, -0.395);
  vending.userData.action = 'vend';
  scene.add(vending);

  // ---- Street furniture ----
  const rail = mat(0xe9edf0, { roughness: 0.5 });
  for (const [x0, x1] of [[-6.8, -3.6], [4.9, 6.8]]) {
    for (let x = x0; x <= x1 + 0.01; x += 0.8) box(0.08, 0.7, 0.08, rail, x, 0.49, 0.95);
    box(x1 - x0, 0.06, 0.06, rail, (x0 + x1) / 2, 0.8, 0.95);
  }
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.55, 12), mat(0xff7a1a, { emissive: 0x401800 }));
  cone.position.set(-2.9, 0.42, 1.55);
  scene.add(cone);

  // Thin rod from a to b (bike frame, handlebars).
  function rod(a, b, radius, material) {
    const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, from.distanceTo(to), 8), material);
    m.position.copy(from).add(to).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
    scene.add(m);
    return m;
  }

  // ---- Parked kei van at the kerb: boxy body, tall cabin, tail lights on ----
  {
    const paintMat = mat(0x5f7f78, { roughness: 0.45, metalness: 0.3 });
    const glassMat = mat(0x1a242c, { roughness: 0.1, metalness: 0.6 });
    const trim = mat(0x22272d, { roughness: 0.6 });
    const x = -4.7, z = 2.05;
    box(2.7, 0.62, 1.32, paintMat, x, 0.62, z);
    box(2.05, 0.66, 1.26, paintMat, x - 0.25, 1.25, z);
    box(2.07, 0.42, 1.28, glassMat, x - 0.25, 1.3, z);
    box(0.06, 0.4, 1.0, glassMat, x + 0.8, 1.28, z);
    box(0.12, 0.18, 1.36, trim, x + 1.36, 0.42, z);
    box(0.12, 0.18, 1.36, trim, x - 1.36, 0.42, z);
    for (const s of [-1, 1]) {
      box(0.04, 0.16, 0.2, new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff2030, emissiveIntensity: 1.6 }), x - 1.37, 0.78, z + s * 0.5);
      box(0.04, 0.12, 0.2, mat(0xdde6ee, { emissive: 0x222222 }), x + 1.37, 0.78, z + s * 0.5);
    }
    const tyre = mat(0x0e1013, { roughness: 0.9 });
    for (const dx of [-0.85, 0.85]) for (const s of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.2, 18), tyre);
      w.rotation.x = Math.PI / 2;
      w.position.set(x + dx, 0.29, z + s * 0.62);
      scene.add(w);
    }
    // Red glow of the tail lights on the wet road.
    const tail = new THREE.PointLight(0xff2030, 2.5, 2.5, 2);
    tail.position.set(x - 1.6, 0.6, z);
    scene.add(tail);
  }

  // ---- Bicycle leaning on its stand by the window: city bike with a front basket ----
  {
    const steel = mat(0x7d8790, { roughness: 0.35, metalness: 0.7 });
    const frameColor = mat(0x2f6f8f, { roughness: 0.4, metalness: 0.3 });
    const z = 0.45, y = 0.47;
    for (const x of [-2.6, -1.62]) {
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.025, 8, 28), mat(0x15181c));
      wheel.position.set(x, y, z);
      scene.add(wheel);
      rod([x, y, z - 0.03], [x, y, z + 0.03], 0.03, steel);
    }
    const rear = [-2.6, y, z], front = [-1.62, y, z], crank = [-2.15, y - 0.03, z], seat = [-2.32, y + 0.52, z], head = [-1.74, y + 0.5, z];
    rod(rear, seat, 0.017, frameColor);
    rod(rear, crank, 0.017, frameColor);
    rod(crank, seat, 0.02, frameColor);
    rod(crank, head, 0.02, frameColor);
    rod(head, front, 0.016, steel);
    rod([-2.32, y + 0.52, z], [-2.34, y + 0.62, z], 0.014, steel);
    box(0.24, 0.05, 0.11, mat(0x1b1d21), -2.36, y + 0.65, z);
    rod([-1.74, y + 0.5, z], [-1.76, y + 0.66, z], 0.014, steel);
    rod([-1.78, y + 0.66, z - 0.26], [-1.78, y + 0.66, z + 0.26], 0.012, steel);
    // Wire basket over the front wheel.
    const basket = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.22, 0.34), new THREE.MeshStandardMaterial({ color: 0xa9b2bb, wireframe: true }));
    basket.position.set(-1.6, y + 0.55, z);
    scene.add(basket);
    rod([-2.6, y - 0.1, z], [-2.75, 0.15, z + 0.12], 0.012, steel);
  }

  // Street lamp with a soft light cone.
  box(0.12, 4.6, 0.12, mat(0x4a525c, { metalness: 0.5, roughness: 0.4 }), 5.6, 2.44, 0.5);
  box(1.1, 0.08, 0.1, mat(0x4a525c), 5.1, 4.72, 0.5);
  const lampHead = box(0.45, 0.12, 0.3, new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xffc070, emissiveIntensity: 2.4 }), 4.6, 4.64, 0.5);
  const beam = new THREE.Mesh(new THREE.ConeGeometry(1.9, 4.5, 32, 1, true), new THREE.MeshBasicMaterial({ color: 0xffc070, transparent: true, opacity: 0.06, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  beam.position.set(4.6, 2.35, 0.5);
  scene.add(beam);

  // ---- Lights ----
  scene.add(new THREE.HemisphereLight(0x2b4a66, 0x07090d, 0.55));
  const moon = new THREE.DirectionalLight(0x8fb4d8, 0.35);
  moon.position.set(-6, 10, 8);
  scene.add(moon);
  const shopLight = new THREE.PointLight(0xfff0dc, 18, 9, 1.6);
  shopLight.position.set(0, 2.4, -1.2);
  scene.add(shopLight);
  const lampLight = new THREE.PointLight(0xffc070, 26, 9, 1.6);
  lampLight.position.set(4.6, 4.3, 0.5);
  scene.add(lampLight);
  const vendLight = new THREE.PointLight(0xff4050, 4, 3.5, 1.8);
  vendLight.position.set(4.0, 1.2, 0.1);
  scene.add(vendLight);

  // Fake wet-road reflections: soft glow strips under the light sources.
  const glowTexture = canvasTexture(64, 256, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
  });
  const reflections = [];
  for (const [x, color, width] of [[0, 0xfff1d8, 5.6], [4.6, 0xffc070, 1.2], [4.0, 0xff4050, 0.8], [0, 0x18d5e8, 6.0]]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(width, 3.4), new THREE.MeshBasicMaterial({ color, map: glowTexture, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.035, 2.6);
    scene.add(m);
    reflections.push(m);
  }

  // ---- Rain: streaks falling in the vertex shader ----
  {
    const n = 1800, offsets = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) offsets.set([Math.random() * 16 - 8, Math.random() * 9, Math.random() * 11 - 5.5, 0.7 + Math.random() * 0.6], i * 4);
    const geo = new THREE.BoxGeometry(0.012, 0.42, 0.012);
    geo.setAttribute('aDrop', new THREE.InstancedBufferAttribute(offsets, 4));
    const rainMat = new THREE.MeshBasicMaterial({ color: 0xa9c4dc, transparent: true, opacity: 0.32, depthWrite: false });
    rainMat.onBeforeCompile = shader => {
      shader.uniforms.uTime = time;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute vec4 aDrop;')
        .replace('#include <begin_vertex>', `
          float fall = mod(aDrop.y - uTime * 9.0 * aDrop.w, 9.0);
          // Slight wind slant.
          vec3 transformed = position + vec3(aDrop.x + position.y * 0.18 + fall * 0.04, fall, aDrop.z);`);
    };
    const rain = new THREE.InstancedMesh(geo, rainMat, n);
    rain.frustumCulled = false;
    scene.add(rain);
  }

  // Label plate on the base, like a diorama caption.
  const plateTexture = canvasTexture(512, 128, (g, w, h) => {
    g.fillStyle = '#0b1017'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(24,213,232,0.6)'; g.lineWidth = 3; g.strokeRect(4, 4, w - 8, h - 8);
    g.fillStyle = '#f2e94e'; g.font = 'bold 30px monospace'; g.fillText('ROUTE 404', 26, 52);
    g.fillStyle = '#8fa3b0'; g.font = '20px monospace'; g.fillText('雨夜的街角，地图之外。', 26, 92);
  });
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.8), new THREE.MeshBasicMaterial({ map: plateTexture }));
  plate.position.set(-4.6, -0.25, 5.01);
  scene.add(plate);

  // Materials changed by the lights switch or the lamp flicker keep their identity when merged.
  for (const m of [ceilingMat, interiorMat, screenMat, stripe.material, lampHead.material, ...reflections.map(r => r.material)]) m.userData.live = true;
  mergeStatic(scene, new Set([door, sign, vending]));

  // ---- Interaction ----
  let toastTimer;
  function say(message) {
    toast.textContent = message;
    toast.classList.add('is-shown');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-shown'), 1800);
  }
  let lightsOn = true;
  function setLights(on) {
    lightsOn = on;
    interiorMat.emissiveIntensity = on ? 0.5 : 0.05;
    ceilingMat.emissiveIntensity = on ? 1.4 : 0;
    screenMat.emissiveIntensity = on ? 0.9 : 0;
    signMat.emissiveIntensity = on ? 1.1 : 0.08;
    stripe.material.emissiveIntensity = on ? 1.2 : 0.1;
    shopLight.intensity = on ? 18 : 0;
    reflections[0].material.opacity = on ? 0.16 : 0;
    reflections[3].material.opacity = on ? 0.16 : 0;
    say(on ? text.open : text.closed);
  }
  const cans = [];
  const canGeometry = new THREE.CylinderGeometry(0.07, 0.07, 0.22, 16);
  const canMaterials = [0x2d7dd2, 0xe84855, 0xf9dc5c, 0x3bb273].map(c => mat(c, { metalness: 0.6, roughness: 0.3 }));
  function vend() {
    const can = new THREE.Mesh(canGeometry, canMaterials[cans.length % 4]);
    can.position.set(4.0, 0.45, -0.35);
    can.userData.vy = 0;
    can.userData.vz = 1.4;
    scene.add(can);
    cans.push(can);
    if (cans.length > 6) scene.remove(cans.shift());
    say(text.vend);
  }
  function goHome() {
    const home = english ? '/en/' : '/';
    if (window.swup?.navigate) window.swup.navigate(home); else location.assign(home);
  }

  // Drag to look around within limits (no zoom, so the page still scrolls).
  const offset = camera.position.set(-8.5, 9.5, 16.5).clone().sub(target);
  const view = new THREE.Spherical().setFromVector3(offset), goal = view.clone();
  const clampView = () => {
    goal.theta = Math.min(0.9, Math.max(-1.1, goal.theta));
    goal.phi = Math.min(1.38, Math.max(0.55, goal.phi));
  };
  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2(), canvas = renderer.domElement;
  function hit(e) {
    const r = canvas.getBoundingClientRect();
    pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObjects([sign, vending, door], false)[0]?.object;
  }
  let drag = null;
  const listeners = new AbortController(), on = { signal: listeners.signal };
  canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, moved: 0 }; canvas.setPointerCapture(e.pointerId); }, on);
  canvas.addEventListener('pointermove', e => {
    if (!drag) { canvas.style.cursor = hit(e) ? 'pointer' : 'grab'; return; }
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
    goal.theta -= dx * 0.005;
    goal.phi -= dy * 0.004;
    clampView();
    drag.x = e.clientX; drag.y = e.clientY;
  }, on);
  canvas.addEventListener('pointerup', e => {
    const tap = drag && drag.moved < 8;
    drag = null;
    if (!tap) return;
    const action = hit(e)?.userData.action;
    if (action === 'lights') setLights(!lightsOn);
    else if (action === 'vend') vend();
    else if (action === 'home') goHome();
  }, on);
  canvas.addEventListener('pointercancel', () => { drag = null; }, on);

  // Portrait-ish boxes see less width, so the camera starts further out.
  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    view.radius = goal.radius = Math.min(30, 20.5 / Math.min(1, camera.aspect * 1.15));
  }
  const sizing = new ResizeObserver(resize);
  sizing.observe(container);
  resize();

  // ---- Loop: capped frame rate, only while visible ----
  let last = 0, onScreen = true, shown = false;
  function frame(now) {
    if (now - last < 1000 / fps - 2) return;
    const dt = Math.min(now - last, 100) / 1000;
    last = now;
    time.value += dt;
    for (const can of cans) {
      if (can.position.y > 0.2) { can.userData.vy -= 9.8 * dt; can.position.y += can.userData.vy * dt; can.position.z += can.userData.vz * dt; }
      else { can.position.y = 0.2; can.userData.vz *= 0.9; can.position.z += can.userData.vz * dt; can.rotation.x = Math.PI / 2; }
    }
    lampHead.material.emissiveIntensity = 2.4 + Math.sin(time.value * 23) * Math.sin(time.value * 3.1) * 0.15;
    view.theta += (goal.theta - view.theta) * 0.15;
    view.phi += (goal.phi - view.phi) * 0.15;
    camera.position.setFromSpherical(view).add(target);
    camera.lookAt(target);
    renderer.render(scene, camera);
    if (!shown) { shown = true; container.classList.add('aden-scene-ready'); }
  }
  const update = () => renderer.setAnimationLoop(onScreen && !document.hidden ? frame : null);
  const visibility = new IntersectionObserver(entries => { onScreen = entries[0].isIntersecting; update(); });
  visibility.observe(container);
  document.addEventListener('visibilitychange', update, on);
  update();

  return () => {
    renderer.setAnimationLoop(null);
    clearTimeout(toastTimer);
    listeners.abort();
    visibility.disconnect();
    sizing.disconnect();
    container.classList.remove('aden-scene-ready');
    hint.remove();
    toast.remove();
    scene.traverse(o => {
      o.geometry?.dispose();
      for (const m of [].concat(o.material || [])) { m.map?.dispose(); m.emissiveMap?.dispose(); m.dispose(); }
    });
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
  };
}
