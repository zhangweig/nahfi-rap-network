import {avatarPath} from '../components/PixelAvatar';
import type {ArtistNode} from '../data/types';

/**
 * 竖版分享海报（1080×1440，3:4，适合小红书 / 微博 / 朋友圈）。
 *
 * 纯 canvas 手绘，不引第三方截图库：DOM 转图片那类方案在移动端和跨域字体上
 * 都会翻车，而这里要画的东西本来就少（头像 + 名字 + 三行数据 + 三条关系），
 * 自己画反而更可控、更快。
 *
 * 头像可能来自外链（管理员填的 HTTPS 直链），此时 canvas 会被「污染」，
 * toBlob 会抛 SecurityError。所以统一 crossOrigin=anonymous 加载，失败就
 * 退回像素占位块，宁可少一张图也不能让整个分享流程报错。
 */

const W = 1080;
const H = 1440;

const FONT = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans SC",system-ui,sans-serif';

export interface PosterStats {
  works: number;
  relations: number;
  partners: number;
  span: string;
}

export interface PosterEdge {
  name: string;
  label: string;
  year: string;
  color: string;
}

export interface PosterInput {
  node: ArtistNode;
  province: string;
  stats: PosterStats;
  edges: PosterEdge[];
  url: string;
  /** 由 id 决定的等级，和页面上的 LV 标签保持一致。 */
  level: number;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    if (!src) return resolve(null);
    const image = new Image();
    // 同源图片加不加这个属性都一样；跨域图片靠它才有机会进画布。
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

/** 圆角矩形；老浏览器没有 roundRect 时退化成直角，不至于画不出来。 */
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

function fitText(ctx: CanvasRenderingContext2D, text: string, max: number) {
  if (ctx.measureText(text).width <= max) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > max) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/** 中文没有空格可断，只能逐字量宽；返回已裁好的行，最多 maxLines 行。 */
function wrapText(ctx: CanvasRenderingContext2D, text: string, max: number, maxLines: number) {
  const lines: string[] = [];
  let line = '';
  for (const char of text) {
    if (ctx.measureText(line + char).width > max) {
      lines.push(line);
      line = char;
      if (lines.length === maxLines) break;
    } else {
      line += char;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  // 被截断时给最后一行补省略号
  if (lines.length === maxLines && text.length > lines.join('').length) {
    lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, -1)}…`;
  }
  return lines;
}

export async function buildPoster(input: PosterInput): Promise<Blob> {
  const {node, province, stats, edges, url, level} = input;
  const accent = node.color || '#ffc93c';
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前浏览器不支持生成图片');

  // ── 底色 ────────────────────────────────────────────────
  ctx.fillStyle = '#080b10';
  ctx.fillRect(0, 0, W, H);

  const glow = ctx.createRadialGradient(230, 330, 40, 230, 330, 620);
  glow.addColorStop(0, `${accent}55`);
  glow.addColorStop(0.55, `${accent}18`);
  glow.addColorStop(1, '#080b1000');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // 像素网点：48px 一格，够稀，缩到手机上看是质感而不是噪点
  ctx.fillStyle = 'rgba(255,255,255,.05)';
  for (let y = 24; y < H; y += 48) {
    for (let x = 24; x < W; x += 48) ctx.fillRect(x, y, 2, 2);
  }

  // 顶部色带，让图在信息流里第一眼有辨识度
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, W, 10);

  // ── 页眉 ────────────────────────────────────────────────
  ctx.fillStyle = '#ffffff';
  ctx.font = `600 46px ${FONT}`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('NAHFI', 90, 108);
  const brandWidth = ctx.measureText('NAHFI').width;
  ctx.fillStyle = accent;
  ctx.font = `600 22px ${FONT}`;
  ctx.fillText('®', 90 + brandWidth + 6, 90);
  ctx.fillStyle = 'rgba(255,255,255,.42)';
  ctx.font = `500 22px ${FONT}`;
  ctx.fillText('RAP NETWORK', 90, 148);

  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,255,255,.38)';
  ctx.font = `500 22px ${FONT}`;
  ctx.fillText(province, W - 90, 108);
  ctx.fillText(`LV.${level}`, W - 90, 148);
  ctx.textAlign = 'left';

  // ── 头像 ────────────────────────────────────────────────
  const box = 340;
  const bx = 90;
  const by = 210;
  ctx.save();
  roundRect(ctx, bx, by, box, box, 32);
  ctx.clip();
  const image = await loadImage(avatarPath(node));
  if (image) {
    // cover：短边撑满，长边居中裁切
    const scale = Math.max(box / image.width, box / image.height);
    const dw = image.width * scale;
    const dh = image.height * scale;
    ctx.drawImage(image, bx + (box - dw) / 2, by + (box - dh) / 2, dw, dh);
  } else {
    // 没有官方头像时不要糊一张来路不明的图，也不要把首字母放到铺满——
    // 大方承认「暂无」反而更符合这个站「没有来源就不写」的调性。
    ctx.fillStyle = `${accent}18`;
    ctx.fillRect(bx, by, box, box);
    ctx.fillStyle = accent;
    ctx.font = `600 116px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(node.initials || node.name.slice(0, 1), bx + box / 2, by + box / 2 + 22);
    ctx.fillStyle = 'rgba(255,255,255,.32)';
    ctx.font = `400 20px ${FONT}`;
    ctx.fillText('暂无官方头像', bx + box / 2, by + box / 2 + 68);
    ctx.textAlign = 'left';
  }
  ctx.restore();

  ctx.strokeStyle = accent;
  ctx.lineWidth = 4;
  roundRect(ctx, bx, by, box, box, 32);
  ctx.stroke();

  // ── 名字与身份 ──────────────────────────────────────────
  const textX = bx + box + 56;
  const textMax = W - textX - 90;

  ctx.fillStyle = accent;
  ctx.font = `600 22px ${FONT}`;
  ctx.fillText(node.kind === 'group' ? 'CREW / 团体' : 'RAPPER / 说唱音乐人', textX, 268);

  ctx.fillStyle = '#ffffff';
  ctx.font = `600 72px ${FONT}`;
  ctx.fillText(fitText(ctx, node.name, textMax), textX, 356);

  ctx.fillStyle = 'rgba(255,255,255,.45)';
  ctx.font = `400 26px ${FONT}`;
  // 艺名经常被重复写进别名（「艾热」的别名里就有「艾热AIR」），含本名的直接剔掉，
  // 否则名字下面会出现一行「AIR / 艾热AIR」的废话。
  const alias = (node.aliases || [])
    .filter(item => {
      const value = item.trim();
      return value && value !== node.name && !value.replace(/\s/g, '').includes(node.name);
    })
    .slice(0, 2).join(' / ') || 'NAHFI ARCHIVE';
  ctx.fillText(fitText(ctx, alias, textMax), textX, 404);

  // 省份胶囊
  const pillY = 448;
  ctx.font = `500 24px ${FONT}`;
  const pillWidth = ctx.measureText(province).width + 44;
  ctx.fillStyle = 'rgba(255,255,255,.07)';
  roundRect(ctx, textX, pillY, pillWidth, 46, 23);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.14)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.78)';
  ctx.fillText(province, textX + 22, pillY + 31);

  // ── 数据条 ──────────────────────────────────────────────
  const stats0: [string, string][] = [
    [String(stats.works), '作品'],
    [String(stats.relations), '关系'],
    [String(stats.partners), '合作者'],
    [stats.span || '待补', '活跃年段'],
  ];
  const rowY = 620;
  const cell = (W - 180) / stats0.length;

  ctx.fillStyle = 'rgba(255,255,255,.12)';
  ctx.fillRect(90, rowY - 34, W - 180, 1);

  stats0.forEach(([value, label], index) => {
    const x = 90 + cell * index;
    ctx.fillStyle = '#ffffff';
    ctx.font = `600 56px ${FONT}`;
    ctx.fillText(value, x, rowY + 56);
    ctx.fillStyle = 'rgba(255,255,255,.4)';
    ctx.font = `400 22px ${FONT}`;
    ctx.fillText(label, x, rowY + 96);
  });

  ctx.fillStyle = 'rgba(255,255,255,.12)';
  ctx.fillRect(90, rowY + 136, W - 180, 1);

  // ── 关系 ────────────────────────────────────────────────
  ctx.fillStyle = accent;
  ctx.font = `600 22px ${FONT}`;
  ctx.fillText('CONNECTIONS / 关系', 90, rowY + 210);

  const listY = rowY + 250;
  if (edges.length) {
    edges.slice(0, 4).forEach((edge, index) => {
      const y = listY + index * 68;
      ctx.fillStyle = edge.color;
      ctx.fillRect(90, y - 17, 6, 26);

      ctx.fillStyle = '#ffffff';
      ctx.font = `500 32px ${FONT}`;
      ctx.fillText(fitText(ctx, edge.name, 400), 118, y + 5);

      ctx.fillStyle = 'rgba(255,255,255,.42)';
      ctx.font = `400 24px ${FONT}`;
      const detail = edge.year ? `${edge.label} · ${edge.year}` : edge.label;
      ctx.fillText(fitText(ctx, detail, W - 118 - 90), 530, y + 4);
    });
  } else {
    ctx.fillStyle = 'rgba(255,255,255,.3)';
    ctx.font = `400 28px ${FONT}`;
    ctx.fillText('暂无公开关系记录', 90, listY);
  }

  // ── 简介：填住关系列表与页脚之间的空档 ──────────────────
  // 单独加一条分隔线，否则简介会像是最后一条关系的补充说明。
  if (node.description) {
    ctx.fillStyle = 'rgba(255,255,255,.08)';
    ctx.fillRect(90, H - 336, W - 180, 1);
    ctx.fillStyle = 'rgba(255,255,255,.45)';
    ctx.font = `400 24px ${FONT}`;
    wrapText(ctx, node.description, W - 180, 2).forEach((line, index) => {
      ctx.fillText(line, 90, H - 296 + index * 38);
    });
  }

  // ── 页脚 ────────────────────────────────────────────────
  ctx.fillStyle = 'rgba(255,255,255,.1)';
  ctx.fillRect(90, H - 190, W - 180, 1);

  ctx.fillStyle = 'rgba(255,255,255,.55)';
  ctx.font = `500 26px ${FONT}`;
  ctx.fillText('中文说唱人物关系档案', 90, H - 128);

  ctx.fillStyle = accent;
  ctx.font = `600 28px ${FONT}`;
  ctx.fillText(fitText(ctx, url.replace(/^https?:\/\//, ''), W - 180), 90, H - 82);

  ctx.fillStyle = 'rgba(255,255,255,.3)';
  ctx.font = `400 20px ${FONT}`;
  ctx.fillText('每条关系都附来源，欢迎勘误', 90, H - 46);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('图片生成失败'))), 'image/png');
  });
}

/** 触发下载；iOS Safari 不支持 download 时退化为新窗口打开，用户可长按保存。 */
export function saveBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 4000);
}

export async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    // 非 HTTPS 或权限被拒时退回老办法
    const area = document.createElement('textarea');
    area.value = value;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}
