/**
 * 从 public/favicon.svg 生成全平台图标。
 *  - PNG: 16/32/48/180/192/512
 *  - favicon.ico: 内嵌 16/32/48 PNG（Vista+ 兼容格式）
 *  - manifest.webmanifest: PWA 桌面图标声明
 * 用法: node scripts/generate-favicon.mjs
 */
import sharp from 'sharp';
import {writeFile, mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'public');
const src = path.join(pub, 'favicon.svg');

await mkdir(pub, {recursive: true});

/** 渲染某个尺寸的 PNG buffer */
const render = size => sharp(src, {density: 512}).resize(size, size).png().toBuffer();

const sizes = [16, 32, 48, 180, 192, 512];
const buffers = {};
for (const size of sizes) {
  buffers[size] = await render(size);
  const name = size === 180 ? 'apple-touch-icon.png'
    : (size === 192 || size === 512) ? `android-chrome-${size}.png`
    : `favicon-${size}.png`;
  await writeFile(path.join(pub, name), buffers[size]);
  console.log('PNG', name, buffers[size].length, 'bytes');
}

/** 手写一个把 PNG 直接嵌入的 ICO 容器 */
function buildIco(entries) {
  const count = entries.length;
  const header = Buffer.alloc(6 + 16 * count);
  header.writeUInt16LE(0, 0);       // reserved
  header.writeUInt16LE(1, 2);       // type: icon
  header.writeUInt16LE(count, 4);   // image count
  let offset = header.length;
  entries.forEach((e, i) => {
    const base = 6 + 16 * i;
    header.writeUInt8(e.size >= 256 ? 0 : e.size, base);      // width
    header.writeUInt8(e.size >= 256 ? 0 : e.size, base + 1);  // height
    header.writeUInt8(0, base + 2);   // palette count
    header.writeUInt8(0, base + 3);   // reserved
    header.writeUInt16LE(1, base + 4);  // color planes
    header.writeUInt16LE(32, base + 6); // bits per pixel
    header.writeUInt32LE(e.buf.length, base + 8);  // size of image data
    header.writeUInt32LE(offset, base + 12);       // offset of image data
    offset += e.buf.length;
  });
  return Buffer.concat([header, ...entries.map(e => e.buf)]);
}

const ico = buildIco([16, 32, 48].map(size => ({size, buf: buffers[size]})));
await writeFile(path.join(pub, 'favicon.ico'), ico);
console.log('ICO favicon.ico', ico.length, 'bytes');

const manifest = {
  name: 'FLOWLINE · 中文说唱人物关系图谱',
  short_name: 'FLOWLINE',
  description: '按省份探索中文说唱人物、作品与关系。',
  start_url: '.',
  scope: '.',
  display: 'standalone',
  background_color: '#080606',
  theme_color: '#171310',
  icons: [
    {src: 'android-chrome-192.png', sizes: '192x192', type: 'image/png', purpose: 'any'},
    {src: 'android-chrome-512.png', sizes: '512x512', type: 'image/png', purpose: 'any'},
    {src: 'android-chrome-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable'},
  ],
};
await writeFile(path.join(pub, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2) + '\n');
console.log('manifest.webmanifest written');
