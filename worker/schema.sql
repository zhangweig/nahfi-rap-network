-- D1 表结构。首次部署时执行：
--   npx wrangler d1 execute nahfi-rap-network --remote --file=worker/schema.sql
-- 与 server/app.mjs 里 node:sqlite 建的表保持一致，便于本地服务与线上 Worker 共用同一份数据语义。

CREATE TABLE IF NOT EXISTS submissions(
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  target_id TEXT,
  base_revision TEXT,
  payload TEXT NOT NULL,
  contributor TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  review_note TEXT
);

CREATE TABLE IF NOT EXISTS approved(
  entity_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  submission_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id TEXT NOT NULL,
  action TEXT NOT NULL,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- 审核台会话。只存 token 的 SHA-256，泄露也无法直接冒用。
CREATE TABLE IF NOT EXISTS sessions(
  hash TEXT PRIMARY KEY,
  expires INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status, created_at DESC);

-- 勘误队列。和 submissions 分开存，因为勘误不携带「正确的值」，不能被批准成公开数据；
-- 站长处理完只标记状态，需要改数据时再走正式投稿流程。
CREATE TABLE IF NOT EXISTS reports(
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  issue TEXT NOT NULL,
  message TEXT NOT NULL,
  source_url TEXT,
  contact TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  note TEXT
);

CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, created_at DESC);
