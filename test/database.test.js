import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ThreadScoutDatabase } from '../lib/database.js'

test('按任务读取最近扫描命中记录和匹配原因', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'threadscout-db-'))
  const database = new ThreadScoutDatabase(path.join(root, 'test.db'))
  try {
    database.upsertThread({ platform: 'tieba', id: '1', forum: '测试一', title: '找队友', author: '甲', taskId: 'task_1' }, { score: 8, decision: 'auto', reasons: [{ type: 'keyword', field: 'title', text: '找队友', score: 8 }] })
    database.upsertThread({ platform: 'tieba', id: '2', forum: '测试二', title: '萌新', author: '乙', taskId: 'task_2' }, { score: 5, decision: 'candidate', reasons: [] })
    const rows = database.recentMatches({ taskId: 'task_1' })
    assert.equal(rows.length, 1)
    assert.equal(rows[0].task_id, 'task_1')
    assert.equal(rows[0].match.reasons[0].text, '找队友')
  } finally { database.close(); fs.rmSync(root, { recursive: true, force: true }) }
})
