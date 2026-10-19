(() => {
'use strict';
const $ = s => document.querySelector(s);
const G = 9.81, N = 513, DT = 1 / 240;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const fmt = t => { if (!(t >= 0) || !isFinite(t)) return '–'; const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(3); };
const lin = h => new THREE.Color(h).convertSRGBToLinear();
const COARSE = matchMedia('(pointer:coarse)').matches;

/* ================= Noise ================= */
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function valueNoise(seed) {
  const r = mulberry32(seed), tb = new Float32Array(65536);
  for (let i = 0; i < tb.length; i++) tb[i] = r();
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y); let xf = x - xi, yf = y - yi;
    xf = xf * xf * (3 - 2 * xf); yf = yf * yf * (3 - 2 * yf);
    const x0 = xi & 255, y0 = yi & 255, x1 = (xi + 1) & 255, y1 = (yi + 1) & 255;
    const a = tb[y0 * 256 + x0], b = tb[y0 * 256 + x1], c = tb[y1 * 256 + x0], d = tb[y1 * 256 + x1];
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
}
function fbm(nz, x, y, oct, gain = 0.5) { let s = 0, a = 1, f = 1, n = 0; for (let i = 0; i < oct; i++) { s += a * nz(x * f + i * 17.31, y * f - i * 9.13); n += a; a *= gain; f *= 2; } return s / n; }
function normalize01(arr) { let lo = Infinity, hi = -Infinity; for (const v of arr) { if (v < lo) lo = v; if (v > hi) hi = v; } const k = hi - lo > 1e-9 ? 1 / (hi - lo) : 0; for (let i = 0; i < arr.length; i++) arr[i] = (arr[i] - lo) * k; return { lo, hi }; }
function blur(arr, passes) {
  const tmp = new Float32Array(arr.length);
  for (let p = 0; p < passes; p++) {
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = arr[j * N + Math.max(0, i - 1)], b = arr[j * N + i], c = arr[j * N + Math.min(N - 1, i + 1)]; tmp[j * N + i] = (a + 2 * b + c) / 4; }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = tmp[Math.max(0, j - 1) * N + i], b = tmp[j * N + i], c = tmp[Math.min(N - 1, j + 1) * N + i]; arr[j * N + i] = (a + 2 * b + c) / 4; }
  }
}

/* ================= Procedural textures ================= */
function canvasTex(w, h, draw, srgb = true, repeat = true) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h; draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv); if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.encoding = THREE.sRGBEncoding; t.anisotropy = 8; return t;
}
const TEX = {
  asphalt: canvasTex(512, 512, (g, w, h) => {
    const r = mulberry32(3), img = g.createImageData(w, h);
    for (let i = 0; i < w * h; i++) { const v = 150 + (r() - 0.5) * 46 + (r() < 0.02 ? 50 : 0); img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
    g.putImageData(img, 0, 0);
    g.globalAlpha = 0.06; for (let i = 0; i < 40; i++) { g.fillStyle = r() < 0.5 ? '#000' : '#fff'; g.beginPath(); g.ellipse(r() * w, r() * h, 20 + r() * 60, 8 + r() * 30, r() * 3, 0, 7); g.fill(); }
  }),
  detail: canvasTex(256, 256, (g, w, h) => {
    const nz = valueNoise(11), img = g.createImageData(w, h), r = mulberry32(8);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const o = (j * w + i) * 4, v = 205 + 40 * (fbm(nz, i / 32, j / 32, 4) - 0.5) + (r() - 0.5) * 30; img.data[o] = img.data[o + 1] = img.data[o + 2] = clamp(v, 0, 255); img.data[o + 3] = 255; }
    g.putImageData(img, 0, 0);
  }, false),
  facade: canvasTex(256, 256, (g, w, h) => {
    const r = mulberry32(21);
    g.fillStyle = '#d9d6cf'; g.fillRect(0, 0, w, h);
    for (let fl = 0; fl < 4; fl++) for (let c = 0; c < 4; c++) {
      const x = c * 64 + 9, y = fl * 64 + 14, lit = r() < 0.12;
      g.fillStyle = lit ? '#c9b98f' : ['#3c4652', '#46505c', '#33404c'][Math.floor(r() * 3)]; g.fillRect(x, y, 46, 36);
      g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(x, y, 46, 4);
      g.fillStyle = '#9a978f'; g.fillRect(x - 3, y + 36, 52, 5);
      if (r() < 0.35) { g.fillStyle = '#8b8f94'; g.fillRect(x + 4, y + 40, 22, 10); } // AC unit
    }
  }),
  fence: canvasTex(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h); g.strokeStyle = 'rgba(205,210,215,1)'; g.lineWidth = 3;
    for (let i = -w; i < w * 2; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + h, h); g.stroke(); g.beginPath(); g.moveTo(i, h); g.lineTo(i + h, 0); g.stroke(); }
    g.fillStyle = '#9aa0a6'; g.fillRect(0, 0, 6, h);
  }),
  barrier: canvasTex(512, 64, (g, w, h) => {
    const cols = ['#e8e8e8', '#e8e8e8', '#c8102e', '#e8e8e8', '#1d3f8f', '#e8e8e8', '#e3a21a', '#e8e8e8'];
    g.fillStyle = '#b8b6b0'; g.fillRect(0, 0, w, h);
    cols.forEach((c, i) => { g.fillStyle = c; g.fillRect(i * 64 + 2, 6, 60, 40); g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(i * 64 + 10, 20, 44, 6); });
    g.fillStyle = '#8e8c86'; g.fillRect(0, 50, w, 14);
  }),
};

TEX.fence.encoding = THREE.sRGBEncoding;
/* ---- tileable procedural materials (noise lattice wraps at the texture edge, so they repeat seamlessly) ---- */
function tileNoise(seed) {
  const r = mulberry32(seed), tb = new Float32Array(65536); for (let i = 0; i < tb.length; i++) tb[i] = r();
  const n = (x, y, P) => {
    const xi = Math.floor(x), yi = Math.floor(y); let xf = x - xi, yf = y - yi; xf = xf * xf * (3 - 2 * xf); yf = yf * yf * (3 - 2 * yf);
    const x0 = ((xi % P) + P) % P, y0 = ((yi % P) + P) % P, x1 = (x0 + 1) % P, y1 = (y0 + 1) % P;
    const a = tb[y0 * 256 + x0], b = tb[y0 * 256 + x1], c = tb[y1 * 256 + x0], d = tb[y1 * 256 + x1];
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
  return (u, v, P, oct = 4, gain = 0.5) => { let s = 0, a = 1, t = 0, f = 1; for (let i = 0; i < oct; i++) { s += a * n(u * P * f + i * 13, v * P * f + i * 7, P * f); t += a; a *= gain; f *= 2; } return s / t; };
}
function pixTex(w, h, fn, opts = {}) { // fn(u, v) -> [r, g, b, a?] in 0..255
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g = cv.getContext('2d'), img = g.createImageData(w, h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const c = fn(i / w, j / h, i, j), o = (j * w + i) * 4; img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = c.length > 3 ? c[3] : 255; }
  g.putImageData(img, 0, 0); if (opts.after) opts.after(g, w, h);
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  if (opts.srgb) t.encoding = THREE.sRGBEncoding; return t;
}
function normalFromHeight(hf, w, h, k) { // hf(u,v) height 0..1 -> tangent-space normal map
  const H = new Float32Array(w * h); for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) H[j * w + i] = hf(i / w, j / h);
  return pixTex(w, h, (u, v, i, j) => {
    const dx = (H[j * w + (i + 1) % w] - H[j * w + (i - 1 + w) % w]) * k, dy = (H[((j + 1) % h) * w + i] - H[((j - 1 + h) % h) * w + i]) * k, l = Math.hypot(dx, dy, 1);
    return [(-dx / l * 0.5 + 0.5) * 255, (-dy / l * 0.5 + 0.5) * 255, (1 / l * 0.5 + 0.5) * 255];
  });
}
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
{
  const n1 = tileNoise(101), n2 = tileNoise(202), n3 = tileNoise(303), sp = mulberry32(77);
  TEX.grass = pixTex(256, 256, (u, v) => { const a = n1(u, v, 8, 5), b = n2(u, v, 64, 2), c = sp(); return lerp3(lerp3([62, 88, 38], [104, 128, 58], a), [138, 140, 74], Math.max(0, b - 0.62) * 1.6).map(x => x * (0.86 + 0.24 * c)); });
  TEX.dirt = pixTex(256, 256, (u, v) => { const a = n2(u, v, 6, 5), c = sp(); const base = lerp3([102, 82, 58], [148, 124, 92], a); return c < 0.03 ? [176, 168, 150] : base.map(x => x * (0.85 + 0.25 * c)); });
  TEX.rock = pixTex(256, 256, (u, v) => { const a = n3(u, v, 4, 6), b = n1(u, v, 16, 3), crack = Math.abs(n2(u, v, 8, 3) - 0.5) < 0.012 ? 0.55 : 1; return lerp3([92, 88, 84], [158, 152, 144], a * 0.7 + b * 0.3).map(x => x * crack); });
  TEX.snow = pixTex(128, 128, (u, v) => { const a = n1(u, v, 8, 4); return lerp3([214, 222, 232], [248, 250, 252], a); });
  TEX.pave = pixTex(256, 256, (u, v, i, j) => { const a = n2(u, v, 8, 4), joint = (i % 64 < 2 || j % 64 < 2) ? 0.72 : 1, c = sp(); return lerp3([150, 146, 138], [184, 180, 172], a).map(x => x * joint * (0.92 + 0.12 * c)); });
  TEX.gravel = pixTex(256, 256, (u, v) => { const a = n3(u, v, 32, 2), c = sp(); return lerp3([168, 150, 118], [212, 196, 164], a).map(x => x * (0.7 + 0.45 * c)); }, { srgb: true });
  TEX.macro = pixTex(128, 128, (u, v) => { const a = n1(u, v, 4, 5) * 255; return [a, a, a]; });
  TEX.asphalt2 = pixTex(512, 512, (u, v) => { const a = n2(u, v, 16, 3), c = sp(); const g = 120 + a * 40 + (c - 0.5) * 70 + (c > 0.985 ? 60 : 0); return [g, g, g * 1.02]; }, { srgb: true });
  TEX.asphaltN = normalFromHeight((u, v) => n3(u, v, 128, 2) * 0.6 + sp() * 0.4, 256, 256, 2.2);
  TEX.waterN = normalFromHeight((u, v) => n1(u, v, 6, 4) * 0.7 + n2(u, v, 24, 2) * 0.3, 256, 256, 6);
  TEX.contact = (() => { const cv = document.createElement('canvas'); cv.width = 128; cv.height = 128; const g = cv.getContext('2d'), gr = g.createRadialGradient(64, 64, 6, 64, 64, 64); gr.addColorStop(0, 'rgba(0,0,0,0.85)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.45)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(cv); })();
  // billboard foliage with alpha
  const foliage = (w, h, draw) => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; draw(cv.getContext('2d'), w, h, mulberry32(w + h)); const t = new THREE.CanvasTexture(cv); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4; return t; };
  TEX.treeBroad = foliage(256, 256, (g, w, h, r) => {
    g.fillStyle = '#4a3b2b'; g.fillRect(w / 2 - 6, h * 0.5, 12, h * 0.5); g.fillRect(w / 2 - 2, h * 0.38, 4, h * 0.2);
    for (let i = 0; i < 260; i++) {
      const a = r() * Math.PI * 2, rr = Math.sqrt(r()), x = w / 2 + Math.cos(a) * rr * w * 0.42, y = h * 0.4 + Math.sin(a) * rr * h * 0.34, lit = 1 - (y / h) * 0.9 + (w / 2 - x) / w * 0.4;
      const l = 14 + lit * 22 + r() * 8; g.fillStyle = `hsl(${88 + r() * 30},${38 + r() * 18}%,${l}%)`;
      g.beginPath(); g.arc(x, y, 5 + r() * 12, 0, 7); g.fill();
    }
  });
  TEX.treeCon = foliage(128, 256, (g, w, h, r) => {
    g.fillStyle = '#3d2f22'; g.fillRect(w / 2 - 4, h * 0.82, 8, h * 0.18);
    for (let i = 0; i < 900; i++) {
      const y = h * 0.04 + r() * h * 0.82, half = (y / h) * w * 0.46, x = w / 2 + (r() * 2 - 1) * half, lit = 1 - Math.abs(x - w / 2) / (half + 1) * 0.5;
      g.strokeStyle = `hsl(${110 + r() * 25},${30 + r() * 15}%,${10 + lit * 16 + r() * 6}%)`; g.lineWidth = 2;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (x > w / 2 ? 6 : -6), y + 6 + r() * 4); g.stroke();
    }
  });
  TEX.tuft = foliage(128, 64, (g, w, h, r) => { for (let i = 0; i < 70; i++) { const x = 8 + r() * (w - 16); g.strokeStyle = `hsl(${70 + r() * 30},${35 + r() * 20}%,${18 + r() * 22}%)`; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, h); g.quadraticCurveTo(x + (r() - 0.5) * 10, h * 0.5, x + (r() - 0.5) * 22, h * (0.05 + r() * 0.4)); g.stroke(); } });
  // grandstand crowd, pit garages, armco, tyre walls
  TEX.crowd = canvasTex(256, 128, (g, w, h) => { const r = mulberry32(9); g.fillStyle = '#2a2e35'; g.fillRect(0, 0, w, h); for (let row = 0; row < 8; row++) for (let x = 2; x < w; x += 4 + r() * 2) { if (r() < 0.12) continue; g.fillStyle = r() < 0.15 ? `hsl(${[0, 210, 45][Math.floor(r() * 3)]},55%,45%)` : `hsl(${r() * 360},${8 + r() * 22}%,${22 + r() * 40}%)`; g.fillRect(x, row * 16 + 7, 3, 6); g.fillStyle = `hsl(28,${20 + r() * 20}%,${20 + r() * 35}%)`; g.fillRect(x, row * 16 + 3, 3, 3); } });
  TEX.garage = canvasTex(256, 64, (g, w, h) => { g.fillStyle = '#d9dbde'; g.fillRect(0, 0, w, h); for (let i = 0; i < 4; i++) { g.fillStyle = '#2b2f36'; g.fillRect(i * 64 + 6, 18, 52, 46); g.fillStyle = 'rgba(255,255,255,.08)'; for (let y = 20; y < 64; y += 4) g.fillRect(i * 64 + 6, y, 52, 1); } g.fillStyle = '#c8102e'; g.fillRect(0, 4, w, 6); });
  TEX.armco = canvasTex(64, 64, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#c9ced3'); gr.addColorStop(0.25, '#eef1f3'); gr.addColorStop(0.45, '#8c939a'); gr.addColorStop(0.55, '#c9ced3'); gr.addColorStop(0.75, '#eef1f3'); gr.addColorStop(1, '#7d848b'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  TEX.tyres = canvasTex(128, 64, (g, w, h) => { g.fillStyle = '#121212'; g.fillRect(0, 0, w, h); for (let row = 0; row < 3; row++) for (let i = 0; i < 4; i++) { const x = i * 32 + 16 + (row % 2) * 8, y = row * 21 + 11; g.fillStyle = '#262626'; g.beginPath(); g.arc(x, y, 14, 0, 7); g.fill(); g.fillStyle = '#060606'; g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill(); } g.fillStyle = '#d8d8d8'; g.fillRect(0, 0, w, 3); });
  // Taipei facades: tiled walk-up with iron window grilles, glass office, weathered concrete; ground-floor arcade shops
  TEX.facA = canvasTex(256, 256, (g, w, h) => {
    const r = mulberry32(31); g.fillStyle = '#e2ddd3'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(0,0,0,.06)'; for (let y = 0; y < h; y += 4) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    for (let fl = 0; fl < 4; fl++) for (let c = 0; c < 3; c++) {
      const x = c * 85 + 12, y = fl * 64 + 12;
      g.fillStyle = '#30363d'; g.fillRect(x, y, 60, 38);
      g.fillStyle = r() < 0.15 ? '#cbbf9a' : '#56616c'; g.fillRect(x + 3, y + 3, 54, 32);
      g.strokeStyle = '#2e3236'; g.lineWidth = 2; for (let gx = x + 6; gx < x + 60; gx += 7) { g.beginPath(); g.moveTo(gx, y); g.lineTo(gx, y + 44); g.stroke(); }
      g.fillStyle = '#9b958b'; g.fillRect(x - 4, y + 44, 68, 6);
      if (r() < 0.5) { g.fillStyle = '#c4c6c8'; g.fillRect(x + 64, y + 18, 16, 14); g.fillStyle = '#8f9295'; g.fillRect(x + 66, y + 20, 12, 10); }
      if (r() < 0.2) { g.fillStyle = `hsl(${r() * 360},40%,60%)`; g.fillRect(x + 4, y + 36, 50, 5); }
    }
    g.fillStyle = 'rgba(60,50,40,.12)'; for (let i = 0; i < 18; i++) g.fillRect(r() * w, 0, 2 + r() * 3, h);
  });
  TEX.facB = canvasTex(256, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#5d7a92'); gr.addColorStop(0.5, '#9db4c6'); gr.addColorStop(1, '#4c6378'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = '#2f3b46'; for (let y = 0; y < h; y += 32) g.fillRect(0, y, w, 4); for (let x = 0; x < w; x += 32) g.fillRect(x, 0, 2, h);
    g.fillStyle = 'rgba(255,255,255,.12)'; for (let y = 0; y < h; y += 32) g.fillRect(0, y + 4, w, 6);
  });
  TEX.facC = canvasTex(256, 256, (g, w, h) => {
    const r = mulberry32(53); g.fillStyle = '#b3aea5'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(40,40,40,${0.03 + r() * 0.07})`; g.fillRect(r() * w, r() * h * 0.3, 3 + r() * 8, h * (0.4 + r() * 0.6)); }
    for (let fl = 0; fl < 4; fl++) for (let c = 0; c < 4; c++) { const x = c * 64 + 14, y = fl * 64 + 16; g.fillStyle = '#3a4047'; g.fillRect(x, y, 36, 30); g.fillStyle = '#7f8a92'; g.fillRect(x + 3, y + 3, 30, 12); g.fillStyle = '#8a857c'; g.fillRect(x - 3, y + 30, 42, 4); }
  });
  TEX.shop = canvasTex(256, 64, (g, w, h) => {
    const r = mulberry32(64); g.fillStyle = '#c9c3b8'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4; i++) {
      const x = i * 64; g.fillStyle = '#1d2024'; g.fillRect(x + 8, 22, 48, 42);
      g.fillStyle = `hsl(${[0, 45, 120, 210, 30, 340][Math.floor(r() * 6)]},${55 + r() * 30}%,${45 + r() * 15}%)`; g.fillRect(x + 6, 4, 52, 14);
      g.fillStyle = 'rgba(255,240,200,.35)'; g.fillRect(x + 12, 30, 40, 26);
      g.fillStyle = '#9c968c'; g.fillRect(x, 0, 6, h);
    }
  });
}
for (const k of ['facA', 'facB', 'facC', 'shop', 'crowd', 'garage', 'armco', 'tyres']) TEX[k].anisotropy = 8;

/* ================= Terrain source ================= */
const TER = { norm: new Float32Array(N * N), meters: null, source: 'hills', seed: 7, size: 2400, range: 90, base: 150, raw: new Float32Array(N * N) };
const PRESETS = { hills: { range: 90, base: 150 }, mountain: { range: 320, base: 900 }, plateau: { range: 70, base: 2240 }, flat: { range: 8, base: 30 } };
function genPreset(name, seed) {
  const nz = valueNoise(seed), a = TER.norm;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const u = i / (N - 1), v = j / (N - 1); let h;
    if (name === 'mountain') { const r = 1 - Math.abs(2 * fbm(nz, u * 4, v * 4, 6) - 1); h = 0.55 * r * r + 0.45 * fbm(nz, u * 2 + 40, v * 2 + 40, 5); }
    else if (name === 'flat') h = fbm(nz, u * 3, v * 3, 4);
    else if (name === 'plateau') h = fbm(nz, u * 3.5, v * 3.5, 5, 0.45);
    else h = fbm(nz, u * 4.5, v * 4.5, 6, 0.5);
    a[j * N + i] = h;
  }
  normalize01(a); TER.meters = null; TER.source = name;
}
function applyTerrainScale() {
  const raw = TER.raw;
  if (TER.meters) for (let i = 0; i < raw.length; i++) raw[i] = TER.meters[i];
  else for (let i = 0; i < raw.length; i++) raw[i] = TER.norm[i] * TER.range;
}
function loadHeightImage(file) {
  const url = URL.createObjectURL(file), img = new Image();
  img.onload = () => {
    const cv = document.createElement('canvas'); cv.width = N; cv.height = N;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.imageSmoothingEnabled = true; cx.drawImage(img, 0, 0, N, N);
    const d = cx.getImageData(0, 0, N, N).data, enc = $('#enc').value, inv = $('#invert').checked;
    if (enc === 'terrarium') {
      const m = new Float32Array(N * N);
      for (let i = 0; i < N * N; i++) m[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
      blur(m, 1);
      let lo = Infinity, hi = -Infinity; for (const v of m) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
      for (let i = 0; i < m.length; i++) m[i] = inv ? hi - m[i] : m[i] - lo;
      TER.meters = m; TER.base = Math.max(0, Math.round(lo)); TER.range = Math.round(hi - lo);
      $('#base').value = TER.base; $('#range').value = Math.min(500, TER.range);
      $('#fileInfo').textContent = `${file.name}：${img.width}×${img.height}，實際海拔 ${Math.round(lo)}–${Math.round(hi)} m（高低差 ${Math.round(hi - lo)} m）。`;
    } else {
      const a = TER.norm;
      for (let i = 0; i < N * N; i++) { const l = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255; a[i] = inv ? 1 - l : l; }
      blur(a, 3); normalize01(a); TER.meters = null;
      $('#fileInfo').textContent = `${file.name}：${img.width}×${img.height}，已重新取樣為 ${N}×${N}。高低差由下方滑桿決定。`;
    }
    TER.source = 'file';
    document.querySelectorAll('#presets .btn').forEach(b => b.classList.remove('sel'));
    URL.revokeObjectURL(url);
    syncLabels(); mapChanged();
  };
  img.onerror = () => { $('#fileInfo').textContent = '無法讀取這個檔案。請使用 PNG 或 JPG 圖片。'; URL.revokeObjectURL(url); };
  img.src = url;
}

/* ================= City maps (Taipei data file, or an imported .osm) ================= */
const CITY = { taipei: null, osm: null };
const ROAD_W = [18, 15, 12, 9, 6.5, 7];
function finishCity(M) {
  // street graph for snapping and routing; expressways, bus lanes and ramps are left out of routing
  const key = new Map(), X = [], Z = [], adj = [];
  const node = (x, z) => { const k = Math.round(x * 2) + ',' + Math.round(z * 2); let id = key.get(k); if (id === undefined) { id = X.length; key.set(k, id); X.push(x); Z.push(z); adj.push([]); } return id; };
  const COST = [1, 1, 1.12, 1.3, 2.2, 3];
  for (const r of M.roads) {
    if (/快速|專用道/.test(r.n)) continue;
    let prev = -1;
    for (let i = 0; i < r.p.length; i += 2) {
      const id = node(r.p[i], r.p[i + 1]);
      if (prev >= 0 && prev !== id) { const w = Math.hypot(X[id] - X[prev], Z[id] - Z[prev]) * COST[r.c]; adj[prev].push(id, w); adj[id].push(prev, w); }
      prev = id;
    }
  }
  M.graph = { x: Float32Array.from(X), z: Float32Array.from(Z), adj };
  // building footprint raster (4 m) so street trees never grow inside a building
  const cs = 4, rw = Math.ceil(M.sx / cs), rh = Math.ceil(M.sz / cs), occ = new Uint8Array(rw * rh);
  for (const b of M.blds) {
    const p = b.p, n = p.length / 2; let z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < n; i++) { z0 = Math.min(z0, p[i * 2 + 1]); z1 = Math.max(z1, p[i * 2 + 1]); }
    for (let j = Math.max(0, Math.floor((z0 + M.sz / 2) / cs)); j <= Math.min(rh - 1, Math.floor((z1 + M.sz / 2) / cs)); j++) {
      const zc = -M.sz / 2 + (j + 0.5) * cs, xs = [];
      for (let i = 0, k = n - 1; i < n; k = i++) { const za = p[k * 2 + 1], zb = p[i * 2 + 1]; if ((za > zc) !== (zb > zc)) xs.push(p[k * 2] + (zc - za) / (zb - za) * (p[i * 2] - p[k * 2])); }
      xs.sort((a, b) => a - b);
      for (let q = 0; q + 1 < xs.length; q += 2) for (let i = Math.max(0, Math.floor((xs[q] + M.sx / 2) / cs)); i <= Math.min(rw - 1, Math.floor((xs[q + 1] + M.sx / 2) / cs)); i++) occ[j * rw + i] = 1;
    }
  }
  M.occ = { cs, rw, rh, a: occ };
  return M;
}
function loadTaipei() {
  if (CITY.taipei) return Promise.resolve(CITY.taipei);
  return fetch('data/taipei.json').then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }).then(d => {
    const sx = d.nx * d.d, sz = d.ny * d.d, cell = 10, nx = sx / cell + 1, nz = sz / cell + 1;
    const zr = atob(d.z), mr = atob(d.mask), dz = new Float32Array(d.nx * d.ny), dm = new Uint8Array(d.nx * d.ny);
    for (let k = 0; k < dz.length; k++) { let v = zr.charCodeAt(2 * k) | (zr.charCodeAt(2 * k + 1) << 8); if (v > 32767) v -= 65536; dz[k] = v / 100; dm[k] = mr.charCodeAt(k); }
    const raw = new Float32Array(nx * nz), mask = new Uint8Array(nx * nz);
    for (let J = 0; J < nz; J++) for (let I = 0; I < nx; I++) {
      const X = I * cell, Y = sz - J * cell; // data: x east, y north
      const fi = clamp(X / d.d - 0.5, 0, d.nx - 1.001), fj = clamp(Y / d.d - 0.5, 0, d.ny - 1.001), i = fi | 0, j = fj | 0, a = fi - i, b = fj - j, o = j * d.nx + i;
      raw[J * nx + I] = dz[o] * (1 - a) * (1 - b) + dz[o + 1] * a * (1 - b) + dz[o + d.nx] * (1 - a) * b + dz[o + d.nx + 1] * a * b;
      mask[J * nx + I] = dm[Math.round(fj) * d.nx + Math.round(fi)];
    }
    const toW = arr => { const out = new Float32Array(arr.length); for (let i = 0; i < arr.length; i += 2) { out[i] = arr[i] - sx / 2; out[i + 1] = sz / 2 - arr[i + 1]; } return out; };
    const roads = d.roads.map(r => ({ c: r[0], n: r[1], p: toW(r.slice(2).map(v => v / 10)) }));
    const blds = d.buildings.map(b => ({ h: b[0] / 10, p: toW(b.slice(1)) }));
    return (CITY.taipei = finishCity({ kind: 'city', id: 'taipei', name: d.name, sx, sz, nx, nz, raw, mask, base: 0, water: 0.35, roads, blds, credits: d.credits }));
  });
}
function parseOSM(text, fileName) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('不是有效的 OSM XML 檔。');
  const nodes = new Map();
  for (const n of doc.getElementsByTagName('node')) nodes.set(n.getAttribute('id'), [+n.getAttribute('lat'), +n.getAttribute('lon')]);
  if (!nodes.size) throw new Error('檔案裡沒有任何節點。');
  let la0 = Infinity, la1 = -Infinity, lo0 = Infinity, lo1 = -Infinity;
  const bd = doc.getElementsByTagName('bounds')[0];
  if (bd) { la0 = +bd.getAttribute('minlat'); la1 = +bd.getAttribute('maxlat'); lo0 = +bd.getAttribute('minlon'); lo1 = +bd.getAttribute('maxlon'); }
  else for (const [la, lo] of nodes.values()) { la0 = Math.min(la0, la); la1 = Math.max(la1, la); lo0 = Math.min(lo0, lo); lo1 = Math.max(lo1, lo); }
  const lat0 = (la0 + la1) / 2, lon0 = (lo0 + lo1) / 2, kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540;
  const sx = Math.max(600, Math.ceil(((lo1 - lo0) * kx + 160) / 10) * 10), sz = Math.max(600, Math.ceil(((la1 - la0) * ky + 160) / 10) * 10);
  if (sx > 12000 || sz > 12000) throw new Error(`範圍 ${(sx / 1000).toFixed(1)} × ${(sz / 1000).toFixed(1)} km 太大，請匯出 10 km 以內的範圍。`);
  const P = ([la, lo]) => [(lo - lon0) * kx, -(la - lat0) * ky];
  const HW = { motorway: 0, trunk: 0, primary: 1, secondary: 2, tertiary: 3, residential: 4, unclassified: 4, living_street: 4, service: 4, road: 4, motorway_link: 5, trunk_link: 5, primary_link: 5, secondary_link: 5, tertiary_link: 5 };
  const roads = [], blds = [], water = [];
  for (const w of doc.getElementsByTagName('way')) {
    const tags = {}; for (const t of w.getElementsByTagName('tag')) tags[t.getAttribute('k')] = t.getAttribute('v');
    const pts = []; for (const nd of w.getElementsByTagName('nd')) { const n = nodes.get(nd.getAttribute('ref')); if (n) pts.push(...P(n)); }
    if (pts.length < 4) continue;
    if (tags.highway in HW && tags.tunnel !== 'yes' && tags.area !== 'yes') roads.push({ c: HW[tags.highway], n: tags.name || '', p: Float32Array.from(pts) });
    else if (tags.building && tags.building !== 'no') {
      let h = parseFloat(tags.height); if (!(h > 0)) h = (parseFloat(tags['building:levels']) || 3) * 3.2;
      if (pts[0] === pts[pts.length - 2] && pts[1] === pts[pts.length - 1]) pts.length -= 2;
      if (pts.length >= 6) blds.push({ h: Math.min(h, 400), p: Float32Array.from(pts) });
    } else if (tags.natural === 'water' || tags.waterway === 'riverbank' || tags.landuse === 'reservoir' || tags.landuse === 'basin') water.push(pts);
  }
  if (!roads.length) throw new Error('範圍內沒有可行駛的道路。');
  const cell = 8, nx = Math.round(sx / cell) + 1, nz = Math.round(sz / cell) + 1, raw = new Float32Array(nx * nz), mask = new Uint8Array(nx * nz).fill(1);
  for (const p of water) { // scanline fill water polygons into the mask and lower the ground under them
    const n = p.length / 2;
    for (let J = 0; J < nz; J++) {
      const zc = -sz / 2 + J * (sz / (nz - 1)), xs = [];
      for (let i = 0, k = n - 1; i < n; k = i++) { const za = p[k * 2 + 1], zb = p[i * 2 + 1]; if ((za > zc) !== (zb > zc)) xs.push(p[k * 2] + (zc - za) / (zb - za) * (p[i * 2] - p[k * 2])); }
      xs.sort((a, b) => a - b);
      for (let q = 0; q + 1 < xs.length; q += 2) for (let I = Math.max(0, Math.ceil((xs[q] + sx / 2) / (sx / (nx - 1)))); I <= Math.min(nx - 1, Math.floor((xs[q + 1] + sx / 2) / (sx / (nx - 1)))); I++) { mask[J * nx + I] = 0; raw[J * nx + I] = -2.5; }
    }
  }
  return finishCity({ kind: 'city', id: 'osm', name: fileName, sx, sz, nx, nz, raw, mask, base: TER.base, water: water.length ? -0.4 : null, roads, blds, credits: '道路、建物與水域：© OpenStreetMap contributors（ODbL）' });
}

/* ================= Track points ================= */
// points live in the editor's square view: u,v ∈ [0,1] over V = max(map width, map height); city points also carry a street node id
let trackPts = [];
function randomTrack(seed) {
  const r = mulberry32(seed), n = 9 + Math.floor(r() * 5), pts = [];
  const cx = 0.5 + (r() - 0.5) * 0.06, cy = 0.5 + (r() - 0.5) * 0.06;
  for (let i = 0; i < n; i++) {
    const ang = -i / n * Math.PI * 2 + (r() - 0.5) * 0.35, rad = 0.2 + r() * 0.2 * (i % 3 === 0 ? 0.6 : 1);
    pts.push({ u: clamp(cx + Math.cos(ang) * rad, 0.06, 0.94), v: clamp(cy + Math.sin(ang) * rad * 0.92, 0.06, 0.94) });
  }
  return pts;
}
const TP_CIRCUITS = [ // street junctions in data coordinates (m east, m north of TWD97 299000 / 2766400)
  [[3239, 3774], [3913, 3406], [4745, 3209], [4971, 2370], [4077, 2450], [3732, 2478], [3516, 2781], [3156, 3318]],
  [[615, 2675], [1510, 3124], [2028, 3297], [1877, 2800], [1511, 2730]],
  [[4312, 3718], [4760, 3709], [4745, 3209], [4207, 3247]],
];
function snapNode(M, x, z) { const g = M.graph; let best = 0, bd = Infinity; for (let i = 0; i < g.x.length; i++) { const d = (g.x[i] - x) ** 2 + (g.z[i] - z) ** 2; if (d < bd) { bd = d; best = i; } } return best; }
const viewSize = M => Math.max(M.sx, M.sz);
function cityPoint(M, x, z) { const id = snapNode(M, x, z), V = viewSize(M); return { u: M.graph.x[id] / V + 0.5, v: M.graph.z[id] / V + 0.5, node: id }; }
function cityPreset(M, i) { return TP_CIRCUITS[i].map(([X, Y]) => cityPoint(M, X - M.sx / 2, M.sz / 2 - Y)); }

function astar(g, s, t) {
  const n = g.x.length, dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), done = new Uint8Array(n);
  const hx = g.x[t], hz = g.z[t], heap = [];
  const push = (f, i) => { heap.push([f, i]); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
  dist[s] = 0; push(0, s);
  while (heap.length) {
    const [, u] = pop(); if (done[u]) continue; done[u] = 1; if (u === t) break;
    const a = g.adj[u];
    for (let e = 0; e < a.length; e += 2) { const v = a[e], nd = dist[u] + a[e + 1]; if (nd < dist[v]) { dist[v] = nd; prev[v] = u; push(nd + Math.hypot(g.x[v] - hx, g.z[v] - hz), v); } }
  }
  if (!done[t]) return null;
  const path = []; for (let v = t; v >= 0; v = prev[v]) path.push(v); return path.reverse();
}
function routeLoop(M, pts) {
  const g = M.graph, out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i].node, b = pts[(i + 1) % pts.length].node, p = a === b ? [a] : astar(g, a, b);
    if (!p) { out.push([g.x[a], g.z[a]]); continue; }
    for (let k = 0; k < p.length - 1; k++) out.push([g.x[p[k]], g.z[p[k]]]);
  }
  return out;
}
function resampleLoop(P, step) {
  const n = P.length, cum = [0];
  for (let i = 0; i < n; i++) { const a = P[i], b = P[(i + 1) % n]; cum.push(cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  const L = cum[n], m = Math.max(8, Math.round(L / step)), out = []; let j = 0;
  for (let k = 0; k < m; k++) {
    const s = k / m * L; while (j < n - 1 && cum[j + 1] < s) j++;
    const a = P[j], b = P[(j + 1) % n], f = (s - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j]);
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
  }
  return out;
}
function cleanRoute(P) {
  let p = P.filter((q, i) => i === 0 || Math.hypot(q[0] - P[i - 1][0], q[1] - P[i - 1][1]) > 0.5);
  for (let pass = 0; pass < 6; pass++) { // drop dead-end spikes (route going down a street and straight back)
    const keep = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[(i - 1 + p.length) % p.length], b = p[i], c = p[(i + 1) % p.length];
      const ux = b[0] - a[0], uz = b[1] - a[1], vx = c[0] - b[0], vz = c[1] - b[1];
      const cs = (ux * vx + uz * vz) / (Math.hypot(ux, uz) * Math.hypot(vx, vz) + 1e-9);
      if (cs > -0.8 || p.length < 6) keep.push(b);
    }
    if (keep.length === p.length) break; p = keep;
  }
  p = resampleLoop(p, 3);
  const X = Float32Array.from(p, q => q[0]), Z = Float32Array.from(p, q => q[1]);
  smoothCirc(X, 5, 3); smoothCirc(Z, 5, 3);
  return resampleLoop(Array.from(X, (x, i) => [x, Z[i]]), 2);
}

/* ================= Three setup ================= */
const canvas = $('#view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, COARSE ? 1.5 : 2));
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const SUN_DIR = new THREE.Vector3(-0.45, 0.62, 0.38).normalize();
const SKY = { horizon: new THREE.Color(0.6, 0.71, 0.83) };
scene.fog = new THREE.FogExp2(SKY.horizon.clone().multiplyScalar(0.95), 0.00017);
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 12000);
const SKY_U = { sunDir: { value: SUN_DIR }, time: { value: 0 }, horizon: { value: SKY.horizon } };
function skyMaterial() {
  // single-scattering style gradient, Mie glow around the sun and fbm cumulus projected on a cloud plane
  return new THREE.ShaderMaterial({
    uniforms: SKY_U,
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }',
    fragmentShader: `uniform vec3 sunDir, horizon; uniform float time; varying vec3 vDir;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
      float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
      void main(){ vec3 d = normalize(vDir); float h = max(d.y, 0.0), mu = max(dot(d, sunDir), 0.0);
        vec3 zen = vec3(0.07, 0.2, 0.55);
        vec3 c = mix(horizon, zen, pow(h, 0.42));
        c += vec3(1.0, 0.82, 0.58) * (pow(mu, 6.0) * 0.18 + pow(mu, 48.0) * 0.55);
        c += vec3(1.0, 0.95, 0.85) * smoothstep(0.99935, 0.99968, mu) * 22.0;
        if (d.y > 0.0) {
          vec2 uv = d.xz / (d.y + 0.1) * 1.4 + vec2(time * 0.0035, time * 0.0012);
          float n = fbm(uv), cov = smoothstep(0.5, 0.74, n);
          float lit = fbm(uv + sunDir.xz * 0.06);
          vec3 cc = mix(vec3(1.0, 0.99, 0.97), vec3(0.55, 0.6, 0.68), clamp((n - lit) * 4.0 + 0.35, 0.0, 1.0));
          cc += vec3(1.0, 0.88, 0.7) * pow(mu, 10.0) * 0.45;
          c = mix(c, cc, cov * smoothstep(0.0, 0.2, d.y) * 0.95);
        }
        c = mix(c, horizon * 0.82, smoothstep(0.02, -0.06, d.y));
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <encodings_fragment>
      }`,
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
}
const sky = new THREE.Mesh(new THREE.SphereGeometry(9000, 32, 16), skyMaterial()); sky.frustumCulled = false; sky.renderOrder = -1; scene.add(sky);
{ // image-based light for paint and carbon reflections
  const envScene = new THREE.Scene(); envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), skyMaterial()));
  const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(envScene, 0.02).texture; pm.dispose();
}
const hemi = new THREE.HemisphereLight(lin(0xbcd6f5), lin(0x5f5b4c), 0.62); scene.add(hemi);
const sun = new THREE.DirectionalLight(lin(0xfff1dc), 2.6); sun.castShadow = true;
sun.shadow.mapSize.set(COARSE ? 1024 : 2048, COARSE ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 10, far: 600 });
sun.shadow.camera.updateProjectionMatrix(); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
scene.add(sun); scene.add(sun.target);
// post-processing (high quality): multisampled render → subtle bloom → grade (vignette, saturation, grain, sRGB out)
const POST = { comp: null, on: false, grade: null, bloom: null };
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, res: { value: new THREE.Vector2(1, 1) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float time; uniform vec2 res; varying vec2 vUv;
    void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); c = mix(vec3(l), c, 1.1);
      c = c * vec3(1.02, 1.0, 0.97);
      vec2 q = vUv - 0.5; c *= 1.0 - dot(q, q) * 0.6;
      float g = fract(sin(dot(vUv * res + time * 61.0, vec2(12.9898, 78.233))) * 43758.5453) - 0.5; c += g * 0.018 * (1.0 - l);
      gl_FragColor = LinearTosRGB(vec4(max(c, 0.0), 1.0)); }`,
};
function setupPost() {
  if (POST.comp || !THREE.EffectComposer || !THREE.UnrealBloomPass || !renderer.capabilities.isWebGL2) return !!POST.comp;
  try {
    const sz = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rtt = new THREE.WebGLMultisampleRenderTarget(sz.x, sz.y, { format: THREE.RGBAFormat }); rtt.samples = 4;
    const comp = new THREE.EffectComposer(renderer, rtt);
    comp.addPass(new THREE.RenderPass(scene, camera));
    POST.bloom = new THREE.UnrealBloomPass(new THREE.Vector2(sz.x, sz.y), 0.2, 0.45, 0.86); comp.addPass(POST.bloom);
    POST.grade = new THREE.ShaderPass(GradeShader); comp.addPass(POST.grade);
    POST.comp = comp; return true;
  } catch (e) { POST.comp = null; return false; }
}
function resize() {
  const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  if (POST.comp) { POST.comp.setPixelRatio(renderer.getPixelRatio()); POST.comp.setSize(w, h); POST.grade.uniforms.res.value.set(w, h); }
}
addEventListener('resize', resize); resize();

/* ================= World build ================= */
const W = { H: null, dist: null, group: null, n: 0, sx: 2400, sz: 2400, nx: N, nz: N, base: 0, wall: Infinity };
function gridSample(arr, x, z) {
  const fx = clamp((x + W.sx / 2) / W.sx * (W.nx - 1), 0, W.nx - 1.0001), fz = clamp((z + W.sz / 2) / W.sz * (W.nz - 1), 0, W.nz - 1.0001);
  const i = fx | 0, j = fz | 0, a = fx - i, b = fz - j, o = j * W.nx + i;
  const p = arr[o], q = arr[o + 1], c = arr[o + W.nx], d = arr[o + W.nx + 1];
  return p + (q - p) * a + (c - p) * b + (p - q - c + d) * a * b;
}
const Hq = (x, z) => gridSample(W.H, x, z);
function normalAt(x, z, out) { const e = 1.5; out.set(-(Hq(x + e, z) - Hq(x - e, z)) / (2 * e), 1, -(Hq(x, z + e) - Hq(x, z - e)) / (2 * e)).normalize(); return out; }
function smoothCirc(a, rad, passes) {
  const n = a.length, tmp = new Float32Array(n);
  for (let p = 0; p < passes; p++) {
    let s = 0; for (let o = -rad; o <= rad; o++) s += a[((o % n) + n) % n];
    for (let k = 0; k < n; k++) { tmp[k] = s / (2 * rad + 1); s += a[(k + rad + 1) % n] - a[((k - rad) % n + n) % n]; }
    a.set(tmp);
  }
}
function activeMap() {
  if (setup.map === 'terrain') { applyTerrainScale(); return { kind: 'terrain', sx: TER.size, sz: TER.size, nx: N, nz: N, raw: TER.raw, mask: null, base: TER.base, water: null }; }
  const M = CITY[setup.map]; if (M.id === 'osm') M.base = TER.base; return M;
}
function centreline(M) {
  const V = viewSize(M), pts = setup.reverse ? trackPts.slice().reverse() : trackPts;
  if (M.kind === 'city') return cleanRoute(routeLoop(M, pts));
  const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3((p.u - 0.5) * V, 0, (p.v - 0.5) * V)), true, 'centripetal', 0.5);
  curve.arcLengthDivisions = 4000;
  const n = Math.max(240, Math.round(curve.getLength() / 2)), sp = curve.getSpacedPoints(n); sp.pop();
  return sp.map(p => [p.x, p.z]);
}

function buildWorld() {
  const M = activeMap();
  Object.assign(W, { M, sx: M.sx, sz: M.sz, nx: M.nx, nz: M.nz, base: M.base, city: M.kind === 'city' });
  const raw = M.raw, hw = setup.width / 2, NX = W.nx, NZ = W.nz, cx = W.sx / (NX - 1), cz = W.sz / (NZ - 1);
  W.wall = setup.walls && W.city ? hw + 3.2 : Infinity;
  // --- centreline
  const cl = centreline(M), n = cl.length;
  let len = 0; for (let k = 0; k < n; k++) { const a = cl[k], b = cl[(k + 1) % n]; len += Math.hypot(b[0] - a[0], b[1] - a[1]); }
  W.n = n; W.len = len; W.ds = len / n;
  const X = W.x = Float32Array.from(cl, p => p[0]), Z = W.z = Float32Array.from(cl, p => p[1]);
  const TH = W.h = new Float32Array(n), BK = W.bank = new Float32Array(n), LX = W.lx = new Float32Array(n), LZ = W.lz = new Float32Array(n), KA = W.kappa = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const a = (k - 1 + n) % n, b = (k + 1) % n; let tx = X[b] - X[a], tz = Z[b] - Z[a]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    LX[k] = tz; LZ[k] = -tx; // left of travel direction
  }
  const rawQ = (x, z) => gridSample(raw, x, z);
  for (let k = 0; k < n; k++) {
    TH[k] = rawQ(X[k], Z[k]);
    BK[k] = setup.banking && !W.city ? (rawQ(X[k] + LX[k] * 12, Z[k] + LZ[k] * 12) - rawQ(X[k] - LX[k] * 12, Z[k] - LZ[k] * 12)) / 24 : 0;
  }
  smoothCirc(TH, Math.round(22 / W.ds), 4);
  smoothCirc(BK, Math.round(30 / W.ds), 3);
  for (let k = 0; k < n; k++) BK[k] = clamp(BK[k], -0.09, 0.09);
  const st = 3;
  for (let k = 0; k < n; k++) {
    const a = (k - st + n) % n, b = (k + st) % n, ax = -LZ[a], az = LX[a], bx = -LZ[b], bz = LX[b];
    KA[k] = -Math.atan2(ax * bz - az * bx, ax * bx + az * bz) / (2 * st * W.ds);
  }
  smoothCirc(KA, 3, 2);
  W.kerb = new Uint8Array(n); W.drs = new Uint8Array(n);
  for (let k = 0; k < n; k++) W.kerb[k] = Math.abs(KA[k]) > 1 / 260 ? 1 : 0;
  { const kk = W.kerb.slice(); for (let k = 0; k < n; k++) if (kk[k]) for (let o = -6; o <= 6; o++) W.kerb[(k + o + n) % n] = 1; }
  { // straights longer than 380 m become DRS zones (opened 60 m after the straight begins)
    let start = -1; const straight = k => Math.abs(KA[k % n]) < 1 / 700;
    let k0 = 0; while (k0 < n && straight(k0)) k0++;
    for (let i = 0; i <= n; i++) {
      const k = (k0 + i) % n, s = straight(k) && i < n;
      if (s && start < 0) start = i;
      if (!s && start >= 0) { if ((i - start) * W.ds > 380) for (let j = start + Math.round(60 / W.ds); j < i; j++) W.drs[(k0 + j) % n] = 1; start = -1; }
    }
  }
  // --- carve the road into the ground
  const H = W.H = new Float32Array(raw), D = W.dist = new Float32Array(NX * NZ).fill(1e9);
  const tgt = new Float32Array(NX * NZ), R = hw + (W.city ? 28 : 48), R2 = R * R, rci = Math.ceil(R / cx), rcj = Math.ceil(R / cz);
  for (let k = 0; k < n; k++) {
    const gi = Math.round((X[k] + W.sx / 2) / cx), gj = Math.round((Z[k] + W.sz / 2) / cz);
    for (let j = Math.max(0, gj - rcj); j <= Math.min(NZ - 1, gj + rcj); j++) {
      const dz = -W.sz / 2 + j * cz - Z[k];
      for (let i = Math.max(0, gi - rci); i <= Math.min(NX - 1, gi + rci); i++) {
        const dx = -W.sx / 2 + i * cx - X[k], d2 = dx * dx + dz * dz, o = j * NX + i;
        if (d2 < R2 && d2 < D[o]) { D[o] = d2; tgt[o] = TH[k] + BK[k] * clamp(dx * LX[k] + dz * LZ[k], -hw - 5, hw + 5); }
      }
    }
  }
  for (let i = 0; i < NX * NZ; i++) {
    if (D[i] < 1e8) { const d = Math.sqrt(D[i]); D[i] = d; H[i] = tgt[i] + (raw[i] - tgt[i]) * smooth(hw + 5, R, d); }
    else D[i] = 1e4;
  }
  for (let k = 0; k < n; k++) TH[k] = Hq(X[k], Z[k]);
  // gravel traps on the outside of tighter corners (and the run-off past the exit); barriers per side
  W.grav = new Int8Array(n);
  if (!W.city) {
    const Ks = Float32Array.from(KA); smoothCirc(Ks, 6, 2);
    const g0 = new Int8Array(n); for (let k = 0; k < n; k++) if (Math.abs(Ks[k]) > 1 / 170) g0[k] = Ks[k] > 0 ? -1 : 1;
    for (let k = 0; k < n; k++) if (g0[k]) for (let o = -4; o <= Math.round(70 / W.ds); o++) { const j = (k + o + n) % n; if (!W.grav[j]) W.grav[j] = g0[k]; }
  }
  W.wallL = new Float32Array(n).fill(Infinity); W.wallR = new Float32Array(n).fill(Infinity);
  if (setup.walls) for (let k = 0; k < n; k++) for (const side of [1, -1]) {
    let off = W.city ? hw + 3.2 : W.grav[k] === side ? hw + 17 : hw + 13;
    if (gridSample(D, X[k] + LX[k] * off * side, Z[k] + LZ[k] * off * side) < off - 3) off = Infinity; // another stretch of track is nearer: leave a gap
    (side > 0 ? W.wallL : W.wallR)[k] = off;
  }
  for (const arr of [W.wallL, W.wallR]) { // drop barrier fragments shorter than 30 m
    let k = 0; while (k < n) { if (!isFinite(arr[k])) { k++; continue; } let e = k; while (e < n && isFinite(arr[e])) e++; if ((e - k) * W.ds < 30 && !(k === 0 || e === n)) for (let j = k; j < e; j++) arr[j] = Infinity; k = e; }
  }
  buildProfile();
  buildMeshes();
  drawMinimapBase();
  $('#trkLen').textContent = (len / 1000).toFixed(3) + ' km';
  $('#hudCredit').textContent = W.city ? '© OpenStreetMap contributors' + (M.id === 'taipei' ? ' · 內政部 DEM · 臺北市 3D 建物' : '') : '';
}

// ground shader: blends grass / dirt / rock / special by per-vertex weights, sampled in world metres with a low-frequency macro layer to hide tiling
function splatMaterial(special, lambert) {
  const mat = lambert ? new THREE.MeshLambertMaterial({ vertexColors: true }) : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0, envMapIntensity: 0.25 });
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, { tG: { value: TEX.grass }, tD: { value: TEX.dirt }, tR: { value: TEX.rock }, tS: { value: special }, tM: { value: TEX.macro } });
    sh.vertexShader = 'attribute vec4 splat;\nvarying vec4 vSplat;\nvarying vec3 vWP;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vSplat = splat; vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = 'uniform sampler2D tG, tD, tR, tS, tM;\nvarying vec4 vSplat;\nvarying vec3 vWP;\n' + sh.fragmentShader.replace('#include <map_fragment>', `
      vec2 p1 = vWP.xz / 4.5;
      float mac = texture2D(tM, vWP.xz / 210.0).r, mac2 = texture2D(tM, vWP.xz / 37.0 + 0.31).r;
      vec4 w = vSplat; w.z *= smoothstep(0.2, 0.8, mac2 + w.z * 0.5); w.y *= 0.6 + mac2 * 0.8;
      w /= max(w.x + w.y + w.z + w.w, 1e-3);
      vec3 tcol = sRGBToLinear(texture2D(tG, p1)).rgb * w.x + sRGBToLinear(texture2D(tD, p1 * 0.7)).rgb * w.y
                + sRGBToLinear(texture2D(tR, p1 * 0.45)).rgb * w.z + sRGBToLinear(texture2D(tS, p1 * 0.6)).rgb * w.w;
      diffuseColor.rgb *= tcol * (0.74 + 0.5 * mac);`);
  };
  return mat;
}
// grandstand opposite the pits, just past the start line, in a frame aligned with the track there
function standFrame() {
  const n = W.n, hw = setup.width / 2, k = Math.round(25 / W.ds) % n, wl = W.wallL[k], wr = W.wallR[k];
  const off = (isFinite(wl) ? wl : hw + 12) + 3, pitOff = (isFinite(wr) ? wr : hw + 12) + 4;
  const fx = -W.lz[k], fz = W.lx[k], lx = W.lx[k], lz = W.lz[k], cx = W.x[k], cz = W.z[k];
  return { k, off, pitOff, cx, cz, fx, fz, lx, lz,
    inside(x, z) { const u = (x - cx) * fx + (z - cz) * fz, w = (x - cx) * lx + (z - cz) * lz; return Math.abs(u) < 40 && ((w > off - 2 && w < off + 16) || (!W.city && w < -pitOff + 2 && w > -pitOff - 18)); } };
}
function buildStands(grp, st) {
  const g = new THREE.Group(), y0 = Hq(st.cx + st.lx * st.off, st.cz + st.lz * st.off);
  g.matrixAutoUpdate = false; g.matrix.makeBasis(new THREE.Vector3(st.fx, 0, st.fz), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-st.lx, 0, -st.lz)).setPosition(st.cx, y0, st.cz);
  const conc = new THREE.MeshStandardMaterial({ color: lin(0xb9b6ae), roughness: 0.9 }), white = new THREE.MeshStandardMaterial({ color: lin(0xeef0f2), roughness: 0.5, metalness: 0.2 });
  const box = (w, h, d, x, y, z, mat) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; g.add(m); return m; };
  const o = st.off, L = 70;
  const sg = new THREE.BufferGeometry(); // raked seating with the crowd texture
  sg.setAttribute('position', new THREE.Float32BufferAttribute([-L / 2, 1.0, -o, L / 2, 1.0, -o, -L / 2, 7.2, -o - 10, L / 2, 7.2, -o - 10], 3));
  sg.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, L / 8, 0, 0, 1, L / 8, 1], 2)); sg.setIndex([0, 1, 2, 1, 3, 2]); sg.computeVertexNormals();
  TEX.crowd.wrapS = THREE.RepeatWrapping;
  const seats = new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ map: TEX.crowd, roughness: 0.9, side: THREE.DoubleSide })); seats.receiveShadow = true; g.add(seats);
  box(L, 5, 0.4, 0, -1.5, -o, conc); box(L, 12, 0.6, 0, 1.5, -o - 10.4, conc);
  for (const sx of [-1, 1]) box(0.4, 9, 11, sx * L / 2, 2.5, -o - 5, conc);
  const roof = box(L + 4, 0.3, 13, 0, 11.2, -o - 5, white); roof.rotation.x = -0.05;
  for (let i = 0; i <= 6; i++) box(0.35, 11, 0.35, -L / 2 + i * L / 6, 5.5, -o - 10, white);
  if (!W.city) { // pit building with garages facing the track
    const po = st.pitOff, mats = [conc, conc, white, conc, conc, new THREE.MeshStandardMaterial({ map: TEX.garage, roughness: 0.7 })];
    TEX.garage.repeat.set(5, 1);
    const pb = new THREE.Mesh(new THREE.BoxGeometry(84, 8, 14), mats); pb.position.set(0, 2.5, po + 7); pb.castShadow = pb.receiveShadow = true; g.add(pb);
    box(86, 0.4, 18, 0, 6.7, po + 6, white);
    box(84, 1.1, 0.3, 0, 0.1, po - 3, conc);
  }
  g.updateMatrixWorld(true); grp.add(g);
}
function crossGeo(tilt = 0.35) { // two crossed quads, origin at the bottom; normals lean up so foliage lights evenly
  const g = new THREE.BufferGeometry(), P = [], N = [], U = [], I = [];
  for (const a of [0, Math.PI / 2]) {
    const cx = Math.cos(a) * 0.5, cz = Math.sin(a) * 0.5, nx = -Math.sin(a), nz = Math.cos(a), b = P.length / 3;
    P.push(-cx, 0, -cz, cx, 0, cz, -cx, 1, -cz, cx, 1, cz); U.push(0, 0, 1, 0, 0, 1, 1, 1);
    for (let i = 0; i < 4; i++) { const l = Math.hypot(nx * (1 - tilt), tilt, nz * (1 - tilt)); N.push(nx * (1 - tilt) / l, tilt / l, nz * (1 - tilt) / l); }
    I.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setIndex(I); return g;
}
function frontLit(m) { // thin foliage cards: light the back face exactly like the front instead of as an unlit underside
  m.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace(/\( gl_FrontFacing \) \? vLightFront : vLightBack/g, 'vLightFront').replace(/\( gl_FrontFacing \) \? vIndirectFront : vIndirectBack/g, 'vIndirectFront'); };
  return m;
}
function foliageMat(map) {
  const m = frontLit(new THREE.MeshLambertMaterial({ map, alphaTest: 0.45, side: THREE.DoubleSide }));
  m.userData.depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.45, side: THREE.DoubleSide });
  return m;
}
function ribbonGeo(build) { // build(push) where push(x,y,z,u,v,color) returns index
  const P = [], C = [], U = [], I = [];
  build((x, y, z, u, v, c) => { P.push(x, y, z); U.push(u, v); C.push(c.r, c.g, c.b); return P.length / 3 - 1; }, I);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setIndex(I); g.computeVertexNormals(); return g;
}
function buildMeshes() {
  if (W.group) { scene.remove(W.group); W.group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) [].concat(o.material).forEach(m => m.dispose()); }); }
  const grp = W.group = new THREE.Group(); scene.add(grp);
  const M = W.M, NX = W.nx, NZ = W.nz, cx = W.sx / (NX - 1), cz = W.sz / (NZ - 1), H = W.H, D = W.dist, hw = setup.width / 2, n = W.n, X = W.x, Z = W.z;
  const nrm = new THREE.Vector3();
  // --- ground
  let lo = Infinity, hi = -Infinity; for (const v of H) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  W.minH = lo; W.maxH = hi;
  const pos = new Float32Array(NX * NZ * 3), col = new Float32Array(NX * NZ * 3), uv = new Float32Array(NX * NZ * 2), spl = new Float32Array(NX * NZ * 4), c = new THREE.Color();
  const cLow = lin(0x5a7a35), cHigh = lin(0x7d8541), cDry = lin(0x9a8a5e), cRock = lin(0x857d74), cSnow = lin(0xf0f3f6), cRun = lin(0x6a9a3c);
  const cUrban = lin(0xa9a49a), cUrban2 = lin(0x938f87), cPark = lin(0x5f8a3a), cRiver = lin(0x6b6a55), cWalk = lin(0x8e8c86);
  const hr = mulberry32(99);
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const o = j * NX + i, x = -W.sx / 2 + i * cx, z = -W.sz / 2 + j * cz;
    pos[o * 3] = x; pos[o * 3 + 1] = H[o]; pos[o * 3 + 2] = z; uv[o * 2] = x / 9; uv[o * 2 + 1] = z / 9;
    let wg = 1, wd = 0, wr = 0, ws = 0; // grass, dirt, rock, special (snow in the hills, paving in the city)
    if (W.city) {
      const m = M.mask[o];
      if (m === 0) { const mud = H[o] < (M.water ?? -99) + 1.2; wg = mud ? 0.2 : 1; wd = mud ? 1 : 0.15; }
      else if (m === 2) { wg = 1; wd = 0.1; }
      else { wg = 0.08; ws = 1; }
      c.setRGB(1, 1, 1);
      if (D[o] < hw + 10) { wg = 0; wd = 0; ws = 1; c.setRGB(0.86, 0.86, 0.86); }
    } else {
      const t = (H[o] - lo) / (hi - lo + 1e-6);
      normalAt(x, z, nrm);
      wd = smooth(0.5, 0.85, t) * 0.8 + 0.12; wr = smooth(0.82, 0.62, nrm.y) * 2.2 + smooth(0.8, 0.95, t) * 0.4; ws = hi - lo > 150 ? smooth(0.86, 0.96, t) * 3 : 0;
      wg = 1 - smooth(0.7, 0.95, t) * 0.8;
      c.setRGB(1, 1, 1).lerp(cHigh, 0.08);
      if (D[o] < hw + 14) { wg = 1.4; wd = 0.05; wr = 0; ws = 0; c.setRGB(1.08, 1.12, 1.0); }
    }
    spl[o * 4] = wg; spl[o * 4 + 1] = wd; spl[o * 4 + 2] = wr; spl[o * 4 + 3] = ws;
    const j2 = 0.94 + hr() * 0.1; col[o * 3] = c.r * j2; col[o * 3 + 1] = c.g * j2; col[o * 3 + 2] = c.b * j2;
  }
  const idx = new Uint32Array((NX - 1) * (NZ - 1) * 6); let p = 0;
  for (let j = 0; j < NZ - 1; j++) for (let i = 0; i < NX - 1; i++) { const a = j * NX + i, b = a + 1, cc = a + NX, d = cc + 1; idx[p++] = a; idx[p++] = cc; idx[p++] = b; idx[p++] = b; idx[p++] = cc; idx[p++] = d; }
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); tg.setAttribute('color', new THREE.BufferAttribute(col, 3)); tg.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); tg.setAttribute('splat', new THREE.BufferAttribute(spl, 4)); tg.setIndex(new THREE.BufferAttribute(idx, 1)); tg.computeVertexNormals();
  const ground = new THREE.Mesh(tg, splatMaterial(W.city ? TEX.pave : TEX.snow, qLevel === 'low')); ground.receiveShadow = true; grp.add(ground);
  const og = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(W.sx, W.sz) * 8, Math.max(W.sx, W.sz) * 8), new THREE.MeshLambertMaterial({ color: W.city ? cUrban2 : cLow }));
  og.rotation.x = -Math.PI / 2; og.position.y = lo - 1.5; grp.add(og);
  if (W.city && M.water !== null) { // water surface over river / lake cells
    const wl = M.water, wp = [], wi = [];
    for (let j = 0; j < NZ - 1; j++) for (let i = 0; i < NX - 1; i++) {
      const o = j * NX + i; if (M.mask[o] !== 0 && M.mask[o + 1] !== 0 && M.mask[o + NX] !== 0) continue;
      if (Math.min(H[o], H[o + 1], H[o + NX], H[o + NX + 1]) > wl + 0.5) continue;
      const b = wp.length / 3, x = -W.sx / 2 + i * cx, z = -W.sz / 2 + j * cz;
      wp.push(x, wl, z, x + cx, wl, z, x, wl, z + cz, x + cx, wl, z + cz); wi.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
    }
    const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3)); wg.setIndex(wi); wg.computeVertexNormals();
    wg.setAttribute('uv', new THREE.Float32BufferAttribute(wp.filter((v, i) => i % 3 !== 1).map(v => v / 40), 2));
    grp.add(new THREE.Mesh(wg, new THREE.MeshStandardMaterial({ color: lin(0x2c4650), roughness: 0.12, metalness: 0.15, envMapIntensity: 1.3, normalMap: TEX.waterN, normalScale: new THREE.Vector2(0.35, 0.35) })));
  }
  // --- city streets (not the circuit)
  if (W.city) {
    const g = ribbonGeo((push, I) => {
      const grey = lin(0x6f6f6f);
      for (const r of M.roads) {
        const pts = r.p, m = pts.length / 2, hwR = ROAD_W[r.c] / 2; if (m < 2) continue; let s = 0, prevBase = -1;
        for (let i = 0; i < m; i++) {
          const a = Math.max(0, i - 1), b = Math.min(m - 1, i + 1); let tx = pts[b * 2] - pts[a * 2], tz = pts[b * 2 + 1] - pts[a * 2 + 1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
          if (i) s += Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
          const x = pts[i * 2], z = pts[i * 2 + 1], lx = tz, lz = -tx;
          const v0 = push(x + lx * hwR, Hq(x + lx * hwR, z + lz * hwR) + 0.03, z + lz * hwR, 0, s / 8, grey);
          push(x - lx * hwR, Hq(x - lx * hwR, z - lz * hwR) + 0.03, z - lz * hwR, 1, s / 8, grey);
          if (prevBase >= 0) I.push(prevBase, v0, prevBase + 1, prevBase + 1, v0, v0 + 1);
          prevBase = v0;
        }
      }
    });
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, map: TEX.asphalt, roughness: 0.92, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
    mesh.receiveShadow = true; grp.add(mesh);
  }
  // --- circuit ribbons
  const S = new Float32Array(n + 1); for (let k = 1; k <= n; k++) S[k] = S[k - 1] + W.ds;
  function ribbon(from, to, cols, colorAt, yOff, keep, flat, mat, metric) {
    const g = ribbonGeo((push, I) => {
      const vert = (r, t, cc) => { const k = r % n, x = X[k] + W.lx[k] * t, z = Z[k] + W.lz[k] * t; return metric ? push(x, Hq(x, z) + yOff, z, t / metric, S[r] / metric, cc) : push(x, Hq(x, z) + yOff, z, (t - from) / (to - from), S[r] / 8, cc); };
      if (!flat) {
        for (let r = 0; r <= n; r++) for (let q = 0; q <= cols; q++) vert(r, from + (to - from) * q / cols, colorAt(r % n, q));
        for (let r = 0; r < n; r++) { if (keep && !keep(r)) continue; for (let q = 0; q < cols; q++) { const a = r * (cols + 1) + q, b = a + 1, cc = a + cols + 1, d = cc + 1; I.push(a, b, cc, b, d, cc); } }
      } else {
        for (let r = 0; r < n; r++) { if (keep && !keep(r)) continue;
          for (let q = 0; q < cols; q++) { const t0 = from + (to - from) * q / cols, t1 = from + (to - from) * (q + 1) / cols, cc = colorAt(r, q);
            const a = vert(r, t0, cc), b = vert(r, t1, cc), c2 = vert(r + 1, t0, cc), d = vert(r + 1, t1, cc); I.push(a, b, c2, b, d, c2); } }
      }
    });
    const m = new THREE.Mesh(g, mat || new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }));
    m.receiveShadow = true; grp.add(m); return m;
  }
  const asph = lin(0x8a8a8c), asph2 = lin(0x77777a), white = lin(0xf0f0f0), red = lin(0xc8202a), green = lin(0x2c9a46), black = lin(0x151515);
  // asphalt: darker rubber on the racing line, streaky braking marks where the speed profile drops
  const ar = mulberry32(5), shade = Array.from({ length: n }, () => ar()), line = new Float32Array(n), brake = new Float32Array(n), ahead = Math.round(25 / W.ds);
  for (let k = 0; k < n; k++) { line[k] = clamp(RACE.ks[(k + ahead) % n] * 650, -(hw - 1.6), hw - 1.6); const v0 = RACE.prof[k], v1 = RACE.prof[(k + Math.round(40 / W.ds)) % n]; brake[k] = clamp((v0 - v1) / 25, 0, 1); }
  smoothCirc(line, 6, 2); smoothCirc(brake, 4, 2);
  const AC = 20, tmpC = new THREE.Color();
  ribbon(-hw, hw, AC, (k, q) => {
    const t = -hw + 2 * hw * q / AC, dl = (t - line[k]) / 1.7, rub = Math.exp(-dl * dl), streak = brake[k] * (0.5 + 0.5 * Math.sin(t * 5.3 + k * 0.05)) * Math.exp(-dl * dl * 0.6);
    const edge = smooth(hw - 1.2, hw, Math.abs(t)) * 0.12;
    return tmpC.copy(asph).lerp(asph2, shade[k] * 0.4).multiplyScalar(1 - rub * 0.22 - streak * 0.32 + edge).clone();
  }, 0.05, null, false,
    new THREE.MeshStandardMaterial({ vertexColors: true, map: TEX.asphalt2, normalMap: TEX.asphaltN, normalScale: new THREE.Vector2(0.55, 0.55), roughness: 0.8, envMapIntensity: 0.5, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }), 6);
  const gravM = new THREE.MeshStandardMaterial({ map: TEX.gravel, roughness: 1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  for (const sd of [1, -1]) { const keepG = r => W.grav[r] === sd && W.grav[(r + 1) % n] === sd; ribbon(sd > 0 ? hw + 1.5 : -hw - 17, sd > 0 ? hw + 17 : -hw - 1.5, 4, () => white, 0.035, keepG, false, gravM, 5); }
  ribbon(hw - 0.45, hw - 0.15, 1, () => white, 0.07, null, false);
  ribbon(-hw + 0.15, -hw + 0.45, 1, () => white, 0.07, null, false);
  const kerbKeep = r => W.kerb[r] && W.kerb[(r + 1) % n], kerbCol = k => ((k >> 1) & 1) ? white : red;
  ribbon(hw, hw + 1.5, 1, kerbCol, 0.09, kerbKeep, true);
  ribbon(-hw - 1.5, -hw, 1, kerbCol, 0.09, kerbKeep, true);
  ribbon(-hw, hw, 10, (k, q) => ((q + k) & 1) ? white : black, 0.1, r => r === 0 || r === 1, true);
  ribbon(-hw, hw, 1, () => green, 0.1, r => W.drs[r] && !W.drs[(r - 1 + n) % n], true);
  for (let gs = 1; gs <= 6; gs++) { // starting grid slots, staggered like a real grid
    const r0 = n - gs * 4, side = gs & 1 ? 1 : -1;
    ribbon(side * 1.0, side * 4.6, 1, () => white, 0.1, r => r === r0, true);
  }
  // --- barriers: concrete + catch fence on street circuits; armco rails and tyre walls on road courses
  const vwall = (side, extra, y0, y1, mat, uScale, keep) => {
    const arr = side > 0 ? W.wallL : W.wallR;
    const g = ribbonGeo((push, I) => {
      const w = lin(0xffffff), idx = new Int32Array(n + 1).fill(-1);
      for (let r = 0; r <= n; r++) { const k = r % n; if (!isFinite(arr[k])) continue; const off = (arr[k] + extra) * side, x = X[k] + W.lx[k] * off, z = Z[k] + W.lz[k] * off, h = Hq(x, z); idx[r] = push(x, h + y0, z, S[r] / uScale, 0, w); push(x, h + y1, z, S[r] / uScale, 1, w); }
      for (let r = 0; r < n; r++) { const a = idx[r], b = idx[r + 1]; if (a < 0 || b < 0 || (keep && !keep(r))) continue; I.push(a, b, a + 1, a + 1, b, b + 1); }
    });
    const m = new THREE.Mesh(g, mat); m.castShadow = m.receiveShadow = true; grp.add(m);
  };
  if (W.city) {
    const bm = new THREE.MeshStandardMaterial({ map: TEX.barrier, roughness: 0.8, side: THREE.DoubleSide });
    const fm = new THREE.MeshStandardMaterial({ map: TEX.fence, alphaTest: 0.4, transparent: false, roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide });
    for (const sd of [1, -1]) { vwall(sd, 0, -0.3, 1.05, bm, 32); vwall(sd, 0.15, 1.05, 4.2, fm, 3.2); }
  } else {
    const am = new THREE.MeshStandardMaterial({ map: TEX.armco, roughness: 0.35, metalness: 0.8, side: THREE.DoubleSide, envMapIntensity: 1 });
    const tm = new THREE.MeshStandardMaterial({ map: TEX.tyres, roughness: 0.9, side: THREE.DoubleSide });
    for (const sd of [1, -1]) {
      vwall(sd, 0, 0.35, 0.78, am, 4, r => W.grav[r] !== sd);
      vwall(sd, 0, -0.2, 1.0, tm, 2.2, r => W.grav[r] === sd);
    }
    // armco posts every 4 m
    const posts = []; for (let k = 0; k < n; k += Math.max(1, Math.round(4 / W.ds))) for (const sd of [1, -1]) { const a = (sd > 0 ? W.wallL : W.wallR)[k]; if (isFinite(a) && W.grav[k] !== sd) posts.push([k, sd, a]); }
    if (posts.length) {
      const pg = new THREE.BoxGeometry(0.1, 0.8, 0.12); pg.translate(0, 0.4, 0);
      const pm = new THREE.InstancedMesh(pg, new THREE.MeshStandardMaterial({ color: lin(0x6c7278), roughness: 0.5, metalness: 0.7 }), posts.length), mm4 = new THREE.Matrix4();
      posts.forEach(([k, sd, a], i) => { const off = (a + 0.12) * sd, x = X[k] + W.lx[k] * off, z = Z[k] + W.lz[k] * off; mm4.makeTranslation(x, Hq(x, z), z); pm.setMatrixAt(i, mm4); });
      grp.add(pm);
    }
  }
  // --- buildings (chunked so frustum culling works for both camera and shadow passes)
  const facM = [TEX.facA, TEX.facB, TEX.facC].map(t => new THREE.MeshStandardMaterial({ map: t, vertexColors: true, roughness: t === TEX.facB ? 0.25 : 0.85, metalness: t === TEX.facB ? 0.35 : 0, envMapIntensity: t === TEX.facB ? 1.1 : 0.3 }));
  const shopM = new THREE.MeshStandardMaterial({ map: TEX.shop, roughness: 0.8 }), roofM = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  const stand = standFrame();
  if (W.city && M.blds.length) {
    const tile = 500, tiles = new Map(), pal = [0xffffff, 0xf2ece2, 0xe6ddd0, 0xdfe2e4, 0xd2cbbf, 0xf5efe6, 0xe9dccb, 0xd9dcdf].map(lin);
    const near = (x, z) => gridSample(D, x, z) < (isFinite(W.wall) ? W.wall + 3 : hw + 6) || stand.inside(x, z);
    const props = { tank: [], hut: [], shed: [] }, br = mulberry32(17);
    let kept = 0;
    M.blds.forEach((b, bi) => {
      const p = b.p, m = p.length / 2; let gx = 0, gz = 0;
      for (let i = 0; i < m; i++) { gx += p[i * 2]; gz += p[i * 2 + 1]; } gx /= m; gz /= m;
      if (near(gx, gz)) return;
      for (let i = 0; i < m; i++) { const j = (i + 1) % m; if (near(p[i * 2], p[i * 2 + 1]) || near((p[i * 2] + p[j * 2]) / 2, (p[i * 2 + 1] + p[j * 2 + 1]) / 2)) return; }
      const key = Math.floor((gx + W.sx / 2) / tile) + ',' + Math.floor((gz + W.sz / 2) / tile);
      if (!tiles.has(key)) tiles.set(key, { F: [0, 1, 2].map(() => ({ P: [], U: [], C: [], I: [] })), S: { P: [], U: [], C: [], I: [] }, RP: [], RC: [], RI: [] });
      const T = tiles.get(key), hsh = (bi * 2654435761) >>> 0, tint = pal[hsh % pal.length];
      const fam = b.h > 42 ? (hsh % 3 === 0 ? 2 : 1) : b.h > 24 ? [0, 2, 1][hsh % 3] : (hsh % 5 === 0 ? 2 : 0), F = T.F[fam];
      let base = Infinity; for (let i = 0; i < m; i++) base = Math.min(base, Hq(p[i * 2], p[i * 2 + 1]));
      const top = Hq(gx, gz) + b.h; base -= 0.4;
      const shopTop = fam === 1 || b.h < 7 ? base : Math.min(top - 2, base + 4.6);
      // orient ring counter-clockwise (seen from above) so wall normals face out
      let area = 0; for (let i = 0; i < m; i++) { const j = (i + 1) % m; area += p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1]; }
      const ord = area < 0 ? [...Array(m).keys()] : [...Array(m).keys()].reverse();
      let per = 0;
      for (let q = 0; q < m; q++) {
        const i = ord[q], j = ord[(q + 1) % m], x0 = p[i * 2], z0 = p[i * 2 + 1], x1 = p[j * 2], z1 = p[j * 2 + 1], L = Math.hypot(x1 - x0, z1 - z0);
        const quad = (Q, yb, yt, vb, vt, us) => { const v0 = Q.P.length / 3; Q.P.push(x0, yb, z0, x1, yb, z1, x0, yt, z0, x1, yt, z1); Q.U.push(per / us, vb, (per + L) / us, vb, per / us, vt, (per + L) / us, vt); for (let r = 0; r < 4; r++) Q.C.push(tint.r, tint.g, tint.b); Q.I.push(v0, v0 + 1, v0 + 2, v0 + 1, v0 + 3, v0 + 2); };
        if (shopTop > base) quad(T.S, base, shopTop, 0, 1, 12);
        quad(F, shopTop, top, 0, (top - shopTop) / 13.2, 12);
        per += L;
      }
      const contour = ord.map(i => new THREE.Vector2(p[i * 2], p[i * 2 + 1])), tris = THREE.ShapeUtils.triangulateShape(contour, []), r0 = T.RP.length / 3;
      const rc = lin([0x8e8b86, 0x7d7a75, 0x9a978f, 0x5f8a6a, 0x8a8f8f][hsh % 5]); // grey concrete, and the green waterproofing common on Taipei roofs
      contour.forEach(v => { T.RP.push(v.x, top, v.y); T.RC.push(rc.r, rc.g, rc.b); });
      tris.forEach(t => T.RI.push(r0 + t[0], r0 + t[2], r0 + t[1]));
      // rooftop clutter: water tanks, stair huts and tin-roof add-ons
      if (qLevel !== 'low') {
        let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (let i = 0; i < m; i++) { x0 = Math.min(x0, p[i * 2]); x1 = Math.max(x1, p[i * 2]); z0 = Math.min(z0, p[i * 2 + 1]); z1 = Math.max(z1, p[i * 2 + 1]); }
        const ang = Math.atan2(p[3] - p[1], p[2] - p[0]), span = Math.min(x1 - x0, z1 - z0);
        if (span > 6 && b.h < 60) {
          if (br() < 0.65) props.tank.push([gx + (br() - 0.5) * span * 0.4, top, gz + (br() - 0.5) * span * 0.4, 0.8 + br() * 0.5]);
          if (br() < 0.45) props.hut.push([gx + (br() - 0.5) * span * 0.3, top, gz + (br() - 0.5) * span * 0.3, ang]);
          if (b.h < 26 && br() < 0.3) props.shed.push([gx, top, gz, ang, span * 0.55]);
        }
      }
      kept++;
    });
    const quadMesh = (Q, mat) => { if (!Q.I.length) return; const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(Q.P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(Q.U, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(Q.C, 3)); g.setIndex(Q.I); g.computeVertexNormals(); const wm = new THREE.Mesh(g, mat); wm.castShadow = wm.receiveShadow = true; grp.add(wm); };
    for (const T of tiles.values()) {
      T.F.forEach((Q, i) => quadMesh(Q, facM[i])); quadMesh(T.S, shopM);
      const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(T.RP, 3)); rg.setAttribute('color', new THREE.Float32BufferAttribute(T.RC, 3)); rg.setIndex(T.RI); rg.computeVertexNormals();
      const rm = new THREE.Mesh(rg, roofM); rm.castShadow = rm.receiveShadow = true; grp.add(rm);
    }
    W.bldKept = kept;
    const inst = (list, geo, mat, set) => { if (!list.length) return; const im = new THREE.InstancedMesh(geo, mat, list.length), mm = new THREE.Matrix4(), qq = new THREE.Quaternion(), vv = new THREE.Vector3(), ss = new THREE.Vector3(), ee = new THREE.Euler(); list.forEach((it, i) => { set(it, vv, ee, ss); qq.setFromEuler(ee); mm.compose(vv, qq, ss); im.setMatrixAt(i, mm); }); im.castShadow = im.receiveShadow = true; grp.add(im); };
    const tankG = new THREE.CylinderGeometry(0.75, 0.75, 1.4, 12); tankG.translate(0, 1.6, 0);
    inst(props.tank, tankG, new THREE.MeshStandardMaterial({ color: lin(0xd5d9dd), roughness: 0.3, metalness: 0.8 }), ([x, y, z, sc], v, e, sv) => { v.set(x, y, z); e.set(0, 0, 0); sv.set(sc, sc, sc); });
    const hutG = new THREE.BoxGeometry(3, 2.8, 2.6); hutG.translate(0, 1.4, 0);
    inst(props.hut, hutG, new THREE.MeshStandardMaterial({ color: lin(0xb9b4ab), roughness: 0.9 }), ([x, y, z, a], v, e, sv) => { v.set(x, y, z); e.set(0, -a, 0); sv.set(1, 1, 1); });
    const shedG = new THREE.BoxGeometry(1, 2.6, 1); shedG.translate(0, 1.3, 0);
    inst(props.shed, shedG, new THREE.MeshStandardMaterial({ color: lin(0x6f8796), roughness: 0.45, metalness: 0.6 }), ([x, y, z, a, w], v, e, sv) => { v.set(x, y, z); e.set(0, -a, 0); sv.set(w, 1, w * 0.8); });
  }
  buildStands(grp, stand);
  // --- vegetation
  const tr = mulberry32(42), m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), tc = new THREE.Color();
  const treeGeo = crossGeo(0.4), eu = new THREE.Euler();
  const placeTrees = (spots, broadleaf) => {
    const cnt = spots.length; if (!cnt) return;
    const mat = foliageMat(broadleaf ? TEX.treeBroad : TEX.treeCon), trees = new THREE.InstancedMesh(treeGeo, mat, cnt);
    trees.customDepthMaterial = mat.userData.depth;
    spots.forEach(([x, z, s], i) => {
      const hgt = broadleaf ? 8.5 * s : 14 * s, wid = broadleaf ? 8 * s : 6 * s;
      sc.set(wid, hgt, wid); ps.set(x, Hq(x, z) - 0.3, z); eu.set(0, tr() * Math.PI, 0); q4.setFromEuler(eu); m4.compose(ps, q4, sc);
      trees.setMatrixAt(i, m4); tc.setHSL(0.22 + tr() * 0.08, 0.25, 0.42 + tr() * 0.2); trees.setColorAt(i, tc);
    });
    q4.identity(); trees.castShadow = true; trees.receiveShadow = true; grp.add(trees);
  };
  if (!W.city && qLevel !== 'low') { // grass tufts in the verges, kept out of the gravel and off the asphalt
    const cnt = qLevel === 'high' ? 18000 : 8000, tufts = new THREE.InstancedMesh(crossGeo(0.85), frontLit(new THREE.MeshLambertMaterial({ map: TEX.tuft, alphaTest: 0.5, side: THREE.DoubleSide })), cnt);
    let i = 0;
    for (let tries = 0; tries < cnt * 2 && i < cnt; tries++) {
      const k = Math.floor(tr() * n), sd = tr() < 0.5 ? 1 : -1, lat = sd * (hw + 2.5 + Math.pow(tr(), 1.6) * 30);
      if (W.grav[k] === sd && Math.abs(lat) < hw + 18) continue;
      const wl = (sd > 0 ? W.wallL : W.wallR)[k]; if (Math.abs(Math.abs(lat) - wl) < 1) continue;
      const x = X[k] + W.lx[k] * lat, z = Z[k] + W.lz[k] * lat; if (gridSample(D, x, z) < hw + 2) continue;
      const s2 = 0.5 + tr() * 0.6; sc.set(s2 * 0.9, s2 * 0.38, s2 * 0.9); ps.set(x, Hq(x, z) - 0.03, z); eu.set(0, tr() * Math.PI, 0); q4.setFromEuler(eu); m4.compose(ps, q4, sc);
      tufts.setMatrixAt(i, m4); tc.setHSL(0.2 + tr() * 0.06, 0.3, 0.62 + tr() * 0.2); tufts.setColorAt(i, tc); i++;
    }
    tufts.count = i; q4.identity(); grp.add(tufts);
  }
  if (W.city) {
    const spots = [], occ = M.occ, free = (x, z) => { const i = Math.floor((x + W.sx / 2) / occ.cs), j = Math.floor((z + W.sz / 2) / occ.cs); return i >= 0 && j >= 0 && i < occ.rw && j < occ.rh && !occ.a[j * occ.rw + i]; };
    for (const r of M.roads) {
      if (r.c > 3) continue; const pts = r.p, off = ROAD_W[r.c] / 2 + 2.2;
      for (let i = 0; i + 1 < pts.length / 2; i++) {
        const x0 = pts[i * 2], z0 = pts[i * 2 + 1], x1 = pts[i * 2 + 2], z1 = pts[i * 2 + 3], L = Math.hypot(x1 - x0, z1 - z0); if (L < 1) continue;
        const lx = (z1 - z0) / L, lz = -(x1 - x0) / L;
        for (let s = tr() * 12; s < L; s += 11 + tr() * 4) for (const sd of [1, -1]) {
          const x = x0 + (x1 - x0) * s / L + lx * off * sd, z = z0 + (z1 - z0) * s / L + lz * off * sd;
          if (!free(x, z) || gridSample(D, x, z) < (isFinite(W.wall) ? W.wall + 2 : hw + 4) || Math.abs(x) > W.sx / 2 - 5 || Math.abs(z) > W.sz / 2 - 5) continue;
          const mk = M.mask[Math.round((z + W.sz / 2) / cz) * NX + Math.round((x + W.sx / 2) / cx)]; if (mk === 0) continue;
          spots.push([x, z, 0.8 + tr() * 0.4]); if (spots.length > 5000) break;
        }
      }
    }
    placeTrees(spots, true);
    // street lights along the circuit
    const lamps = [], lampG = new THREE.CylinderGeometry(0.09, 0.12, 9, 6); lampG.translate(0, 4.5, 0);
    const headG = new THREE.BoxGeometry(1.6, 0.2, 0.4); headG.translate(0.7, 9, 0);
    const off = (isFinite(W.wall) ? W.wall : hw) + 1.6;
    for (let k = 0; k < n; k += Math.round(38 / W.ds)) for (const sd of [1, -1]) lamps.push([k, sd]);
    const poles = new THREE.InstancedMesh(lampG, new THREE.MeshStandardMaterial({ color: lin(0x5d6166), roughness: 0.5, metalness: 0.7 }), lamps.length);
    const heads = new THREE.InstancedMesh(headG, new THREE.MeshStandardMaterial({ color: lin(0x4a4d52), roughness: 0.5, metalness: 0.5, emissive: lin(0x333020) }), lamps.length);
    const e = new THREE.Euler();
    lamps.forEach(([k, sd], i) => { const x = X[k] + W.lx[k] * off * sd, z = Z[k] + W.lz[k] * off * sd; ps.set(x, Hq(x, z), z); e.set(0, Math.atan2(W.lz[k] * sd, -W.lx[k] * sd), 0); q4.setFromEuler(e); sc.set(1, 1, 1); m4.compose(ps, q4, sc); poles.setMatrixAt(i, m4); heads.setMatrixAt(i, m4); });
    poles.castShadow = heads.castShadow = true; grp.add(poles, heads); q4.identity();
  } else {
    const spots = [];
    for (let tries = 0; tries < 40000 && spots.length < (qLevel === 'low' ? 1500 : 3200); tries++) {
      const x = (tr() - 0.5) * W.sx * 0.98, z = (tr() - 0.5) * W.sz * 0.98;
      if (gridSample(D, x, z) < hw + 24) continue; normalAt(x, z, nrm); if (nrm.y < 0.8) continue;
      if ((Hq(x, z) - lo) / (hi - lo + 1e-6) > 0.82 && hi - lo > 150) continue;
      spots.push([x, z, 0.75 + tr() * 0.6]);
    }
    const broad = spots.filter((_, i) => i % 3 === 0), con = spots.filter((_, i) => i % 3 !== 0);
    placeTrees(broad, true); placeTrees(con, false);
  }
  // --- start gantry
  const gm = new THREE.MeshStandardMaterial({ color: lin(0x2b3038), roughness: 0.5, metalness: 0.6 }), fx = -W.lz[0], fz = W.lx[0], gw = (isFinite(W.wall) ? W.wall : hw + 3);
  for (const s of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7, 0.5), gm), x = X[0] + W.lx[0] * gw * s, z = Z[0] + W.lz[0] * gw * s; post.position.set(x, Hq(x, z) + 3.5, z); post.castShadow = true; grp.add(post); }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.9, gw * 2 + 0.5), gm); beam.position.set(X[0], W.h[0] + 7, Z[0]); beam.rotation.y = Math.atan2(-fz, fx); beam.castShadow = true; grp.add(beam);
}

/* ================= Car model ================= */
// loft: smooth body from rounded-rectangle cross sections ordered front → back: [x, width, height, yCentre, zCentre]
function loft(secs, seg = 24, e = 3) {
  const P = [], I = [], ring = (x, w, h, yc, zc) => { const r = []; for (let i = 0; i < seg; i++) { const t = i / seg * Math.PI * 2, c = Math.cos(t), s = Math.sin(t); r.push(x, yc + h / 2 * Math.sign(s) * Math.pow(Math.abs(s), 2 / e), zc + w / 2 * Math.sign(c) * Math.pow(Math.abs(c), 2 / e)); } return r; };
  secs.forEach(([x, w, h, yc, zc = 0]) => P.push(...ring(x, w, h, yc, zc)));
  for (let a = 0; a < secs.length - 1; a++) for (let i = 0; i < seg; i++) { const i2 = (i + 1) % seg, p0 = a * seg + i, p1 = a * seg + i2, p2 = (a + 1) * seg + i, p3 = (a + 1) * seg + i2; I.push(p0, p1, p2, p1, p3, p2); }
  for (const [end, sign] of [[0, 1], [secs.length - 1, -1]]) { // caps
    const [x, w, h, yc, zc = 0] = secs[end], b = P.length / 3; P.push(x, yc, zc); P.push(...ring(x, w, h, yc, zc));
    for (let i = 0; i < seg; i++) { const i2 = (i + 1) % seg; if (sign > 0) I.push(b, b + 1 + i2, b + 1 + i); else I.push(b, b + 1 + i, b + 1 + i2); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(I); g.computeVertexNormals(); return g;
}
const SPEC = {
  m: 850, Iz: 1100, L: 3.6, a: 1.944, b: 1.656, h: 0.30, rw: 0.36,
  ratios: [17.1, 12.5, 9.87, 8.15, 6.93, 6.15, 5.43, 4.79], rev: -15, eta: 0.92,
  Pmax: 880000, idle: 4000, limiter: 15000, upAt: 11900, maxBrake: 72000,
};
function buildCar(color, ghost, lite) {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const ghostM = new THREE.MeshBasicMaterial({ color: 0x9fe0ff, transparent: true, opacity: 0.26, depthWrite: false });
  const std = o => ghost ? ghostM : new THREE.MeshStandardMaterial(o);
  const paint = ghost ? ghostM : new THREE.MeshPhysicalMaterial({ color: lin(color).multiplyScalar(0.72), roughness: 0.5, metalness: 0.0, clearcoat: 0.6, clearcoatRoughness: 0.15, envMapIntensity: 0.35 });
  const carbon = std({ color: lin(0x121417), roughness: 0.38, metalness: 0.35 }), satin = std({ color: lin(0x1d2025), roughness: 0.6, metalness: 0.2 });
  const white = std({ color: lin(0xf1f1f1), roughness: 0.35, metalness: 0.1 }), tyreM = std({ color: lin(0x1a1a1a), roughness: 0.92, metalness: 0 });
  const helmetM = std({ color: lin(0xffd23f), roughness: 0.25, metalness: 0.2 }), visor = std({ color: lin(0x0b0d10), roughness: 0.05, metalness: 0.9 });
  const soft = std({ color: lin(0xd8262c), roughness: 0.6 }), rimM = std({ color: lin(0x2a2d31), roughness: 0.3, metalness: 0.85 });
  const bright = new THREE.Color(color).getHSL({}).l > 0.6, accent = std({ color: lin(bright ? 0x1b1d22 : 0xf2f2f2), roughness: 0.35, metalness: 0.15 });
  if (!ghost) { // soft contact shadow so the car sits on the road even outside the shadow map
    const cs = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 2.7), new THREE.MeshBasicMaterial({ map: TEX.contact, transparent: true, depthWrite: false, opacity: 0.85, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }));
    cs.rotation.x = -Math.PI / 2; cs.position.set(-0.1, 0.035, 0); cs.renderOrder = 1; root.add(cs);
  }
  const add = (geo, mat, x = 0, y = 0, z = 0, parent = body) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = !ghost && !lite; parent.add(m); return m; };
  const D = (...a) => lite ? null : add(...a); // detail parts skipped on opponents' cars
  // floor & plank
  const floor = new THREE.Shape([[2.0, 0.42], [1.2, 0.72], [-1.6, 0.8], [-2.05, 0.55], [-2.05, -0.55], [-1.6, -0.8], [1.2, -0.72], [2.0, -0.42]].map(([x, z]) => new THREE.Vector2(x, z)));
  const fg = new THREE.ExtrudeGeometry(floor, { depth: 0.035, bevelEnabled: false }); fg.rotateX(Math.PI / 2); add(fg, carbon, 0, 0.1, 0);
  // monocoque + nose
  add(loft([[3.02, 0.14, 0.09, 0.25], [2.75, 0.22, 0.15, 0.27], [2.3, 0.32, 0.24, 0.31], [1.8, 0.42, 0.32, 0.36], [1.25, 0.54, 0.4, 0.41], [0.8, 0.66, 0.46, 0.44], [0.3, 0.76, 0.48, 0.43], [-0.25, 0.8, 0.46, 0.41], [-0.45, 0.6, 0.36, 0.39]]), paint);
  // cockpit rim + driver
  add(loft([[0.62, 0.5, 0.06, 0.66], [0.05, 0.56, 0.06, 0.66], [-0.08, 0.36, 0.05, 0.66]], 16, 2.2), satin);
  add(new THREE.SphereGeometry(0.135, 20, 14), helmetM, 0.14, 0.75, 0);
  add(new THREE.SphereGeometry(0.137, 16, 8, Math.PI - 0.9, 1.8, 1.1, 0.55), visor, 0.14, 0.75, 0);
  // engine cover with airbox and shark fin
  add(loft([[0.08, 0.26, 0.22, 0.86], [-0.15, 0.4, 0.42, 0.78], [-0.6, 0.56, 0.62, 0.64], [-1.1, 0.56, 0.5, 0.56], [-1.6, 0.42, 0.36, 0.48], [-2.05, 0.24, 0.22, 0.42], [-2.4, 0.12, 0.12, 0.4]]), paint);
  D(loft([[0.1, 0.2, 0.14, 0.88], [0.04, 0.16, 0.1, 0.88]], 16, 2.5), satin); // intake mouth
  const fin = new THREE.Shape([new THREE.Vector2(-0.3, 0), new THREE.Vector2(-1.9, 0), new THREE.Vector2(-1.9, 0.22), new THREE.Vector2(-0.5, 0.06)]);
  const fing = new THREE.ExtrudeGeometry(fin, { depth: 0.015, bevelEnabled: false }); fing.translate(0, 0, -0.0075); add(fing, accent, 0, 0.9, 0);
  for (const s of [-1, 1]) {
    // sidepods with undercut
    add(loft([[0.42, 0.3, 0.3, 0.42, s * 0.56], [0.2, 0.42, 0.4, 0.42, s * 0.6], [-0.4, 0.42, 0.38, 0.4, s * 0.58], [-1.1, 0.3, 0.28, 0.34, s * 0.5], [-1.7, 0.16, 0.16, 0.3, s * 0.4]]), paint);
    add(new THREE.BoxGeometry(0.03, 0.24, 0.26), satin, 0.43, 0.43, s * 0.56);
    // mirrors
    D(new THREE.BoxGeometry(0.05, 0.07, 0.16), paint, 0.5, 0.68, s * 0.5);
    D(new THREE.BoxGeometry(0.02, 0.02, 0.14), carbon, 0.5, 0.64, s * 0.4);
    // front wing endplates
    add(new THREE.BoxGeometry(0.62, 0.28, 0.025), carbon, 2.72, 0.2, s * 0.97);
    // rear wing endplates
    const ep = new THREE.Shape([new THREE.Vector2(-2.0, 0.45), new THREE.Vector2(-2.7, 0.45), new THREE.Vector2(-2.7, 1.05), new THREE.Vector2(-2.12, 1.05)]);
    const epg = new THREE.ExtrudeGeometry(ep, { depth: 0.022, bevelEnabled: false }); epg.translate(0, 0, s * 0.5 - 0.011); add(epg, carbon);
    // wishbones
    if (!lite) for (const [ax, wz, wy] of [[SPEC.a, 0.8, 0.4], [SPEC.a, 0.8, 0.26], [-SPEC.b, 0.76, 0.42], [-SPEC.b, 0.76, 0.26]]) {
      const len = wz - 0.32, arm = add(new THREE.CylinderGeometry(0.018, 0.018, len, 6), carbon, ax, wy, s * (0.32 + len / 2)); arm.rotation.x = Math.PI / 2;
    }
  }
  // front wing: main plane + two flaps
  add(new THREE.BoxGeometry(0.42, 0.025, 1.92), carbon, 2.78, 0.1, 0);
  const f1 = add(new THREE.BoxGeometry(0.26, 0.02, 1.86), accent, 2.62, 0.155, 0); f1.rotation.z = -0.18;
  const f2 = add(new THREE.BoxGeometry(0.18, 0.018, 1.8), white, 2.5, 0.215, 0); f2.rotation.z = -0.35;
  for (const s of [-1, 1]) D(new THREE.BoxGeometry(0.3, 0.12, 0.02), carbon, 2.7, 0.16, s * 0.12);
  // rear wing, beam wing, diffuser
  add(new THREE.BoxGeometry(0.4, 0.04, 1.0), accent, -2.4, 0.88, 0);
  const flap = new THREE.Group(); flap.position.set(-2.16, 0.99, 0); body.add(flap);
  add(new THREE.BoxGeometry(0.26, 0.03, 0.98), white, -0.12, 0, 0, flap);
  D(new THREE.BoxGeometry(0.24, 0.025, 0.86), carbon, -2.3, 0.5, 0);
  if (!lite) add(new THREE.BoxGeometry(0.08, 0.5, 0.04), carbon, -2.25, 0.66, 0).rotation.z = 0.35;
  const dif = add(new THREE.BoxGeometry(0.5, 0.025, 1.05), carbon, -2.15, 0.18, 0); dif.rotation.z = 0.28;
  for (let i = -2; i <= 2; i++) D(new THREE.BoxGeometry(0.46, 0.12, 0.012), carbon, -2.14, 0.22, i * 0.22);
  // halo
  const halo = new THREE.CatmullRomCurve3([[-0.08, 0.58, -0.34], [-0.02, 0.84, -0.31], [0.3, 0.9, -0.26], [0.55, 0.88, 0], [0.3, 0.9, 0.26], [-0.02, 0.84, 0.31], [-0.08, 0.58, 0.34]].map(p => new THREE.Vector3(...p)));
  add(new THREE.TubeGeometry(halo, 40, 0.026, 8, false), satin);
  D(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0.78, 0.58, 0), new THREE.Vector3(0.66, 0.78, 0), new THREE.Vector3(0.55, 0.88, 0)]), 10, 0.022, 8, false), satin);
  // T-camera and rain light
  D(new THREE.BoxGeometry(0.1, 0.05, 0.08), white, -0.05, 1.0, 0);
  const light = add(new THREE.BoxGeometry(0.04, 0.08, 0.14), ghost ? ghostM : new THREE.MeshBasicMaterial({ color: 0xff2020 }), -2.62, 0.33, 0);
  // wheels: lathed tyre profile, rim, aero cover and compound band
  const wheels = [];
  for (const [x, w] of [[SPEC.a, 0.37], [-SPEC.b, 0.44]]) for (const s of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.position.set(x, SPEC.rw, s * (1.0 - w / 2)); root.add(pivot);
    const spin = new THREE.Group(); pivot.add(spin);
    const R = SPEC.rw, prof = [[0.23, -w / 2], [0.32, -w / 2], [R - 0.008, -w / 2 + 0.03], [R, -w / 2 + 0.08], [R, w / 2 - 0.08], [R - 0.008, w / 2 - 0.03], [0.32, w / 2], [0.23, w / 2]].map(([r, y]) => new THREE.Vector2(r, y));
    const tg = new THREE.LatheGeometry(prof, lite ? 18 : 36); tg.rotateX(Math.PI / 2); add(tg, tyreM, 0, 0, 0, spin);
    const rim = new THREE.CylinderGeometry(0.235, 0.235, w - 0.03, 24, 1, true); rim.rotateX(Math.PI / 2); add(rim, rimM, 0, 0, 0, spin);
    const cover = new THREE.CircleGeometry(0.235, 24); const cv = add(cover, carbon, 0, 0, s * (w / 2 - 0.01), spin); cv.rotation.y = s > 0 ? 0 : Math.PI;
    D(new THREE.TorusGeometry(0.29, 0.012, 4, 36), soft, 0, 0, s * (w / 2 + 0.001), spin);
    const mark = D(new THREE.BoxGeometry(0.2, 0.04, 0.005), white, 0.12, 0, s * (w / 2 - 0.005), spin);
    wheels.push({ pivot, spin, front: x > 0, mark });
  }
  if (ghost) root.traverse(o => { o.castShadow = false; });
  return { root, body, wheels, flap, light };
}

/* ================= Car state & physics ================= */
const setup = { mode: 'solo', laps: 3, aiCount: 5, aiSkill: 0.45, map: 'terrain', width: 14, banking: true, walls: false, steerSens: 0.8, assist: true, steerMode: 'drag', autogas: false, quality: 'auto', aero: 0.5, bias: 57, tc: true, abs: true, auto: true, color: '#d7263d', reverse: false };
const aeroOf = a => ({ CdA: 1.10 + a * 0.65, ClA: 2.9 + a * 2.2, front: 0.42 });
const car = {};
let carModel = buildCar(setup.color, false); scene.add(carModel.root);
let ghostModel = buildCar(0xffffff, true); scene.add(ghostModel.root); ghostModel.root.visible = false;
const nrm = new THREE.Vector3(), fp = new THREE.Vector3(), lp = new THREE.Vector3();
const AMBIENT = 28; // °C track-side air

function powerCurve(rpm) {
  const T = [[4000, .32], [6000, .5], [8000, .7], [9500, .84], [10500, .93], [11500, 1], [12200, 1], [13500, .95], [15000, .86]];
  if (rpm <= T[0][0]) return T[0][1];
  for (let i = 1; i < T.length; i++) if (rpm <= T[i][0]) { const [r0, p0] = T[i - 1], [r1, p1] = T[i]; return p0 + (p1 - p0) * (rpm - r0) / (r1 - r0); }
  return T[T.length - 1][1];
}
const MF = (al, B) => { const x = B * al; return Math.sin(1.9 * Math.atan(x - 0.97 * (x - Math.atan(x)))); };
const loadSens = r => clamp(1 - 0.06 * (r - 1), 0.8, 1.04);
const tyreGrip = T => clamp(1 - 0.000045 * (T - 100) * (T - 100), 0.74, 1); // slicks work best near 100 °C

function trackLocate(x, z, hint) {
  const n = W.n; let best = hint, bd = Infinity;
  for (let o = -40; o <= 40; o++) { const k = (hint + o + n) % n, dx = x - W.x[k], dz = z - W.z[k], d = dx * dx + dz * dz; if (d < bd) { bd = d; best = k; } }
  if (bd > 60 * 60) for (let k = 0; k < n; k++) { const dx = x - W.x[k], dz = z - W.z[k], d = dx * dx + dz * dz; if (d < bd) { bd = d; best = k; } }
  return { k: best, lat: (x - W.x[best]) * W.lx[best] + (z - W.z[best]) * W.lz[best] };
}
function placeCar(k, lat = 0, keepTyres = false) {
  const n = W.n; k = (k + n) % n;
  const tf = keepTyres ? car.tf : 80, trr = keepTyres ? car.tr : 80;
  Object.assign(car, {
    x: W.x[k] + W.lx[k] * lat, z: W.z[k] + W.lz[k] * lat, psi: Math.atan2(-W.lx[k], -W.lz[k]), vx: 0, vy: 0, r: 0, delta: 0, steerUser: 0,
    gear: 1, rpm: SPEC.idle, shiftT: 0, k, lat, axs: 0, ays: 0, fzc: 0, wheelRot: 0, drs: false, revT: 0,
    thr: 0, brk: 0, aF: 0, aR: 0, Fzf: 0, Fzr: 0, down: 0, drag: 0, rho: 1.2, surf: 0, spin: false, lockF: false, tcAct: false, grade: 0, bankV: 0,
    tf, tr: trr, hit: 0,
  });
  car.y = Hq(car.x, car.z);
}

function physicsStep(dt, inp) {
  const c = car, sp = SPEC, ae = aeroOf(setup.aero);
  const loc = trackLocate(c.x, c.z, c.k); c.k = loc.k; c.lat = loc.lat;
  const hw = setup.width / 2, al = Math.abs(loc.lat);
  const gs = W.grav[loc.k];
  const surf = al < hw ? 0 : (al < hw + 1.5 && W.kerb[loc.k]) ? 1 : (gs && Math.sign(loc.lat) === gs && al < hw + 17) ? 3 : 2; c.surf = surf;
  const off = surf === 2 && W.city; // city run-off is pavement, not grass
  const mu0 = [1.8, 1.5, off ? 1.05 : 0.85, 0.6][surf], crr = [0.012, 0.02, off ? 0.02 : 0.06, 0.18][surf];
  const h = Hq(c.x, c.z); c.y = h; normalAt(c.x, c.z, nrm);
  const cp = Math.cos(c.psi), sn = Math.sin(c.psi);
  fp.set(cp, 0, -sn); fp.addScaledVector(nrm, -fp.dot(nrm)).normalize();
  lp.crossVectors(nrm, fp);
  const gtx = G * nrm.y * nrm.x, gty = -G + G * nrm.y * nrm.y, gtz = G * nrm.y * nrm.z;
  const gLong = gtx * fp.x + gty * fp.y + gtz * fp.z, gLat = gtx * lp.x + gty * lp.y + gtz * lp.z;
  c.grade = fp.y / Math.max(0.2, Math.hypot(fp.x, fp.z)); c.bankV = lp.y;
  const rho = 1.225 * Math.exp(-(W.base + h) / 8434); c.rho = rho;
  const v2 = c.vx * c.vx + c.vy * c.vy, spd = Math.sqrt(v2);
  const q = 0.5 * rho * v2, down = q * ae.ClA * (c.drs ? 0.84 : 1), drag = q * ae.CdA * (c.drs ? 0.80 : 1); c.down = down; c.drag = drag;
  // vertical curvature along heading: crests unload, compressions load the tyres
  const dd = 5, hA = Hq(c.x + cp * dd, c.z - sn * dd), hB = Hq(c.x - cp * dd, c.z + sn * dd);
  c.fzc += (sp.m * c.vx * c.vx * (hA - 2 * h + hB) / (dd * dd) - c.fzc) * Math.min(1, dt / 0.06);
  const Wn = Math.max(0, sp.m * G * nrm.y + c.fzc), tr = sp.m * c.axs * sp.h / sp.L;
  const Fzf = Math.max(0, Wn * sp.b / sp.L + down * ae.front - tr), Fzr = Math.max(0, Wn * sp.a / sp.L + down * (1 - ae.front) + tr);
  const fz0f = sp.m * G * sp.b / sp.L, fz0r = sp.m * G * sp.a / sp.L;
  const muF = mu0 * loadSens(Fzf / fz0f) * tyreGrip(c.tf), muR = mu0 * loadSens(Fzr / fz0r) * tyreGrip(c.tr);
  c.Fzf = Fzf; c.Fzr = Fzr;
  const cd = Math.cos(c.delta), sd = Math.sin(c.delta);
  const vyf = c.vy + sp.a * c.r, vyr = c.vy - sp.b * c.r;
  const vlonF = cd * c.vx + sd * vyf, vlatF = -sd * c.vx + cd * vyf;
  const aF = Math.atan(vlatF / Math.max(Math.abs(vlonF), 3)), aR = Math.atan(vyr / Math.max(Math.abs(c.vx), 3));
  c.aF = aF; c.aR = aR;
  // powertrain
  const rev = c.gear === -1, thr = rev ? inp.brk : inp.thr, brk = rev ? inp.thr : inp.brk;
  c.thr = thr; c.brk = brk;
  const ratio = rev ? sp.rev : sp.ratios[c.gear - 1];
  let rpm = Math.abs(c.vx) / sp.rw * 60 / (2 * Math.PI) * Math.abs(ratio);
  const launch = (c.gear === 1 || rev) ? SPEC.idle + 5200 * thr : SPEC.idle;
  if (rpm < launch) rpm = launch;
  c.rpm += (rpm - c.rpm) * Math.min(1, dt * 25);
  if (c.shiftT > 0) c.shiftT -= dt;
  let Fdrive = 0;
  if (c.rpm < sp.limiter && c.shiftT <= 0 && thr > 0) {
    const P = sp.Pmax * powerCurve(c.rpm) * Math.pow(rho / 1.225, 0.25) * (rev ? 0.25 : 1), w = c.rpm * 2 * Math.PI / 60;
    Fdrive = thr * (P / w) * ratio * sp.eta / sp.rw;
  }
  const sv = Math.abs(c.vx) > 0.25 ? Math.sign(c.vx) : 0;
  const engBrake = -sv * (1 - thr) * 1800 * (c.rpm / 15000);
  let bF = brk * sp.maxBrake * setup.bias / 100, bR = brk * sp.maxBrake * (1 - setup.bias / 100);
  const capF = muF * Fzf, capR = muR * Fzr;
  let lockF = false, spin = false; c.tcAct = false;
  if (setup.abs) { bF = Math.min(bF, capF * 0.96); bR = Math.min(bR, Math.max(0, capR * 0.96 - Math.abs(engBrake))); }
  else if (bF > capF && sv) { lockF = true; bF = capF * 0.8; }
  const FxF = -sv * bF;
  let FxR = Fdrive - sv * bR + engBrake;
  if (Math.abs(FxR) > capR) {
    if (Fdrive !== 0 && Math.sign(FxR) === Math.sign(Fdrive) && setup.tc) { FxR = Math.sign(FxR) * capR * 0.98; c.tcAct = true; }
    else if (spd > 0.5 || Fdrive !== 0) { FxR = Math.sign(FxR) * capR * 0.85; spin = true; }
  }
  c.spin = spin; c.lockF = lockF;
  let FyF = -muF * Fzf * MF(aF, 11), FyR = -muR * Fzr * MF(aR, 12);
  const latF = Math.sqrt(Math.max(0, capF * capF - FxF * FxF)) * (lockF ? 0.3 : 1);
  const latR = Math.sqrt(Math.max(0, capR * capR - FxR * FxR)) * (spin ? 0.35 : 1);
  FyF = clamp(FyF, -latF, latF); FyR = clamp(FyR, -latR, latR);
  // tyre temperature: sliding power heats the rubber, airflow cools it (≈30 kJ/K per axle pair)
  const pF = Math.abs(FyF) * spd * Math.abs(Math.sin(aF)) + Math.abs(FxF) * (lockF ? spd : 0.03 * spd);
  const pR = Math.abs(FyR) * spd * Math.abs(Math.sin(aR)) + Math.abs(FxR) * (spin ? 5 + 0.2 * spd : c.tcAct ? 2.5 : 0.025 * spd);
  const cool = 0.0075 * (1 + spd / 25);
  c.tf += (pF / 30000 - cool * (c.tf - AMBIENT)) * dt; c.tr += (pR / 30000 - cool * (c.tr - AMBIENT)) * dt;
  // resistances
  const Froll = sv * crr * (Fzf + Fzr);
  const Fdx = spd > 0.01 ? -drag * c.vx / spd : 0, Fdy = spd > 0.01 ? -drag * c.vy / spd : 0;
  const grass = surf === 2 && !off ? 0.045 * sp.m : surf === 3 ? 0.2 * sp.m : 0;
  const Fx = FxR + FxF * cd - FyF * sd + Fdx - Froll - grass * c.vx + sp.m * gLong;
  const Fy = FyR + FxF * sd + FyF * cd + Fdy - grass * c.vy + sp.m * gLat;
  const Mz = sp.a * (FxF * sd + FyF * cd) - sp.b * FyR;
  c.vx += (Fx / sp.m + c.vy * c.r) * dt;
  c.vy += (Fy / sp.m - c.vx * c.r) * dt;
  c.r += Mz / sp.Iz * dt;
  if (spd < 4) { const k = 1 - spd / 4; c.r += (c.vx * Math.tan(c.delta) / sp.L - c.r) * k * Math.min(1, dt * 12); c.vy *= 1 - k * Math.min(1, dt * 8); }
  if (brk > 0.05 && Math.abs(c.vx) < 0.3 && Fdrive === 0) { c.vx *= 0.8; c.vy *= 0.8; c.r *= 0.8; }
  c.axs += ((Fx - sp.m * gLong) / sp.m - c.axs) * Math.min(1, dt * 20);
  c.ays += ((Fy - sp.m * gLat) / sp.m - c.ays) * Math.min(1, dt * 20);
  c.psi += c.r * dt;
  const dx = (c.vx * fp.x + c.vy * lp.x) * dt, dz = (c.vx * fp.z + c.vy * lp.z) * dt;
  c.x += dx; c.z += dz;
  // barrier contact: reflect the velocity component into the wall, scrub speed
  const lat = loc.lat + dx * W.lx[loc.k] + dz * W.lz[loc.k], lim = (lat > 0 ? W.wallL[loc.k] : W.wallR[loc.k]) - 1.0;
  if (Math.abs(lat) > lim) {
    const s = Math.sign(lat), Lx = W.lx[loc.k], Lz = W.lz[loc.k];
    c.x -= Lx * (Math.abs(lat) - lim) * s; c.z -= Lz * (Math.abs(lat) - lim) * s;
    let Vx = c.vx * fp.x + c.vy * lp.x, Vz = c.vx * fp.z + c.vy * lp.z;
    const vn = Vx * Lx + Vz * Lz;
    if (vn * s > 0) { // glancing contact: kill the inward speed, keep most of the speed along the wall, turn the nose back to the track
      Vx -= 1.12 * vn * Lx; Vz -= 1.12 * vn * Lz;
      const scrub = 1 - Math.min(0.22, 0.015 * Math.abs(vn)); Vx *= scrub; Vz *= scrub;
      const tf = Math.atan2(-W.lx[loc.k], -W.lz[loc.k]);
      let dpsi = tf - c.psi; dpsi = Math.atan2(Math.sin(dpsi), Math.cos(dpsi)); if (Math.abs(dpsi) < Math.PI / 2) c.psi += dpsi * 0.35;
      const cp2 = Math.cos(c.psi), sn2 = Math.sin(c.psi), fx2 = cp2, fz2 = -sn2, lx2 = -sn2, lz2 = -cp2;
      c.vx = Vx * fx2 + Vz * fz2; c.vy = Vx * lx2 + Vz * lz2; c.r *= 0.3;
      c.hit = Math.max(c.hit, Math.abs(vn));
    }
  }
  const limE = W.sx / 2 - 4, limZ = W.sz / 2 - 4;
  if (Math.abs(c.x) > limE || Math.abs(c.z) > limZ) { c.x = clamp(c.x, -limE, limE); c.z = clamp(c.z, -limZ, limZ); c.vx *= 0.3; c.vy = 0; c.r = 0; }
  c.wheelRot += c.vx / sp.rw * dt;
}

function gearLogic(dt, inp) {
  const c = car, sp = SPEC, spd = Math.hypot(c.vx, c.vy);
  if (c.gear >= 1 && spd < 0.6 && inp.brk > 0.5 && inp.thr < 0.05) { c.revT += dt; if (c.revT > 0.6) { c.gear = -1; c.revT = 0; } } else if (c.gear >= 1) c.revT = 0;
  if (c.gear === -1 && inp.thr > 0.3 && c.vx > -0.6) c.gear = 1;
  if (c.gear < 1) return;
  if (setup.auto && c.shiftT <= 0) {
    if (c.gear < 8 && c.rpm > sp.upAt) { c.gear++; c.shiftT = 0.05; }
    else if (c.gear > 1 && c.rpm * sp.ratios[c.gear - 2] / sp.ratios[c.gear - 1] < 11000 && c.rpm < 10500) { c.gear--; c.shiftT = 0.04; }
  }
}
function shift(d) {
  const c = car; if (c.gear === -1) { if (d > 0) c.gear = 1; return; }
  const g = clamp(c.gear + d, 1, 8);
  if (d < 0 && c.rpm * SPEC.ratios[g - 1] / SPEC.ratios[c.gear - 1] > SPEC.limiter) return;
  if (g !== c.gear) { c.gear = g; c.shiftT = 0.05; }
}

/* ================= Input ================= */
const keys = {}, touch = { l: 0, r: 0, gas: 0, brake: 0, steer: 0, sActive: false }, inp = { thr: 0, brk: 0, steer: 0 };
let drsReq = false; const padPrev = {};
addEventListener('keydown', e => {
  if (!$('#setup').hidden || !$('#pause').hidden) { if (e.code === 'Escape' && state.mode !== 'menu0') resume(); return; }
  keys[e.code] = true;
  if (e.code === 'Space') { drsReq = true; e.preventDefault(); }
  if (e.code === 'KeyE') shift(1);
  if (e.code === 'KeyQ') shift(-1);
  if (e.code === 'KeyC') camMode = (camMode + 1) % 3;
  if (e.code === 'KeyR') resetToTrack();
  if (e.code === 'KeyM') { muted = !muted; banner(muted ? '音效關閉' : '音效開啟', 'info'); }
  if (e.code === 'Escape') openMenu();
  if (e.code.startsWith('Arrow')) e.preventDefault();
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
function readInput(dt) {
  let tK = (keys.ArrowUp || keys.KeyW || touch.gas) ? 1 : 0, bK = (keys.ArrowDown || keys.KeyS || touch.brake) ? 1 : 0;
  let sK = ((keys.ArrowLeft || keys.KeyA || touch.l) ? 1 : 0) - ((keys.ArrowRight || keys.KeyD || touch.r) ? 1 : 0);
  let analog = false;
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const p of pads) {
    if (!p) continue;
    const ax = p.axes[0] || 0, rt = p.buttons[7] ? p.buttons[7].value : 0, lt = p.buttons[6] ? p.buttons[6].value : 0;
    if (Math.abs(ax) > 0.08 || rt > 0.05 || lt > 0.05) { analog = true; sK = -Math.sign(ax) * Math.pow(Math.max(0, Math.abs(ax) - 0.08) / 0.92, 1.4); tK = Math.max(tK, rt); bK = Math.max(bK, lt); }
    const pr = i => p.buttons[i] && p.buttons[i].pressed, was = i => padPrev[p.index + ':' + i];
    for (const i of [0, 1, 2, 3, 4, 5, 9]) { const now = pr(i); if (now && !was(i)) { if (i === 5 || i === 1) shift(1); if (i === 4 || i === 2) shift(-1); if (i === 0) drsReq = true; if (i === 3) camMode = (camMode + 1) % 3; if (i === 9) openMenu(); } padPrev[p.index + ':' + i] = now; }
  }
  if (touch.sActive) { const a = Math.abs(touch.steer); sK = Math.sign(touch.steer) * Math.pow(Math.max(0, a - 0.04) / 0.96, 1.25); }
  if (setup.autogas && car.gear !== -1 && state.mode === 'race') tK = bK > 0 ? 0 : 1;
  if (RACE.done) { tK = 0; bK = 0.35; sK = 0; }
  if (analog) { inp.thr = tK; inp.brk = bK; }
  else { inp.thr += clamp(tK - inp.thr, -8 * dt, 5 * dt); inp.brk += clamp(bK - inp.brk, -10 * dt, 8 * dt); }
  inp.steer = sK;
  // full lock is limited to what the tyres can use at this speed: Ackermann angle for the available lateral grip plus a small slip margin
  const spd = Math.hypot(car.vx, car.vy), aAvail = 1.7 * G * (1 + (car.down || 0) / (SPEC.m * G));
  const vmax = Math.min(0.3, SPEC.L * aAvail / Math.max(spd * spd, 1) + 0.02) * setup.steerSens;
  const target = inp.steer * vmax, away = Math.abs(target) < Math.abs(car.steerUser) || target * car.steerUser < 0;
  const rate = vmax / (analog || touch.sActive ? 0.08 : away ? 0.15 : 0.4); // keys build lock over 0.4 s, release in 0.15 s
  car.steerUser += clamp(target - car.steerUser, -rate * dt, rate * dt);
  // steering assist: counter-steer into a rear slide, the way a driver catches oversteer
  const assist = setup.assist && spd > 8 ? clamp(0.9 * car.aR, -0.12, 0.12) : 0;
  car.delta = clamp(car.steerUser + assist, -0.34, 0.34);
}
function bindTouch(id, key) {
  const el = $(id);
  const on = e => { e.preventDefault(); el.setPointerCapture && el.setPointerCapture(e.pointerId); touch[key] = 1; el.classList.add('held'); };
  const off = () => { touch[key] = 0; el.classList.remove('held'); };
  el.addEventListener('pointerdown', on); el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off); el.addEventListener('lostpointercapture', off);
}
bindTouch('#tLeft', 'l'); bindTouch('#tRight', 'r'); bindTouch('#tGas', 'gas'); bindTouch('#tBrake', 'brake');
$('#tDrs').addEventListener('pointerdown', e => { e.preventDefault(); drsReq = true; });
$('#tUp').addEventListener('pointerdown', e => { e.preventDefault(); shift(1); });
$('#tDown').addEventListener('pointerdown', e => { e.preventDefault(); shift(-1); });
{ // steering pad: the rail appears under the thumb, horizontal travel of ±70 px maps to full lock
  const zone = $('#steerZone'), rail = $('#steerRail'), knob = $('#steerKnob'), RANGE = 70; let id = null, x0 = 0;
  zone.addEventListener('pointerdown', e => {
    if (id !== null) return; e.preventDefault(); id = e.pointerId; zone.setPointerCapture && zone.setPointerCapture(id);
    const r = zone.getBoundingClientRect(); x0 = e.clientX; rail.style.left = (e.clientX - r.left) + 'px'; rail.style.top = (e.clientY - r.top) + 'px';
    zone.classList.add('active', 'used'); touch.sActive = true; touch.steer = 0; knob.style.transform = '';
  });
  zone.addEventListener('pointermove', e => { if (e.pointerId !== id) return; const dx = clamp(e.clientX - x0, -RANGE, RANGE); touch.steer = -dx / RANGE; knob.style.transform = `translateX(${dx}px)`; });
  const end = e => { if (e.pointerId !== id) return; id = null; touch.sActive = false; touch.steer = 0; knob.style.transform = ''; zone.classList.remove('active'); rail.style.left = rail.style.top = ''; };
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => zone.addEventListener(ev, end));
}
['#touch', '#view'].forEach(sel => $(sel).addEventListener('contextmenu', e => e.preventDefault()));
$('#touchOn').checked = COARSE;
function applyControls() {
  const showTouch = $('#touchOn').checked;
  $('#touch').hidden = !showTouch; document.body.classList.toggle('touch', showTouch);
  $('#steerZone').hidden = setup.steerMode !== 'drag'; $('#steerBtns').hidden = setup.steerMode !== 'buttons';
  $('#shiftBtns').hidden = setup.auto;
  document.body.classList.toggle('autogas', setup.autogas);
  document.querySelectorAll('#steerMode button').forEach(b => b.classList.toggle('sel', b.dataset.s === setup.steerMode));
}

/* ================= Race state ================= */
const state = { mode: 'menu0', t: 0, lightsT: 0, lap: 0, lapStart: 0, valid: true, best: Infinity, last: NaN, secBest: [Infinity, Infinity, Infinity], secLast: [NaN, NaN, NaN], secCur: [NaN, NaN, NaN], secIdx: 0, secStart: 0, lastK: 0, ghostRec: [], ghostBest: null, bestTimes: null, curTimes: null };
function resetRace() {
  Object.assign(state, { lap: 0, valid: true, best: Infinity, last: NaN, secBest: [Infinity, Infinity, Infinity], secLast: [NaN, NaN, NaN], secCur: [NaN, NaN, NaN], secIdx: 0, ghostRec: [], ghostBest: null, bestTimes: null, curTimes: new Float32Array(W.n).fill(-1) });
  ghostModel.root.visible = false;
  for (let i = 0; i < 3; i++) { const el = $('#s' + i); el.className = 'sec'; el.querySelector('span').textContent = '–'; }
}
function startLap() {
  state.lap++; state.lapStart = state.t; state.valid = true; state.secIdx = 0; state.secStart = state.t; state.secCur = [NaN, NaN, NaN];
  state.ghostRec = []; state.curTimes = new Float32Array(W.n).fill(-1);
}
function resetToTrack() {
  if (state.mode !== 'race') return;
  const loc = trackLocate(car.x, car.z, car.k); placeCar(loc.k, 0, true); banner('回到賽道', 'info');
}
function raceUpdate() {
  const n = W.n, k = car.k, lk = state.lastK, t = state.t - state.lapStart, fwd = (k - lk + n) % n;
  if (fwd > 0 && fwd < n / 2) {
    if (k < lk) finishLap();
    else {
      const s1 = Math.floor(n / 3), s2 = Math.floor(2 * n / 3);
      if (state.secIdx === 0 && lk < s1 && k >= s1) sectorDone(0);
      else if (state.secIdx === 1 && lk < s2 && k >= s2) sectorDone(1);
      for (let j = lk + 1; j <= k; j++) if (state.curTimes[j] < 0) state.curTimes[j] = t;
    }
  }
  if (car.hit > 14) banner('擦撞護欄', 'info');
  car.hit = 0;
  state.lastK = k;
}
function sectorDone(i) { const st = state.t - state.secStart; state.secCur[i] = st; state.secStart = state.t; state.secIdx = i + 1; paintSector(i, st); }
function paintSector(i, st) {
  const el = $('#s' + i); el.className = 'sec';
  el.classList.add(st < state.secBest[i] ? 'purple' : st < state.secLast[i] ? 'green' : 'yellow'); el.querySelector('span').textContent = st.toFixed(3);
}
function finishLap() {
  const lt = state.t - state.lapStart, completed = state.lap;
  if (state.lap > 0 && state.secIdx === 2) {
    sectorDone(2); state.last = lt;
    if (state.valid) {
      for (let i = 0; i < 3; i++) state.secBest[i] = Math.min(state.secBest[i], state.secCur[i]);
      if (lt < state.best) { state.best = lt; state.ghostBest = state.ghostRec; state.bestTimes = state.curTimes; banner('最快圈 ' + fmt(lt), 'good'); }
      else banner('圈速 ' + fmt(lt), 'info');
    } else banner('圈速 ' + fmt(lt) + ' · 無效', 'bad');
    state.secLast = state.secCur.slice();
  }
  startLap();
  if (RACE.on && completed >= 1) {
    if (completed === setup.laps - 1 && !RACE.done) banner('最後一圈', 'info');
    if (completed >= setup.laps && !RACE.done) playerFinished();
  }
  setTimeout(() => { if (state.secIdx === 0) for (let i = 0; i < 3; i++) { const el = $('#s' + i); el.className = 'sec'; el.querySelector('span').textContent = '–'; } }, 2500);
}
function recordGhost() {
  const t = state.t - state.lapStart, r = state.ghostRec;
  if (!r.length || t - r[r.length - 1][0] >= 0.05) { const q = carModel.root.quaternion, p = carModel.root.position; r.push([t, p.x, p.y, p.z, q.x, q.y, q.z, q.w]); }
}
const gA = new THREE.Quaternion(), gB = new THREE.Quaternion();
function showGhost() {
  const g = state.ghostBest; if (!g || g.length < 2 || state.mode !== 'race') { ghostModel.root.visible = false; return; }
  const t = state.t - state.lapStart; let i = Math.min(g.length - 2, Math.floor(t / 0.05));
  while (i > 0 && g[i][0] > t) i--; while (i < g.length - 2 && g[i + 1][0] < t) i++;
  const a = g[i], b = g[i + 1], f = clamp((t - a[0]) / (b[0] - a[0]), 0, 1);
  ghostModel.root.visible = t < g[g.length - 1][0];
  ghostModel.root.position.set(a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f);
  gA.set(a[4], a[5], a[6], a[7]); gB.set(b[4], b[5], b[6], b[7]); ghostModel.root.quaternion.copy(gA).slerp(gB, f);
}
let bannerT = 0;
function banner(txt, kind) { const b = $('#banner'); b.textContent = txt; b.className = 'hud show ' + kind; bannerT = 2.2; }

/* ================= Visuals ================= */
let camMode = 0;
const m4 = new THREE.Matrix4(), rt = new THREE.Vector3(), camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), camFwd = new THREE.Vector3(1, 0, 0), tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
let camInit = false, shake = 0;
function updateCarVisual() {
  const c = car, mdl = carModel;
  c.y = Hq(c.x, c.z); normalAt(c.x, c.z, nrm);
  const cp = Math.cos(c.psi), sn = Math.sin(c.psi);
  fp.set(cp, 0, -sn); fp.addScaledVector(nrm, -fp.dot(nrm)).normalize(); rt.crossVectors(fp, nrm);
  m4.makeBasis(fp, nrm, rt); mdl.root.quaternion.setFromRotationMatrix(m4); mdl.root.position.set(c.x, c.y, c.z);
  mdl.body.rotation.set(clamp(c.ays * 0.0005, -0.03, 0.03), 0, clamp(c.axs * 0.0006, -0.035, 0.02));
  for (const w of mdl.wheels) { w.spin.rotation.z = -c.wheelRot; if (w.front) w.pivot.rotation.y = c.delta; if (w.mark) w.mark.visible = Math.abs(c.vx) < 14; }
  mdl.flap.rotation.z = c.drs ? 0.55 : 0;
  mdl.light.visible = c.brk > 0.1;
  // keep the shadow camera centred on the car
  const sx = c.x + fp.x * 28, sz = c.z + fp.z * 28; sun.target.position.set(sx, c.y, sz); sun.position.set(sx + SUN_DIR.x * 300, c.y + SUN_DIR.y * 300, sz + SUN_DIR.z * 300);
}
function updateCamera(dt) {
  const c = car, root = carModel.root;
  const fwd = tmp.set(1, 0, 0).applyQuaternion(root.quaternion), up = tmp2.set(0, 1, 0).applyQuaternion(root.quaternion);
  const spd = Math.hypot(c.vx, c.vy);
  if (camMode === 0) {
    if (!camInit) camFwd.copy(fwd); else camFwd.lerp(fwd, 1 - Math.exp(-dt * 6)).normalize();
    const want = new THREE.Vector3().copy(root.position).addScaledVector(camFwd, -7.2); want.y += 2.5;
    const gh = Hq(want.x, want.z) + 1.2; if (want.y < gh) want.y = gh;
    if (!camInit) camPos.copy(want); else camPos.lerp(want, 1 - Math.exp(-dt * 12));
    camLook.copy(root.position).addScaledVector(camFwd, 4); camLook.y += 0.9;
  } else {
    const local = camMode === 1 ? [-0.05, 1.12, 0] : [0.12, 0.9, 0], ahead = camMode === 1 ? [10, 0.85, 0] : [10, 0.75, 0];
    camPos.set(...local).applyQuaternion(root.quaternion).add(root.position);
    camLook.set(...ahead).applyQuaternion(root.quaternion).add(root.position);
  }
  camInit = true;
  camera.position.copy(camPos);
  if (shake > 0) camera.position.add(new THREE.Vector3((Math.random() - .5) * shake, (Math.random() - .5) * shake, (Math.random() - .5) * shake));
  camera.up.copy(camMode === 0 ? UP : up);
  camera.lookAt(camLook);
  const fov = (camMode === 2 ? 74 : 62) + clamp(spd / 90, 0, 1) * 10;
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = fov; camera.updateProjectionMatrix(); }
}

/* ================= HUD ================= */
const leds = $('#leds'); for (let i = 0; i < 15; i++) leds.appendChild(document.createElement('i'));
const ledEls = [...leds.children];
const mm = $('#minimap'), pf = $('#profile'), gm = $('#gmeter');
const dpr = Math.min(2, window.devicePixelRatio || 1);
gm.width = 116 * dpr; gm.height = 116 * dpr;
let mmBase = null, mmT = null;
function drawMinimapBase() {
  const w = 170 * dpr, h = 170 * dpr; mm.width = w; mm.height = h;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let k = 0; k < W.n; k++) { x0 = Math.min(x0, W.x[k]); x1 = Math.max(x1, W.x[k]); z0 = Math.min(z0, W.z[k]); z1 = Math.max(z1, W.z[k]); }
  const pad = 10 * dpr, s = Math.min((w - 2 * pad) / (x1 - x0 || 1), (h - 2 * pad) / (z1 - z0 || 1)), ox = (w - (x1 - x0) * s) / 2, oz = (h - (z1 - z0) * s) / 2;
  mmT = (x, z) => [ox + (x - x0) * s, oz + (z - z0) * s];
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g = cv.getContext('2d');
  const path = (filter, col, lw) => { g.strokeStyle = col; g.lineWidth = lw; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); let pen = false; for (let k = 0; k <= W.n; k++) { const kk = k % W.n; if (filter && !filter(kk)) { pen = false; continue; } const [px, pz] = mmT(W.x[kk], W.z[kk]); if (!pen) { g.moveTo(px, pz); pen = true; } else g.lineTo(px, pz); } g.stroke(); };
  path(null, 'rgba(0,0,0,.6)', 7 * dpr); path(null, '#d9dee6', 3.2 * dpr); path(k => W.drs[k], '#25d26a', 3.2 * dpr);
  const [sx, sz] = mmT(W.x[0], W.z[0]); g.fillStyle = '#fff'; g.save(); g.translate(sx, sz); g.rotate(Math.atan2(W.lz[0], W.lx[0])); g.fillRect(-6 * dpr, -1.5 * dpr, 12 * dpr, 3 * dpr); g.restore();
  mmBase = cv;
  pf.width = 170 * dpr; pf.height = 44 * dpr;
  let lo = Infinity, hi = -Infinity; for (const v of W.h) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  W.pLo = lo; W.pHi = hi;
  $('#elevRange').textContent = `${Math.round(W.base + lo)}–${Math.round(W.base + hi)} m`;
}
function drawMinimap() {
  if (!mmBase) return; const g = mm.getContext('2d'); g.clearRect(0, 0, mm.width, mm.height); g.drawImage(mmBase, 0, 0);
  if (ghostModel.root.visible) { const [gx, gz] = mmT(ghostModel.root.position.x, ghostModel.root.position.z); g.fillStyle = '#9fe0ff'; g.beginPath(); g.arc(gx, gz, 3.5 * dpr, 0, 7); g.fill(); }
  const [cx, cz] = mmT(car.x, car.z); g.fillStyle = '#57c4ff'; g.strokeStyle = '#04131d'; g.lineWidth = 2 * dpr; g.beginPath(); g.arc(cx, cz, 5 * dpr, 0, 7); g.fill(); g.stroke();
  const p = pf.getContext('2d'), w = pf.width, h = pf.height, lo = W.pLo, span = Math.max(4, W.pHi - lo), n = W.n;
  p.clearRect(0, 0, w, h); p.beginPath(); p.moveTo(0, h);
  for (let i = 0; i <= w; i += 2) { const k = Math.floor(i / w * (n - 1)); p.lineTo(i, h - 3 - (W.h[k] - lo) / span * (h - 8)); }
  p.lineTo(w, h); p.closePath(); p.fillStyle = 'rgba(87,196,255,.18)'; p.fill(); p.strokeStyle = 'rgba(87,196,255,.8)'; p.lineWidth = 1.5 * dpr; p.stroke();
  p.fillStyle = '#e9edf3'; p.fillRect(car.k / n * w - dpr, 0, 2 * dpr, h);
}
function drawG() {
  const g = gm.getContext('2d'), w = gm.width, h = gm.height, cx = w / 2, cy = h / 2, R = w / 2 - 4 * dpr, maxG = 6;
  g.clearRect(0, 0, w, h); g.strokeStyle = '#263042'; g.lineWidth = dpr;
  for (let i = 2; i <= maxG; i += 2) { g.beginPath(); g.arc(cx, cy, R * i / maxG, 0, 7); g.stroke(); }
  g.beginPath(); g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R); g.stroke();
  g.fillStyle = '#8792a5'; g.font = `${9 * dpr}px "IBM Plex Mono", monospace`; g.fillText('2g', cx + R / 3 + 2 * dpr, cy - 2 * dpr); g.fillText('6g', cx + R - 14 * dpr, cy - 2 * dpr);
  const gx = car.ays / G, gy = car.axs / G; // dot points where the car is being pushed: left turn → left, braking → down
  const px = cx - clamp(gx, -maxG, maxG) / maxG * R, py = cy - clamp(gy, -maxG, maxG) / maxG * R;
  g.fillStyle = '#57c4ff'; g.beginPath(); g.arc(px, py, 4.5 * dpr, 0, 7); g.fill();
  g.fillStyle = '#e9edf3'; g.font = `600 ${11 * dpr}px "Saira Condensed", sans-serif`; g.fillText(Math.hypot(gx, gy).toFixed(1) + ' g', 3 * dpr, h - 4 * dpr);
}
const tyreCls = T => T < 80 ? 'tyre-cold' : T > 120 ? 'tyre-hot' : 'tyre-ok';
let hudT = 0;
function hud(dt) {
  hudT += dt; if (hudT < 1 / 30) return; hudT = 0;
  const c = car, spd = Math.hypot(c.vx, c.vy) * 3.6;
  $('#spd').textContent = Math.round(spd);
  $('#gear').textContent = c.gear === -1 ? 'R' : c.gear;
  $('#rpm').textContent = Math.round(c.rpm / 10) * 10 + ' RPM';
  const lit = clamp(Math.floor((c.rpm - 10200) / (SPEC.upAt - 10200) * 15), 0, 15);
  ledEls.forEach((e, i) => e.className = i < lit ? (i < 5 ? 'g' : i < 10 ? 'r' : 'b') : '');
  leds.classList.toggle('flash', !setup.auto && c.rpm > SPEC.upAt && (state.t * 8 % 1) < 0.5);
  $('#pThr i').style.height = (c.thr * 100) + '%'; $('#pBrk i').style.height = (c.brk * 100) + '%';
  const drsAvail = W.drs[c.k] && state.mode === 'race';
  $('#cDrs').className = 'chip' + (c.drs ? ' on' : drsAvail ? ' avail' : '');
  $('#tDrs').className = 'tbtn' + (c.drs ? ' on' : drsAvail ? ' avail' : '');
  $('#cTc').className = 'chip' + (!setup.tc ? '' : c.tcAct ? ' act' : ' avail') + (c.spin && !setup.tc ? ' warn' : '');
  $('#cAbs').className = 'chip' + (!setup.abs ? (c.lockF ? ' warn' : '') : ' avail');
  $('#cGb').textContent = setup.auto ? 'AUTO' : 'MANUAL';
  const lt = state.mode === 'race' ? (state.lap > 0 ? state.t - state.lapStart : RACE.on ? state.t : 0) : 0;
  $('#lapNo').textContent = RACE.on ? `${clamp(state.lap, 1, setup.laps)}/${setup.laps}` : (state.lap || '–');
  $('#lapTime').textContent = fmt(lt); $('#lapTime').classList.toggle('invalid', !state.valid);
  $('#lapState').textContent = state.mode === 'race' ? (state.valid ? '計時中' : '無效圈') : state.mode === 'lights' ? '起跑' : '暫停';
  const dEl = $('#delta');
  if (state.bestTimes && state.mode === 'race' && state.bestTimes[c.k] > 0 && state.curTimes[c.k] > 0) {
    const d = state.curTimes[c.k] - state.bestTimes[c.k]; dEl.textContent = (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(3); dEl.className = d >= 0 ? 'up' : 'down';
  } else dEl.textContent = '';
  $('#best').textContent = fmt(state.best); $('#last').textContent = fmt(state.last);
  $('#tDown').textContent = (c.down / 1000).toFixed(1) + ' kN';
  $('#tDrag').textContent = (c.drag / 1000).toFixed(1) + ' kN';
  $('#tGrade').textContent = (c.grade * 100 >= 0 ? '+' : '') + (c.grade * 100).toFixed(1) + ' %';
  $('#tBank').textContent = (c.bankV * 100).toFixed(1) + ' %';
  $('#tAlt').textContent = Math.round(W.base + c.y) + ' m';
  $('#tRho').textContent = c.rho.toFixed(3) + ' kg/m³';
  $('#tLoad').textContent = (c.Fzf / 1000).toFixed(1) + ' / ' + (c.Fzr / 1000).toFixed(1) + ' kN';
  $('#tSurf').textContent = ['柏油賽道', '路肩 Kerb', W.city ? '人行道' : '草地', '碎石區'][c.surf];
  $('#tTyre').innerHTML = `<span class="${tyreCls(c.tf)}">${Math.round(c.tf)}</span> / <span class="${tyreCls(c.tr)}">${Math.round(c.tr)}</span> °C`;
  const dF = Math.abs(c.aF) * 57.3, dR = Math.abs(c.aR) * 57.3, peak = 6.2;
  $('#bF').style.width = clamp(dF / 12, 0, 1) * 100 + '%'; $('#bR').style.width = clamp(dR / 12, 0, 1) * 100 + '%';
  $('#bF').classList.toggle('hot', dF > peak); $('#bR').classList.toggle('hot', dR > peak);
  $('#oF').textContent = dF.toFixed(1) + '°'; $('#oR').textContent = dR.toFixed(1) + '°';
  const bal = $('#balance');
  if (spd < 30 || (dF < 1.2 && dR < 1.2)) { bal.textContent = '中性'; bal.className = ''; }
  else if (dF > dR + 1.2) { bal.textContent = '轉向不足 UNDERSTEER'; bal.className = 'under'; }
  else if (dR > dF + 1.2) { bal.textContent = '轉向過度 OVERSTEER'; bal.className = 'over'; }
  else { bal.textContent = '中性'; bal.className = ''; }
  drawMinimap(); drawG();
}

/* ================= Audio ================= */
let AC = null, eng = null, muted = false;
function startAudio() {
  if (AC) { AC.resume && AC.resume(); return; }
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    const master = AC.createGain(); master.gain.value = 0.5; master.connect(AC.destination);
    const filt = AC.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 1500; filt.Q.value = 3;
    const g = AC.createGain(); g.gain.value = 0; filt.connect(g); g.connect(master);
    const o1 = AC.createOscillator(); o1.type = 'sawtooth'; const o2 = AC.createOscillator(); o2.type = 'square'; const o3 = AC.createOscillator(); o3.type = 'sawtooth';
    const g2 = AC.createGain(); g2.gain.value = 0.35; const g3 = AC.createGain(); g3.gain.value = 0.25;
    o1.connect(filt); o2.connect(g2); g2.connect(filt); o3.connect(g3); g3.connect(filt); o1.start(); o2.start(); o3.start();
    const buf = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate), d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const ns = AC.createBufferSource(); ns.buffer = buf; ns.loop = true; const nf = AC.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 600; nf.Q.value = 0.6;
    const ng = AC.createGain(); ng.gain.value = 0; ns.connect(nf); nf.connect(ng); ng.connect(master); ns.start();
    eng = { o1, o2, o3, filt, g, ng };
  } catch (e) { AC = null; }
}
function updateAudio() {
  if (!eng) return; const t = AC.currentTime, c = car, f = c.rpm / 60 * 3, spd = Math.hypot(c.vx, c.vy);
  eng.o1.frequency.setTargetAtTime(f, t, 0.015); eng.o2.frequency.setTargetAtTime(f / 2, t, 0.015); eng.o3.frequency.setTargetAtTime(f * 1.005, t, 0.015);
  eng.filt.frequency.setTargetAtTime(700 + c.thr * 2600 + c.rpm * 0.08, t, 0.03);
  const on = !muted && state.mode !== 'menu' && state.mode !== 'menu0';
  eng.g.gain.setTargetAtTime(on ? 0.05 + 0.11 * c.thr : 0, t, 0.05);
  eng.ng.gain.setTargetAtTime(on ? Math.min(0.12, spd * spd / 80000) + (c.surf >= 2 && spd > 3 ? 0.05 : 0) + ((c.spin || c.lockF) && spd > 5 ? 0.06 : 0) : 0, t, 0.08);
}

/* ================= Setup UI ================= */
let mapDirty = true;
const COLORS = ['#d7263d', '#1f5bff', '#ff8a00', '#12a596', '#e3e7ec', '#1b1d22'];
const sw = $('#swatches');
COLORS.forEach(cl => { const b = document.createElement('button'); b.type = 'button'; b.className = 'sw' + (cl === setup.color ? ' sel' : ''); b.style.background = cl; b.setAttribute('aria-label', '車色 ' + cl); b.onclick = () => { setup.color = cl; sw.querySelectorAll('.sw').forEach(x => x.classList.toggle('sel', x === b)); recolor(); }; sw.appendChild(b); });
function recolor() { scene.remove(carModel.root); carModel = buildCar(setup.color, false); scene.add(carModel.root); }
function syncLabels() {
  $('#oSize').textContent = (+$('#size').value / 1000).toFixed(1) + ' km';
  $('#oRange').textContent = TER.meters ? TER.range + ' m' : $('#range').value + ' m';
  $('#range').disabled = !!TER.meters;
  $('#oBase').textContent = $('#base').value + ' m';
  $('#oWidth').textContent = $('#width').value + ' m';
  const a = +$('#aero').value, ae = aeroOf(a);
  $('#oAero').textContent = a < 0.25 ? '低（蒙札）' : a > 0.75 ? '高（摩納哥）' : '中';
  $('#aeroHint').textContent = `CdA ${ae.CdA.toFixed(2)} m² · ClA ${ae.ClA.toFixed(2)} m² · L/D ${(ae.ClA / ae.CdA).toFixed(2)}`;
  $('#oBias').textContent = (+$('#bias').value).toFixed(1) + '% 前';
  $('#oSteer').textContent = Math.round(+$('#steer').value * 100) + '%';
  $('#oLaps').textContent = $('#laps').value + ' 圈'; $('#oAiCount').textContent = $('#aiCount').value + ' 台';
  $('#oAiSkill').textContent = ['新手', '業餘', '職業', '冠軍'][Math.min(3, Math.floor(+$('#aiSkill').value * 4))];
}
function readSetup() {
  TER.size = +$('#size').value; if (!TER.meters) TER.range = +$('#range').value; TER.base = +$('#base').value;
  setup.width = +$('#width').value; setup.banking = $('#banking').checked; setup.walls = $('#walls').checked; setup.aero = +$('#aero').value; setup.bias = +$('#bias').value;
  setup.tc = $('#tc').checked; setup.abs = $('#abs').checked; setup.auto = $('#auto').checked;
  setup.steerSens = +$('#steer').value; setup.assist = $('#assist').checked; setup.autogas = $('#autogas').checked; muted = !$('#sound').checked;
  setup.laps = +$('#laps').value; setup.aiCount = +$('#aiCount').value; setup.aiSkill = +$('#aiSkill').value;
  savePrefs();
}
function mapChanged() { mapDirty = true; drawEditorBase(); drawEditor(); updateStartBtn(); }
['size', 'range', 'base'].forEach(id => $('#' + id).addEventListener('input', () => { syncLabels(); readSetup(); mapDirty = true; if (id !== 'base' && setup.map === 'terrain') { drawEditorBase(); drawEditor(); } updateStartBtn(); }));
['width', 'banking', 'walls'].forEach(id => $('#' + id).addEventListener('input', () => { syncLabels(); readSetup(); mapDirty = true; updateStartBtn(); }));
['aero', 'bias', 'tc', 'abs', 'auto', 'steer', 'assist', 'autogas', 'sound', 'touchOn', 'laps', 'aiCount', 'aiSkill'].forEach(id => $('#' + id).addEventListener('input', () => { syncLabels(); readSetup(); applyControls(); }));
document.querySelectorAll('#presets .btn').forEach(b => b.onclick = () => {
  document.querySelectorAll('#presets .btn').forEach(x => x.classList.toggle('sel', x === b));
  const p = PRESETS[b.dataset.p]; TER.seed = (TER.seed * 7 + 13) % 997;
  genPreset(b.dataset.p, TER.seed); $('#range').value = p.range; $('#base').value = p.base; readSetup(); syncLabels();
  $('#fileInfo').textContent = 'PNG / JPG 皆可，也可直接拖放到這裡。Terrarium 編碼的真實地形圖磚會讀出實際海拔。';
  mapChanged();
});
$('#file').addEventListener('change', e => { const f = e.target.files[0]; if (f) loadHeightImage(f); e.target.value = ''; });
function dropZone(el, fn) {
  ['dragenter', 'dragover'].forEach(ev => el.addEventListener(ev, e => { e.preventDefault(); el.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => el.addEventListener(ev, e => { e.preventDefault(); el.classList.remove('over'); }));
  el.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) fn(f); });
}
dropZone($('#drop'), loadHeightImage);
function importOSM(file) {
  $('#osmInfo').textContent = `讀取 ${file.name}…`;
  file.text().then(txt => {
    const M = parseOSM(txt, file.name); CITY.osm = M;
    $('#osmInfo').textContent = `${file.name}：${(M.sx / 1000).toFixed(2)} × ${(M.sz / 1000).toFixed(2)} km，${M.roads.length} 條道路、${M.blds.length} 棟建物。在地圖上點路口放置賽道點。`;
    trackPts = []; selectMap('osm');
  }).catch(err => { $('#osmInfo').textContent = '匯入失敗：' + err.message; });
}
$('#osmFile').addEventListener('change', e => { const f = e.target.files[0]; if (f) importOSM(f); e.target.value = ''; });
dropZone($('#osmDrop'), importOSM);
function selectMap(m) {
  const go = () => {
    setup.map = m;
    document.querySelectorAll('#mapTabs .tab').forEach(t => { t.classList.toggle('sel', t.dataset.m === m); t.setAttribute('aria-selected', t.dataset.m === m); });
    $('#terrainOpts').hidden = m !== 'terrain'; $('#taipeiOpts').hidden = m !== 'taipei'; $('#osmOpts').hidden = m !== 'osm'; $('#tpPresetGroup').hidden = m !== 'taipei';
    $('#baseField').hidden = m === 'taipei'; $('#banking').closest('label').hidden = m !== 'terrain';
    const M = m === 'terrain' ? null : CITY[m];
    $('#mapCredit').hidden = !M; if (M) $('#mapCredit').textContent = M.credits;
    readSetup();
    if (m === 'taipei' && (!trackPts.length || trackPts[0].node === undefined)) trackPts = cityPreset(M, 0);
    if (m === 'terrain' && (!trackPts.length || trackPts[0].node !== undefined)) trackPts = randomTrack(Math.floor(Math.random() * 1e9));
    $('#btnRand').textContent = m === 'taipei' ? '換一條預設環線' : '隨機賽道'; $('#btnRand').disabled = m === 'osm';
    refreshRoute(); mapChanged();
  };
  if (m === 'taipei' && !CITY.taipei) {
    $('#busy').textContent = '載入臺北地形與建物…'; $('#busy').hidden = false;
    loadTaipei().then(() => { $('#busy').hidden = true; go(); }).catch(() => { $('#busy').hidden = true; $('#trackInfo').textContent = '臺北資料載入失敗，請重新整理頁面再試。'; });
  } else if (m === 'osm' && !CITY.osm) {
    setup.map = 'osm'; document.querySelectorAll('#mapTabs .tab').forEach(t => t.classList.toggle('sel', t.dataset.m === m));
    $('#terrainOpts').hidden = true; $('#taipeiOpts').hidden = true; $('#osmOpts').hidden = false; $('#baseField').hidden = false; $('#mapCredit').hidden = true;
    edBase = null; drawEditor(); updateStartBtn();
  } else go();
}
document.querySelectorAll('#mapTabs .tab').forEach(t => t.onclick = () => { if (t.dataset.m !== setup.map || (t.dataset.m === 'osm' && !CITY.osm)) { trackPts = []; selectMap(t.dataset.m); } });
document.querySelectorAll('#tpPresets .btn').forEach(b => b.onclick = () => { trackPts = cityPreset(CITY.taipei, +b.dataset.c); setup.reverse = false; $('#btnRev').classList.remove('sel'); mapDirty = true; refreshRoute(); drawEditor(); updateStartBtn(); });

// ---- editor map
const ed = $('#editor'); let edBase = null, edSize = 0, routePreview = null, presetCycle = 0;
function drawEditorBase() {
  if (setup.map === 'terrain') {
    applyTerrainScale();
    const raw = TER.raw, img = new ImageData(N, N); let lo = Infinity, hi = -Infinity; for (const v of raw) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    const cell = TER.size / (N - 1), span = hi - lo + 1e-6;
    const ramp = [[0, [62, 92, 46]], [0.45, [118, 132, 70]], [0.75, [150, 128, 92]], [0.9, [140, 132, 125]], [1, [235, 238, 242]]];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const o = j * N + i, t = (raw[o] - lo) / span;
      const dx = (raw[j * N + Math.min(N - 1, i + 1)] - raw[j * N + Math.max(0, i - 1)]) / (2 * cell), dz = (raw[Math.min(N - 1, j + 1) * N + i] - raw[Math.max(0, j - 1) * N + i]) / (2 * cell);
      const sh = clamp(0.75 + (-dx * 0.7 - dz * 0.7) * 1.6, 0.35, 1.25);
      let a = ramp[0], b = ramp[1]; for (let r = 1; r < ramp.length; r++) if (t <= ramp[r][0]) { a = ramp[r - 1]; b = ramp[r]; break; }
      const f = (t - a[0]) / (b[0] - a[0] || 1);
      for (let ch = 0; ch < 3; ch++) img.data[o * 4 + ch] = clamp((a[1][ch] + (b[1][ch] - a[1][ch]) * f) * sh, 0, 255);
      img.data[o * 4 + 3] = 255;
    }
    const cv = document.createElement('canvas'); cv.width = N; cv.height = N; cv.getContext('2d').putImageData(img, 0, 0); edBase = cv;
    return;
  }
  const M = CITY[setup.map]; if (!M) { edBase = null; return; }
  const s = 1200, V = viewSize(M), cv = document.createElement('canvas'); cv.width = cv.height = s; const g = cv.getContext('2d');
  const T = (x, z) => [(x / V + 0.5) * s, (z / V + 0.5) * s];
  g.fillStyle = '#10141b'; g.fillRect(0, 0, s, s);
  const mc = document.createElement('canvas'); mc.width = M.nx; mc.height = M.nz; const mg = mc.getContext('2d'), img = mg.createImageData(M.nx, M.nz);
  let lo = Infinity, hi = -Infinity; for (const v of M.raw) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  for (let i = 0; i < M.nx * M.nz; i++) {
    const m = M.mask[i], t = clamp((M.raw[i] - lo) / (Math.min(hi, lo + 40) - lo + 1e-6), 0, 1);
    const c = m === 0 ? (M.raw[i] < (M.water ?? -99) + 1.2 ? [44, 82, 110] : [52, 84, 52]) : m === 2 ? [70, 96, 62] : m === 3 ? [44, 48, 56] : [56 + t * 30, 60 + t * 28, 68 + t * 20];
    img.data.set([...c, 255], i * 4);
  }
  mg.putImageData(img, 0, 0);
  const [ax, az] = T(-M.sx / 2, -M.sz / 2); g.imageSmoothingEnabled = true; g.drawImage(mc, ax, az, M.sx / V * s, M.sz / V * s);
  g.fillStyle = 'rgba(150,158,172,.55)';
  for (const b of M.blds) { const p = b.p; g.beginPath(); for (let i = 0; i < p.length; i += 2) { const [x, z] = T(p[i], p[i + 1]); i ? g.lineTo(x, z) : g.moveTo(x, z); } g.fill(); }
  g.lineCap = g.lineJoin = 'round';
  for (const r of [...M.roads].sort((a, b) => b.c - a.c)) {
    g.strokeStyle = r.c <= 1 ? '#f2e6c4' : r.c <= 3 ? '#d6dbe3' : 'rgba(200,206,216,.55)'; g.lineWidth = Math.max(0.7, ROAD_W[r.c] / V * s);
    g.beginPath(); for (let i = 0; i < r.p.length; i += 2) { const [x, z] = T(r.p[i], r.p[i + 1]); i ? g.lineTo(x, z) : g.moveTo(x, z); } g.stroke();
  }
  edBase = cv;
}
function refreshRoute() {
  const M = setup.map === 'terrain' ? null : CITY[setup.map];
  routePreview = M && trackPts.length >= 2 ? routeLoop(M, setup.reverse ? trackPts.slice().reverse() : trackPts) : null;
}
function edResize() { const s = Math.round(ed.clientWidth * dpr); if (s && s !== edSize) { edSize = s; ed.width = s; ed.height = s; } }
function drawEditor() {
  edResize(); if (!edSize) return;
  const g = ed.getContext('2d'), s = edSize, city = setup.map !== 'terrain', M = city ? CITY[setup.map] : null;
  g.fillStyle = '#10141b'; g.fillRect(0, 0, s, s);
  if (!edBase) { g.fillStyle = '#8792a5'; g.font = `${14 * dpr}px "Noto Sans TC", sans-serif`; g.textAlign = 'center'; g.fillText('先匯入 .osm 檔', s / 2, s / 2); g.textAlign = 'left'; $('#trackInfo').textContent = '匯入 OpenStreetMap 檔後，就能在街道上點出賽道。'; return; }
  g.imageSmoothingEnabled = true; g.drawImage(edBase, 0, 0, s, s);
  if (!city) { g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(0, 0, s, s); }
  const V = city ? viewSize(M) : TER.size;
  g.strokeStyle = 'rgba(255,255,255,.1)'; g.lineWidth = 1;
  const step = 500 / V * s; for (let x = step; x < s; x += step) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, s); g.moveTo(0, x); g.lineTo(s, x); g.stroke(); }
  g.fillStyle = 'rgba(255,255,255,.75)'; g.font = `${10 * dpr}px "IBM Plex Mono", monospace`; g.fillText('格線 500 m', 6 * dpr, s - 6 * dpr);
  const pts = setup.reverse ? trackPts.slice().reverse() : trackPts;
  let line = null, approx = 0;
  if (city && routePreview && routePreview.length > 1) line = routePreview.map(([x, z]) => [(x / V + 0.5), (z / V + 0.5)]).concat([[routePreview[0][0] / V + 0.5, routePreview[0][1] / V + 0.5]]);
  else if (!city && pts.length >= 3) line = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p.u, 0, p.v)), true, 'centripetal', 0.5).getPoints(600).map(p => [p.x, p.z]);
  if (line) {
    for (let i = 1; i < line.length; i++) approx += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]) * V;
    g.lineJoin = 'round'; g.lineCap = 'round';
    for (const [c, lw] of [['rgba(0,0,0,.6)', 7], [city ? '#ff5a4f' : '#e9edf3', 3.2]]) { g.strokeStyle = c; g.lineWidth = lw * dpr; g.beginPath(); line.forEach((p, i) => i ? g.lineTo(p[0] * s, p[1] * s) : g.moveTo(p[0] * s, p[1] * s)); g.stroke(); }
    const a = line[0], b = line[Math.min(line.length - 1, 4)], ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    g.save(); g.translate(a[0] * s, a[1] * s); g.rotate(ang); g.fillStyle = '#57c4ff'; g.beginPath(); g.moveTo(14 * dpr, 0); g.lineTo(-6 * dpr, -8 * dpr); g.lineTo(-6 * dpr, 8 * dpr); g.closePath(); g.fill(); g.restore();
  }
  trackPts.forEach((p, i) => {
    g.fillStyle = i === 0 ? '#57c4ff' : '#10141b'; g.strokeStyle = '#e9edf3'; g.lineWidth = 2 * dpr;
    g.beginPath(); g.arc(p.u * s, p.v * s, 8 * dpr, 0, 7); g.fill(); g.stroke();
    g.fillStyle = i === 0 ? '#04131d' : '#e9edf3'; g.font = `600 ${10 * dpr}px "Saira Condensed", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(i + 1, p.u * s, p.v * s + 0.5);
  });
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  $('#footStatus').textContent = (city ? (M.id === 'taipei' ? '臺北街道賽' : 'OSM 街道') : '自訂地形') + (line && trackPts.length >= (city ? 3 : 4) ? ` · ${trackPts.length} 點 · ${(approx / 1000).toFixed(2)} km` : ' · 尚未完成賽道');
  $('#trackInfo').innerHTML = trackPts.length < (city ? 3 : 4)
    ? `在地圖上依序點擊放置${city ? '路口' : '彎道控制點'}（目前 <b>${trackPts.length}</b> 點，至少 ${city ? 3 : 4} 點）。${city ? '點會吸附到最近的路口，路線沿真實街道走。' : '點可以拖曳調整，賽道會自動閉合並貼合地形。'}`
    : `<b>${trackPts.length}</b> 個${city ? '路口' : '控制點'} · 約 <b>${(approx / 1000).toFixed(2)} km</b>。拖曳點可調整，藍色箭頭是行駛方向與起跑線。`;
}
let dragI = -1;
function edPos(e) { const r = ed.getBoundingClientRect(); return { u: clamp((e.clientX - r.left) / r.width, 0.01, 0.99), v: clamp((e.clientY - r.top) / r.height, 0.01, 0.99) }; }
function snapIfCity(p) { if (setup.map === 'terrain') return p; const M = CITY[setup.map], V = viewSize(M); return cityPoint(M, (p.u - 0.5) * V, (p.v - 0.5) * V); }
ed.addEventListener('pointerdown', e => {
  if (!edBase || (setup.mode === 'online' && NET.room2 && !NET.isHost)) return;
  const p = edPos(e), r = ed.getBoundingClientRect(); dragI = -1;
  trackPts.forEach((q, i) => { if (Math.hypot((q.u - p.u) * r.width, (q.v - p.v) * r.height) < 14) dragI = i; });
  if (dragI < 0) { trackPts.push(snapIfCity(p)); dragI = trackPts.length - 1; }
  ed.setPointerCapture(e.pointerId); mapDirty = true; refreshRoute(); drawEditor(); updateStartBtn();
});
ed.addEventListener('pointermove', e => { if (dragI >= 0) { trackPts[dragI] = setup.map === 'terrain' ? edPos(e) : snapIfCity(edPos(e)); if (setup.map === 'terrain') drawEditor(); else { drawEditor(); } } });
ed.addEventListener('pointerup', () => { if (dragI >= 0) { refreshRoute(); drawEditor(); } dragI = -1; });
$('#btnRand').onclick = () => {
  if (setup.map === 'terrain') trackPts = randomTrack(Math.floor(Math.random() * 1e9));
  else if (setup.map === 'taipei') trackPts = cityPreset(CITY.taipei, presetCycle = (presetCycle + 1) % TP_CIRCUITS.length);
  else return;
  mapDirty = true; refreshRoute(); drawEditor(); updateStartBtn();
};
$('#btnUndo').onclick = () => { trackPts.pop(); mapDirty = true; refreshRoute(); drawEditor(); updateStartBtn(); };
$('#btnClear').onclick = () => { trackPts = []; mapDirty = true; refreshRoute(); drawEditor(); updateStartBtn(); };
$('#btnRev').onclick = () => { setup.reverse = !setup.reverse; $('#btnRev').classList.toggle('sel', setup.reverse); mapDirty = true; refreshRoute(); drawEditor(); updateStartBtn(); };
addEventListener('resize', () => { if (!$('#setup').hidden) drawEditor(); });
function updateStartBtn() {
  const ok = trackPts.length >= (setup.map === 'terrain' ? 4 : 3) && (setup.map === 'terrain' || CITY[setup.map]);
  $('#btnStart').disabled = !ok;
  $('#btnStart').textContent = state.mode === 'menu' && mapDirty ? '套用並重新開始' : state.mode === 'menu' ? '重新開始' : '開始比賽';
  if (setup.mode === 'online') {
    const inRoom = !!NET.room2, n = netPlayers().length;
    $('#btnStart').disabled = !ok || !inRoom || !NET.isHost || !netCanHost();
    $('#btnStart').textContent = !inRoom ? '先加入房間' : NET.isHost ? `開始比賽（${n} 人）` : '等待房主開始';
  }
  $('#btnResume').hidden = !(state.mode === 'menu' && !mapDirty);
}
let prevMode = 'race', wakeLock = null;
function openMenu() {
  if (state.mode === 'menu' || state.mode === 'menu0') return; prevMode = state.mode; state.mode = 'menu';
  $('#pLap').textContent = state.lap || '–'; $('#pBest').textContent = fmt(state.best); $('#pLast').textContent = fmt(state.last);
  $('#pause').hidden = false; for (const k in keys) keys[k] = false;
  $('#pRestart').hidden = setup.mode === 'online' && !NET.isHost;
}
function resume() { if (mapDirty && !$('#setup').hidden) return; $('#setup').hidden = true; $('#pause').hidden = true; state.mode = prevMode; startAudio(); keepAwake(); }
function keepAwake() { try { if (navigator.wakeLock && !wakeLock) navigator.wakeLock.request('screen').then(l => { wakeLock = l; l.addEventListener('release', () => { wakeLock = null; }); }).catch(() => {}); } catch (e) { /* not offered here */ } }
function startRace(fromNet) {
  if (setup.mode === 'online' && !fromNet) { if (!NET.room2 || !NET.isHost) return; if (!netCanHost()) return; netHostGo(); return; }
  readSetup(); startAudio(); keepAwake();
  const go = () => {
    if (mapDirty) { buildWorld(); mapDirty = false; }
    resetRace(); camInit = false; fpsProbe.reset();
    setupGrid();
    $('#setup').hidden = true; $('#pause').hidden = true; $('#busy').hidden = true;
    state.mode = 'lights'; state.lightsT = 0; state.lightsOut = 4.2 + Math.random() * 1.2; $('#lights').hidden = false;
    if (COARSE && innerHeight > innerWidth) banner('橫向握持手機，視野更寬', 'info');
  };
  if (mapDirty) { $('#busy').textContent = setup.map !== 'terrain' ? '生成街道與建物中…' : '生成地形中…'; $('#busy').hidden = false; setTimeout(go, 30); } else go();
}
$('#btnResume').onclick = resume;
$('#btnStart').onclick = () => startRace();
$('#menuBtn').onclick = openMenu;
$('#pResume').onclick = resume;
$('#pRestart').onclick = () => startRace();
$('#pSetup').onclick = () => { $('#pause').hidden = true; $('#setup').hidden = false; drawEditor(); updateStartBtn(); };
$('#bCam').onclick = () => { camMode = (camMode + 1) % 3; };
$('#bReset').onclick = () => resetToTrack();
$('#bTele').onclick = () => { $('#tele').hidden = !$('#tele').hidden; $('#bTele').classList.toggle('on', !$('#tele').hidden); };
document.addEventListener('visibilitychange', () => { if (document.hidden) { if (state.mode === 'race' || state.mode === 'lights') openMenu(); } else if (state.mode === 'race') keepAwake(); });
// settings pages
document.querySelectorAll('.step').forEach(b => b.onclick = () => {
  document.querySelectorAll('.step').forEach(x => { x.classList.toggle('sel', x === b); x.setAttribute('aria-selected', x === b); });
  document.querySelectorAll('.pane').forEach(p => { p.hidden = p.dataset.pane !== b.dataset.pane; });
});
document.querySelectorAll('#steerMode button').forEach(b => b.onclick = () => { setup.steerMode = b.dataset.s; applyControls(); savePrefs(); });
document.querySelectorAll('#quality button').forEach(b => b.onclick = () => { setup.quality = b.dataset.q; document.querySelectorAll('#quality button').forEach(x => x.classList.toggle('sel', x === b)); applyQuality(setup.quality === 'auto' ? autoLevel() : setup.quality); savePrefs(); });
if (document.fullscreenEnabled) { $('#btnFull').hidden = false; $('#btnFull').onclick = () => { document.documentElement.requestFullscreen().then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {})).catch(() => {}); }; }
// per-viewer preferences
function savePrefs() { try { localStorage.setItem('tgp-prefs', JSON.stringify({ nick: $('#nick').value, steerSens: setup.steerSens, steerMode: setup.steerMode, autogas: setup.autogas, quality: setup.quality, assist: setup.assist, sound: !muted })); } catch (e) { /* storage unavailable */ } }
function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem('tgp-prefs') || 'null'); if (!p) return;
    if (p.nick) $('#nick').value = p.nick; if (p.steerSens) $('#steer').value = p.steerSens; if (p.steerMode) setup.steerMode = p.steerMode; if (p.quality) setup.quality = p.quality;
    $('#autogas').checked = !!p.autogas; $('#assist').checked = p.assist !== false; $('#sound').checked = p.sound !== false;
    document.querySelectorAll('#quality button').forEach(x => x.classList.toggle('sel', x.dataset.q === setup.quality));
  } catch (e) { /* storage unavailable */ }
}
// graphics quality: pixel ratio and shadow map size; "auto" steps down when the frame rate stays low
let qLevel = null;
const autoLevel = () => COARSE ? 'mid' : 'high';
function applyQuality(level) {
  if (level === qLevel) return; qLevel = level;
  const dprMax = level === 'high' ? 2 : level === 'mid' ? 1.5 : 1;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprMax));
  const shadows = level !== 'low', size = level === 'high' ? 2048 : 1024;
  if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  sun.shadow.mapSize.set(size, size); sun.castShadow = shadows;
  POST.on = level === 'high' && setupPost();
  if (renderer.shadowMap.enabled !== shadows) { renderer.shadowMap.enabled = shadows; scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => { m.needsUpdate = true; }); }); }
  resize();
}
const fpsProbe = { t: 0, n: 0, reset() { this.t = 0; this.n = 0; } };
function probeFps(dt) {
  if (setup.quality !== 'auto' || state.mode !== 'race' || qLevel === 'low') return;
  fpsProbe.t += dt; fpsProbe.n++;
  if (fpsProbe.t >= 4) {
    const fps = fpsProbe.n / fpsProbe.t; fpsProbe.reset();
    if (fps < 28) { applyQuality(qLevel === 'high' ? 'mid' : 'low'); banner('已降低畫質以維持流暢', 'info'); }
  }
}

/* ================= Opponents: computer drivers and online players ================= */
const AI_COLORS = ['#1f5bff', '#ff8a00', '#12a596', '#e3e7ec', '#7a3cff', '#f2c400', '#00a3e0', '#2e7d32', '#ff4f9a', '#9aa3ad'];
const AI_NAMES = ['藍隼', '橘焰', '青嵐', '銀翼', '紫電', '金鋒', '天藍', '綠野', '粉影', '灰狼'];
const RACE = { on: false, done: false, cars: [], prof: null, ks: null, finT: NaN, go() { RACE.cars.forEach(c => { c.delay = 0.15 + Math.random() * 0.4; }); } };
function nameTag(text, color) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64; const g = cv.getContext('2d');
  g.fillStyle = 'rgba(10,12,16,.72)'; g.fillRect(0, 8, 256, 48); g.fillStyle = color; g.fillRect(0, 8, 10, 48);
  g.fillStyle = '#fff'; g.font = '600 30px "Noto Sans TC", sans-serif'; g.textBaseline = 'middle'; g.fillText(text.slice(0, 10), 22, 33);
  const t = new THREE.CanvasTexture(cv); t.encoding = THREE.sRGBEncoding;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false })); sp.scale.set(3.4, 0.85, 1); sp.position.set(0, 2.2, 0); return sp;
}
function disposeModel(m) { scene.remove(m.root); m.root.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } }); }
function gridSlot(i) { const n = W.n; return { k: ((n - 8 - i * 5) % n + n) % n, lat: (i % 2 ? -1 : 1) * Math.min(2.8, setup.width / 2 - 2) }; }
// Speed the circuit allows at each sample: cornering limit with downforce, then braking (backward) and traction (forward) passes
function buildProfile() {
  const n = W.n, ds = W.ds, ae = aeroOf(0.5), kA = 0.5 * 1.2 * ae.ClA / SPEC.m, mu = 1.72, v = new Float32Array(n);
  const K = Float32Array.from(W.kappa, Math.abs); smoothCirc(K, 3, 2);
  for (let k = 0; k < n; k++) v[k] = Math.min(94, K[k] > mu * kA + 1e-5 ? Math.sqrt(mu * G / (K[k] - mu * kA)) : 94);
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 2 * n - 1; i >= 0; i--) { const k = i % n, nk = (k + 1) % n, ab = mu * (G + kA * v[nk] * v[nk]) * 0.82; v[k] = Math.min(v[k], Math.sqrt(v[nk] * v[nk] + 2 * ab * ds)); }
    for (let i = 0; i < 2 * n; i++) { const k = i % n, pk = (k - 1 + n) % n, gr = (W.h[k] - W.h[pk]) / ds; v[k] = Math.min(v[k], Math.sqrt(v[pk] * v[pk] + 2 * Math.max(0.5, accelAt(v[pk]) - G * gr) * ds)); }
  }
  const ks = Float32Array.from(W.kappa); smoothCirc(ks, Math.round(30 / ds), 2);
  RACE.prof = v; RACE.ks = ks;
}
const accelAt = v => clamp(SPEC.Pmax * 0.82 / (SPEC.m * Math.max(v, 4)), 0, 12.5) - 0.5 * 1.2 * 1.43 * v * v / SPEC.m;
function clearOpponents() { RACE.cars.forEach(c => disposeModel(c.model)); RACE.cars = []; }
function setupGrid() {
  clearOpponents(); $('#results').hidden = true;
  RACE.on = setup.mode !== 'solo'; RACE.done = false; RACE.finT = NaN;
  if (!RACE.on) { placeCar(3, 0); return; }
  buildProfile();
  let mySlot = 0;
  if (setup.mode === 'ai') {
    const cnt = Math.min(setup.aiCount, COARSE ? 7 : 9); mySlot = Math.floor(cnt / 2);
    const base = 0.86 + setup.aiSkill * 0.13;
    for (let i = 0, a = 0; i <= cnt; i++) {
      if (i === mySlot) continue;
      const g = gridSlot(i), col = AI_COLORS[a % AI_COLORS.length], model = buildCar(col, false, true);
      model.root.add(nameTag(AI_NAMES[a % AI_NAMES.length], col)); scene.add(model.root);
      RACE.cars.push({ name: AI_NAMES[a % AI_NAMES.length], color: col, model, s: g.k * W.ds - W.len, lat: g.lat, latV: 0, v: 0, lap: -1, lapT0: 0, best: Infinity, finT: NaN, delay: 99,
        skill: clamp(base + (Math.random() - 0.5) * 0.035 - (cnt - i) * 0.002, 0.8, 1.0), wheel: 0 });
      a++;
    }
  } else mySlot = netMySlot();
  const g = gridSlot(mySlot); placeCar(g.k, g.lat);
  RACE.cars.forEach(c => poseOpponent(c));
}
const playerProgress = () => state.lap >= 1 ? (state.lap - 1) * W.len + car.k * W.ds : car.k * W.ds - W.len;
const wrapGap = d => { const L = W.len; d = ((d % L) + L) % L; return d > L / 2 ? d - L : d; };
function poseOpponent(c) {
  const L = W.len, n = W.n, sm = ((c.s % L) + L) % L, f = sm / W.ds, k = Math.floor(f) % n, k1 = (k + 1) % n, t = f - Math.floor(f);
  const lx = W.lx[k] + (W.lx[k1] - W.lx[k]) * t, lz = W.lz[k] + (W.lz[k1] - W.lz[k]) * t;
  const x = W.x[k] + (W.x[k1] - W.x[k]) * t + lx * c.lat, z = W.z[k] + (W.z[k1] - W.z[k]) * t + lz * c.lat;
  c.k = k; c.x = x; c.z = z; c.psi = Math.atan2(-lx, -lz) + Math.atan2(c.latV, Math.max(c.v, 2));
  poseModel(c.model, x, z, c.psi);
  const tag = c.model.root.children[c.model.root.children.length - 1]; if (tag && tag.isSprite) tag.visible = camera.position.distanceToSquared(c.model.root.position) > 144;
  c.wheel += c.v / SPEC.rw * (1 / 60);
  for (const w of c.model.wheels) { w.spin.rotation.z = -c.wheel; if (w.front) w.pivot.rotation.y = Math.atan(W.kappa[k] * SPEC.L); }
}
function poseModel(mdl, x, z, psi) {
  const y = Hq(x, z); normalAt(x, z, nrm);
  fp.set(Math.cos(psi), 0, -Math.sin(psi)); fp.addScaledVector(nrm, -fp.dot(nrm)).normalize(); rt.crossVectors(fp, nrm);
  m4.makeBasis(fp, nrm, rt); mdl.root.quaternion.setFromRotationMatrix(m4); mdl.root.position.set(x, y, z);
}
function opponentsStep(dt) {
  if (!RACE.on) return;
  const L = W.len, n = W.n, hw = setup.width / 2, pv = Math.hypot(car.vx, car.vy);
  const others = [{ s: playerProgress(), lat: car.lat, v: pv }, ...RACE.cars];
  for (const r of NET.remote.values()) if (r.inRace) others.push({ s: r.prog, lat: r.lat || 0, v: r.v || 0 });
  for (const c of RACE.cars) {
    if (state.t < c.delay) { poseOpponent(c); continue; }
    const sm = ((c.s % L) + L) % L, k = Math.floor(sm / W.ds) % n, ahead = (k + Math.round(25 / W.ds)) % n;
    const cool = c.finT >= 0 ? 0.75 : 1;
    let vT = RACE.prof[k] * c.skill * cool, latT = clamp(RACE.ks[ahead] * 650, -(hw - 1.6), hw - 1.6);
    for (const o of others) {
      if (o === c) continue;
      const d = wrapGap(o.s - c.s);
      if (d > 0 && d < 28 && Math.abs(o.lat - c.lat) < 2.6) {
        const side = o.lat > 0 ? -1 : 1, passLat = clamp(o.lat + side * 3.4, -(hw - 1.2), hw - 1.2);
        if (Math.abs(passLat - o.lat) > 2.6 && d > 6) latT = passLat; else vT = Math.min(vT, o.v + Math.max(0, d - 8) * 0.6);
      }
    }
    if (c.v < vT) c.v = Math.min(vT, c.v + accelAt(c.v) * (0.88 + 0.12 * c.skill) * dt); else c.v = Math.max(vT, c.v - 34 * dt);
    c.latV = clamp((latT - c.lat) * 1.1, -3.2, 3.2); c.lat = clamp(c.lat + c.latV * dt, -(hw - 1), hw - 1);
    c.s += c.v * dt;
    const done = Math.floor(c.s / L);
    if (done > c.lap) {
      if (c.lap >= 0) c.best = Math.min(c.best, state.t - c.lapT0);
      c.lap = done; c.lapT0 = state.t;
      if (c.lap >= setup.laps && !(c.finT >= 0)) c.finT = state.t;
    }
    poseOpponent(c);
  }
  // contact with the player: two circles per car (nose and tail), the player's car is the one pushed
  for (const c of RACE.cars) if (bump(c)) { c.v *= 0.97; c.lat = clamp(c.lat + Math.sign(c.lat - car.lat || 1) * 0.3, -(hw - 1), hw - 1); }
  for (const r of NET.remote.values()) if (r.inRace && r.x !== undefined) bump(r);
}
function bump(o) {
  if (o.x === undefined) return false;
  const cf = [Math.cos(car.psi), -Math.sin(car.psi)], cl = [-Math.sin(car.psi), -Math.cos(car.psi)], of = [Math.cos(o.psi), -Math.sin(o.psi)];
  let hit = false;
  for (const a of [1.25, -1.25]) for (const b of [1.25, -1.25]) {
    const dx = car.x + cf[0] * a - (o.x + of[0] * b), dz = car.z + cf[1] * a - (o.z + of[1] * b), d = Math.hypot(dx, dz);
    if (d >= 2.1 || d < 1e-3) continue;
    const nx = dx / d, nz = dz / d; car.x += nx * (2.1 - d); car.z += nz * (2.1 - d);
    let Vx = car.vx * cf[0] + car.vy * cl[0], Vz = car.vx * cf[1] + car.vy * cl[1];
    const vn = (Vx - o.v * of[0]) * nx + (Vz - o.v * of[1]) * nz;
    if (vn < 0) { Vx -= 0.7 * vn * nx; Vz -= 0.7 * vn * nz; car.vx = Vx * cf[0] + Vz * cf[1]; car.vy = Vx * cl[0] + Vz * cl[1]; car.r *= 0.7; hit = true; }
  }
  return hit;
}
function playerFinished() {
  RACE.done = true; RACE.finT = state.t;
  banner('完賽！', 'good');
  setTimeout(() => { if (RACE.done) { renderResults(); $('#results').hidden = false; } }, 1200);
}
function raceEntries() {
  const me = { name: nick() + '（你）', color: setup.color, prog: playerProgress(), finT: RACE.finT, best: state.best, me: true, lap: state.lap };
  const list = [me];
  if (setup.mode === 'ai') RACE.cars.forEach(c => list.push({ name: c.name, color: c.color, prog: c.s, finT: c.finT, best: c.best, lap: c.lap + 1 }));
  else for (const r of NET.remote.values()) if (r.inRace) list.push({ name: r.name, color: r.color, prog: r.prog, finT: r.fin, best: r.best, lap: r.lap });
  list.sort((a, b) => { const fa = a.finT >= 0, fb = b.finT >= 0; if (fa && fb) return a.finT - b.finT; if (fa !== fb) return fa ? -1 : 1; return b.prog - a.prog; });
  return list;
}
let standT = 0;
function standingsHud(dt) {
  const el = $('#standings');
  if (!RACE.on || (state.mode !== 'race' && state.mode !== 'lights')) { el.hidden = true; return; }
  standT += dt; if (standT < 0.2) return; standT = 0;
  const list = raceEntries(), my = list.findIndex(e => e.me), sp = Math.max(20, Math.hypot(car.vx, car.vy));
  el.hidden = false;
  $('#posBig').textContent = `P${my + 1}`; $('#posOf').textContent = `/${list.length}`;
  const wide = innerWidth >= 900 && innerHeight >= 560, from = wide ? 0 : Math.max(0, Math.min(my - 1, list.length - 3)), rows = list.slice(from, from + (wide ? 10 : 3));
  $('#posRows').innerHTML = '';
  rows.forEach((e, i) => {
    const li = document.createElement('li'); if (e.me) li.className = 'me';
    const gap = e.me ? '' : e.finT >= 0 ? '完賽' : ((e.prog - list[my].prog) / sp > 0 ? '−' : '+') + Math.abs((e.prog - list[my].prog) / sp).toFixed(1);
    li.innerHTML = '<span class="pn"></span><i></i><span class="nm"></span><span class="gp"></span>';
    li.querySelector('.pn').textContent = from + i + 1; li.querySelector('i').style.background = e.color;
    li.querySelector('.nm').textContent = e.name; li.querySelector('.gp').textContent = gap;
    $('#posRows').appendChild(li);
  });
  if (!$('#results').hidden && RACE.done) renderResults();
}
function renderResults() {
  const list = raceEntries(), my = list.findIndex(e => e.me), lead = list[0];
  $('#resTitle').textContent = `第 ${my + 1} 名 · 共 ${list.length} 台`;
  const tb = $('#resRows'); tb.innerHTML = '';
  list.forEach((e, i) => {
    const tr = document.createElement('tr'); if (e.me) tr.className = 'me';
    const time = e.finT >= 0 ? (i === 0 || !(lead.finT >= 0) ? fmt(e.finT) : '+' + (e.finT - lead.finT).toFixed(3)) : `行駛中 L${Math.max(1, Math.min(setup.laps, e.lap || 1))}`;
    [i + 1, null, e.name, time, fmt(e.best)].forEach((v, j) => { const td = document.createElement('td'); if (j === 1) { const d = document.createElement('i'); d.style.background = e.color; td.appendChild(d); } else td.textContent = v; tr.appendChild(td); });
    tb.appendChild(tr);
  });
  $('#resAgain').hidden = setup.mode === 'online' && !NET.isHost;
}
$('#resAgain').onclick = () => startRace();
$('#resSetup').onclick = () => { $('#results').hidden = true; state.mode = 'menu'; prevMode = 'race'; $('#setup').hidden = false; drawEditor(); updateStartBtn(); };
$('#resWatch').onclick = () => { $('#results').hidden = true; };

// ---- online rooms (the page's live "room": presence carries each car's state, the earliest joiner hosts)
const NET = { api: null, room2: null, code: '', j: Date.now(), isHost: false, host: null, lastGo: null, myGo: null, sendT: 0, remote: new Map(), applied: '', trkReady: Promise.resolve(), connected: false };
const nick = () => ($('#nick').value.trim() || '車手').slice(0, 12);
(async () => { try { NET.api = window.claude && window.claude.use ? await window.claude.use('room') : null; } catch (e) { NET.api = null; } netUi(); })();
function netPlayers() {
  if (!NET.room2) return [];
  return NET.room2.peers().filter(p => p.presence && p.presence.tgp === 1).slice().sort((a, b) => (a.presence.j - b.presence.j) || (a.peer < b.peer ? -1 : 1));
}
function netMySlot() { const i = netPlayers().findIndex(p => p.sameTab); return Math.max(0, i); }
function myTrack() {
  if (setup.map === 'osm' || (setup.map === 'terrain' && (TER.source === 'file' || TER.meters))) return null;
  const pts = setup.map === 'taipei' ? trackPts.map(p => p.node) : trackPts.map(p => [+p.u.toFixed(4), +p.v.toFixed(4)]);
  return { m: setup.map, ps: TER.source, sd: TER.seed, sz: TER.size, rg: TER.range, bs: TER.base, w: setup.width, wl: setup.walls ? 1 : 0, bk: setup.banking ? 1 : 0, rv: setup.reverse ? 1 : 0, laps: setup.laps, pts };
}
const netCanHost = () => !!myTrack() && trackPts.length >= (setup.map === 'terrain' ? 4 : 3);
function netPresence() {
  if (!NET.room2) return;
  const racing = (state.mode === 'race' || state.mode === 'lights' || state.mode === 'menu') && RACE.on && setup.mode === 'online';
  const p = { tgp: 1, j: NET.j, nm: nick(), col: setup.color, st: racing ? (RACE.done ? 'fin' : 'race') : 'lobby', rgo: racing ? NET.lastGo : null,
    trk: NET.isHost ? myTrack() : null, go: NET.isHost ? NET.myGo : null };
  if (racing) {
    const q = carModel.root.quaternion;
    Object.assign(p, { x: +car.x.toFixed(2), y: +(car.y || 0).toFixed(2), z: +car.z.toFixed(2), q: [q.x, q.y, q.z, q.w].map(v => +v.toFixed(4)), v: +Math.hypot(car.vx, car.vy).toFixed(2),
      lat: +car.lat.toFixed(2), prog: +playerProgress().toFixed(1), lap: state.lap, fin: RACE.done ? +RACE.finT.toFixed(3) : null, best: isFinite(state.best) ? +state.best.toFixed(3) : null });
  } else Object.assign(p, { x: null, y: null, z: null, q: null, v: null, lat: null, prog: null, lap: null, fin: null, best: null });
  NET.room2.presence(p).catch(() => {});
}
function netTick(dt) {
  if (!NET.room2) return;
  NET.sendT += dt; const racing = setup.mode === 'online' && (state.mode === 'race' || state.mode === 'lights');
  if (NET.sendT >= (racing ? 1 / 15 : 0.5)) { NET.sendT = 0; netPresence(); }
}
const okColor = c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : '#9aa3ad';
function netOnPeers(ch) {
  const players = netPlayers(), host = players[0] || null;
  NET.host = host; NET.isHost = !!host && host.sameTab;
  if (host && !host.sameTab && host.presence.trk && setup.mode === 'online') NET.trkReady = netApplyTrack(host.presence.trk);
  if (host && !host.sameTab && host.presence.go && host.presence.go !== NET.lastGo && setup.mode === 'online') {
    NET.lastGo = host.presence.go; const go = NET.lastGo;
    NET.trkReady.then(() => { if (NET.lastGo === go) startRace(true); });
  }
  for (const p of ch.left) { const r = NET.remote.get(p.peer); if (r) { disposeModel(r.model); NET.remote.delete(p.peer); } }
  for (const p of players) {
    if (p.sameTab) continue;
    const pr = p.presence, inRace = setup.mode === 'online' && !!NET.lastGo && pr.rgo === NET.lastGo && typeof pr.x === 'number';
    let r = NET.remote.get(p.peer);
    if (!r && inRace) {
      const color = okColor(pr.col), name = String(pr.nm || '車手').slice(0, 12), model = buildCar(color, false, true);
      model.root.add(nameTag(name, color)); scene.add(model.root);
      r = { model, name, color, cur: null }; NET.remote.set(p.peer, r);
    }
    if (!r) continue;
    r.inRace = inRace; r.model.root.visible = inRace;
    if (!inRace) continue;
    Object.assign(r, { tx: pr.x, ty: pr.y, tz: pr.z, tq: Array.isArray(pr.q) ? pr.q : [0, 0, 0, 1], v: +pr.v || 0, lat: +pr.lat || 0, prog: +pr.prog || 0, lap: +pr.lap || 0, fin: typeof pr.fin === 'number' ? pr.fin : NaN, best: typeof pr.best === 'number' ? pr.best : Infinity, t: performance.now() });
  }
  if (!$('#setup').hidden) netUi(); else updateStartBtn();
}
const rq = new THREE.Quaternion(), rv = new THREE.Vector3();
function remoteStep(dt) {
  const now = performance.now();
  for (const r of NET.remote.values()) {
    if (!r.inRace || r.tx === undefined) continue;
    rq.set(r.tq[0], r.tq[1], r.tq[2], r.tq[3]).normalize();
    rv.set(1, 0, 0).applyQuaternion(rq);
    const lead = Math.min(0.25, (now - r.t) / 1000) * r.v, px = r.tx + rv.x * lead, pz = r.tz + rv.z * lead;
    const root = r.model.root, k = r.cur ? 1 - Math.exp(-dt * 10) : 1;
    root.position.x += (px - root.position.x) * k; root.position.z += (pz - root.position.z) * k; root.position.y = Hq(root.position.x, root.position.z);
    root.quaternion.slerp(rq, k); r.cur = true;
    r.x = root.position.x; r.z = root.position.z; rv.set(1, 0, 0).applyQuaternion(root.quaternion); r.psi = Math.atan2(-rv.z, rv.x);
    r.wheel = (r.wheel || 0) + r.v / SPEC.rw * dt; for (const w of r.model.wheels) w.spin.rotation.z = -r.wheel;
  }
}
function netShowMap(m) {
  setup.map = m;
  document.querySelectorAll('#mapTabs .tab').forEach(t => t.classList.toggle('sel', t.dataset.m === m));
  $('#terrainOpts').hidden = m !== 'terrain'; $('#taipeiOpts').hidden = m !== 'taipei'; $('#osmOpts').hidden = m !== 'osm'; $('#tpPresetGroup').hidden = m !== 'taipei';
  $('#baseField').hidden = m === 'taipei'; $('#banking').closest('label').hidden = m !== 'terrain';
  const M = m === 'terrain' ? null : CITY[m]; $('#mapCredit').hidden = !M; if (M) $('#mapCredit').textContent = M.credits;
}
async function netApplyTrack(trk) {
  const key = JSON.stringify(trk); if (key === NET.applied) return; NET.applied = key;
  try {
    if (trk.m === 'taipei') {
      $('#busy').textContent = '同步房主的賽道…'; $('#busy').hidden = false;
      const M = await loadTaipei(); $('#busy').hidden = true; netShowMap('taipei');
      const V = viewSize(M); trackPts = trk.pts.filter(id => id >= 0 && id < M.graph.x.length).map(id => ({ u: M.graph.x[id] / V + 0.5, v: M.graph.z[id] / V + 0.5, node: id }));
    } else {
      if (TER.source !== trk.ps || TER.seed !== trk.sd || TER.meters) { TER.seed = trk.sd; genPreset(PRESETS[trk.ps] ? trk.ps : 'hills', trk.sd); }
      netShowMap('terrain');
      $('#size').value = trk.sz; $('#range').value = trk.rg; $('#base').value = trk.bs;
      document.querySelectorAll('#presets .btn').forEach(x => x.classList.toggle('sel', x.dataset.p === trk.ps));
      trackPts = trk.pts.map(([u, v]) => ({ u: clamp(+u, 0, 1), v: clamp(+v, 0, 1) }));
    }
    $('#width').value = trk.w; $('#walls').checked = !!trk.wl; $('#banking').checked = !!trk.bk; $('#laps').value = trk.laps;
    setup.reverse = !!trk.rv; $('#btnRev').classList.toggle('sel', setup.reverse);
    readSetup(); syncLabels(); mapDirty = true; drawEditorBase(); refreshRoute(); drawEditor(); updateStartBtn();
  } catch (e) { $('#busy').hidden = true; }
}
function netHostGo() {
  NET.myGo = Math.random().toString(36).slice(2, 10); NET.lastGo = NET.myGo;
  netPresence(); startRace(true);
}
async function netJoin(code) {
  code = String(code || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10);
  if (code.length < 3) { $('#netHint').textContent = '房間代碼至少 3 個英數字。'; return; }
  if (!NET.api) return;
  try {
    if (NET.room2) await netLeave();
    $('#netHint').textContent = '連線中…';
    const room = await NET.api.join('tgp-' + code);
    NET.room2 = room; NET.code = code; NET.j = Date.now(); NET.lastGo = null; NET.applied = '';
    room.onPeers(netOnPeers, e => { $('#netHint').textContent = '房間連線已結束（' + e.code + '）。'; NET.room2 = null; netUi(); });
    room.onConnection(c => { NET.connected = c; netUi(); });
    netPresence(); netUi(); savePrefs();
  } catch (e) {
    $('#netHint').textContent = e && e.code === 'not_permitted' ? '這個檢視不能使用多人房間。' : e && e.code === 'limit_reached' ? '目前房間已滿，請稍後再試。' : '加入失敗，請稍後再試。';
  }
}
async function netLeave() {
  const r = NET.room2; NET.room2 = null; NET.isHost = false; NET.lastGo = null;
  for (const x of NET.remote.values()) disposeModel(x.model); NET.remote.clear();
  if (r) { try { await r.leave(); } catch (e) { /* already gone */ } }
  netUi();
}
function netUi() {
  const has = !!NET.api, inRoom = !!NET.room2;
  $('#netOff').hidden = has; $('#netJoinRow').hidden = !has || inRoom; $('#netRoom').hidden = !inRoom;
  if (inRoom) {
    $('#netCodeShow').textContent = NET.code;
    const players = netPlayers(), ul = $('#roster'); ul.innerHTML = '';
    players.forEach((p, i) => {
      const li = document.createElement('li'), pr = p.presence, dot = document.createElement('i'), nm = document.createElement('span'), st = document.createElement('em');
      dot.style.background = okColor(pr.col); nm.textContent = String(pr.nm || '車手').slice(0, 12) + (p.sameTab ? '（你）' : '');
      st.textContent = (i === 0 ? '房主 · ' : '') + (pr.st === 'race' ? '比賽中' : pr.st === 'fin' ? '已完賽' : '大廳');
      li.append(dot, nm, st); ul.appendChild(li);
    });
    if (!players.length) { const li = document.createElement('li'); li.textContent = NET.connected ? '等待其他車手加入…' : '連線中…'; ul.appendChild(li); }
    $('#netHint').textContent = NET.isHost
      ? (netCanHost() ? '你是房主：選好地圖與賽道後按「開始比賽」，所有人會一起起跑。把房間代碼傳給朋友。' : '線上對戰只支援內建地形與臺北街道賽，自訂高度圖或 OSM 檔無法同步給其他人。')
      : `賽道由房主決定並自動同步，等房主按開始。`;
  }
  updateStartBtn();
}
$('#netCreate').onclick = () => { const a = 'abcdefghjkmnpqrstuvwxyz23456789'; let c = ''; for (let i = 0; i < 5; i++) c += a[Math.floor(Math.random() * a.length)]; $('#netCode').value = c; netJoin(c); };
$('#netJoin').onclick = () => netJoin($('#netCode').value);
$('#netLeave').onclick = () => netLeave();
$('#netCopy').onclick = () => { const t = NET.code; if (navigator.clipboard) navigator.clipboard.writeText(t).then(() => { $('#netCopy').textContent = '已複製'; setTimeout(() => { $('#netCopy').textContent = '複製代碼'; }, 1500); }).catch(() => {}); };
$('#nick').addEventListener('change', () => { savePrefs(); netPresence(); });
document.querySelectorAll('#raceMode button').forEach(b => b.onclick = () => { setup.mode = b.dataset.r; applyRaceMode(); });
function applyRaceMode() {
  document.querySelectorAll('#raceMode button').forEach(x => x.classList.toggle('sel', x.dataset.r === setup.mode));
  $('#lapsGroup').hidden = setup.mode === 'solo'; $('#aiGroup').hidden = setup.mode !== 'ai'; $('#netGroup').hidden = setup.mode !== 'online';
  if (setup.mode !== 'online' && NET.room2) netLeave();
  netUi();
}

/* ================= Main loop ================= */
let last = performance.now(), acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const rawDt = (now - last) / 1000, dt = Math.min(0.05, rawDt); last = now;
  probeFps(rawDt);
  if (state.mode === 'race' || state.mode === 'lights') readInput(dt);
  if (state.mode === 'lights') {
    state.lightsT += dt; const on = Math.min(5, Math.floor(state.lightsT / 0.8)), out = state.lightsT >= state.lightsOut;
    [...$('#lights').children].forEach((l, i) => l.classList.toggle('on', !out && i < on));
    car.thr = inp.thr; car.brk = inp.brk; car.rpm += ((SPEC.idle + inp.thr * 8000) - car.rpm) * Math.min(1, dt * 8);
    if (out) { state.mode = 'race'; state.t = 0; if (RACE.on) { state.lap = 0; state.lapStart = 0; } else startLap(); state.lastK = car.k; RACE.go(); setTimeout(() => { $('#lights').hidden = true; }, 600); banner('出發！', 'info'); }
  } else if (state.mode === 'race') {
    gearLogic(dt, inp);
    if (drsReq && W.drs[car.k]) car.drs = true;
    drsReq = false;
    if (car.drs && (!W.drs[car.k] || inp.brk > 0.1)) car.drs = false;
    acc += dt;
    while (acc >= DT) { physicsStep(DT, inp); acc -= DT; state.t += DT; }
    raceUpdate();
    opponentsStep(dt);
  }
  updateCarVisual();
  if (state.mode === 'race' && !RACE.on) { recordGhost(); showGhost(); } else ghostModel.root.visible = false;
  const spd = Math.hypot(car.vx, car.vy);
  shake = car.surf === 3 ? Math.min(0.16, spd * 0.006) : car.surf === 2 && !W.city ? Math.min(0.1, spd * 0.003) : car.surf === 1 ? Math.min(0.05, spd * 0.0015) : 0;
  if (state.mode === 'menu0') { const t = now / 1000 * 0.08, R = 26; camera.position.set(car.x + Math.cos(t) * R, (car.y || 0) + 9, car.z + Math.sin(t) * R); camera.up.copy(UP); camera.lookAt(car.x, (car.y || 0) + 0.5, car.z); }
  else updateCamera(dt);
  sky.position.copy(camera.position); SKY_U.time.value = now / 1000;
  TEX.waterN.offset.set(now * 0.000011, now * 0.000006);
  if (POST.on && POST.comp) { POST.grade.uniforms.time.value = (now / 1000) % 100; POST.comp.render(); } else renderer.render(scene, camera);
  if (bannerT > 0) { bannerT -= dt; if (bannerT <= 0) $('#banner').classList.remove('show'); }
  remoteStep(dt); netTick(dt);
  hud(dt); standingsHud(dt); updateAudio();
}

/* ================= Boot ================= */
genPreset('hills', TER.seed);
trackPts = randomTrack(20251019);
loadPrefs(); readSetup(); syncLabels(); applyControls(); applyRaceMode();
applyQuality(setup.quality === 'auto' ? autoLevel() : setup.quality);
if (!COARSE && innerWidth >= 900) { $('#tele').hidden = false; $('#bTele').classList.add('on'); }
drawEditorBase();
buildWorld(); mapDirty = false;
resetRace(); placeCar(3, 0);
requestAnimationFrame(() => { drawEditor(); updateStartBtn(); });
requestAnimationFrame(frame);
})();
