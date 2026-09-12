import test from 'node:test'
import assert from 'node:assert/strict'
import { BaiduQrLogin, createLoginSignature, parseJsonp } from '../lib/baidu-qr-login.js'

test('parseJsonp accepts JSON and callback wrapped JSON', () => {
  assert.equal(parseJsonp('{"errno":1}').errno, 1)
  assert.equal(parseJsonp('callback({"errno":0,"channel_v":"{}"})').errno, 0)
})

test('登录确认参数生成稳定的双层 Base64 AES 签名', () => {
  const signature = createLoginSignature({ alg: 'v3', apiver: 'v3', bduss: 'temporary' })
  assert.match(signature, /^[A-Za-z0-9+/]+=*$/)
  assert.equal(signature, createLoginSignature({ alg: 'v3', apiver: 'v3', bduss: 'temporary' }))
  assert.notEqual(signature, createLoginSignature({ alg: 'v3', apiver: 'v3', bduss: 'changed' }))
})

test('QR login creates image and maps polling states', async () => {
  const responses = [
    new Response('callback({"errno":0,"sign":"abc","imgurl":"passport.baidu.com/qr.png"})'),
    new Response(Buffer.from('png')),
    new Response('callback({"errno":1})'),
    new Response('callback({"errno":0,"channel_v":"{\\"status\\":1}"})'),
    new Response('callback({"errno":0,"channel_v":"{\\"status\\":0,\\"v\\":\\"temporary\\"}"})')
  ]
  const requested = []
  const login = new BaiduQrLogin({ fetchImpl: async url => { requested.push(String(url)); return responses.shift() } })
  const session = await login.create()
  assert.equal(session.image.toString(), 'png')
  assert.equal(requested[1], 'https://passport.baidu.com/qr.png')
  assert.equal((await login.poll(session)).status, 'pending')
  assert.equal((await login.poll(session)).status, 'scanned')
  assert.deepEqual(await login.poll(session), { status: 'confirmed', token: 'temporary' })
})

test('finish returns captured Cookie only when BDUSS is present', async () => {
  const headers = new Headers()
  headers.append('set-cookie', 'BDUSS=secret; Path=/; HttpOnly')
  const login = new BaiduQrLogin({ fetchImpl: async () => new Response('', { headers }) })
  const cookie = await login.finish('temporary')
  assert.match(cookie, /BDUSS=secret/)
})
