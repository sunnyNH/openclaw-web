function normalizeDateInput(date: string | number | Date): Date | null {
  if (date instanceof Date) {
    return Number.isFinite(date.getTime()) ? date : null
  }

  if (typeof date === 'number') {
    const maybeMs = Math.abs(date) < 1_000_000_000_000 ? date * 1000 : date
    const parsed = new Date(maybeMs)
    return Number.isFinite(parsed.getTime()) ? parsed : null
  }

  const raw = date.trim()
  if (!raw) return null

  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    const numeric = Number(raw)
    if (Number.isFinite(numeric)) {
      const maybeMs = Math.abs(numeric) < 1_000_000_000_000 ? numeric * 1000 : numeric
      const parsed = new Date(maybeMs)
      if (Number.isFinite(parsed.getTime())) return parsed
    }
  }

  const parsed = new Date(raw)
  return Number.isFinite(parsed.getTime()) ? parsed : null
}

export function formatDate(date: string | number | Date): string {
  const parsed = normalizeDateInput(date)
  if (!parsed) {
    return typeof date === 'string' && date.trim() ? date : '-'
  }

  return parsed.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function formatRelativeTime(date: string | number | Date): string {
  const parsed = normalizeDateInput(date)
  if (!parsed) {
    return typeof date === 'string' && date.trim() ? date : '-'
  }

  const now = Date.now()
  const diff = now - parsed.getTime()

  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`
  if (diff < 2592000000) return `${Math.floor(diff / 86400000)} 天前`
  return formatDate(date)
}

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str
  return str.slice(0, maxLength - 3) + '...'
}

export function parseSessionKey(key: string): { agent: string; channel: string; peer: string } {
  const parts = key.split(':')
  return {
    agent: parts[1] || 'main',
    channel: parts[2] || 'unknown',
    peer: parts.slice(3).join(':') || '',
  }
}

export function downloadJSON(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
