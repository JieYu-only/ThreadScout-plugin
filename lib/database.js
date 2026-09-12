import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export class ThreadScoutDatabase {
  constructor(filename) {
    fs.mkdirSync(path.dirname(filename), { recursive: true })
    this.db = new DatabaseSync(filename)
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;')
    this.migrate()
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS threads (
        platform TEXT NOT NULL, thread_id TEXT NOT NULL, forum_name TEXT NOT NULL,
        title TEXT NOT NULL, author TEXT, created_at TEXT, discovered_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL, score INTEGER, decision TEXT, match_detail TEXT,
        PRIMARY KEY(platform, thread_id)
      );
      CREATE TABLE IF NOT EXISTS reply_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT NOT NULL, thread_id TEXT NOT NULL,
        task_id TEXT NOT NULL, account_id TEXT NOT NULL, score INTEGER NOT NULL,
        scheduled_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(platform, thread_id)
      );
      CREATE TABLE IF NOT EXISTS replies (
        id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT NOT NULL, thread_id TEXT NOT NULL,
        forum_name TEXT NOT NULL, account_id TEXT NOT NULL, task_id TEXT NOT NULL,
        template_id TEXT, rendered_content TEXT, score INTEGER, status TEXT NOT NULL,
        error_code TEXT, error_message TEXT, queued_at TEXT, replied_at TEXT, created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS replies_one_success_per_thread
        ON replies(platform, thread_id) WHERE status = 'success';
      CREATE INDEX IF NOT EXISTS queue_due ON reply_queue(status, scheduled_at);
      CREATE INDEX IF NOT EXISTS replies_time ON replies(status, replied_at);
      CREATE TABLE IF NOT EXISTS runtime (
        key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL
      );
    `)
    const threadColumns = this.db.prepare('PRAGMA table_info(threads)').all().map(row => row.name)
    if (!threadColumns.includes('task_id')) this.db.exec('ALTER TABLE threads ADD COLUMN task_id TEXT')
    this.db.exec('CREATE INDEX IF NOT EXISTS threads_task_seen ON threads(task_id, last_seen_at DESC)')
  }

  upsertThread(thread, result) {
    const now = new Date().toISOString()
    this.db.prepare(`INSERT INTO threads(platform,thread_id,forum_name,title,author,created_at,discovered_at,last_seen_at,score,decision,match_detail,task_id)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(platform,thread_id) DO UPDATE SET title=excluded.title,last_seen_at=excluded.last_seen_at,score=excluded.score,decision=excluded.decision,match_detail=excluded.match_detail,task_id=excluded.task_id`)
      .run(thread.platform, String(thread.id), thread.forum, thread.title, thread.author ?? null, thread.createdAt ?? null, now, now, result.score, result.decision, JSON.stringify(result), thread.taskId ?? null)
  }

  recentMatches({ taskId = null, limit = 10 } = {}) {
    const safeLimit = Math.max(1, Math.min(30, Number(limit) || 10))
    const sql = `SELECT platform,thread_id,forum_name,title,author,score,decision,match_detail,task_id,last_seen_at
      FROM threads WHERE decision IN ('auto','candidate','excluded')${taskId ? ' AND task_id=?' : ''} ORDER BY last_seen_at DESC LIMIT ?`
    return this.db.prepare(sql).all(...(taskId ? [taskId, safeLimit] : [safeLimit])).map(row => {
      try { return { ...row, match: JSON.parse(row.match_detail) } } catch { return { ...row, match: null } }
    })
  }

  hasSuccessfulReply(platform, threadId) {
    return Boolean(this.db.prepare("SELECT 1 FROM replies WHERE platform=? AND thread_id=? AND status='success' LIMIT 1").get(platform, String(threadId)))
  }

  enqueue(item) {
    const now = new Date().toISOString()
    return this.db.prepare(`INSERT OR IGNORE INTO reply_queue(platform,thread_id,task_id,account_id,score,scheduled_at,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,'pending',?,?)`).run(item.platform, String(item.threadId), item.taskId, item.accountId, item.score, item.scheduledAt, now, now).changes > 0
  }

  pendingCount() { return this.db.prepare("SELECT COUNT(*) count FROM reply_queue WHERE status='pending'").get().count }
  dueQueue() { return this.db.prepare("SELECT * FROM reply_queue WHERE status='pending' AND scheduled_at<=? ORDER BY scheduled_at").all(new Date().toISOString()) }
  markQueue(id, status, error = null) { this.db.prepare('UPDATE reply_queue SET status=?,last_error=?,updated_at=? WHERE id=?').run(status, error, new Date().toISOString(), id) }
  recentTemplateIds(limit) { return this.db.prepare("SELECT template_id FROM replies WHERE status='success' AND template_id IS NOT NULL ORDER BY replied_at DESC LIMIT ?").all(limit).map(row => row.template_id) }
  countReplies(since) { return this.db.prepare("SELECT COUNT(*) count FROM replies WHERE status='success' AND replied_at>=?").get(since.toISOString()).count }
  addReply(row) { this.db.prepare(`INSERT INTO replies(platform,thread_id,forum_name,account_id,task_id,template_id,rendered_content,score,status,error_code,error_message,queued_at,replied_at,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(row.platform,String(row.threadId),row.forum,row.accountId,row.taskId,row.templateId??null,row.content??null,row.score,row.status,row.errorCode??null,row.errorMessage??null,row.queuedAt??null,row.repliedAt??null,new Date().toISOString()) }
  getRuntime(key, fallback = null) { const row = this.db.prepare('SELECT value FROM runtime WHERE key=?').get(key); return row ? JSON.parse(row.value) : fallback }
  setRuntime(key, value) { const now = new Date().toISOString(); this.db.prepare('INSERT INTO runtime(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').run(key, JSON.stringify(value), now) }
  stats() { return { pending: this.pendingCount(), todaySuccess: this.countReplies(new Date(new Date().setHours(0,0,0,0))) } }
  close() { this.db.close() }
}
