/**
 * 程序化占位人像：双色丝网印剪影。
 *
 * 全站 327 位人物里只有 20 多位有真实照片。以前剩下的人是「卡面正中一个巨大首字」，
 * 在镭射底上看就像图片加载失败。这里换成唱片封套式的做法：深色剪影 + 半调网点 +
 * 主色边缘光，明确承认「暂无照片」，但看起来是刻意设计的版面而不是缺图。
 *
 * 同一份绘制逻辑同时供 DOM canvas（首屏卡片）和 three.js CanvasTexture（人物页卡阵）使用，
 * 两处占位风格因此始终一致。
 */

const TAU = Math.PI * 2;

/** 确定性随机：同一个人每次画出来必须一模一样，否则翻页时会“换脸”。 */
function seededRandom(seed: number) {
  let s = ((seed * 7919 + 104729) % 2147483647) || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** 把主色转成带透明度的 rgba；非十六进制色值退回焦橙，保证不崩。 */
export function withAlpha(color: string, alpha: number): string {
  const value = HEX.test(color) ? color : '#e4572e';
  const hex = value.slice(1);
  const full = hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

export interface PortraitOptions {
  /** 稳定种子：一般传该人物在名单里的序号。 */
  seed: number;
  /** 人物主色，用于边缘光与第二层网点。 */
  accent: string;
}

/**
 * 在 (x,y,w,h) 区域内画一张占位人像。
 * 调用方负责裁剪与圆角，这里只管把画满整个矩形。
 */
export function drawPortrait(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  { seed, accent }: PortraitOptions,
) {
  if (w <= 0 || h <= 0) return;
  const rand = seededRandom(seed);
  const cx = x + w * 0.5;
  // 标准半身像比例：头约占画幅宽的 38%，落在上三分之一；
  // 肩膀从 62% 高度起向两侧铺满，下面留一点空，剪影才不会糊成一团。
  const headR = Math.min(w * 0.29, h * 0.3) * (0.9 + rand() * 0.16);
  const headCy = y + h * (0.33 + rand() * 0.05);
  const variant = Math.floor(rand() * 8);
  // 肩宽与头部横向比例也各自浮动：同一套模板下不至于所有人都是同一个梯形。
  const shoulderW = w * (0.46 + rand() * 0.12);
  const headSquash = 0.84 + rand() * 0.1;
  const tilt = (rand() - 0.5) * 0.06;

  /** 椭圆子路径：先 moveTo 到起点，避免 arc 把上一个形状连出一条直线。 */
  const ell = (ex: number, ey: number, rx: number, ry: number, a0 = 0, a1 = TAU) => {
    ctx.moveTo(ex + Math.cos(a0) * rx, ey + Math.sin(a0) * ry);
    ctx.ellipse(ex, ey, rx, ry, 0, a0, a1);
  };

  // 头 / 颈 / 肩 / 头饰全部作为同一条路径的子路径，靠 nonzero 填充合成一个整体。
  const buildSilhouette = () => {
    ctx.beginPath();
    if (variant === 4) ell(cx, headCy + headR * 0.16, headR * 1.4, headR * 1.48);        // 连帽衫
    // 肩：宽而扁，顶边落在脖子下方；太圆会让整个剪影糊成一团土丘。
    ell(cx, y + h * 1.02, shoulderW * 1.12, h * 0.4);                                    // 肩
    ell(cx, headCy + headR * 1.12, headR * 0.3, headR * 0.52);                           // 颈
    ell(cx - headR * 0.9, headCy + headR * 0.1, headR * 0.17, headR * 0.23);             // 耳
    ell(cx + headR * 0.9, headCy + headR * 0.1, headR * 0.17, headR * 0.23);
    ell(cx, headCy, headR * headSquash, headR);                                          // 头

    if (variant === 0) {                                                                 // 短发：沿颅顶一层
      ell(cx, headCy - headR * 0.34, headR * (headSquash + 0.08), headR * 0.78);
    } else if (variant === 1) {                                                          // 鸭舌帽
      ell(cx, headCy - headR * 0.84, headR * 0.94, headR * 0.58);
      ctx.moveTo(cx + headR * 0.12, headCy - headR * 0.7);
      ctx.lineTo(cx + headR * 1.66, headCy - headR * 0.52);
      ctx.lineTo(cx + headR * 1.66, headCy - headR * 0.3);
      ctx.lineTo(cx + headR * 0.12, headCy - headR * 0.42);
      ctx.closePath();
    } else if (variant === 2) {                                                          // 头巾 + 后垂的角
      ell(cx, headCy - headR * 0.72, headR * 0.92, headR * 0.66);
      ell(cx + headR * 0.94, headCy - headR * 0.5, headR * 0.19, headR * 0.34);
    } else if (variant === 3) {                                                          // 耳机
      const ring = headR * 1.08;
      const thick = headR * 0.13;
      ctx.moveTo(cx + Math.cos(Math.PI * 1.04) * (ring + thick), headCy + Math.sin(Math.PI * 1.04) * (ring + thick));
      ctx.arc(cx, headCy, ring + thick, Math.PI * 1.04, Math.PI * 1.96, false);
      ctx.arc(cx, headCy, ring - thick, Math.PI * 1.96, Math.PI * 1.04, true);
      ctx.closePath();
      ell(cx - ring * 0.98, headCy + headR * 0.1, headR * 0.23, headR * 0.32);
      ell(cx + ring * 0.98, headCy + headR * 0.1, headR * 0.23, headR * 0.32);
    } else if (variant === 5) {                                                          // 短卷发
      for (let i = 0; i < 9; i++) {
        const angle = Math.PI * 1.04 + (i / 8) * Math.PI * 0.92;
        ell(cx + Math.cos(angle) * headR * 0.9, headCy + Math.sin(angle) * headR * 0.9, headR * 0.26, headR * 0.26);
      }
    } else if (variant === 6) {                                                          // 脏辫：帽檐式外扩
      ell(cx, headCy - headR * 0.5, headR * 1.12, headR * 0.66);
      for (let i = 0; i < 5; i++) {
        const t = i / 4;
        ell(cx - headR * 1.0 + t * headR * 0.5, headCy - headR * 0.1 + t * headR * 0.34, headR * 0.1, headR * 0.12);
        ell(cx + headR * 1.0 - t * headR * 0.5, headCy - headR * 0.1 + t * headR * 0.34, headR * 0.1, headR * 0.12);
      }
    } else if (variant === 7) {                                                          // 高领 / 立领外套
      ell(cx, headCy + headR * 1.05, headR * 0.78, headR * 0.62);
    }
  };

  ctx.save();
  // 轻微侧倾：即使两个人抽到同一个发型，角度也不同。
  ctx.translate(cx, headCy);
  ctx.rotate(tilt);
  ctx.translate(-cx, -headCy);

  // 1. 氛围底光：让剪影从卡面里浮出来
  const glow = ctx.createRadialGradient(cx, headCy, 0, cx, headCy, Math.max(w, h) * 0.8);
  glow.addColorStop(0, withAlpha(accent, 0.2));
  glow.addColorStop(0.55, withAlpha(accent, 0.05));
  glow.addColorStop(1, withAlpha(accent, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(x, y, w, h);

  // 2. 边缘光：只比剪影大一丝，靠 shadowBlur 晕开；过大会变成「巨蛋」。
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.translate(cx, headCy);
  ctx.scale(1.022, 1.022);
  ctx.translate(-cx, -headCy);
  buildSilhouette();
  ctx.shadowColor = withAlpha(accent, 0.6);
  ctx.shadowBlur = headR * 0.42;
  ctx.fillStyle = withAlpha(accent, 0.34);
  ctx.fill();
  ctx.restore();

  // 3. 剪影填充：斜向渐变定大方向明暗，再用一层径向柔光把左脸提起。
  ctx.save();
  buildSilhouette();
  const bodyGrad = ctx.createLinearGradient(cx - w * 0.5, y + h * 0.06, cx + w * 0.44, y + h * 0.96);
  bodyGrad.addColorStop(0, '#2b2118');
  bodyGrad.addColorStop(0.34, '#15100b');
  bodyGrad.addColorStop(0.7, '#0a0705');
  bodyGrad.addColorStop(1, '#060404');
  ctx.fillStyle = bodyGrad;
  ctx.fill();
  ctx.clip();

  // 3a. 左脸/左肩的柔光：一个椭圆内亮外暗，是整张人像唯一的「光源」。
  const keyLight = ctx.createRadialGradient(
    cx - headR * 0.5, headCy - headR * 0.5, headR * 0.1,
    cx - headR * 0.5, headCy - headR * 0.5, headR * 1.9,
  );
  keyLight.addColorStop(0, 'rgba(240,226,205,0.24)');
  keyLight.addColorStop(0.42, 'rgba(240,226,205,0.07)');
  keyLight.addColorStop(1, 'rgba(240,226,205,0)');
  ctx.fillStyle = keyLight;
  ctx.fillRect(x, y, w, h);

  // 3b. 侧面亮边：贴着左轮廓一条，宽度往右下收细。
  // 有没有这条几乎决定剪影读起来是人还是一片山丘。
  const rim = ctx.createLinearGradient(cx - headR, headCy - headR * 0.8, cx + headR * 0.3, headCy + headR * 0.9);
  rim.addColorStop(0, 'rgba(255,240,218,0.7)');
  rim.addColorStop(0.5, 'rgba(255,240,218,0.16)');
  rim.addColorStop(1, 'rgba(255,240,218,0)');
  ctx.strokeStyle = rim;
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1.6, headR * 0.075);
  ctx.beginPath();
  ctx.ellipse(cx, headCy, headR * headSquash, headR, 0, Math.PI * 0.88, Math.PI * 1.78);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(cx, y + h * 1.06, shoulderW * 1.12, h * 0.44, 0, Math.PI * 1.08, Math.PI * 1.52);
  ctx.stroke();

  // 3c. 肩部虚线阴影：把肩和头彻底分开，同时给出「此人是半身像」的读法。
  ctx.save();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = Math.max(2, headR * 0.11);
  ctx.beginPath();
  ctx.ellipse(cx, y + h * 1.06, shoulderW * 1.12, h * 0.44, 0, Math.PI * 1.12, Math.PI * 1.42);
  ctx.stroke();
  ctx.restore();

  // 3d. 稀疏网点：只在最亮的肩头撒一层，留出网点语言但不铺满。
  const step = Math.max(5, headR * 0.19);
  ctx.fillStyle = withAlpha(accent, 0.3);
  for (let py = headCy + headR * 0.5; py < y + h; py += step) {
    for (let px = x; px < cx; px += step) {
      const dx = (px - (cx - headR * 0.5)) / (headR * 2.4);
      const dy = (py - headCy) / (h * 0.42);
      const falloff = 1 - Math.sqrt(dx * dx + dy * dy);
      if (falloff < 0.35) continue;
      ctx.beginPath();
      ctx.arc(px, py, step * 0.3 * falloff, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();

  // 4. 扫描线 + 暗角，把整体压回卡面的暗调
  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = '#000';
  for (let py = y; py < y + h; py += 3) ctx.fillRect(x, py, w, 1);
  ctx.restore();

  const vignette = ctx.createRadialGradient(
    cx, y + h * 0.45, Math.min(w, h) * 0.18,
    cx, y + h * 0.45, Math.max(w, h) * 0.86,
  );
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(5,4,3,0.74)');
  ctx.fillStyle = vignette;
  ctx.fillRect(x, y, w, h);

  ctx.restore();
}
