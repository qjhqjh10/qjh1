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
  clearAllFileCache,
  getFileCacheStats,
} from '@/utils/fileReadCache'

/** Read file content, serving from cache when available. Throws on failure. */
export async function cachedRead(filePath: string): Promise<string> {
  const cached = getFileCache(filePath)
  if (cached !== undefined) return cached

  const { fileService } = await import('@/services/fileService')
  // fileService.read now has its own cache layer — but setFileCache below
  // ensures AI tool reads also populate the shared cache explicitly
  const content = await fileService.read(filePath)
  setFileCache(filePath, content)
  return content
}

// Re-export shared cache functions under the existing API names
export const getCachedFile = getFileCache
export const setCachedFile = setFileCache
export const invalidateFile = invalidateFileCache
export const invalidateDir = invalidateDirCache
export const clearFileCache = clearAllFileCache
export { getFileCacheStats }
