import test from 'node:test'
import assert from 'node:assert/strict'
import { TiebaAdapter } from '../lib/tieba-adapter.js'

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
