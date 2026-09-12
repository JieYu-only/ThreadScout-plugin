const ACCOUNT_ID = /^[a-zA-Z0-9_-]{1,32}$/

export class AccountManager {
  constructor({ configStore, authStore }) { this.configStore = configStore; this.authStore = authStore }
  config() { return structuredClone(this.configStore.value) }
  find(config, id) { return config.accounts.find(account => account.id === id) }

  add(id, name) {
    if (!ACCOUNT_ID.test(id)) throw new Error('账号标识只能包含字母、数字、下划线和短横线，最长 32 位')
    const cleanName = String(name ?? '').trim()
    if (!cleanName || cleanName.length > 30) throw new Error('账号名称不能为空且不能超过 30 个字符')
    const config = this.config()
    if (this.find(config, id)) throw new Error(`账号标识 ${id} 已存在`)
    config.accounts.push({ id, name: cleanName, enabled: false, cookie_env: `THREADSCOUT_TIEBA_COOKIE_${id.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()}` })
    this.configStore.save(config)
    return this.find(config, id)
  }

  setEnabled(id, enabled) {
    const config = this.config()
    const account = this.find(config, id)
    if (!account) throw new Error(`找不到账号 ${id}`)
    if (!enabled) {
      const tasks = config.tasks.filter(task => task.enabled && task.account_id === id)
      if (tasks.length) throw new Error(`账号仍被启用任务引用：${tasks.map(task => task.id).join('、')}，请先切换任务账号`)
    }
    account.enabled = enabled
    this.configStore.save(config)
    return account
  }

  assign(taskId, accountId) {
    const config = this.config()
    const task = config.tasks.find(item => item.id === taskId)
    if (!task) throw new Error(`找不到任务 ${taskId}`)
    const account = this.find(config, accountId)
    if (!account) throw new Error(`找不到账号 ${accountId}`)
    if (!account.enabled) throw new Error(`账号 ${accountId} 尚未启用`)
    task.account_id = accountId
    this.configStore.save(config)
    return { task, account }
  }

  unbind(id) {
    const account = this.find(this.configStore.value, id)
    if (!account) throw new Error(`找不到账号 ${id}`)
    if (account.cookie_env && process.env[account.cookie_env]) throw new Error(`账号 Cookie 来自环境变量 ${account.cookie_env}，请在服务器环境中删除`)
    this.authStore.deleteCookie(id)
    return account
  }

  remove(id) {
    const config = this.config()
    const account = this.find(config, id)
    if (!account) throw new Error(`找不到账号 ${id}`)
    const tasks = config.tasks.filter(task => task.account_id === id)
    if (tasks.length) throw new Error(`账号仍被任务引用：${tasks.map(task => task.id).join('、')}，请先切换任务账号`)
    config.accounts = config.accounts.filter(item => item.id !== id)
    if (!config.accounts.length) throw new Error('必须至少保留一个账号')
    this.configStore.save(config)
    this.authStore.deleteCookie(id)
    return account
  }
}
