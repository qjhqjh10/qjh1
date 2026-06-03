// ── V4 Context Compressor ──
// Claude-style progressive compression. Operates transparently during
// the agent loop — the model continues without interruption.
//
// Thresholds (relative to contextWindow):
//   Stage 1 (70%): Strip verbose tool detail → keep status+summary
//   Stage 2 (80%): Summarize oldest user/assistant pairs
//   Stage 3 (90%): Collapse early conversation into summary
//
// Never compressed: system prompt, last 5 messages, pending tool calls.
//
// Also provides LLM-based compression for user-triggered manual compression
// (right-click → compress in chat UI). Single entry point for all compression.

import type { Message } from '../state/types'
import { estimateTokens, estimateMessages } from '../utils/tokenEstimation'

export type CompressionStage = 'none' | 'strip_detail' | 'summarize_pairs' | 'collapse_early'

const LLM_COMPRESS_PROMPT = `请将以下对话历史压缩为一段简洁的上下文摘要（200-400字），保留关键信息：用户的核心需求和目标、已做出的重要决策、创建/修改了哪些文件及原因、当前任务的进展和下一步、用户的偏好和习惯。`

export interface LLMCompressResult {
  summaryContent: string
  compressedCount: number
  estimatedInputTokens: number
}

export class ContextCompressor {
  private contextWindow: number

  constructor(contextWindow: number = 128_000) {
    this.contextWindow = contextWindow
  }

  /** Update context window size at runtime (e.g. from model config) */
  setContextWindow(tokens: number): void {
    this.contextWindow = tokens
  }

  getContextWindow(): number {
    return this.contextWindow
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
   * Preserves: system prompt (first message), last N messages (protectRecent, default 5), pending tool context.
   */
  compress(messages: Message[], usedTokens: number, protectRecent = 5): Message[] {
    const stage = this.getStage(usedTokens)
    if (stage === 'none') return messages

    switch (stage) {
      case 'strip_detail': return this.stripDetail(messages)
      case 'summarize_pairs': return this.summarizePairs(messages, protectRecent)
      case 'collapse_early': return this.collapseEarly(messages, protectRecent)
      default: return messages
    }
  }

  // ── Stage 1: Strip verbose detail from tool results ──

  private stripDetail(messages: Message[]): Message[] {
    return messages.map(m => {
      if (m.role !== 'tool' || !m.content) return m
      try {
        const parsed = JSON.parse(m.content)
        const compressed: Record<string, unknown> = {}
        if (parsed.status) compressed.status = parsed.status
        if (parsed.summary) compressed.summary = parsed.summary
        // Preserve detail for read tools (ContractExecutor already strips detail for write tools
        // before they enter context). Truncate if excessively long to stay within budget.
        if (parsed.detail && typeof parsed.detail === 'string') {
          compressed.detail = parsed.detail.length > 2000
            ? parsed.detail.slice(0, 2000) + '\n…(压缩截断)'
            : parsed.detail
        }
        if (parsed.note) compressed.note = parsed.note
        return { ...m, content: JSON.stringify(compressed) }
      } catch {
        return { ...m, content: m.content.slice(0, 500) + '…' }
      }
    })
  }

  // ── Stage 2: Summarize oldest user/assistant pairs ──
  // Compresses the first half of all user→assistant conversation pairs,
  // keeping recent ones for context continuity.
  // Preserves: system messages, last 5 messages (via keeping second half of pairs).

  private summarizePairs(messages: Message[], protectRecent = 5): Message[] {
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

    // Compress the first half of pairs, keep the second half intact
    // (paired structure naturally protects recent conversation context)
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

  private collapseEarly(messages: Message[], protectRecent = 5): Message[] {
    // Keep: system + last N messages (protectRecent). Collapse everything in between.
    const keepLast = protectRecent
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

  // ── LLM-based compression (user-triggered, shared by UI + Agent) ──

  /**
   * Build a compression prompt from messages suitable for an LLM summary call.
   * Returns the formatted text and estimated token count.
   * Used by both the UI compress button and potentially by the agent runtime.
   */
  buildCompressPrompt(
    messages: Message[],
    options?: { maxCharsPerMsg?: number; skipRoles?: string[] },
  ): { prompt: string; estimatedInputTokens: number } {
    const maxChars = options?.maxCharsPerMsg ?? 600
    const skip = new Set(options?.skipRoles ?? ['tool'])
    const conversationText = messages
      .filter(m => !skip.has(m.role))
      .map(m => {
        const roleLabel = m.role === 'user' ? '用户' : m.role === 'assistant' ? '助手' : m.role
        const text = (m.content || '').slice(0, maxChars).replace(/\n/g, ' ')
        return `[${roleLabel}]: ${text}`
      })
      .join('\n')

    const prompt = `${LLM_COMPRESS_PROMPT}\n\n对话历史：\n${conversationText}\n\n只输出摘要文本，不要加前缀或解释。`
    return {
      prompt,
      estimatedInputTokens: estimateTokens(prompt),
    }
  }

  /**
   * Execute LLM-based compression.
   * Takes messages, builds prompt, calls AI, returns structured result.
   *
   * @param messages - Messages to compress
   * @param chatFn  - AI chat function (matches aiService.chatWithUsage signature)
   * @param options - Optional tuning
   */
  async compressWithLLM(
    messages: Message[],
    chatFn: (msgs: Array<{ role: string; content: string }>, configId: string) => Promise<{ text: string }>,
    configId: string,
    options?: { maxCharsPerMsg?: number; skipRoles?: string[] },
  ): Promise<LLMCompressResult> {
    const { prompt, estimatedInputTokens } = this.buildCompressPrompt(messages, options)
    const result = await chatFn([{ role: 'user', content: prompt }], configId)
    return {
      summaryContent: result.text || '（压缩摘要生成失败）',
      compressedCount: messages.length,
      estimatedInputTokens,
    }
  }
}
