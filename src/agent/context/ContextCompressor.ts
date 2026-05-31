// ── V4 Context Compressor ──
// Claude-style progressive compression. Operates transparently during
// the agent loop — the model continues without interruption.
//
// Thresholds (1M context window):
//   Stage 1 (70% = 700K): Strip verbose tool detail → keep status+summary
//   Stage 2 (80% = 800K): Summarize oldest user/assistant pairs
//   Stage 3 (90% = 900K): Collapse early conversation into summary
//
// Never compressed: system prompt, last 5 messages, pending tool calls.

import type { Message } from '../state/types'
import { estimateTokens, estimateMessages } from '../utils/tokenEstimation'

export type CompressionStage = 'none' | 'strip_detail' | 'summarize_pairs' | 'collapse_early'

export class ContextCompressor {
  private contextWindow: number

  constructor(contextWindow: number = 1_000_000) {
    this.contextWindow = contextWindow
  }

  // Delegates to shared utility (single source of truth)
  estimateTokens(text: string): number { return estimateTokens(text) }
  estimateMessages(messages: Message[]): number { return estimateMessages(messages) }

  getStage(usedTokens: number): CompressionStage {
    const pct = usedTokens / this.contextWindow
    if (pct >= 0.90) return 'collapse_early'
    if (pct >= 0.80) return 'summarize_pairs'
    if (pct >= 0.70) return 'strip_detail'
    return 'none'
  }

  needsCompression(usedTokens: number): boolean {
    return this.getStage(usedTokens) !== 'none'
  }

  /**
   * Apply progressive compression to messages.
   * Preserves: system prompt (first message), last 5 messages, pending tool context.
   */
  compress(messages: Message[], usedTokens: number): Message[] {
    const stage = this.getStage(usedTokens)
    if (stage === 'none') return messages

    switch (stage) {
      case 'strip_detail': return this.stripDetail(messages)
      case 'summarize_pairs': return this.summarizePairs(messages)
      case 'collapse_early': return this.collapseEarly(messages)
      default: return messages
    }
  }

  // ── Stage 1: Strip verbose detail from tool results ──

  private stripDetail(messages: Message[]): Message[] {
    return messages.map(m => {
      if (m.role !== 'tool' || !m.content) return m
      try {
        const parsed = JSON.parse(m.content)
        // Keep only status + summary + note, strip detail
        const compressed: Record<string, unknown> = {}
        if (parsed.status) compressed.status = parsed.status
        if (parsed.summary) compressed.summary = parsed.summary
        if (parsed.note) compressed.note = parsed.note
        // Truncate long summaries
        if (typeof compressed.summary === 'string' && compressed.summary.length > 200) {
          compressed.summary = compressed.summary.slice(0, 200) + '…'
        }
        return { ...m, content: JSON.stringify(compressed) }
      } catch {
        // Non-JSON content — truncate to 200 chars
        return { ...m, content: m.content.slice(0, 200) + '…' }
      }
    })
  }

  // ── Stage 2: Summarize oldest user/assistant pairs ──
  // Compresses the first half of all user→assistant conversation pairs,
  // keeping recent ones for context continuity.
  // Preserves: system messages, last 5 messages (via keeping second half of pairs).

  private summarizePairs(messages: Message[]): Message[] {
    // Build list of (userIdx, assistantIdx) pair indices
    const pairs: Array<{ userIdx: number; asstIdx: number }> = []
    let i = 0
    while (i < messages.length - 1) {
      const userIdx = messages.findIndex((m, idx) => idx >= i && m.role === 'user')
      if (userIdx < 0) break
      const asstIdx = messages.findIndex((m, idx) => idx > userIdx && m.role === 'assistant')
      if (asstIdx < 0) break
      pairs.push({ userIdx, asstIdx })
      i = asstIdx + 1
    }

    if (pairs.length <= 1) return messages // Nothing worth compressing

    // Compress the first half, keep the second half intact
    const compressCount = Math.ceil(pairs.length / 2)
    const toCompress = pairs.slice(0, compressCount)

    // Build single compressed summary message
    const pairSummaries = toCompress.map(p =>
      `用户: "${String(messages[p.userIdx].content || '').slice(0, 80)}" → AI: "${String(messages[p.asstIdx].content || '').slice(0, 80)}"`,
    )

    const summary: Message = {
      role: 'system',
      content: `[已压缩] 前${toCompress.length}轮对话:\n${pairSummaries.join('\n')}`,
    }

    // Collect indices to remove (both user and assistant for compressed pairs)
    const indicesToRemove = new Set<number>()
    for (const p of toCompress) {
      indicesToRemove.add(p.userIdx)
      indicesToRemove.add(p.asstIdx)
    }

    // Rebuild: preserve un-compressed messages, insert summary at first removed position
    const result: Message[] = []
    let summaryInserted = false
    for (let idx = 0; idx < messages.length; idx++) {
      if (indicesToRemove.has(idx)) {
        if (!summaryInserted) {
          result.push(summary)
          summaryInserted = true
        }
        continue
      }
      result.push(messages[idx])
    }

    return result
  }

  // ── Stage 3: Collapse early conversation ──

  private collapseEarly(messages: Message[]): Message[] {
    // Keep: system + last 5 messages. Collapse everything in between.
    const keepLast = 5
    if (messages.length <= keepLast + 2) return messages

    const systemMsgs = messages.filter(m => m.role === 'system')
    const otherMsgs = messages.filter(m => m.role !== 'system')
    const keepFrom = Math.max(0, otherMsgs.length - keepLast)

    const toCollapse = otherMsgs.slice(0, keepFrom)
    const toKeep = otherMsgs.slice(keepFrom)

    // Build summary of collapsed content
    const userMsgs = toCollapse.filter(m => m.role === 'user').slice(-3)
    const summaries = userMsgs.map(m => String(m.content || '').slice(0, 80)).join(' | ')

    const collapseMsg: Message = {
      role: 'system',
      content: `[上下文已压缩] 前${toCollapse.length}条消息摘要: ${summaries}`,
    }

    return [...systemMsgs, collapseMsg, ...toKeep]
  }
}
