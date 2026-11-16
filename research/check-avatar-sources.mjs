#!/usr/bin/env node
/**
 * 缺口盘点的头像来源核查（只读，不下载、不写库）。
 *
 * 复用 fetch-avatars.mjs 的保守匹配思路：
 *  - 中文名查 zh.wikipedia，拉丁字母别名查 en.wikipedia；
 *  - 页面标题必须和艺名/别名规范化后相等；
 *  - 正文要沾说唱关键词，避免同名运动员/演员；
 *  - 只有页面本身带缩略图才算「有可用头像来源」。
 *
 * 本机 Node 无直连出口，所以直接用 playwright-core 驱动本机浏览器导航 API。
 * 用法：node research/check-avatar-sources.mjs [1|2|all]
 */
import {readFile, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const POOL = resolve(ROOT, 'research/candidate-pool.json');
const OUT = resolve(ROOT, 'research/gap-avatar-check.json');
const TIER = process.argv[2] || '1';

const norm = text => String(text || '')
  .toLowerCase()
  .replace(/[\s\-_.·・'"’“”`()（）\[\]【】《》!！,，、/\\]/g, '');
const RAP_HINTS = /说唱|饒舌|饶舌|嘻哈|rap|rapper|hip.?hop|trap|mc\b/i;

const pool = JSON.parse(await readFile(POOL, 'utf8'));
const targets = pool.items.filter(it => TIER === 'all' ? it[3] <= 2 : it[3] === Number(TIER));
console.log(`核查 ${targets.length} 位候选的维基头像来源…`);

const {chromium} = await import('playwright-core');
const exe = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-browser',
  '/usr/bin/google-chrome',
].find(existsSync);
const browser = await chromium.launch({executablePath: exe, headless: true});
const page = await browser.newPage();

async function summary(lang, title) {
  const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  try {
    const res = await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 20_000});
    if (!res || !res.ok()) return null;
    return JSON.parse(await page.evaluate(() => document.body.innerText));
  } catch {
    return null;
  }
}

const results = [];
for (let i = 0; i < targets.length; i++) {
  const [name, aliasText, city, tier, note] = targets[i];
  const aliases = String(aliasText).split('/').map(s => s.trim()).filter(Boolean);
  const titles = [];
  if (/[\u4e00-\u9fa5]/.test(name)) titles.push(['zh', name]);
  for (const alias of [name, ...aliases]) {
    if (/^[\x20-\x7e]+$/.test(alias) && alias.trim()) titles.push(['en', alias.trim()]);
  }
  for (const alias of aliases) {
    if (/[\u4e00-\u9fa5]/.test(alias)) titles.push(['zh', alias]);
  }
  if (!/[\u4e00-\u9fa5]/.test(name)) titles.push(['zh', name]);

  let best = {status: 'no-page', source: null};
  for (const [lang, title] of titles) {
    const data = await summary(lang, title);
    if (!data || data.type === 'disambiguation') continue;
    const wanted = [name, ...aliases].map(norm);
    const matched = wanted.includes(norm(data.title));
    if (!matched) continue;
    const text = `${data.description || ''} ${data.extract || ''}`;
    const rap = RAP_HINTS.test(text);
    if (data.thumbnail?.source && rap) {
      best = {
        status: 'wiki-image', source: 'wikipedia', lang, pageTitle: data.title,
        imageUrl: data.thumbnail.source,
        pageUrl: data.content_urls?.desktop?.page || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`,
        description: (data.description || '').slice(0, 90),
      };
      break;
    }
    best = {
      status: data.thumbnail?.source ? 'wiki-image-needs-review' : 'wiki-page-no-image',
      source: 'wikipedia', lang, pageTitle: data.title,
      pageUrl: data.content_urls?.desktop?.page || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`,
      description: (data.description || '').slice(0, 90),
      rap,
    };
  }
  results.push({name, aliases, city, tier, note, ...best});
  if ((i + 1) % 10 === 0 || i === targets.length - 1) {
    console.log(`${i + 1}/${targets.length}  可用头像 ${results.filter(r => r.status === 'wiki-image').length}`);
  }
}

await writeFile(OUT, JSON.stringify({generatedAt: new Date().toISOString(), tier: TIER, results}, null, 2));
console.log('写出', OUT);
console.log('统计', results.reduce((acc, r) => (acc[r.status] = (acc[r.status] || 0) + 1, acc), {}));
await browser.close();
