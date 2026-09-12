import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ConfigStore } from '../lib/config.js'
import { AuthStore } from '../lib/auth-store.js'
import { ThreadScoutDatabase } from '../lib/database.js'
import { TiebaAdapter } from '../lib/tieba-adapter.js'
import { ThreadScoutService } from '../lib/service.js'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const configStore = new ConfigStore(root)
const config = configStore.load()
const authStore = new AuthStore(root)
const database = new ThreadScoutDatabase(path.resolve(root, config.database.path))
const adapterFactory = accountId => {
  const current = configStore.value
  const account = current.accounts.find(item => item.id === accountId)
  if (!account) return null
  return new TiebaAdapter({
    cookie: authStore.getCookie(account),
    timeoutSeconds: current.network.timeout_seconds,
    retries: current.network.retries,
    retryDelaySeconds: current.network.retry_delay_seconds,
    proxyUrl: current.network.proxy_url
  })
}
const service = new ThreadScoutService({ configStore, database, adapterFactory, logger: globalThis.logger ?? console })

const BasePlugin = globalThis.plugin ?? class {}

export class ThreadScout extends BasePlugin {
  constructor() {
    super({
      name: 'ThreadScout-巡帖', dsc: '论坛主题监控与安全回复队列', event: 'message', priority: 5000,
      rule: [
        { reg: '^#巡[帖贴]帮助$', fnc: 'help' }, { reg: '^#巡帖状态$', fnc: 'status' }, { reg: '^#巡帖立即扫描$', fnc: 'scanNow', permission: 'master' },
        { reg: '^#巡帖模式\\s*(观察|自动|停止)$', fnc: 'setMode', permission: 'master' }, { reg: '^#巡帖重载配置$', fnc: 'reloadConfig', permission: 'master' },
        { reg: '^#巡帖队列$', fnc: 'queue' }, { reg: '^#巡帖账号$', fnc: 'accounts', permission: 'master' }
      ],
      task: [
        { cron: '15 * * * * *', name: 'ThreadScout主题扫描', fnc: () => service.scanAll() },
        { cron: '*/30 * * * * *', name: 'ThreadScout回复队列', fnc: () => service.processQueue() }
      ]
    })
  }

  async send(message) { return this.reply?.(message) }
  helpText() { return '【ThreadScout 指令帮助】\n\n公开指令：\n#巡贴帮助 / #巡帖帮助\n查看本指令说明。\n\n#巡帖状态\n查看运行模式、账号、任务、待回复和今日成功数量。\n\n#巡帖队列\n查看当前待回复任务数量。\n\n主人指令：\n#巡帖账号\n查看账号是否已绑定；不会显示 Cookie 内容。\n\n#巡帖立即扫描\n跳过扫描间隔，立即扫描所有已启用任务。\n\n#巡帖重载配置\n校验并重新读取 config.yaml。\n\n#巡帖模式 观察 / 自动 / 停止\n切换插件运行模式。\n\n提示：贴吧、规则、模板、群号、网络和 Cookie 可在 Guoba-Plugin 的「ThreadScout 巡帖」页面管理。' }
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
      { name: '#巡帖立即扫描', desc: '跳过间隔，立即扫描启用的任务', access: '主人' },
      { name: '#巡帖重载配置', desc: '校验并重新读取 config.yaml', access: '主人' }
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
      if (!status.bound) { lines.push(`${account.name}（${account.id}）：未绑定`); continue }
      try {
        const profile = await adapterFactory(account.id).getAccountProfile()
        lines.push(`${profile.nickname}${profile.uid ? `（UID ${profile.uid}）` : ''}\n配置标识：${account.id} / ${status.source}`)
      } catch (error) {
        lines.push(`${account.name}（${account.id}）：已绑定但验证失败\n${error.code ?? 'ERROR'}：${error.message}`)
      }
    }
    return this.send(`【巡帖账号】\n${lines.join('\n\n')}\nCookie 不会在聊天中显示，请通过锅巴面板绑定。`)
  }
}
