import MarkdownIt from 'markdown-it'

type SimpleMarkdownRenderOptions = {
  emptyHtml?: string
  autoNestList?: boolean
}

const markdownRenderer = new MarkdownIt('commonmark', {
  html: false,
  linkify: true,
  typographer: false,
})

const defaultLinkOpenRule = markdownRenderer.renderer.rules.link_open
markdownRenderer.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  const href = token?.attrGet('href') || ''
  if (/^https?:\/\//i.test(href)) {
    token?.attrSet('target', '_blank')
    token?.attrSet('rel', 'noreferrer noopener')
  }

  if (defaultLinkOpenRule) {
    return defaultLinkOpenRule(tokens, idx, options, env, self)
  }
  return self.renderToken(tokens, idx, options)
}

function normalizeLeadingIndent(line: string): string {
  const match = line.match(/^([\t \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]*)(.*)$/u)
  if (!match) return line
  const leading = (match[1] || '').replace(/[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/gu, ' ')
  const body = (match[2] || '').replace(/^[•·●▪◦‣⁃]\s*/u, '- ')
  return `${leading}${body}`
}

function isFenceDelimiter(line: string): boolean {
  return /^[ \t]{0,3}(```+|~~~+)/.test(line)
}

function parseTopLevelListItem(line: string): { kind: 'ul' | 'ol'; content: string } | null {
  const unordered = line.match(/^[ \t]{0,3}[-*+]\s+(.+)$/)
  if (unordered) {
    return { kind: 'ul', content: unordered[1] || '' }
  }
  const ordered = line.match(/^[ \t]{0,3}\d{1,9}\.\s+(.+)$/)
  if (ordered) {
    return { kind: 'ol', content: ordered[1] || '' }
  }
  return null
}

function looksLikeGroupTitle(content: string): boolean {
  const text = content.trim()
  if (!text) return false
  if (/\[[^\]]+]\(https?:\/\/[^)\s]+\)/.test(text)) return true
  return false
}

function looksLikeGroupSubItem(content: string): boolean {
  const text = content.trim()
  if (!text) return false
  if (/^(摘要|要点|点评|锐评|结论|说明|来源|备注|时间|链接)\s*[:：]/.test(text)) return true
  if (/^「[^」]{1,20}」\s*(锐评|点评|评论)\s*[:：]/.test(text)) return true
  return false
}

function autoNestListLines(lines: string[]): { lines: string[]; changed: boolean } {
  const next = [...lines]
  let inFence = false
  let lastTitleEligible = false
  let changed = false

  for (let i = 0; i < next.length; i += 1) {
    const line = next[i] || ''
    if (isFenceDelimiter(line)) {
      inFence = !inFence
      lastTitleEligible = false
      continue
    }
    if (inFence) continue

    const parsed = parseTopLevelListItem(line)
    if (!parsed) continue

    if (looksLikeGroupSubItem(parsed.content)) {
      if (lastTitleEligible) {
        next[i] = `  ${line}`
        changed = true
      }
      continue
    }

    lastTitleEligible = looksLikeGroupTitle(parsed.content)
  }

  return { lines: next, changed }
}

function normalizeMarkdownInput(markdown: string, options: { autoNestList: boolean }): string {
  const rawLines = markdown.replace(/\r\n/g, '\n').split('\n')
  const normalizedLines: string[] = []
  let inFence = false

  for (const line of rawLines) {
    if (isFenceDelimiter(line)) {
      inFence = !inFence
      normalizedLines.push(line)
      continue
    }
    if (inFence) {
      normalizedLines.push(line)
      continue
    }
    normalizedLines.push(normalizeLeadingIndent(line))
  }

  if (!options.autoNestList) return normalizedLines.join('\n')

  const nested = autoNestListLines(normalizedLines)
  return (nested.changed ? nested.lines : normalizedLines).join('\n')
}

export function renderSimpleMarkdown(markdown: string, options: SimpleMarkdownRenderOptions = {}): string {
  const normalized = normalizeMarkdownInput(markdown || '', { autoNestList: options.autoNestList ?? false })
  if (!normalized.trim()) {
    return options.emptyHtml || ''
  }
  return markdownRenderer.render(normalized)
}
