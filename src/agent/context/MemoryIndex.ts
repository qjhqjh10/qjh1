/**
 * Memory Index (V2-2, hotfix: cached + parallel I/O)
 *
 * Inspired by Claude Code's MEMORY.md pattern: instead of injecting full
 * file contents into the context, inject one-line summaries as pointers.
 * The AI reads files on-demand via tools.
 *
 * Cached with 120s TTL to avoid repeated IPC calls on every message.
 * All file scans run in parallel (Promise.all) — 6 IPC calls → 1 round trip.
 */

// Module-level cache to survive across messages in the same session
let _cachedIndex: { projectId: string; index: string; timestamp: number } | null = null
const INDEX_CACHE_TTL = 120_000  // 2 minutes

/**
 * Build a compact project file index suitable for LLM context.
 * Returns cached result if available and fresh.
 */
export async function buildMemoryIndex(projectId: string): Promise<string> {
  if (!projectId) return ''

  // Return cached if fresh
  if (_cachedIndex && _cachedIndex.projectId === projectId &&
      Date.now() - _cachedIndex.timestamp < INDEX_CACHE_TTL) {
    return _cachedIndex.index
  }

  try {
    const { fileService, styleTemplateService } = await import('@/services/fileService')

    // Run all scans in parallel — single IPC round trip instead of 6 sequential
    const [chapterFiles, charFiles, outlinePlot, outlineWorld, detailFiles, templates] =
      await Promise.allSettled([
        fileService.listDir(`${projectId}/chapters`).catch(() => []),
        fileService.listDir(`${projectId}/characters`).catch(() => []),
        fileService.read(`${projectId}/outline/plot.md`).catch(() => null),
        fileService.read(`${projectId}/outline/worldbuilding.md`).catch(() => null),
        fileService.listDir(`${projectId}/detailed_outline`).catch(() => []),
        styleTemplateService.list().catch(() => []),
      ])

    const lines: string[] = ['## 项目文件索引\n']

    // Chapters
    const chFiles = chapterFiles.status === 'fulfilled' ? (chapterFiles.value || []) : []
    const txtFiles = chFiles.filter((f: string) => f.endsWith('.txt')).sort()
    if (txtFiles.length > 0) {
      lines.push('### 章节')
      for (const f of txtFiles.slice(0, 10)) { lines.push(`- chapters/${f} — 章节 ${f.replace('.txt', '')}`) }
      lines.push('')
    }

    // Characters
    const cFiles = charFiles.status === 'fulfilled' ? (charFiles.value || []) : []
    const jsonFiles = cFiles.filter((f: string) => f.endsWith('.json')).sort()
    if (jsonFiles.length > 0) {
      lines.push('### 角色')
      for (const f of jsonFiles.slice(0, 8)) { lines.push(`- characters/${f}`) }
      lines.push('')
    }

    // Outline
    if (outlinePlot.status === 'fulfilled' && outlinePlot.value) lines.push('- outline/plot.md — 剧情大纲')
    if (outlineWorld.status === 'fulfilled' && outlineWorld.value) lines.push('- outline/worldbuilding.md — 世界观设定')

    // Detailed outline
    const dFiles = detailFiles.status === 'fulfilled' ? (detailFiles.value || []) : []
    const dJson = dFiles.filter((f: string) => f.endsWith('.json'))
    if (dJson.length > 0) { lines.push(`- detailed_outline/ — ${dJson.length} 章节的细纲\n`) }

    // Style templates
    const tmpls = templates.status === 'fulfilled' ? (templates.value || []) : []
    if (tmpls.length > 0) {
      const names = (tmpls as any[]).map((t: any) => t.name).slice(0, 5)
      lines.push(`风格模板: ${names.join(', ')}`)
    }

    const result = lines.join('\n')
    _cachedIndex = { projectId, index: result, timestamp: Date.now() }
    return result
  } catch {
    return ''
  }
}

/** Force-refresh the cache (call after project file changes) */
export function invalidateMemoryIndexCache(): void {
  _cachedIndex = null
}
