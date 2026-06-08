// ── Context Provider Interface ──

export interface ContextBlock {
  domain: string
  content: string
  priority: number
  estimatedTokens: number
}

export interface ContextProvider {
  domain: string
  relevance: (userMessage: string, history: Array<{ role: string; content: string }>) => number
  buildContext: (projectId: string | null, userMessage?: string) => Promise<ContextBlock>
}

export interface AssembledContext {
  systemMessages: Array<{ role: 'system'; content: string }>
  totalTokens: number
  domains: string[]
  breakdown: Array<{ domain: string; tokens: number }>
}

// ── Provider Cache ──

interface CachedBlock {
  block: ContextBlock
  projectId: string
}

// ── Assembler ──

export class ContextAssembler {
  private providers: ContextProvider[] = []
  private relevanceThreshold = 0.4  // V1-3: raised from 0.3 to filter out weakly-relevant providers
  private maxContextTokens = 128000  // v11.5.1: match 128K context window

  // v4.1: Change-driven provider cache — invalidated by file modifications
  private providerCache = new Map<string, CachedBlock>()

  register(provider: ContextProvider): void {
    // Deduplicate: replace existing provider with same domain instead of adding a duplicate
    const existing = this.providers.findIndex(p => p.domain === provider.domain)
    if (existing !== -1) {
      this.providers[existing] = provider
    } else {
      this.providers.push(provider)
    }
  }

  setThreshold(t: number): void {
    this.relevanceThreshold = t
  }

  setMaxTokens(max: number): void {
    this.maxContextTokens = max
  }

  getProviders(): readonly ContextProvider[] {
    return this.providers
  }

  /** Invalidate specific provider for a project (e.g. after editing a character file) */
  invalidateProvider(projectId: string | null, domain: string): void {
    const cacheKey = projectId !== null
      ? `p:${projectId}:${domain}`
      : `n:${domain}`
    this.providerCache.delete(cacheKey)
  }

  /** Clear all cached providers for a project (e.g. when switching projects) */
  clearProject(projectId: string | null): void {
    const prefix = projectId !== null ? `p:${projectId}:` : 'n:'
    for (const key of this.providerCache.keys()) {
      if (key.startsWith(prefix)) this.providerCache.delete(key)
    }
  }

  /**
   * Map a modified file path to the affected provider domains.
   */
  static domainsForPath(filePath: string): string[] {
    const fp = filePath.replace(/\\/g, '/')
    const domains: string[] = []
    if (fp.startsWith('characters/'))    domains.push('characters')
    else if (fp.startsWith('outline/'))  domains.push('outline')
    else if (fp.startsWith('detailed_outline/')) domains.push('detailed-outline')
    else if (fp.startsWith('chapters/')) domains.push('chapter-writing')
    else if (fp.startsWith('summaries/')) domains.push('chapter-writing')
    else if (fp.startsWith('notes/'))     domains.push('notes')
    else if (fp.startsWith('knowledge_base/')) domains.push('knowledge-base')
    // Templates and scene: triggered by dedicated tools, not file paths
    return domains
  }

  async assemble(
    userMessage: string,
    history: Array<{ role: string; content: string }>,
    projectId: string | null,
  ): Promise<AssembledContext> {
    // Score relevance for each provider
    const scored = this.providers.map(p => ({
      provider: p,
      score: p.relevance(userMessage, history),
    }))

    // Select providers above relevance threshold
    const aboveThreshold = scored
      .filter(s => s.score > this.relevanceThreshold)

    // Build context blocks — serve from cache when projectId matches and cache hit
    const allBlocks: ContextBlock[] = []
    for (const { provider } of aboveThreshold) {
      try {
        // H11: Prefix-based key avoids collision between null project and project named '__'
        const cacheKey = projectId !== null
          ? `p:${projectId}:${provider.domain}`
          : `n:${provider.domain}`
        const cached = this.providerCache.get(cacheKey)
        if (cached && (cached.projectId || null) === (projectId || null)) {
          allBlocks.push(cached.block)
          continue
        }
        const block = await provider.buildContext(projectId, userMessage)
        this.providerCache.set(cacheKey, { block, projectId: projectId ?? '' })
        allBlocks.push(block)
      } catch (err) {
        console.warn(`[ContextAssembler] Provider ${provider.domain} failed:`, err)
      }
    }

    // Sort by priority DESC (high-priority blocks first), then truncate by token budget
    allBlocks.sort((a, b) => b.priority - a.priority)

    const blocks: ContextBlock[] = []
    let totalTokens = 0
    for (const block of allBlocks) {
      if (totalTokens + block.estimatedTokens <= this.maxContextTokens) {
        blocks.push(block)
        totalTokens += block.estimatedTokens
      }
    }

    const systemMessages = blocks.map(b => ({
      role: 'system' as const,
      content: b.content,
    }))

    return {
      systemMessages,
      totalTokens,
      domains: blocks.map(b => b.domain),
      breakdown: blocks.map(b => ({ domain: b.domain, tokens: b.estimatedTokens })),
    }
  }

  // @deprecated v11.5.1: removed — use isTaskMessage() from taskDetection.ts directly
}

// ── Global assembler ──

export const contextAssembler = new ContextAssembler()
