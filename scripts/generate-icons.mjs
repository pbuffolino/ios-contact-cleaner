// Generates PNG app icons with zero dependencies (built-in zlib only).
// Draws a simple "contact card" glyph on the app's accent blue.
// Run: node scripts/generate-icons.mjs

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ACCENT = [10, 132, 255];
const WHITE = [255, 255, 255];

function makeCanvas(size) {
  const px = new Uint8Array(size * size * 4);
  const set = (x, y, [r, g, b], a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = a;
  };
  const fillRoundRect = (x0, y0, w, h, rad, color) => {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    w = Math.round(w);
    h = Math.round(h);
    rad = Math.round(rad);
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const dx = Math.min(x - x0, x0 + w - 1 - x);
        const dy = Math.min(y - y0, y0 + h - 1 - y);
        if (dx < rad && dy < rad) {
          const cx = dx < rad ? x0 + (x - x0 < w / 2 ? rad : w - 1 - rad) : x;
          const cy = dy < rad ? y0 + (y - y0 < h / 2 ? rad : h - 1 - rad) : y;
          if ((x - cx) ** 2 + (y - cy) ** 2 > rad * rad) continue;
        }
        set(x, y, color);
      }
    }
  };
  const fillCircle = (cx, cy, r, color) => {
    cx = Math.round(cx);
    cy = Math.round(cy);
    r = Math.round(r);
    for (let y = cy - r; y <= cy + r; y++)
      for (let x = cx - r; x <= cx + r; x++)
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) set(x, y, color);
  };
  return { px, set, fillRoundRect, fillCircle };
}

function drawIcon(size) {
  const c = makeCanvas(size);
  c.fillRoundRect(0, 0, size, size, size * 0.22, ACCENT); // app tile bg
  const m = size * 0.2;
  const cardW = size - 2 * m;
  const cardH = size - 2 * m;
  c.fillRoundRect(m, m + cardH * 0.08, cardW, cardH * 0.84, size * 0.06, WHITE); // white card
  // avatar head + shoulders
  const cx = m + cardW * 0.3;
  const headY = m + cardH * 0.36;
  c.fillCircle(Math.round(cx), Math.round(headY), Math.round(size * 0.075), ACCENT);
  c.fillRoundRect(
    cx - size * 0.11,
    headY + size * 0.09,
    size * 0.22,
    size * 0.13,
    size * 0.05,
    ACCENT
  );
  // detail lines
  const lineX = m + cardW * 0.52;
  const lineW = cardW * 0.34;
  for (let k = 0; k < 3; k++) {
    const ly = m + cardH * 0.36 + k * size * 0.09;
    c.fillRoundRect(lineX, ly, lineW, size * 0.03, size * 0.015, ACCENT);
  }
  return c.px;
}

// ---- minimal PNG encoder ----
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.subarray(y * size * 4, (y + 1) * size * 4).forEach((v, i) => {
      raw[y * (size * 4 + 1) + 1 + i] = v;
    });
  }
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const outDir = fileURLToPath(new URL("../icons/", import.meta.url));
mkdirSync(outDir, { recursive: true });
for (const size of [192, 512]) {
  writeFileSync(outDir + `icon-${size}.png`, encodePng(size, drawIcon(size)));
  console.log(`wrote icons/icon-${size}.png`);
}
