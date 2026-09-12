const unresolved = /\{\{[^}]+\}\}/

export function renderTemplate(template, resources = {}) {
  const text = template.replace(/\{\{resource:([^}]+)\}\}/g, (_, key) => resources[key]?.value ?? `{{resource:${key}}}`)
  if (!text.trim()) throw new Error('模板渲染结果为空')
  if (unresolved.test(text)) throw new Error('模板包含未解析变量')
  if (text.length > 500) throw new Error('模板渲染结果过长')
  return text
}

export function selectTemplate(templates, recentIds = [], random = Math.random) {
  const enabled = templates.filter(item => item.enabled !== false && Number(item.weight ?? 1) > 0)
  if (!enabled.length) throw new Error('回复池没有可用模板')
  const fresh = enabled.filter(item => !recentIds.includes(item.id))
  const candidates = fresh.length ? fresh : enabled
  const total = candidates.reduce((sum, item) => sum + Number(item.weight ?? 1), 0)
  let cursor = random() * total
  for (const item of candidates) {
    cursor -= Number(item.weight ?? 1)
    if (cursor < 0) return item
  }
  return candidates.at(-1)
}
