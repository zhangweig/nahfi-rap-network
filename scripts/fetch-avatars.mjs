#!/usr/bin/env node
/**
 * 抓取人物头像。
 *
 * 数据源按「可追溯程度」排序，不按覆盖率排序：
 *   1. Wikipedia（zh / en）—— 图来自 Wikimedia Commons，有明确许可，页面本身就是来源；
 *   2. Deezer 艺人图 —— 厂牌宣传照，覆盖率明显更高，但没有开放许可，
 *      只能作为粉丝档案的引用，落盘时必须记下来源页。
 *
 * 匹配策略是刻意保守的：只有「规范化后完全相同」才算高置信，包含匹配一律进待确认清单。
 * 这个库的立身之本是不猜，头像认错人比没有头像难看得多。
 *
 * 用法：
 *   node scripts/fetch-avatars.mjs                 # 预演，只出报告不落盘
 *   node scripts/fetch-avatars.mjs --write         # 高置信的下载到 src/assets/avatars/
 *   node scripts/fetch-avatars.mjs --write --only ma,psyp
 *   node scripts/fetch-avatars.mjs --source wiki   # 只信维基
 *
 * 网络：先走 Node 原生 fetch；在需要代理才能出网的机器上会自动回退到
 * playwright-core 驱动本机 Chrome —— 浏览器吃系统代理，是最通的一条路。
 */

import {readFile, writeFile, mkdir, access} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const AVATAR_DIR = resolve(ROOT, 'src/assets/avatars');
const REPORT = resolve(ROOT, 'research/avatars-report.json');
const LEDGER = resolve(ROOT, 'research/avatars.json');

const args = process.argv.slice(2);
const flag = name => args.includes(`--${name}`);
const value = name => {
  const hit = args.find(a => a.startsWith(`--${name}=`)) || (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : null);
  return hit ? String(hit).replace(`--${name}=`, '').replace(`--${name}`, '').trim() || null : null;
};

const WRITE = flag('write');
const ONLY = (value('only') || '').split(',').map(s => s.trim()).filter(Boolean);
const SOURCE = value('source') || 'auto';
const FORCE = flag('force');

/** 去空格、去标点、统一小写：中文按原字比较，拉丁字母忽略大小写和分隔符。 */
const norm = text => String(text || '')
  .toLowerCase()
  .replace(/[\s\-_.·・'"’“”`()（）\[\]【】《》!！,，、/\\]/g, '');

const RAP_HINTS = /说唱|饒舌|饶舌|嘻哈|rap|rapper|hip.?hop|trap|mc\b/i;

/* ── 网络：Node 直连优先，失败自动切浏览器 ─────────────────────────── */

let browserMode = false;
let page = null;
let browser = null;

async function getJson(url) {
  if (browserMode) {
    // 浏览器通道用「导航 + 读文本」而不是 fetch：很多数据源（Deezer）不返回 CORS 头，
    // 在空白页里 fetch 会被直接拦掉，而导航不受同源策略约束。
    await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 25_000});
    return JSON.parse(await page.evaluate(() => document.body.innerText));
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    const response = await fetch(url, {signal: controller.signal, headers: {'Accept': 'application/json'}});
    clearTimeout(timer);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch {
    // 这台机器没有直连出口，切到浏览器通道继续，不影响后面的调用
    await useBrowser();
    return getJson(url);
  }
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
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
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

async function saveAvatar(artist, hit) {
  const {type, buffer} = await getBinary(hit.imageUrl);
  if (!buffer.length) throw new Error('图片为空');
  if (buffer.length < 1200) throw new Error(`图片只有 ${buffer.length} 字节，可能是占位图`);
  const ext = extOf(type, hit.imageUrl);
  const file = resolve(AVATAR_DIR, `${artist.id}.${ext}`);
  await writeFile(file, buffer);
  return {file: `src/assets/avatars/${artist.id}.${ext}`, bytes: buffer.length};
}

/* ── 主流程 ────────────────────────────────────────────────────────── */

const catalog = JSON.parse(await readFile(resolve(ROOT, 'src/data/catalog.json'), 'utf8'));
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

for (const artist of targets) {
  const manual = ledger[artist.id];

  // 上一轮人工判定「这张图不是他」的，永久跳过：同一个人反复抓错图没有意义，
  // 要重新尝试得显式 --force。
  if (manual?.review === 'rejected' && !FORCE) {
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
  if (manual?.imageUrl) {
    hit = {source: 'manual', confidence: 'high', name: artist.name, imageUrl: manual.imageUrl,
      pageUrl: manual.pageUrl || '', note: manual.note || '人工指定'};
  } else if (SOURCE !== 'deezer') {
    hit = await fromWikipedia(artist);
  }
  if (!hit && SOURCE !== 'wiki') hit = await fromDeezer(artist, [...(albumsByArtist.get(artist.id) || [])]);

  let saved = null;
  if (hit && WRITE) {
    if (hit.confidence !== 'high') {
      // 只有专辑能对上的才落盘；对不上的进报告等人工确认，名字一样不算证据。
      saved = {error: '需人工确认'};
    } else {
      try {
        saved = await saveAvatar(artist, hit);
        ledger[artist.id] = {
          source: hit.source, name: hit.name, imageUrl: hit.imageUrl, pageUrl: hit.pageUrl,
          note: hit.note, file: saved.file, fetchedAt: new Date().toISOString().slice(0, 10),
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

await mkdir(dirname(REPORT), {recursive: true});
await writeFile(REPORT, JSON.stringify({generatedAt: new Date().toISOString(), stats, items: report}, null, 2));
if (WRITE) {
  await mkdir(AVATAR_DIR, {recursive: true});
  await writeFile(LEDGER, JSON.stringify(ledger, null, 2));
  console.log(`\n已写入 ${AVATAR_DIR}\n来源台账 ${LEDGER}`);
}
console.log(`报告 ${REPORT}`);
await close();
