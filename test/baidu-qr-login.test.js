import test from 'node:test'
import assert from 'node:assert/strict'
import { BaiduQrLogin, parseJsonp } from '../lib/baidu-qr-login.js'

test('parseJsonp accepts JSON and callback wrapped JSON', () => {
  assert.equal(parseJsonp('{"errno":1}').errno, 1)
  assert.equal(parseJsonp('callback({"errno":0,"channel_v":"{}"})').errno, 0)
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
  const urls = []
  const login = new BaiduQrLogin({ fetchImpl: async url => { urls.push(String(url)); return new Response('', { headers }) } })
  const cookie = await login.finish('temporary')
  assert.match(cookie, /BDUSS=secret/)
  assert.match(urls[0], /tpl=tb/)
  assert.match(urls[0], /u=https%253A%252F%252Ftieba\.baidu\.com%252Findex\.html/)
})
