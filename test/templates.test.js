import test from 'node:test'
import assert from 'node:assert/strict'
import { renderTemplate, selectTemplate } from '../lib/templates.js'

test('渲染资源变量', () => assert.equal(renderTemplate('群：{{resource:main}}', { main: { value: '123' } }), '群：123'))
test('拒绝未解析变量', () => assert.throws(() => renderTemplate('群：{{resource:missing}}', {})))
test('避开最近模板', () => assert.equal(selectTemplate([{ id: 'a', enabled: true }, { id: 'b', enabled: true }], ['a'], () => 0).id, 'b'))
