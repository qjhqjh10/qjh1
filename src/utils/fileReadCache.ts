/**
 * Shared File Read Cache (V9.5.2)
 *
 * Single in-memory cache for all file reads — used by both:
 * - fileService.read (GUI chapter viewing, uploads, etc.)
 * - FileCache (AI read_file tool executor)
 *
 * One cache, one truth. Eliminates redundant disk reads regardless of caller.
 */
const cache = new Map<string, { content: string; size: number }>()

/** Get cached content for a file path, or undefined on miss */
export function getFileCache(filePath: string): string | undefined {
  return cache.get(filePath)?.content
}

/** Store file content in cache */
export function setFileCache(filePath: string, content: string): void {
  cache.set(filePath, { content, size: content.length })
}

/** Remove a single file from cache */
export function invalidateFileCache(filePath: string): void {
  cache.delete(filePath)
}

/** Invalidate all cached files under a directory prefix */
export function invalidateDirCache(dirPath: string): void {
  const prefix = dirPath.endsWith('/') ? dirPath : dirPath + '/'
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key)
  }
}

/** Clear entire cache (e.g., on project switch) */
export function clearAllFileCache(): void {
  cache.clear()
}

/** Get cache stats for diagnostics */
export function getFileCacheStats(): { entries: number; totalChars: number } {
  let totalChars = 0
  for (const v of cache.values()) totalChars += v.size
  return { entries: cache.size, totalChars }
}
