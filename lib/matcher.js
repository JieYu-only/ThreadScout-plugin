function includes(text, word) { return text.toLocaleLowerCase().includes(String(word).toLocaleLowerCase()) }

export function matchThread(thread, rules) {
  const title = thread.title ?? ''
  const body = thread.body ?? ''
  const allText = `${title}\n${body}`
  const reasons = []
  const excludedBy = (rules.exclude ?? []).find(word => includes(allText, word))
  if (excludedBy) return { score: 0, decision: 'excluded', excludedBy, reasons }

  let score = 0
  for (const item of [...(rules.strong ?? []), ...(rules.auxiliary ?? [])]) {
    if (includes(title, item.text)) {
      score += Number(item.title ?? 0)
      reasons.push({ type: 'keyword', field: 'title', text: item.text, score: Number(item.title ?? 0) })
    } else if (includes(body, item.text)) {
      score += Number(item.body ?? 0)
      reasons.push({ type: 'keyword', field: 'body', text: item.text, score: Number(item.body ?? 0) })
    }
  }
  for (const item of rules.negative ?? []) {
    if (includes(allText, item.text)) {
      score += Number(item.score)
      reasons.push({ type: 'negative', text: item.text, score: Number(item.score) })
    }
  }
  for (const rule of rules.combinations ?? []) {
    if (rule.all.every(group => group.some(word => includes(allText, word)))) {
      score += Number(rule.bonus ?? 0)
      reasons.push({ type: 'combination', id: rule.id, score: Number(rule.bonus ?? 0) })
    }
  }
  const decision = score >= rules.auto_reply_score ? 'auto' : score >= rules.candidate_score ? 'candidate' : 'ignored'
  return { score, decision, excludedBy: null, reasons }
}
