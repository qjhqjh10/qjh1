// ── V4 Unified Runtime (v11.0) ──
// Claude-style: simple read→write loop. No phase machine, no hard blocks.
// Model has format knowledge embedded in system prompt → just work.

import { AgentEventEmitter } from './AgentEventEmitter'
import { ContextCompressor } from '../context/ContextCompressor'
// v11.3: skillRegistry removed
import { useAgentStore } from '../store/AgentStore'
import { diagnosticLogger } from '../diagnostics/DiagnosticLogger'
import { executeSingleTool, classifyToolCalls } from './ToolExecutor'
import { isKnowledgeOnly } from '../utils/taskDetection'
import type {
  V4AgentConfig,
  V4AgentRunInput,
  V4AgentRunResult,
  ToolExecutorFn,
  ContextAssemblerFn,
} from './RuntimeTypes'
import type { ProtocolAdapter } from './adapters/ProtocolAdapter'
import type { Message } from '../state/types'

export class V4UnifiedRuntime {
  private config: V4AgentConfig
  private adapter: ProtocolAdapter
  private emitter = new AgentEventEmitter()
  private toolExecutor: ToolExecutorFn | null = null
  private contextAssembler: ContextAssemblerFn | null = null
  private tools: unknown[] = []
  private extendedTools: unknown[] = []
  private toolsExpanded = false
  private messagesForApi: Message[] = []
  private historyMessages: Message[] = []
  private toolsUsed: string[] = []
  private toolCallSteps: Array<{
    tool: string; status: string; summary: string
    durationMs: number; iteration: number
  }> = []
  private compressor: ContextCompressor
  private compressedAt = 0
  private lastCompressLength = 0
  private _consecutiveReads = 0
  private _nudgeCount = 0       // v11.5.1: prevent infinite nudge loop
  private _userMessage = ''

  constructor(config: V4AgentConfig, adapter: ProtocolAdapter) {
    this.config = config
    this.adapter = adapter
    this.compressor = new ContextCompressor(config.contextWindow ?? 128_000)
  }

  // ── Dependency Injection ──
  setToolExecutor(fn: ToolExecutorFn): void { this.toolExecutor = fn }
  setContextAssembler(fn: ContextAssemblerFn): void { this.contextAssembler = fn }
  setTools(tools: unknown[]): void { this.tools = tools }
  setExtendedTools(tools: unknown[]): void { this.extendedTools = tools }
  setHistory(messages: Message[]): void { this.historyMessages = messages }
  setMaxIterations(n: number): void { this.config.maxIterations = n }
  /** v11.3: skill system removed — kept as no-op for backward compat */
  setActiveSkill(_skill: unknown): void { /* no-op */ }

  getEmitter(): AgentEventEmitter { return this.emitter }
  getMessagesForApi(): Message[] { return [...this.messagesForApi] }

  abort(): void { this.emitter.abort() }

  // ── Run ──

  async run(input: V4AgentRunInput): Promise<V4AgentRunResult> {
    const store = useAgentStore.getState()
    const runId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    const runStartTime = Date.now()
    const RUN_TIMEOUT = 300_000

    if (!this.toolExecutor) {
      return {
        success: false, text: '工具执行器未配置',
        toolCalls: 0, totalTokens: 0, promptTokens: 0, completionTokens: 0,
        phase: 'ERROR', toolsUsed: [], toolCallSteps: [], iterationCount: 0,
      }
    }

    // 熔断器
    const circuitCheck = store.checkCircuit()
    if (!circuitCheck.allowed) {
      return {
        success: false, text: circuitCheck.reason || '服务暂时不可用',
        toolCalls: 0, totalTokens: 0, promptTokens: 0, completionTokens: 0,
        phase: 'ERROR', toolsUsed: [], toolCallSteps: [], iterationCount: 0,
      }
    }

    store.startRun(runId)
    store.setPhase('EXECUTE')

    // ── ① Assemble context ──
    let totalPromptTokens = 0
    let totalCompletionTokens = 0
    let totalCacheHitTokens = 0  // v11.5.1: track cache hits
    let totalCost = 0            // v11.5.1: track cost
    let toolCallsCount = 0
    let collectedText = ''
    this.toolsUsed = []
    this.toolCallSteps = []
    this._consecutiveReads = 0
    this._nudgeCount = 0      // reset per run
    this._userMessage = input.userMessage
    let _hasWriteCall = false  // track if model has called any write tool across iterations

    const contextResult = this.contextAssembler
      ? await this.contextAssembler(input.userMessage, this.historyMessages, this.config.projectId)
      : { systemMessages: [], totalTokens: 0, domains: [], breakdown: [] }

    this.messagesForApi = [
      ...contextResult.systemMessages,
      ...this.historyMessages,
      { role: 'user', content: input.userMessage },
    ]

    // ── ② Main loop ──
    let iteration = 0

    while (iteration < this.config.maxIterations) {
      if (this.config.abortSignal.aborted) break
      if (Date.now() - runStartTime > RUN_TIMEOUT) {
        collectedText = collectedText || '运行超时'
        break
      }

      iteration++
      store.setIteration(iteration)
      this.emitter.emit('thinking:start', {
        intent: `第 ${iteration} 轮`, steps: [], filesNeeded: [], estimatedTokens: 0, timestamp: Date.now(),
      })

      // ── Context Compression ──
      const estimatedTokens = this.compressor.estimateMessages(this.messagesForApi)
      if (this.compressor.needsCompression(estimatedTokens)) {
        const newSinceCompress = this.lastCompressLength > 0
          ? this.messagesForApi.length - this.lastCompressLength : 0
        const before = this.messagesForApi.length
        this.messagesForApi = this.compressor.compress(this.messagesForApi, estimatedTokens, Math.max(5, newSinceCompress))
        this.lastCompressLength = this.messagesForApi.length
        this.compressedAt = iteration
      }

      // ── Progressive tool disclosure ──
      if (this.adapter.capabilities.progressiveDisclosure && !this.toolsExpanded && iteration >= 3 && this.extendedTools.length > 0) {
        this.tools = [...this.tools, ...this.extendedTools]
        this.toolsExpanded = true
        diagnosticLogger.recordInfo(`工具扩展: +${this.extendedTools.length}个 (迭代${iteration})`)
      }

      // ── API Call (with single retry for transient failures) ──
      const API_TIMEOUT = 90_000
      let response = undefined
      let lastApiErr: Error | null = null

      diagnosticLogger.recordApiCallStart()
      for (let retry = 0; retry <= 1; retry++) {
        if (this.config.abortSignal.aborted) break
        try {
          const apiPromise = this.adapter.callModel({
            messages: this.messagesForApi,
            tools: this.tools,
            configId: this.config.configId,
            projectId: this.config.projectId || undefined,
            signal: this.config.abortSignal,
          })
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`API 超时 (${API_TIMEOUT / 1000}秒)`)), API_TIMEOUT),
          )
          response = await Promise.race([apiPromise, timeoutPromise])
          break
        } catch (apiErr) {
          lastApiErr = apiErr instanceof Error ? apiErr : new Error('API 调用失败')
          const isTransient = /超时|timeout|network|ECONNREFUSED|ETIMEDOUT|429|503|502/.test(lastApiErr.message)
          if (retry < 1 && isTransient) {
            await new Promise(r => setTimeout(r, 2000 * (retry + 1)))
            continue
          }
          break
        }
      }

      if (!response) {
        collectedText = `错误: ${lastApiErr?.message || 'API 调用失败'}`
        store.recordApiFailure()
        break
      }

      store.recordApiSuccess()
      totalPromptTokens += response.usage.inputTokens
      totalCompletionTokens += response.usage.outputTokens
      totalCacheHitTokens += response.usage.cacheHitTokens || 0
      totalCost += response.usage.cost || 0
      store.addTokens(response.usage.totalTokens)
      diagnosticLogger.recordApiCallEnd(response.usage.totalTokens, response.toolCalls.length > 0)

      // ── finishReason: truncated → inject continuation ──
      if (response.finishReason === 'max_tokens' || response.finishReason === 'length') {
        diagnosticLogger.recordInfo(`输出截断: ${response.finishReason}`)
        this.messagesForApi.push({ role: 'user', content: '[系统] 上一轮输出因token限制被截断。请继续完成。' })
      }

      // ── No tool calls → model is speaking. Trust what it says. ──
      if (response.toolCalls.length === 0) {
        collectedText = response.text || ''

        // H5: Empty response fallback
        if (!collectedText.trim()) {
          this.messagesForApi.push({
            role: 'user',
            content: '请用中文直接生成文本回复。',
          })
          continue
        }

        // ── Done detection (v11.5.1: expanded to cover natural completions) ──
        if (/[Tt]ask\s*[Cc]omplete|全部完成|所有.*已完成|任务完成|操作完毕|验证通过|最终.*完成|没有.*遗漏|都.*完成|已(?:经)?完成[了！。]?|完成了[！。]?|搞定[了！。]?|已处理|上述.*完成|综上/.test(collectedText)) {
          this.emitter.emit('response:streaming', {
            text: collectedText, accumulated: collectedText, timestamp: Date.now(),
          })
          break
        }

        // ── Continuing detection (v11.5.1: removed "首先"/"开始" — too many false positives) ──
        if (/继续|接下来|下一步|接着|还要|剩下|未完|逐个|逐一/.test(collectedText)) {
          continue
        }

        // ── No tools used → 模型自己选择不调工具，接受 ──
        // v11.6.1: 工具始终发送(tool_choice:auto)，模型不调是自主判断，不强制推探索
        if (this.toolsUsed.length === 0) {
          break
        }

        // ── Model used tools, now speaking text ──

        // Track write tool usage across iterations
        const _WRITE_TOOLS_RE = /^(create_file|edit_file|batch_replace|delete_file|rename_file|create_project|delete_project|kb_append_file)$/
        if (this.toolsUsed.some(t => _WRITE_TOOLS_RE.test(t))) _hasWriteCall = true

        // ── Substantial text after using tools → accept (v11.5.1: prevent infinite nudge loop) ──
        if (collectedText.length > 200) {
          this.emitter.emit('response:streaming', {
            text: collectedText, accumulated: collectedText, timestamp: Date.now(),
          })
          break
        }

        // ── Nudge limit: max 2 nudges after tools used (v11.5.1) ──
        if (this._nudgeCount >= 2) {
          // Accept what the model said rather than looping forever
          this.emitter.emit('response:streaming', {
            text: collectedText, accumulated: collectedText, timestamp: Date.now(),
          })
          break
        }

        // Branch A: model is asking user a question → let it wait (v11.5.1: expanded patterns)
        const _isAskingUser = /[？?]/.test(collectedText) &&
          /(?:选择|想怎么|要怎么|如何处理|哪种|哪个|是否|要不要|需要我|你想|我可以|要我|你希望|让我|要不要我|你想怎么|你打算|你来决定)/.test(collectedText)

        if (!_hasWriteCall && this.toolsUsed.length > 0 && !_isAskingUser) {
          // Read-only → push to write with user's original request as context
          const userReq = this._userMessage.length > 200
            ? this._userMessage.slice(0, 200) + '…'
            : this._userMessage
          const msg = this._nudgeCount === 0
            ? `已读取完毕。用户的原始请求是：「${userReq}」。请**立即**用 edit_file 或 create_file 执行用户的具体要求。不要再说"我先看看"或继续读文件。`
            : `⚠️ 最后提醒：用户的请求是「${userReq}」。你现在必须用 edit_file 或 create_file 写入内容。如果确实不需要写入，请直接回复"已完成"并说明原因。`
          this.messagesForApi.push({ role: 'user', content: msg })
        } else {
          // Has write calls OR asking user → soft continue
          this.messagesForApi.push({
            role: 'user',
            content: '还有需要处理的文件吗？请继续。',
          })
        }
        this._nudgeCount++
        continue
      }

      // ── Has tool calls → execute ──
      toolCallsCount += response.toolCalls.length

      // Build assistant message
      const assistantMsg: Message = {
        role: 'assistant',
        content: response.text,
        tool_calls: response.toolCalls.map(tc => ({
          type: 'function' as const,
          id: tc.id,
          function: { name: tc.name, arguments: tc.arguments },
        })),
        thinkingBlocks: response.thinkingBlocks,  // v11.5.1: preserve for multi-turn
      } as Message
      if (response.reasoningContent) store.setStreamingText(response.reasoningContent)
      this.messagesForApi.push(assistantMsg)

      // Execute tools: reads parallel, writes sequential
      const { readOnlyCalls, writeCalls } = classifyToolCalls(response.toolCalls)

      const execCtx = {
        toolExecutor: this.toolExecutor!,
        projectId: this.config.projectId,
        configId: this.config.configId,
        abortSignal: this.config.abortSignal,
        messagesForApi: this.messagesForApi,
        toolsUsed: this.toolsUsed,
        toolCallSteps: this.toolCallSteps,
        emitter: this.emitter,
        _consecutiveReads: this._consecutiveReads,
        iteration,
        store: {
          addToolExecution: (id: string, name: string) => store.addToolExecution(id, name),
          completeTool: (id: string, status: 'success' | 'error', summary: string, detail?: string) =>
            store.completeTool(id, status, summary, detail),
          setStreamingText: (text: string) => store.setStreamingText(text),
        },
      }

      // Parallel reads
      if (readOnlyCalls.length > 0 && !this.config.abortSignal.aborted) {
        await Promise.all(readOnlyCalls.map(tc => executeSingleTool(tc, execCtx)))
      }
      // Sequential writes
      for (const tc of writeCalls) {
        if (this.config.abortSignal.aborted) break
        await executeSingleTool(tc, execCtx)
      }
      this._consecutiveReads = execCtx._consecutiveReads
    }

    // ── ③ Done ──
    store.setIsStreaming(false)
    store.endRun()

    // Fallback text: prefer last assistant message with actual content
    if (!collectedText) {
      for (let i = this.messagesForApi.length - 1; i >= 0; i--) {
        const m = this.messagesForApi[i]
        if (m.role === 'assistant' && m.content && typeof m.content === 'string' && m.content.trim()) {
          collectedText = m.content
          break
        }
      }
    }
    if (!collectedText && toolCallsCount > 0) {
      const toolsSummary = this.toolCallSteps.slice(-3).map(s => s.summary).filter(Boolean)
      if (toolsSummary.length > 0) {
        // Knowledge/chat question that triggered exploration → guide model to actually answer
        if (isKnowledgeOnly(this._userMessage)) {
          collectedText = `已查看项目状态。请问你需要什么帮助？`
        } else {
          collectedText = `操作完成：${toolsSummary.reverse().join('；')}。`
        }
      } else {
        collectedText = `操作完成（${toolCallsCount} 次工具调用）。`
      }
    }

    return {
      success: !this.config.abortSignal.aborted,
      text: collectedText,
      toolCalls: toolCallsCount,
      totalTokens: totalPromptTokens + totalCompletionTokens,
      promptTokens: totalPromptTokens,
      completionTokens: totalCompletionTokens,
      cacheHitTokens: totalCacheHitTokens,
      cost: totalCost,
      phase: this.config.abortSignal.aborted ? 'ABORTED' : 'DONE',
      toolsUsed: this.toolsUsed,
      toolCallSteps: this.toolCallSteps,
      contextBreakdown: contextResult.breakdown,
      iterationCount: iteration,
    }
  }
}

// v11.5.1: _isChatQuestion removed — use isKnowledgeOnly from taskDetection.ts
