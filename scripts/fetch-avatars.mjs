#!/usr/bin/env node
/**
 * 抓取人物头像。
 *
 * 数据源按「图是不是真人」排序（默认 auto 依次尝试）：
 *   1. 网易云艺人页 —— picUrl 是平台头像位，宣传照居多，但最容易 406 限流；
 *   2. QQ 音乐 —— 搜索结果里拿 singer.mid，按官方图片规则拼歌手头像，命中率高；
 *   3. 酷狗音乐 —— 歌手搜索 + 歌手详情，详情直接返回头像 URL；
 *   4. Wikipedia（zh / en）—— 图来自 Wikimedia Commons，有明确许可，可追溯性最好；
 *   5. Deezer 艺人图 —— picture 大量是厂牌上传的封面/logo，只作兜底。
 * 除 Wikipedia 外都没有开放许可，落盘时必须在台账里记下来源页备查。
 *
 * 匹配策略是刻意保守的：只有名字规范化后完全一致、且专辑名能对上才算高置信。
 * 这个库的立身之本是不猜，头像认错人比没有头像难看得多。
 *
 * 用法：
 *   node scripts/fetch-avatars.mjs                       # 预演，只出报告不落盘
 *   node scripts/fetch-avatars.mjs --source ncm --sheet   # 跑网易云并生成肉眼验收联络表
 *   node scripts/fetch-avatars.mjs --write --source ncm   # 高置信的下载到 src/assets/avatars/
 *   node scripts/fetch-avatars.mjs --write --source ncm --accept=ma,bridge --skip=gai --alt=psyp
 *   node scripts/fetch-avatars.mjs --write --retry        # 重跑上一轮被否决的人
 *   node scripts/fetch-avatars.mjs --write --source ncm --auto --retry
 *                                                          # 不要联络表：网易云命中即落盘
 *   node scripts/fetch-avatars.mjs --write --source auto --auto --retry
 *                                                          # 全平台兜底：网易云→QQ→酷狗→维基→Deezer
 * 联络表用法见 scripts/README-avatars.md。
 *
 * 网络：先走 Node 原生 fetch；在需要代理才能出网的机器上会自动回退到
 * playwright-core 驱动本机 Chrome —— 浏览器吃系统代理，是最通的一条路。
 */

import {readFile, writeFile, mkdir, access, unlink, rename} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve, dirname, basename} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {ProxyAgent, fetch as undiciFetch} from 'undici';

// Node 原生 fetch 不读 HTTP_PROXY；不显式挂代理就会直连失败、退化到浏览器通道，
// 而浏览器拿 QQ 图片 CDN 会被防盗链 403。端口每次会话会变，一律从 env 动态取。
// 注意必须用 undici 自己的 fetch：npm undici 的 setGlobalDispatcher 改不到 Node 内置 fetch。
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
// 本机代理对酷狗域名会返回错配证书（网宿 CDN 通配），忽略校验才能拿到 JSON。
const DISPATCHER = PROXY ? new ProxyAgent({uri: PROXY, requestTls: {rejectUnauthorized: false}, proxyTls: {rejectUnauthorized: false}}) : undefined;
const netFetch = (url, opts = {}) => undiciFetch(url, DISPATCHER ? {...opts, dispatcher: DISPATCHER} : opts);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const AVATAR_DIR = resolve(ROOT, 'src/assets/avatars');
const REPORT = resolve(ROOT, 'research/avatars-report.json');
const LEDGER = resolve(ROOT, 'research/avatars.json');
/** 候选图与联络表：只用来肉眼验收，不进 src，也不参与构建。 */
const CAND_DIR = resolve(ROOT, 'research/avatars-candidates');
const SHEET = resolve(ROOT, 'research/avatars-sheet.html');
/** 联络表里的格子大小与布局：8 列 × N 行，一屏能扫几十张。 */
const SHEET_COLS = 8;
const THUMB_PX = 200;

const args = process.argv.slice(2);
const flag = name => args.includes(`--${name}`);
const value = name => {
  const hit = args.find(a => a.startsWith(`--${name}=`)) || (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : null);
  return hit ? String(hit).replace(`--${name}=`, '').replace(`--${name}`, '').trim() || null : null;
};

const WRITE = flag('write');
const list = name => (value(name) || '').split(',').map(s => s.trim()).filter(Boolean);
const ONLY = list('only');
/** auto = 网易云 → QQ → 酷狗 → 维基 → Deezer；也可指定 ncm / qq / kugou / wiki / deezer 单跑一个。 */
const SOURCE = value('source') || 'auto';
/**
 * 抓取池：
 *   catalog —— 只跑 src/data/catalog.json 的 51 位（默认，旧行为）；
 *   base    —— 跑 server/generated/base-data.json 的全部 327 个节点；
 *   missing —— 跑 base-data 里本地还没有头像文件的节点（补漏用）。
 */
const POOL = value('pool') || 'catalog';
const FORCE = flag('force');
/** 生成肉眼验收用的缩略图联络表（候选图下载到本地，不进 src）。 */
const SHEET_MODE = flag('sheet');
/** 重试上一轮被否决的人物（换了数据源，旧结论不再适用）。 */
const RETRY = flag('retry') || FORCE;
/** 人工在联络表上确认「就是他」的中置信候选，允许落盘。 */
const ACCEPT = new Set(list('accept'));
/** 人工在联络表上看出「不是他」的，本轮不落盘，并写进台账避免下次再抓。 */
const SKIP = new Set(list('skip'));
/** 不要联络表：只要数据源命中，medium 也直接落盘。误判风险由调用方承担。 */
const AUTO = flag('auto');
/** 宽松匹配：去符号/忽略大小写后包含即算命中。救 LilHAO↔Lil_Hao. 这类写法差异，仅对补漏个别使用。 */
const LOOSE = flag('loose');
/** 网易云 picUrl 不理想时改用它的 1:1 头像位（img1v1Url）。 */
const ALT = new Set(list('alt'));

/** 繁→简：本地库专辑名多是繁体（Apple TW），网易云是简体，不归一就对不上。只收常见字。 */
const T2S = Object.fromEntries(('樂乐愛爱開开國国學学風风夢梦時时還还說说話话讓让麼么這这個个們们會会來来對对無无號号後后點点從从業业長长門门間间電电馬马鳥鸟魚鱼龍龙買买賣卖聽听戰战變变錄录歲岁麗丽彈弹傳传與与兩两為为見见親亲覺觉難难響响頭头顏颜體体寫写嚴严實实靈灵當当營营關关藝艺術术飛飞現现歡欢寶宝壞坏帶带幫帮節节擊击殺杀隊队陽阳陰阴離离雲云靜静創创殘残絕绝訴诉讀读謝谢豐丰貓猫輕轻農农鐵铁錢钱隨随雙双驚惊鬥斗齊齐義义習习區区協协單单嘆叹執执墜坠夠够場场塊块壓压溫温灣湾紅红納纳狗狗怪怪特特')
  .match(/.{2}/gu).map(pair => [...pair]));

/** 去空格、去标点、统一小写、繁转简：中文按原字比较，拉丁字母忽略大小写和分隔符。 */
const norm = text => [...String(text || '')
  .toLowerCase()
  .replace(/[\s\-_.·・'"’“”`()（）\[\]【】《》!！,，、/\\:：]/g, '')]
  .map(ch => T2S[ch] || ch).join('');

const RAP_HINTS = /说唱|饒舌|饶舌|嘻哈|rap|rapper|hip.?hop|trap|mc\b/i;

/* ── 网络：Node 直连优先，失败自动切浏览器 ─────────────────────────── */

let browserMode = false;
let page = null;
let browser = null;

/** 各平台节流：网易云最严，QQ/酷狗轻一点即可，避免把可用源也打挂。 */
const MIN_GAP = [
  ['music.163.com', 1500],
  ['y.qq.com', 500], ['c.y.qq.com', 500],
  ['kugou.com', 500],
];
const lastRequestAt = new Map();
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function pace(url) {
  if (ncmDisabled && /music\.163\.com/.test(url)) {
    const err = new Error('netease-disabled');
    err.neteaseDisabled = true;
    throw err;
  }
  const hit = MIN_GAP.find(([host]) => url.includes(host));
  if (!hit) return;
  const [host, gap] = hit;
  const wait = gap - (Date.now() - (lastRequestAt.get(host) || 0));
  if (wait > 0) await sleep(wait);
  lastRequestAt.set(host, Date.now());
}
const isRateLimited = data => data && ([405, 406].includes(data.code) || /操作频繁|稍候再试|操作密集/.test(data.msg || ''));

/** 本次运行是否遭遇限流：用于报告提示用户稍后重跑，而不是傻等。 */
let rateLimitedHits = 0;
/** 网易云一旦 406，剩余人物不再碰它，但不能挡住 QQ / 酷狗 / 维基等后续源。 */
let ncmDisabled = false;

async function getJson(url) {
  // 限流退避：网易云 405/406「操作频繁」多属 IP 级封禁，重试无用。
  // 只做一次 3s 短退避确认，仍被挡就抛 STOP 让整批尽快结束、保留已有缓存。
  for (let attempt = 0; attempt < 2; attempt++) {
    await pace(url);
    let data;
    if (browserMode) {
      // 浏览器通道用「导航 + 读文本」而不是 fetch：很多数据源（Deezer）不返回 CORS 头，
      // 在空白页里 fetch 会被直接拦掉，而导航不受同源策略约束。
      await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 25_000});
      data = JSON.parse(await page.evaluate(() => document.body.innerText));
    } else {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12_000);
        // Referer 必须匹配目标站，否则会被防盗链拒绝：网易云只认自己的，QQ/酷狗同理。
        const ref = url.includes('music.163.com') ? 'https://music.163.com/'
          : url.includes('y.qq.com') ? 'https://y.qq.com/'
          : url.includes('kugou.com') ? 'https://www.kugou.com/'
          : url.includes('deezer.com') ? 'https://www.deezer.com/' : '';
        const response = await netFetch(url, {signal: controller.signal,
          headers: {'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', ...(ref ? {Referer: ref} : {})}});
        clearTimeout(timer);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const text = await response.text();
        // 酷狗把 JSON 包在 HTML 注释里返回（<!--KG_TAG_RES_START-->{...}<!--KG_TAG_RES_END-->），
        // 直接 response.json() 会炸，剥掉注释再解析。
        const cleaned = text.replace(/<!--[^>]*-->/g, '').trim();
        data = JSON.parse(cleaned);
      } catch {
        // 这台机器没有直连出口，切到浏览器通道继续，不影响后面的调用
        await useBrowser();
        continue;
      }
    }
    if (isRateLimited(data) && attempt === 0) {
      console.error('（网易云触发限流，3 秒后再确认一次…）');
      await sleep(3000);
      continue;
    }
    if (isRateLimited(data)) {
      rateLimitedHits++;
      ncmDisabled = true;
      const err = new Error('rate-limited');
      err.rateLimited = true;
      throw err;
    }
    return data;
  }
  return null;
}

async function getBinary(url) {
  if (browserMode) {
    // 先导航到图片本身，此时 document 与图片同源，再 fetch 就没有跨域问题了
    await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 25_000});
    const result = await page.evaluate(async () => {
      const response = await fetch(location.href);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      // 分块转 base64：大图一次性 apply 会把调用栈撑爆
      let binary = '';
      const CHUNK = 0x8000;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
      }
      return {type: response.headers.get('content-type') || '', b64: btoa(binary)};
    });
    return {type: result.type, buffer: Buffer.from(result.b64, 'base64')};
  }
  try {
    const response = await netFetch(url);
    // 404/403 是资源本身的问题，不是网络不通；切浏览器只会得到同样的错误，还污染后续请求。
    if (!response.ok) return {type: '', buffer: Buffer.alloc(0)};
    return {type: response.headers.get('content-type') || '', buffer: Buffer.from(await response.arrayBuffer())};
  } catch {
    await useBrowser();
    return getBinary(url);
  }
}

async function useBrowser() {
  if (browserMode) return;
  const {chromium} = await import('playwright-core');
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
  ];
  const executablePath = candidates.find(path => existsSync(path));
  if (!executablePath) throw new Error('没找到本机 Chrome，无法回退到浏览器通道');
  browser = await chromium.launch({executablePath, headless: true});
  page = await browser.newPage();
  browserMode = true;
  console.error('（Node 直连不可用，已切到浏览器通道）');
}

const close = async () => {
  if (browser) await browser.close();
};

/* ── 两个数据源 ────────────────────────────────────────────────────── */

/**
 * 网易云艺人页。图是平台艺人页的头像位，宣传照居多，比 Deezer 的 picture（常是专辑封面）靠谱。
 *
 * 名字匹配分三档，只有第一档才有资格进入专辑验证：
 *   exact    —— 规范化后与艺名/别名完全相同；
 *   embedded —— 网易云常见的「中文名+英文名」拼写（布瑞吉Bridge、GAI周延），
 *               要求我方名字 ≥2 字且含汉字，或者拉丁名位于结果的开头/结尾且结果其余部分是汉字；
 *   其余一律丢弃 —— 拉丁短名的纯子串匹配（Bridge ⊂ Phoebe Bridgers）不算数。
 */
const CJK = /[一-龥]/;
function neteaseNameMatch(wanted, candidate) {
  const target = norm(candidate);
  if (!target) return null;
  if (wanted.includes(target)) return 'exact';
  for (const name of wanted) {
    if (!name || !target.includes(name)) continue;
    const rest = target.replace(name, '');
    if (CJK.test(name) && name.length >= 2) return 'embedded';
    // 拉丁名：只允许「汉字 + 拉丁名」或「拉丁名 + 汉字」，剩余部分必须全是汉字
    if (rest && /^[一-龥]+$/.test(rest) && (target.startsWith(name) || target.endsWith(name))) return 'embedded';
  }
  // --loose：再去掉所有非字母数字汉字做一次包含匹配，救 LilHAO↔Lil_Hao.、Vgooo↔Vgoo 这类写法差异。
  if (LOOSE) {
    const squash = s => String(s || '').toLowerCase().replace(/[^a-z0-9一-龥]/g, '');
    const t = squash(candidate);
    if (wanted.some(name => { const n = squash(name); return n.length >= 3 && t.includes(n); })) return 'loose';
  }
  return null;
}

async function fromNetease(artist, knownAlbums) {
  const names = [artist.name, ...(artist.aliases || [])].filter(Boolean);
  const wanted = names.map(norm);
  const seen = new Set();
  for (const query of names.slice(0, 4)) {
    try {
      const data = await getJson(`https://music.163.com/api/search/get/web?s=${encodeURIComponent(query)}&type=100&limit=8`);
      for (const item of data?.result?.artists || []) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        const level = [item.name, ...(item.alias || []), ...(item.alia || [])]
          .map(n => neteaseNameMatch(wanted, n)).find(Boolean);
        if (!level) continue;
        const imageUrl = item.picUrl || item.img1v1Url;
        if (!imageUrl || /\/(?:0|default)\.jpg/.test(imageUrl)) continue;

        const albums = await neteaseAlbums(item.id);
        const overlap = albums.filter(title => knownAlbums.some(known => {
          const a = norm(title), b = norm(known);
          return a.length >= 2 && b.length >= 2 && (a === b || a.includes(b) || b.includes(a));
        }));
        return {
          source: 'netease',
          confidence: overlap.length ? 'high' : 'medium',
          name: item.name,
          imageUrl,
          altImageUrl: item.img1v1Url && item.img1v1Url !== imageUrl ? item.img1v1Url : '',
          pageUrl: `https://music.163.com/#/artist?id=${item.id}`,
          note: overlap.length
            ? `网易云艺人页，专辑比对命中《${overlap[0]}》`
            : `网易云艺人页（${level === 'exact' ? '名字完全一致' : '名字含艺名'}，${item.albumSize ?? '?'} 张专辑）；无专辑交集，需人工确认`,
          albums,
        };
      }
    } catch {
      // 单个查询失败不影响其他人
    }
  }
  return null;
}

async function neteaseAlbums(id) {
  try {
    const data = await getJson(`https://music.163.com/api/artist/albums/${id}?limit=100`);
    return (data?.hotAlbums || []).map(item => item.name);
  } catch {
    return [];
  }
}

/**
 * QQ 的拼图规则对冷门歌手常返回 404（mid 有，但没上传头像）。
 * 落盘前先 HEAD 一下，404 就让这个候选作废，auto 流程才能继续走酷狗兜底。
 */
async function imageExists(url) {
  if (!url) return false;
  try {
    const response = await netFetch(url, {method: 'HEAD'});
    return response.ok;
  } catch {
    return false;
  }
}

/** 专辑名交叉验证：名字对上只是入场券，专辑能对上才算高置信。 */
function albumOverlap(titles, knownAlbums) {
  return (titles || []).filter(title => knownAlbums.some(known => {
    const a = norm(title), b = norm(known);
    return a.length >= 2 && b.length >= 2 && (a === b || a.includes(b) || b.includes(a));
  }));
}

/**
 * QQ 音乐：搜索结果里的 singer.mid 可以直接拼出官方歌手头像：
 *   https://y.gtimg.cn/music/photo_new/T001R800x800M000<mid>.jpg
 * 同一批 songs 里的 albumname 顺手拿来和本地曲库交叉验证。
 */
async function fromQQMusic(artist, knownAlbums) {
  const names = [artist.name, ...(artist.aliases || [])].filter(Boolean);
  const wanted = names.map(norm);
  const seen = new Set();
  for (const query of names.slice(0, 4)) {
    try {
      const data = await getJson(`https://c.y.qq.com/soso/fcgi-bin/client_search_cp?p=1&n=10&w=${encodeURIComponent(query)}&format=json`);
      const candidates = [];
      for (const song of data?.data?.song?.list || []) {
        const album = song.albumname || '';
        for (const s of song.singer || []) {
          if (!s.mid || seen.has(s.mid)) continue;
          const display = String(s.name || '').replace(/<[^>]+>/g, '');
          const level = neteaseNameMatch(wanted, [display]);
          if (!level) continue;
          seen.add(s.mid);
          candidates.push({mid: s.mid, name: display, albums: [album], level});
        }
      }
      if (!candidates.length) continue;
      // 有专辑交集的排前面；没有也不丢，--auto 会按 medium 落盘。
      candidates.sort((a, b) => albumOverlap(b.albums, knownAlbums).length - albumOverlap(a.albums, knownAlbums).length);
      const best = candidates[0];
      const imageUrl = `https://y.gtimg.cn/music/photo_new/T001R800x800M000${best.mid}.jpg`;
      const altImageUrl = `https://y.gtimg.cn/music/photo_new/T001R300x300M000${best.mid}.jpg`;
      // 800/300 任一可用即可；都 404 就放弃这个 QQ 候选，让 auto 走酷狗。
      if (!await imageExists(imageUrl) && !await imageExists(altImageUrl)) continue;
      const overlap = albumOverlap(best.albums, knownAlbums);
      return {
        source: 'qqmusic',
        confidence: overlap.length ? 'high' : 'medium',
        name: best.name,
        imageUrl,
        altImageUrl,
        pageUrl: `https://y.qq.com/n/ryqq/singer/${best.mid}`,
        note: overlap.length
          ? `QQ 音乐歌手页，专辑比对命中《${overlap[0]}》`
          : `QQ 音乐歌手页（singer.mid=${best.mid}）；无专辑交集，需人工确认`,
        albums: best.albums,
      };
    } catch {
      // 单个查询失败不影响其他人
    }
  }
  return null;
}

/**
 * 酷狗音乐：先用 search/singer 拿 singerid，再用 singer/info 拿 imgurl。
 * imgurl 带 {size} 占位符，替换成 500 就是 500px 头像。
 */
async function fromKugou(artist, knownAlbums) {
  const names = [artist.name, ...(artist.aliases || [])].filter(Boolean);
  const wanted = names.map(norm);
  for (const query of names.slice(0, 4)) {
    try {
      const found = await getJson(`https://msearchcdn.kugou.com/api/v3/search/singer?format=json&keyword=${encodeURIComponent(query)}&page=1&pagesize=8&showtype=1`);
      for (const item of found?.data || []) {
        if (!item.singerid || !neteaseNameMatch(wanted, [item.singername])) continue;
        const info = await getJson(`https://mobilecdnbj.kugou.com/api/v3/singer/info?singerid=${item.singerid}&with_res_tag=1`);
        const raw = info?.data?.imgurl;
        if (!raw) continue;
        const imageUrl = raw.replace('{size}', '500').replace(/^http:/, 'https:');
        const altImageUrl = raw.replace('{size}', '300').replace(/^http:/, 'https:');
        // 用歌曲搜索结果里的 album_name 做专辑交叉验证
        let albums = [];
        try {
          const songs = await getJson(`https://msearchcdn.kugou.com/api/v3/search/song?format=json&keyword=${encodeURIComponent(item.singername)}&page=1&pagesize=20&showtype=1`);
          albums = (songs?.data?.info || []).map(s => s.album_name).filter(Boolean);
        } catch { /* 专辑验证失败就按 medium 处理 */ }
        const overlap = albumOverlap(albums, knownAlbums);
        return {
          source: 'kugou',
          confidence: overlap.length ? 'high' : 'medium',
          name: item.singername,
          imageUrl,
          altImageUrl,
          pageUrl: `https://www.kugou.com/singer/${item.singerid}.html`,
          note: overlap.length
            ? `酷狗歌手页，专辑比对命中《${overlap[0]}》`
            : `酷狗歌手页（singerid=${item.singerid}）；无专辑交集，需人工确认`,
          albums,
        };
      }
    } catch {
      // 单个查询失败不影响其他人
    }
  }
  return null;
}

async function fromWikipedia(artist) {
  const titles = [];
  // 中文名优先查中文站，英文别名查英文站；两边都试，谁先命中算谁
  if (/[\u4e00-\u9fa5]/.test(artist.name)) titles.push(['zh', artist.name]);
  for (const alias of [artist.name, ...(artist.aliases || [])]) {
    if (/^[\x20-\x7e]+$/.test(alias) && alias.trim()) titles.push(['en', alias.trim()]);
  }
  if (!/[\u4e00-\u9fa5]/.test(artist.name)) titles.push(['zh', artist.name]);

  for (const [lang, title] of titles) {
    try {
      const data = await getJson(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
      if (!data || data.type === 'disambiguation' || !data.thumbnail?.source) continue;
      // 页面标题和艺名必须对得上，且正文得沾点说唱——避免「Melo」搜到同名的篮球运动员
      const matched = norm(data.title) === norm(title) || (artist.aliases || []).some(a => norm(a) === norm(data.title));
      if (!matched) continue;
      const text = `${data.description || ''} ${data.extract || ''}`;
      if (!RAP_HINTS.test(text)) continue;
      return {
        source: 'wikipedia',
        confidence: 'high',
        name: data.title,
        imageUrl: data.thumbnail.source.replace(/\/\d+px-/, '/500px-'),
        pageUrl: data.content_urls?.desktop?.page || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`,
        note: `${lang}.wikipedia 页面缩略图`,
      };
    } catch {
      // 404 是常态，继续试下一个候选标题
    }
  }
  return null;
}

async function fromDeezer(artist, aliasesOfAlbums) {
  const queries = [artist.name, ...(artist.aliases || [])].filter(Boolean).slice(0, 4);
  const seen = new Set();
  for (const query of queries) {
    try {
      const data = await getJson(`https://api.deezer.com/search/artist?q=${encodeURIComponent(query)}&limit=6`);
      for (const item of data?.data || []) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        const wanted = [artist.name, ...(artist.aliases || [])].map(norm);
        if (!wanted.includes(norm(item.name))) continue;
        const imageUrl = item.picture_big || item.picture_medium || item.picture_xl;
        if (!imageUrl) continue;

        // 名字对上只是入场券。真正判身份靠专辑交叉验证：
        // 把这位 Deezer 艺人的专辑和我们库里他的专辑名对一遍，有交集才算认对了人。
        const albums = await deezerAlbums(item.id);
        const overlap = albums.filter(title => aliasesOfAlbums.some(known => {
          const a = norm(title), b = norm(known);
          return a && b && (a === b || a.includes(b) || b.includes(a));
        }));

        return {
          source: 'deezer',
          confidence: overlap.length ? 'high' : 'medium',
          name: item.name,
          imageUrl,
          pageUrl: item.link || `https://www.deezer.com/artist/${item.id}`,
          note: overlap.length
            ? `Deezer 艺人页，专辑比对命中《${overlap[0]}》`
            : `Deezer 艺人页，${item.nb_fan ?? '?'} 粉丝；同库无专辑交集，需人工确认`,
          fans: item.nb_fan ?? 0,
          albums,
        };
      }
    } catch {
      // 单个查询失败不影响其他人
    }
  }
  return null;
}

/** 拿一位 Deezer 艺人的专辑名，用于和本地库交叉验证。失败就当没有，不影响主流程。 */
async function deezerAlbums(id) {
  try {
    const data = await getJson(`https://api.deezer.com/artist/${id}/albums?limit=100`);
    return (data?.data || []).map(item => item.title);
  } catch {
    return [];
  }
}

/* ── 落盘 ──────────────────────────────────────────────────────────── */

const extOf = (mime, url) => {
  if (/png/i.test(mime) || /\.png($|\?)/i.test(url)) return 'png';
  if (/webp/i.test(mime) || /\.webp($|\?)/i.test(url)) return 'webp';
  return 'jpg';
};

/**
 * 下载并缩到最长边 640px。网易云原图常是 3000–4000px、1MB+，327 张全放进仓库不现实；
 * 640px 对 300px 宽的大卡留足 2x。没有 ffmpeg 时原样落盘（缩略图脚本本来也依赖它）。
 */
async function downloadScaled(url, destBase) {
  const {type, buffer} = await getBinary(url);
  if (!buffer.length) throw new Error('图片为空');
  if (buffer.length < 1200) throw new Error(`图片只有 ${buffer.length} 字节，可能是占位图`);
  const ext = extOf(type, url);
  const raw = `${destBase}.raw.${ext}`;
  await writeFile(raw, buffer);
  const out = `${destBase}.${ext === 'png' ? 'png' : 'jpg'}`;
  try {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw,
      '-vf', "scale='min(640,iw)':'min(640,ih)':force_original_aspect_ratio=decrease",
      ...(ext === 'png' ? [] : ['-q:v', '3']), out], {stdio: 'pipe'});
    await unlink(raw);
  } catch {
    await rename(raw, out);
  }
  return {file: out, bytes: (await readFile(out)).length};
}

async function saveAvatar(artist, hit) {
  let saved;
  try {
    saved = await downloadScaled(hit.imageUrl, resolve(AVATAR_DIR, artist.id));
  } catch (error) {
    // QQ 的 800px 图不一定每个 mid 都有；退回 300px 官方头像位。
    if (!hit.altImageUrl) throw error;
    saved = await downloadScaled(hit.altImageUrl, resolve(AVATAR_DIR, artist.id));
  }
  return {file: `src/assets/avatars/${basename(saved.file)}`, bytes: saved.bytes};
}

/* ── 联络表：一次看几十张候选，而不是逐张开图 ────────────────────────── */

/**
 * 下载候选图并缩到 THUMB_PX。落在 research/avatars-candidates/，
 * 只在本地肉眼验收用；HTML 用相对路径引用，断网也能翻。
 */
async function makeThumb(url, id, suffix = '') {
  const dest = resolve(CAND_DIR, `${id}${suffix}.jpg`);
  if (existsSync(dest)) return `avatars-candidates/${id}${suffix}.jpg`;
  const {buffer} = await getBinary(url);
  if (!buffer.length || buffer.length < 1200) throw new Error('空图或占位图');
  const raw = `${dest}.raw`;
  await writeFile(raw, buffer);
  try {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw,
      '-vf', `scale=${THUMB_PX}:-2`, '-q:v', '5', dest], {stdio: 'pipe'});
    await unlink(raw);
  } catch {
    // 没有 ffmpeg 时退回原图（联络表仍能看，只是文件大些）
    await rename(raw, dest);
  }
  return `avatars-candidates/${id}${suffix}.jpg`;
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

/** 生成 HTML 联络表：每格标序号+名字，点格子切换采纳/否决，底部实时生成命令。 */
function renderSheet(cells) {
  const cards = cells.map((cell, i) => {
    const no = String(i + 1).padStart(2, '0');
    const conf = cell.conf || '—';
    const confClass = conf === 'high' ? 'hi' : conf === 'medium' ? 'mid' : 'miss';
    const thumb = cell.thumb
      ? `<img src="${esc(cell.thumb)}" loading="lazy" alt="${esc(cell.name)}">`
      : `<div class="noimg">无候选</div>`;
    const links = cell.pageUrl
      ? `<a href="${esc(cell.pageUrl)}" target="_blank" rel="noopener" title="打开来源页">来源↗</a>`
      : '';
    const alt = cell.altThumb
      ? `<a href="#" class="altlink" data-id="${esc(cell.id)}" title="看 1:1 头像位">1:1</a>`
      : '';
    const note = esc(cell.note || cell.skipped || '');
    return `<div class="cell" data-id="${esc(cell.id)}" data-no="${no}">
      <div class="no">${no}</div>
      <div class="thumb">${thumb}</div>
      <div class="name">${esc(cell.name)}</div>
      <div class="meta"><span class="conf ${confClass}">${esc(cell.source || '')} ${conf}</span>${links}${alt}</div>
      <div class="note" title="${note}">${note}</div>
      <div class="stamps"><span class="s-ok">✓采用</span><span class="s-no">✗否决</span><span class="s-1">1:1</span></div>
    </div>`;
  }).join('');

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>头像候选联络表 · ${new Date().toISOString().slice(0, 10)}</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#110e0c;color:#efe7dc;font:13px/1.5 "Microsoft YaHei",sans-serif;padding:20px 22px 90px}
h1{font-size:18px;margin:0 0 4px;color:#e4572e;letter-spacing:.04em}
.lead{color:#a39584;font-size:12px;margin:0 0 16px}
.legend{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:16px;font-size:12px;color:#b3a593}
.legend b{color:#efe7dc}.hi{color:#b9d84a}.mid{color:#e9a23b}.miss{color:#7a6b5c}
.grid{display:grid;grid-template-columns:repeat(${SHEET_COLS},minmax(0,1fr));gap:9px}
.cell{position:relative;background:#1c1712;border:1px solid #3a2b21;border-radius:7px;padding:6px;cursor:pointer;transition:border-color .15s,background .15s}
.cell:hover{border-color:#e4572e;background:#241c15}
.cell.mark-ok{border-color:#b9d84a;background:#1d2413}
.cell.mark-no{border-color:#c4462f;background:#29130f;opacity:.62}
.cell.mark-1{border-color:#e9a23b;background:#251a0e}
.no{position:absolute;top:6px;left:6px;z-index:2;background:#e4572e;color:#110e0c;font:700 12px/1 ui-monospace,monospace;padding:3px 5px;border-radius:3px}
.thumb{height:${THUMB_PX}px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#0a0807;border-radius:4px}
.thumb img{width:100%;height:100%;object-fit:cover;display:block}
.noimg{color:#5a4a3c;font-size:12px}
.name{margin-top:6px;font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.meta{display:flex;gap:6px;align-items:center;font-size:10px;margin-top:2px;min-height:15px}
.meta a{color:#8fb7d6;text-decoration:none}.meta a:hover{text-decoration:underline}
.note{font-size:10px;color:#8a7b6c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}
.stamps{display:none;position:absolute;right:6px;top:6px;gap:4px;z-index:3}
.cell:hover .stamps{display:flex}
.stamps span{font-size:10px;padding:2px 4px;border-radius:3px;background:#000a;color:#efe7dc}
.s-ok{color:#b9d84a!important}.s-no{color:#ff7a5c!important}.s-1{color:#e9a23b!important}
.bar{position:fixed;left:0;right:0;bottom:0;background:#1c1712f2;border-top:1px solid #e4572e;padding:10px 22px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.bar .count{font-size:12px;color:#b3a593}
.cmd{flex:1;min-width:320px;background:#0a0807;border:1px solid #3a2b21;color:#b9d84a;font:11px/1.4 ui-monospace,monospace;padding:7px 9px;border-radius:4px;word-break:break-all}
button.copy{background:#e4572e;color:#110e0c;border:0;border-radius:4px;padding:8px 14px;font-weight:700;cursor:pointer}
button.reset{background:transparent;color:#a39584;border:1px solid #3a2b21;border-radius:4px;padding:8px 10px;cursor:pointer}
@media(max-width:1200px){.grid{grid-template-columns:repeat(5,minmax(0,1fr))}}
@media(max-width:800px){.grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
</style></head><body>
<h1>头像候选联络表</h1>
<p class="lead">${cells.length} 位候选 · 扫一眼，点掉不对的，底部复制命令回脚本。序号即第几格。</p>
<div class="legend"><span><b>操作：</b>单击=✓采用 · 右键=✗否决 · Shift+单击=改用 1:1 头像位 · 再按一次取消</span>
<span class="hi">hi=高置信</span><span class="mid">mid=待确认</span><span class="miss">—=未命中</span></div>
<div class="grid">${cards}</div>
<div class="bar">
  <span class="count" id="count">采用 0 · 否决 0 · 1:1 0</span>
  <code class="cmd" id="cmd"></code>
  <button class="copy" id="copy">复制命令</button>
  <button class="reset" id="reset">清空标记</button>
</div>
<script>
const state={}; // id -> ok | no | one
const grid=document.querySelector('.grid');
function build(){
  const ok=[],no=[],one=[];
  for(const [id,v] of Object.entries(state)){ if(v==='ok')ok.push(id); else if(v==='no')no.push(id); else if(v==='one')one.push(id); }
  const p=x=>x.length?' --'+x[0]+'='+x.join(','):'';
  const cmd='node scripts/fetch-avatars.mjs --write --source ncm'+
    (ok.length?' --accept='+ok.join(','):'')+
    (no.length?' --skip='+no.join(','):'')+
    (one.length?' --alt='+one.join(','):'');
  document.querySelector('#cmd').textContent=cmd;
  document.querySelector('#count').textContent='采用 '+ok.length+' · 否决 '+no.length+' · 1:1 '+one.length;
}
function set(cell,val){
  const id=cell.dataset.id;
  state[id]= state[id]===val ? null : val;
  cell.classList.remove('mark-ok','mark-no','mark-1');
  if(state[id]==='ok')cell.classList.add('mark-ok');
  if(state[id]==='no')cell.classList.add('mark-no');
  if(state[id]==='one')cell.classList.add('mark-1');
  build();
}
grid.addEventListener('click',e=>{
  if(e.target.closest('.altlink')){
    e.preventDefault(); set(e.target.closest('.cell'),'one'); return;
  }
  if(e.target.closest('a'))return;
  set(e.target.closest('.cell'),'ok');
});
grid.addEventListener('contextmenu',e=>{
  const cell=e.target.closest('.cell'); if(!cell)return;
  e.preventDefault(); set(cell,'no');
});
document.querySelector('#copy').onclick=async()=>{
  const t=document.querySelector('#cmd').textContent;
  try{await navigator.clipboard.writeText(t);document.querySelector('#copy').textContent='已复制';setTimeout(()=>document.querySelector('#copy').textContent='复制命令',1200);}
  catch{window.prompt('手动复制：',t);}
};
document.querySelector('#reset').onclick=()=>{for(const k in state)delete state[k];document.querySelectorAll('.cell').forEach(c=>c.classList.remove('mark-ok','mark-no','mark-1'));build();};
build();
</script></body></html>`;
}

/* ── 主流程 ────────────────────────────────────────────────────────── */

let catalog = JSON.parse(await readFile(resolve(ROOT, 'src/data/catalog.json'), 'utf8'));

/** 本地已有头像文件（任意扩展名）：补漏时据此跳过，不重复抓。 */
const hasLocalAvatar = id => ['jpg', 'jpeg', 'png', 'webp'].some(ext => existsSync(resolve(AVATAR_DIR, `${id}.${ext}`)));

if (POOL === 'base' || POOL === 'missing') {
  const base = JSON.parse(await readFile(resolve(ROOT, 'server/generated/base-data.json'), 'utf8'));
  const artists = base.nodes
    .filter(node => POOL === 'base' || !hasLocalAvatar(node.id))
    // 厂牌/组合没有"艺人头像"，QQ/酷狗搜到的多是 logo；补漏只针对真实艺人节点。
    .filter(node => POOL === 'base' || node.kind === 'artist')
    .map(node => ({
      id: node.id,
      name: node.name,
      aliases: node.aliases || [],
      kind: node.kind,
      city: node.city,
      category: node.category,
      color: node.color,
    }));
  // base-data 的 works.album 常为空，退回 title 也能给身份交叉验证提供信号。
  const works = (base.works || []).map(work => ({...work, album: work.album || work.title || ''}));
  catalog = {artists, works};
  console.log(`抓取池 ${POOL}：base-data ${base.nodes.length} 节点 → 本次 ${artists.length} 位（跳过本地已有头像 ${base.nodes.length - artists.length} 位）\n`);
}

const ledger = existsSync(LEDGER) ? JSON.parse(await readFile(LEDGER, 'utf8')) : {};

/** 每位艺人自己的专辑名，用来给 Deezer 候选做身份交叉验证。只取第一署名，避免客串专辑污染。 */
const albumsByArtist = new Map();
for (const work of catalog.works || []) {
  const owner = work.artistIds?.[0];
  if (!owner || !work.album) continue;
  if (!albumsByArtist.has(owner)) albumsByArtist.set(owner, new Set());
  albumsByArtist.get(owner).add(work.album);
}

let targets = catalog.artists;
if (ONLY.length) targets = targets.filter(a => ONLY.includes(a.id));
console.log(`共 ${catalog.artists.length} 位人物，本次处理 ${targets.length} 位${WRITE ? '（会写入文件）' : '（预演，不写文件）'}\n`);

const report = [];
const rows = [];
const cells = [];
if (SHEET_MODE) await mkdir(CAND_DIR, {recursive: true});

for (const artist of targets) {
  // 网易云限流后只禁用 ncm 这一个源；auto 模式继续走 QQ / 酷狗 / 维基，不再整批空转。
  const manual = ledger[artist.id];

  // 上一轮人工判定「这张图不是他」的，永久跳过：同一个人反复抓错图没有意义，
  // 要重新尝试得显式 --force。
  if (manual?.review === 'rejected' && !RETRY) {
    report.push({id: artist.id, name: artist.name, aliases: artist.aliases || [], hit: null, skipped: manual.reviewNote || '已标记不采用'});
    rows.push([
      artist.id.padEnd(16),
      artist.name.slice(0, 12).padEnd(14),
      'skipped'.padEnd(16),
      manual.reviewNote || '',
    ].join(' '));
    continue;
  }

  // 人工指定优先：research/avatars.json 里写了就直接用，不再猜
  let hit = null;
  // --retry 时用新数据源重新抓，忽略台账里上一轮的旧图（否则永远在复看同一批）
  if (manual?.imageUrl && !RETRY) {
    hit = {source: 'manual', confidence: 'high', name: artist.name, imageUrl: manual.imageUrl,
      pageUrl: manual.pageUrl || '', note: manual.note || '人工指定'};
  } else {
    const albums = [...(albumsByArtist.get(artist.id) || [])];
    // auto 顺序：网易云 → QQ → 酷狗 → 维基 → Deezer；指定源则只跑那一个。
    const tryNcm = SOURCE === 'auto' || SOURCE === 'ncm' || SOURCE === 'netease';
    const tryQQ = SOURCE === 'auto' || SOURCE === 'qq' || SOURCE === 'qqmusic';
    const tryKugou = SOURCE === 'auto' || SOURCE === 'kugou';
    const tryWiki = SOURCE === 'auto' || SOURCE === 'wiki';
    const tryDeezer = SOURCE === 'auto' || SOURCE === 'deezer';
    if (tryNcm && !ncmDisabled) hit = await fromNetease(artist, albums);
    if (!hit && tryQQ) hit = await fromQQMusic(artist, albums);
    if (!hit && tryKugou) hit = await fromKugou(artist, albums);
    if (!hit && tryWiki) hit = await fromWikipedia(artist);
    if (!hit && tryDeezer) hit = await fromDeezer(artist, albums);
    if (!hit && ncmDisabled && (SOURCE === 'ncm' || SOURCE === 'netease')) {
      report.push({id: artist.id, name: artist.name, aliases: artist.aliases || [], hit: null, skipped: '网易云限流，待重跑'});
      rows.push([artist.id.padEnd(16), artist.name.slice(0, 12).padEnd(14), 'rate-limited'.padEnd(16), '']);
      continue;
    }
    // 联络表上标了 alt 的人，改用网易云的 1:1 头像位（picUrl 常常是横向宣传图）
    if (hit && ALT.has(artist.id) && hit.altImageUrl) {
      hit = {...hit, imageUrl: hit.altImageUrl, note: `${hit.note}（已改用 1:1 头像位）`};
    }
  }

  let saved = null;
  if (hit && SKIP.has(artist.id) && WRITE) {
    // 联络表上人工看出「不是他」的，本轮即使高置信也不落盘，并写进台账永久记住
    ledger[artist.id] = {
      ...(ledger[artist.id] || {}), source: hit.source, name: hit.name,
      imageUrl: hit.imageUrl, pageUrl: hit.pageUrl, note: hit.note,
      review: 'rejected', reviewNote: '联络表人工否决', fetchedAt: new Date().toISOString().slice(0, 10),
    };
    saved = {error: '人工否决'};
  } else if (hit && WRITE) {
    if (hit.confidence !== 'high' && !ACCEPT.has(artist.id) && !AUTO) {
      // 默认只有专辑能对上的才落盘；--auto 时 medium 也直接落盘，不再等人工确认。
      saved = {error: '需人工确认'};
    } else {
      try {
        saved = await saveAvatar(artist, hit);
        ledger[artist.id] = {
          source: hit.source, name: hit.name, imageUrl: hit.imageUrl, pageUrl: hit.pageUrl,
          note: hit.note, file: saved.file, fetchedAt: new Date().toISOString().slice(0, 10),
          ...(AUTO && hit.confidence !== 'high'
            ? {review: 'auto-approved'}
            : ACCEPT.has(artist.id) && hit.confidence !== 'high'
              ? {review: 'manually-approved'}
              : {}),
        };
      } catch (error) {
        saved = {error: error.message};
      }
    }
  }

  report.push({id: artist.id, name: artist.name, aliases: artist.aliases || [], hit, saved});
  rows.push([
    artist.id.padEnd(16),
    artist.name.slice(0, 12).padEnd(14),
    (hit ? `${hit.source}/${hit.confidence}` : '—').padEnd(16),
    saved?.error ? `FAIL ${saved.error}` : saved ? `${(saved.bytes / 1024).toFixed(0)}KB` : hit ? '待写入' : '',
  ].join(' '));

  // 联络表：下载候选缩略图（失败不阻断主流程，格子会标「无候选」）
  // 磁盘上已有缓存的（上一轮抓到过），即使本轮限流没重抓也照样显示。
  if (SHEET_MODE) {
    const cached = n => existsSync(resolve(CAND_DIR, `${artist.id}${n}.jpg`));
    let thumb = cached('') ? `avatars-candidates/${artist.id}.jpg` : '';
    let altThumb = cached('-alt') ? `avatars-candidates/${artist.id}-alt.jpg` : '';
    if (hit) {
      try { thumb = await makeThumb(hit.imageUrl, artist.id); }
      catch (error) { console.error(`  缩略图失败 ${artist.id}: ${error.message}`); }
      if (hit.altImageUrl) {
        try { altThumb = await makeThumb(hit.altImageUrl, artist.id, '-alt'); }
        catch { /* 1:1 图拿不到就算了 */ }
      }
    }
    cells.push({
      id: artist.id, name: artist.name,
      source: hit?.source || '', conf: hit?.confidence || '',
      note: hit?.note || '', pageUrl: hit?.pageUrl || '',
      skipped: report.at(-1)?.skipped || '',
      thumb, altThumb,
    });
  }
}

console.log(rows.join('\n'));

const stats = {
  total: report.length,
  high: report.filter(r => r.hit?.confidence === 'high').length,
  medium: report.filter(r => r.hit?.confidence === 'medium').length,
  miss: report.filter(r => !r.hit).length,
  bySource: report.filter(r => r.hit).reduce((acc, r) => ({...acc, [r.hit.source]: (acc[r.hit.source] || 0) + 1}), {}),
};
console.log(`\n可自动写入 ${stats.high}，待人工确认 ${stats.medium}，未命中 ${stats.miss}`,
  Object.entries(stats.bySource).map(([k, v]) => `${k} ${v}`).join(' · '));
if (rateLimitedHits > 0) {
  console.log(`⚠ 网易云有 ${rateLimitedHits} 次请求被限流（操作频繁）。等 10-20 分钟后重跑：`,
    'node scripts/fetch-avatars.mjs --retry --source ncm --sheet');
}

await mkdir(dirname(REPORT), {recursive: true});
await writeFile(REPORT, JSON.stringify({generatedAt: new Date().toISOString(), stats, items: report}, null, 2));
if (WRITE) {
  await mkdir(AVATAR_DIR, {recursive: true});
  await writeFile(LEDGER, JSON.stringify(ledger, null, 2));
  console.log(`\n已写入 ${AVATAR_DIR}\n来源台账 ${LEDGER}`);
}
console.log(`报告 ${REPORT}`);

if (SHEET_MODE) {
  await mkdir(CAND_DIR, {recursive: true});
  await writeFile(SHEET, renderSheet(cells));
  console.log(`联络表 ${SHEET}（${cells.length} 格；候选图在 ${CAND_DIR}）`);
}
await close();
