import test from 'node:test'
import assert from 'node:assert/strict'
import { AccountManager } from '../lib/account-manager.js'

function fixture() {
  const value = { accounts: [{ id: 'main', name: '主账号', enabled: true }], tasks: [{ id: 'task', name: '任务', enabled: true, account_id: 'main' }] }
  const configStore = { value, save(next) { this.value = next } }
  const deleted = []
  return { manager: new AccountManager({ configStore, authStore: { deleteCookie: id => deleted.push(id) } }), configStore, deleted }
}

test('添加、启用账号并切换任务', () => {
  const { manager, configStore } = fixture()
  manager.add('backup_1', '备用账号')
  assert.equal(configStore.value.accounts[1].enabled, false)
  manager.setEnabled('backup_1', true)
  manager.assign('task', 'backup_1')
  assert.equal(configStore.value.tasks[0].account_id, 'backup_1')
})

test('被启用任务引用的账号不能停用或删除', () => {
  const { manager } = fixture()
  assert.throws(() => manager.setEnabled('main', false), /任务引用/)
  assert.throws(() => manager.remove('main'), /任务引用/)
})

test('删除未引用账号时同步清理凭证', () => {
  const { manager, configStore, deleted } = fixture()
  manager.add('backup', '备用')
  manager.remove('backup')
  assert.equal(configStore.value.accounts.length, 1)
  assert.deepEqual(deleted, ['backup'])
})
