import { AgentStateMachine } from '../state/AgentStateMachine'
import { AgentEventEmitter } from './AgentEventEmitter'
import { useAgentStore } from '../store/AgentStore'
import type {
  AgentPhase, AgentState, ToolCallRequest,
  ApiResponse, AgentError,
} from '../state/types'
import type {
  ThinkingContext, ThinkingProgress,
  ToolProgressEvent, ToolResultEvent,
  PermissionRequest,
} from './AgentEventEmitter'

// ── Config ──

export interface AgentConfig {
  configId: string
  projectId: string | null
  workMode: 'plan' | 'action'
  maxIterations: number
  abortSignal: AbortSignal
}

export interface AgentAttachment {
  type: 'file' | 'image'
  name: string
  content: string
  previewUrl?: string
}

export interface AgentRunInput {
  userMessage: string
  attachments: AgentAttachment[]
  kbEnabled: boolean
  webSearchEnabled: boolean
  selectedRefs: { id: string; name: string }[]
}

export interface AgentRunResult {
  success: boolean
  messageCount: number
  totalTokens: number
  toolCalls: number
  phase: AgentPhase
}

// ── Tool Execution Contract ──

export interface ToolExecutionContext {
  projectId: string | null
  configId: string
  callId: string
  toolName: string
  signal: AbortSignal
}

export interface ToolResult {
  status: 'success' | 'error' | 'pending_confirm'
  summary: string
  detail?: string
  confirmArgs?: Record<string, unknown>
}

export interface ToolExecutorFn {
  (args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult>
}

// ── Context Assembler Contract ──

export interface ContextAssemblerFn {
  (userMessage: string, history: Message[], workMode: string): Promise<{
    systemMessages: Array<{ role: 'system'; content: string }>
    totalTokens: number
    domains: string[]
  }>
}

export interface Message {
  role: string
  content: string
  tool_calls?: unknown[]
  tool_call_id?: string
}

// ── AI Service Contract ──

export interface ChatWithToolsResult {
  text: string
  toolCalls: ToolCallRequest[] | null
  finishReason: string
  images?: string[]
  reasoning_content?: string
  usage?: ApiResponse['usage']
}

export interface AIService {
  chatWithTools(
    messages: Message[],
    configId: string,
    projectId: string | undefined,
    tools?: unknown[],
  ): Promise<ChatWithToolsResult>
  abortStream(): void
}

// ── Runtime ──

export class AgentRuntime {
  private fsm: AgentStateMachine
  private emitter: AgentEventEmitter
  private config: AgentConfig
  private toolExecutor: ToolExecutorFn | null = null
  private contextAssembler: ContextAssemblerFn | null = null
  private aiService: AIService | null = null
  private tools: unknown[] = []
  private messagesForApi: Message[] = []
  private historyMessages: Message[] = []

  constructor(config: AgentConfig) {
    this.config = config
    this.emitter = new AgentEventEmitter()
    this.fsm = new AgentStateMachine(config.maxIterations)

    // Mirror state machine changes to the agent store for UI
    this.fsm.onStateChange((from, to, state) => {
      this.emitter.emit('agent:state', { from, to, state })
      const store = useAgentStore.getState()
      store.setPhase(to)
      store.setIteration(state.iteration)
    })
  }

  // ── Dependency Injection (wired in later phases) ──

  setToolExecutor(fn: ToolExecutorFn): void {
    this.toolExecutor = fn
  }

  setContextAssembler(fn: ContextAssemblerFn): void {
    this.contextAssembler = fn
  }

  setAIService(svc: AIService): void {
    this.aiService = svc
  }

  setTools(tools: unknown[]): void {
    this.tools = tools
  }

  setHistory(messages: Message[]): void {
    this.historyMessages = messages
  }

  getEmitter(): AgentEventEmitter {
    return this.emitter
  }

  getState(): Readonly<AgentState> {
    return this.fsm.currentState
  }

  // ── Run ──

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const store = useAgentStore.getState()
    const runId = Date.now().toString(36)
    store.startRun(runId)
    this.emitter.reset()
    this.emitter.emit('run:start', { timestamp: Date.now() })

    let totalTokens = 0
    let toolCallsCount = 0
    this.messagesForApi = []

    try {
      // Step 1: THINKING
      await this.fsm.transition('THINKING')
      const thinking = this.analyzeIntent(input.userMessage)
      this.emitter.emit('thinking:start', thinking)
      store.setThinking(thinking)
      this.emitter.emit('thinking:progress', { step: 0, totalSteps: thinking.steps.length, description: '分析用户意图', timestamp: Date.now() })
      this.emitter.emit('thinking:complete', { plan: thinking, tokenCost: thinking.estimatedTokens })

      // Step 2: ASSEMBLE CONTEXT
      await this.fsm.transition('ASSEMBLING_CONTEXT')
      let contextResult
      if (this.contextAssembler) {
        contextResult = await this.contextAssembler(input.userMessage, this.historyMessages, this.config.workMode)
      } else {
        contextResult = { systemMessages: [], totalTokens: 0, domains: [] }
      }
      this.emitter.emit('context:assembled', {
        systemMessageCount: contextResult.systemMessages.length,
        totalTokens: contextResult.totalTokens,
        domains: contextResult.domains,
        timestamp: Date.now(),
      })

      // Build initial messages
      const userMsg: Message = {
        role: 'user',
        content: input.userMessage,
      }
      this.messagesForApi = [
        ...contextResult.systemMessages,
        ...this.historyMessages,
        userMsg,
      ]

      // Step 3: Main Loop — API Call + Tool Execution
      while (this.fsm.currentPhase !== 'IDLE' && this.fsm.currentPhase !== 'ABORTED') {
        if (this.config.abortSignal.aborted) {
          await this.fsm.transition('ABORTED')
          break
        }

        // CALLING_API
        if (this.fsm.currentPhase === 'ASSEMBLING_CONTEXT'
          || this.fsm.currentPhase === 'CALLING_API'
          || this.fsm.currentPhase === 'REFLECTING') {

          if (this.fsm.currentPhase !== 'CALLING_API') {
            await this.fsm.transition('CALLING_API')
          }

          if (!this.aiService) {
            throw new Error('AI service not configured')
          }

          this.fsm.incrementIteration()
          const iteration = this.fsm.currentState.iteration
          store.setIteration(iteration)
          this.emitter.emit('thinking:progress', {
            step: iteration,
            totalSteps: this.config.maxIterations,
            description: `第 ${iteration} 轮 API 调用`,
            timestamp: Date.now(),
          })

          const response = await this.aiService.chatWithTools(
            this.messagesForApi,
            this.config.configId,
            this.config.projectId || undefined,
            this.tools,
          )

          totalTokens += response.usage?.total_tokens || 0
          store.addTokens(response.usage?.total_tokens || 0)
          if (response.usage?.prompt_tokens) {
            store.setPeakPromptTokens(response.usage.prompt_tokens)
          }
          toolCallsCount += response.toolCalls?.length || 0

          this.fsm.setApiResponse({
            text: response.text,
            toolCalls: response.toolCalls,
            finishReason: response.finishReason,
            usage: response.usage,
          })

          // No tool calls → respond
          if (!response.toolCalls || response.toolCalls.length === 0) {
            if (this.fsm.canTransition('RESPONDING')) {
              await this.fsm.transition('RESPONDING')
            }
            this.emitter.emit('response:streaming', {
              text: response.text,
              accumulated: response.text,
              timestamp: Date.now(),
            })
            this.emitter.emit('response:complete', {
              text: response.text,
              usage: response.usage,
              timestamp: Date.now(),
            })
            this.fsm.setShouldContinue(false)
            await this.reflectAndDecide()
            continue
          }

          // Has tool calls → execute
          if (this.fsm.canTransition('AWAITING_TOOLS')) {
            await this.fsm.transition('AWAITING_TOOLS')
          }
          this.fsm.setPendingToolCalls(response.toolCalls)

          // Add assistant message to API context
          this.messagesForApi.push({
            role: 'assistant',
            content: response.text,
            tool_calls: response.toolCalls,
          } as Message)
        }

        // EXECUTING
        if (this.fsm.currentPhase === 'AWAITING_TOOLS') {
          if (this.fsm.canTransition('EXECUTING')) {
            await this.fsm.transition('EXECUTING')
          }

          const calls = this.fsm.currentState.pendingToolCalls
          for (const tc of calls) {
            if (this.config.abortSignal.aborted) break

            try {
              const args = JSON.parse(tc.arguments)

              // Emit tool started
              store.addToolExecution(tc.id, tc.name)
              this.emitter.emit('tool:started', {
                callId: tc.id, toolName: tc.name,
                phase: 'started', progress: 0,
                message: `${tc.name} 开始执行`,
                timestamp: Date.now(),
              })

              this.emitter.emit('tool:progress', {
                callId: tc.id, toolName: tc.name,
                phase: 'executing', progress: 0.5,
                message: `${tc.name} 执行中...`,
                timestamp: Date.now(),
              })
              store.updateToolProgress({
                callId: tc.id, toolName: tc.name,
                phase: 'executing', progress: 0.5,
                message: `${tc.name} 执行中...`,
                timestamp: Date.now(),
              })

              let result: ToolResult
              if (this.toolExecutor) {
                result = await this.toolExecutor(args, {
                  projectId: this.config.projectId,
                  configId: this.config.configId,
                  callId: tc.id,
                  toolName: tc.name,
                  signal: this.config.abortSignal,
                })
              } else {
                result = { status: 'error', summary: '工具执行器未配置' }
              }

              // Emit result
              if (result.status === 'success') {
                store.completeTool(tc.id, 'success', result.summary, result.detail)
                this.emitter.emit('tool:completed', {
                  callId: tc.id, toolName: tc.name,
                  status: 'success', summary: result.summary,
                  detail: result.detail, timestamp: Date.now(),
                })
              } else {
                store.completeTool(tc.id, 'error', result.summary, result.detail)
                this.emitter.emit('tool:failed', {
                  callId: tc.id, toolName: tc.name,
                  status: 'error', summary: result.summary,
                  detail: result.detail, timestamp: Date.now(),
                })
              }

              // Add tool result to API context
              this.messagesForApi.push({
                role: 'tool',
                tool_call_id: tc.id,
                content: JSON.stringify(result),
              })

            } catch (err) {
              const errorMsg = err instanceof Error ? err.message : 'Unknown error'
              store.completeTool(tc.id, 'error', errorMsg)
              this.emitter.emit('tool:failed', {
                callId: tc.id, toolName: tc.name,
                status: 'error', summary: errorMsg,
                timestamp: Date.now(),
              })
              this.messagesForApi.push({
                role: 'tool',
                tool_call_id: tc.id,
                content: JSON.stringify({ status: 'error', summary: errorMsg }),
              })
            }
          }

          this.fsm.setPendingToolCalls([])
        }

        // REFLECT and decide next
        await this.reflectAndDecide()
      }

      // Done
      this.emitter.emit('run:complete', {
        iterations: this.fsm.currentState.iteration,
        toolCalls: toolCallsCount,
        tokenUsage: totalTokens,
      })
      store.endRun()

      return {
        success: this.fsm.currentPhase !== 'ABORTED',
        messageCount: this.messagesForApi.length,
        totalTokens,
        toolCalls: toolCallsCount,
        phase: this.fsm.currentPhase,
      }

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error'
      await this.fsm.transition('ERROR')
      store.setLastError(errorMsg)
      this.emitter.emit('error', {
        phase: this.fsm.currentPhase,
        message: errorMsg,
        recoverable: false,
        timestamp: Date.now(),
      })
      store.endRun()
      return {
        success: false,
        messageCount: 0,
        totalTokens,
        toolCalls: 0,
        phase: 'ERROR',
      }
    }
  }

  // ── Private helpers ──

  private analyzeIntent(userMessage: string): ThinkingContext {
    const steps: { tool: string; action: string }[] = []
    // Simple keyword-based intent detection (replaced by ThinkingEngine in Phase 4)
    if (/创建|新建/.test(userMessage)) steps.push({ tool: 'create_file', action: '创建文件' })
    if (/编辑|修改|改/.test(userMessage)) steps.push({ tool: 'edit_file', action: '编辑文件' })
    if (/查看|读取|读/.test(userMessage)) steps.push({ tool: 'read_file', action: '读取文件' })
    if (/删除|移除/.test(userMessage)) steps.push({ tool: 'delete_file', action: '删除文件' })

    return {
      intent: userMessage.slice(0, 100),
      steps: steps.length > 0 ? steps : [{ tool: 'read_file', action: '分析需求' }],
      filesNeeded: [],
      estimatedTokens: 500,
      timestamp: Date.now(),
    }
  }

  private async reflectAndDecide(): Promise<void> {
    if (this.fsm.canTransition('REFLECTING')) {
      await this.fsm.transition('REFLECTING')
    }

    const state = this.fsm.currentState
    // Should continue if: API said "tool_calls", not at max iterations, not aborted
    const shouldContinue = (
      state.lastApiResponse?.finishReason === 'tool_calls'
      && state.iteration < state.maxIterations
      && !this.config.abortSignal.aborted
    )
    this.fsm.setShouldContinue(shouldContinue)

    if (shouldContinue) {
      if (this.fsm.canTransition('CALLING_API')) {
        await this.fsm.transition('CALLING_API')
      }
    } else {
      if (this.fsm.canTransition('RESPONDING')) {
        await this.fsm.transition('RESPONDING')
      }
      if (this.fsm.canTransition('IDLE')) {
        await this.fsm.transition('IDLE')
      }
    }
  }

  // ── Abort ──

  abort(): void {
    this.emitter.abort()
    this.fsm.reset()
  }
}
