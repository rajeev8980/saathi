// Generate PWA icons (blue rounded square + white heart) as real PNGs
// using only Node's built-in zlib — no dependencies.
import zlib from 'zlib';
import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';

const OUT = fileURLToPath(new URL('../public/icons/', import.meta.url));
mkdirSync(OUT, { recursive: true });

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xFFFFFFFF;
  for (const b of buf) crc = table[(crc ^ b) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function makePNG(size, pixels) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function draw(size, fullBleed) {
  const px = Buffer.alloc(size * size * 4);
  const s = size, cx = s / 2;
  const r = fullBleed ? 0 : Math.round(s * 0.22);
  const inHeart = (x, y) => {
    const rr = s * 0.13, cy = s * 0.40;
    const c1x = cx - s * 0.13, c2x = cx + s * 0.13;
    if ((x - c1x) ** 2 + (y - cy) ** 2 <= rr * rr) return true;
    if ((x - c2x) ** 2 + (y - cy) ** 2 <= rr * rr) return true;
    const y0 = cy, y1 = cy + s * 0.34;
    if (y < y0 || y > y1) return false;
    const half = s * 0.26 * (1 - (y - y0) / (y1 - y0));
    return Math.abs(x - cx) <= half;
  };
  const inRounded = (x, y) => {
    if (!r) return true;
    const rr = r * r;
    if (x >= r && x < s - r) return true;
    if (y >= r && y < s - r) return true;
    const dx = x < r ? x - r : x - (s - r - 1);
    const dy = y < r ? y - r : y - (s - r - 1);
    return dx * dx + dy * dy <= rr;
  };
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const i = (y * s + x) * 4;
      if (!inRounded(x, y)) { px[i + 3] = 0; continue; }
      if (inHeart(x, y)) { px[i] = 255; px[i + 1] = 255; px[i + 2] = 255; }
      else { px[i] = 0x2e; px[i + 1] = 0x63; px[i + 2] = 0xf6; }
      px[i + 3] = 255;
    }
  }
  return px;
}

writeFileSync(OUT + 'icon-192.png', makePNG(192, draw(192, false)));
writeFileSync(OUT + 'icon-512.png', makePNG(512, draw(512, false)));
writeFileSync(OUT + 'icon-maskable-512.png', makePNG(512, draw(512, true)));
console.log('icons written to', OUT);
