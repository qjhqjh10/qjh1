// ── Rule Extractor ──
// Analyzes ReflectionEngine error logs to detect repeated patterns
// and auto-generates Policy or Hook suggestions.

import type { ToolResult } from '../runtime/AgentRuntime'

export interface ErrorPattern {
  toolName: string
  errorCategory: string
  count: number
  firstSeen: number
  lastSeen: number
  suggestedFix: string
}

export interface AutoRule {
  type: 'policy' | 'hook'
  title: string
  description: string
  config: Record<string, unknown>
  status: 'auto-draft'  // requires human review before activation
}

export class RuleExtractor {
  private errorHistory: Array<{ toolName: string; error: string; timestamp: number }> = []

  recordError(toolName: string, error: string): void {
    this.errorHistory.push({ toolName, error, timestamp: Date.now() })
    // Keep only last 1000
    if (this.errorHistory.length > 1000) this.errorHistory = this.errorHistory.slice(-1000)
  }

  analyzePatterns(): ErrorPattern[] {
    const toolErrors = new Map<string, number>()
    for (const { toolName, error } of this.errorHistory) {
      const key = `${toolName}:${error.slice(0, 80)}`
      toolErrors.set(key, (toolErrors.get(key) || 0) + 1)
    }

    const patterns: ErrorPattern[] = []
    for (const [key, count] of toolErrors) {
      if (count >= 3) {
        const [toolName, error] = key.split(':')
        const timestamps = this.errorHistory
          .filter(e => e.toolName === toolName && e.error.slice(0, 80) === error)
          .map(e => e.timestamp)
        patterns.push({
          toolName, errorCategory: this.categorizeError(error),
          count, firstSeen: Math.min(...timestamps), lastSeen: Math.max(...timestamps),
          suggestedFix: this.suggestRule(toolName, error),
        })
      }
    }
    return patterns.sort((a, b) => b.count - a.count)
  }

  generateAutoRules(patterns: ErrorPattern[]): AutoRule[] {
    return patterns.map(p => ({
      type: p.errorCategory === 'permission' ? 'policy' as const : 'hook' as const,
      title: `自动规则: 阻止 ${p.toolName} 的重复错误`,
      description: `${p.toolName} 出错 ${p.count} 次: ${p.errorCategory}`,
      config: p.suggestedFix.startsWith('Policy:')
        ? { permissions: { policies: [{ effect: 'ask', toolName: p.toolName }] } }
        : { hooks: [{ event: 'PreToolUse', onMatch: p.toolName, command: 'validate-input.mjs' }] },
      status: 'auto-draft',
    }))
  }

  private categorizeError(error: string): string {
    const s = error.toLowerCase()
    if (s.includes('格式') || s.includes('json')) return 'format'
    if (s.includes('不存在')) return 'not_found'
    if (s.includes('权限') || s.includes('deny')) return 'permission'
    return 'unknown'
  }

  private suggestRule(toolName: string, error: string): string {
    if (error.includes('不存在')) return `Policy: 要求 ${toolName} 前先 list_directory`
    if (error.includes('格式')) return `Hook: PostToolUse 验证 ${toolName} 的输出格式`
    return `Policy: 将 ${toolName} 设为需要用户确认`
  }
}
