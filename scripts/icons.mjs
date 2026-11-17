// Draws the app icons as PNG files, with no dependencies: `node scripts/icons.mjs`.
// The icon is three rows of different lengths (cells at different scales) crossed by the "now" line.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]), sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
};
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const PAPER = hex('#1a1b19'), NOW = hex('#ff7a4d'), BARS = [hex('#8089f2'), hex('#4cc0d4'), hex('#63c487')];

// coverage (0..1) of a rounded rectangle at a pixel, with soft edges
const rrect = (px, py, x, y, w, h, r) => {
  const dx = Math.max(x + r - px, px - (x + w - r), 0), dy = Math.max(y + r - py, py - (y + h - r), 0);
  return Math.max(0, Math.min(1, r - Math.hypot(dx, dy) + 0.5));
};

function icon(size, pad, round) {
  const raw = Buffer.alloc((size * 4 + 1) * size), inner = size - 2 * pad, u = inner / 100;
  const shapes = [
    ...BARS.map((c, i) => ({ c, x: pad + 20 * u, y: pad + (24 + i * 21) * u, w: [60, 42, 26][i] * u, h: 12 * u, r: 4 * u })),
    { c: NOW, x: pad + 10 * u, y: pad + 60.5 * u, w: 80 * u, h: 3 * u, r: 1.5 * u },
    { c: NOW, x: pad + 8 * u, y: pad + 58 * u, w: 8 * u, h: 8 * u, r: 4 * u },
  ];
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let [r, g, b] = PAPER;
      for (const s of shapes) { const a = rrect(x + 0.5, y + 0.5, s.x, s.y, s.w, s.h, s.r); r += (s.c[0] - r) * a; g += (s.c[1] - g) * a; b += (s.c[2] - b) * a; }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
      raw[o + 3] = Math.round(255 * (round ? rrect(x + 0.5, y + 0.5, 0, 0, size, size, size * round) : 1));
    }
  }
  const head = Buffer.alloc(13); head.writeUInt32BE(size, 0); head.writeUInt32BE(size, 4); head[8] = 8; head[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

writeFileSync('web/icon-192.png', icon(192, 0, 0.22));
writeFileSync('web/icon-512.png', icon(512, 0, 0.22));
writeFileSync('web/icon-maskable-512.png', icon(512, 64, 0));      // extra margin: launchers crop maskable icons
writeFileSync('web/apple-touch-icon.png', icon(180, 0, 0));        // iOS rounds the corners itself
console.log('icons written to web/');
