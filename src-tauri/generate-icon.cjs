#!/usr/bin/env node
"use strict";
// Generates a 512x512 source PNG (icons/icon.png) with no external deps.
// Mark: rounded dark tile + amber "run" (play) triangle + bold "JS" wordmark.
// Rendered at 2x and downsampled (premultiplied) for smooth, anti-aliased edges.
//   pnpm icons        (=> tauri icon src-tauri/icons/icon.png)
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

const OUT = 512;
const SS = 2;
const W = OUT * SS;
const hi = Buffer.alloc(W * W * 4);

function lerp(a, b, t) {
  return a + (b - a) * t;
}
function clamp01(t) {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}
function rrDist(x, y, x0, y0, x1, y1, r) {
  const qx = Math.abs(x - (x0 + x1) / 2) - (x1 - x0) / 2 + r;
  const qy = Math.abs(y - (y0 + y1) / 2) - (y1 - y0) / 2 + r;
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.sqrt(ax * ax + ay * ay) + Math.min(Math.max(qx, qy), 0) - r;
}
function edge(px, py, a, b) {
  return (px - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (py - b[1]);
}
function inTriangle(px, py, tri) {
  const d1 = edge(px, py, tri[0], tri[1]);
  const d2 = edge(px, py, tri[1], tri[2]);
  const d3 = edge(px, py, tri[2], tri[0]);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}
function distSeg(px, py, a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1];
  const wx = px - a[0], wy = py - a[1];
  const c2 = vx * vx + vy * vy;
  let t = c2 ? (vx * wx + vy * wy) / c2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = px - (a[0] + t * vx), dy = py - (a[1] + t * vy);
  return Math.sqrt(dx * dx + dy * dy);
}
function polyDist(px, py, pts) {
  let m = 1e9;
  for (let i = 0; i < pts.length - 1; i++) m = Math.min(m, distSeg(px, py, pts[i], pts[i + 1]));
  return m;
}

// geometry (512-space)
const TILE = { x0: 16, y0: 16, x1: 496, y1: 496, r: 112 };
const TRI = [
  [150, 150],
  [150, 362],
  [298, 256],
];
// "JS" built from straight strokes + smooth generated arcs (round caps come for
// free from segment distance), so the glyphs read clean instead of hand-drawn.
function arc(cx, cy, r, a0, a1, steps) {
  const n = steps || 28;
  const p = [];
  for (let i = 0; i <= n; i++) {
    const a = ((a0 + (a1 - a0) * (i / n)) * Math.PI) / 180;
    p.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return p;
}

// J: top bar + vertical stem + bottom hook.
const J_BAR = [
  [338, 174],
  [388, 174],
];
const J_STEM = [
  [376, 174],
  [376, 298],
];
const J_HOOK = arc(351, 298, 25, 0, 150, 22); // stem bottom -> down -> up-left

// S: two stacked bowls that meet at the middle (429,236).
//   upper bowl: from top-right, over the top, down the left, to the middle
//   lower bowl: from the middle, down the right, along the bottom, to bottom-left
const S_TOP = arc(429, 211, 25, -38, -270, 30);
const S_BOT = arc(429, 261, 25, -90, 148, 30);

const LETTERS = [J_BAR, J_STEM, J_HOOK, S_TOP, S_BOT];
const LETTER_HALF = 12;

function sample(x, y) {
  const dTile = rrDist(x, y, TILE.x0, TILE.y0, TILE.x1, TILE.y1, TILE.r);
  const a = clamp01(0.5 - dTile);
  if (a <= 0) return [0, 0, 0, 0];

  const ty = clamp01((y - TILE.y0) / (TILE.y1 - TILE.y0));
  let r = lerp(0x17, 0x0b, ty);
  let g = lerp(0x1c, 0x0e, ty);
  let b = lerp(0x23, 0x12, ty);
  const hl = clamp01(1 - (y - TILE.y0) / 90) * 0.06;
  r += 255 * hl;
  g += 255 * hl;
  b += 255 * hl;

  // play triangle (amber gradient)
  if (inTriangle(x, y, TRI)) {
    const t = clamp01((x + y - 300) / 256);
    r = lerp(0xff, 0xf3, t);
    g = lerp(0xc2, 0x94, t);
    b = lerp(0x47, 0x13, t);
  }

  // JS wordmark (near-white for two-tone contrast)
  let dLetters = 1e9;
  for (const poly of LETTERS) dLetters = Math.min(dLetters, polyDist(x, y, poly));
  if (dLetters <= LETTER_HALF) {
    r = 0xed;
    g = 0xef;
    b = 0xf2;
  }

  return [r, g, b, 255 * a];
}

for (let y = 0; y < W; y++) {
  for (let x = 0; x < W; x++) {
    const c = sample((x + 0.5) / SS, (y + 0.5) / SS);
    const i = (y * W + x) * 4;
    hi[i] = Math.round(c[0]);
    hi[i + 1] = Math.round(c[1]);
    hi[i + 2] = Math.round(c[2]);
    hi[i + 3] = Math.round(c[3]);
  }
}

const out = Buffer.alloc(OUT * OUT * 4);
for (let y = 0; y < OUT; y++) {
  for (let x = 0; x < OUT; x++) {
    let pr = 0, pg = 0, pb = 0, pa = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const i = ((y * SS + sy) * W + (x * SS + sx)) * 4;
        const al = hi[i + 3] / 255;
        pr += hi[i] * al;
        pg += hi[i + 1] * al;
        pb += hi[i + 2] * al;
        pa += al;
      }
    }
    const o = (y * OUT + x) * 4;
    if (pa === 0) {
      out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
    } else {
      out[o] = Math.round(pr / pa);
      out[o + 1] = Math.round(pg / pa);
      out[o + 2] = Math.round(pb / pa);
      out[o + 3] = Math.round((pa / (SS * SS)) * 255);
    }
  }
}

// PNG encode
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(OUT, 0);
ihdr.writeUInt32BE(OUT, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const raw = Buffer.alloc(OUT * (OUT * 4 + 1));
for (let y = 0; y < OUT; y++) {
  raw[y * (OUT * 4 + 1)] = 0;
  out.copy(raw, y * (OUT * 4 + 1) + 1, y * OUT * 4, (y + 1) * OUT * 4);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);
const file = path.join(__dirname, "icons", "icon.png");
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, png);
console.log("wrote " + file + " (" + png.length + " bytes)");
