// ── Context Assembler (v11.7.1 simplified) ──
// Provider system removed — all context injection handled by BridgeContextBuilder.
// Retained for: domainsForPath (CacheInvalidator).

export class ContextAssembler {
  /**
   * Map a modified file path to the affected provider domains.
   * Used by CacheInvalidator after file modifications.
   */
  static domainsForPath(filePath: string): string[] {
    const fp = filePath.replace(/\\/g, '/').replace(/^(\.\.\/)+/, '')  // strip ../../ prefix
    const domains: string[] = []
    // v16.4.1: 角色目录已迁移至 outline/characters/（旧顶层 characters/ 仍兼容判定）
    if (fp.startsWith('outline/characters/') || fp.startsWith('characters/')) domains.push('characters')
    if (fp.startsWith('outline/'))  domains.push('outline')
    else if (fp.startsWith('detailed_outline/')) domains.push('detailed-outline')
    else if (fp.startsWith('chapters/')) domains.push('chapter-writing')
    else if (fp.startsWith('summaries/')) domains.push('chapter-writing')
    else if (fp.startsWith('notes/'))     domains.push('notes')
    else if (fp.startsWith('knowledge_base/')) domains.push('knowledge-base')
    return domains
  }
}
