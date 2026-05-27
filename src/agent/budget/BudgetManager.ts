import { ProgressiveCompressor } from '../context/ProgressiveCompressor'

export interface TokenBudget {
  contextWindow: number
  used: number
  reserved: number
  available: number
}

export type CompressionStage = 'none' | 'budget_reduction' | 'snip' | 'microcompact' | 'context_collapse' | 'auto_compact'

export class BudgetManager {
  private contextWindow: number
  private reserveForResponse: number
  private _used = 0
  private compressor: ProgressiveCompressor

  constructor(contextWindow: number, reserveForResponse = 4096) {
    this.contextWindow = contextWindow
    this.reserveForResponse = reserveForResponse
    this.compressor = new ProgressiveCompressor(contextWindow)
  }

  get budget(): TokenBudget {
    return {
      contextWindow: this.contextWindow,
      used: this._used,
      reserved: this.reserveForResponse,
      available: Math.max(0, this.contextWindow - this._used - this.reserveForResponse),
    }
  }

  /** Check if a pending request of estimatedSize tokens would fit */
  willFit(estimatedTokens: number): boolean {
    return (this._used + estimatedTokens + this.reserveForResponse) < this.contextWindow
  }

  /** Estimate whether a messages array would fit in the remaining context window */
  messagesWillFit(messages: Array<{ role: string; content: string }>): boolean {
    const estimated = this.estimateMessages(messages)
    return this.willFit(estimated)
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

  getCompressionStage(): CompressionStage {
    return this.compressor.getStage(this._used)
  }

  needsCompression(): boolean {
    return this.compressor.needsCompression(this._used)
  }

  shouldTriggerCompactHook(): boolean {
    return this.compressor.shouldTriggerHook(this._used)
  }

  shouldCompress(messages: Array<{ role: string; content: string }>): boolean {
    const estimated = this.estimateMessages(messages)
    if (this._used > this.contextWindow * 0.95) return true  // Stage 5: auto-compact
    if (this._used > this.contextWindow * 0.85) return true  // Stage 4: context collapse
    if (this._used > this.contextWindow * 0.70) return true  // Stage 3: microcompact
    if (this._used > this.contextWindow * 0.60) return estimated > this.contextWindow * 0.6  // Stage 2: snip
    return estimated > this.contextWindow * 0.50  // Stage 1: budget reduction
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

  /** Apply progressive compression to the message list based on the current stage. */
  compressMessages(messages: Array<{ role: string; content: string; [key: string]: unknown }>): Array<{ role: string; content: string; [key: string]: unknown }> {
    const stage = this.getCompressionStage()
    if (stage === 'none') return messages

    switch (stage) {
      case 'budget_reduction': {
        // Stage 1 (50%): remove low-info system messages
        return messages.filter(m => m.role !== 'system' || m.content.length > 100)
      }
      case 'snip': {
        // Stage 2 (60%): truncate tool result detail to summary only
        return messages.map(m => {
          if (m.role !== 'tool') return m
          try {
            const parsed = JSON.parse(m.content)
            return { ...m, content: JSON.stringify({ status: parsed.status, summary: parsed.summary }) }
          } catch { return m }
        })
      }
      case 'microcompact': {
        // Stage 3 (70%): summarize oldest user/assistant pair into a system message
        const userIdx = messages.findIndex(m => m.role === 'user')
        const asstIdx = messages.findIndex(m => m.role === 'assistant')
        if (userIdx >= 0 && asstIdx > userIdx) {
          const summary = `[已压缩] 用户: ${String(messages[userIdx].content).slice(0, 200)} | AI: ${String(messages[asstIdx].content).slice(0, 200)}`
          messages[userIdx] = { role: 'system', content: summary }
          messages.splice(asstIdx, 1)
        }
        return messages
      }
      case 'context_collapse':
      case 'auto_compact': {
        // Stage 4-5 (85-95%): collapse early messages into single system summary
        const keepFrom = Math.floor(messages.length * 0.4) // keep last 60%
        const toCompact = messages.slice(0, keepFrom)
        const rest = messages.slice(keepFrom)
        const compacted = `[上下文已压缩] 前${toCompact.length}条消息摘要: ` +
          toCompact.filter(m => m.role === 'user' || m.role === 'assistant')
            .map(m => `[${m.role}] ${String(m.content).slice(0, 100)}`).join(' | ')
        return [{ role: 'system', content: compacted }, ...rest]
      }
      default:
        return messages
    }
  }
}
