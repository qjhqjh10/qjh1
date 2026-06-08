// ── Bridge Context Builder (v11.5.1) ──
// Shared context assembly logic extracted from V4AgentChatBridge and V4AnthropicChatBridge.
// Eliminates ~150 lines of duplicated code across the two bridges.
//
// Features:
//   - Message classification via shared taskDetection utils
//   - Global index building (with MemoryIndex cache)
//   - KB search / Web search injection
//   - Provider assembly (backward compat — currently ALL_PROVIDERS=[])
//   - planMode support (OpenAI: ThinkingEngine, Anthropic: simple instruction)
//   - planInstruction for complex multi-file tasks
//   - Token estimation + breakdown

import { contextAssembler } from './ContextAssembler'
import { estimateTokens } from '../utils/tokenEstimation'
import { isPureGreeting, hasTaskKeywords, isComplexTask } from '../utils/taskDetection'
import type { Message } from '../state/types'

// ── Types ──

export interface ContextBuilderOptions {
  projectId: string | null
  kbEnabled: boolean
  webSearchEnabled: boolean
  selectedKbFileIds?: string[]
  /** Enable plan-first prompting. OpenAI uses ThinkingEngine; Anthropic uses simple instruction. */
  planMode?: boolean
  /** Only OpenAI: call ThinkingEngine.generatePlanPrompt() for detailed plan injection. */
  enableThinkingPlan?: boolean
}

export interface ContextBuilderResult {
  systemMessages: Array<{ role: 'system'; content: string }>
  totalTokens: number
  domains: string[]
  breakdown: Array<{ domain: string; tokens: number }>
}

// ── Builder ──

export class BridgeContextBuilder {
  constructor(private opts: ContextBuilderOptions) {}

  async buildContext(
    msg: string,
    hist: Message[],
    pid: string | null,
    corePrompt: string,
  ): Promise<ContextBuilderResult> {
    // ── 1. Message classification ──
    const isGreeting = isPureGreeting(msg)

    // ── 2. Global index — 始终构建，第1条就缓存（v9.8.9原始设计）──
    let globalIndex = ''
    try {
      const { buildGlobalIndex } = await import('./MemoryIndex')
      globalIndex = await buildGlobalIndex(pid)
    } catch { /* unavailable */ }

    // ── 3. KB search + Web search ──
    let searchContext = ''
    if (this.opts.kbEnabled && this.opts.projectId) {
      try {
        const { kbService } = await import('@/services/fileService')
        const results = await kbService.search(
          msg, this.opts.projectId, '', 3, this.opts.selectedKbFileIds,
        )
        if (Array.isArray(results) && results.length > 0) {
          searchContext += '\n[知识库]\n' +
            results.map((r: any) => r.content || '').join('\n---\n')
        }
      } catch { /* unavailable */ }
    }
    if (this.opts.webSearchEnabled) {
      try {
        const { kbService } = await import('@/services/fileService')
        const results = await kbService.webSearch(msg.slice(0, 500), 3)
        if (Array.isArray(results) && results.length > 0) {
          searchContext += '\n[网络搜索]\n' +
            results.map((r: any) => r.snippet || r.title || '').join('\n---\n')
        }
      } catch { /* unavailable */ }
    }

    // ── 4. Provider assembly (backward compat — currently ALL_PROVIDERS=[]) ──
    const base = isGreeting
      ? { systemMessages: [] as Array<{ role: 'system'; content: string }>, totalTokens: 0, domains: [] as string[], breakdown: [] as Array<{ domain: string; tokens: number }> }
      : await contextAssembler.assemble(msg, hist, pid)

    // ── 5. planMode injection (dual protocol) ──
    let planPrompt = ''
    if (this.opts.planMode && !isGreeting) {
      if (this.opts.enableThinkingPlan) {
        // OpenAI: use ThinkingEngine for detailed plan prompt
        try {
          const { ThinkingEngine } = await import('../thinking/ThinkingEngine')
          planPrompt = new ThinkingEngine().generatePlanPrompt()
        } catch { /* planPrompt stays empty */ }
      } else {
        // Anthropic: simple plan instruction (no ThinkingEngine dependency)
        planPrompt = '[Plan Mode] 先分析任务→列出步骤→确认→逐步执行。不要直接操作文件。'
      }
    }

    // ── 6. planInstruction (complex multi-file guidance) ──
    const msgIsMultiFile = isComplexTask(msg)
    const planInstruction = (msgIsMultiFile && !this.opts.planMode) ? '逐个文件完成。' : ''

    // ── 7. Token estimation ──
    const coreTokens = estimateTokens(corePrompt)
    const searchTokens = searchContext ? estimateTokens(searchContext) : 0
    const globalIndexTokens = estimateTokens(globalIndex || '')
    const historyTokens = hist.reduce(
      (s, m) => s + estimateTokens(m.content || '') + 4, 0,
    )
    const fullTotal =
      coreTokens + base.totalTokens + searchTokens + globalIndexTokens +
      historyTokens + estimateTokens(msg)

    // ── 9. Assemble system messages ──
    // v11.6.1: 固定2条 system 消息 [0]核心规则 [1]索引
    // 工具定义在 tools 参数中，不在此处重复
    const coreSystemMsg: Message = { role: 'system', content: corePrompt }
    const systemMessages: Array<{ role: 'system'; content: string }> = [
      coreSystemMsg as { role: 'system'; content: string },
      ...(globalIndex ? [{ role: 'system' as const, content: `⬇️ 以下是项目文件索引：\n\n${globalIndex}` }] : []),
    ]

    // ── 10. Build breakdown ──
    const breakdown: Array<{ domain: string; tokens: number }> = [
      { domain: '核心法则(缓存)', tokens: coreTokens },
      { domain: 'Provider+索引', tokens: globalIndexTokens + (base.totalTokens || 0) },
      ...(searchContext ? [{ domain: '知识库/网络搜索', tokens: searchTokens }] : []),
      { domain: '对话历史', tokens: historyTokens },
      { domain: '当前消息', tokens: estimateTokens(msg) },
    ].filter(b => b.tokens > 0)

    return {
      systemMessages,
      totalTokens: fullTotal,
      domains: ['core-prompt', ...base.domains],
      breakdown,
    }
  }
}
