const stripHtmlRegex = /<[^>]*>/g

// Shared chapter splitting patterns and logic (used by extractionService & StyleWorkshopPage)
export const CHAPTER_PATTERNS: { regex: RegExp; type: string }[] = [
  { regex: /^楔子\s*$/, type: 'prologue' }, { regex: /^序章\s*$/, type: 'prologue' },
  { regex: /^引子\s*$/, type: 'prologue' }, { regex: /^前言\s*$/, type: 'prologue' },
  { regex: /^终章\s*$/, type: 'epilogue' }, { regex: /^尾声\s*$/, type: 'epilogue' },
  { regex: /^后记\s*$/, type: 'afterword' }, { regex: /^番外[一二三四五六七八九十百千零\d]+\s*$/, type: 'sideStory' },
  { regex: /^第[一二三四五六七八九十百千零\d]+[章卷节回](\s+.{1,40})?$/, type: 'chapter' },
]

export interface ChapterSplitResult {
  title: string
  content: string
  chapterNumber: number
  chapterType: string
}

export function splitChaptersByHeadings(content: string): ChapterSplitResult[] {
  const lines = content.split('\n')
  const headings: { title: string; startLine: number; type: string }[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    if (line.length > 40) continue
    for (const pat of CHAPTER_PATTERNS) {
      if (pat.regex.test(line)) { headings.push({ title: line, startLine: i, type: pat.type }); break }
    }
  }
  const result: ChapterSplitResult[] = []
  let chapterNum = 0
  for (let c = 0; c < headings.length; c++) {
    const start = headings[c].startLine
    const end = c < headings.length - 1 ? headings[c + 1].startLine : lines.length
    const body = lines.slice(start, end).join('\n').trim()
    if (body.length < 10) continue
    chapterNum++
    result.push({ title: headings[c].title, content: body, chapterNumber: chapterNum, chapterType: headings[c].type })
  }
  if (result.length === 0 && content.trim().length > 0) {
    result.push({ title: '全文', content: content.trim(), chapterNumber: 1, chapterType: 'chapter' })
  }
  return result
}

export function stripHtml(html: string): string {
  if (!html) return ''
  return html.replace(stripHtmlRegex, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
}

// Count all non-whitespace characters (Chinese convention: each character = 1 word)
export function countChineseWords(text: string): number {
  if (!text) return 0
  // Strip HTML tags before counting to avoid counting markup
  const clean = text.replace(stripHtmlRegex, '').replace(/\s/g, '')
  return clean.length
}

const AI_ERROR_PREFIXES = ['[CONTENT_POLICY]', '[RATE_LIMIT]', '[AUTH_ERROR]', '[NETWORK]', '[API_ERROR]']

export function parseAiErrorMessage(err: unknown, fallback?: string): string {
  const msg = err instanceof Error ? err.message : (fallback || '请求失败')
  for (const prefix of AI_ERROR_PREFIXES) {
    if (msg.startsWith(prefix)) return msg.slice(prefix.length).replace(/^[\s:：]+/, '') || prefix
  }
  return msg
}

export function formatWordCount(count: number): string {
  if (count >= 10000) {
    return `${(count / 10000).toFixed(1)}万`
  }
  return count.toLocaleString()
}
