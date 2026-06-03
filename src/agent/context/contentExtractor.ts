// ── Content Extractor ──
// Minimal utility functions for extracting structured info from file content.

/** Extract last N characters from text (for chapter tail, char-based not line-based) */
export function extractChapterTail(content: string, maxChars = 3000): string {
  if (!content || typeof content !== 'string') return ''
  if (content.length <= maxChars) return content
  return content.slice(content.length - maxChars)
}

/** Extract the first heading-level summary from markdown */
export function extractSummary(content: string, maxLen = 500): string {
  if (!content || typeof content !== 'string') return ''
  const lines = content.split('\n')
  const result: string[] = []
  for (const line of lines) {
    if (line.startsWith('#') && result.length > 0) break
    result.push(line)
    if (result.join('\n').length > maxLen) break
  }
  return result.join('\n').slice(0, maxLen)
}

/** Extract markdown structure: headings and first line after each. Respects maxLen. */
export function extractMarkdownStructure(content: string, maxLen?: number): string {
  if (!content || typeof content !== 'string') return ''
  const limit = maxLen || 4000
  const lines = content.split('\n')
  const result: string[] = []
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('#')) {
      result.push(lines[i])
      if (i + 1 < lines.length && lines[i + 1].trim()) {
        result.push('  ' + lines[i + 1].trim().slice(0, 120))
      }
    }
    if (result.join('\n').length > limit) break
  }
  return result.join('\n').slice(0, limit)
}
