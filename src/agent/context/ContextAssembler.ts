// ── Context Assembler (v11.7.1 simplified) ──
// Provider system removed — all context injection handled by BridgeContextBuilder.
// Retained for: domainsForPath (CacheInvalidator) + assemble() compatibility stub.

export interface AssembledContext {
  systemMessages: Array<{ role: 'system'; content: string }>
  totalTokens: number
  domains: string[]
  breakdown: Array<{ domain: string; tokens: number }>
}

export class ContextAssembler {
  /**
   * Map a modified file path to the affected provider domains.
   * Used by CacheInvalidator after file modifications.
   */
  static domainsForPath(filePath: string): string[] {
    const fp = filePath.replace(/\\/g, '/').replace(/^(\.\.\/)+/, '')  // strip ../../ prefix
    const domains: string[] = []
    if (fp.startsWith('characters/'))    domains.push('characters')
    else if (fp.startsWith('outline/'))  domains.push('outline')
    else if (fp.startsWith('detailed_outline/')) domains.push('detailed-outline')
    else if (fp.startsWith('chapters/')) domains.push('chapter-writing')
    else if (fp.startsWith('summaries/')) domains.push('chapter-writing')
    else if (fp.startsWith('notes/'))     domains.push('notes')
    else if (fp.startsWith('knowledge_base/')) domains.push('knowledge-base')
    return domains
  }

  clearProject(_projectId: string | null): void {
    // no-op: Provider cache removed in v11.7.1
  }

  invalidateProvider(_projectId: string | null, _domain: string): void {
    // no-op: Provider cache removed in v11.7.1
  }

  /**
   * Compatibility stub — returns empty context.
   * All real context assembly handled by BridgeContextBuilder.
   */
  async assemble(
    _userMessage: string,
    _history: Array<{ role: string; content: string }>,
    _projectId: string | null,
  ): Promise<AssembledContext> {
    return { systemMessages: [], totalTokens: 0, domains: [], breakdown: [] }
  }
}

export const contextAssembler = new ContextAssembler()
