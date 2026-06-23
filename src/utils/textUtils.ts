const stripHtmlRegex = /<[^>]*>/g

// Shared chapter splitting patterns and logic (used by extractionService & StyleWorkshopPage)
// v13.3.0: 修复章节正则 — 支持全角冒号/中点/短线等分隔符，支持第X节/第X回/第X集
export const CHAPTER_PATTERNS: { regex: RegExp; type: string }[] = [
  { regex: /^楔子\s*$/, type: 'prologue' }, { regex: /^序章\s*$/, type: 'prologue' },
  { regex: /^引子\s*$/, type: 'prologue' }, { regex: /^前言\s*$/, type: 'prologue' },
  { regex: /^终章\s*$/, type: 'epilogue' }, { regex: /^尾声\s*$/, type: 'epilogue' },
  { regex: /^后记\s*$/, type: 'afterword' },
  // 番外：支持 "番外一 标题" 格式，分隔符不限空格/冒号
  { regex: /^番外[一二三四五六七八九十百千零\d]+[\s：:\-—·]?.{0,40}$/, type: 'sideStory' },
  // 第X章/卷/节/回/集：支持 "第一章" "第一章：开篇" "第一章-序" "第 一 章" 等
  // 关键保护：必须包含 [章卷节回集] 之一，防止匹配 "第一次" "第二天" 等内容文本
  { regex: /^第\s*[一二三四五六七八九十百千零\d]+\s*[章卷节回集][\s：:\-—·]?.{0,40}$/, type: 'chapter' },
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
    if (line.length > 60) continue
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

/** 将 HTML 转为保留段落结构的纯文本（<p>/<br> → 换行，其余标签删除） */
export function htmlToPlainText(html: string): string {
  if (!html) return ''
  return html
    // 先剥离 script/style 标签及其内容，防止代码泄露到输出
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    // 块级元素 → 换行
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<p[^>]*>/gi, '')
    .replace(/<\/div>/gi, '\n')
    .replace(/<div[^>]*>/gi, '')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<h[1-6][^>]*>/gi, '')
    // 删除剩余 HTML 标签
    .replace(stripHtmlRegex, '')
    // 解码数值字符引用 &#XXXX; 和 &#xXXXX;
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    // 解码命名实体
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '…')
    .replace(/&lsquo;/g, '‘')
    .replace(/&rsquo;/g, '’')
    .replace(/&ldquo;/g, '“')
    .replace(/&rdquo;/g, '”')
    // 折叠多余换行
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Count all non-whitespace characters (Chinese convention: each character = 1 word)
export function countChineseWords(text: string): number {
  if (!text) return 0
  // Strip HTML and decode entities before counting
  const clean = stripHtml(text).replace(/\s/g, '')
  return clean.length
}

/** Count CJK unified ideographs only (U+4E00–U+9FFF) — excludes punctuation, ASCII, whitespace */
export function countCJKChars(text: string): number {
  let count = 0
  for (const char of text) {
    const code = char.charCodeAt(0)
    if (code >= 0x4e00 && code <= 0x9fff) count++
  }
  return count
}

const AI_ERROR_PREFIXES = ['[CONTENT_POLICY]', '[RATE_LIMIT]', '[AUTH_ERROR]', '[NETWORK]', '[API_ERROR]', '[UNSUPPORTED_OPERATION]']

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
