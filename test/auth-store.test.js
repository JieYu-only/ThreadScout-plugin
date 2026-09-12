import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AuthStore, normalizeTiebaCookie } from '../lib/auth-store.js'

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

test('完整浏览器 Cookie 自动提取、去重并移除统计字段', () => {
  const result = normalizeTiebaCookie('Cookie: Hm_lvt_x=tracking; BDUSS=first; STOKEN=token; BAIDUID=id:FG=1; H_WISE_SIDS=1_2; BDUSS=latest; TIEBAUID=tieba')
  assert.equal(result.cookie, 'BDUSS=latest; STOKEN=token; BAIDUID=id:FG=1; TIEBAUID=tieba')
  assert.deepEqual(result.names, ['BDUSS', 'STOKEN', 'BAIDUID', 'TIEBAUID'])
})

test('兼容聊天复制时被转义的 Cookie 字段名', () => {
  const result = normalizeTiebaCookie('BDUSS=value; BDUSS\\_BFESS=bfess; BAIDUID\\_BFESS=id')
  assert.equal(result.cookie, 'BDUSS=value; BDUSS_BFESS=bfess; BAIDUID_BFESS=id')
})

test('连续两次认证失效后清理加密 Cookie', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'threadscout-auth-'))
  try {
    const store = new AuthStore(root)
    const account = { id: 'main', cookie_env: 'THREADSCOUT_TEST_UNUSED' }
    store.setCookie('main', 'BDUSS=expired')
    assert.deepEqual(store.recordValidation(account, false).cleared, false)
    assert.equal(store.status(account).bound, true)
    assert.deepEqual(store.recordValidation(account, false).cleared, true)
    assert.equal(store.status(account).bound, false)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('认证恢复成功会重置失效计数', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'threadscout-auth-'))
  try {
    const store = new AuthStore(root)
    const account = { id: 'main', cookie_env: 'THREADSCOUT_TEST_UNUSED' }
    store.setCookie('main', 'BDUSS=valid')
    store.recordValidation(account, false)
    store.recordValidation(account, true)
    assert.equal(store.recordValidation(account, false).cleared, false)
    assert.equal(store.status(account).bound, true)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
