// ── V4 Agent Runtime ──
// Single unified while loop — model is the sole decision-maker.
// Replaces V3's: 13-state FSM, TaskPipeline, PlanEnforcer, ReflectionEngine,
// HallucinationDetector, BudgetManager, CheckpointManager, CircuitBreaker.

import { AgentEventEmitter } from './runtime/AgentEventEmitter'
import { ContractExecutor } from './context/ContractExecutor'
import { toolRegistry } from './tools/ToolRegistry'
import { useAgentStore } from './store/AgentStore'
import { diagnosticLogger } from './diagnostics/DiagnosticLogger'
import type {
  AgentPhase,
  ToolCallRequest,
  ApiResponse,
  ToolResult,
  ToolExecutionContext,
  Message,
} from './state/types'

// These types are defined IN the imports above — no local redefinition needed.
// ToolResult, ToolExecutionContext, Message are now in state/types.ts

// ── Config ──

export interface V4AgentConfig {
  configId: string
  projectId: string | null
  maxIterations: number
  abortSignal: AbortSignal
}

export interface V4AgentRunInput {
  userMessage: string
  attachments: Array<{ type: string; name: string; content: string }>
}

export interface V4AgentRunResult {
  success: boolean
  text: string
  toolCalls: number
  totalTokens: number
  phase: AgentPhase
  toolsUsed: string[]
  contextBreakdown?: Array<{ domain: string; tokens: number }>
  iterationCount: number
}

// ── Dependency Contracts ──

export interface ToolExecutorFn {
  (args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult>
}

export interface AIService {
  chatWithTools(
    messages: Message[],
    configId: string,
    projectId: string | undefined,
    tools?: unknown[],
  ): Promise<{
    text: string
    toolCalls: ToolCallRequest[] | null
    finishReason: string
    usage?: ApiResponse['usage']
    reasoning_content?: string
  }>
  abortStream(): void
}

export interface ContextAssemblerFn {
  (userMessage: string, history: Message[], projectId: string | null): Promise<{
    systemMessages: Array<{ role: 'system'; content: string }>
    totalTokens: number
    domains: string[]
    breakdown?: Array<{ domain: string; tokens: number }>
  }>
}

// ── Runtime ──

export class V4AgentRuntime {
  private config: V4AgentConfig
  private emitter = new AgentEventEmitter()
  private toolExecutor: ToolExecutorFn | null = null
  private contextAssembler: ContextAssemblerFn | null = null
  private aiService: AIService | null = null
  private tools: unknown[] = []
  private messagesForApi: Message[] = []
  private historyMessages: Message[] = []
  private toolsUsed: string[] = []

  constructor(config: V4AgentConfig) {
    this.config = config
  }

  // ── Dependency Injection ──

  setToolExecutor(fn: ToolExecutorFn): void { this.toolExecutor = fn }
  setContextAssembler(fn: ContextAssemblerFn): void { this.contextAssembler = fn }
  setAIService(svc: AIService): void { this.aiService = svc }
  setTools(tools: unknown[]): void { this.tools = tools }
  setHistory(messages: Message[]): void { this.historyMessages = messages }

  getEmitter(): AgentEventEmitter { return this.emitter }
  getToolResults(): readonly ToolResult[] { return [] }
  getMessagesForApi(): Message[] { return [...this.messagesForApi] }

  abort(): void {
    this.emitter.abort()
  }

  // ── Run ──

  async run(input: V4AgentRunInput): Promise<V4AgentRunResult> {
    const store = useAgentStore.getState()
    const runId = Date.now().toString(36)
    const runStartTime = Date.now()
    const RUN_TIMEOUT = 300_000 // 5 minutes wall-clock

    if (!this.aiService || !this.toolExecutor) {
      return { success: false, text: 'AI 服务未配置', toolCalls: 0, totalTokens: 0, phase: 'ERROR' as AgentPhase, toolsUsed: [], iterationCount: 0 }
    }

    store.startRun(runId)

    // ── ① Assemble initial messages ──
    let totalTokens = 0
    let toolCallsCount = 0
    let collectedText = ''
    this.toolsUsed = []

    store.setPhase('RUNNING' as AgentPhase)
    diagnosticLogger.recordPhaseChange('IDLE' as AgentPhase, 'RUNNING' as AgentPhase)
    this.emitter.emit('agent:state', { from: 'IDLE' as AgentPhase, to: 'RUNNING' as AgentPhase, state: { phase: 'RUNNING' as AgentPhase, iteration: 0, maxIterations: this.config.maxIterations, errors: [] } })

    // Build context
    let contextResult
    if (this.contextAssembler) {
      contextResult = await this.contextAssembler(input.userMessage, this.historyMessages, this.config.projectId)
    } else {
      contextResult = { systemMessages: [], totalTokens: 0, domains: [], breakdown: [] }
    }

    this.messagesForApi = [
      ...contextResult.systemMessages,
      ...this.historyMessages,
      { role: 'user', content: input.userMessage },
    ]

    // ── ② Main loop ──
    let iteration = 0
    let shouldContinue = true

    while (iteration < this.config.maxIterations && shouldContinue) {
      // Abort check
      if (this.config.abortSignal.aborted) {
        shouldContinue = false
        break
      }

      // Wall-clock timeout
      if (Date.now() - runStartTime > RUN_TIMEOUT) {
        collectedText = collectedText || '运行超时'
        shouldContinue = false
        break
      }

      iteration++
      store.setIteration(iteration)
      this.emitter.emit('thinking:start', { intent: `第 ${iteration} 轮`, steps: [], filesNeeded: [], estimatedTokens: 0, timestamp: Date.now() })

      // ── API Call ──
      const isLastIteration = iteration >= this.config.maxIterations
      const toolsForThisRound = isLastIteration ? [] : this.tools

      diagnosticLogger.recordApiCallStart()
      const API_TIMEOUT = 90_000
      let response
      try {
        const apiPromise = this.aiService.chatWithTools(
          this.messagesForApi,
          this.config.configId,
          this.config.projectId || undefined,
          toolsForThisRound,
        )
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`API 超时 (${API_TIMEOUT / 1000}秒)`)), API_TIMEOUT)
        )
        response = await Promise.race([apiPromise, timeoutPromise])
      } catch (apiErr) {
        const errMsg = apiErr instanceof Error ? apiErr.message : 'API 调用失败'
        collectedText = `错误: ${errMsg}`
        shouldContinue = false
        break
      }

      totalTokens += response.usage?.total_tokens || 0
      store.addTokens(response.usage?.total_tokens || 0)
      diagnosticLogger.recordApiCallEnd(response.usage?.total_tokens || 0, (response.toolCalls?.length ?? 0) > 0)

      // ── No tool calls → model is done ──
      if (!response.toolCalls || response.toolCalls.length === 0) {
        collectedText = response.text || ''
        this.emitter.emit('response:streaming', { text: response.text, accumulated: response.text, timestamp: Date.now() })
        shouldContinue = false
        break
      }

      // ── Has tool calls → execute ──
      toolCallsCount += response.toolCalls.length

      // Add assistant message to context (preserve reasoning_content for DeepSeek)
      const assistantMsg: Message = {
        role: 'assistant',
        content: response.text,
        tool_calls: (response.toolCalls || []).map(tc => ({
          type: 'function',
          id: tc.id,
          function: { name: tc.name, arguments: tc.arguments },
        })),
        reasoning_content: response.reasoning_content || undefined,
      }
      this.messagesForApi.push(assistantMsg)

      // ── Execute tools ──
      // Classify: safe (read) tools can run in parallel, write tools sequentially
      const readOnlyCalls: ToolCallRequest[] = []
      const writeCalls: ToolCallRequest[] = []

      for (const tc of response.toolCalls) {
        const perm = toolRegistry.getPermissionLevel(tc.name)
        if (perm === 'AUTO' || perm === 'READ_ASK') {
          readOnlyCalls.push(tc)
        } else {
          writeCalls.push(tc)
        }
      }

      // Execute read-only tools in parallel
      if (readOnlyCalls.length > 0 && !this.config.abortSignal.aborted) {
        await Promise.all(readOnlyCalls.map(tc =>
          this.executeSingleTool(tc, runId, store)
        ))
      }

      // Execute write tools sequentially
      for (const tc of writeCalls) {
        if (this.config.abortSignal.aborted) break
        await this.executeSingleTool(tc, runId, store)
      }

      // ── Last iteration with tools → inject final prompt ──
      if (isLastIteration) {
        this.messagesForApi.push({
          role: 'system',
          content: '[最后轮次] 已达到最大操作轮次。请基于已完成的工具结果生成最终文本回复。',
        })
      }
    }

    // ── ③ Done ──
    diagnosticLogger.recordPhaseChange('RUNNING' as AgentPhase, 'DONE' as AgentPhase)
    store.setIsStreaming(false)
    store.endRun()

    // Fallback: if no text collected, extract from messages
    if (!collectedText) {
      for (let i = this.messagesForApi.length - 1; i >= 0; i--) {
        const m = this.messagesForApi[i]
        if (m.role === 'assistant' && m.content && typeof m.content === 'string' && m.content.trim()) {
          collectedText = m.content
          break
        }
      }
    }
    if (!collectedText) {
      const toolSummaries = this.messagesForApi
        .filter(m => m.role === 'tool' && m.content)
        .slice(-3)
        .map(m => {
          try { return JSON.parse(m.content).summary || '' } catch { return '' }
        })
        .filter(Boolean)
      collectedText = toolSummaries.length > 0
        ? `操作完成：${toolSummaries.reverse().join('；')}。`
        : '操作完成。'
    }

    return {
      success: !this.config.abortSignal.aborted,
      text: collectedText,
      toolCalls: toolCallsCount,
      totalTokens,
      phase: this.config.abortSignal.aborted ? 'ABORTED' as AgentPhase : 'DONE' as AgentPhase,
      toolsUsed: this.toolsUsed,
      contextBreakdown: contextResult.breakdown,
      iterationCount: iteration,
    }
  }

  // ── Tool Execution ──

  private async executeSingleTool(
    tc: ToolCallRequest,
    runId: string,
    store: ReturnType<typeof useAgentStore.getState>,
  ): Promise<void> {
    if (!this.toolsUsed.includes(tc.name)) this.toolsUsed.push(tc.name)

    diagnosticLogger.recordToolStart(tc.id, tc.name)
    store.addToolExecution(tc.id, tc.name)
    this.emitter.emit('tool:started', {
      callId: tc.id, toolName: tc.name,
      phase: 'started', progress: 0,
      message: `${tc.name} 开始执行`,
      timestamp: Date.now(),
    })

    let args: Record<string, unknown>
    try {
      args = JSON.parse(tc.arguments)
    } catch {
      const errResult = { status: 'error' as const, summary: `工具参数 JSON 解析失败` }
      this.messagesForApi.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(errResult) })
      store.completeTool(tc.id, 'error', errResult.summary)
      return
    }

    // Execute (with 60s timeout)
    let result: ToolResult
    if (this.toolExecutor) {
      const TOOL_TIMEOUT = 60_000
      const execPromise = this.toolExecutor(args, {
        projectId: this.config.projectId,
        configId: this.config.configId,
        callId: tc.id,
        toolName: tc.name,
        signal: this.config.abortSignal,
      })
      const timeoutPromise = new Promise<ToolResult>(r =>
        setTimeout(() => r({ status: 'error', summary: `工具 ${tc.name} 执行超时` }), TOOL_TIMEOUT)
      )
      result = await Promise.race([execPromise, timeoutPromise])
    } else {
      result = { status: 'error', summary: '工具执行器未配置' }
    }

    // Emit result
    diagnosticLogger.recordToolEnd(tc.id, tc.name, result.status)
    if (result.status === 'success') {
      store.completeTool(tc.id, 'success', result.summary, result.detail)
      this.emitter.emit('tool:completed', {
        callId: tc.id, toolName: tc.name,
        status: 'success', summary: result.summary, detail: result.detail,
        timestamp: Date.now(),
      })
    } else {
      store.completeTool(tc.id, 'error', result.summary, result.detail)
      this.emitter.emit('tool:failed', {
        callId: tc.id, toolName: tc.name,
        status: 'error', summary: result.summary, detail: result.detail,
        timestamp: Date.now(),
      })
    }

    // Filter result for API context (ContractExecutor: strip verbose detail)
    const { resultForApi, note } = ContractExecutor.filterForContext(tc.name, result)
    const finalResult = note ? { ...resultForApi, note } : resultForApi
    this.messagesForApi.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(finalResult) })
  }
}
