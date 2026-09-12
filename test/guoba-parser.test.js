import test from 'node:test'
import assert from 'node:assert/strict'
import { parseExcludeKeywords, parseNegativeKeywords, parseResources, parseScoredKeywords, validateTemplateResources } from '../lib/guoba-parser.js'

test('解析锅巴关键词配置', () => {
  assert.deepEqual(parseScoredKeywords('找队友 | 5 | 3\n萌新组队 | 4 | 2', '强关键词'), [
    { text: '找队友', title: 5, body: 3 }, { text: '萌新组队', title: 4, body: 2 }
  ])
  assert.deepEqual(parseNegativeKeywords('吐槽 | -5'), [{ text: '吐槽', score: -5 }])
  assert.deepEqual(parseExcludeKeywords('已找到\n已找到\n人满了'), ['已找到', '人满了'])
})

test('解析多个群号资源并校验模板引用', () => {
  const resources = parseResources('tarkov_main | qq_group | 123456\ntarkov_pve | qq_group | 654321')
  assert.equal(resources.tarkov_pve.value, '654321')
  assert.doesNotThrow(() => validateTemplateResources(['PVE群：{{resource:tarkov_pve}}'], resources))
  assert.throws(() => validateTemplateResources(['群：{{resource:missing}}'], resources), /不存在的资源/)
})

test('拒绝无效的锅巴关键词与资源格式', () => {
  assert.throws(() => parseScoredKeywords('找队友 | 五 | 3'), /必须是/)
  assert.throws(() => parseNegativeKeywords('吐槽 | 5'), /不能大于 0/)
  assert.throws(() => parseResources('中文标识 | qq_group | 123'), /标识无效/)
})
