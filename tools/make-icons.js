/* ===================================================================
   App icons, rendered from the game's own geometry.

   No image editor, no binary that nobody can regenerate: the icon is
   the target card under its lamp, drawn with the same silhouette
   polygon the game hit-tests against, and written out with a minimal
   PNG encoder (zlib is built into Node). Run `npm run icons` after
   changing the card and commit the result.

   Outputs (lane7/icons/):
     icon-192.png, icon-512.png     rounded, transparent corners ("any")
     icon-maskable-512.png          full bleed, card inside the safe zone
     apple-touch-icon.png (180)     full bleed, iOS rounds it itself
     favicon-32.png                 rounded
   =================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const CONFIG = require("../lane7/src/config.js");
const Shapes = require("../lane7/src/shapes.js");

/* ---------- minimal PNG writer: RGBA 8-bit, filter 0 ---------- */
const CRC = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  CRC[n] = c >>> 0;
}
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePng(w, h, rgba) {
  const stride = w * 4 + 1, raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) { raw[y * stride] = 0; rgba.copy(raw, y * stride + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))
  ]);
}

/* ---------- the picture, as a function of (u, v) in 0..1 ---------- */
const T = CONFIG.target;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const smooth = (edge0, edge1, x) => { const t = clamp((x - edge0) / (edge1 - edge0), 0, 1); return t * t * (3 - 2 * t); };

// opts: { rounded: corner radius as a fraction of the side (0 = square), inset: how far the card shrinks toward the centre }
function shade(u, v, opts) {
  // Rounded-square mask.
  let alpha = 1;
  if (opts.rounded > 0) {
    const r = opts.rounded, cx = clamp(u, r, 1 - r), cy = clamp(v, r, 1 - r);
    const d = Math.hypot(u - cx, v - cy);
    alpha = 1 - smooth(r - 0.004, r + 0.004, d);
    if (alpha <= 0) return [0, 0, 0, 0];
  }

  // Bay: cold gloom, a shade lighter toward the top where the lamp hangs.
  let R = lerp(11, 6, v), G = lerp(16, 9, v), B = lerp(18, 10, v);

  // Lamp pool: warm, centred just above the card.
  const lampD = Math.hypot((u - 0.5) * 1.05, (v - 0.22) * 0.9);
  const pool = Math.pow(clamp(1 - lampD / 0.72, 0, 1), 1.6);
  R += 232 * 0.42 * pool; G += 199 * 0.42 * pool; B += 122 * 0.42 * pool;

  // Card: manila with a silhouette, in card-local units so the head and
  // body are exactly what the game scores.
  const cardW = 0.50 * (1 - opts.inset), cardH = cardW * (T.cardH / T.cardW);
  const ccx = 0.5, ccy = 0.56;
  const s = cardW / T.cardW;
  const lx = (u - ccx) / s;
  const ly = (v - ccy) / s + (T.cardTop + T.cardH / 2);          // card centre in local y
  const halfW = T.cardW / 2, top = T.cardTop, bottom = T.cardTop + T.cardH;
  const inCard = Math.abs(lx) <= halfW && ly >= top && ly <= bottom;

  // Soft shadow under and to the right of the card.
  const sx = lx - 14, sy = ly - 18;
  const shadowIn = Math.abs(sx) <= halfW + 6 && sy >= top - 6 && sy <= bottom + 6;
  if (shadowIn && !inCard) { R *= 0.55; G *= 0.55; B *= 0.55; }

  if (inCard) {
    const edge = Math.min(halfW - Math.abs(lx), ly - top, bottom - ly);
    const zone = Shapes.zoneLocal(lx, ly, T);
    if (zone === "head" || zone === "body") { R = 20; G = 16; B = 14; }
    else { R = 216 - 10 * (ly - top) / T.cardH * 3; G = 201 - 10 * (ly - top) / T.cardH * 3; B = 168 - 10 * (ly - top) / T.cardH * 3; }
    // Printed ring around the head, dashed in the game, solid here.
    const hd = Math.hypot(lx, ly - T.headY);
    if (zone === "head" && Math.abs(hd - (T.headR - 5)) < 1.6) { R = 120; G = 108; B = 84; }
    // Border.
    if (edge < 2.2) { R *= 0.72; G *= 0.72; B *= 0.72; }
    // One hole, high in the head: the icon is a head shot.
    const hx = lx - 5, hy = ly - (T.headY - 3);
    const hr = Math.hypot(hx, hy);
    if (hr < 7.5) { R = 236; G = 226; B = 200; }
    if (hr < 4.6) { R = 8; G = 7; B = 6; }
    // The lamp lights the card too.
    const lift = 1 + 0.18 * pool;
    R *= lift; G *= lift; B *= lift;
  }

  // Vignette toward the corners.
  const vd = Math.hypot(u - 0.5, v - 0.5);
  const vig = 1 - 0.45 * smooth(0.45, 0.8, vd);
  R *= vig; G *= vig; B *= vig;

  return [clamp(R, 0, 255), clamp(G, 0, 255), clamp(B, 0, 255), alpha];
}

function render(size, opts) {
  const SS = 3, buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const p = shade((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size, opts);
        r += p[0] * p[3]; g += p[1] * p[3]; b += p[2] * p[3]; a += p[3];
      }
      const i = (y * size + x) * 4;
      if (a > 0) { buf[i] = Math.round(r / a); buf[i + 1] = Math.round(g / a); buf[i + 2] = Math.round(b / a); }
      buf[i + 3] = Math.round(255 * a / (SS * SS));
    }
  }
  return encodePng(size, size, buf);
}

const out = path.join(__dirname, "..", "lane7", "icons");
fs.mkdirSync(out, { recursive: true });
const jobs = [
  ["icon-512.png",          512, { rounded: 0.2,  inset: 0 }],
  ["icon-192.png",          192, { rounded: 0.2,  inset: 0 }],
  ["icon-maskable-512.png", 512, { rounded: 0,    inset: 0.2 }],   // safe zone is the inner 80%
  ["apple-touch-icon.png",  180, { rounded: 0,    inset: 0 }],
  ["favicon-32.png",         32, { rounded: 0.2,  inset: 0 }]
];
for (const [name, size, opts] of jobs) {
  const png = render(size, opts);
  fs.writeFileSync(path.join(out, name), png);
  console.log(`${name.padEnd(24)} ${size}×${size}  ${(png.length / 1024).toFixed(1)} KB`);
}
