import test from 'node:test'
import assert from 'node:assert/strict'
import { selectRemote } from '../lib/updater.js'

test('优先使用当前分支配置的远端', () => assert.equal(selectRemote(['github', 'gitee'], 'gitee'), 'gitee'))
test('克隆仓库优先使用 origin', () => assert.equal(selectRemote(['github', 'origin'], ''), 'origin'))
test('无标准名称时使用首个远端', () => assert.equal(selectRemote(['mirror'], ''), 'mirror'))
