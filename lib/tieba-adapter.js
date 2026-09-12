import crypto from 'node:crypto'
import { ProxyAgent } from 'undici'

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36'
const CLIENT_USER_AGENT = 'bdtb for Android 12.70.1.0'
const CLIENT_SECRET = 'tiebaclient!!!'

function clientForm(values) {
  const params = {
    _client_id: `wappc_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    _client_type: '2', _client_version: '12.70.1.0', _phone_imei: '000000000000000', from: '1008621y',
    ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)]))
  }
  const plain = Object.keys(params).sort().map(key => `${key}=${params[key]}`).join('') + CLIENT_SECRET
  params.sign = crypto.createHash('md5').update(plain).digest('hex').toUpperCase()
  return new URLSearchParams(params)
}

function clientText(content = []) { return content.filter(item => item?.type === 0 && item.text).map(item => item.text).join('').trim() }

function decodeHtml(value = '') {
  return value.replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
}

function stripHtml(value = '') { return decodeHtml(value.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).trim() }

function parseJsonAttribute(tag) {
  const match = tag.match(/\bdata-field\s*=\s*(['"])([\s\S]*?)\1/i)
  if (!match) return null
  try { return JSON.parse(decodeHtml(match[2])) } catch { return null }
}

function findFirstValue(value, keys) {
  if (!value || typeof value !== 'object') return undefined
  for (const key of keys) if (value[key] != null && value[key] !== '') return value[key]
  for (const child of Object.values(value)) {
    const found = findFirstValue(child, keys)
    if (found != null && found !== '') return found
  }
}

export function parseThreadListHtml(html, forum, latestThreads = 50) {
  const openings = [...html.matchAll(/<li\b[^>]*class\s*=\s*(['"])[^'">]*\bj_thread_list\b[^'">]*\1[^>]*>/gi)]
  const threads = []
  for (let index = 0; index < openings.length && threads.length < latestThreads; index++) {
    const opening = openings[index]
    const block = html.slice(opening.index, openings[index + 1]?.index ?? html.length)
    const data = parseJsonAttribute(opening[0])
    if (!data?.id || data.is_top) continue
    const titleMatch = block.match(/<a\b[^>]*class\s*=\s*(['"])[^'">]*\bj_th_tit\b[^'">]*\1[^>]*>([\s\S]*?)<\/a>/i)
    const authorMatch = block.match(/title\s*=\s*(['"])主题作者[:：]\s*([\s\S]*?)\1/i)
    threads.push({
      platform: 'tieba', id: String(data.id), forum,
      title: stripHtml(titleMatch?.[2] ?? data.title ?? ''),
      author: stripHtml(data.author_name ?? authorMatch?.[2] ?? ''),
      createdAt: data.create_time ? new Date(Number(data.create_time) * 1000).toISOString() : null
    })
  }
  return threads
}

export class TiebaAdapter {
  constructor({ cookie = '', fetchImpl = fetch, timeoutSeconds = 15, retries = 2, retryDelaySeconds = 2, proxyUrl = '', onAuthResult = null, logger = globalThis.logger ?? console } = {}) {
    this.cookie = cookie
    this.fetch = fetchImpl
    this.timeoutMs = timeoutSeconds * 1000
    this.retries = retries
    this.retryDelayMs = retryDelaySeconds * 1000
    this.dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined
    this.onAuthResult = onAuthResult
    this.logger = logger
  }
  headers(extra = {}) { return { 'user-agent': USER_AGENT, accept: 'text/html,application/json;q=0.9,*/*;q=0.8', 'accept-language': 'zh-CN,zh;q=0.9', cookie: this.cookie, ...extra } }

  async request(url, options = {}) {
    let lastError
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const response = await this.fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(this.timeoutMs), dispatcher: this.dispatcher, ...options, headers: this.headers(options.headers) })
        if (response.status === 401 || response.status === 403) throw Object.assign(new Error(response.status === 403 ? '贴吧触发百度安全验证（HTTP 403）' : '贴吧登录凭证已失效（HTTP 401）'), { code: response.status === 401 ? 'AUTH_EXPIRED' : 'ACCESS_DENIED', status: response.status })
        if (response.status === 429) throw Object.assign(new Error('贴吧请求频率受限'), { code: 'RATE_LIMITED', status: 429 })
        if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { code: response.status >= 500 ? 'NETWORK_ERROR' : 'REQUEST_REJECTED', status: response.status })
        return response
      } catch (error) {
        lastError = error.name === 'TimeoutError' ? Object.assign(new Error('贴吧请求超时'), { code: 'NETWORK_ERROR' }) : error
        const retryable = lastError.code === 'NETWORK_ERROR' || (lastError.status >= 500 && lastError.status < 600)
        if (!retryable || attempt === this.retries) throw lastError
        await new Promise(resolve => setTimeout(resolve, this.retryDelayMs * (attempt + 1)))
      }
    }
    throw lastError
  }

  async json(response) {
    const type = response.headers.get('content-type') ?? ''
    const text = await response.text()
    if (!type.includes('json') && /^\s*</.test(text)) throw Object.assign(new Error('贴吧返回了异常 HTML 页面'), { code: 'PARSE_ERROR' })
    try { return JSON.parse(text) } catch { throw Object.assign(new Error('贴吧返回内容不是有效 JSON'), { code: 'PARSE_ERROR' }) }
  }

  async clientJson(path, values) {
    const response = await this.request(`https://tieba.baidu.com${path}`, {
      method: 'POST', headers: { 'user-agent': CLIENT_USER_AGENT, 'content-type': 'application/x-www-form-urlencoded' }, body: clientForm(values)
    })
    const data = await this.json(response)
    if (Number(data.error_code ?? 0) !== 0) throw Object.assign(new Error(data.error_msg || `贴吧客户端接口返回错误 ${data.error_code}`), { code: 'REQUEST_REJECTED', response: data })
    return data
  }

  async listThreadsFromClient(forum, { pages = 2, latestThreads = 50 } = {}) {
    const result = []
    for (let page = 1; page <= pages && result.length < latestThreads; page++) {
      const data = await this.clientJson('/c/f/frs/page', { kw: forum, pn: page, rn: Math.min(50, latestThreads - result.length) })
      for (const row of data.thread_list ?? []) {
        if (row.is_top || !(row.id ?? row.tid)) continue
        const authorBadge = row.author?.show_icon_list?.find(item => item.type === 'name_show' || item.sub_type === 'name_show')
        result.push({
          platform: 'tieba', id: String(row.id ?? row.tid), forum,
          title: String(row.title ?? '').trim(), author: String(row.author?.name_show ?? row.author?.name ?? authorBadge?.text ?? row.author_name ?? '').trim(),
          createdAt: row.create_time ? new Date(Number(row.create_time) * 1000).toISOString() : null
        })
        if (result.length >= latestThreads) break
      }
      if (!data.page?.has_more) break
    }
    if (!result.length) throw Object.assign(new Error('贴吧客户端接口未返回主题列表'), { code: 'PARSE_ERROR' })
    return result
  }

  async listThreads(forum, { pages = 2, latestThreads = 50 } = {}) {
    try {
      const result = []
      for (let page = 0; page < pages && result.length < latestThreads; page++) {
        const url = `https://tieba.baidu.com/f?kw=${encodeURIComponent(forum)}&ie=utf-8&pn=${page * 50}`
        const html = await (await this.request(url)).text()
        const rows = parseThreadListHtml(html, forum, latestThreads - result.length)
        if (!rows.length) throw Object.assign(new Error(`贴吧页面未解析到主题列表（第 ${page + 1} 页，HTML ${html.length} 字节）`), { code: 'PARSE_ERROR' })
        for (const row of rows) {
          result.push(row)
          if (result.length >= latestThreads) break
        }
      }
      return result
    } catch (error) {
      if (!['ACCESS_DENIED', 'PARSE_ERROR'].includes(error.code)) throw error
      this.logger?.warn?.(`[ThreadScout] 网页主题列表不可用，改用贴吧客户端接口：${error.message}`)
      return this.listThreadsFromClient(forum, { pages, latestThreads })
    }
  }

  async getThread(thread) {
    try {
      const html = await (await this.request(`https://tieba.baidu.com/p/${encodeURIComponent(thread.id)}`)).text()
      if (/抱歉，您访问的贴子被隐藏/.test(html)) throw Object.assign(new Error('帖子已删除或隐藏'), { code: 'THREAD_DELETED' })
      const body = html.match(/class="d_post_content[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? ''
      return { ...thread, body: stripHtml(body), rawHtml: html }
    } catch (error) {
      if (!['ACCESS_DENIED', 'PARSE_ERROR'].includes(error.code)) throw error
      const data = await this.clientJson('/c/f/pb/page', { kz: thread.id, pn: 1, rn: 30 })
      const firstPost = data.post_list?.find(item => Number(item.floor) === 1) ?? data.post_list?.[0]
      if (!firstPost) throw Object.assign(new Error('贴吧客户端接口未返回主题正文'), { code: 'THREAD_DELETED' })
      return { ...thread, title: thread.title || data.thread?.title || '', body: clientText(firstPost.content), rawHtml: null }
    }
  }

  async getTbs() {
    if (!this.cookie) throw Object.assign(new Error('未配置账号 Cookie'), { code: 'AUTH_EXPIRED' })
    let data
    try { data = await this.json(await this.request('https://tieba.baidu.com/dc/common/tbs')) } catch (error) {
      if (error.code === 'AUTH_EXPIRED') { try { Object.assign(error, this.onAuthResult?.(false)) } catch {} }
      throw error
    }
    if (!data.is_login || !data.tbs) {
      try {
        const probe = await this.request('https://tieba.baidu.com/', { headers: { referer: 'https://tieba.baidu.com/' } })
        const html = await probe.text()
        if (/百度安全验证|安全验证/.test(html)) throw Object.assign(new Error('贴吧触发百度安全验证，暂时无法判断 Cookie 是否有效'), { code: 'ACCESS_DENIED', status: 403 })
      } catch (error) {
        if (error.code === 'ACCESS_DENIED') throw Object.assign(new Error('贴吧触发百度安全验证，暂时无法判断 Cookie 是否有效；本次不会清理 Cookie'), { code: 'ACCESS_DENIED', status: error.status ?? 403 })
        throw error
      }
      const error = Object.assign(new Error('贴吧 Cookie 无效或已过期'), { code: 'AUTH_EXPIRED' })
      try { Object.assign(error, this.onAuthResult?.(false)) } catch {}
      throw error
    }
    try { this.onAuthResult?.(true) } catch {}
    return data.tbs
  }

  async getAccountProfile() {
    await this.getTbs()
    let profile = null
    try {
      const response = await this.request(`https://tieba.baidu.com/f/user/json_userinfo?t=${Date.now()}`, { headers: { 'x-requested-with': 'XMLHttpRequest', referer: 'https://tieba.baidu.com/' } })
      profile = await this.json(response)
    } catch (error) {
      if (!['PARSE_ERROR', 'REQUEST_REJECTED', 'ACCESS_DENIED'].includes(error.code)) throw error
    }
    const data = profile?.data ?? profile ?? {}
    let nickname = findFirstValue(data, ['user_name_show', 'name_show', 'user_name', 'uname', 'name'])
    let uid = findFirstValue(data, ['user_id', 'uid'])
    if (!nickname) {
      const html = await (await this.request('https://tieba.baidu.com/')).text()
      nickname = html.match(/"user_name_show"\s*:\s*"([^"]+)"/)?.[1]
        ?? html.match(/"name_show"\s*:\s*"([^"]+)"/)?.[1]
        ?? html.match(/PageData\.user\.name\s*=\s*"([^"]+)"/)?.[1]
        ?? html.match(/class="u_username"[^>]*>([\s\S]*?)<\/a>/)?.[1]
      uid ??= html.match(/"user_id"\s*:\s*"?(\d+)"?/)?.[1]
    }
    nickname = stripHtml(nickname ?? '')
    if (!nickname) throw Object.assign(new Error('登录有效，但贴吧没有返回账号昵称'), { code: 'PROFILE_PARSE_ERROR' })
    return { nickname, uid: uid ? String(uid) : null }
  }

  async reply(thread, content) {
    const tbs = await this.getTbs()
    const page = thread.rawHtml ?? await (await this.request(`https://tieba.baidu.com/p/${thread.id}`)).text()
    const fid = page.match(/"forum_id"\s*:\s*([0-9]+)/)?.[1] ?? page.match(/name="fid" value="([0-9]+)"/)?.[1]
    if (!fid) throw Object.assign(new Error('无法取得贴吧 fid'), { code: 'PARSE_ERROR' })
    const form = new URLSearchParams({ ie: 'utf-8', kw: thread.forum, fid, tid: String(thread.id), tbs, content, rich_text: '1', floor_num: '0', mouse_pwd: crypto.randomBytes(8).toString('hex') })
    const data = await this.json(await this.request('https://tieba.baidu.com/f/commit/post/add', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', referer: `https://tieba.baidu.com/p/${thread.id}` }, body: form }))
    if (data.no === 0) return { ok: true, postId: data.data?.post_id ?? null }
    const code = data.no === 4 ? 'AUTH_EXPIRED' : data.no === 40 ? 'RATE_LIMITED' : 'REPLY_REJECTED'
    throw Object.assign(new Error(data.error ?? `贴吧返回错误 ${data.no}`), { code, response: data })
  }
}
