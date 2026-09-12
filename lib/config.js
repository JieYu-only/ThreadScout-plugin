import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'

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
    this.value = config
  }

  validate(config) {
    if (!config || !['observe', 'auto', 'stopped'].includes(config.mode)) throw new Error('mode 必须是 observe、auto 或 stopped')
    if (!Array.isArray(config.tasks) || config.tasks.length === 0) throw new Error('至少需要一个 tasks 配置')
    if (config.matching.auto_reply_score < config.matching.candidate_score) throw new Error('auto_reply_score 不能低于 candidate_score')
    if (config.queue.min_delay_minutes > config.queue.max_delay_minutes) throw new Error('队列最小延迟不能大于最大延迟')
  }
}
