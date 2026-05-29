// ── Project Summary ──
// Generates a concise overview of the current writing project.
// Injected into the system prompt so the AI knows what exists without preloading everything.
// Follows "Map, Not Manual" — tells the AI where to find details, not the details themselves.
//
// PERFORMANCE: Only uses listDir (6 calls), never reads file contents.
// The AI can read specific files via read_file tool when needed.

import { fileService } from '@/services/fileService'

/**
 * Generate a concise project summary for the system prompt.
 * Only lists directory entries — does NOT read file contents.
 * Paths are relative to the project directory (e.g., "1/characters").
 */
export async function buildProjectSummary(projectId: string): Promise<string> {
  const lines: string[] = []
  const warnings: string[] = []
  const p = projectId // path prefix: "1" or "my-novel"

  try {
    // Characters — just list filenames
    try {
      const charsDir = await fileService.listDir(`${p}/characters`)
      const jsonFiles = charsDir.filter((f: string) => f.endsWith('.json'))
      if (jsonFiles.length > 0) {
        const names = jsonFiles.slice(0, 20).map((f: string) => f.replace('.json', ''))
        lines.push(`角色 (${jsonFiles.length}): ${names.join(', ')}${jsonFiles.length > 20 ? '...' : ''}`)
      } else {
        lines.push('角色: 暂无')
      }
    } catch { lines.push('角色: 目录不存在') }

    // Outline — just list filenames
    try {
      const outlineDir = await fileService.listDir(`${p}/outline`)
      const files = outlineDir.filter((f: string) => f.endsWith('.md') || f.endsWith('.json'))
      if (files.length > 0) {
        lines.push(`大纲: ${files.join(', ')}`)
      } else {
        lines.push('大纲: 暂无')
      }
    } catch { lines.push('大纲: 目录不存在') }

    // Detailed outline — just list filenames
    let detailedOutlineCount = 0
    try {
      const doDir = await fileService.listDir(`${p}/detailed_outline`)
      const jsonFiles = doDir.filter((f: string) => f.endsWith('.json'))
      detailedOutlineCount = jsonFiles.length
      if (jsonFiles.length > 0) {
        const names = jsonFiles.slice(0, 20).map((f: string) => f.replace('.json', ''))
        lines.push(`细纲 (${jsonFiles.length}): ${names.join(', ')}${jsonFiles.length > 20 ? '...' : ''}`)
      } else {
        lines.push('细纲: 暂无')
      }
    } catch { lines.push('细纲: 目录不存在') }

    // Chapters — just list filenames
    try {
      const chDir = await fileService.listDir(`${p}/chapters`)
      const txtFiles = chDir.filter((f: string) => f.endsWith('.txt'))
      if (txtFiles.length > 0) {
        const names = txtFiles.slice(0, 20).map((f: string) => f.replace('.txt', ''))
        lines.push(`章节 (${txtFiles.length}): ${names.join(', ')}${txtFiles.length > 20 ? '...' : ''}`)
      } else {
        lines.push('章节: 暂无')
      }
    } catch { lines.push('章节: 目录不存在') }

    // Summaries — just list filenames
    try {
      const sumDir = await fileService.listDir(`${p}/summaries`)
      const mdFiles = sumDir.filter((f: string) => f.endsWith('.md'))
      if (mdFiles.length > 0) {
        lines.push(`摘要 (${mdFiles.length}): ${mdFiles.map((f: string) => f.replace('.md', '')).join(', ')}`)
      }
    } catch { /* no summaries dir */ }

    // Knowledge base — just count
    try {
      const kbResult = await fileService.listDir(`${p}/knowledge_base`)
      const kbFiles = kbResult.filter((f: string) => !f.startsWith('.'))
      lines.push(`知识库: ${kbFiles.length > 0 ? kbFiles.length + '个文件' : '暂无'}`)
    } catch { /* no KB */ }

    // Consistency check — count only
    if (detailedOutlineCount > 0) {
      try {
        const chDir = await fileService.listDir(`${p}/chapters`)
        const chapterCount = chDir.filter((f: string) => f.endsWith('.txt')).length
        if (chapterCount > 0 && detailedOutlineCount !== chapterCount) {
          warnings.push(`细纲 ${detailedOutlineCount} 个 vs 章节 ${chapterCount} 个，数量不匹配`)
        }
      } catch { /* */ }
    }

  } catch { /* best effort */ }

  let result = lines.join('\n')
  if (warnings.length > 0) {
    result += '\n⚠️ ' + warnings.join('; ')
  }
  return result
}
