import crypto from 'node:crypto'
import { ProxyAgent } from 'undici'

const PASSPORT = 'https://passport.baidu.com'
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36'

function parseJsonp(text) {
  const source = String(text ?? '').trim()
  const start = source.indexOf('{')
  const end = source.lastIndexOf('}')
  if (start < 0 || end < start) throw Object.assign(new Error('百度登录接口返回内容无法解析'), { code: 'LOGIN_PARSE_ERROR' })
  try { return JSON.parse(source.slice(start, end + 1)) } catch { throw Object.assign(new Error('百度登录接口返回了无效数据'), { code: 'LOGIN_PARSE_ERROR' }) }
}

function gid() { return crypto.randomUUID().replaceAll('-', '').toUpperCase() }

export function createLoginSignature(params) {
  const source = Object.entries(params).map(([key, value]) => `${key}=${value}`).join('&')
  const digest = crypto.createHash('md5').update(source).digest('hex')
  const salt = 'tnrstsms'
  const mixed = [...digest.slice(0, 8)].map((char, index) => `${char}${salt[index]}`).join('') + digest.slice(8)
  const cipher = crypto.createCipheriv('aes-128-ecb', Buffer.from('moonshad8moonsh6'), null)
  const encrypted = Buffer.concat([cipher.update(mixed, 'utf8'), cipher.final()]).toString('base64')
  return Buffer.from(encrypted).toString('base64')
}

function createShaOne(timestamp = Date.now()) {
  const md5 = crypto.createHash('md5').update(String(timestamp)).digest('hex')
  return crypto.createHash('sha1').update(md5).digest('hex')
}

export class BaiduQrLogin {
  constructor({ fetchImpl = fetch, timeoutSeconds = 35, proxyUrl = '' } = {}) {
    this.fetch = fetchImpl
    this.timeoutMs = Math.max(timeoutSeconds, 40) * 1000
    this.dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined
    this.cookies = new Map()
  }

  remember(response) {
    const values = response.headers.getSetCookie?.() ?? (response.headers.get('set-cookie') ? [response.headers.get('set-cookie')] : [])
    for (const value of values) {
      const pair = value.split(';', 1)[0]
      const split = pair.indexOf('=')
      if (split > 0) this.cookies.set(pair.slice(0, split).trim(), pair.slice(split + 1).trim())
    }
  }

  cookieHeader() { return [...this.cookies].map(([key, value]) => `${key}=${value}`).join('; ') }

  async request(url, options = {}) {
    const response = await this.fetch(url, {
      redirect: options.redirect ?? 'follow', signal: AbortSignal.timeout(this.timeoutMs), dispatcher: this.dispatcher,
      ...options, headers: { 'user-agent': USER_AGENT, accept: '*/*', ...(this.cookies.size ? { cookie: this.cookieHeader() } : {}), ...options.headers }
    })
    this.remember(response)
    if (!response.ok && response.status !== 302) throw Object.assign(new Error(`百度登录接口请求失败（HTTP ${response.status}）`), { code: 'LOGIN_NETWORK_ERROR' })
    return response
  }

  async create() {
    const timestamp = Date.now()
    const callback = `tangram_guid_${timestamp}`
    const params = new URLSearchParams({ lp: 'pc', qrloginfrom: 'pc', gid: gid(), callback, apiver: 'v3', tt: String(timestamp), tpl: 'mn', _: String(timestamp) })
    const data = parseJsonp(await (await this.request(`${PASSPORT}/v2/api/getqrcode?${params}`)).text())
    if (!data.sign || !data.imgurl) throw Object.assign(new Error('百度没有返回可用的登录二维码'), { code: 'LOGIN_START_ERROR' })
    const imageUrl = data.imgurl.startsWith('http') ? data.imgurl : data.imgurl.startsWith('//') ? `https:${data.imgurl}` : data.imgurl.startsWith('/') ? `${PASSPORT}${data.imgurl}` : `https://${data.imgurl}`
    const image = Buffer.from(await (await this.request(imageUrl)).arrayBuffer())
    return { sign: data.sign, gid: gid(), callback, image, imageUrl, createdAt: timestamp }
  }

  async poll(session) {
    const timestamp = Date.now()
    const params = new URLSearchParams({ channel_id: session.sign, tpl: 'mn', gid: session.gid, callback: session.callback, apiver: 'v3', tt: String(timestamp), _: String(timestamp) })
    const data = parseJsonp(await (await this.request(`${PASSPORT}/channel/unicast?${params}`)).text())
    if (Number(data.errno) === 1) return { status: 'pending' }
    if (Number(data.errno) !== 0) return { status: 'expired' }
    let channel = data.channel_v
    if (typeof channel === 'string') { try { channel = JSON.parse(channel) } catch { channel = {} } }
    if (Number(channel?.status) === 0 && channel.v) return { status: 'confirmed', token: channel.v }
    if (Number(channel?.status) === 1) return { status: 'scanned' }
    if (Number(channel?.status) === 2) return { status: 'expired' }
    return { status: 'pending' }
  }

  async finish(token) {
    const timestamp = Date.now()
    const signed = { alg: 'v3', apiver: 'v3', bduss: token, loginVersion: 'v4', qrcode: '1', time: String(Math.floor(timestamp / 1000)), tpl: 'mn', tt: String(timestamp), u: 'https%3A%2F%2Fwww.baidu.com%2F' }
    const params = new URLSearchParams({ ...signed, sig: createLoginSignature(signed), shaOne: createShaOne(), elapsed: '1234', v: String(timestamp), callback: 'bd__cbs__threadscout' })
    await this.request(`${PASSPORT}/v3/login/main/qrbdusslogin?${params}`, { redirect: 'manual', headers: { referer: 'https://www.baidu.com/', 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', 'upgrade-insecure-requests': '1' } })
    await this.request('https://tieba.baidu.com/', { headers: { referer: 'https://www.baidu.com/' } })
    const cookie = this.cookieHeader()
    if (!this.cookies.get('BDUSS')) throw Object.assign(new Error('扫码已确认，但百度没有返回 BDUSS，请重新扫码'), { code: 'LOGIN_COOKIE_ERROR' })
    return cookie
  }
}

export { parseJsonp }
