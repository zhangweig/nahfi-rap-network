import {compose,publishPayload,fingerprint,InputError} from '../server/domain.mjs';
/**
 * D1 数据访问层。对应 server/app.mjs 里 node:sqlite 的那部分逻辑，
 * 区别是 D1 的 API 全为异步，并且没有长事务，所以审核用「先抢占状态再批量写入」的方式保证幂等。
 */

export async function snapshot(db, base) {
  const {results} = await db.prepare('SELECT entity_id, kind, payload FROM approved ORDER BY rowid').all();
  return compose(base, results || []);
}

export async function createSubmission(db, value) {
  const id = crypto.randomUUID();
  await db.prepare(
    'INSERT INTO submissions(id,kind,target_id,base_revision,payload,contributor,message,created_at) VALUES(?,?,?,?,?,?,?,?)'
  ).bind(
    id,
    value.kind,
    value.targetId,
    value.baseRevision,
    JSON.stringify(value.payload),
    value.contributor,
    value.message,
    new Date().toISOString()
  ).run();
  return id;
}

export async function listSubmissions(db, base) {
  const [rows, auditRows] = await Promise.all([
    db.prepare('SELECT * FROM submissions ORDER BY created_at DESC LIMIT 500').all(),
    db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 100').all()
  ]);
  const data = await snapshot(db, base);
  const items = (rows.results || []).map(row => {
    const collection = row.kind === 'artist' ? data.nodes : row.kind === 'beef' ? (data.beefs || []) : data.relations;
    return {
      ...row,
      payload: JSON.parse(row.payload),
      original: row.target_id ? collection.find(item => item.id === row.target_id) || null : null
    };
  });
  return {items, audit: auditRows.results || []};
}

export async function decideSubmission(db, base, id, action, note) {
  if (!['approve', 'reject'].includes(action) || typeof note !== 'string' || note.length > 1500) {
    throw new InputError('审核操作无效');
  }
  if (action === 'reject' && !note.trim()) throw new InputError('请填写退回原因');

  const row = await db.prepare('SELECT * FROM submissions WHERE id=?').bind(id).first();
  if (!row) throw new InputError('投稿不存在', 404);
  if (row.status !== 'pending') throw new InputError('该投稿已经审核，请刷新列表', 409);

  const data = await snapshot(db, base);
  const entity = JSON.parse(row.payload);
  if (action === 'approve') {
    const collection = row.kind === 'artist' ? data.nodes : row.kind === 'beef' ? (data.beefs || []) : data.relations;
    if (row.target_id && fingerprint(collection.find(item => item.id === row.target_id)) !== row.base_revision) {
      throw new InputError('原记录已被其他投稿更新，请退回并重新提交', 409);
    }
    if (row.kind === 'artist' && collection.some(item => item.id !== entity.id && item.name.toLocaleLowerCase() === entity.name.toLocaleLowerCase())) {
      throw new InputError('已存在同名人物，请退回并重新提交', 409);
    }
    if (row.kind === 'relationship' && (!data.nodes.some(item => item.id === entity.source) || !data.nodes.some(item => item.id === entity.target))) {
      throw new InputError('关系人物不存在', 409);
    }
    if (row.kind === 'relationship' && data.relations.some(item =>
      item.id !== entity.id &&
      item.type === entity.type &&
      item.label === entity.label &&
      [item.source, item.target].sort().join('|') === [entity.source, entity.target].sort().join('|')
    )) {
      throw new InputError('已有相同关系通过审核，请退回重复投稿', 409);
    }
    if (row.kind === 'beef') {
      const pair = (b) => b.sides.filter(Boolean).map(s => s.nodeId).sort().join('|');
      if (!entity.sides?.filter(Boolean).length || !entity.sides.filter(Boolean).every(s => data.nodes.some(n => n.id === s.nodeId))) {
        throw new InputError('BEEF 当事人不存在', 409);
      }
      if (data.beefs.some(b => b.id !== entity.id && b.title === entity.title && pair(b) === pair(entity))) {
        throw new InputError('已有相同 BEEF 通过审核，请退回重复投稿', 409);
      }
    }
  }

  const now = new Date().toISOString();
  const status = action === 'approve' ? 'approved' : 'rejected';
  // 条件更新即「抢占」：只有仍是 pending 的那一次能改成功，避免两个标签页同时审核造成重复公开。
  const claim = await db.prepare(
    "UPDATE submissions SET status=?,reviewed_at=?,review_note=? WHERE id=? AND status='pending'"
  ).bind(status, now, note.trim(), id).run();
  if (!claim.meta || claim.meta.changes === 0) throw new InputError('该投稿已经审核，请刷新列表', 409);

  const batch = [];
  if (action === 'approve') {
    batch.push(db.prepare(
      'INSERT INTO approved(entity_id,kind,payload,submission_id) VALUES(?,?,?,?) ON CONFLICT(entity_id) DO UPDATE SET kind=excluded.kind, payload=excluded.payload, submission_id=excluded.submission_id'
    ).bind(entity.id, row.kind, publishPayload(row.kind, row.payload), row.id));
  }
  batch.push(db.prepare('INSERT INTO audit(submission_id,action,note,created_at) VALUES(?,?,?,?)')
    .bind(row.id, action, note.trim(), now));

  try {
    await db.batch(batch);
  } catch (error) {
    // 写入失败就把状态放回待审，避免出现「已通过但没有落到 approved」的黑洞。
    await db.prepare("UPDATE submissions SET status='pending',reviewed_at=NULL,review_note=NULL WHERE id=?").bind(id).run().catch(() => {});
    throw error;
  }
  return {ok: true};
}

/* ── 星级评分 ────────────────────────────────────────────────────────────
   与审核体系完全隔离：一条 UPSERT 就是一次投票，同一 (人物, 匿名标识) 覆盖旧分。
   /api/data 带上聚合后的均分与人数，前端一次请求即可拿到，不必为每张卡单独查。 */

export async function setRating(db, value) {
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO ratings(target_id,voter,stars,created_at,updated_at) VALUES(?,?,?,?,?)
     ON CONFLICT(target_id,voter) DO UPDATE SET stars=excluded.stars, updated_at=excluded.updated_at`
  ).bind(value.targetId, value.voter, value.stars, now, now).run();
}

export async function ratingStats(db) {
  const {results} = await db.prepare(
    'SELECT target_id, AVG(stars) AS avg, COUNT(*) AS count FROM ratings GROUP BY target_id'
  ).all();
  return Object.fromEntries((results || []).map(row => [row.target_id, {
    average: Math.round(row.avg * 10) / 10,
    count: row.count,
  }]));
}

/* ── 勘误 ──────────────────────────────────────────────────────────────
   与投稿完全隔离：reports 表只被站长读取，不参与 compose()，
   所以无论队列里堆多少条，公开数据一个字节都不会变。 */

export async function createReport(db, value) {
  const id = crypto.randomUUID();
  await db.prepare(
    'INSERT INTO reports(id,target_type,target_id,issue,message,source_url,contact,created_at) VALUES(?,?,?,?,?,?,?,?)'
  ).bind(id, value.targetType, value.targetId, value.issue, value.message,
    value.sourceUrl, value.contact, new Date().toISOString()).run();
  return id;
}

export async function listReports(db) {
  const {results} = await db.prepare(
    'SELECT * FROM reports ORDER BY CASE status WHEN \'open\' THEN 0 ELSE 1 END, created_at DESC LIMIT 300'
  ).all();
  return {items: results || []};
}

export async function decideReport(db, id, action, note) {
  if (!['resolve', 'dismiss'].includes(action) || typeof note !== 'string' || note.length > 1000) {
    throw new InputError('处理操作无效');
  }
  const row = await db.prepare('SELECT status FROM reports WHERE id=?').bind(id).first();
  if (!row) throw new InputError('勘误不存在', 404);
  if (row.status !== 'open') throw new InputError('这条勘误已经处理过了', 409);
  const claim = await db.prepare(
    "UPDATE reports SET status=?,resolved_at=?,note=? WHERE id=? AND status='open'"
  ).bind(action === 'resolve' ? 'resolved' : 'dismissed', new Date().toISOString(), note.trim(), id).run();
  if (!claim.meta || claim.meta.changes === 0) throw new InputError('这条勘误已经处理过了', 409);
  return {ok: true};
}
