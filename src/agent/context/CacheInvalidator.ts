// ── Cache Invalidator (v11.5.1) ──
// Shared cache invalidation logic extracted from V4AgentChatBridge and V4AnthropicChatBridge.
// Eliminates ~60 lines of duplicated code across the two bridges.
//
// Covers: MemoryIndex, FileCache, ContextAssembler providers, and UI change notification
// for all file-modifying tools.

import { contextAssembler, ContextAssembler } from './ContextAssembler'

/** Callbacks for triggering UI updates after file changes */
export interface CacheInvalidationCallbacks {
  /** Notify GUI that files have changed (bump version + set edit notify) */
  onFileChanged: (filePath: string) => void
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
  projectId: string | null,
  callbacks: CacheInvalidationCallbacks,
): Promise<void> {
  const fp = String(args.file_path || args.path || '')
  const { invalidateMemoryIndexCache } = await import('./MemoryIndex')
  const { invalidateFile, invalidateDir } = await import('./FileCache')

  if (toolName === 'edit_file' || toolName === 'batch_replace') {
    // Content edit → invalidate ONLY that file + its provider domain
    invalidateFile(fp)
    const domains = ContextAssembler.domainsForPath(fp)
    for (const d of domains) contextAssembler.invalidateProvider(projectId, d)
  } else if (toolName === 'create_file' || toolName === 'delete_file') {
    // Structural change → invalidate index + directory cache + provider domain
    invalidateMemoryIndexCache()
    invalidateFile(fp)
    const dir = fp.replace(/\/[^/]+$/, '')
    invalidateDir(dir)
    const domains = ContextAssembler.domainsForPath(fp)
    for (const d of domains) contextAssembler.invalidateProvider(projectId, d)
  } else if (toolName === 'rename_file') {
    // Both old and new paths affected → invalidate index
    invalidateMemoryIndexCache()
    const newPath = String(args.new_path || '')
    invalidateFile(fp)
    if (newPath) invalidateFile(newPath)
    const domains = new Set([
      ...ContextAssembler.domainsForPath(fp),
      ...ContextAssembler.domainsForPath(newPath),
    ])
    for (const d of domains) contextAssembler.invalidateProvider(projectId, d)
  } else if (/^(kb_append_file|create_project|delete_project)$/.test(toolName)) {
    // Global/structural changes → invalidate index
    invalidateMemoryIndexCache()
  }

  // Notify GUI of file changes
  if (/^(create_file|edit_file|batch_replace|delete_file|rename_file|create_project|delete_project|kb_append_file)$/.test(toolName)) {
    callbacks.onFileChanged(fp)
  }
}
