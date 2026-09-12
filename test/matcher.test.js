import test from 'node:test'
import assert from 'node:assert/strict'
import { matchThread } from '../lib/matcher.js'

const rules = { candidate_score: 5, auto_reply_score: 8, strong: [{ text: '找队友', title: 5, body: 3 }], auxiliary: [{ text: '萌新', title: 2, body: 1 }, { text: '一起玩', title: 2, body: 1 }], combinations: [{ id: 'newbie_team', bonus: 3, all: [['萌新'], ['一起玩']] }], negative: [{ text: '吐槽', score: -5 }], exclude: ['已经找到'] }

test('组合和标题权重达到自动阈值', () => { const result = matchThread({ title: '萌新找队友', body: '想一起玩' }, rules); assert.equal(result.decision, 'auto'); assert.equal(result.score, 11) })
test('排除词一票否决', () => { const result = matchThread({ title: '找队友', body: '已经找到，谢谢' }, rules); assert.equal(result.decision, 'excluded') })
test('弱意图不会误触发', () => { const result = matchThread({ title: '吐槽队友', body: '今天遇到了问题' }, rules); assert.equal(result.decision, 'ignored') })
