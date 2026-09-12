import crypto from 'node:crypto'
import { ProxyAgent } from 'undici'

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36'

function stripHtml(value = '') { return value.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim() }

export class TiebaAdapter {
  constructor({ cookie = '', fetchImpl = fetch, timeoutSeconds = 15, retries = 2, retryDelaySeconds = 2, proxyUrl = '' } = {}) {
    this.cookie = cookie
    this.fetch = fetchImpl
    this.timeoutMs = timeoutSeconds * 1000
    this.retries = retries
    this.retryDelayMs = retryDelaySeconds * 1000
    this.dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined
  }
  headers(extra = {}) { return { 'user-agent': USER_AGENT, accept: 'text/html,application/json;q=0.9,*/*;q=0.8', 'accept-language': 'zh-CN,zh;q=0.9', cookie: this.cookie, ...extra } }

  async request(url, options = {}) {
    let lastError
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const response = await this.fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(this.timeoutMs), dispatcher: this.dispatcher, ...options, headers: this.headers(options.headers) })
        if (response.status === 401 || response.status === 403) throw Object.assign(new Error(`贴吧拒绝访问（HTTP ${response.status}）`), { code: response.status === 401 ? 'AUTH_EXPIRED' : 'ACCESS_DENIED', status: response.status })
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

  async listThreads(forum, { pages = 2, latestThreads = 50 } = {}) {
    const result = []
    for (let page = 0; page < pages && result.length < latestThreads; page++) {
      const url = `https://tieba.baidu.com/f?kw=${encodeURIComponent(forum)}&ie=utf-8&pn=${page * 50}`
      const html = await (await this.request(url)).text()
      const match = html.match(/PageData\.thread_list\s*=\s*(\[[\s\S]*?\]);/)
      if (!match) throw Object.assign(new Error('贴吧页面结构已变化，无法读取主题列表'), { code: 'PARSE_ERROR' })
      const rows = JSON.parse(match[1])
      for (const row of rows) {
        if (row.is_top) continue
        result.push({ platform: 'tieba', id: String(row.id), forum, title: stripHtml(row.title), author: row.author_name, createdAt: row.create_time ? new Date(row.create_time * 1000).toISOString() : null })
        if (result.length >= latestThreads) break
      }
    }
    return result
  }

  async getThread(thread) {
    const html = await (await this.request(`https://tieba.baidu.com/p/${encodeURIComponent(thread.id)}`)).text()
    if (/抱歉，您访问的贴子被隐藏/.test(html)) throw Object.assign(new Error('帖子已删除或隐藏'), { code: 'THREAD_DELETED' })
    const body = html.match(/class="d_post_content[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? ''
    return { ...thread, body: stripHtml(body), rawHtml: html }
  }

  async getTbs() {
    if (!this.cookie) throw Object.assign(new Error('未配置账号 Cookie'), { code: 'AUTH_EXPIRED' })
    const data = await this.json(await this.request('https://tieba.baidu.com/dc/common/tbs'))
    if (!data.is_login || !data.tbs) throw Object.assign(new Error('贴吧 Cookie 无效或已过期'), { code: 'AUTH_EXPIRED' })
    return data.tbs
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
