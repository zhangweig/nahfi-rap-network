import {config, createTable, listFields, listTables, createField, FeishuError} from '../server/feishu.mjs';
import {TABLE_NAME, TABLE_FIELDS, FIELDS} from '../server/feishu-schema.mjs';

const ensureFields = process.argv.includes('--ensure-fields');

function line() {
  console.log('─'.repeat(64));
}

async function main() {
  const cfg = config();
  line();
  console.log('飞书多维表格初始化');
  console.log(`app_token: ${cfg.appToken}`);
  line();

  const tables = await listTables(cfg);
  console.log(`已连接，当前有 ${tables.length} 张数据表：`);
  for (const table of tables) console.log(`  · ${table.name}  ${table.table_id}`);

  let target = tables.find(table => table.name === TABLE_NAME);

  if (!target) {
    console.log(`\n未找到「${TABLE_NAME}」，正在创建…`);
    const tableId = await createTable(cfg, TABLE_NAME, TABLE_FIELDS);
    console.log(`✓ 已创建「${TABLE_NAME}」 ${tableId}`);
    target = {name: TABLE_NAME, table_id: tableId};
  } else {
    console.log(`\n「${TABLE_NAME}」已存在 ${target.table_id}`);
    if (ensureFields) {
      const existing = new Set((await listFields(cfg, target.table_id)).map(field => field.field_name));
      const missing = TABLE_FIELDS.filter(field => !existing.has(field.field_name));
      if (!missing.length) {
        console.log('✓ 字段完整，无需补齐');
      } else {
        console.log(`补齐 ${missing.length} 个缺失字段：`);
        for (const field of missing) {
          await createField(cfg, target.table_id, field);
          console.log(`  + ${field.field_name}`);
        }
      }
    } else {
      console.log('（如需补齐缺失列，加上 --ensure-fields 重跑）');
    }
  }

  line();
  console.log('把下面这一行写进 .env：\n');
  console.log(`FEISHU_TABLE_SUBMISSIONS=${target.table_id}`);
  line();
  console.log(`下一步（只需做一次）：
1. 在飞书里打开这张表 → 右上「+ 添加视图」→ 选择「表单」
2. 表单里勾选这些列：${[FIELDS.title, FIELDS.kind, FIELDS.source, FIELDS.target, FIELDS.relationType, FIELDS.year, FIELDS.sourceTitle, FIELDS.sourceUrl, FIELDS.sourceNote, FIELDS.contributor, FIELDS.message].join('、')}
   并把「状态」的默认值设成「待审核」
3. 点「分享」→ 开启「分享表单」→ 复制链接，填进 .env 的 VITE_FEISHU_FORM_URL
4. 运行 npm run feishu:check 验证整条链路`);
}

main().catch(error => {
  console.error(`\n✗ 初始化失败\n${error instanceof FeishuError ? error.message : error.message}`);
  process.exitCode = 1;
});
