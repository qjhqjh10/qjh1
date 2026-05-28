// ── Project Summary ──
// Generates a concise overview of the current writing project.
// Injected into the system prompt so the AI knows what exists without preloading everything.
// Follows "Map, Not Manual" — tells the AI where to find details, not the details themselves.

import { fileService } from '@/services/fileService'

/**
 * Generate a concise project summary for the system prompt.
 * Returns a tree-like overview of the project's current state.
 */
export async function buildProjectSummary(projectId: string): Promise<string> {
  const lines: string[] = []
  const warnings: string[] = []

  try {
    // Characters
    try {
      const charsDir = await fileService.listDir('characters')
      const jsonFiles = charsDir.filter(f => f.endsWith('.json'))
      if (jsonFiles.length > 0) {
        const names: string[] = []
        for (const f of jsonFiles.slice(0, 10)) {
          try {
            const content = await fileService.read(`characters/${f}`)
            const obj = JSON.parse(content)
            const role = obj.role ? `(${obj.role})` : ''
            names.push(`${obj.name || f.replace('.json', '')}${role}`)
          } catch {
            names.push(f.replace('.json', ''))
          }
        }
        lines.push(`角色 (${jsonFiles.length}): ${names.join(', ')}${jsonFiles.length > 10 ? '...' : ''}`)
      } else {
        lines.push('角色: 暂无')
      }
    } catch { lines.push('角色: 目录不存在') }

    // Outline
    try {
      const outlineDir = await fileService.listDir('outline')
      const mdFiles = outlineDir.filter(f => f.endsWith('.md'))
      const jsonFiles = outlineDir.filter(f => f.endsWith('.json'))
      const files = [...mdFiles, ...jsonFiles]
      if (files.length > 0) {
        lines.push(`大纲: ${files.join(', ')}`)
      } else {
        lines.push('大纲: 暂无')
      }
    } catch { lines.push('大纲: 目录不存在') }

    // Detailed outline with progress
    let detailedOutlineCount = 0
    let completedCount = 0
    try {
      const doDir = await fileService.listDir('detailed_outline')
      const jsonFiles = doDir.filter(f => f.endsWith('.json'))
      detailedOutlineCount = jsonFiles.length
      if (jsonFiles.length > 0) {
        const summaries: string[] = []
        for (const f of jsonFiles.slice(0, 15)) {
          try {
            const content = await fileService.read(`detailed_outline/${f}`)
            const obj = JSON.parse(content)
            const status = obj.status === 'completed' ? '✓' : '○'
            if (obj.status === 'completed') completedCount++
            summaries.push(`${status} ${obj.title || f.replace('.json', '')}`)
          } catch {
            summaries.push(f.replace('.json', ''))
          }
        }
        lines.push(`细纲 (${completedCount}/${jsonFiles.length} 完成): ${summaries.join(', ')}${jsonFiles.length > 15 ? '...' : ''}`)
      } else {
        lines.push('细纲: 暂无')
      }
    } catch { lines.push('细纲: 目录不存在') }

    // Chapters with word count
    let totalWords = 0
    try {
      const chDir = await fileService.listDir('chapters')
      const txtFiles = chDir.filter(f => f.endsWith('.txt'))
      if (txtFiles.length > 0) {
        const chapterInfos: string[] = []
        for (const f of txtFiles.slice(0, 15)) {
          try {
            const content = await fileService.read(`chapters/${f}`)
            const words = content.replace(/\s/g, '').length
            totalWords += words
            chapterInfos.push(`${f.replace('.txt', '')} (${words.toLocaleString()}字)`)
          } catch {
            chapterInfos.push(f.replace('.txt', ''))
          }
        }
        lines.push(`章节 (${txtFiles.length}, 总字数 ${totalWords.toLocaleString()}): ${chapterInfos.join(', ')}${txtFiles.length > 15 ? '...' : ''}`)
      } else {
        lines.push('章节: 暂无')
      }
    } catch { lines.push('章节: 目录不存在') }

    // Knowledge base
    try {
      const kbResult = await fileService.listDir('knowledge_base')
      const kbFiles = kbResult.filter(f => !f.startsWith('.'))
      lines.push(`知识库: ${kbFiles.length > 0 ? kbFiles.length + '个文件' : '暂无'}`)
    } catch { /* no KB */ }

    // Consistency checks
    if (detailedOutlineCount > 0) {
      try {
        const chDir = await fileService.listDir('chapters')
        const chapterCount = chDir.filter(f => f.endsWith('.txt')).length
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
