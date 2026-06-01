/**
 * File Content Cache (V4.1)
 *
 * Per-file read cache with prefix-based invalidation.
 * When a specific file is modified, only that file's cache is cleared —
 * other files in the same directory remain cached.
 *
 * Principle: new data replaces old → never accumulate stale data.
 */

const cache = new Map<string, { content: string; size: number }>()

/** Read file content, serving from cache when available. Throws on failure (like fileService.read). */
export async function cachedRead(filePath: string): Promise<string> {
  const cached = cache.get(filePath)
  if (cached) return cached.content

  const { fileService } = await import('@/services/fileService')
  const content = await fileService.read(filePath)
  // fileService.read returns a string or throws — same behavior
  cache.set(filePath, { content, size: content.length })
  return content
}

/** Invalidate a single file from cache (call after edit_file) */
export function invalidateFile(filePath: string): void {
  cache.delete(filePath)
}

/** Invalidate all files under a directory prefix (call after create_file / delete_file / rename_file in that dir) */
export function invalidateDir(dirPath: string): void {
  const prefix = dirPath.endsWith('/') ? dirPath : dirPath + '/'
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key)
  }
}

/** Clear the entire cache (call on project switch) */
export function clearFileCache(): void {
  cache.clear()
}

/** Get cache stats for diagnostics */
export function getFileCacheStats(): { entries: number; totalChars: number } {
  let totalChars = 0
  for (const v of cache.values()) totalChars += v.size
  return { entries: cache.size, totalChars }
}
