export interface TokenBudget {
  contextWindow: number
  used: number
  reserved: number
  available: number
}

export class BudgetManager {
  private contextWindow: number
  private reserveForResponse: number
  private _used = 0

  constructor(contextWindow: number, reserveForResponse = 4096) {
    this.contextWindow = contextWindow
    this.reserveForResponse = reserveForResponse
  }

  get budget(): TokenBudget {
    return {
      contextWindow: this.contextWindow,
      used: this._used,
      reserved: this.reserveForResponse,
      available: Math.max(0, this.contextWindow - this._used - this.reserveForResponse),
    }
  }

  estimateMessages(messages: Array<{ role: string; content: string }>): number {
    let total = 0
    for (const m of messages) {
      // Rough estimation: 1 token ≈ 3 chars for Chinese, 4 for English
      total += Math.ceil((m.content?.length || 0) / 3) + 4 // +4 for role overhead
    }
    return total
  }

  estimateTools(tools: unknown[]): number {
    const json = JSON.stringify(tools)
    return Math.ceil(json.length / 3)
  }

  addUsage(tokens: number): void {
    this._used += tokens
  }

  reset(): void {
    this._used = 0
  }

  shouldCompress(messages: Array<{ role: string; content: string }>): boolean {
    const estimated = this.estimateMessages(messages)
    return estimated > this.contextWindow * 0.7 // Compress at 70% usage
  }

  truncateToolResult(detail: string | undefined, maxChars: number = 10000): string {
    if (!detail) return ''
    if (detail.length <= maxChars) return detail
    return detail.slice(0, maxChars) + `\n\n... (截断 ${detail.length - maxChars} 字符)`
  }

  selectTruncationStrategy(detail: string | undefined): 'none' | 'trim' | 'summarize' {
    if (!detail) return 'none'
    if (detail.length > 50000) return 'summarize'
    if (detail.length > 10000) return 'trim'
    return 'none'
  }
}
