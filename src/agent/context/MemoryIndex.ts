/**
 * Memory Index (V4.1 — Change-driven cache)
 *
 * Outputs direct read_file instructions instead of passive file listings.
 * Cache stays valid until a structural change occurs (file created/deleted/renamed,
 * template created/deleted). Content-only edits (edit_file) do NOT invalidate —
 * file paths and counts remain the same.
 *
 * Persisted to disk: survives app restart, loaded on first access.
 */

import { estimateTokens } from '../utils/tokenEstimation'

// Module-level cache — survives across messages and sessions
let _cachedIndex: { projectId: string; index: string; tokenCount: number } | null = null
let _dirty = false

const PERSIST_PATH = '.aiharness/memory-index.json'

/**
 * Build a compact project file index suitable for LLM context.
 * Returns cached result if available. Rebuilds only when invalidated.
 */
export async function buildMemoryIndex(projectId: string): Promise<string> {
  if (!projectId) return ''

  // Return cached if still valid (no invalidation occurred)
  if (_cachedIndex && _cachedIndex.projectId === projectId) {
    return _cachedIndex.index
  }

  // Try loading persisted index from disk (survives app restart)
  if (!_cachedIndex || _cachedIndex.projectId !== projectId) {
    const persisted = await loadPersisted(projectId)
    if (persisted) return persisted
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

    const lines: string[] = ['## 项目文件索引 — 直接 read_file 即可，无需探索']
    lines.push('> 同类型文件超过5个时，先列出概要让用户选择，不要全读。用户指定了具体文件名则直接读。\n')
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
    _cachedIndex = { projectId, index: result, tokenCount: estimateTokens(result) }
    _dirty = true
    // Fire-and-forget persist
    persistToDisk(projectId, _cachedIndex).catch(() => {})
    return result
  } catch {
    return ''
  }
}

/**
 * Invalidate the cache. Call after any structural file change:
 * - create_file, delete_file, rename_file
 * - create_style_template, create_scene_template
 * - kb_create_file, kb_delete
 *
 * Content-only edits (edit_file) do NOT need invalidation —
 * file paths and counts remain unchanged.
 */
export function invalidateMemoryIndexCache(): void {
  _cachedIndex = null
  // Remove stale persisted file so it doesn't conflict on next load
  import('@/services/fileService').then(m =>
    m.fileService.deleteFile(PERSIST_PATH).catch(() => {})
  ).catch(() => {})
}

/** Get the token count of the cached index (0 if not built yet) */
export function getMemoryIndexTokens(): number {
  return _cachedIndex?.tokenCount ?? 0
}

// ── Disk persistence (survives app restart) ──

async function persistToDisk(projectId: string, cache: { projectId: string; index: string; tokenCount: number }): Promise<void> {
  try {
    const { fileService } = await import('@/services/fileService')
    await fileService.ensureDir('.aiharness')
    await fileService.write(PERSIST_PATH, JSON.stringify({
      projectId: cache.projectId,
      index: cache.index,
      savedAt: Date.now(),
    }))
  } catch { /* best-effort */ }
}

async function loadPersisted(projectId: string): Promise<string | null> {
  try {
    const { fileService } = await import('@/services/fileService')
    const raw = await fileService.read(PERSIST_PATH)
    if (!raw?.trim()) return null
    const data = JSON.parse(raw)
    if (data.projectId !== projectId) return null
    // Check if persisted index is stale — if any structural change happened
    // since it was saved, it would have been invalidated (file deleted on disk too)
    _cachedIndex = { projectId: data.projectId, index: data.index, tokenCount: estimateTokens(data.index) }
    return data.index
  } catch { return null }
}
