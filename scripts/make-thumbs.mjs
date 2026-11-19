/**
 * 从 src/assets/avatars 的原图生成 160px 缩略图到 src/assets/thumbs。
 * 今日首屏走廊飞卡用缩略图：24 张原图合计 1.4M，缩略图仅 ~160K。
 * 依赖系统 ffmpeg（本项目无 sharp/PIL）。新增头像后跑一次 `npm run thumbs` 即可。
 */
import {readdirSync, mkdirSync, existsSync} from 'node:fs';
import {join, basename, extname} from 'node:path';
import {execFileSync} from 'node:child_process';

const root = process.cwd();
const src = join(root, 'src/assets/avatars');
const out = join(root, 'src/assets/thumbs');
if (!existsSync(src)) { console.error('找不到头像目录', src); process.exit(1); }
mkdirSync(out, {recursive: true});

const files = readdirSync(src).filter(f => /\.(png|webp|jpe?g)$/i.test(f));
let made = 0;
for (const file of files) {
  const stem = basename(file, extname(file));
  try {
    execFileSync('ffmpeg', [
      '-y', '-loglevel', 'error', '-i', join(src, file),
      '-vf', 'scale=160:-2', '-q:v', '6', join(out, `${stem}.jpg`),
    ], {stdio: 'pipe'});
    made += 1;
  } catch (error) {
    console.error('缩略图生成失败:', file, error.stderr?.toString() || error.message);
  }
}
console.log(`已生成 ${made}/${files.length} 张缩略图到 ${out}`);
