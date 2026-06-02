/**
 * File Content Cache (V4.1 → V9.5.2)
 *
 * Now delegates to the shared fileReadCache module so GUI reads (fileService.read)
 * and AI reads (read_file tool) share the SAME cache layer.
 *
 * Principle: one cache, one truth — never duplicate data.
 */

import {
  getFileCache,
  setFileCache,
  invalidateFileCache,
  invalidateDirCache,
  invalidateProjectFiles,
  clearAllFileCache,
  getFileCacheStats,
  getFileCacheDiagnostics,
} from '@/utils/fileReadCache'

/** Read file content, serving from cache when available. Throws on failure. */
export async function cachedRead(filePath: string, projectId?: string | null): Promise<string> {
  const cached = getFileCache(filePath)
  if (cached !== undefined) return cached

  const { fileService } = await import('@/services/fileService')
  const content = await fileService.read(filePath)
  setFileCache(filePath, content, projectId)
  return content
}

// Re-export shared cache functions under the existing API names
export const getCachedFile = getFileCache
export const setCachedFile = (filePath: string, content: string, projectId?: string | null) =>
  setFileCache(filePath, content, projectId)
export const invalidateFile = invalidateFileCache
export const invalidateDir = invalidateDirCache
export const invalidateProjectFilesReexport = invalidateProjectFiles
export const clearFileCache = clearAllFileCache
export { getFileCacheStats, getFileCacheDiagnostics }
