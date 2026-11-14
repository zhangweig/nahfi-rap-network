import {config, listTables, listFields, listRecords, tenantToken, FeishuError} from '../server/feishu.mjs';
import {TABLE_NAME, TABLE_FIELDS, FIELDS, STATUS_PENDING, STATUS_APPROVED, STATUS_REJECTED, plain} from '../server/feishu-schema.mjs';

const results = [];
const ok = text => results.push({level: 'ok', text});
const warn = text => results.push({level: 'warn', text});
const bad = text => results.push({level: 'bad', text});

async function main() {
  let cfg;
  try {
    cfg = config();
    ok(`应用凭证已配置（app_id: ${cfg.appId.slice(0, 8)}…）`);
    ok(`多维表格 app_token: ${cfg.appToken}`);
  } catch (error) {
    bad(error.message);
    return report();
  }

  try {
    await tenantToken(cfg);
    ok('tenant_access_token 获取成功');
  } catch (error) {
    bad(error.message);
    return report();
  }

  let tables;
  try {
    tables = await listTables(cfg);
    ok(`可访问多维表格，共 ${tables.length} 张数据表`);
  } catch (error) {
    bad(error.message);
    return report();
  }

  const table = tables.find(item => item.name === TABLE_NAME)
    || tables.find(item => item.table_id === cfg.tableId);
  if (!table) {
    bad(`找不到「${TABLE_NAME}」表，运行 npm run feishu:init 创建`);
    return report();
  }
  ok(`数据表「${table.name}」 ${table.table_id}`);
  if (cfg.tableId && cfg.tableId !== table.table_id) {
    warn(`.env 里的 FEISHU_TABLE_SUBMISSIONS=${cfg.tableId} 与表名匹配结果不一致，以 .env 为准`);
  }

  try {
    const fields = new Set((await listFields(cfg, table.table_id)).map(item => item.field_name));
    const missing = TABLE_FIELDS.filter(item => !fields.has(item.field_name)).map(item => item.field_name);
    if (missing.length) warn(`缺少字段：${missing.join('、')}（运行 npm run feishu:init -- --ensure-fields 补齐）`);
    else ok(`字段完整（${TABLE_FIELDS.length} 列）`);
  } catch (error) {
    warn(`字段检查跳过：${error.message.split('\n')[0]}`);
  }

  try {
    const rows = await listRecords(cfg, table.table_id);
    const statusOf = row => plain(row.fields?.[FIELDS.status]).trim();
    const count = status => rows.filter(row => statusOf(row) === status).length;
    // 表单提交的行不会填「状态」，空状态视同待审核，这样计数才和你在表里看到的一致。
    const pending = count(STATUS_PENDING) + rows.filter(row => !statusOf(row)).length;
    ok(`共 ${rows.length} 行投稿：待审核 ${pending} · 已通过 ${count(STATUS_APPROVED)} · 已退回 ${count(STATUS_REJECTED)}`);

    let blank = 0;
    const broken = [];
    for (const row of rows) {
      const raw = plain(row.fields?.[FIELDS.json]).trim();
      if (!raw) { blank += 1; continue; }
      try { JSON.parse(raw); } catch { broken.push(row.record_id); }
    }
    if (broken.length) warn(`${broken.length} 行的「数据」列不是合法 JSON，拉取时会被跳过：${broken.slice(0, 5).join('、')}`);
    else ok('已填「数据」列的行都是合法 JSON');
    // 表单行没有 JSON 是设计内的，拉取时会按拆开的列重建，不算问题。
    if (blank) ok(`其中 ${blank} 行由表单提交（无「数据」列，拉取时按拆分列重建）`);
  } catch (error) {
    bad(`读取记录失败：${error.message}`);
  }

  if (!process.env.VITE_FEISHU_FORM_URL) {
    warn('未配置 VITE_FEISHU_FORM_URL，网站仍会显示站内投稿表单（不会报错，只是网友的投稿进不了飞书）');
  } else {
    ok('表单链接已配置，网友投稿直接进飞书');
  }

  report();
}

function report() {
  console.log('');
  for (const item of results) {
    const mark = item.level === 'ok' ? '✓' : item.level === 'warn' ? '!' : '✗';
    console.log(`${mark} ${item.text}`);
  }
  const failed = results.some(item => item.level === 'bad');
  console.log('');
  console.log(failed ? '链路未打通，按上面 ✗ 的提示处理后重跑。' : '链路正常。改完飞书里的状态后，运行 npm run feishu:pull 即可上线。');
  if (failed) process.exitCode = 1;
}

main().catch(error => {
  console.error(`\n✗ 检查失败\n${error instanceof FeishuError ? error.message : error.message}`);
  process.exitCode = 1;
});
