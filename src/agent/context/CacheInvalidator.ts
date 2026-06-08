// ── Cache Invalidator (v11.7.2) ──
// Shared cache invalidation logic. Covers FileCache + ContextAssembler providers + UI notification.
// (MemoryIndex removed in v11.7.2 — index no longer injected)

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
  const { invalidateFile, invalidateDir } = await import('./FileCache')

  if (toolName === 'edit_file' || toolName === 'batch_replace') {
    // Content edit → invalidate ONLY that file + its provider domain
    invalidateFile(fp)
    const domains = ContextAssembler.domainsForPath(fp)
    for (const d of domains) contextAssembler.invalidateProvider(projectId, d)
  } else if (toolName === 'create_file' || toolName === 'delete_file') {
    // Structural change → invalidate index + directory cache + provider domain
    invalidateFile(fp)
    const dir = fp.replace(/\/[^/]+$/, '')
    invalidateDir(dir)
    const domains = ContextAssembler.domainsForPath(fp)
    for (const d of domains) contextAssembler.invalidateProvider(projectId, d)
  } else if (toolName === 'rename_file') {
    const newPath = String(args.new_path || '')
    invalidateFile(fp)
    if (newPath) invalidateFile(newPath)
    const domains = new Set([
      ...ContextAssembler.domainsForPath(fp),
      ...ContextAssembler.domainsForPath(newPath),
    ])
    for (const d of domains) contextAssembler.invalidateProvider(projectId, d)
  } else if (/^(kb_append_file|create_project|delete_project)$/.test(toolName)) {
    // Global/structural changes (no index to invalidate in v11.7.2)
  }

  // Notify GUI of file changes
  if (/^(create_file|edit_file|batch_replace|delete_file|rename_file|create_project|delete_project|kb_append_file)$/.test(toolName)) {
    callbacks.onFileChanged(fp)
  }
}
