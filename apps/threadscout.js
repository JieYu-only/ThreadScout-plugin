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
const authSourceText = source => ({ encrypted_file: '锅巴加密保存', environment: '服务器环境变量', none: '未绑定' })[source] ?? '未知来源'

const BasePlugin = globalThis.plugin ?? class {}

export class ThreadScout extends BasePlugin {
  constructor() {
    super({
      name: 'ThreadScout-巡帖', dsc: '论坛主题监控与安全回复队列', event: 'message', priority: 5000,
      rule: [
        { reg: '^#巡[帖贴]帮助$', fnc: 'help' }, { reg: '^#巡帖状态$', fnc: 'status' }, { reg: '^#巡帖立即扫描$', fnc: 'scanNow', permission: 'master' },
        { reg: '^#巡帖模式\\s*(观察|自动|停止)$', fnc: 'setMode', permission: 'master' }, { reg: '^#巡帖重载配置$', fnc: 'reloadConfig', permission: 'master' },
        { reg: '^#巡帖队列$', fnc: 'queue' }, { reg: '^#巡帖记录(?:\\s+\\S+)?$', fnc: 'records', permission: 'master' }, { reg: '^#巡帖账号$', fnc: 'accounts', permission: 'master' },
        { reg: '^#巡帖(?:账户|账号)管理$', fnc: 'accountManagement', permission: 'master' },
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
  helpText() { return '【ThreadScout 指令帮助】\n\n公开指令：\n#巡贴帮助 / #巡帖帮助\n查看本指令说明。\n\n#巡帖状态\n查看运行模式、账号、任务、待回复和今日成功数量。\n\n#巡帖队列\n查看当前待回复任务数量。\n\n主人指令：\n#巡帖记录 [任务标识]\n查看最近扫描命中的帖子、评分和原因。\n\n#巡帖账号\n查看全部账号的启用、绑定和验证状态。\n\n#巡帖添加账号 <标识> <名称>\n#巡帖启用账号 <标识>\n#巡帖停用账号 <标识>\n#巡帖解绑账号 <标识>\n#巡帖删除账号 <标识>\n#巡帖任务账号 <任务标识> <账号标识>\n管理账号与任务绑定；修改操作仅限私聊。\n\n#巡帖扫码登录 [账号标识]\n私聊获取百度登录二维码，扫码确认后加密绑定。\n\n#巡帖立即扫描\n跳过扫描间隔，立即扫描所有已启用任务。\n\n#巡帖重载配置\n校验并重新读取 config.yaml。\n\n#巡帖更新\n安全拉取更新并安装依赖。\n\n#巡帖强制更新\n备份本地代码差异后强制同步远端。\n\n#巡帖模式 观察 / 自动 / 停止\n切换插件运行模式。\n\n提示：贴吧、规则、模板、群号、网络和 Cookie 可在 Guoba-Plugin 的「ThreadScout 巡帖」页面管理。' }
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
      { name: '#巡帖记录', desc: '查看最近命中、评分与匹配原因', access: '主人' },
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
  async records(e = this.e) {
    const taskId = String(e?.msg ?? '').trim().split(/\s+/)[1] ?? null
    const task = taskId ? configStore.value.tasks.find(item => item.id === taskId) : null
    if (taskId && !task) return this.send(`找不到任务 ${taskId}，请在锅巴对应的贴吧任务区块查看账号与任务配置。`)
    const rows = database.recentMatches({ taskId, limit: 8 })
    if (!rows.length) return this.send(`【巡帖记录】\n${task ? `${task.name}（${task.id}）暂无命中记录。` : '暂无自动命中、候选或排除记录。'}\n首次扫描只建立基线，不处理历史帖。`)
    const decisionText = { auto: '自动命中', candidate: '候选', excluded: '已排除' }
    const reasonText = row => {
      if (row.match?.excludedBy) return `排除词“${row.match.excludedBy}”`
      const reasons = (row.match?.reasons ?? []).map(reason => {
        if (reason.type === 'keyword') return `${reason.field === 'title' ? '标题' : '正文'}“${reason.text}” ${reason.score >= 0 ? '+' : ''}${reason.score}`
        if (reason.type === 'negative') return `负向词“${reason.text}” ${reason.score}`
        if (reason.type === 'combination') return `组合规则 ${reason.id} +${reason.score}`
        return null
      }).filter(Boolean)
      return reasons.join('、') || '无详细原因'
    }
    const content = rows.map((row, index) => `${index + 1}. [${decisionText[row.decision] ?? row.decision} / ${row.score} 分] ${row.title}\n贴吧：${row.forum_name}吧${row.task_id ? ` · 任务：${row.task_id}` : ''}\n原因：${reasonText(row)}\nhttps://tieba.baidu.com/p/${row.thread_id}`).join('\n\n')
    return this.send(`【巡帖记录】${task ? `\n${task.name}（${task.id}）` : ''}\n\n${content}`)
  }
  async scanNow() { const result = await service.scanAll({ force: true }); return this.send(`扫描完成：检查 ${result.scanned ?? 0}，自动命中 ${result.auto ?? 0}，候选 ${result.candidate ?? 0}，入队 ${result.queued ?? 0}${result.errors?.length ? `\n异常：${result.errors.join('；')}` : ''}`) }
  async setMode() { const map = { 观察: 'observe', 自动: 'auto', 停止: 'stopped' }; const mode = map[this.e.msg.match(/观察|自动|停止/)[0]]; const next = structuredClone(configStore.value); next.mode = mode; configStore.save(next); return this.send(`巡帖模式已切换为：${mode}`) }
  async reloadConfig() { try { configStore.reload(); return this.send('ThreadScout 配置已校验并重载。') } catch (error) { return this.send(`配置重载失败，继续使用原配置：${error.message}`) } }
  async accounts() {
    const lines = []
    for (const account of configStore.value.accounts) {
      const status = authStore.status(account)
      const enabled = account.enabled ? '已启用' : '已停用'
      if (!status.bound) { lines.push(`${account.name}\n账号标识：${account.id}\n状态：${enabled} / 未绑定\nCookie 来源：未绑定`); continue }
      if (!account.enabled) { lines.push(`${account.name}\n账号标识：${account.id}\n状态：已停用 / 已绑定\nCookie 来源：${authSourceText(status.source)}`); continue }
      try {
        const profile = await adapterFactory(account.id).getAccountProfile({ recordValidation: false })
        lines.push(`${profile.nickname}${profile.uid ? `（UID ${profile.uid}）` : ''}\n配置名称：${account.name}\n账号标识：${account.id}\n状态：${enabled}\nCookie 来源：${authSourceText(status.source)}`)
      } catch (error) {
        const cleanup = error.cleared ? '\n已连续两次确认失效，插件保存的旧 Cookie 已自动清理。' : error.source === 'environment' ? '\nCookie 来自环境变量，插件无法自动删除，请修改服务器环境变量。' : ''
        lines.push(`${account.name}\n账号标识：${account.id}\n状态：${enabled} / 已绑定但验证失败\nCookie 来源：${authSourceText(status.source)}\n错误类型：${error.code ?? '未知错误'}\n${error.message}${cleanup}`)
      }
    }
    return this.send(`【巡帖账号】\n${lines.join('\n\n')}\nCookie 不会在聊天中显示，请通过锅巴面板绑定。`)
  }
  accountManagementText() { return '【巡帖账户管理】\n\n以下修改指令仅限机器人主人私聊使用：\n\n#巡帖添加账号 <账号标识> <显示名称>\n添加一个默认停用、未绑定的新账号。\n\n#巡帖启用账号 <账号标识>\n#巡帖停用账号 <账号标识>\n切换账号启用状态；被启用任务引用的账号不能停用。\n\n#巡帖扫码登录 [账号标识]\n扫码登录并加密保存 Cookie；不填写标识时绑定当前主账号。\n\n#巡帖解绑账号 <账号标识>\n清除该账号由插件加密保存的 Cookie。\n\n#巡帖删除账号 <账号标识>\n删除未被任务引用的账号及其加密 Cookie。\n\n#巡帖任务账号 <任务标识> <账号标识>\n将任务切换到指定的已启用账号。\n\n#巡帖账号\n查看全部账号的启用、绑定和在线验证状态。\n\n账号标识仅支持字母、数字、下划线和短横线。' }
  async accountManagement(e = this.e) {
    const accounts = configStore.value.accounts.map(account => {
      const auth = authStore.status(account)
      return { name: account.name, id: account.id, enabled: account.enabled, bound: auth.bound, source: authSourceText(auth.source) }
    })
    const commands = [
      { name: '#巡帖添加账号', args: '<标识> <名称>', desc: '添加停用且未绑定的新账号' },
      { name: '#巡帖启用账号', args: '<账号标识>', desc: '启用指定账号' },
      { name: '#巡帖停用账号', args: '<账号标识>', desc: '停用未被启用任务引用的账号' },
      { name: '#巡帖扫码登录', args: '[账号标识]', desc: '扫码登录并加密保存 Cookie' },
      { name: '#巡帖解绑账号', args: '<账号标识>', desc: '清除插件加密保存的 Cookie' },
      { name: '#巡帖删除账号', args: '<账号标识>', desc: '删除未被任务引用的账号' },
      { name: '#巡帖任务账号', args: '<任务标识> <账号标识>', desc: '切换任务使用的账号' }
    ]
    const now = new Date()
    const pad = value => String(value).padStart(2, '0')
    const generatedAt = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
    try {
      if (!e?.runtime?.render) throw new Error('当前运行环境不支持图片渲染')
      await e.runtime.render('ThreadScout-plugin', 'account-management', {
        accounts, commands, generatedAt, total: accounts.length,
        enabled: accounts.filter(item => item.enabled).length, bound: accounts.filter(item => item.bound).length
      }, { retType: 'default' })
    } catch (error) {
      ;(globalThis.logger ?? console).error('[ThreadScout] 账户管理卡片渲染失败', error)
      await this.send(this.accountManagementText())
    }
    return true
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
        await this.send(`扫码登录成功，已加密绑定：${profile.nickname}${profile.uid ? `（UID ${profile.uid}）` : ''}\n配置名称：${account.name}\n账号标识：${account.id}`)
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
  async sendUpdateLog(logs) {
    if (!logs?.length) return
    const title = `ThreadScout-plugin更新日志，共${logs.length}条`
    const details = logs.join('\n\n')
    const repository = '更多详细信息，请前往\nhttps://gitee.com/jieyu19960111/thread-scout-plugin 查看'
    try {
      const { default: common } = await import('../../../lib/common/common.js')
      return this.send(await common.makeForwardMsg(this.e, [details, repository], title))
    } catch (error) {
      ;(globalThis.logger ?? console).warn('[ThreadScout] 合并转发更新日志失败，改用普通消息', error)
      return this.send(`${title}\n\n${details}\n\n${repository}`)
    }
  }
  async runUpdate(force) {
    await this.send(force ? '正在执行强制更新操作，请稍等' : '正在执行更新操作，请稍等')
    try {
      const result = await updater.update({ force })
      if (result.status === 'locked') return this.send('已有更新任务正在执行，请稍后再试。')
      if (result.status === 'dirty') return this.send('检测到插件代码存在本地修改，普通更新已停止。\n请先提交修改，或使用 #巡帖强制更新；强制更新会先把差异备份到 data/update-backups。')
      if (result.status === 'up-to-date') return this.send(`ThreadScout-plugin已经是最新版本\n最后更新时间：${result.updatedAt || '未知'}`)
      const backup = result.backup ? `\n本地差异备份：${path.relative(root, result.backup)}` : ''
      await this.send(`ThreadScout-plugin\n最后更新时间：${result.updatedAt || '未知'}${backup}`)
      await this.sendUpdateLog(result.logs)
      await this.send('更新完毕，正在重启机器人以应用更新')
      const event = this.e
      setTimeout(async () => {
        try {
          const { Restart } = await import('../../other/restart.js')
          await new Restart(event).restart()
        } catch (error) { (globalThis.logger ?? console).error('[ThreadScout] 自动重启失败', error) }
      }, 2000)
      return true
    } catch (error) {
      ;(globalThis.logger ?? console).error('[ThreadScout] 更新失败', error)
      return this.send(`ThreadScout 更新失败：${error.stderr || error.message}`)
    }
  }
  async updatePlugin() { return this.runUpdate(false) }
  async forceUpdatePlugin() { return this.runUpdate(true) }
}
