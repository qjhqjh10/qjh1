/**
 * Memory Index (V3.1)
 *
 * Outputs direct read_file instructions instead of passive file listings.
 * This eliminates list_directory/search_files exploration — the model
 * knows exact paths and can read files directly in one iteration.
 *
 * Cached with 120s TTL. All file scans run in parallel.
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

    const lines: string[] = ['## 项目文件索引 — 直接 read_file 即可，无需探索\n']
    const prefix = projectId

    // Chapters
    const chFiles = chapterFiles.status === 'fulfilled' ? (chapterFiles.value || []) : []
    const txtFiles = chFiles.filter((f: string) => f.endsWith('.txt')).sort((a: string, b: string) => {
      const numA = parseInt(a.replace(/\D/g, '')) || 0
      const numB = parseInt(b.replace(/\D/g, '')) || 0
      return numA - numB || a.localeCompare(b)
    })
    if (txtFiles.length > 0) {
      const newest = txtFiles.slice(-3)
      lines.push(`已有 ${txtFiles.length} 章正文: ${newest.join(', ')}${txtFiles.length > 3 ? ' 等' : ''}`)
      if (txtFiles.length > 0) lines.push(`  读最新章节: read_file("${prefix}/chapters/${txtFiles[txtFiles.length - 1]}")`)
      lines.push('')
    }

    // Characters — show names from filenames as hints
    const cFiles = charFiles.status === 'fulfilled' ? (charFiles.value || []) : []
    const jsonFiles = cFiles.filter((f: string) => f.endsWith('.json')).sort()
    if (jsonFiles.length > 0) {
      lines.push(`### 角色 (${jsonFiles.length}个)`)
      for (const f of jsonFiles.slice(0, 6)) {
        const name = f.replace('.json', '').replace(/_/g, ' ')
        lines.push(`  read_file("${prefix}/characters/${f}")`)
      }
      if (jsonFiles.length > 6) lines.push(`  还有 ${jsonFiles.length - 6} 个角色，read_file("${prefix}/characters/角色拼音.json")`)
      lines.push('')
    }

    // Outline — direct paths with purpose
    if (outlinePlot.status === 'fulfilled' && outlinePlot.value) {
      lines.push(`read_file("${prefix}/outline/plot.md") — 故事剧情`)
    }
    if (outlineWorld.status === 'fulfilled' && outlineWorld.value) {
      lines.push(`read_file("${prefix}/outline/worldbuilding.md") — 世界观设定`)
    }
    if ((outlinePlot.status === 'fulfilled' && outlinePlot.value) || (outlineWorld.status === 'fulfilled' && outlineWorld.value)) lines.push('')

    // Detailed outline
    const dFiles = detailFiles.status === 'fulfilled' ? (detailFiles.value || []) : []
    const dJson = dFiles.filter((f: string) => f.endsWith('.json')).sort()
    if (dJson.length > 0) {
      lines.push(`### 细纲 (${dJson.length} 章)`)
      for (const f of dJson.slice(0, 5)) {
        lines.push(`  read_file("${prefix}/detailed_outline/${f}")`)
      }
      if (dJson.length > 5) lines.push(`  还有 ${dJson.length - 5} 章细纲`)
      lines.push('')
    }

    // Style templates
    const tmpls = templates.status === 'fulfilled' ? (templates.value || []) : []
    if (tmpls.length > 0) {
      const names = (tmpls as any[]).map((t: any) => t.name).slice(0, 3)
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
