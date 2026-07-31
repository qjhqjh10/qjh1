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
 * Invalidate caches after a tool successfully modified state.
 * Handles: create_file, edit_file, delete_file, rename_file, batch_replace,
 *   create_project, delete_project, kb_append_file,
 *   (template tools removed in v11.6.1)
 */
export async function invalidateAfterTool(
  toolName: string,
  args: Record<string, unknown>,
  callbacks: CacheInvalidationCallbacks,
): Promise<void> {
  const fp = String(args.file_path || args.path || '')
  const { invalidateFile, invalidateDir } = await import('./FileCache')

  if (toolName === 'edit_file' || toolName === 'batch_replace') {
    // Content edit → invalidate ONLY that file
    invalidateFile(fp)
  } else if (toolName === 'create_file' || toolName === 'delete_file') {
    // Structural change → invalidate index + directory cache
    invalidateFile(fp)
    const dir = fp.replace(/\/[^/]+$/, '')
    invalidateDir(dir)
  } else if (toolName === 'rename_file') {
    const newPath = String(args.new_path || '')
    invalidateFile(fp)
    if (newPath) invalidateFile(newPath)
  } else if (/^(kb_append_file|create_project|delete_project)$/.test(toolName)) {
    // Global/structural changes (no index to invalidate in v11.7.2)
  }

  // Notify GUI of file changes
  if (/^(create_file|edit_file|batch_replace|delete_file|rename_file|create_project|delete_project|kb_append_file)$/.test(toolName)) {
    callbacks.onFileChanged(fp)
  }
}
