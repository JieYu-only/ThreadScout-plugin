import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ConfigStore } from './lib/config.js'
import { AuthStore } from './lib/auth-store.js'

const root = path.dirname(fileURLToPath(import.meta.url))
const configStore = new ConfigStore(root)
const authStore = new AuthStore(root)

const firstTask = config => config.tasks[0]
const firstAccount = config => config.accounts[0]

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
        { component: 'Divider', label: '贴吧任务' },
        { field: 'task_enabled', label: '启用首个任务', component: 'Switch' },
        { field: 'forum', label: '贴吧名称', component: 'Input', required: true, componentProps: { placeholder: '例如：逃离塔科夫' } },
        { field: 'interval_minutes', label: '扫描间隔（分钟）', component: 'InputNumber', componentProps: { min: 1, max: 1440 } },
        { field: 'latest_threads', label: '每次最多主题数', component: 'InputNumber', componentProps: { min: 1, max: 500 } },
        { field: 'pages', label: '最大页数', component: 'InputNumber', componentProps: { min: 1, max: 10 } },
        { field: 'max_age_minutes', label: '帖子最大时效（分钟）', component: 'InputNumber', componentProps: { min: 1, max: 10080 } },
        { component: 'Divider', label: '评分与安全限制' },
        { field: 'candidate_score', label: '候选阈值', component: 'InputNumber', componentProps: { min: -100, max: 100 } },
        { field: 'auto_reply_score', label: '自动回复阈值', component: 'InputNumber', componentProps: { min: -100, max: 100 } },
        { field: 'max_per_hour', label: '每小时回复上限', component: 'InputNumber', componentProps: { min: 1, max: 100 } },
        { field: 'max_per_day', label: '每日回复上限', component: 'InputNumber', componentProps: { min: 1, max: 1000 } },
        { field: 'min_delay_minutes', label: '最小延迟（分钟）', component: 'InputNumber', componentProps: { min: 0, max: 1440 } },
        { field: 'max_delay_minutes', label: '最大延迟（分钟）', component: 'InputNumber', componentProps: { min: 0, max: 1440 } },
        { component: 'Divider', label: '回复内容' },
        { field: 'group_value', label: '群号/资源内容', component: 'Input', required: true, componentProps: { placeholder: '填写实际群号' } },
        { field: 'templates', label: '回复模板', component: 'InputTextArea', bottomHelpMessage: '每行一条；使用 {{resource:tarkov_main}} 引用上方群号', componentProps: { rows: 6 } },
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
        const task = firstTask(config)
        const account = firstAccount(config)
        const pool = config.reply.pools[task.reply_pool] ?? []
        const auth = authStore.status(account)
        return {
          enabled: config.enabled,
          mode: config.mode,
          task_enabled: task.enabled,
          forum: task.forum,
          interval_minutes: task.scan.interval_minutes,
          latest_threads: task.scan.latest_threads,
          pages: task.scan.pages,
          max_age_minutes: task.scan.max_age_minutes,
          candidate_score: config.matching.candidate_score,
          auto_reply_score: config.matching.auto_reply_score,
          max_per_hour: config.limits.max_per_hour,
          max_per_day: config.limits.max_per_day,
          min_delay_minutes: config.queue.min_delay_minutes,
          max_delay_minutes: config.queue.max_delay_minutes,
          group_value: config.reply.resources.tarkov_main?.value ?? '',
          templates: pool.map(item => item.text).join('\n'),
          accounts_text: config.accounts.map(item => `${item.id} | ${item.name} | ${item.enabled} | ${item.cookie_env ?? ''}`).join('\n'),
          account_id: account.id,
          account_status: `${account.name}：${auth.bound ? `已绑定（${auth.source}）` : '未绑定'}`,
          account_cookie: '',
          remove_cookie: false,
          timeout_seconds: config.network.timeout_seconds,
          retries: config.network.retries,
          retry_delay_seconds: config.network.retry_delay_seconds,
          proxy_url: config.network.proxy_url
        }
      },
      setConfigData(data, { Result }) {
        try {
          const config = structuredClone(configStore.load())
          const previousAccountIds = new Set(config.accounts.map(item => item.id))
          const task = firstTask(config)
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
          if (data.task_enabled != null) task.enabled = Boolean(data.task_enabled)
          if (data.forum != null) task.forum = String(data.forum).trim()
          for (const key of ['interval_minutes', 'latest_threads', 'pages', 'max_age_minutes']) if (data[key] != null) task.scan[key] = Number(data[key])
          for (const key of ['candidate_score', 'auto_reply_score']) if (data[key] != null) config.matching[key] = Number(data[key])
          for (const key of ['max_per_hour', 'max_per_day']) if (data[key] != null) config.limits[key] = Number(data[key])
          for (const key of ['min_delay_minutes', 'max_delay_minutes']) if (data[key] != null) config.queue[key] = Number(data[key])
          if (data.group_value != null) config.reply.resources.tarkov_main.value = String(data.group_value).trim()
          if (data.templates != null) {
            const texts = String(data.templates).split(/\r?\n/).map(value => value.trim()).filter(Boolean)
            if (!texts.length) throw new Error('至少需要一条回复模板')
            config.reply.pools[task.reply_pool] = texts.map((text, index) => ({ id: `guoba_${String(index + 1).padStart(2, '0')}`, weight: 1, enabled: true, text }))
          }
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
