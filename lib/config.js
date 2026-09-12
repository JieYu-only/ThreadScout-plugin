import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'

const configStoreRegistry = globalThis[Symbol.for('threadscout.config-stores')] ??= new Map()

function mergeConfig(base, override) {
  if (Array.isArray(override)) return structuredClone(override)
  if (!override || typeof override !== 'object') return override === undefined ? structuredClone(base) : override
  const result = base && typeof base === 'object' && !Array.isArray(base) ? structuredClone(base) : {}
  for (const [key, value] of Object.entries(override)) result[key] = mergeConfig(result[key], value)
  return result
}

export class ConfigStore {
  constructor(rootDir) {
    this.rootDir = rootDir
    this.defaultPath = path.join(rootDir, 'config', 'default.yaml')
    this.userPath = path.join(rootDir, 'config', 'config.yaml')
    this.value = null
    const peers = configStoreRegistry.get(this.userPath) ?? new Set()
    peers.add(this)
    configStoreRegistry.set(this.userPath, peers)
  }

  load() {
    fs.mkdirSync(path.dirname(this.userPath), { recursive: true })
    if (!fs.existsSync(this.userPath)) fs.copyFileSync(this.defaultPath, this.userPath)
    const defaults = YAML.parse(fs.readFileSync(this.defaultPath, 'utf8'))
    const parsed = mergeConfig(defaults, YAML.parse(fs.readFileSync(this.userPath, 'utf8')))
    this.validate(parsed)
    this.value = parsed
    return parsed
  }

  reload() { return this.load() }

  save(config) {
    this.validate(config)
    if (fs.existsSync(this.userPath)) fs.copyFileSync(this.userPath, this.userPath.replace(/\.yaml$/, '.backup.yaml'))
    const temporary = `${this.userPath}.tmp`
    fs.writeFileSync(temporary, YAML.stringify(config), 'utf8')
    fs.renameSync(temporary, this.userPath)
    for (const store of configStoreRegistry.get(this.userPath) ?? [this]) store.value = structuredClone(config)
  }

  validate(config) {
    if (!config || !['observe', 'auto', 'stopped'].includes(config.mode)) throw new Error('mode 必须是 observe、auto 或 stopped')
    if (!Array.isArray(config.tasks) || config.tasks.length === 0) throw new Error('至少需要一个 tasks 配置')
    if (!Array.isArray(config.accounts) || config.accounts.length === 0) throw new Error('至少需要一个 accounts 配置')
    const accountIds = new Set(config.accounts.map(account => account.id))
    if (accountIds.size !== config.accounts.length) throw new Error('accounts 中存在重复账号标识')
    for (const task of config.tasks) if (!accountIds.has(task.account_id)) throw new Error(`任务 ${task.id} 引用了不存在的账号 ${task.account_id}`)
    if (config.matching.auto_reply_score < config.matching.candidate_score) throw new Error('auto_reply_score 不能低于 candidate_score')
    if (config.queue.min_delay_minutes > config.queue.max_delay_minutes) throw new Error('队列最小延迟不能大于最大延迟')
  }
}
