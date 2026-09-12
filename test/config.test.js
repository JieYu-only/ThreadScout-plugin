import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ConfigStore } from '../lib/config.js'

const sample = `
mode: observe
accounts:
  - id: main
    name: 主账号
    enabled: true
tasks:
  - id: task
    account_id: main
matching:
  candidate_score: 1
  auto_reply_score: 2
queue:
  min_delay_minutes: 1
  max_delay_minutes: 2
`

test('同一配置文件的锅巴与运行实例会即时同步', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'threadscout-config-'))
  try {
    fs.mkdirSync(path.join(root, 'config'))
    fs.writeFileSync(path.join(root, 'config', 'default.yaml'), sample)
    const runtimeStore = new ConfigStore(root)
    const guobaStore = new ConfigStore(root)
    runtimeStore.load()
    guobaStore.load()
    const next = structuredClone(guobaStore.value)
    next.mode = 'stopped'
    guobaStore.save(next)
    assert.equal(runtimeStore.value.mode, 'stopped')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
