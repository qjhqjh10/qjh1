import { isTaskMessage } from '../utils/taskDetection'

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

// ── Assembler ──

export class ContextAssembler {
  private providers: ContextProvider[] = []
  private relevanceThreshold = 0.3
  private maxContextTokens = 50000

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

    // Select providers above threshold
    const selected = scored
      .filter(s => s.score > this.relevanceThreshold)
      .sort((a, b) => b.score - a.score) // highest relevance first

    // Build context blocks
    const blocks: ContextBlock[] = []
    let totalTokens = 0

    for (const { provider } of selected) {
      const block = await provider.buildContext(projectId, userMessage)
      if (totalTokens + block.estimatedTokens <= this.maxContextTokens) {
        blocks.push(block)
        totalTokens += block.estimatedTokens
      }
    }

    // Sort by priority
    blocks.sort((a, b) => b.priority - a.priority)

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

  // Quick check: does the input look like it needs any tools?
  isTaskOriented(userMessage: string): boolean {
    return isTaskMessage(userMessage)
  }
}

// ── Global assembler ──

export const contextAssembler = new ContextAssembler()
