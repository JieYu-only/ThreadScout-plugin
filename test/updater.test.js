import test from 'node:test'
import assert from 'node:assert/strict'
import { needsShell, PluginUpdater, selectRemote } from '../lib/updater.js'

test('有 Gitee 时优先使用国内远端', () => assert.equal(selectRemote(['github', 'gitee'], 'github'), 'gitee'))
test('克隆仓库优先使用 origin', () => assert.equal(selectRemote(['github', 'origin'], ''), 'origin'))
test('无标准名称时使用首个远端', () => assert.equal(selectRemote(['mirror'], ''), 'mirror'))
test('Windows 批处理命令通过 shell 启动以避免 spawn EINVAL', () => {
  assert.equal(needsShell('pnpm.cmd', 'win32'), true)
  assert.equal(needsShell('git', 'win32'), false)
  assert.equal(needsShell('pnpm', 'linux'), false)
})

test('更新日志转换为适合聊天显示的提交列表', async () => {
  const updater = new PluginUpdater({ pluginRoot: process.cwd(), runner: async (_command, args) => ({ stdout: args.includes('--pretty=format:%h||[%cd] %s') ? 'abc1234||[09-13 01:00] 修复登录\ndef5678||[09-13 00:30] 增加账号' : '' }) })
  assert.deepEqual(await updater.changeLog('before', 'after'), ['abc1234 [09-13 01:00] 修复登录', 'def5678 [09-13 00:30] 增加账号'])
})
