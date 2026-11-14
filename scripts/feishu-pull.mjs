import {writeFileSync, readFileSync, existsSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {config, listRecords, filterEquals, FeishuError} from '../server/feishu.mjs';
import {
  FIELDS, STATUS_APPROVED, TABLE_NAME, plain, relationKeyOf, linkOf,
} from '../server/feishu-schema.mjs';
import {buildData} from './build-data.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** 可覆盖输出路径，测试时用临时文件，避免动到真实数据。 */
const OUTPUT = resolve(ROOT, process.env.FEISHU_OUTPUT || 'src/data/community-approved.json');
const BASE = resolve(ROOT, 'server/generated/base-data.json');

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const strict = args.has('--strict');
const skipSnapshot = args.has('--no-snapshot');

function readBase() {
  if (!existsSync(BASE)) return {nodes: [], relations: []};
  try {
    const data = JSON.parse(readFileSync(BASE, 'utf8'));
    return {nodes: data.nodes || [], relations: data.relations || []};
  } catch {
    return {nodes: [], relations: []};
  }
}

/** 名字/别名 → id 的索引，并允许把同批次新投稿的人物即时加进去。 */
function createIndex(base) {
  const byKey = new Map();
  const byId = new Map();
  const remember = node => {
    if (!node?.id) return;
    byId.set(node.id, node);
    for (const key of [node.name, ...(node.aliases || [])]) {
      if (typeof key === 'string' && key.trim()) byKey.set(key.trim().toLowerCase(), node.id);
    }
  };
  base.nodes.forEach(remember);
  return {
    remember,
    node: id => byId.get(id),
    resolve(value) {
      const text = plain(value).trim();
      if (!text) return '';
      if (byId.has(text)) return text;
      return byKey.get(text.toLowerCase()) || '';
    },
  };
}

const filled = value => typeof value === 'string' && value.trim() !== '';

async function fetchApproved(cfg) {
  const filter = filterEquals(FIELDS.status, STATUS_APPROVED);
  try {
    return {rows: await listRecords(cfg, cfg.tableId, {filter}), usedFilter: true};
  } catch (error) {
    console.log(`  ! 服务端筛选失败（${error.message.split('\n')[0]}），改为拉全量后本地筛选`);
    return {rows: await listRecords(cfg, cfg.tableId), usedFilter: false};
  }
}

/** 一行 → 中间结构。优先用「数据」列，空则从表单拆列重建。 */
function parseRow(row) {
  const cells = row.fields || {};
  const reviewedAt = row.last_modified_time ? new Date(row.last_modified_time).toISOString() : undefined;
  const declared = plain(cells[FIELDS.id]).trim();
  const raw = plain(cells[FIELDS.json]).trim();

  if (raw) {
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new Error('「数据」列不是合法 JSON，可能被手工改坏（清空该列即可改为按拆列重建）');
    }
    const entityId = declared || payload?.id;
    if (!entityId) throw new Error('缺少「编号」且 JSON 里没有 id');
    payload.id = entityId;
    return {entityId, payload, reviewedAt};
  }

  const kindCell = plain(cells[FIELDS.kind]);
  const isRelation = kindCell.includes('关系')
    || filled(plain(cells[FIELDS.source]))
    || filled(plain(cells[FIELDS.target]));

  const evidence = {
    title: plain(cells[FIELDS.sourceTitle]).trim(),
    url: linkOf(cells[FIELDS.sourceUrl]),
    note: plain(cells[FIELDS.sourceNote]).trim(),
  };
  if (!evidence.url || !evidence.title) {
    throw new Error('缺少来源标题或来源链接（每条都需要可核对的出处）');
  }

  const title = plain(cells[FIELDS.title]).trim();
  const year = Number(plain(cells[FIELDS.year])) || undefined;
  const entityId = declared || `${isRelation ? 'community-rel' : 'community'}-${randomUUID()}`;

  if (isRelation) {
    if (!title) throw new Error('关系投稿缺少「标题」（关系说明）');
    return {
      entityId,
      reviewedAt,
      draft: {
        id: entityId,
        sourceText: plain(cells[FIELDS.source]).trim(),
        targetText: plain(cells[FIELDS.target]).trim(),
        type: relationKeyOf(cells[FIELDS.relationType]),
        label: title,
        observedYear: year,
        evidence: [evidence],
        status: 'verified',
      },
    };
  }

  if (!title) throw new Error('人物投稿缺少「标题」（艺名）');
  return {
    entityId,
    reviewedAt,
    draft: {
      id: entityId,
      name: title,
      aliases: plain(cells[FIELDS.aliases]).split(/[,，、\n]/).map(x => x.trim()).filter(Boolean),
      kind: 'artist',
      city: plain(cells[FIELDS.city]).trim() || '未标注',
      category: '说唱音乐人',
      color: '#ed9d43',
      initials: title.slice(0, 2),
      description: plain(cells[FIELDS.description]).trim(),
      avatarUrl: plain(cells[FIELDS.avatar]).trim(),
      sources: [evidence],
    },
  };
}

async function main() {
  const cfg = config();
  if (!cfg.tableId) {
    throw new Error('缺少 FEISHU_TABLE_SUBMISSIONS。先运行 npm run feishu:init，把输出的 table_id 填进 .env。');
  }

  const base = readBase();
  const index = createIndex(base);
  const baseRelationById = new Map(base.relations.map(item => [item.id, item]));
  const baseNodeById = new Map(base.nodes.map(item => [item.id, item]));

  console.log(`从飞书「${TABLE_NAME}」拉取审核结果…`);
  const {rows, usedFilter} = await fetchApproved(cfg);
  const source = usedFilter ? rows : rows.filter(row => plain(row.fields?.[FIELDS.status]) === STATUS_APPROVED);
  console.log(`  共 ${rows.length} 行，其中「${STATUS_APPROVED}」${source.length} 条`);

  const parsed = [];
  const skipped = [];
  for (const row of source) {
    try {
      parsed.push(parseRow(row));
    } catch (error) {
      const id = plain(row.fields?.[FIELDS.id]) || row.record_id;
      skipped.push(`${id}：${error.message}`);
    }
  }

  const records = [];
  const push = item => {
    if (records.some(existing => existing.entityId === item.entityId)) {
      skipped.push(`${item.entityId}：同编号出现多次，只保留第一条`);
      return;
    }
    records.push(item);
  };

  // 第一遍：人物。同批次新增的人物要先入索引，后面的关系才引用得到。
  for (const item of parsed) {
    if (item.draft && !('sourceText' in item.draft)) {
      const existing = baseNodeById.get(item.entityId);
      const payload = existing ? {...existing, ...item.draft} : item.draft;
      push({entityId: item.entityId, kind: 'artist', payload, submissionId: item.entityId, reviewedAt: item.reviewedAt});
      index.remember(payload);
    } else if (item.payload && !('source' in item.payload)) {
      push({entityId: item.entityId, kind: 'artist', payload: item.payload, submissionId: item.entityId, reviewedAt: item.reviewedAt});
      index.remember(item.payload);
    }
  }

  // 第二遍：关系。起点/终点允许写艺名，这里统一换成 id。
  for (const item of parsed) {
    if (item.draft && 'sourceText' in item.draft) {
      const sourceId = index.resolve(item.draft.sourceText);
      const targetId = index.resolve(item.draft.targetText);
      if (!sourceId) {
        skipped.push(`${item.entityId}：起点「${item.draft.sourceText || '空'}」在人物库里找不到（可改填 id，或先通过该人物）`);
        continue;
      }
      if (!targetId) {
        skipped.push(`${item.entityId}：终点「${item.draft.targetText || '空'}」在人物库里找不到`);
        continue;
      }
      if (sourceId === targetId) {
        skipped.push(`${item.entityId}：起点和终点是同一个人`);
        continue;
      }
      const existing = baseRelationById.get(item.entityId);
      const {sourceText, targetText, ...rest} = item.draft;
      const payload = existing ? {...existing, ...rest, source: sourceId, target: targetId} : {...rest, source: sourceId, target: targetId};
      push({entityId: item.entityId, kind: 'relationship', payload, submissionId: item.entityId, reviewedAt: item.reviewedAt});
    } else if (item.payload && 'source' in item.payload) {
      push({entityId: item.entityId, kind: 'relationship', payload: item.payload, submissionId: item.entityId, reviewedAt: item.reviewedAt});
    }
  }

  records.sort((a, b) => String(a.reviewedAt || '').localeCompare(String(b.reviewedAt || '')));

  if (dryRun) {
    console.log('\n[dry-run] 不会写入任何文件。将要写入：');
    for (const record of records) {
      const label = record.kind === 'artist' ? record.payload.name : record.payload.label;
      console.log(`  ${record.kind === 'artist' ? '人物' : '关系'}  ${record.entityId}  ${label || ''}`);
    }
  } else {
    writeFileSync(OUTPUT, JSON.stringify({
      generatedAt: new Date().toISOString(),
      source: 'feishu',
      records,
    }, null, 2) + '\n');
    const artists = records.filter(item => item.kind === 'artist').length;
    console.log(`\n✓ 写入 ${records.length} 条（人物 ${artists} · 关系 ${records.length - artists}）→ src/data/community-approved.json`);
  }

  if (skipped.length) {
    console.log(`\n⚠ 跳过 ${skipped.length} 条：`);
    for (const item of skipped.slice(0, 20)) console.log(`   - ${item}`);
    if (skipped.length > 20) console.log(`   …另有 ${skipped.length - 20} 条`);
  }

  if (!dryRun && !skipSnapshot) {
    await buildData('server/generated');
    console.log('✓ 已重建数据快照 server/generated/base-data.json');
  }

  if (!dryRun) console.log('\n运行 npm run build 生成线上版本；本地 npm run dev 刷新页面即可看到。');

  if (strict && skipped.length) {
    console.error('\n--strict 模式：存在被跳过的记录，退出码 1');
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(`\n✗ 拉取失败\n${error instanceof FeishuError ? error.message : error.message}`);
  process.exitCode = 1;
});
