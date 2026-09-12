import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AuthStore } from '../lib/auth-store.js'

test('Cookie 加密保存且状态不泄露内容', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'threadscout-auth-'))
  try {
    const store = new AuthStore(root)
    store.setCookie('main', 'BDUSS=secret-value; STOKEN=token-value')
    const encrypted = fs.readFileSync(path.join(root, 'data', 'auth.enc.json'), 'utf8')
    assert.equal(encrypted.includes('secret-value'), false)
    assert.equal(store.getCookie({ id: 'main', cookie_env: 'THREADSCOUT_TEST_UNUSED' }), 'BDUSS=secret-value; STOKEN=token-value')
    assert.deepEqual(store.status({ id: 'main', cookie_env: 'THREADSCOUT_TEST_UNUSED' }).bound, true)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('拒绝缺少 BDUSS 的凭证', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'threadscout-auth-'))
  try { assert.throws(() => new AuthStore(root).setCookie('main', 'STOKEN=only')) } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
