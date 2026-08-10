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

// v15.3.1: 压缩阈值可参数化（主 agent 85% 深度 / 子 agent 75% 渐进）
export interface CompressionThresholds {
  /** strip_detail 触发比例（工具详情截断），默认 0.7 */
  strip: number
  /** summarize_pairs 触发比例（早期轮次摘要），默认 0.8 */
  summarize: number
  /** collapse_early 触发比例（早期对话折叠），默认 0.9 */
  collapse: number
}

export const DEFAULT_COMPRESSION_THRESHOLDS: CompressionThresholds = { strip: 0.7, summarize: 0.8, collapse: 0.9 }

const LLM_COMPRESS_PROMPT = `请将以下对话历史压缩为一段简洁的上下文摘要（200-400字），保留关键信息：用户的核心需求和目标、已做出的重要决策、创建/修改了哪些文件及原因、当前任务的进展和下一步、用户的偏好和习惯。`

export interface LLMCompressResult {
  summaryContent: string
  compressedCount: number
  estimatedInputTokens: number
}

export class ContextCompressor {
  private contextWindow: number
  private thresholds: CompressionThresholds
  /** 达到该比例时用 compressDeep（链式一次到底，Claude Code 式回退 ~15%）——不设则始终渐进 compress */
  private deepAt: number | null

  constructor(
    contextWindow: number = 1_000_000,  // v14.9: 默认 1M
    options?: { thresholds?: Partial<CompressionThresholds>; deepAt?: number },
  ) {
    this.contextWindow = contextWindow
    this.thresholds = { ...DEFAULT_COMPRESSION_THRESHOLDS, ...options?.thresholds }
    this.deepAt = options?.deepAt ?? null
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
    if (pct >= this.thresholds.collapse) return 'collapse_early'
    if (pct >= this.thresholds.summarize) return 'summarize_pairs'
    if (pct >= this.thresholds.strip) return 'strip_detail'
    return 'none'
  }

  needsCompression(usedTokens: number): boolean {
    return this.getStage(usedTokens) !== 'none'
  }

  /** v15.3.1: 是否达到"深度压缩"阈值（链式一次到底） */
  shouldDeepCompress(usedTokens: number): boolean {
    return this.deepAt !== null && usedTokens / this.contextWindow >= this.deepAt
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

  /**
   * v15.3.1: 链式一次到底压缩（Claude Code 式）——达到 deepAt 阈值时调用：
   * strip 旧工具详情 → 早期轮次摘要 → 早期对话折叠（保留最近 N 条 + system 摘要），
   * 一次压缩到低水位（进度条从 ~85% 回退到 ~15%）。
   * 逐阶段调用（每步压缩后的内容参与下一步），与 compress 的单阶段互斥。
   */
  compressDeep(messages: Message[], usedTokens: number, protectRecent = 5, protectRecentRounds = 2): Message[] {
    if (!this.needsCompression(usedTokens)) return messages
    let result = this.stripDetail(messages, this.getRecentBoundary(messages, protectRecentRounds))
    result = this.summarizePairs(result)
    result = this.collapseEarly(result, protectRecent)
    return result
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
    // v16.0.1(审计 M3): 单 user 消息（或 user 不足 protectRounds）时原返回 0 = 全部保护 →
    // strip_detail 恒不生效，压缩空转到 95% 才 collapse。改按"最近 N 条 tool 消息"计数保护：
    // 截断更早的 tool detail，最近 N 条工具结果仍完整（strip 只截 detail 不删消息，无孤儿风险）
    if (found > 0) {
      let toolFound = 0
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'tool') {
          toolFound++
          if (toolFound >= protectRounds) return i
        }
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
        let anyKept = false
        if (parsed.status) { compressed.status = parsed.status; anyKept = true }
        if (parsed.summary) { compressed.summary = parsed.summary; anyKept = true }
        // v13.x: detail 截断为 200 字（read_file 全文正是 detail——此前完整保留等于没压缩）
        if (parsed.detail && typeof parsed.detail === 'string') {
          compressed.detail = parsed.detail.length > 200 ? parsed.detail.slice(0, 200) + '…' : parsed.detail
          anyKept = true
        }
        if (parsed.note) { compressed.note = parsed.note; anyKept = true }
        // v14.6.1: 非契约 shape 的合法 JSON（legacy 历史/数组/嵌套）四个字段全缺 →
        // 压缩成 "{}" 销毁内容；无法识别契约结构时保留原文
        if (!anyKept) return m
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
    // v16.0.3(审查修复): 首段 user（原始任务描述）保留 400 字——与 collapseEarly 的
    // v16.0.1 修复同族：原压成 80 字 → 压缩后模型丢失核心需求（单 user run 的折叠区
    // 恰是用户请求全文）。仅首段（索引 0）享受长保护，其余段维持 80 字。
    const pairSummaries = toCompress.map((seg, segIdx) => {
      const userFull = String(messages[seg.start].content || '')
      const userText = segIdx === 0 ? userFull.slice(0, 400) : userFull.slice(0, 80)
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

    // v14.6.1: 无可折叠消息（protectRecent 过大吞掉全部）→ 返回原文——
    // 原实现注入"前0条消息摘要:"空垃圾消息且零压缩，恰在 90% 最需压缩时失效
    if (toCollapse.length === 0) return messages

    // Build summary of collapsed content
    // v16.0.1(审计 M2): 首条 user 保留 400 字——折叠区第一条 user 常是用户原始请求，
    // 压成 80 字 → run 中途永久丢失核心需求（单 user run 的折叠区恰是用户请求全文）
    const userMsgs = toCollapse.filter(m => m.role === 'user').slice(-3)
    const summaries = userMsgs.map((m, i) => String(m.content || '').slice(0, i === 0 ? 400 : 80)).join(' | ')

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
