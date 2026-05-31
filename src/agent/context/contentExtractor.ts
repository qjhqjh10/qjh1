// ── Content Extractor ──
// Minimal utility functions for extracting structured info from file content.

/** Extract last N lines from text (for chapter tail) */
export function extractChapterTail(content: string, lines = 10): string {
  const allLines = content.split('\n')
  return allLines.slice(-lines).join('\n')
}

/** Extract the first heading-level summary from markdown */
export function extractSummary(content: string, maxLen = 500): string {
  const lines = content.split('\n')
  const result: string[] = []
  for (const line of lines) {
    if (line.startsWith('#') && result.length > 0) break
    result.push(line)
    if (result.join('\n').length > maxLen) break
  }
  return result.join('\n').slice(0, maxLen)
}

/** Extract markdown structure: headings and first line after each */
export function extractMarkdownStructure(content: string, _maxLen?: number): string {
  const lines = content.split('\n')
  const result: string[] = []
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('#')) {
      result.push(lines[i])
      if (i + 1 < lines.length && lines[i + 1].trim()) {
        result.push('  ' + lines[i + 1].trim().slice(0, 120))
      }
    }
  }
  return result.join('\n')
}
