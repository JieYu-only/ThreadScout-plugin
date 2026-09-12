import test from 'node:test'
import assert from 'node:assert/strict'
import { TiebaAdapter, parseThreadListHtml } from '../lib/tieba-adapter.js'

test('网络错误按配置有限重试', async () => {
  let calls = 0
  const adapter = new TiebaAdapter({ retries: 2, retryDelaySeconds: 0, fetchImpl: async () => { calls++; if (calls < 3) throw Object.assign(new Error('offline'), { code: 'NETWORK_ERROR' }); return new Response('ok') } })
  assert.equal(await (await adapter.request('https://example.test')).text(), 'ok')
  assert.equal(calls, 3)
})

test('异常 HTML 不会被当作 JSON', async () => {
  const adapter = new TiebaAdapter()
  await assert.rejects(adapter.json(new Response('<html>blocked</html>', { headers: { 'content-type': 'text/html' } })), error => error.code === 'PARSE_ERROR')
})

test('解析贴吧 j_thread_list 主题节点', () => {
  const html = `<ul id="thread_list"><li class="j_thread_list clearfix" data-field='{&quot;id&quot;:12345,&quot;author_name&quot;:&quot;测试用户&quot;,&quot;create_time&quot;:1700000000}'><a class="j_th_tit" href="/p/12345">萌新找队友 &amp; 一起玩</a></li></ul>`
  assert.deepEqual(parseThreadListHtml(html, '逃离塔科夫', 10), [{ platform: 'tieba', id: '12345', forum: '逃离塔科夫', title: '萌新找队友 & 一起玩', author: '测试用户', createdAt: new Date(1700000000 * 1000).toISOString() }])
})

test('网页列表被安全验证拦截时改用客户端接口', async () => {
  const responses = [
    new Response('百度安全验证', { status: 403 }),
    new Response(JSON.stringify({ error_code: 0, page: { has_more: 0 }, thread_list: [{ id: 123, title: '客户端主题', author: { name_show: '作者' }, create_time: 1700000000, is_top: 0 }] }), { headers: { 'content-type': 'application/json' } })
  ]
  const adapter = new TiebaAdapter({ retries: 0, logger: { warn() {} }, fetchImpl: async () => responses.shift() })
  assert.deepEqual(await adapter.listThreads('测试吧', { pages: 1, latestThreads: 10 }), [{ platform: 'tieba', id: '123', forum: '测试吧', title: '客户端主题', author: '作者', createdAt: new Date(1700000000 * 1000).toISOString() }])
})

test('网页正文被安全验证拦截时改用客户端接口', async () => {
  const responses = [
    new Response('百度安全验证', { status: 403 }),
    new Response(JSON.stringify({ error_code: 0, thread: { title: '主题' }, post_list: [{ floor: 1, content: [{ type: 0, text: '正文内容' }] }] }), { headers: { 'content-type': 'application/json' } })
  ]
  const adapter = new TiebaAdapter({ retries: 0, fetchImpl: async () => responses.shift() })
  assert.deepEqual(await adapter.getThread({ platform: 'tieba', id: '123', forum: '测试吧', title: '' }), { platform: 'tieba', id: '123', forum: '测试吧', title: '主题', body: '正文内容', rawHtml: null })
})

test('账号资料优先显示贴吧昵称', async () => {
  const responses = [
    new Response(JSON.stringify({ is_login: 1, tbs: 'ok' }), { headers: { 'content-type': 'application/json' } }),
    new Response(JSON.stringify({ data: { user: { user_name_show: '贴吧昵称', user_id: 123 } } }), { headers: { 'content-type': 'application/json' } })
  ]
  const adapter = new TiebaAdapter({ cookie: 'BDUSS=x', retries: 0, fetchImpl: async () => responses.shift() })
  assert.deepEqual(await adapter.getAccountProfile(), { nickname: '贴吧昵称', uid: '123' })
})

test('认证结果会通知凭证存储并附带清理状态', async () => {
  const adapter = new TiebaAdapter({
    cookie: 'BDUSS=expired', retries: 0,
    fetchImpl: async () => new Response(JSON.stringify({ is_login: 0 }), { headers: { 'content-type': 'application/json' } }),
    onAuthResult: valid => ({ cleared: !valid, source: 'encrypted_file' })
  })
  await assert.rejects(adapter.getTbs(), error => error.code === 'AUTH_EXPIRED' && error.cleared === true)
})

test('安全验证拦截时不把 Cookie 误判为过期', async () => {
  let validationCalls = 0
  const responses = [
    new Response(JSON.stringify({ is_login: 0 }), { headers: { 'content-type': 'application/json' } }),
    new Response('百度安全验证', { status: 403, headers: { 'content-type': 'text/html' } })
  ]
  const adapter = new TiebaAdapter({
    cookie: 'BDUSS=possibly-valid', retries: 0,
    fetchImpl: async () => responses.shift(),
    onAuthResult: () => { validationCalls++; return { cleared: true } }
  })
  await assert.rejects(adapter.getTbs(), error => error.code === 'ACCESS_DENIED' && /不会清理 Cookie/.test(error.message))
  assert.equal(validationCalls, 0)
})
