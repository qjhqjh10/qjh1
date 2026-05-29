interface CacheEntry<T> {
  key: string
  data: T
  timestamp: number
  accessCount: number
}

export class ToolCache {
  private store = new Map<string, CacheEntry<unknown>>()
  private maxEntries: number

  constructor(maxEntries = 500) {
    this.maxEntries = maxEntries
  }

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key)
    if (!entry) return undefined
    // TTL: 60 seconds
    if (Date.now() - entry.timestamp > 60000) {
      this.store.delete(key)
      return undefined
    }
    entry.accessCount++
    return entry.data as T
  }

  set<T>(key: string, data: T): void {
    if (this.store.size >= this.maxEntries) {
      // Evict least accessed
      let minAccess = Infinity
      let minKey = ''
      for (const [k, v] of this.store) {
        if (v.accessCount < minAccess) {
          minAccess = v.accessCount
          minKey = k
        }
      }
      this.store.delete(minKey)
    }
    this.store.set(key, { key, data, timestamp: Date.now(), accessCount: 1 })
  }

  has(key: string): boolean {
    const entry = this.store.get(key)
    if (!entry) return false
    // TTL: 60 seconds
    if (Date.now() - entry.timestamp > 60000) {
      this.store.delete(key)
      return false
    }
    return true
  }

  /** Invalidate entries matching a path prefix */
  invalidate(pattern: string | RegExp): void {
    const isRegExp = pattern instanceof RegExp
    for (const key of this.store.keys()) {
      if (isRegExp ? pattern.test(key) : key.includes(String(pattern))) {
        this.store.delete(key)
      }
    }
  }

  /** Clear entire cache */
  invalidateAll(): void {
    this.store.clear()
  }

  /** Get stats for debugging */
  stats(): { size: number; maxEntries: number; totalAccesses: number } {
    let totalAccesses = 0
    for (const e of this.store.values()) totalAccesses += e.accessCount
    return { size: this.store.size, maxEntries: this.maxEntries, totalAccesses }
  }
}
