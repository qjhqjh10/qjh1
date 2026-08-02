// ── Cache Invalidator (v11.7.2) ──
// Shared cache invalidation logic. Covers FileCache + UI notification.
// (MemoryIndex removed in v11.7.2 — index no longer injected)

import { ContextAssembler } from './ContextAssembler'

/** Callbacks for triggering UI updates after file changes */
export interface CacheInvalidationCallbacks {
  /** Notify GUI that files have changed (bump version + set edit notify) */
  onFileChanged: (filePath: string) => void
}

/**
 * v14.6.1: 手工相对→绝对路径解析（渲染层无 node:path）。
 * AI 传相对路径（"项目名/outline/plot.md"），GUI 缓存与组件比较都用绝对路径——
 * 只失效相对 key 会让 GUI 命中陈旧缓存、fileEditNotify 比较恒失败。
 */
function toAbsolute(fp: string, basePath?: string): string {
  if (!basePath || !fp) return fp
  if (/^[A-Za-z]:[\\/]/.test(fp) || fp.startsWith('/') || fp.startsWith('\\\\')) return fp
  const parts = fp.replace(/\\/g, '/').split('/')
  const baseParts = basePath.replace(/\\/g, '/').split('/')
  for (const seg of parts) {
    if (seg === '..') baseParts.pop()
    else if (seg === '.' || seg === '') continue
    else baseParts.push(seg)
  }
  return baseParts.join('/')
}

/**
 * Invalidate caches after a tool successfully modified state.
 * Handles: create_file, edit_file, delete_file, rename_file, batch_replace,
 *   create_project, delete_project, kb_append_file,
 *   (template tools removed in v11.6.1)
 */
export async function invalidateAfterTool(
  toolName: string,
  args: Record<string, unknown>,
  callbacks: CacheInvalidationCallbacks,
  /** v14.6.1: projectsBasePath — AI 相对路径解析为绝对路径，双 key 失效（GUI 缓存/通知用绝对 key） */
  basePath?: string,
): Promise<void> {
  const fp = String(args.file_path || args.path || '')
  const { invalidateFile, invalidateDir } = await import('./FileCache')
  // v14.6.1: 相对 + 绝对双 key 失效——AI 写失效必须清掉 GUI 绝对路径缓存条目
  const absFp = toAbsolute(fp, basePath)
  const invalidateBoth = (p: string) => {
    invalidateFile(p)
    if (absFp && absFp !== p) invalidateFile(absFp)
  }

  if (toolName === 'edit_file' || toolName === 'batch_replace') {
    // Content edit → invalidate ONLY that file
    invalidateBoth(fp)
  } else if (toolName === 'create_file' || toolName === 'delete_file') {
    // Structural change → invalidate index + directory cache
    invalidateBoth(fp)
    const dir = fp.replace(/\/[^/]+$/, '')
    invalidateDir(dir)
    if (absFp && absFp !== fp) invalidateDir(absFp.replace(/\/[^/]+$/, ''))
  } else if (toolName === 'rename_file') {
    const newPath = String(args.new_path || '')
    invalidateBoth(fp)
    if (newPath) {
      invalidateFile(newPath)
      const absNew = toAbsolute(newPath, basePath)
      if (absNew !== newPath) invalidateFile(absNew)
    }
  } else if (/^(kb_append_file|create_project|delete_project)$/.test(toolName)) {
    // v14.6.1: kb_append_file 参数是 file_id（无法映射路径）→ 失效整个 KB 文件目录缓存
    if (toolName === 'kb_append_file') {
      invalidateDir('knowledge_base/files')
      if (basePath) invalidateDir(toAbsolute('knowledge_base/files', basePath))
    }
  }

  // Notify GUI of file changes
  // v14.6.1: 通知用绝对路径——GUI 组件（ChapterWritingPage/OutlinePopup 等）以
  // `${projectsBasePath}/项目名/...` 精确比较，原相对路径恒不匹配 → AI 改文件后页面永不刷新
  if (/^(create_file|edit_file|batch_replace|delete_file|rename_file|create_project|delete_project|kb_append_file)$/.test(toolName)) {
    callbacks.onFileChanged(absFp || fp)
  }
}
