// ── Context Cache ──
// Caches project summaries to avoid redundant file I/O
// across Classifier → Intent → Plan pipeline stages.

export class ContextCache {
  private cache = new Map<string, { data: string; timestamp: number }>()
  private ttl: number

  constructor(ttlMs = 60_000) {
    this.ttl = ttlMs // default 1 minute
  }

  async getProjectSummary(projectId: string | null): Promise<string> {
    if (!projectId) return ''
    const cacheKey = `summary:${projectId}`

    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey)!
      if (Date.now() - cached.timestamp < this.ttl) return cached.data
      this.cache.delete(cacheKey)
    }

    try {
      const { buildProjectSummary } = await import('../context/projectSummary')
      const summary = await buildProjectSummary(projectId)
      this.cache.set(cacheKey, { data: summary, timestamp: Date.now() })
      return summary
    } catch {
      return ''
    }
  }

  /** Invalidate all cached entries */
  invalidate(): void {
    this.cache.clear()
  }
}
