const RESOURCE_ID = /^[a-zA-Z0-9_-]{1,32}$/

const lines = value => String(value ?? '').split(/\r?\n/).map(line => line.trim()).filter(Boolean)

function number(value, label) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < -100 || parsed > 100) throw new Error(`${label}必须是 -100 到 100 之间的数字`)
  return parsed
}

export function parseScoredKeywords(value, label = '关键词') {
  return lines(value).map((line, index) => {
    const [text = '', title = '', body = '', ...extra] = line.split('|').map(item => item.trim())
    if (!text || !title || !body || extra.length) throw new Error(`${label}第 ${index + 1} 行格式应为：关键词 | 标题分 | 正文分`)
    return { text, title: number(title, `${label}第 ${index + 1} 行标题分`), body: number(body, `${label}第 ${index + 1} 行正文分`) }
  })
}

export function parseNegativeKeywords(value) {
  return lines(value).map((line, index) => {
    const [text = '', score = '', ...extra] = line.split('|').map(item => item.trim())
    if (!text || !score || extra.length) throw new Error(`负向词第 ${index + 1} 行格式应为：关键词 | 扣分`)
    const parsed = number(score, `负向词第 ${index + 1} 行扣分`)
    if (parsed > 0) throw new Error(`负向词第 ${index + 1} 行扣分不能大于 0`)
    return { text, score: parsed }
  })
}

export function parseExcludeKeywords(value) { return [...new Set(lines(value))] }

export function parseResources(value) {
  const resources = {}
  for (const [index, line] of lines(value).entries()) {
    const [id = '', type = '', ...contentParts] = line.split('|').map(item => item.trim())
    const content = contentParts.join('|').trim()
    if (!RESOURCE_ID.test(id)) throw new Error(`群资源第 ${index + 1} 行标识无效，只能使用字母、数字、下划线和短横线`)
    if (!type || !content) throw new Error(`群资源第 ${index + 1} 行格式应为：资源标识 | 类型 | 内容`)
    if (resources[id]) throw new Error(`群资源标识重复：${id}`)
    resources[id] = { type, value: content }
  }
  if (!Object.keys(resources).length) throw new Error('至少需要一个群资源')
  return resources
}

export function validateTemplateResources(templates, resources) {
  for (const [index, template] of templates.entries()) {
    for (const match of template.matchAll(/\{\{resource:([a-zA-Z0-9_-]+)\}\}/g)) {
      if (!resources[match[1]]) throw new Error(`回复模板第 ${index + 1} 行引用了不存在的资源：${match[1]}`)
    }
  }
}

export const formatScoredKeywords = values => (values ?? []).map(item => `${item.text} | ${item.title} | ${item.body}`).join('\n')
export const formatNegativeKeywords = values => (values ?? []).map(item => `${item.text} | ${item.score}`).join('\n')
export const formatResources = resources => Object.entries(resources ?? {}).map(([id, item]) => `${id} | ${item.type} | ${item.value}`).join('\n')
