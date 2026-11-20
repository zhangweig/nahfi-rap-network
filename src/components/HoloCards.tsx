import {useEffect, useRef} from 'react';
import * as THREE from 'three';
import type {ArtistNode} from '../data/types';
import {avatarPath} from './PixelAvatar';
import {drawPortrait} from '../lib/portrait';
import {provinceLabel, provinceOf} from '../lib/province';

/**
 * 人物页专用：three.js 真 3D 球星卡舞台。
 *
 * 只在人物页挂载；地图、BEEF、投稿等其余页面完全不受影响。
 * 架构：一个 WebGL canvas 覆盖整个卡阵；DOM 按钮保持为透明点击热区，
 * 负责 aria / 点击 / hover 事件，所有视觉由 three.js 绘制。
 * 卡面文字画进高分辨率 CanvasTexture，头像单独浮起一层形成真实纵深。
 * pixelRatio 限幅 + 按需 shader 动画，避免重演 4K 卡顿。
 */

export interface HoloCardData {
  node: ArtistNode;
  index: number;
  workCount: number;
  relationCount: number;
  inBeef?: boolean;
}

interface CardObject {
  group: THREE.Group;
  holo: THREE.ShaderMaterial;
  baseX: number;
  baseY: number;
  face: THREE.CanvasTexture;
  avatar?: THREE.Texture;
  avatarMat: THREE.MeshBasicMaterial;
  phase: number; // 每张卡独立的镭射相位：仅 hover 时推进，其余冻结
}

const TEX_W = 640;
const TEX_H = 896;
const FOV = 32;
const CARD_DEPTH = 4;      // 薄卡：接近实体球星卡厚度，不再是砖块
const CARD_RADIUS = 12;    // 略带圆角

/**
 * 模块级纹理缓存：解决「切页/刷新回来卡片照片重新加载、卡卡的」。
 * 根因是 WebGL effect 依赖 cards 数据签名，切页返回时整段重建，
 * 卡面 CanvasTexture（640×896 逐像素绘制）与头像 Texture 都重新生成/解码。
 * 这里按稳定 key 缓存两类纹理，重建时直接复用；因磁盘只有 24 张/页、总量有限
 * （约 24×(640×896×4)+头像 ≈ 60MB 上限），保留缓存的收益远大于内存代价。
 */
const faceCache = new Map<string, THREE.CanvasTexture>();
const avatarCache = new Map<string, THREE.Texture>();

/** 圆角矩形轮廓，卡体与镭射层共用，避免矩形层在圆角处露馅。 */
function roundedRectShape(w: number, h: number): THREE.Shape {
  const x = -w / 2, y = -h / 2, r = CARD_RADIUS;
  const shape = new THREE.Shape();
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + h - r);
  shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  shape.lineTo(x + r, y + h);
  shape.quadraticCurveTo(x, y + h, x, y + h - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  return shape;
}

/** 超薄圆角卡体。 */
function makeCardGeometry(w: number, h: number): THREE.ExtrudeGeometry {
  const x = -w / 2, y = -h / 2;
  const shape = roundedRectShape(w, h);

  // 让卡面纹理正确铺满正反面（ExtrudeGeometry 默认 UV 是世界坐标）
  const uvGen: THREE.UVGenerator = {
    generateTopUV(_geo, vertices, ia, ib, ic) {
      const uv = (i: number) => new THREE.Vector2(
        (vertices[i * 3] - x) / w,
        (vertices[i * 3 + 1] - y) / h,
      );
      return [uv(ia), uv(ib), uv(ic)];
    },
    generateSideWallUV() {
      return [new THREE.Vector2(0, 0), new THREE.Vector2(1, 0), new THREE.Vector2(1, 1), new THREE.Vector2(0, 1)];
    },
  };
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: CARD_DEPTH, bevelEnabled: true, bevelThickness: 1, bevelSize: 1,
    bevelSegments: 2, curveSegments: 8, UVGenerator: uvGen,
  });
  geo.translate(0, 0, -(CARD_DEPTH / 2 + 1));
  return geo;
}

/** 与卡体同轮廓的圆角镭射面，UV 归一化供 shader 使用。 */
function makeHoloPlane(w: number, h: number): THREE.ShapeGeometry {
  const geo = new THREE.ShapeGeometry(roundedRectShape(w, h), 8);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, (pos.getX(i) + w / 2) / w, (pos.getY(i) + h / 2) / h);
  }
  uv.needsUpdate = true;
  return geo;
}

/* ── 卡面：用 Canvas2D 把原有卡片信息画成纹理 ─────────────────────── */
function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 头像区底纹：宽光谱镭射 + 扫描线 + 网点 + 闪光颗粒，全部程序化生成。 */
function drawFoilPatch(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, seed: number) {
  ctx.save();
  roundRectPath(ctx, x, y, w, h, 8);
  ctx.clip();

  // 斜向彩虹底：模拟 CSS repeating-linear-gradient(112deg, ...)
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(-0.42 + (seed % 5) * 0.015);
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = 0.38;
  const grad = ctx.createLinearGradient(-w, 0, w, 0);
  ['#e4572e', '#f0b83a', '#b9d84a', '#35c7a1', '#7b5cc4', '#e2557a', '#e4572e']
    .forEach((color, i) => grad.addColorStop(i / 6, color));
  ctx.fillStyle = grad;
  ctx.fillRect(-w * 1.4, -h * 1.4, w * 2.8, h * 2.8);
  ctx.restore();

  // 细扫描线
  ctx.globalAlpha = 0.07;
  ctx.fillStyle = '#fff';
  for (let yy = y; yy < y + h; yy += 4) ctx.fillRect(x, yy, w, 1);

  // 半调网点：保留数字美术质感，不让镭射变成纯塑料
  ctx.globalAlpha = 0.1;
  ctx.fillStyle = '#f2ede4';
  for (let yy = y + 8; yy < y + h; yy += 14) {
    for (let xx = x + 8; xx < x + w; xx += 14) {
      ctx.beginPath();
      ctx.arc(xx, yy, 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 确定性闪光颗粒
  let s = seed * 7919 + 13;
  const rand = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  ctx.globalAlpha = 0.5;
  for (let i = 0; i < 80; i++) {
    const px = x + rand() * w, py = y + rand() * h;
    const r = rand() * 1.5 + 0.3;
    ctx.fillStyle = rand() > 0.5 ? '#fff2d6' : '#b9d84a';
    ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function makeFaceTexture(card: HoloCardData): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const ctx = canvas.getContext('2d')!;
  const {node, index, workCount, relationCount, inBeef} = card;
  const serial = String(index + 1).padStart(3, '0');
  const kind = node.kind === 'group' ? 'CREW' : 'RAPPER';
  const province = provinceLabel(provinceOf(node.city));

  const bg = ctx.createLinearGradient(0, 0, TEX_W, TEX_H);
  bg.addColorStop(0, '#2a2018');
  bg.addColorStop(0.38, '#120e0b');
  bg.addColorStop(1, '#090706');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, TEX_W, TEX_H);

  // 顶部焦橙氛围光
  const glow = ctx.createRadialGradient(TEX_W / 2, 250, 24, TEX_W / 2, 250, 520);
  glow.addColorStop(0, 'rgba(228,87,46,.26)');
  glow.addColorStop(0.55, 'rgba(228,87,46,.06)');
  glow.addColorStop(1, 'rgba(228,87,46,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, TEX_W, TEX_H);

  // 金属细框 + 深色内框
  const frame = ctx.createLinearGradient(0, 0, TEX_W, TEX_H);
  frame.addColorStop(0, '#f0c98a');
  frame.addColorStop(0.25, '#7a4a2b');
  frame.addColorStop(0.55, '#d9a05b');
  frame.addColorStop(1, '#4a2f1f');
  ctx.strokeStyle = frame;
  ctx.lineWidth = 12;
  roundRectPath(ctx, 7, 7, TEX_W - 14, TEX_H - 14, 18);
  ctx.stroke();
  ctx.strokeStyle = '#0a0807';
  ctx.lineWidth = 4;
  roundRectPath(ctx, 20, 20, TEX_W - 40, TEX_H - 40, 10);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,235,190,.28)';
  ctx.lineWidth = 2;
  roundRectPath(ctx, 25, 25, TEX_W - 50, TEX_H - 50, 8);
  ctx.stroke();

  ctx.textBaseline = 'alphabetic';
  ctx.font = 'bold 28px ui-monospace, Consolas, monospace';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#e4572e';
  ctx.fillText(`NO.${serial}`, 38, 68);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#b3a593';
  ctx.fillText(kind, TEX_W - 38, 68);

  // 头像区：暗底 + 程序化人像兜底（真人照片加载成功后由 avatar 层盖住）
  const artX = 40, artY = 96, artW = TEX_W - 80, artH = 380;
  const art = ctx.createRadialGradient(TEX_W / 2, artY + 130, 20, TEX_W / 2, artY + 130, 380);
  art.addColorStop(0, '#2e221c');
  art.addColorStop(1, '#0a0807');
  ctx.fillStyle = art;
  ctx.fillRect(artX, artY, artW, artH);
  drawFoilPatch(ctx, artX, artY, artW, artH, index + 1);
  // 双色丝网印剪影：明确表示「暂无照片」，但看起来是一版设计而不是缺图。
  // 以前这里是一个 190px 的首字，三百多人里三百张都长那样。
  drawPortrait(ctx, artX, artY, artW, artH, {seed: index + 3, accent: node.color});
  ctx.strokeStyle = '#4d382a';
  ctx.lineWidth = 2;
  ctx.strokeRect(artX, artY, artW, artH);

  ctx.strokeStyle = '#e4572e';
  ctx.lineWidth = 3;
  const corners: [number, number, number, number][] = [
    [artX + 4, artY + 4, 1, 1], [artX + artW - 4, artY + 4, -1, 1],
    [artX + 4, artY + artH - 4, 1, -1], [artX + artW - 4, artY + artH - 4, -1, -1],
  ];
  corners.forEach(([x, y, sx, sy]) => {
    ctx.beginPath();
    ctx.moveTo(x, y + 20 * sy);
    ctx.lineTo(x, y);
    ctx.lineTo(x + 20 * sx, y);
    ctx.stroke();
  });

  // 姓名铭牌：托住文字，避免镭射把名字冲淡
  ctx.fillStyle = 'rgba(5,4,3,.76)';
  roundRectPath(ctx, 30, 526, TEX_W - 60, 92, 10);
  ctx.fill();
  ctx.strokeStyle = 'rgba(228,87,46,.72)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#e4572e';
  ctx.fillRect(38, 540, 5, 64);

  ctx.textAlign = 'left';
  ctx.fillStyle = '#f2ede4';
  ctx.font = 'bold 54px "Microsoft YaHei", sans-serif';
  ctx.fillText(node.name, 52, 560, TEX_W - 100);
  ctx.fillStyle = '#c9a873';
  ctx.font = '26px ui-monospace, Consolas, monospace';
  ctx.fillText(province, 52, 600);

  const statTop = 632;
  ctx.strokeStyle = '#3c2c22';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(38, statTop); ctx.lineTo(TEX_W - 38, statTop); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(38, statTop + 132); ctx.lineTo(TEX_W - 38, statTop + 132); ctx.stroke();
  const cols = [
    {n: String(workCount), label: '作品', color: '#e4572e'},
    {n: String(relationCount), label: '关系', color: '#e4572e'},
    {n: kind, label: '类型', color: '#d9a05b'},
  ];
  cols.forEach((col, i) => {
    const cx = 38 + (TEX_W - 76) / 6 + i * (TEX_W - 76) / 3;
    if (i > 0) {
      ctx.strokeStyle = '#3c2c2277';
      ctx.beginPath(); ctx.moveTo(38 + i * (TEX_W - 76) / 3, statTop + 14);
      ctx.lineTo(38 + i * (TEX_W - 76) / 3, statTop + 118); ctx.stroke();
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = col.color;
    ctx.font = 'bold 42px ui-monospace, Consolas, monospace';
    ctx.fillText(col.n, cx, statTop + 70, (TEX_W - 76) / 3 - 8);
    ctx.fillStyle = '#a39584';
    ctx.font = '22px "Microsoft YaHei", sans-serif';
    ctx.fillText(col.label, cx, statTop + 108);
  });

  if (inBeef) {
    ctx.fillStyle = '#b9d84a';
    ctx.fillRect(TEX_W - 196, 84, 158, 40);
    ctx.fillStyle = '#141608';
    ctx.font = 'bold 22px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('⚡ BEEF', TEX_W - 117, 112);
  }

  // 档案条码：增加实体卡的信息密度
  let bs = (index + 1) * 104729;
  const brand = () => { bs = (bs * 48271) % 2147483647; return (bs - 1) / 2147483646; };
  ctx.fillStyle = '#6b5c4d';
  for (let i = 0; i < 44; i++) {
    const bx = 38 + i * 9;
    const bw = 1 + Math.floor(brand() * 4);
    ctx.fillRect(bx, TEX_H - 82, bw, 22);
  }

  ctx.fillStyle = '#7a6d5f';
  ctx.font = '20px ui-monospace, Consolas, monospace';
  ctx.textAlign = 'left';
  ctx.fillText('FLOWLINE ARCHIVE', 38, TEX_H - 40);
  ctx.textAlign = 'right';
  ctx.fillText(serial, TEX_W - 38, TEX_H - 40);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ── 全息 shader：菲涅尔边缘 + 扫描线 + 斜向光带 + 指针热点 ─────────── */
const HOLO_VERT = /* glsl */`
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

const HOLO_FRAG = /* glsl */`
  uniform float uPhase;   // 该卡独立相位：仅 hover 时推进
  uniform vec2 uPointer;
  uniform float uHover;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vView;

  // 宽色谱：沿用 FLOWLINE 的焦橙/金/酸绿，再补冷色形成真正的彩虹色散
  vec3 spectral(float t){
    vec3 c0 = vec3(0.894, 0.341, 0.180); // 焦橙
    vec3 c1 = vec3(0.941, 0.722, 0.227); // 金
    vec3 c2 = vec3(0.725, 0.847, 0.290); // 酸绿
    vec3 c3 = vec3(0.208, 0.780, 0.631); // 青绿
    vec3 c4 = vec3(0.482, 0.361, 0.769); // 紫
    vec3 c5 = vec3(0.886, 0.333, 0.478); // 珊瑚红
    t = fract(t) * 6.0;
    if(t < 1.0) return mix(c0, c1, t);
    if(t < 2.0) return mix(c1, c2, t - 1.0);
    if(t < 3.0) return mix(c2, c3, t - 2.0);
    if(t < 4.0) return mix(c3, c4, t - 3.0);
    if(t < 5.0) return mix(c4, c5, t - 4.0);
    return mix(c5, c0, t - 5.0);
  }
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main() {
    vec3 viewDir = normalize(vView);
    float fres = pow(1.0 - abs(dot(viewDir, vNormal)), 2.2);

    // 彩虹扫带：相位只由该卡自身推进 + 指针位置决定，不共用全局时间
    float diag = vUv.x * 0.72 + vUv.y * 0.28;
    float phase = diag * 2.7 - uPhase * 0.55 + uPointer.x * 0.62 + uPointer.y * 0.34;
    vec3 rainbow = spectral(phase);
    float sweep = pow(sin(phase * 3.1416) * 0.5 + 0.5, 2.2);

    // 细密光栅 + 竖向闪带：对应 CSS 的 repeating-linear-gradient 层
    float grating = pow(sin(vUv.x * 620.0) * 0.5 + 0.5, 8.0);
    float bars = pow(sin(vUv.x * 11.0 - uPhase * 0.8 + uPointer.x * 3.0) * 0.5 + 0.5, 12.0);

    // 闪光颗粒：只在 hover 时轻微闪烁
    float sparkle = step(0.988, hash(floor(vUv * vec2(260.0, 360.0)) + floor(uPhase * 3.0)));

    // 指针镜面反光
    float d = distance(vUv, uPointer);
    float spot = exp(-d * d * 15.0);

    vec3 color = rainbow * (0.52 + 0.48 * sweep)
      + vec3(0.95, 0.90, 0.80) * (bars * 0.32 + sparkle * 0.24 * uHover)
      + vec3(spot * 0.20 * uHover);
    float a = (sweep * 0.40 + bars * 0.20 + grating * 0.05 + fres * 0.26
      + sparkle * 0.08 * uHover + spot * 0.16 * uHover) * (0.16 + uHover * 0.56);
    gl_FragColor = vec4(color, a);
  }
`;

/* ── 组件 ───────────────────────────────────────────────────────────── */
export function HoloCardStage({cards, onPick}:{cards:HoloCardData[];onPick:(id:string)=>void}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  // 数据内容稳定签名：避免父组件每次渲染新建数组导致 WebGL 场景重建
  const cardsKey = cards.map(c => `${c.node.id}:${c.workCount}:${c.relationCount}:${c.inBeef ? 1 : 0}`).join('|');

  useEffect(() => {
    const grid = gridRef.current;
    const canvas = canvasRef.current;
    if (!grid || !canvas || cards.length === 0) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 8000);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({canvas, alpha: true, antialias: true, powerPreference: 'high-performance'});
    } catch {
      return; // WebGL 不可用时保留透明热区，不抛错
    }
    // 4K / 高 DPR 下把渲染分辨率压到 1x：卡阵是展示层，DPR1 已足够清晰，
    // 但像素填充量从 2.25x 降到 1x（4K 屏省一半以上 GPU 填充）。
    const hiRes = window.innerWidth >= 2400 || (window.devicePixelRatio || 1) >= 2;
    renderer.setPixelRatio(hiRes ? 1 : Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const texLoader = new THREE.TextureLoader();

    const objects = new Map<string, CardObject>();
    let hoveredId: string | null = null;
    let disposed = false;
    const pointer = {x: 0.5, y: 0.5};

    const sideMat = new THREE.MeshBasicMaterial({color: 0x9a6a3f});

    function disposeObjects() {
      objects.forEach(o => {
        scene.remove(o.group);
        o.group.traverse(child => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            // 材质本身要释放；但它引用的贴图来自模块缓存，绝不能 dispose，
            // 否则切页回来纹理已失效，又退回到重新加载。
            mats.forEach(m => { if (m !== sideMat) m.dispose(); });
          }
        });
        // face / avatar 纹理留在全局缓存里供下次复用，这里不再 dispose。
      });
      objects.clear();
    }

    /** 头像纹理：命中缓存直接复用；否则加载并写缓存。返回是否有缓存可同步上屏。 */
    function applyAvatar(id: string, url: string, maxAniso: number) {
      const cached = avatarCache.get(url);
      if (cached) {
        const obj = objects.get(id);
        if (obj) { obj.avatar = cached; obj.avatarMat.map = cached; obj.avatarMat.opacity = 1; obj.avatarMat.needsUpdate = true; }
        return;
      }
      texLoader.load(url, tex => {
        if (disposed) { tex.dispose(); return; }
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = maxAniso;
        avatarCache.set(url, tex);
        const obj = objects.get(id);
        if (!obj) return;
        obj.avatar = tex;
        obj.avatarMat.map = tex;
        obj.avatarMat.opacity = 1;
        obj.avatarMat.needsUpdate = true;
      });
    }

    function build() {
      disposeObjects();
      const w = grid!.clientWidth;
      const h = grid!.clientHeight;
      if (w <= 0 || h <= 0) return;
      renderer!.setSize(w, h, false);
      camera!.aspect = w / h;
      camera!.updateProjectionMatrix();
      camera!.position.set(0, 0, (h / 2) / Math.tan((FOV * Math.PI / 180) / 2));
      camera!.lookAt(0, 0, 0);

      const buttons = grid!.querySelectorAll<HTMLElement>('.holo-hit');
      buttons.forEach(btn => {
        const id = btn.dataset.id!;
        const data = cards.find(c => c.node.id === id);
        if (!data) return;
        const bw = btn.offsetWidth, bh = btn.offsetHeight;
        const baseX = btn.offsetLeft + bw / 2 - w / 2;
        const baseY = -(btn.offsetTop + bh / 2 - h / 2);

        const group = new THREE.Group();
        group.position.set(baseX, baseY, 0);

        // 卡面纹理：数据签名做 key，命中缓存就不重绘那张 640×896 画布。
        const faceKey = `${data.node.id}:${data.index}:${data.workCount}:${data.relationCount}:${data.inBeef ? 1 : 0}`;
        let face = faceCache.get(faceKey);
        if (!face) {
          face = makeFaceTexture(data);
          face.anisotropy = maxAniso;
          faceCache.set(faceKey, face);
        }
        const faceMat = new THREE.MeshBasicMaterial({map: face});
        // 薄卡体：圆角长方形，接近实体球星卡厚度
        const body = new THREE.Mesh(makeCardGeometry(bw, bh), [faceMat, sideMat]);
        group.add(body);

        // 头像层：抬到卡面之上，随倾斜产生真实视差
        const artW = bw * (TEX_W - 80) / TEX_W;
        const artH = bh * 380 / TEX_H;
        const artY = bh * (0.5 - (96 + 190) / TEX_H);
        const avatarMat = new THREE.MeshBasicMaterial({transparent: true, opacity: 0});
        const avatarPlane = new THREE.Mesh(new THREE.PlaneGeometry(artW, artH), avatarMat);
        avatarPlane.position.set(0, artY, CARD_DEPTH / 2 + 1.2);
        group.add(avatarPlane);
        const url = avatarPath(data.node);
        if (url) applyAvatar(id, url, maxAniso);

        // 每张卡给不同初始相位，静态时各卡镭射纹理各异、但都完全静止
        const initPhase = data.index * 0.618;
        const holo = new THREE.ShaderMaterial({
          uniforms: {
            uPhase: {value: initPhase},
            uPointer: {value: new THREE.Vector2(0.5, 0.5)},
            uHover: {value: 0},
          },
          vertexShader: HOLO_VERT,
          fragmentShader: HOLO_FRAG,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const holoPlane = new THREE.Mesh(makeHoloPlane(bw, bh), holo);
        holoPlane.position.z = CARD_DEPTH / 2 + 1.6;
        group.add(holoPlane);

        scene.add(group);
        objects.set(id, {group, holo, baseX, baseY, face, avatarMat, phase: initPhase});
      });
    }

    function onPointerMove(e: PointerEvent) {
      const btn = (e.target as HTMLElement).closest?.('.holo-hit') as HTMLElement | null;
      if (!btn || !grid!.contains(btn)) { hoveredId = null; return; }
      const r = btn.getBoundingClientRect();
      pointer.x = (e.clientX - r.left) / r.width;
      pointer.y = (e.clientY - r.top) / r.height;
      hoveredId = btn.dataset.id || null;
    }
    function onPointerLeave() { hoveredId = null; }
    grid.addEventListener('pointermove', onPointerMove);
    grid.addEventListener('pointerleave', onPointerLeave);

    const ro = new ResizeObserver(() => build());
    ro.observe(grid);
    build();

    let raf = 0;
    let lastMs = 0;
    function animate(ms: number) {
      raf = requestAnimationFrame(animate);
      const dt = lastMs ? Math.min((ms - lastMs) / 1000, 0.05) : 0;
      lastMs = ms;
      objects.forEach((o, id) => {
        const isHover = id === hoveredId;
        const trx = isHover ? -(pointer.y - 0.5) * 0.7 - 0.14 : 0;
        const tryaw = isHover ? (pointer.x - 0.5) * 0.9 + 0.18 : 0;
        o.group.rotation.x += (trx - o.group.rotation.x) * 0.13;
        o.group.rotation.y += (tryaw - o.group.rotation.y) * 0.13;
        const tz = isHover ? 34 : 0;
        const ty = o.baseY + (isHover ? -16 : 0);
        o.group.position.z += (tz - o.group.position.z) * 0.13;
        o.group.position.y += (ty - o.group.position.y) * 0.13;

        // 只有 hover 的卡推进自己的相位、接收指针；其余卡相位冻结，指针回中位
        if (isHover) {
          o.phase += dt * 0.55;
          o.holo.uniforms.uPhase.value = o.phase;
          (o.holo.uniforms.uPointer.value as THREE.Vector2).set(pointer.x, pointer.y);
        } else {
          const p = o.holo.uniforms.uPointer.value as THREE.Vector2;
          p.x += (0.5 - p.x) * 0.15;
          p.y += (0.5 - p.y) * 0.15;
        }
        o.holo.uniforms.uHover.value += ((isHover ? 1 : 0) - o.holo.uniforms.uHover.value) * 0.12;
      });
      renderer!.render(scene, camera!);
    }
    animate(0);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      grid!.removeEventListener('pointermove', onPointerMove);
      grid!.removeEventListener('pointerleave', onPointerLeave);
      disposeObjects();
      sideMat.dispose();
      renderer!.dispose();
    };
    // cardsKey 覆盖数据变化；onPick 通过 ref 读取，不进入依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardsKey]);

  return <div className="holo-grid" ref={gridRef}>
    {cards.map(card => <button key={card.node.id} className="holo-hit" data-id={card.node.id}
      onClick={() => onPickRef.current(card.node.id)}
      aria-label={`${card.node.name}，查看档案`} />)}
    <canvas className="holo-canvas" ref={canvasRef} aria-hidden="true" />
  </div>;
}
