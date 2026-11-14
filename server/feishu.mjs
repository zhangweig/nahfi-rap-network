import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** 允许指向本地 mock 服务，便于在没有真实凭证时跑通链路测试。 */
const baseUrl = () => (process.env.FEISHU_BASE_URL || 'https://open.feishu.cn/open-apis').replace(/\/+$/, '');

let envLoaded = false;
let envFileSeen = false;
export function loadEnv() {
  if (envLoaded) return;
  envLoaded = true;
  try {
    process.loadEnvFile(resolve(ROOT, '.env'));
    envFileSeen = true;
  } catch {
    // 没有 .env 时回落到真实环境变量（CI / 服务器）。
  }
}

const HINTS = {
  99991663: 'tenant_access_token 无效，检查 FEISHU_APP_ID / FEISHU_APP_SECRET 是否配对。',
  99991664: '应用凭证被拒绝，确认自建应用已发布且未停用。',
  21001: '平台策略拒绝签发 token，不是凭证写错。验证方法：把 App Secret 故意改成错的再请求，\n' +
    '  若返回 10014 app secret invalid，说明密钥正确、被拒的是策略层。\n' +
    '  最常见原因是租户类型——飞书「个人版」没有 OpenAPI 调用资质。\n' +
    '  处理：在飞书里创建一个团队（免费标准版即可），在该团队下重建自建应用，换一套凭证。',
  1254005: 'app_token 不存在，确认 .env 里的 FEISHU_APP_TOKEN 是多维表格 URL 里 /base/ 后面那段。',
  1254040: '应用没有这张多维表格的权限：打开多维表格 → 右上角「···」→ 添加文档应用 → 选你的自建应用 → 给「可编辑」。',
  1254302: '数据表不存在，先运行 npm run feishu:init 建表，再把输出的 table_id 填进 .env。',
  1254060: '字段不存在或类型不符，运行 npm run feishu:init -- --ensure-fields 补齐列。',
};

export class FeishuError extends Error {
  constructor(code, message, path) {
    const hint = HINTS[code];
    super(`飞书接口失败 [${code}] ${message || ''}${hint ? `\n  → ${hint}` : ''}${path ? `\n  ${path}` : ''}`);
    this.name = 'FeishuError';
    this.code = code;
  }
}

export function config(overrides = {}) {
  loadEnv();
  const value = key => (overrides[key] ?? process.env[key] ?? '').trim();
  const appId = value('FEISHU_APP_ID');
  const appSecret = value('FEISHU_APP_SECRET');
  const appToken = value('FEISHU_APP_TOKEN');
  const tableId = value('FEISHU_TABLE_SUBMISSIONS');
  if (!appId || !appSecret) {
    throw new Error(
      (envFileSeen
        ? '.env 已存在，但 FEISHU_APP_ID / FEISHU_APP_SECRET 还是空的。'
        : '缺少飞书应用凭证。复制 .env.example 为 .env，填入 FEISHU_APP_ID 与 FEISHU_APP_SECRET。') +
      '\n  这两个值在开放平台 → 你的应用 → 「凭证与基础信息」页。',
    );
  }
  if (!appToken) {
    throw new Error(
      '缺少 FEISHU_APP_TOKEN。打开你的多维表格，地址形如\n' +
      '  https://xxx.feishu.cn/base/【这段就是 app_token】?table=tblxxxx\n' +
      '  把它填进 .env 的 FEISHU_APP_TOKEN。',
    );
  }
  return {appId, appSecret, appToken, tableId};
}

let cachedToken = {token: '', expires: 0};

export async function tenantToken(cfg) {
  if (cachedToken.token && cachedToken.expires > Date.now() + 300_000) return cachedToken.token;
  const response = await fetch(`${baseUrl()}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json; charset=utf-8'},
    body: JSON.stringify({app_id: cfg.appId, app_secret: cfg.appSecret}),
  });
  const data = await response.json().catch(() => ({code: -1, msg: '响应不是 JSON'}));
  if (data.code !== 0) {
    // 21001 时补一次「故意用错 secret」的探测，把密钥写错和租户被策略拒绝区分开。
    if (data.code === 21001) await diagnose21001(cfg);
    throw new FeishuError(data.code, data.msg);
  }
  cachedToken = {
    token: data.tenant_access_token,
    expires: Date.now() + (data.expire ?? 7200) * 1000,
  };
  return cachedToken.token;
}

/** 平台策略拒绝时，用错误 secret 探一次：能返回 10014 就证明确是策略层而非密钥问题。 */
async function diagnose21001(cfg) {
  const probe = await fetch(`${baseUrl()}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json; charset=utf-8'},
    body: JSON.stringify({app_id: cfg.appId, app_secret: `${cfg.appSecret}-probe`}),
  }).then(response => response.json()).catch(() => null);
  if (probe?.code === 10014) {
    console.error('  ⓘ 已自动验证：错误 secret 返回 10014，说明 App ID / Secret 本身是对的，被拒的是平台策略。');
    console.error('    → 到飞书客户端确认当前账号是不是「个人版」；个人版没有 OpenAPI 资质，需在团队下重建应用。');
  }
}

async function call(cfg, path, {method = 'GET', query, body} = {}) {
  const token = await tenantToken(cfg);
  const url = new URL(baseUrl() + path);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? {'Content-Type': 'application/json; charset=utf-8'} : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({code: -1, msg: '响应不是 JSON'}));
  if (data.code !== 0) throw new FeishuError(data.code, data.msg, path);
  return data.data;
}

export async function listTables(cfg) {
  const data = await call(cfg, `/bitable/v1/apps/${cfg.appToken}/tables`, {query: {page_size: 100}});
  return data.items || [];
}

export async function createTable(cfg, name, fields) {
  const data = await call(cfg, `/bitable/v1/apps/${cfg.appToken}/tables`, {
    method: 'POST',
    body: {table: {name, fields}},
  });
  return data.table_id;
}

export async function listFields(cfg, tableId) {
  const data = await call(cfg, `/bitable/v1/apps/${cfg.appToken}/tables/${tableId}/fields`, {
    query: {page_size: 100},
  });
  return data.items || [];
}

export async function createField(cfg, tableId, field) {
  return call(cfg, `/bitable/v1/apps/${cfg.appToken}/tables/${tableId}/fields`, {
    method: 'POST',
    body: field,
  });
}

/** 全量分页拉取。filter 用飞书公式语法，如 CurrentValue.[状态]="已通过"。 */
export async function listRecords(cfg, tableId, {filter, pageSize = 500, guard = 400} = {}) {
  const items = [];
  let pageToken = '';
  for (let page = 0; page < guard; page++) {
    const data = await call(cfg, `/bitable/v1/apps/${cfg.appToken}/tables/${tableId}/records`, {
      query: {page_size: pageSize, page_token: pageToken, filter},
    });
    items.push(...(data.items || []));
    if (!data.has_more || !data.page_token) break;
    pageToken = data.page_token;
  }
  return items;
}

export async function batchCreate(cfg, tableId, records, chunkSize = 500) {
  const created = [];
  for (let index = 0; index < records.length; index += chunkSize) {
    const slice = records.slice(index, index + chunkSize);
    const data = await call(cfg, `/bitable/v1/apps/${cfg.appToken}/tables/${tableId}/records/batch_create`, {
      method: 'POST',
      body: {records: slice},
    });
    created.push(...(data.records || []));
  }
  return created;
}

export async function batchUpdate(cfg, tableId, records, chunkSize = 500) {
  const updated = [];
  for (let index = 0; index < records.length; index += chunkSize) {
    const slice = records.slice(index, index + chunkSize);
    const data = await call(cfg, `/bitable/v1/apps/${cfg.appToken}/tables/${tableId}/records/batch_update`, {
      method: 'POST',
      body: {records: slice},
    });
    updated.push(...(data.records || []));
  }
  return updated;
}

/** 拼一个飞书 filter 公式，自动转义引号。 */
export function filterEquals(field, value) {
  return `CurrentValue.[${field}]="${String(value).replace(/"/g, '\\"')}"`;
}
