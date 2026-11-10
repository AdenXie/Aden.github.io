// Astronomy for the home sky (scenes/sky.js). No three.js here, so tests can import it.
// Frames: equatorial J2000 (X toward RA 0h, Z toward the north celestial pole) and the
// scene's horizon frame (x east, y up, -z north). Accuracy targets what the eye can see
// at a 70 degree field of view: precession since J2000 (~0.4 degrees) is left out.
const RAD = Math.PI / 180;

// Representative point per country (where most people live, not the geographic centre),
// by ISO 3166-1 alpha-2 code as Vercel reports it. Anything else, or no country: China.
export const DEFAULT_PLACE = [32.0, 114.0];
const PLACES = {
  AU: [-33.87, 151.21], NZ: [-37.8, 175.3], CN: DEFAULT_PLACE, HK: [22.3, 114.2], MO: [22.2, 113.5],
  TW: [24.5, 121.0], JP: [35.4, 137.0], KR: [37.0, 127.3], KP: [39.0, 125.8], MN: [47.9, 106.9],
  SG: [1.35, 103.8], MY: [3.4, 102.0], TH: [14.5, 100.6], VN: [16.0, 106.5], PH: [13.0, 121.5],
  ID: [-6.6, 108.5], KH: [11.8, 104.9], LA: [17.9, 102.6], MM: [19.5, 96.2], BD: [23.8, 90.4],
  IN: [23.0, 79.5], PK: [30.5, 71.5], NP: [27.7, 85.3], LK: [7.3, 80.6], AE: [24.8, 55.0],
  SA: [24.0, 45.0], QA: [25.3, 51.5], IL: [32.0, 34.9], TR: [39.5, 32.0], IR: [34.0, 51.5],
  KZ: [47.0, 70.0], RU: [55.0, 45.0], UA: [49.0, 31.0], PL: [52.0, 19.5], DE: [50.9, 9.5],
  FR: [47.3, 2.4], GB: [52.5, -1.5], IE: [53.3, -7.0], NL: [52.2, 5.3], BE: [50.8, 4.4],
  CH: [47.0, 7.9], AT: [47.9, 15.0], IT: [42.5, 12.5], ES: [40.0, -3.7], PT: [39.5, -8.5],
  SE: [59.0, 16.0], NO: [60.5, 9.0], FI: [61.5, 25.0], DK: [55.8, 10.5], CZ: [49.9, 15.3],
  GR: [38.5, 23.0], RO: [45.5, 25.5], HU: [47.3, 19.2], EG: [30.0, 31.2], NG: [8.0, 6.5],
  ZA: [-27.5, 28.0], KE: [-1.0, 37.0], MA: [33.0, -6.5], US: [37.5, -91.0], CA: [45.0, -76.0],
  MX: [20.5, -100.0], BR: [-19.0, -46.0], AR: [-34.5, -60.5], CL: [-34.0, -71.0],
  CO: [5.5, -74.5], PE: [-11.0, -76.5],
};
export function placeOf(country) {
  return PLACES[typeof country === 'string' ? country.toUpperCase() : ''] || DEFAULT_PLACE;
}

export const julianDate = ms => ms / 86400000 + 2440587.5;

// Local sidereal time in degrees (IAU 1982 GMST, enough for this).
export function siderealDegrees(ms, lonDeg) {
  const d = julianDate(ms) - 2451545, t = d / 36525;
  const gmst = 280.46061837 + 360.98564736629 * d + 0.000387933 * t * t;
  return (((gmst + lonDeg) % 360) + 360) % 360;
}

// Columns of the equatorial -> horizon rotation, as [x, y, z] in the scene frame.
// A star at hour angle H = LST - RA and declination d lands at
//   cos d cos H * Q - cos d sin H * E + sin d * P
// with P the celestial pole (altitude = latitude, due north), Q the equator on the
// meridian and E due east.
export function horizonBasis(latDeg, lonDeg, ms) {
  const l = siderealDegrees(ms, lonDeg) * RAD, f = latDeg * RAD;
  const E = [1, 0, 0];
  const P = [0, Math.sin(f), -Math.cos(f)];
  const Q = [0, Math.cos(f), Math.sin(f)];
  const mix = (a, ka, b, kb) => a.map((v, i) => v * ka + b[i] * kb);
  return [mix(Q, Math.cos(l), E, -Math.sin(l)), mix(Q, Math.sin(l), E, Math.cos(l)), P];
}

export function equatorial(raDeg, decDeg) {
  const r = raDeg * RAD, d = decDeg * RAD;
  return [Math.cos(d) * Math.cos(r), Math.cos(d) * Math.sin(r), Math.sin(d)];
}

export function toHorizon(basis, v) {
  return [0, 1, 2].map(i => basis[0][i] * v[0] + basis[1][i] * v[1] + basis[2][i] * v[2]);
}

// Altitude and azimuth (degrees, azimuth from north through east) of a horizon-frame vector.
export function altAz([x, y, z]) {
  return [Math.asin(Math.max(-1, Math.min(1, y))) / RAD, ((Math.atan2(x, -z) / RAD) + 360) % 360];
}

// Star colour from B-V, roughly the blackbody tint the eye sees.
export function bvColor(bv) {
  const stops = [[-0.4, [0.62, 0.72, 1]], [0, [0.8, 0.86, 1]], [0.4, [0.98, 0.98, 1]], [0.8, [1, 0.93, 0.8]], [1.4, [1, 0.8, 0.58]], [2, [1, 0.66, 0.42]]];
  const b = Math.max(-0.4, Math.min(2, bv));
  for (let i = 1; i < stops.length; i++) {
    if (b <= stops[i][0]) {
      const t = (b - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]);
      return stops[i - 1][1].map((v, k) => v + (stops[i][1][k] - v) * t);
    }
  }
  return stops[stops.length - 1][1];
}

// Planets: JPL "Approximate Positions of the Planets" (Standish), table for 1800-2050:
// a, e, I, L, long. perihelion, long. node, each with a rate per Julian century. Good to
// about an arcminute, far below a pixel here. Magnitudes: 5 log(r Delta) plus the phase
// curves of Mallama & Hilton (2018); Saturn's rings are left out.
const ELEMENTS = {
  mercury: [0.38709927, 0.00000037, 0.20563593, 0.00001906, 7.00497902, -0.00594749, 252.2503235, 149472.67411175, 77.45779628, 0.16047689, 48.33076593, -0.12534081],
  venus: [0.72333566, 0.0000039, 0.00677672, -0.00004107, 3.39467605, -0.0007889, 181.9790995, 58517.81538729, 131.60246718, 0.00268329, 76.67984255, -0.27769418],
  earth: [1.00000261, 0.00000562, 0.01671123, -0.00004392, -0.00001531, -0.01294668, 100.46457166, 35999.37244981, 102.93768193, 0.32327364, 0, 0],
  mars: [1.52371034, 0.00001847, 0.0933941, 0.00007882, 1.84969142, -0.00813131, -4.55343205, 19140.30268499, -23.94362959, 0.44441088, 49.55953891, -0.29257343],
  jupiter: [5.202887, -0.00011607, 0.04838624, -0.00013253, 1.30439695, -0.00183714, 34.39644051, 3034.74612775, 14.72847983, 0.21252668, 100.47390909, 0.20469106],
  saturn: [9.53667594, -0.0012506, 0.05386179, -0.00050991, 2.48599187, 0.00193609, 49.95424423, 1222.49362201, 92.59887831, -0.41897216, 113.66242448, -0.28867794],
};
const poly = (c, x) => c.reduceRight((s, k) => s * x + k, 0);
const PHOTOMETRY = {
  mercury: i => poly([-0.613, 6.328e-2, -1.6336e-3, 3.3644e-5, -3.4265e-7, 1.6893e-9, -3.0334e-12], i),
  venus: i => i < 163.7 ? poly([-4.384, -1.044e-3, 3.687e-4, -2.814e-6, 8.938e-9], i) : poly([236.05828, -2.81914, 8.39034e-3], i),
  mars: i => poly([-1.601, 2.267e-2, -1.302e-4], Math.min(i, 50)),
  jupiter: i => poly([-9.395, -3.7e-4, 6.16e-4], i),
  saturn: i => -8.914 + 0.026 * i,
};
// Planet tints (linear-ish RGB) for the scene.
export const PLANET_COLORS = { mercury: [1, 0.93, 0.85], venus: [1, 0.98, 0.9], mars: [1, 0.66, 0.45], jupiter: [1, 0.95, 0.85], saturn: [1, 0.9, 0.7] };

function heliocentric(name, t) {
  const k = ELEMENTS[name];
  const a = k[0] + k[1] * t, e = k[2] + k[3] * t, inc = (k[4] + k[5] * t) * RAD;
  const L = k[6] + k[7] * t, peri = k[8] + k[9] * t, node = (k[10] + k[11] * t) * RAD;
  const w = peri * RAD - node;
  let M = ((L - peri) % 360) * RAD;
  if (M > Math.PI) M -= 2 * Math.PI;
  if (M < -Math.PI) M += 2 * Math.PI;
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 8; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(w), sw = Math.sin(w), cn = Math.cos(node), sn = Math.sin(node), ci = Math.cos(inc), si = Math.sin(inc);
  return [
    (cw * cn - sw * sn * ci) * xp + (-sw * cn - cw * sn * ci) * yp,
    (cw * sn + sw * cn * ci) * xp + (-sw * sn + cw * cn * ci) * yp,
    sw * si * xp + cw * si * yp,
  ];
}

export function planets(ms) {
  const t = (julianDate(ms) - 2451545) / 36525, eps = 23.43928 * RAD;
  const earth = heliocentric('earth', t);
  return Object.keys(PHOTOMETRY).map(name => {
    const h = heliocentric(name, t);
    const g = h.map((v, i) => v - earth[i]);
    const r = Math.hypot(...h), delta = Math.hypot(...g);
    const eq = [g[0], g[1] * Math.cos(eps) - g[2] * Math.sin(eps), g[1] * Math.sin(eps) + g[2] * Math.cos(eps)];
    const phase = Math.acos(Math.max(-1, Math.min(1, (r * r + delta * delta - Math.hypot(...earth) ** 2) / (2 * r * delta)))) / RAD;
    return {
      name,
      ra: ((Math.atan2(eq[1], eq[0]) / RAD) + 360) % 360,
      dec: Math.asin(eq[2] / delta) / RAD,
      mag: PHOTOMETRY[name](phase) + 5 * Math.log10(r * delta),
    };
  });
}

// Where the camera looks: the azimuth that puts the most Milky Way (weighted toward the
// galactic centre) in view above the horizon. With the band below the horizon it faces
// the equator (north from the southern hemisphere, south from the northern).
const GAL_TO_EQ = [[-0.0548755604, 0.4941094279, -0.867666149], [-0.8734370902, -0.44482963, -0.1980763734], [-0.4838350155, 0.7469822445, 0.4559837762]];
export function viewAzimuth(basis, latDeg, { halfWidth = 50, top = 60 } = {}) {
  const fallback = latDeg < 0 ? 0 : 180;
  const points = [];
  for (let l = 0; l < 360; l += 3) {
    const g = [Math.cos(l * RAD), Math.sin(l * RAD), 0];
    const eq = GAL_TO_EQ.map(row => row[0] * g[0] + row[1] * g[1] + row[2] * g[2]);
    const [alt, az] = altAz(toHorizon(basis, eq));
    const fromCentre = Math.min(l, 360 - l);
    if (alt > 8 && alt < top) points.push([az, (1 + 4 * Math.exp(-(fromCentre ** 2) / (2 * 35 ** 2))) * Math.sin(Math.min(alt, 40) * RAD)]);
  }
  let best = fallback, score = 0;
  for (let az = 0; az < 360; az += 5) {
    let s = 0;
    for (const [p, w] of points) {
      const d = Math.abs(((p - az + 540) % 360) - 180);
      if (d < halfWidth) s += w * Math.cos((d / halfWidth) * Math.PI / 2);
    }
    if (s > score + 1e-9) { score = s; best = az; }
  }
  return score > 1.5 ? best : fallback;
}

// stars-v1.bin (tools/build-sky-data.cjs) into plain arrays of [ra, dec, ...].
export function decodeSky(buffer) {
  const v = new DataView(buffer);
  const [stars, segments, dust] = [0, 4, 8].map(o => v.getUint32(o, true));
  const ra = o => v.getUint16(o, true) / 65536 * 360, dec = o => v.getInt16(o, true) / 32767 * 90;
  const mag = o => v.getUint8(o) / 25 - 2;
  let o = 12;
  const out = { stars: [], segments: [], dust: [] };
  for (let i = 0; i < stars; i++, o += 6) out.stars.push([ra(o), dec(o + 2), mag(o + 4), v.getUint8(o + 5) / 100 - 0.5]);
  for (let i = 0; i < segments; i++, o += 8) out.segments.push([ra(o), dec(o + 2), ra(o + 4), dec(o + 6)]);
  for (let i = 0; i < dust; i++, o += 5) out.dust.push([ra(o), dec(o + 2), mag(o + 4)]);
  return out;
}
