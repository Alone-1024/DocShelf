// 把 build/icon 下的 BMP/PNG 合成为 build/icon.ico
// ≤48px 用未压缩 DIB（老 shell 也认），≥64px 用 PNG 条目（256 必须 PNG）
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'icon');
const out = path.join(__dirname, 'icon.ico');
const DIB = [16, 24, 32, 48];
const PNG = [64, 128, 256];

function readBmp(file) {
  const b = fs.readFileSync(file);
  const off = b.readUInt32LE(10);
  const w = b.readInt32LE(18);
  const h = b.readInt32LE(22); // 正数=自下而上
  const bpp = b.readUInt16LE(28);
  if (bpp !== 32) throw new Error(path.basename(file) + ' 不是 32bpp: ' + bpp);
  return { w, h: Math.abs(h), pixels: b.subarray(off, off + w * Math.abs(h) * 4) };
}

function dibEntry(w, h, pixels) {
  const head = Buffer.alloc(40);
  head.writeUInt32LE(40, 0);
  head.writeInt32LE(w, 4);
  head.writeInt32LE(h * 2, 8); // GDI 语义：图像 + AND 掩码
  head.writeUInt16LE(1, 12);
  head.writeUInt16LE(32, 14);
  head.writeUInt32LE(0, 16); // BI_RGB, 无压缩
  // AND 掩码：1bpp，每行补齐到 4 字节，全 0 表示完全按 alpha 走
  const maskStride = Math.ceil(w / 32) * 4;
  const mask = Buffer.alloc(maskStride * h);
  return Buffer.concat([head, pixels, mask]);
}

const entries = [];
for (const s of DIB) entries.push({ size: s, data: dibEntry(s, s, readBmp(path.join(dir, `icon-${s}.bmp`)).pixels) });
for (const s of PNG) entries.push({ size: s, data: fs.readFileSync(path.join(dir, `icon-${s}.png`)) });

const count = entries.length;
const headerSize = 6 + count * 16;
let offset = headerSize;
const dir_ = Buffer.alloc(count * 16);
const bodies = [];
entries.forEach((e, i) => {
  const p = i * 16;
  dir_[p] = e.size === 256 ? 0 : e.size;
  dir_[p + 1] = e.size === 256 ? 0 : e.size;
  dir_.writeUInt16LE(1, p + 4);
  dir_.writeUInt16LE(32, p + 6);
  dir_.writeUInt32LE(e.data.length, p + 8);
  dir_.writeUInt32LE(offset, p + 12);
  offset += e.data.length;
  bodies.push(e.data);
});
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(count, 4);
fs.writeFileSync(out, Buffer.concat([header, dir_, ...bodies]));
console.log('wrote', out, fs.statSync(out).size, 'bytes,', count, 'sizes:', entries.map(e => e.size).join(','));
