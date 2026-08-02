/**
 * Shared File Read Cache (V9.6.2)
 *
 * Single in-memory LRU cache for all file reads — used by both:
 * - fileService.read (GUI chapter viewing, uploads, etc.)
 * - FileCache (AI read_file tool executor)
 *
 * One cache, one truth. Eliminates redundant disk reads regardless of caller.
 *
 * Features:
 * - True LRU eviction (500 entries, access bumps to MRU)
 * - Path normalization (backslash→slash, ../ folding, duplicate slash collapsing)
 * - ProjectId tagging for scoped invalidation
 * - Diagnostics: hit rate, per-project stats
 */

const MAX_ENTRIES = 500

interface CacheEntry {
  content: string
  size: number
  projectId: string | null
}

const cache = new Map<string, CacheEntry>()

// ── Diagnostics ──

let _hits = 0
let _misses = 0
let _evictions = 0

// ── Path normalization ──

/** Normalize a file path to a canonical form for cache key consistency */
function normalizePath(raw: string): string {
  let p = raw
    .replace(/\\/g, '/')       // Windows backslash → forward slash
    .replace(/\/+/g, '/')      // Collapse duplicate slashes
  // Strip leading ../ to canonicalize relative paths
  while (p.startsWith('../')) p = p.slice(3)
  // Strip trailing slash
  if (p.endsWith('/')) p = p.slice(0, -1)
  // v14.6.1: Windows 文件系统不区分大小写——"Chapters/1.md" 与 "chapters/1.md" 是同一文件，
  // 缓存不折叠会让失效遗漏（AI 编辑后 GUI 命中陈旧条目）
  return p.toLowerCase()
}

// ── Eviction ──

/** Evict oldest (first-inserted) entries if over capacity */
function enforceCap(): void {
  while (cache.size > MAX_ENTRIES) {
    const firstKey = cache.keys().next().value
    if (firstKey !== undefined) {
      cache.delete(firstKey)
      _evictions++
    }
  }
}

// ── Public API ──

/** Get cached content for a file path, or undefined on miss. Bumps to MRU on hit. */
export function getFileCache(filePath: string): string | undefined {
  const norm = normalizePath(filePath)
  const entry = cache.get(norm)
  if (entry) {
    // True LRU: delete and re-insert to move to MRU end
    cache.delete(norm)
    cache.set(norm, entry)
    _hits++
    return entry.content
  }
  _misses++
  return undefined
}

/** Store file content in cache. projectId tags entries for scoped invalidation. */
export function setFileCache(filePath: string, content: string, projectId?: string | null): void {
  const norm = normalizePath(filePath)
  if (cache.has(norm)) cache.delete(norm)  // bump to MRU
  cache.set(norm, { content, size: content.length, projectId: projectId ?? null })
  enforceCap()
}

/** Remove a single file from cache */
export function invalidateFileCache(filePath: string): void {
  cache.delete(normalizePath(filePath))
}

/** Invalidate all cached files under a directory prefix (boundary-safe) */
export function invalidateDirCache(dirPath: string): void {
  const prefix = normalizePath(dirPath)
  const prefixSlash = prefix.endsWith('/') ? prefix : prefix + '/'
  for (const key of cache.keys()) {
    // Prefix match with boundary: key starts with "prefix/" or key === prefix itself
    if (key.startsWith(prefixSlash) || key === prefix) {
      cache.delete(key)
    }
  }
}

/** Invalidate only entries tagged with a specific projectId (preserves global files) */
export function invalidateProjectFiles(projectId: string): void {
  for (const [key, value] of cache.entries()) {
    if (value.projectId === projectId) cache.delete(key)
  }
}

/** Clear entire cache */
export function clearAllFileCache(): void {
  cache.clear()
}

// ── Diagnostics ──

/** Get cache stats for diagnostics */
export function getFileCacheStats(): { entries: number; totalChars: number } {
  let totalChars = 0
  for (const v of cache.values()) totalChars += v.size
  return { entries: cache.size, totalChars }
}

/** Extended diagnostics: includes hit rate, eviction count */
export interface CacheDiagnostics {
  entries: number
  totalChars: number
  hits: number
  misses: number
  hitRate: number
  evictions: number
}

export function getFileCacheDiagnostics(): CacheDiagnostics {
  const stats = getFileCacheStats()
  const total = _hits + _misses
  return {
    ...stats,
    hits: _hits,
    misses: _misses,
    hitRate: total > 0 ? _hits / total : 0,
    evictions: _evictions,
  }
}
