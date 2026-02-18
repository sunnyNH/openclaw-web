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

// commonmark 预设默认不启用 GFM 表格；聊天里经常需要展示“|---|”表格
markdownRenderer.enable('table')

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

function splitTableCells(line: string): string[] {
  const trimmedStart = line.trimStart()
  const trimmedEnd = line.trimEnd()
  const raw = line.split('|')
  let start = 0
  let end = raw.length

  if (trimmedStart.startsWith('|')) start += 1
  if (trimmedEnd.endsWith('|')) end -= 1

  return raw.slice(start, end).map((cell) => cell.trim())
}

function parseTableSeparatorLine(line: string): { colCount: number } | null {
  const cells = splitTableCells(line)
  if (cells.length < 2) return null
  for (const cell of cells) {
    if (!/^:?-{3,}:?$/.test(cell)) return null
  }
  return { colCount: cells.length }
}

function normalizeGfmTableBlocks(lines: string[]): string[] {
  let hasSeparator = false
  let inFence = false
  for (const line of lines) {
    if (isFenceDelimiter(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    if (/\|\s*:?-{3,}:?\s*\|/.test(line)) {
      hasSeparator = true
      break
    }
  }
  if (!hasSeparator) return lines

  // 常见坏格式：把多行表格“压扁”成一行（`| a | b | |---|---| | 1 | 2 |`）
  // 再加上前面带标题文本，会导致 markdown-it 识别不到 table。
  const expanded: string[] = []
  inFence = false

  for (const line of lines) {
    if (isFenceDelimiter(line)) {
      inFence = !inFence
      expanded.push(line)
      continue
    }
    if (inFence) {
      expanded.push(line)
      continue
    }

    // 仅在出现表格分隔符时尝试修复，避免误伤普通文本中的 `|`。
    if (/\|\s*:?-{3,}:?\s*\|/.test(line) && /\|\s+\|/.test(line)) {
      expanded.push(...line.replace(/\|\s+\|/g, '|\n|').split('\n'))
      continue
    }

    expanded.push(line)
  }

  const repaired: string[] = []
  inFence = false
  for (const line of expanded) {
    if (isFenceDelimiter(line)) {
      inFence = !inFence
      repaired.push(line)
      continue
    }
    if (inFence) {
      repaired.push(line)
      continue
    }

    const separator = parseTableSeparatorLine(line)
    if (separator && repaired.length > 0) {
      const headerLine = repaired[repaired.length - 1] || ''
      const headerCells = splitTableCells(headerLine)

      // 典型场景：
      // "5) 已有 Skills ... | Skill | 什么时候用 | 核心要点/约束 |"
      // "|---|---|---|"
      // 头部多出 1 列，导致 table 不被识别。这里把第一列提出来当标题行。
      if (headerCells.length === separator.colCount + 1) {
        const title = headerCells[0]?.trim() || ''
        const cells = headerCells.slice(1)
        repaired.pop()
        if (title) repaired.push(title)
        repaired.push(`| ${cells.join(' | ')} |`)
      }
    }

    repaired.push(line)
  }

  return repaired
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

function normalizeGroupingText(content: string): string {
  // 容忍常见 markdown 包裹（如 **摘要：**），避免分组识别被装饰符影响
  return content
    .trim()
    .replace(/[*_`~]/g, '')
}

function looksLikeGroupTitle(content: string): boolean {
  const text = normalizeGroupingText(content)
  if (!text) return false
  if (/\[[^\]]+]\(https?:\/\/[^)\s]+\)/.test(text)) return true
  return false
}

function looksLikeGroupSubItem(content: string): boolean {
  const text = normalizeGroupingText(content)
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

  let lines = normalizedLines
  if (options.autoNestList) {
    const nested = autoNestListLines(normalizedLines)
    lines = nested.changed ? nested.lines : normalizedLines
  }

  return normalizeGfmTableBlocks(lines).join('\n')
}

export function renderSimpleMarkdown(markdown: string, options: SimpleMarkdownRenderOptions = {}): string {
  const normalized = normalizeMarkdownInput(markdown || '', { autoNestList: options.autoNestList ?? false })
  if (!normalized.trim()) {
    return options.emptyHtml || ''
  }
  return markdownRenderer.render(normalized)
}
