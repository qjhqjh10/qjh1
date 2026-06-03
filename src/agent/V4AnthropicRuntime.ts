// ── V4 Anthropic Runtime ──
// Anthropic Messages API 协议专用。使用流式 content blocks 替代 OpenAI 的
// request/response while 循环。模型在同一个流式响应中交替输出 text 和 tool_use
// blocks，运行时只需响应式执行工具并反馈结果。
//
// 相比 V4AgentRuntime（OpenAI 协议）可省去的逻辑：
//   - 渐进工具展开（模型自然选择）
//   - 迭代提示注入（无"轮次"概念）
//   - 手动并行/顺序工具控制（流式自然顺序）
//   - 空响应兜底（流式无空响应）
//   - reasoning_content 剥离（Anthropic thinking blocks 保留）

import { AgentEventEmitter } from './runtime/AgentEventEmitter'
import { ContractExecutor } from './context/ContractExecutor'
import { ContextCompressor } from './context/ContextCompressor'
import { toolRegistry } from './tools/ToolRegistry'
import { useAgentStore } from './store/AgentStore'
import { diagnosticLogger } from './diagnostics/DiagnosticLogger'
import type {
  AgentPhase,
  ToolCallRequest,
  ToolResult,
  ToolExecutionContext,
  Message,
} from './state/types'
import type { AnthropicToolDef, AnthropicStreamResult } from '@/types/anthropicTypes'

// ── Anthropic AIService 接口（不同于 OpenAI 版本） ──

export interface AnthropicAIService {
  chatAnthropicStream(params: {
    system: string[]
    messages: Array<{
      role: string
      content: Array<{
        type: string
        text?: string
        tool_use_id?: string
        id?: string
        name?: string
        input?: Record<string, unknown>
        content?: string
        thinking?: string
        signature?: string
      }>
    }>
    configId: string
    projectId?: string
    tools?: AnthropicToolDef[]
  }): Promise<AnthropicStreamResult>
  abortStream(): void
}

// ── Config（与 V4AgentRuntime 相同） ──

export interface V4AgentConfig {
  configId: string
  projectId: string | null
  maxIterations: number
  abortSignal: AbortSignal
  contextWindow?: number
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
  promptTokens: number
  completionTokens: number
  phase: AgentPhase
  toolsUsed: string[]
  toolCallSteps: Array<{
    tool: string; status: string; summary: string
    durationMs: number; iteration: number
  }>
  contextBreakdown?: Array<{ domain: string; tokens: number }>
  iterationCount: number
}

export interface ToolExecutorFn {
  (args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult>
}

export interface ContextAssemblerFn {
  (
    userMessage: string,
    history: Message[],
    projectId: string | null,
  ): Promise<{
    systemMessages: Array<{ role: 'system'; content: string }>
    totalTokens: number
    domains: string[]
    breakdown?: Array<{ domain: string; tokens: number }>
  }>
}

// ── 类型转换工具 ──

function toAnthropicTools(openaiTools: unknown[]): AnthropicToolDef[] {
  return openaiTools
    .map((t: any) => {
      const fn = t?.function
      if (!fn) return null
      return {
        name: fn.name,
        description: fn.description || '',
        input_schema: {
          type: 'object' as const,
          properties: fn.parameters?.properties || {},
          required: fn.parameters?.required || [],
        },
      }
    })
    .filter(Boolean) as AnthropicToolDef[]
}

function messagesToAnthropic(msgs: Message[]): Array<{
  role: string
  content: Array<{
    type: string
    text?: string
    tool_use_id?: string
    id?: string
    name?: string
    input?: Record<string, unknown>
    content?: string
  }>
}> {
  const result: Array<{
    role: string
    content: Array<{
      type: string
      text?: string
      tool_use_id?: string
      id?: string
      name?: string
      input?: Record<string, unknown>
      content?: string
    }>
  }> = []

  for (const m of msgs) {
    if (m.role === 'system') continue // system 作为独立参数传递

    const content: Array<{
      type: string
      text?: string
      tool_use_id?: string
      id?: string
      name?: string
      input?: Record<string, unknown>
      content?: string
    }> = []

    if (m.role === 'tool') {
      // 工具结果 → user 消息（Anthropic 要求）
      content.push({
        type: 'tool_result',
        tool_use_id: (m as any).tool_call_id || '',
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      })
      result.push({ role: 'user', content })
    } else if (m.role === 'assistant' && (m as any).tool_calls) {
      // Assistant 含工具调用
      if (m.content && typeof m.content === 'string' && m.content.trim()) {
        content.push({ type: 'text', text: m.content })
      }
      for (const tc of (m as any).tool_calls) {
        let input: Record<string, unknown> = {}
        try {
          input = typeof tc.function?.arguments === 'string'
            ? JSON.parse(tc.function.arguments)
            : (tc.function?.arguments || {})
        } catch { /* keep empty */ }
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function?.name || tc.name,
          input,
        })
      }
      result.push({ role: 'assistant', content })
    } else {
      // 普通 user/assistant 消息
      const text = typeof m.content === 'string' ? m.content : ''
      if (text) content.push({ type: 'text', text })
      if (content.length === 0) content.push({ type: 'text', text: '' })
      result.push({ role: m.role, content })
    }
  }

  return result
}

// ── Runtime ──

export class V4AnthropicRuntime {
  private config: V4AgentConfig
  private emitter = new AgentEventEmitter()
  private toolExecutor: ToolExecutorFn | null = null
  private contextAssembler: ContextAssemblerFn | null = null
  private aiService: AnthropicAIService | null = null
  private tools: unknown[] = []
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

  constructor(config: V4AgentConfig) {
    this.config = config
    this.compressor = new ContextCompressor(config.contextWindow ?? 128_000)
  }

  // ── Dependency Injection ──

  setToolExecutor(fn: ToolExecutorFn): void { this.toolExecutor = fn }
  setContextAssembler(fn: ContextAssemblerFn): void { this.contextAssembler = fn }
  setAIService(svc: AnthropicAIService): void { this.aiService = svc }
  setTools(tools: unknown[]): void { this.tools = tools }
  setHistory(messages: Message[]): void { this.historyMessages = messages }

  getEmitter(): AgentEventEmitter { return this.emitter }

  abort(): void {
    this.emitter.abort()
  }

  // ── Run ──

  async run(input: V4AgentRunInput): Promise<V4AgentRunResult> {
    const store = useAgentStore.getState()
    const runStartTime = Date.now()
    const RUN_TIMEOUT = 300_000

    if (!this.aiService || !this.toolExecutor) {
      return {
        success: false, text: 'AI 服务未配置',
        toolCalls: 0, totalTokens: 0, promptTokens: 0, completionTokens: 0,
        phase: 'ERROR' as AgentPhase, toolsUsed: [], toolCallSteps: [],
        iterationCount: 0,
      }
    }

    store.startRun('anthropic_run')
    store.setPhase('RUNNING' as AgentPhase)
    diagnosticLogger.recordPhaseChange('IDLE' as AgentPhase, 'RUNNING' as AgentPhase)

    let totalPromptTokens = 0
    let totalCompletionTokens = 0
    let toolCallsCount = 0
    let collectedText = ''
    this.toolsUsed = []
    this.toolCallSteps = []

    // ① 构建上下文
    let contextResult
    if (this.contextAssembler) {
      contextResult = await this.contextAssembler(
        input.userMessage, this.historyMessages, this.config.projectId,
      )
    } else {
      contextResult = { systemMessages: [], totalTokens: 0, domains: [], breakdown: [] }
    }

    const systemMessages = contextResult.systemMessages
    this.messagesForApi = [
      ...systemMessages,
      ...this.historyMessages,
      { role: 'user', content: input.userMessage },
    ]

    // ② 提取 system 文本（Anthropic 作为顶层参数）
    const systemTexts = systemMessages.map(m => m.content)

    // ③ 主循环（Anthropic 流式）
    let iteration = 0
    let shouldContinue = true

    while (iteration < this.config.maxIterations && shouldContinue) {
      if (this.config.abortSignal.aborted) break
      if (Date.now() - runStartTime > RUN_TIMEOUT) {
        collectedText = collectedText || '运行超时'
        break
      }

      iteration++
      store.setIteration(iteration)

      // 上下文压缩（与 OpenAI Runtime 相同逻辑）
      const estimatedTokens = this.compressor.estimateMessages(this.messagesForApi)
      if (this.compressor.needsCompression(estimatedTokens)) {
        const stage = this.compressor.getStage(estimatedTokens)
        const newSinceCompress = this.lastCompressLength > 0
          ? this.messagesForApi.length - this.lastCompressLength
          : 0
        const protectRecent = Math.max(5, newSinceCompress)
        const before = this.messagesForApi.length
        this.messagesForApi = this.compressor.compress(
          this.messagesForApi, estimatedTokens, protectRecent,
        )
        this.lastCompressLength = this.messagesForApi.length
        diagnosticLogger.recordInfo(
          `[Anthropic] 压缩: ${stage} | ${before}→${this.messagesForApi.length}条`,
        )
        this.compressedAt = iteration
      }

      // 转换消息格式
      const anthropicMessages = messagesToAnthropic(this.messagesForApi)
      const anthropicTools = toAnthropicTools(this.tools)

      // 调用 Anthropic 流式 API
      diagnosticLogger.recordApiCallStart()
      let response: AnthropicStreamResult

      try {
        response = await this.aiService.chatAnthropicStream({
          system: systemTexts,
          messages: anthropicMessages,
          configId: this.config.configId,
          projectId: this.config.projectId || undefined,
          tools: anthropicTools.length > 0 ? anthropicTools : undefined,
        })
      } catch (apiErr) {
        const errMsg = apiErr instanceof Error ? apiErr.message : 'API 调用失败'
        collectedText = `错误: ${errMsg}`
        shouldContinue = false
        break
      }

      const promptTok = response.usage?.input_tokens || 0
      const completionTok = response.usage?.output_tokens || 0
      totalPromptTokens += promptTok
      totalCompletionTokens += completionTok
      store.addTokens(promptTok + completionTok)
      diagnosticLogger.recordApiCallEnd(
        promptTok + completionTok,
        response.toolUses.length > 0,
      )

      collectedText = response.text || collectedText
      this.emitter.emit('response:streaming', {
        text: collectedText,
        accumulated: collectedText,
        timestamp: Date.now(),
      })

      // 无工具调用 → 完成
      if (response.toolUses.length === 0) {
        // 如果有文本，直接结束；无文本则追加提示
        if (!collectedText.trim()) {
          this.messagesForApi.push({
            role: 'user',
            content: '请用中文直接生成文本回复。',
          })
          continue
        }
        shouldContinue = false
        break
      }

      // 有工具调用 → 构建 assistant 消息并执行
      toolCallsCount += response.toolUses.length

      const assistantContent: Array<{ type: string; text?: string; tool_use?: { id: string; name: string; input: Record<string, unknown> } }> = []
      if (response.text) {
        assistantContent.push({ type: 'text', text: response.text })
      }
      for (const tu of response.toolUses) {
        assistantContent.push({ type: 'tool_use', tool_use: tu })
      }

      this.messagesForApi.push({
        role: 'assistant',
        content: JSON.stringify(assistantContent),  // 内部存储序列化
      } as Message)

      // 转换 toolUses 为统一的 ToolCallRequest 格式
      const toolCalls: ToolCallRequest[] = response.toolUses.map(tu => ({
        id: tu.id,
        name: tu.name,
        arguments: JSON.stringify(tu.input),
      }))

      // 按权限分组执行（与 OpenAI Runtime 相同逻辑）
      const readOnlyCalls: ToolCallRequest[] = []
      const writeCalls: ToolCallRequest[] = []

      for (const tc of toolCalls) {
        const perm = toolRegistry.getPermissionLevel(tc.name)
        if (perm === 'AUTO' || perm === 'READ_ASK') {
          readOnlyCalls.push(tc)
        } else {
          writeCalls.push(tc)
        }
      }

      // 并行执行只读工具
      if (readOnlyCalls.length > 0 && !this.config.abortSignal.aborted) {
        await Promise.all(
          readOnlyCalls.map(tc => this.executeSingleTool(tc, store, iteration)),
        )
      }

      // 顺序执行写入工具
      for (const tc of writeCalls) {
        if (this.config.abortSignal.aborted) break
        await this.executeSingleTool(tc, store, iteration)
      }

      // Anthropic 要求：所有 tool_result 必须合并在一条 user 消息中
      // 这已通过 messagesForApi 中的 tool 角色消息在下一轮 messagesToAnthropic 中合并
    }

    // ④ 完成
    diagnosticLogger.recordPhaseChange('RUNNING' as AgentPhase, 'DONE' as AgentPhase)
    store.setIsStreaming(false)
    store.endRun()

    if (!collectedText) {
      for (let i = this.messagesForApi.length - 1; i >= 0; i--) {
        const m = this.messagesForApi[i]
        if (
          m.role === 'assistant' &&
          typeof m.content === 'string' &&
          m.content.trim()
        ) {
          collectedText = m.content
          break
        }
      }
    }
    if (!collectedText) {
      collectedText = `操作完成（${toolCallsCount} 次工具调用）。`
    }

    return {
      success: !this.config.abortSignal.aborted,
      text: collectedText,
      toolCalls: toolCallsCount,
      totalTokens: totalPromptTokens + totalCompletionTokens,
      promptTokens: totalPromptTokens,
      completionTokens: totalCompletionTokens,
      phase: this.config.abortSignal.aborted ? 'ABORTED' as AgentPhase : 'DONE' as AgentPhase,
      toolsUsed: this.toolsUsed,
      toolCallSteps: this.toolCallSteps,
      contextBreakdown: contextResult.breakdown,
      iterationCount: iteration,
    }
  }

  // ── Tool Execution（与 OpenAI Runtime 相同） ──

  private async executeSingleTool(
    tc: ToolCallRequest,
    store: ReturnType<typeof useAgentStore.getState>,
    iteration = 0,
  ): Promise<void> {
    if (!this.toolsUsed.includes(tc.name)) this.toolsUsed.push(tc.name)

    diagnosticLogger.recordToolStart(tc.id, tc.name)
    store.addToolExecution(tc.id, tc.name)

    let args: Record<string, unknown>
    try {
      args = JSON.parse(tc.arguments)
    } catch {
      const errResult = { status: 'error' as const, summary: '工具参数 JSON 解析失败' }
      this.messagesForApi.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(errResult),
      } as Message)
      store.completeTool(tc.id, 'error', errResult.summary)
      return
    }

    const t0 = Date.now()
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
        setTimeout(
          () => r({ status: 'error', summary: `工具 ${tc.name} 执行超时` }),
          TOOL_TIMEOUT,
        ),
      )
      result = await Promise.race([execPromise, timeoutPromise])
    } else {
      result = { status: 'error', summary: '工具执行器未配置' }
    }

    const durationMs = Date.now() - t0
    this.toolCallSteps.push({
      tool: tc.name,
      status: result.status,
      summary: result.summary || '',
      durationMs,
      iteration,
    })

    diagnosticLogger.recordToolEnd(tc.id, tc.name, result.status)
    if (result.status === 'success') {
      store.completeTool(tc.id, 'success', result.summary, result.detail)
    } else {
      store.completeTool(tc.id, 'error', result.summary, result.detail)
    }

    // 过滤结果后加入上下文（ContractExecutor）
    const { resultForApi } = ContractExecutor.filterForContext(tc.name, result)
    if (iteration > 1 && resultForApi.detail && resultForApi.detail.length > 500) {
      resultForApi.detail = resultForApi.detail.slice(0, 500) + '…(截断)'
    }

    this.messagesForApi.push({
      role: 'tool',
      tool_call_id: tc.id,
      content: JSON.stringify(resultForApi),
    } as Message)
  }
}
