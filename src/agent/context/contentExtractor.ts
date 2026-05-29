// ── Smart content extraction utilities ──
// Instead of naive truncation, extract the structure and key information from files.

/**
 * Extract Markdown structure: headers + first line of each section.
 * Preserves the document's logical structure within a token budget.
 */
export function extractMarkdownStructure(content: string, maxTokens: number): string {
  const lines = content.split('\n')
  const result: string[] = []
  let tokens = 0
  let inSection = false
  let sectionLines = 0

  for (const line of lines) {
    const lineTokens = Math.ceil(line.length / 3)
    if (tokens + lineTokens > maxTokens) break

    // Header line: always include
    if (/^#{1,4}\s/.test(line)) {
      result.push(line)
      tokens += lineTokens
      inSection = true
      sectionLines = 0
      continue
    }

    // First 2 lines after a header: include (these are usually the key content)
    if (inSection && sectionLines < 2 && line.trim()) {
      result.push(line)
      tokens += lineTokens
      sectionLines++
      continue
    }

    // Blank lines between sections: preserve
    if (!line.trim() && inSection) {
      result.push('')
      continue
    }

    // Skip remaining lines in a section (they'll be available via read_file)
    inSection = false
  }

  if (result.length < lines.length) {
    result.push('\n...(结构摘要，完整内容用 read_file 查看)')
  }

  return result.join('\n')
}

/**
 * Extract the tail of a chapter at paragraph boundaries.
 * Finds the last N complete paragraphs within the token budget.
 */
export function extractChapterTail(content: string, maxTokens: number): string {
  // Split by double newline (paragraph boundary)
  const paragraphs = content.split(/\n{2,}/).filter(p => p.trim())
  if (paragraphs.length === 0) return content

  const result: string[] = []
  let tokens = 0

  // Walk backwards from the last paragraph
  for (let i = paragraphs.length - 1; i >= 0; i--) {
    const para = paragraphs[i]
    const paraTokens = Math.ceil(para.length / 3)
    if (tokens + paraTokens > maxTokens && result.length > 0) break
    result.unshift(para)
    tokens += paraTokens
  }

  if (result.length < paragraphs.length) {
    result.unshift('...(前文省略)...')
  }

  return result.join('\n\n')
}

/**
 * Extract summary content, truncating at sentence boundaries.
 */
export function extractSummary(content: string, maxTokens: number): string {
  if (!content || !content.trim()) return ''
  const tokens = Math.ceil(content.length / 3)
  if (tokens <= maxTokens) return content

  // Truncate at sentence boundary (。！？.!?)
  const limit = maxTokens * 3
  const truncated = content.slice(0, limit)
  const lastSentence = Math.max(truncated.lastIndexOf('。'), truncated.lastIndexOf('！'), truncated.lastIndexOf('？'), truncated.lastIndexOf('.'), truncated.lastIndexOf('!'), truncated.lastIndexOf('?'))

  if (lastSentence > limit * 0.5) {
    return truncated.slice(0, lastSentence + 1) + '\n...(摘要截断)'
  }
  return truncated + '...\n...(摘要截断)'
}
