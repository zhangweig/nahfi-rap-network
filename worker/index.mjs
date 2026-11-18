import baseData from '../server/generated/base-data.json';
import {validateSubmission,validateReport,validateRating,fingerprint,InputError} from '../server/domain.mjs';
import {snapshot,createSubmission,listSubmissions,decideSubmission,createReport,listReports,decideReport,setRating,ratingStats} from './store.mjs';

/**
 * Cloudflare Workers 版投稿 / 审核 API。
 *
 * 与 server/app.mjs 的差异只有运行环境，业务规则全部复用 server/domain.mjs：
 * - 存储从本地 SQLite 换成 D1（见 worker/schema.sql）
 * - 鉴权从 HttpOnly Cookie 换成 Bearer token，因为前端在 GitHub Pages、API 在 Workers，
 *   属于跨站请求，SameSite 限制会让 cookie 时灵时不灵
 * - 静态文件不再由本服务提供，页面仍然托管在 GitHub Pages
 */

const BASE = baseData;
// 单人审核台，没必要 8 小时就逼着重新输密钥。真正的风险是本机浏览器被他人使用，
// 不是有效期长短；密钥本身是 48 位随机串，改密码后记得清 sessions 表踢掉旧设备。
const SESSION_TTL = 30 * 24 * 3600_000;
const MAX_BODY = 24_000;

/**
 * 公开数据缓存。
 *
 * 首页每 30 秒轮询一次 /api/data，不缓存的话几百个访客就能把 Workers 免费额度
 * （10 万请求/天）打满，届时全站投稿入口会消失。这里用 Cache API 而不是只设
 * `Cache-Control` 响应头——Worker 自己产生的响应默认不进 Cloudflare 边缘缓存，
 * 光写头没有任何作用。
 *
 * 缓存放的是「裸响应」：CORS 头由 withCors 在返回时按当前请求的 Origin 补上，
 * 避免把某一个来源的 Access-Control-Allow-Origin 缓存下来串给其他来源。
 * cache key 用请求自身的 origin 拼：Cache API 不接受与自己不同 host 的 key。
 */
const DATA_TTL = 60;

/** 缓存不可用时退化为直读 D1，功能不受影响，只是额度保护失效。 */
function dataCache() {
  try {
    return typeof caches !== 'undefined' ? caches.default : null;
  } catch {
    return null;
  }
}

async function purgeData(origin) {
  // 审核通过后必须清掉，否则站长点完「通过」刷新 60 秒内还是旧数据。
  try {
    await dataCache()?.delete(new Request(new URL('/api/data', origin)));
  } catch {
    // 本地运行时缓存可能未启用，忽略即可，不影响正确性。
  }
}
const encoder = new TextEncoder();

const hex = buffer => [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('');

async function sha256(value) {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

function randomToken() {
  return hex(crypto.getRandomValues(new Uint8Array(32)));
}

/** 恒定时间比较，避免通过响应时间猜测密钥。 */
async function safeEqual(left, right) {
  const [a, b] = await Promise.all([sha256(String(left)), sha256(String(right))]);
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Workers 实例常驻期间有效；跨机房不共享，所以只是「防误触」级别的限流，不是硬防线。
const buckets = new Map();
function limit(request, scope, max) {
  const now = Date.now();
  for (const [key, entry] of buckets) if (entry.until < now) buckets.delete(key);
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const key = `${scope}:${ip}`;
  const entry = buckets.get(key) || {count: 0, until: now + 600_000};
  entry.count += 1;
  buckets.set(key, entry);
  if (entry.count > max) throw new InputError('操作太频繁，请 10 分钟后重试', 429);
}

function allowedOrigin(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return null;
  const list = [env.PUBLIC_ORIGIN, ...(env.DEV_ORIGINS || '').split(',')]
    .map(item => String(item || '').trim().replace(/\/$/, ''))
    .filter(Boolean);
  return list.includes(origin.replace(/\/$/, '')) ? origin : null;
}

const baseHeaders = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  Vary: 'Origin'
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {...baseHeaders, 'Content-Type': 'application/json; charset=utf-8'}
  });
}

function withCors(response, origin) {
  if (!origin) return response;
  const next = new Response(response.body, response);
  next.headers.set('Access-Control-Allow-Origin', origin);
  next.headers.set('Access-Control-Allow-Methods', 'GET,HEAD,POST,OPTIONS');
  next.headers.set('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  next.headers.set('Access-Control-Max-Age', '86400');
  return next;
}

async function readJson(request) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) {
    throw new InputError('仅接受 JSON 请求', 415);
  }
  const text = await request.text();
  if (text.length > MAX_BODY) throw new InputError('投稿内容过大', 413);
  try {
    return JSON.parse(text);
  } catch {
    throw new InputError('JSON 格式错误');
  }
}

async function isOwner(request, env) {
  const header = request.headers.get('Authorization') || '';
  if (!header.startsWith('Bearer ')) return false;
  const token = header.slice(7).trim();
  if (!token) return false;
  const row = await env.DB.prepare('SELECT hash FROM sessions WHERE hash=? AND expires>?')
    .bind(await sha256(token), Date.now()).first();
  return Boolean(row);
}

async function requireOwner(request, env) {
  if (!(await isOwner(request, env))) throw new InputError('请先登录审核台', 401);
}

async function route(request, env, url) {
  const {pathname} = url;
  const method = request.method === 'HEAD' ? 'GET' : request.method;
  if (!['GET', 'POST'].includes(method)) throw new InputError('请求方法不支持', 405);
  if (!env.DB) throw new InputError('数据库未绑定，请检查 wrangler 的 d1_databases 配置', 500);

  if (pathname === '/api/data' && method === 'GET') {
    if (request.method === 'HEAD') return new Response(null, {status: 200, headers: baseHeaders});
    const cache = dataCache();
    const cacheKey = new Request(new URL('/api/data', url.origin));
    const hit = cache ? await cache.match(cacheKey) : null;
    if (hit) return hit;
    const [data, ratings] = await Promise.all([snapshot(env.DB, BASE), ratingStats(env.DB)]);
    const body = {
      ...data,
      ratings,
      revisions: Object.fromEntries([...data.nodes, ...data.relations].map(item => [item.id, fingerprint(item)]))
    };
    // max-age=0 让浏览器每次都回边缘取，边缘按 s-maxage 缓存 60 秒。
    // 这样审核后 purgeData() 一清，所有访客立刻看到新数据，不会卡在浏览器本地缓存。
    const response = new Response(JSON.stringify(body), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': `public, max-age=0, s-maxage=${DATA_TTL}`,
        'X-Content-Type-Options': 'nosniff'
      }
    });
    if (cache) {
      try {
        await cache.put(cacheKey, response.clone());
      } catch (error) {
        // 缓存写入失败不能影响正常响应，退回直读即可。
        console.error('cache.put failed', error);
      }
    }
    return response;
  }

  if (pathname === '/api/session' && method === 'GET') return json({owner: await isOwner(request, env)});

  if (pathname === '/api/login' && method === 'POST') {
    limit(request, 'login', 10);
    if (!env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.length < 16) {
      throw new InputError('服务端尚未配置审核密钥（ADMIN_PASSWORD 至少 16 位）', 500);
    }
    const input = await readJson(request);
    if (typeof input.password !== 'string' || input.password.length > 500 || !(await safeEqual(input.password, env.ADMIN_PASSWORD))) {
      throw new InputError('审核密钥错误', 401);
    }
    const token = randomToken();
    const expires = Date.now() + SESSION_TTL;
    await env.DB.prepare('DELETE FROM sessions WHERE expires<?').bind(Date.now()).run();
    await env.DB.prepare('INSERT INTO sessions(hash,expires) VALUES(?,?)').bind(await sha256(token), expires).run();
    return json({owner: true, token, expires});
  }

  if (pathname === '/api/logout' && method === 'POST') {
    const header = request.headers.get('Authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (token) await env.DB.prepare('DELETE FROM sessions WHERE hash=?').bind(await sha256(token)).run();
    return json({ok: true});
  }

  if (pathname === '/api/submissions' && method === 'POST') {
    limit(request, 'submit', 20);
    const input = await readJson(request);
    const value = validateSubmission(input, await snapshot(env.DB, BASE));
    const id = await createSubmission(env.DB, value);
    return json({id, status: 'pending'}, 201);
  }

  // 星级评分：不进审核队列、不写 approved 表，直接 UPSERT 一条投票。
  // 聚合均分随 /api/data 公开；提交后清缓存，所有人下一次请求就能看到新分数。
  if (pathname === '/api/ratings' && method === 'POST') {
    limit(request, 'rate', 60);
    const value = validateRating(await readJson(request), await snapshot(env.DB, BASE));
    await setRating(env.DB, value);
    await purgeData(url.origin);
    return json({ok: true});
  }

  if (pathname === '/api/review' && method === 'GET') {
    await requireOwner(request, env);
    return json(await listSubmissions(env.DB, BASE));
  }

  // 勘误：游客提交，站长处理。不写 approved 表，所以永远不会污染公开数据。
  if (pathname === '/api/reports' && method === 'POST') {
    limit(request, 'report', 15);
    const value = validateReport(await readJson(request), await snapshot(env.DB, BASE));
    return json({id: await createReport(env.DB, value), status: 'open'}, 201);
  }

  if (pathname === '/api/reports' && method === 'GET') {
    await requireOwner(request, env);
    return json(await listReports(env.DB));
  }

  const reportDecision = pathname.match(/^\/api\/reports\/([a-zA-Z0-9-]+)$/);
  if (reportDecision && method === 'POST') {
    await requireOwner(request, env);
    const {action, note = ''} = await readJson(request);
    return json(await decideReport(env.DB, reportDecision[1], action, note));
  }

  const decision = pathname.match(/^\/api\/review\/([a-zA-Z0-9-]+)$/);
  if (decision && method === 'POST') {
    await requireOwner(request, env);
    const {action, note = ''} = await readJson(request);
    const result = await decideSubmission(env.DB, BASE, decision[1], action, note);
    // 审核结果要立刻对外可见，不能等缓存自然过期。
    if (action === 'approve') await purgeData(url.origin);
    return json(result);
  }

  throw new InputError('接口不存在', 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = allowedOrigin(request, env);

    if (request.method === 'OPTIONS') {
      if (!origin) return new Response(null, {status: 403, headers: baseHeaders});
      return withCors(new Response(null, {status: 204, headers: baseHeaders}), origin);
    }

    try {
      const safeMethod = request.method === 'GET' || request.method === 'HEAD';
      // 写操作要求来源在白名单内，挡住别的站点冒用接口；GET 只做 CORS 限制，方便 curl 自测。
      if (!safeMethod && request.headers.get('Origin') && !origin) {
        throw new InputError('请求来源不匹配', 403);
      }
      return withCors(await route(request, env, url), origin);
    } catch (error) {
      const status = error.status || 500;
      const message = error.status ? error.message : '服务器暂时无法完成操作，请稍后重试';
      if (!error.status) console.error(error);
      return withCors(json({error: message}, status), origin);
    }
  }
};
