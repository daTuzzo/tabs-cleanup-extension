// One-shot: writes simple solid-color rounded-square PNG icons with no deps.
// Run: node make-icons.js
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function makePng(size, drawPixel) {
  // RGBA raw with one filter byte (0 = None) per row.
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    row[0] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = drawPixel(x, y, size);
      const o = 1 + x * 4;
      row[o] = r; row[o+1] = g; row[o+2] = b; row[o+3] = a;
    }
    rows.push(row);
  }
  const idatRaw = Buffer.concat(rows);
  const idat = zlib.deflateSync(idatRaw);

  const sig = Buffer.from([137,80,78,71,13,10,26,10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;     // bit depth
  ihdr[9] = 6;     // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

function draw(x, y, size) {
  const cx = size / 2, cy = size / 2;
  const radius = size * 0.22;
  // Rounded square mask.
  const insetX = Math.max(0, Math.abs(x - cx) - (size/2 - radius));
  const insetY = Math.max(0, Math.abs(y - cy) - (size/2 - radius));
  const cornerDist = Math.sqrt(insetX*insetX + insetY*insetY);
  if (cornerDist > radius) return [0,0,0,0];

  // Gradient violet.
  const t = y / size;
  const r = Math.round(108 + (124 - 108) * t);
  const g = Math.round(75  + (92  - 75)  * t);
  const b = Math.round(220 + (255 - 220) * t);

  // Draw a simple "broom"/"sweep" mark: a diagonal stripe of lighter pixels.
  const dx = (x - cx) / size;
  const dy = (y - cy) / size;
  const diag = dx + dy;
  if (diag > -0.05 && diag < 0.05) return [255,255,255,235];
  if (diag > 0.10 && diag < 0.18) return [255,255,255,160];

  return [r, g, b, 255];
}

const sizes = [16, 32, 48, 128];
const outDir = path.join(__dirname, "..", "extension", "icons");
fs.mkdirSync(outDir, { recursive: true });
for (const s of sizes) {
  const png = makePng(s, draw);
  fs.writeFileSync(path.join(outDir, `icon${s}.png`), png);
  console.log(`wrote icon${s}.png (${png.length} bytes)`);
}
