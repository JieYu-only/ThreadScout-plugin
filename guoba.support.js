import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ConfigStore } from './lib/config.js'
import { AuthStore } from './lib/auth-store.js'
import { formatNegativeKeywords, formatResources, formatScoredKeywords, parseExcludeKeywords, parseNegativeKeywords, parseResources, parseScoredKeywords, validateTemplateResources } from './lib/guoba-parser.js'

const root = path.dirname(fileURLToPath(import.meta.url))
const configStore = new ConfigStore(root)
const authStore = new AuthStore(root)

const firstAccount = config => config.accounts[0]
const authSourceText = source => ({ encrypted_file: '锅巴加密保存', environment: '服务器环境变量', none: '未绑定' })[source] ?? '未知来源'
const TASK_SLOTS = 3
const field = (slot, name) => `task_${slot}_${name}`
const taskSchemas = slot => [
  { component: 'Divider', label: `贴吧任务 ${slot}` },
  { field: field(slot, 'enabled'), label: `启用任务 ${slot}`, component: 'Switch' },
  { field: field(slot, 'forum'), label: '贴吧名称', component: 'Input', bottomHelpMessage: '填写吧名即可，不需要包含最后的“吧”字', componentProps: { placeholder: '例如：逃离塔科夫' } },
  { field: field(slot, 'account_id'), label: '使用账号标识', component: 'Input', bottomHelpMessage: '填写账号清单中的账号标识，例如 main_account' },
  { field: field(slot, 'interval_minutes'), label: '扫描间隔（分钟）', component: 'InputNumber', bottomHelpMessage: '默认 180 分钟（3 小时）；需要时可使用 #巡帖立即扫描', componentProps: { min: 1, max: 1440 } },
  { field: field(slot, 'latest_threads'), label: '每次最多主题数', component: 'InputNumber', componentProps: { min: 1, max: 500 } },
  { field: field(slot, 'pages'), label: '最大页数', component: 'InputNumber', componentProps: { min: 1, max: 10 } },
  { field: field(slot, 'max_age_minutes'), label: '帖子最大时效（分钟）', component: 'InputNumber', componentProps: { min: 1, max: 10080 } },
  { field: field(slot, 'resources'), label: '群号与回复资源', component: 'InputTextArea', bottomHelpMessage: '每行：资源标识 | 类型 | 内容。当前任务可配置多个群号', componentProps: { rows: 4, placeholder: `task${slot}_main | qq_group | 123456\ntask${slot}_pve | qq_group | 654321` } },
  { field: field(slot, 'templates'), label: '回复模板', component: 'InputTextArea', bottomHelpMessage: '每行一条；使用 {{resource:资源标识}} 引用本任务上方配置的群号', componentProps: { rows: 5 } }
]

function referencedResourceIds(pool = []) {
  const ids = new Set()
  for (const item of pool) for (const match of String(item.text ?? '').matchAll(/\{\{resource:([a-zA-Z0-9_-]+)\}\}/g)) ids.add(match[1])
  return [...ids]
}

function resourcesForTask(config, task) {
  const ids = task.resource_ids?.length ? task.resource_ids : referencedResourceIds(config.reply.pools[task.reply_pool])
  return Object.fromEntries(ids.filter(id => config.reply.resources[id]).map(id => [id, config.reply.resources[id]]))
}

function defaultTask(slot, accountId) {
  const id = `tieba_task_${slot}`
  return { id, name: `贴吧任务 ${slot}`, enabled: false, platform: 'tieba', forum: '', account_id: accountId, reply_pool: id, resource_ids: [], scan: { interval_minutes: 180, latest_threads: 50, pages: 2, max_age_minutes: 120 } }
}

export function supportGuoba() {
  return {
    pluginInfo: {
      name: 'ThreadScout-plugin',
      title: 'ThreadScout 巡帖',
      description: '贴吧主题扫描、规则评分与安全回复队列',
      author: 'ThreadScout',
      link: '',
      isV3: true,
      isV2: false,
      showInMenu: true,
      icon: 'mdi:radar',
      iconColor: '#3b82f6'
    },
    configInfo: {
      schemas: [
        { component: 'Divider', label: '运行控制' },
        { field: 'enabled', label: '启用插件', component: 'Switch' },
        { field: 'mode', label: '运行模式', component: 'Select', bottomHelpMessage: '首次使用请保持观察模式；确认规则稳定后再切换自动模式', componentProps: { options: [{ label: '观察（不回帖）', value: 'observe' }, { label: '自动回复', value: 'auto' }, { label: '停止', value: 'stopped' }] } },
        ...Array.from({ length: TASK_SLOTS }, (_, index) => taskSchemas(index + 1)).flat(),
        { component: 'Divider', label: '评分与安全限制' },
        { field: 'candidate_score', label: '候选阈值', component: 'InputNumber', componentProps: { min: -100, max: 100 } },
        { field: 'auto_reply_score', label: '自动回复阈值', component: 'InputNumber', componentProps: { min: -100, max: 100 } },
        { field: 'strong_keywords', label: '强关键词', component: 'InputTextArea', bottomHelpMessage: '每行：关键词 | 标题分 | 正文分，例如：找队友 | 5 | 3', componentProps: { rows: 5 } },
        { field: 'auxiliary_keywords', label: '辅助词', component: 'InputTextArea', bottomHelpMessage: '每行：关键词 | 标题分 | 正文分，例如：萌新 | 2 | 1', componentProps: { rows: 5 } },
        { field: 'negative_keywords', label: '负向词', component: 'InputTextArea', bottomHelpMessage: '每行：关键词 | 扣分，扣分应为 0 或负数，例如：吐槽 | -5', componentProps: { rows: 4 } },
        { field: 'exclude_keywords', label: '排除词', component: 'InputTextArea', bottomHelpMessage: '每行一个；命中后直接排除，不进入回复队列', componentProps: { rows: 4 } },
        { field: 'max_per_hour', label: '每小时回复上限', component: 'InputNumber', componentProps: { min: 1, max: 100 } },
        { field: 'max_per_day', label: '每日回复上限', component: 'InputNumber', componentProps: { min: 1, max: 1000 } },
        { field: 'min_delay_minutes', label: '最小延迟（分钟）', component: 'InputNumber', componentProps: { min: 0, max: 1440 } },
        { field: 'max_delay_minutes', label: '最大延迟（分钟）', component: 'InputNumber', componentProps: { min: 0, max: 1440 } },
        { component: 'Divider', label: '贴吧账号' },
        { field: 'accounts_text', label: '账号清单', component: 'InputTextArea', bottomHelpMessage: '每行：账号标识 | 显示名称 | true/false | Cookie环境变量。被任务引用的账号不能直接删除。', componentProps: { rows: 5, placeholder: 'main_account | 主账号 | true | THREADSCOUT_TIEBA_COOKIE_MAIN' } },
        { field: 'account_id', label: '当前操作账号', component: 'Input', required: true, bottomHelpMessage: '下面的绑定状态、更新 Cookie 和删除 Cookie 均针对该账号标识' },
        { field: 'account_status', label: '绑定状态', component: 'Input', componentProps: { disabled: true } },
        { field: 'account_cookie', label: '更新 Cookie', component: 'Input', bottomHelpMessage: '可直接粘贴浏览器复制的完整 Cookie；插件会自动解析、去重，只保留贴吧登录所需字段并加密保存。留空不会覆盖。', componentProps: { type: 'password', placeholder: '直接粘贴完整 Cookie' } },
        { field: 'remove_cookie', label: '删除已保存 Cookie', component: 'Switch' },
        { component: 'Divider', label: '网络容错' },
        { field: 'timeout_seconds', label: '请求超时（秒）', component: 'InputNumber', componentProps: { min: 3, max: 120 } },
        { field: 'retries', label: '网络重试次数', component: 'InputNumber', componentProps: { min: 0, max: 5 } },
        { field: 'retry_delay_seconds', label: '重试间隔（秒）', component: 'InputNumber', componentProps: { min: 0, max: 60 } },
        { field: 'proxy_url', label: 'HTTP/HTTPS 代理', component: 'Input', bottomHelpMessage: '可选，例如 http://127.0.0.1:7890；修改后立即对下一次请求生效', componentProps: { placeholder: '留空为直连' } }
      ],
      getConfigData() {
        const config = configStore.load()
        const account = firstAccount(config)
        const auth = authStore.status(account)
        const result = {
          enabled: config.enabled,
          mode: config.mode,
          candidate_score: config.matching.candidate_score,
          auto_reply_score: config.matching.auto_reply_score,
          strong_keywords: formatScoredKeywords(config.matching.strong),
          auxiliary_keywords: formatScoredKeywords(config.matching.auxiliary),
          negative_keywords: formatNegativeKeywords(config.matching.negative),
          exclude_keywords: (config.matching.exclude ?? []).join('\n'),
          max_per_hour: config.limits.max_per_hour,
          max_per_day: config.limits.max_per_day,
          min_delay_minutes: config.queue.min_delay_minutes,
          max_delay_minutes: config.queue.max_delay_minutes,
          accounts_text: config.accounts.map(item => `${item.id} | ${item.name} | ${item.enabled} | ${item.cookie_env ?? ''}`).join('\n'),
          account_id: account.id,
          account_status: `${account.name}：${auth.bound ? `已绑定（${authSourceText(auth.source)}）` : '未绑定'}`,
          account_cookie: '',
          remove_cookie: false,
          timeout_seconds: config.network.timeout_seconds,
          retries: config.network.retries,
          retry_delay_seconds: config.network.retry_delay_seconds,
          proxy_url: config.network.proxy_url
        }
        for (let slot = 1; slot <= TASK_SLOTS; slot++) {
          const task = config.tasks[slot - 1] ?? defaultTask(slot, account.id)
          const pool = config.reply.pools[task.reply_pool] ?? []
          result[field(slot, 'enabled')] = task.enabled
          result[field(slot, 'forum')] = task.forum
          result[field(slot, 'account_id')] = task.account_id
          for (const key of ['interval_minutes', 'latest_threads', 'pages', 'max_age_minutes']) result[field(slot, key)] = task.scan[key]
          result[field(slot, 'resources')] = formatResources(resourcesForTask(config, task))
          result[field(slot, 'templates')] = pool.map(item => item.text).join('\n')
        }
        return result
      },
      setConfigData(data, { Result }) {
        try {
          const config = structuredClone(configStore.load())
          const previousAccountIds = new Set(config.accounts.map(item => item.id))
          if (data.accounts_text != null) {
            const accounts = String(data.accounts_text).split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
              const [id = '', name = '', enabled = 'false', cookieEnv = ''] = line.split('|').map(value => value.trim())
              if (!/^[a-zA-Z0-9_-]{1,32}$/.test(id)) throw new Error(`账号标识无效：${id || '空'}`)
              if (!name || name.length > 30) throw new Error(`账号 ${id} 的显示名称无效`)
              if (!['true', 'false'].includes(enabled.toLowerCase())) throw new Error(`账号 ${id} 的启用状态必须是 true 或 false`)
              return { id, name, enabled: enabled.toLowerCase() === 'true', cookie_env: cookieEnv }
            })
            if (!accounts.length) throw new Error('必须至少保留一个账号')
            config.accounts = accounts
          }
          const accountId = String(data.account_id ?? firstAccount(config).id).trim()
          const account = config.accounts.find(item => item.id === accountId)
          if (!account) throw new Error(`找不到当前操作账号 ${accountId}`)
          if (data.enabled != null) config.enabled = Boolean(data.enabled)
          if (data.mode != null) config.mode = data.mode

          const originalSlots = Array.from({ length: TASK_SLOTS }, (_, index) => config.tasks[index] ?? defaultTask(index + 1, firstAccount(config).id))
          const managedResourceIds = new Set(originalSlots.flatMap(task => task.resource_ids?.length ? task.resource_ids : referencedResourceIds(config.reply.pools[task.reply_pool])))
          const resources = Object.fromEntries(Object.entries(config.reply.resources).filter(([id]) => !managedResourceIds.has(id)))
          const pools = structuredClone(config.reply.pools)
          const tasks = []
          for (let slot = 1; slot <= TASK_SLOTS; slot++) {
            const task = structuredClone(originalSlots[slot - 1])
            if (data[field(slot, 'enabled')] != null) task.enabled = Boolean(data[field(slot, 'enabled')])
            if (data[field(slot, 'forum')] != null) task.forum = String(data[field(slot, 'forum')]).trim().replace(/吧$/, '')
            if (data[field(slot, 'account_id')] != null) task.account_id = String(data[field(slot, 'account_id')]).trim()
            for (const key of ['interval_minutes', 'latest_threads', 'pages', 'max_age_minutes']) if (data[field(slot, key)] != null) task.scan[key] = Number(data[field(slot, key)])
            if (task.enabled && !task.forum) throw new Error(`贴吧任务 ${slot} 已启用，请填写贴吧名称`)
            const taskAccount = config.accounts.find(item => item.id === task.account_id)
            if (!taskAccount) throw new Error(`贴吧任务 ${slot} 引用了不存在的账号：${task.account_id}`)
            if (task.enabled && !taskAccount.enabled) throw new Error(`贴吧任务 ${slot} 使用的账号 ${task.account_id} 尚未启用`)

            task.reply_pool ||= task.id
            const resourceInput = data[field(slot, 'resources')] ?? formatResources(resourcesForTask(config, task))
            const taskResources = String(resourceInput ?? '').trim() ? parseResources(resourceInput) : {}
            for (const [id, item] of Object.entries(taskResources)) {
              if (resources[id] && JSON.stringify(resources[id]) !== JSON.stringify(item)) throw new Error(`贴吧任务 ${slot} 的资源标识与其他任务冲突：${id}`)
              resources[id] = item
            }
            const oldPool = config.reply.pools[task.reply_pool] ?? []
            const templateInput = data[field(slot, 'templates')] ?? oldPool.map(item => item.text).join('\n')
            const texts = String(templateInput ?? '').split(/\r?\n/).map(value => value.trim()).filter(Boolean)
            if (task.enabled && !texts.length) throw new Error(`贴吧任务 ${slot} 已启用，请至少填写一条回复模板`)
            task.name = task.forum ? `${task.forum}吧任务` : `贴吧任务 ${slot}`
            task.platform = 'tieba'
            task.resource_ids = Object.keys(taskResources)
            pools[task.reply_pool] = texts.map((text, index) => ({ id: `guoba_${slot}_${String(index + 1).padStart(2, '0')}`, weight: 1, enabled: true, text }))
            tasks.push(task)
          }
          config.tasks = [...tasks, ...config.tasks.slice(TASK_SLOTS)]
          config.reply.resources = resources
          config.reply.pools = pools

          for (const key of ['candidate_score', 'auto_reply_score']) if (data[key] != null) config.matching[key] = Number(data[key])
          if (data.strong_keywords != null) config.matching.strong = parseScoredKeywords(data.strong_keywords, '强关键词')
          if (data.auxiliary_keywords != null) config.matching.auxiliary = parseScoredKeywords(data.auxiliary_keywords, '辅助词')
          if (data.negative_keywords != null) config.matching.negative = parseNegativeKeywords(data.negative_keywords)
          if (data.exclude_keywords != null) config.matching.exclude = parseExcludeKeywords(data.exclude_keywords)
          for (const key of ['max_per_hour', 'max_per_day']) if (data[key] != null) config.limits[key] = Number(data[key])
          for (const key of ['min_delay_minutes', 'max_delay_minutes']) if (data[key] != null) config.queue[key] = Number(data[key])
          for (const task of config.tasks) validateTemplateResources((config.reply.pools[task.reply_pool] ?? []).map(item => item.text), config.reply.resources)
          for (const key of ['timeout_seconds', 'retries', 'retry_delay_seconds']) if (data[key] != null) config.network[key] = Number(data[key])
          if (data.proxy_url != null) config.network.proxy_url = String(data.proxy_url).trim()
          configStore.save(config)
          for (const id of previousAccountIds) if (!config.accounts.some(item => item.id === id)) authStore.deleteCookie(id)
          if (data.remove_cookie) authStore.deleteCookie(account.id)
          const saved = String(data.account_cookie ?? '').trim() ? authStore.setCookie(account.id, data.account_cookie) : null
          ;(globalThis.logger ?? console).mark?.(`[ThreadScout][锅巴配置] 已保存并同步到运行实例${saved ? `；账号 ${account.id} 的 Cookie 已提取 ${saved.count} 个字段并加密保存` : ''}`)
          return Result.ok({}, `ThreadScout 配置已保存${saved ? `；Cookie 已自动提取并保存 ${saved.count} 个必要字段` : ''}；复杂组合规则可继续在 config.yaml 中维护`)
        } catch (error) {
          return Result.error(`保存失败：${error.message}`)
        }
      }
    }
  }
}
