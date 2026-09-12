import { matchThread } from './matcher.js'
import { renderTemplate, selectTemplate } from './templates.js'

const delayDate = (min, max) => new Date(Date.now() + (min + Math.random() * (max - min)) * 60_000)

export class ThreadScoutService {
  constructor({ configStore, database, adapterFactory, logger = console }) { this.configStore = configStore; this.db = database; this.adapterFactory = adapterFactory; this.logger = logger; this.scanning = false }
  config() { return this.configStore.value }

  async scanAll({ force = false } = {}) {
    if (this.scanning) return { skipped: 'scan_locked' }
    if (!force && (!this.config().enabled || this.config().mode === 'stopped')) return { skipped: 'stopped' }
    this.scanning = true
    const summary = { scanned: 0, auto: 0, candidate: 0, excluded: 0, ignored: 0, queued: 0, errors: [], tasks: [] }
    try {
      for (const task of this.config().tasks.filter(item => item.enabled)) await this.scanTask(task, summary, force)
      return summary
    } finally { this.scanning = false }
  }

  async scanTask(task, summary, force = false) {
    const lastScanKey = `last_scan:${task.id}`
    const lastScan = this.db.getRuntime(lastScanKey)
    if (!force && lastScan && Date.now() - Date.parse(lastScan) < task.scan.interval_minutes * 60_000) return
    const taskSummary = { id: task.id, name: task.name, forum: task.forum, fetched: 0, scanned: 0, auto: 0, candidate: 0, excluded: 0, ignored: 0, queued: 0, baseline: false, error: null }
    summary.tasks.push(taskSummary)
    const adapter = this.adapterFactory(task.account_id)
    if (!adapter) {
      taskSummary.error = '缺少账号适配器'
      summary.errors.push(`${task.id}: ${taskSummary.error}`)
      this.logScan(taskSummary)
      return
    }
    try {
      const threads = await adapter.listThreads(task.forum, { pages: task.scan.pages, latestThreads: task.scan.latest_threads })
      taskSummary.fetched = threads.length
      const newest = threads[0]?.id
      const baselineKey = `baseline:${task.id}`
      const baseline = this.db.getRuntime(baselineKey)
      if (!baseline) { taskSummary.baseline = true; this.db.setRuntime(baselineKey, newest ?? 'empty'); return }
      for (const original of threads) {
        if (original.id === baseline) break
        if (original.createdAt && Date.now() - Date.parse(original.createdAt) > task.scan.max_age_minutes * 60_000) continue
        summary.scanned++
        taskSummary.scanned++
        const thread = await adapter.getThread(original)
        const result = matchThread(thread, this.config().matching)
        this.db.upsertThread({ ...thread, taskId: task.id }, result)
        summary[result.decision] = (summary[result.decision] ?? 0) + 1
        taskSummary[result.decision] = (taskSummary[result.decision] ?? 0) + 1
        if (result.decision !== 'auto' || this.db.hasSuccessfulReply(thread.platform, thread.id) || this.db.pendingCount() >= this.config().queue.max_pending) continue
        if (this.config().mode === 'auto' && this.db.enqueue({ platform: thread.platform, threadId: thread.id, taskId: task.id, accountId: task.account_id, score: result.score, scheduledAt: delayDate(this.config().queue.min_delay_minutes, this.config().queue.max_delay_minutes).toISOString() })) { summary.queued++; taskSummary.queued++ }
      }
      this.db.setRuntime(baselineKey, newest ?? baseline)
    } catch (error) { taskSummary.error = error.message; summary.errors.push(`${task.id}: ${error.message}`); this.logger.error('[ThreadScout]', error) }
    finally { this.db.setRuntime(lastScanKey, new Date().toISOString()); this.logScan(taskSummary) }
  }

  logScan(result) {
    const detail = result.baseline
      ? `建立基线，读取主题 ${result.fetched} 条，本次不处理历史帖`
      : `读取 ${result.fetched}，检查 ${result.scanned}，自动命中 ${result.auto}，候选 ${result.candidate}，排除 ${result.excluded}，忽略 ${result.ignored}，入队 ${result.queued}`
    const message = `[ThreadScout][扫描完成] ${result.name}（${result.id}）/ ${result.forum}吧；${detail}${result.error ? `；异常：${result.error}` : ''}；模式：${this.config().mode}`
    const write = this.logger.mark ?? this.logger.info ?? this.logger.log
    write?.call(this.logger, message)
  }

  async processQueue() {
    if (this.config().mode !== 'auto') return { processed: 0 }
    let processed = 0
    for (const item of this.db.dueQueue()) {
      const overdue = Date.now() - Date.parse(item.scheduled_at)
      if (overdue > this.config().queue.max_overdue_minutes * 60_000) { this.db.markQueue(item.id, 'expired', '任务已过期'); continue }
      const task = this.config().tasks.find(value => value.id === item.task_id)
      const adapter = this.adapterFactory(item.account_id)
      if (!task || !adapter || this.db.hasSuccessfulReply(item.platform, item.thread_id)) { this.db.markQueue(item.id, 'cancelled', '任务无效或已回复'); continue }
      const hourAgo = new Date(Date.now() - 3600_000)
      const dayStart = new Date(new Date().setHours(0,0,0,0))
      if (this.db.countReplies(hourAgo) >= this.config().limits.max_per_hour || this.db.countReplies(dayStart) >= this.config().limits.max_per_day) break
      try {
        const refreshed = await adapter.getThread({ platform: item.platform, id: item.thread_id, forum: task.forum, title: '' })
        const result = matchThread(refreshed, this.config().matching)
        if (result.decision !== 'auto') { this.db.markQueue(item.id, 'cancelled', '发送前复核未通过'); continue }
        const recent = this.db.recentTemplateIds(this.config().reply.avoid_recent_templates)
        const template = selectTemplate(this.config().reply.pools[task.reply_pool], recent)
        const content = renderTemplate(template.text, this.config().reply.resources)
        await adapter.reply(refreshed, content)
        const repliedAt = new Date().toISOString()
        this.db.addReply({ platform: item.platform, threadId: item.thread_id, forum: task.forum, accountId: item.account_id, taskId: item.task_id, templateId: template.id, content, score: result.score, status: 'success', queuedAt: item.created_at, repliedAt })
        this.db.markQueue(item.id, 'success')
        this.db.setRuntime('consecutive_failures', 0)
        processed++
      } catch (error) {
        this.db.markQueue(item.id, 'failed', `${error.code ?? 'UNKNOWN_ERROR'}: ${error.message}`)
        this.db.addReply({ platform: item.platform, threadId: item.thread_id, forum: task.forum, accountId: item.account_id, taskId: item.task_id, score: item.score, status: 'failed', errorCode: error.code ?? 'UNKNOWN_ERROR', errorMessage: error.message, queuedAt: item.created_at })
        const failures = this.db.getRuntime('consecutive_failures', 0) + 1
        this.db.setRuntime('consecutive_failures', failures)
        if (['AUTH_EXPIRED', 'RATE_LIMITED'].includes(error.code) || failures >= this.config().circuit_breaker.consecutive_failures) { this.config().mode = 'observe'; break }
      }
    }
    return { processed }
  }
}
