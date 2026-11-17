/**
 * FLOWLINE · 海报大头像的 ASCII 表层。
 *
 * 只在 340px 的分享海报头像上使用；关系网节点 / 列表缩略图一律不处理，
 * 否则小尺寸头像会糊成墨点，认不出是谁。
 *
 * 做法：采样原图每个 cell 的平均色 → 用同色字符重绘半透明表层 →
 * 面部椭圆区压低不透明度，背景与衣服吃满字符。原图完整保留在底层。
 * 只在生成海报时调用一次，不参与运行时渲染。
 */
const RAMP = '·:-=+*#%@';

export function buildAsciiPortrait(image: HTMLImageElement, size: number, cell = 3): HTMLCanvasElement {
  const src = document.createElement('canvas');
  src.width = src.height = size;
  const sctx = src.getContext('2d', {willReadFrequently: true})!;

  // cover 裁切，与底层头像保持完全一致
  const scale = Math.max(size / image.width, size / image.height);
  const dw = image.width * scale;
  const dh = image.height * scale;
  sctx.drawImage(image, (size - dw) / 2, (size - dh) / 2, dw, dh);
  const data = sctx.getImageData(0, 0, size, size).data;

  const out = document.createElement('canvas');
  out.width = out.height = size;
  const ctx = out.getContext('2d')!;
  ctx.font = `${Math.round(cell * 1.7)}px ui-monospace, Consolas, monospace`;
  ctx.textBaseline = 'top';

  for (let y = 0; y < size; y += cell) {
    for (let x = 0; x < size; x += cell) {
      const xe = Math.min(size, x + cell);
      const ye = Math.min(size, y + cell);
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y; yy < ye; yy++) {
        for (let xx = x; xx < xe; xx++) {
          const i = (yy * size + xx) * 4;
          r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
        }
      }
      r /= n; g /= n; b /= n;
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const glyph = RAMP[Math.min(RAMP.length - 1, Math.floor(lum * RAMP.length))];

      // 面部区域压到 18%，其余区域 55% —— 保留识别度
      const nx = (x - size / 2) / (size * 0.30);
      const ny = (y - size * 0.44) / (size * 0.36);
      ctx.globalAlpha = nx * nx + ny * ny < 1 ? 0.18 : 0.55;
      ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
      ctx.fillText(glyph, x, y);
    }
  }
  ctx.globalAlpha = 1;
  return out;
}
