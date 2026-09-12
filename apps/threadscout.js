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
        { reg: '^#巡帖状态$', fnc: 'status' }, { reg: '^#巡帖立即扫描$', fnc: 'scanNow', permission: 'master' },
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
  async status() { const current = configStore.value; const stats = database.stats(); return this.send(`【ThreadScout】\n模式：${current.mode}\n待回复：${stats.pending}\n今日成功：${stats.todaySuccess}\n账号：${current.accounts.filter(x => x.enabled).length}\n任务：${current.tasks.filter(x => x.enabled).length}`) }
  async queue() { return this.send(`【巡帖队列】\n当前待回复：${database.pendingCount()}`) }
  async scanNow() { const result = await service.scanAll({ force: true }); return this.send(`扫描完成：检查 ${result.scanned ?? 0}，自动命中 ${result.auto ?? 0}，候选 ${result.candidate ?? 0}，入队 ${result.queued ?? 0}${result.errors?.length ? `\n异常：${result.errors.join('；')}` : ''}`) }
  async setMode() { const map = { 观察: 'observe', 自动: 'auto', 停止: 'stopped' }; const mode = map[this.e.msg.match(/观察|自动|停止/)[0]]; const next = structuredClone(configStore.value); next.mode = mode; configStore.save(next); return this.send(`巡帖模式已切换为：${mode}`) }
  async reloadConfig() { try { configStore.reload(); return this.send('ThreadScout 配置已校验并重载。') } catch (error) { return this.send(`配置重载失败，继续使用原配置：${error.message}`) } }
  async accounts() { const lines = configStore.value.accounts.map(account => { const status = authStore.status(account); return `${account.name}（${account.id}）：${status.bound ? `已绑定 / ${status.source}` : '未绑定'}` }); return this.send(`【巡帖账号】\n${lines.join('\n')}\nCookie 不会在聊天中显示，请通过锅巴面板绑定。`) }
}
