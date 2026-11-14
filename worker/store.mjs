import {compose,fingerprint,InputError} from '../server/domain.mjs';

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
    const collection = row.kind === 'artist' ? data.nodes : data.relations;
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
    const collection = row.kind === 'artist' ? data.nodes : data.relations;
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
    ).bind(entity.id, row.kind, row.payload, row.id));
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
