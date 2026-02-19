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

function normalizeGroupingText(content: string): string {
  // 容忍常见 markdown 包裹（如 **摘要：**），避免分组识别被装饰符影响
  return content
    .trim()
    .replace(/[*_`~]/g, '')
}

function looksLikeGroupTitle(content: string): boolean {
  const text = normalizeGroupingText(content)
  if (!text) return false
  const hasMarkdownLink = /\[[^\]]+]\(https?:\/\/[^)\s]+\)/.test(text)
  // 明显的“详情行”特征：带冒号、以句号/问号/感叹号收尾、或动作动词开头
  if (/[：:]/.test(text)) return false
  if (/[。！？!?]\s*$/.test(text)) return false
  if (!hasMarkdownLink && /https?:\/\//i.test(text)) return false
  if (/^(支持|新增|增加|修复|修正|优化|调整|移除|删除|合并|拆分|更新|改进|减少|提供|暴露|规范化)/u.test(text)) return false
  if (text.length > 60) return false

  // 强特征：链接、分隔符/括号、或常见“章节标题”尾缀
  if (hasMarkdownLink) return true
  if (/[\/]/.test(text)) return true
  if (/[()（）]/.test(text)) return true
  if (/(Changes|Fixes)\b/.test(text)) return true
  if (/(支持|增强|能力|改进|修复)\s*$/u.test(text)) return true

  // 弱特征兜底：短文本且不像一句完整描述
  if (text.length <= 20 && /[\p{Script=Han}]/u.test(text)) return true
  if (text.length <= 24 && /^[A-Za-z][A-Za-z0-9 ._-]*$/.test(text)) return true

  return false
}

function looksLikeGroupSubItem(content: string): boolean {
  const text = normalizeGroupingText(content)
  if (!text) return false
  if (/^(摘要|要点|点评|锐评|结论|说明|来源|备注|时间|链接)\s*[:：]/.test(text)) return true
  if (/^「[^」]{1,20}」\s*(锐评|点评|评论)\s*[:：]/.test(text)) return true
  return false
}

function looksLikeStrongGroupTitle(content: string): boolean {
  const text = normalizeGroupingText(content)
  if (!text) return false
  const hasMarkdownLink = /\[[^\]]+]\(https?:\/\/[^)\s]+\)/.test(text)
  if (/[：:]/.test(text)) return false
  if (/[。！？!?]\s*$/.test(text)) return false
  if (!hasMarkdownLink && /https?:\/\//i.test(text)) return false
  if (/^(支持|新增|增加|修复|修正|优化|调整|移除|删除|合并|拆分|更新|改进|减少|提供|暴露|规范化)/u.test(text)) return false
  if (text.length > 60) return false
  if (hasMarkdownLink) return true
  if (/[\/]/.test(text)) return true
  if (/[()（）]/.test(text)) return true
  if (/(Changes|Fixes)\b/.test(text)) return true
  if (/(支持|增强|能力|改进|修复)\s*$/u.test(text)) return true
  return false
}

function autoNestListLines(lines: string[]): { lines: string[]; changed: boolean } {
  const next = [...lines]
  let inFence = false
  let changed = false

  type ListItem = {
    index: number
    indent: number
    content: string
    isTitle: boolean
    isStrongTitle: boolean
  }

  const readIndentWidth = (prefix: string) => prefix.replace(/\t/g, '    ').length
  const parseListItem = (line: string): { indent: number; content: string } | null => {
    const unordered = line.match(/^([ \t]*)([-*+])\s+(.+)$/)
    if (unordered) return { indent: readIndentWidth(unordered[1] || ''), content: unordered[3] || '' }
    const ordered = line.match(/^([ \t]*)(\d{1,9}\.)\s+(.+)$/)
    if (ordered) return { indent: readIndentWidth(ordered[1] || ''), content: ordered[3] || '' }
    return null
  }

  let segment: ListItem[] = []

  const flushSegment = () => {
    if (segment.length === 0) return

    const baseIndent = Math.min(...segment.map((item) => item.indent))
    const baseItems = segment.filter((item) => item.indent === baseIndent)
    const titleCount = baseItems.reduce((acc, item) => acc + (item.isTitle ? 1 : 0), 0)
    const firstTitle = baseItems.find((item) => item.isTitle)
    const canGroupAll =
      titleCount >= 2 ||
      (titleCount === 1 && firstTitle?.isStrongTitle)

    let inGroup = false
    for (const item of baseItems) {
      if (item.isTitle) {
        inGroup = true
        continue
      }
      if (!inGroup) continue

      const shouldIndent = canGroupAll || looksLikeGroupSubItem(item.content)
      if (!shouldIndent) continue

      next[item.index] = `  ${next[item.index]}`
      changed = true
    }

    segment = []
  }

  for (let i = 0; i < next.length; i += 1) {
    const line = next[i] || ''

    if (isFenceDelimiter(line)) {
      flushSegment()
      inFence = !inFence
      continue
    }
    if (inFence) continue

    const parsed = parseListItem(line)
    if (!parsed) {
      if (line.trim()) flushSegment()
      continue
    }

    segment.push({
      index: i,
      indent: parsed.indent,
      content: parsed.content,
      isTitle: looksLikeGroupTitle(parsed.content),
      isStrongTitle: looksLikeStrongGroupTitle(parsed.content),
    })
  }

  flushSegment()

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
