import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ConfigStore } from '../lib/config.js'
import { AuthStore } from '../lib/auth-store.js'
import { ThreadScoutDatabase } from '../lib/database.js'
import { TiebaAdapter } from '../lib/tieba-adapter.js'
import { ThreadScoutService } from '../lib/service.js'
import { PluginUpdater } from '../lib/updater.js'
import { BaiduQrLogin } from '../lib/baidu-qr-login.js'
import { AccountManager } from '../lib/account-manager.js'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const configStore = new ConfigStore(root)
const config = configStore.load()
const authStore = new AuthStore(root)
const database = new ThreadScoutDatabase(path.resolve(root, config.database.path))
const adapterFactory = accountId => {
  const current = configStore.value
  const account = current.accounts.find(item => item.id === accountId)
  if (!account || !account.enabled) return null
  return new TiebaAdapter({
    cookie: authStore.getCookie(account),
    timeoutSeconds: current.network.timeout_seconds,
    retries: current.network.retries,
    retryDelaySeconds: current.network.retry_delay_seconds,
    proxyUrl: current.network.proxy_url,
    onAuthResult: valid => {
      const result = authStore.recordValidation(account, valid)
      if (result.cleared) (globalThis.logger ?? console).warn(`[ThreadScout] 账号 ${account.id} 的 Cookie 已连续两次确认失效，已自动清理`)
      return result
    }
  })
}
const service = new ThreadScoutService({ configStore, database, adapterFactory, logger: globalThis.logger ?? console })
const updater = new PluginUpdater({ pluginRoot: root, logger: globalThis.logger ?? console })
const accountManager = new AccountManager({ configStore, authStore })

const BasePlugin = globalThis.plugin ?? class {}

export class ThreadScout extends BasePlugin {
  constructor() {
    super({
      name: 'ThreadScout-巡帖', dsc: '论坛主题监控与安全回复队列', event: 'message', priority: 5000,
      rule: [
        { reg: '^#巡[帖贴]帮助$', fnc: 'help' }, { reg: '^#巡帖状态$', fnc: 'status' }, { reg: '^#巡帖立即扫描$', fnc: 'scanNow', permission: 'master' },
        { reg: '^#巡帖模式\\s*(观察|自动|停止)$', fnc: 'setMode', permission: 'master' }, { reg: '^#巡帖重载配置$', fnc: 'reloadConfig', permission: 'master' },
        { reg: '^#巡帖队列$', fnc: 'queue' }, { reg: '^#巡帖账号$', fnc: 'accounts', permission: 'master' },
        { reg: '^#巡帖扫码登录(?:\\s+\\S+)?$', fnc: 'qrLogin', permission: 'master' },
        { reg: '^#巡帖添加账号\\s+\\S+\\s+.+$', fnc: 'addAccount', permission: 'master' },
        { reg: '^#巡帖(?:启用|停用|解绑|删除)账号\\s+\\S+$', fnc: 'manageAccount', permission: 'master' },
        { reg: '^#巡帖任务账号\\s+\\S+\\s+\\S+$', fnc: 'assignTaskAccount', permission: 'master' },
        { reg: '^#巡帖更新$', fnc: 'updatePlugin', permission: 'master' }, { reg: '^#巡帖强制更新$', fnc: 'forceUpdatePlugin', permission: 'master' }
      ],
      task: [
        { cron: '15 * * * * *', name: 'ThreadScout主题扫描', fnc: () => service.scanAll() },
        { cron: '*/30 * * * * *', name: 'ThreadScout回复队列', fnc: () => service.processQueue() }
      ]
    })
  }

  async send(message) { return this.reply?.(message) }
  helpText() { return '【ThreadScout 指令帮助】\n\n公开指令：\n#巡贴帮助 / #巡帖帮助\n查看本指令说明。\n\n#巡帖状态\n查看运行模式、账号、任务、待回复和今日成功数量。\n\n#巡帖队列\n查看当前待回复任务数量。\n\n主人指令：\n#巡帖账号\n查看全部账号的启用、绑定和验证状态。\n\n#巡帖添加账号 <标识> <名称>\n#巡帖启用账号 <标识>\n#巡帖停用账号 <标识>\n#巡帖解绑账号 <标识>\n#巡帖删除账号 <标识>\n#巡帖任务账号 <任务标识> <账号标识>\n管理账号与任务绑定；修改操作仅限私聊。\n\n#巡帖扫码登录 [账号标识]\n私聊获取百度登录二维码，扫码确认后加密绑定。\n\n#巡帖立即扫描\n跳过扫描间隔，立即扫描所有已启用任务。\n\n#巡帖重载配置\n校验并重新读取 config.yaml。\n\n#巡帖更新\n安全拉取更新并安装依赖。\n\n#巡帖强制更新\n备份本地代码差异后强制同步远端。\n\n#巡帖模式 观察 / 自动 / 停止\n切换插件运行模式。\n\n提示：贴吧、规则、模板、群号、网络和 Cookie 可在 Guoba-Plugin 的「ThreadScout 巡帖」页面管理。' }
  async help(e = this.e) {
    const current = configStore.value
    const stats = database.stats()
    const account = current.accounts.find(item => item.enabled) ?? current.accounts[0]
    const auth = account ? authStore.status(account) : { bound: false }
    const modeMap = { observe: '观察', auto: '自动', stopped: '停止' }
    const modeClass = { observe: 'observe', auto: 'auto', stopped: 'stopped' }
    const commands = [
      { name: '#巡贴帮助', desc: '显示本帮助卡片', access: '公开' },
      { name: '#巡帖状态', desc: '查看模式、账号、任务与今日统计', access: '公开' },
      { name: '#巡帖队列', desc: '查看当前待回复任务数量', access: '公开' },
      { name: '#巡帖账号', desc: '查看账号绑定状态，不显示 Cookie', access: '主人' },
      { name: '#巡帖扫码登录', desc: '私聊扫码登录并加密绑定主账号', access: '主人' },
      { name: '#巡帖账户管理', desc: '添加、启停、解绑、删除及分配任务账号', access: '主人' },
      { name: '#巡帖立即扫描', desc: '跳过间隔，立即扫描启用的任务', access: '主人' },
      { name: '#巡帖重载配置', desc: '校验并重新读取 config.yaml', access: '主人' },
      { name: '#巡帖更新', desc: '安全拉取更新并安装依赖', access: '主人' },
      { name: '#巡帖强制更新', desc: '备份本地差异后强制同步远端', access: '主人' }
    ]
    const modes = [
      { command: '#巡帖模式 观察', name: 'OBSERVE', desc: '只扫描、评分和记录，绝不回帖', tone: 'observe' },
      { command: '#巡帖模式 自动', name: 'AUTO', desc: '命中后进入延迟队列并自动回复', tone: 'auto' },
      { command: '#巡帖模式 停止', name: 'STOPPED', desc: '停止自动扫描和队列发送', tone: 'stopped' }
    ]
    const now = new Date()
    const pad = value => String(value).padStart(2, '0')
    const generatedAt = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
    try {
      if (!e?.runtime?.render) throw new Error('当前运行环境不支持图片渲染')
      await e.runtime.render('ThreadScout-plugin', 'help', {
        commands, modes, generatedAt, mode: modeMap[current.mode] ?? current.mode,
        modeClass: modeClass[current.mode] ?? 'observe', pending: stats.pending,
        todaySuccess: stats.todaySuccess, tasks: current.tasks.filter(item => item.enabled).length,
        accountBound: auth.bound, accountText: auth.bound ? '已绑定' : '未绑定'
      }, { retType: 'default' })
    } catch (error) {
      ;(globalThis.logger ?? console).error('[ThreadScout] 帮助卡片渲染失败', error)
      await this.send(this.helpText())
    }
    return true
  }
  async status() { const current = configStore.value; const stats = database.stats(); return this.send(`【ThreadScout】\n模式：${current.mode}\n待回复：${stats.pending}\n今日成功：${stats.todaySuccess}\n账号：${current.accounts.filter(x => x.enabled).length}\n任务：${current.tasks.filter(x => x.enabled).length}`) }
  async queue() { return this.send(`【巡帖队列】\n当前待回复：${database.pendingCount()}`) }
  async scanNow() { const result = await service.scanAll({ force: true }); return this.send(`扫描完成：检查 ${result.scanned ?? 0}，自动命中 ${result.auto ?? 0}，候选 ${result.candidate ?? 0}，入队 ${result.queued ?? 0}${result.errors?.length ? `\n异常：${result.errors.join('；')}` : ''}`) }
  async setMode() { const map = { 观察: 'observe', 自动: 'auto', 停止: 'stopped' }; const mode = map[this.e.msg.match(/观察|自动|停止/)[0]]; const next = structuredClone(configStore.value); next.mode = mode; configStore.save(next); return this.send(`巡帖模式已切换为：${mode}`) }
  async reloadConfig() { try { configStore.reload(); return this.send('ThreadScout 配置已校验并重载。') } catch (error) { return this.send(`配置重载失败，继续使用原配置：${error.message}`) } }
  async accounts() {
    const lines = []
    for (const account of configStore.value.accounts) {
      const status = authStore.status(account)
      const enabled = account.enabled ? '已启用' : '已停用'
      if (!status.bound) { lines.push(`${account.name}（${account.id}）：${enabled} / 未绑定`); continue }
      if (!account.enabled) { lines.push(`${account.name}（${account.id}）：已停用 / 已绑定 / ${status.source}`); continue }
      try {
        const profile = await adapterFactory(account.id).getAccountProfile()
        lines.push(`${profile.nickname}${profile.uid ? `（UID ${profile.uid}）` : ''}\n配置标识：${account.id} / ${enabled} / ${status.source}`)
      } catch (error) {
        const cleanup = error.cleared ? '\n已连续两次确认失效，插件保存的旧 Cookie 已自动清理。' : error.source === 'environment' ? '\nCookie 来自环境变量，插件无法自动删除，请修改服务器环境变量。' : ''
        lines.push(`${account.name}（${account.id}）：${enabled} / 已绑定但验证失败\n${error.code ?? 'ERROR'}：${error.message}${cleanup}`)
      }
    }
    return this.send(`【巡帖账号】\n${lines.join('\n\n')}\nCookie 不会在聊天中显示，请通过锅巴面板绑定。`)
  }
  async qrLogin(e = this.e) {
    if (e?.isGroup || e?.message_type === 'group') { await this.send('为保护账号安全，请私聊机器人发送 #巡帖扫码登录。'); return true }
    const requestedId = String(e?.msg ?? '').trim().split(/\s+/)[1]
    const accounts = configStore.value.accounts
    const account = requestedId ? accounts.find(item => item.id === requestedId) : (accounts.find(item => item.enabled) ?? accounts[0])
    if (!account) { await this.send('没有可绑定的账号配置，请先在锅巴面板添加账号。'); return true }
    if (this.qrLoginRunning) { await this.send('已有扫码登录正在进行，请先完成或等待二维码过期。'); return true }
    this.qrLoginRunning = true
    try {
      const current = configStore.value
      const login = new BaiduQrLogin({ timeoutSeconds: current.network.timeout_seconds, proxyUrl: current.network.proxy_url })
      const session = await login.create()
      const picture = globalThis.segment?.image ? globalThis.segment.image(session.image) : `二维码图片：${session.imageUrl}`
      await this.send([picture, `\n请使用百度 App 扫码并确认登录。\n绑定账号：${account.name}（${account.id}）\n二维码约 2 分钟内有效，Cookie 不会在聊天中显示。`])
      let scanned = false
      const deadline = Date.now() + 120_000
      while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 2500))
        let state
        try { state = await login.poll(session) } catch (error) {
          if (!['TimeoutError', 'AbortError'].includes(error.name) && error.code !== 'LOGIN_NETWORK_ERROR') throw error
          continue
        }
        if (state.status === 'scanned' && !scanned) { scanned = true; await this.send('二维码已扫描，请在手机上确认登录。') }
        if (state.status === 'expired') throw Object.assign(new Error('二维码已过期，请重新发送 #巡帖扫码登录'), { code: 'LOGIN_EXPIRED' })
        if (state.status !== 'confirmed') continue
        const cookie = await login.finish(state.token)
        const adapter = new TiebaAdapter({ cookie, timeoutSeconds: current.network.timeout_seconds, retries: current.network.retries, retryDelaySeconds: current.network.retry_delay_seconds, proxyUrl: current.network.proxy_url })
        const profile = await adapter.getAccountProfile()
        authStore.setCookie(account.id, cookie)
        await this.send(`扫码登录成功，已加密绑定：${profile.nickname}${profile.uid ? `（UID ${profile.uid}）` : ''}\n配置标识：${account.id}`)
        return true
      }
      throw Object.assign(new Error('等待扫码超时，请重新发送 #巡帖扫码登录'), { code: 'LOGIN_TIMEOUT' })
    } catch (error) {
      ;(globalThis.logger ?? console).error('[ThreadScout] 扫码登录失败', error)
      await this.send(`扫码登录失败：${error.message}`)
      return true
    } finally { this.qrLoginRunning = false }
  }
  privateOnly(e = this.e) {
    if (e?.isGroup || e?.message_type === 'group') { this.send('为保护账号安全，请私聊机器人执行账号管理操作。'); return false }
    return true
  }
  async addAccount(e = this.e) {
    if (!this.privateOnly(e)) return true
    const match = String(e.msg).match(/^#巡帖添加账号\s+(\S+)\s+(.+)$/)
    try { const account = accountManager.add(match[1], match[2]); return this.send(`账号已添加：${account.name}（${account.id}）\n当前为停用、未绑定状态，请发送 #巡帖扫码登录 ${account.id}。`) } catch (error) { return this.send(`添加账号失败：${error.message}`) }
  }
  async manageAccount(e = this.e) {
    if (!this.privateOnly(e)) return true
    const match = String(e.msg).match(/^#巡帖(启用|停用|解绑|删除)账号\s+(\S+)$/)
    const [, action, id] = match
    try {
      if (action === '启用') { accountManager.setEnabled(id, true); return this.send(`账号 ${id} 已启用。`) }
      if (action === '停用') { accountManager.setEnabled(id, false); return this.send(`账号 ${id} 已停用。`) }
      if (action === '解绑') { accountManager.unbind(id); return this.send(`账号 ${id} 的加密 Cookie 已清除。`) }
      const account = accountManager.remove(id)
      return this.send(`账号已删除：${account.name}（${account.id}），其加密 Cookie 也已清除。`)
    } catch (error) { return this.send(`${action}账号失败：${error.message}`) }
  }
  async assignTaskAccount(e = this.e) {
    if (!this.privateOnly(e)) return true
    const match = String(e.msg).match(/^#巡帖任务账号\s+(\S+)\s+(\S+)$/)
    try { const { task, account } = accountManager.assign(match[1], match[2]); return this.send(`任务 ${task.name}（${task.id}）已切换至账号 ${account.name}（${account.id}）。`) } catch (error) { return this.send(`切换任务账号失败：${error.message}`) }
  }
  async runUpdate(force) {
    await this.send(force ? '开始强制更新 ThreadScout，本地代码差异会先备份……' : '开始检查 ThreadScout 更新……')
    try {
      const result = await updater.update({ force })
      if (result.status === 'locked') return this.send('已有更新任务正在执行，请稍后再试。')
      if (result.status === 'dirty') return this.send('检测到插件代码存在本地修改，普通更新已停止。\n请先提交修改，或使用 #巡帖强制更新；强制更新会先把差异备份到 data/update-backups。')
      if (result.status === 'up-to-date') return this.send(`ThreadScout 已是最新版本。\n远端：${result.remote}/${result.branch}\n版本：${result.before.slice(0, 7)}`)
      const backup = result.backup ? `\n本地差异备份：${path.relative(root, result.backup)}` : ''
      return this.send(`ThreadScout 更新完成。\n远端：${result.remote}/${result.branch}\n版本：${result.before.slice(0, 7)} → ${result.after.slice(0, 7)}${backup}\n依赖已安装，请执行 pnpm restart 或重启云崽使新代码生效。`)
    } catch (error) {
      ;(globalThis.logger ?? console).error('[ThreadScout] 更新失败', error)
      return this.send(`ThreadScout 更新失败：${error.stderr || error.message}`)
    }
  }
  async updatePlugin() { return this.runUpdate(false) }
  async forceUpdatePlugin() { return this.runUpdate(true) }
}
