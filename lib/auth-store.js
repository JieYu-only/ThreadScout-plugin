import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export class AuthStore {
  constructor(rootDir) {
    this.dataDir = path.join(rootDir, 'data')
    this.keyPath = path.join(this.dataDir, 'auth.key')
    this.authPath = path.join(this.dataDir, 'auth.enc.json')
  }

  key() {
    fs.mkdirSync(this.dataDir, { recursive: true })
    if (!fs.existsSync(this.keyPath)) fs.writeFileSync(this.keyPath, crypto.randomBytes(32), { mode: 0o600 })
    const key = fs.readFileSync(this.keyPath)
    if (key.length !== 32) throw new Error('auth.key 格式无效')
    return key
  }

  readAll() {
    if (!fs.existsSync(this.authPath)) return {}
    const payload = JSON.parse(fs.readFileSync(this.authPath, 'utf8'))
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key(), Buffer.from(payload.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(payload.tag, 'base64'))
    const plain = Buffer.concat([decipher.update(Buffer.from(payload.data, 'base64')), decipher.final()])
    return JSON.parse(plain.toString('utf8'))
  }

  writeAll(accounts) {
    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key(), iv)
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(accounts), 'utf8'), cipher.final()])
    const payload = { version: 1, algorithm: 'aes-256-gcm', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64') }
    const temporary = `${this.authPath}.tmp`
    fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    fs.renameSync(temporary, this.authPath)
    try { fs.chmodSync(this.authPath, 0o600) } catch {}
  }

  setCookie(accountId, cookie) {
    const clean = String(cookie ?? '').trim()
    if (!clean.includes('BDUSS=')) throw new Error('Cookie 中缺少 BDUSS')
    const all = this.readAll()
    all[accountId] = { cookie: clean, updatedAt: new Date().toISOString() }
    this.writeAll(all)
  }

  deleteCookie(accountId) {
    const all = this.readAll()
    delete all[accountId]
    this.writeAll(all)
  }

  getCookie(account) {
    const fromEnvironment = account.cookie_env ? process.env[account.cookie_env] : ''
    return String(fromEnvironment || this.readAll()[account.id]?.cookie || '').trim()
  }

  status(account) {
    const record = this.readAll()[account.id]
    return { bound: Boolean(this.getCookie(account)), source: process.env[account.cookie_env] ? 'environment' : record ? 'encrypted_file' : 'none', updatedAt: record?.updatedAt ?? null }
  }
}
