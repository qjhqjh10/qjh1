// ── V4 Context Compressor ──
// Claude-style progressive compression. Operates transparently during
// the agent loop — the model continues without interruption.
//
// Thresholds (relative to contextWindow):
//   Stage 1 (70%): Strip verbose tool detail → keep status+summary
//   Stage 2 (80%): Summarize oldest user/assistant pairs
//   Stage 3 (90%): Collapse early conversation into summary
//
// Never compressed: system prompt, most recent segment (后半段分段保留), pending tool calls.
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
   * protectRecentRounds (v14 批处理): strip_detail 阶段额外保护最近 N 轮（按 user 消息计数）的 tool detail
   * 不截断——大文件内容被压缩后膨胀→压缩→失真循环的缓解；默认 2 轮。
   */
  compress(messages: Message[], usedTokens: number, protectRecent = 5, protectRecentRounds = 2): Message[] {
    const stage = this.getStage(usedTokens)
    if (stage === 'none') return messages

    switch (stage) {
      case 'strip_detail': return this.stripDetail(messages, this.getRecentBoundary(messages, protectRecentRounds))
      case 'summarize_pairs': return this.summarizePairs(messages)
      case 'collapse_early': return this.collapseEarly(messages, protectRecent)
      default: return messages
    }
  }

  // ── Stage 1: Strip verbose detail from tool results ──

  /**
   * 计算 strip_detail 的保护边界（索引）：boundary 之前的 tool 消息截断 detail，>= boundary 保留。
   * 按 user 消息从尾向前数（每轮恰一条 user，对齐轮次边界 → 不会切在 tool 链中间产生孤儿 tool）。
   * - 找到倒数第 N 个 user → 返回其索引（该轮起全部保护）
   * - 无 user 消息 → 返回 messages.length（全部截断，保持旧行为——纯 tool 链无轮次概念）
   * - 有 user 但不足 N 轮 → 返回 0（全部保护——大文件单轮场景不截断，保护优先于压缩收益）
   */
  private getRecentBoundary(messages: Message[], protectRounds: number): number {
    let found = 0
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        found++
        if (found >= protectRounds) return i
      }
    }
    return found === 0 ? messages.length : 0
  }

  private stripDetail(messages: Message[], boundary: number): Message[] {
    return messages.map((m, i) => {
      if (m.role !== 'tool' || !m.content) return m
      if (i >= boundary) return m  // 最近轮保护：不截断（v14 批处理）
      try {
        const parsed = JSON.parse(m.content)
        const compressed: Record<string, unknown> = {}
        if (parsed.status) compressed.status = parsed.status
        if (parsed.summary) compressed.summary = parsed.summary
        // v13.x: detail 截断为 200 字（read_file 全文正是 detail——此前完整保留等于没压缩）
        if (parsed.detail && typeof parsed.detail === 'string') {
          compressed.detail = parsed.detail.length > 200 ? parsed.detail.slice(0, 200) + '…' : parsed.detail
        }
        if (parsed.note) compressed.note = parsed.note
        return { ...m, content: JSON.stringify(compressed) }
      } catch {
        return m  // Keep original if not valid JSON
      }
    })
  }

  // ── Stage 2: Summarize oldest user/assistant pairs ──
  // Compresses the first half of all user→assistant conversation pairs,
  // keeping recent ones for context continuity.
  // Preserves: system messages, last 5 messages (via keeping second half of pairs).

  private summarizePairs(messages: Message[]): Message[] {
    // H3: 按 user 消息分段 — 每段 = [user, 直到下一个 user 之前的所有消息]
    // （含 assistant(tool_calls)/tool 结果/assistant 正文）。整段加入删除集合，
    // 避免只删 user+assistant 后中间的 tool 结果成为孤儿（无对应 tool_use → API 报错）。
    const segments: Array<{ start: number; end: number }> = []
    let segStart = -1
    for (let idx = 0; idx < messages.length; idx++) {
      if (messages[idx].role === 'user') {
        if (segStart >= 0) segments.push({ start: segStart, end: idx - 1 })
        segStart = idx
      }
    }
    if (segStart >= 0) segments.push({ start: segStart, end: messages.length - 1 })

    if (segments.length <= 1) return messages // Nothing worth compressing

    // Compress the first half of segments, keep the second half intact
    // (paired structure naturally protects recent conversation context)
    const compressCount = Math.ceil(segments.length / 2)
    const toCompress = segments.slice(0, compressCount)

    // Build single compressed summary message.
    // 摘要取段内最后一个非空 assistant 正文（跳过 tool_calls 空 content 消息）；
    // 段内无 assistant 文本时回退到 user 内容；再空则省略该行。
    const pairSummaries = toCompress.map(seg => {
      const userText = String(messages[seg.start].content || '').slice(0, 80)
      let asstText = ''
      for (let k = seg.end; k > seg.start; k--) {
        const m = messages[k]
        if (m.role === 'assistant' && m.content && typeof m.content === 'string') {
          asstText = String(m.content).slice(0, 80)
          break
        }
      }
      // 审查修正: 无 assistant 正文（纯工具轮/aborted）时省略 AI 行，
      // 不再把用户内容标成 AI 回复（原实现会误导模型以为该轮已作答）
      return asstText ? `用户: "${userText}" → AI: "${asstText}"` : `用户: "${userText}"`
    })

    const summary: Message = {
      role: 'system',
      content: `[已压缩] 前${toCompress.length}轮对话:\n${pairSummaries.join('\n')}`,
    }

    // Collect indices to remove (entire segments — user/assistant/tool 一并删除)
    const indicesToRemove = new Set<number>()
    for (const seg of toCompress) {
      for (let k = seg.start; k <= seg.end; k++) indicesToRemove.add(k)
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
    let keepFrom = Math.max(0, otherMsgs.length - keepLast)
    // v13.x: 对齐 user 消息边界——避免切在 assistant(tool_use)/tool 链中间，
    // 否则 tool 结果成为孤儿（无对应 tool_use，API 报错）
    while (keepFrom < otherMsgs.length && otherMsgs[keepFrom].role !== 'user') keepFrom++

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
