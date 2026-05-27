import { AgentStateMachine } from '../state/AgentStateMachine'
import { AgentEventEmitter } from './AgentEventEmitter'
import { useAgentStore } from '../store/AgentStore'
import { useStore } from '@/store'
import type {
  AgentPhase, AgentState, ToolCallRequest,
  ApiResponse, AgentError,
} from '../state/types'
import type {
  ThinkingContext, ThinkingProgress,
  ToolProgressEvent, ToolResultEvent,
  PermissionRequest,
} from './AgentEventEmitter'
import type { HookEngine } from '../hooks/HookEngine'
import type { LivingSkillManager } from '../living-skills/LivingSkillManager'

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
  success: boolean; text: string; messageCount: number; totalTokens: number; toolCalls: number; phase: AgentPhase
  thinkingPlan: unknown | null; toolsUsed: string[]; hallucinationWarnings: string[]
  kbSources: unknown[]; webSources: unknown[]; images: string[]; reasoningContent: string | null
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
  private hookEngine: HookEngine | null = null
  private budgetManager: { budget: { available: number }; addUsage(tokens: number): void } | null = null
  private hallucinationDetector: { detect(text: string, knownTools: Set<string>): string | null } | null = null
  private checkpointManager: { save(sessionId: string, state: AgentState, messages: Message[], tokenUsage: number, reason: string): Promise<unknown> } | null = null
  private livingSkillManager: LivingSkillManager | null = null

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

  setHookEngine(engine: HookEngine): void {
    this.hookEngine = engine
  }

  setBudgetManager(bm: { budget: { available: number }; addUsage(tokens: number): void }): void { this.budgetManager = bm }
  setHallucinationDetector(hd: { detect(text: string, knownTools: Set<string>): string | null }): void { this.hallucinationDetector = hd }
  setCheckpointManager(cm: { save(sessionId: string, state: AgentState, messages: Message[], tokenUsage: number, reason: string): Promise<unknown> }): void { this.checkpointManager = cm }
  setLivingSkillManager(lsm: LivingSkillManager): void { this.livingSkillManager = lsm }

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

    // ── Hook: SessionStart ──
    if (this.hookEngine) {
      const sessionResults = await this.hookEngine.fire('SessionStart', {
        sessionId: runId,
        projectId: this.config.projectId,
        configId: this.config.configId,
        userMessage: input.userMessage,
        workMode: this.config.workMode,
        timestamp: Date.now(),
      })
      if (sessionResults.some(r => !r.passed)) {
        this.emitter.emit('hook:blocked', { hookName: 'SessionStart', feedback: this.hookEngine.buildBlockingFeedback(sessionResults), timestamp: Date.now() } as any)
        store.endRun()
        return { success: false, text: '', messageCount: 0, totalTokens: 0, toolCalls: 0, phase: 'ABORTED', thinkingPlan: null, toolsUsed: [], hallucinationWarnings: [], kbSources: [], webSources: [], images: [], reasoningContent: null }
      }
    }

    let totalTokens = 0
    let toolCallsCount = 0
    let collectedText = ''
    const toolsUsed: string[] = []
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
          // Auto-checkpoint before API call
          this.checkpointManager?.save(runId, this.fsm.currentState, this.messagesForApi, totalTokens, 'CALLING_API')
          this.emitter.emit('thinking:progress', {
            step: iteration,
            totalSteps: this.config.maxIterations,
            description: `第 ${iteration} 轮 API 调用`,
            timestamp: Date.now(),
          })

          // G6: Budget check before API call
          if (this.budgetManager && this.budgetManager.budget.available < 4096) {
            await this.hookEngine?.fire('PreCompact', {
              sessionId: 'runtime', projectId: this.config.projectId,
              configId: this.config.configId, messageCount: this.messagesForApi.length,
              estimatedTokens: 0, contextWindow: 128000, timestamp: Date.now(),
            })
          }

          // G1: Smart tool selection — pure chat gets 0 tools, saves ~5000 tokens/round
          const isTaskMsg = /创建|新建|修改|编辑|删除|生成|写入|添加|追加|读取|查看|列出|搜索|笔记|草稿|知识库|kb|素材|图片|模板|风格|场景|提示词|prompt|项目|project|规则|学习/.test(input.userMessage)
          const toolsForThisRound = isTaskMsg || iteration > 1 ? this.tools : []

          const response = await this.aiService.chatWithTools(
            this.messagesForApi,
            this.config.configId,
            this.config.projectId || undefined,
            toolsForThisRound,
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
            // G5: Hallucination detection — did AI claim action but not call tools?
            if (this.hallucinationDetector) {
              const hw = this.hallucinationDetector.detect(response.text || '', new Set())
              if (hw) {
                this.messagesForApi.push({ role: 'system', content: `[纠错] 你说完成了操作但没有调用工具。请立即调用对应工具执行。${hw}` })
                this.fsm.setShouldContinue(true)
                if (this.fsm.canTransition('CALLING_API')) { await this.fsm.transition('CALLING_API') }
                continue
              }
            }
            if (this.fsm.canTransition('RESPONDING')) {
              await this.fsm.transition('RESPONDING')
            }
            collectedText = response.text || ''
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
            if (!toolsUsed.includes(tc.name)) toolsUsed.push(tc.name)

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

              // ── Hook: PreToolUse ──
              if (this.hookEngine) {
                const preResults = await this.hookEngine.fire('PreToolUse', {
                  sessionId: runId,
                  projectId: this.config.projectId,
                  configId: this.config.configId,
                  toolName: tc.name,
                  toolArgs: args,
                  timestamp: Date.now(),
                })
                if (preResults.some(r => !r.passed)) {
                  const feedback = this.hookEngine.buildBlockingFeedback(preResults)
                  this.emitter.emit('hook:blocked', { hookName: 'PreToolUse', feedback, timestamp: Date.now() } as any)
                  this.messagesForApi.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ status: 'error', summary: `PreToolUse hook 阻断: ${feedback}` }) })
                  continue
                }
                if (preResults.some(r => r.passed && r.feedback)) {
                  this.emitter.emit('hook:passed', { hookName: 'PreToolUse', passed: true, feedback: '', timestamp: Date.now() } as any)
                }
              }

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

              // ── Hook: PostToolUse ──
              if (this.hookEngine) {
                await this.hookEngine.fire('PostToolUse', {
                  sessionId: runId,
                  projectId: this.config.projectId,
                  configId: this.config.configId,
                  toolName: tc.name,
                  toolArgs: args,
                  toolResult: result,
                  timestamp: Date.now(),
                })
              }

              // G3: Notify file changes so other pages refresh
              if (result.status === 'success' && /^(create_file|edit_file|delete_file|rename_file|create_project|delete_project)$/.test(tc.name)) {
                useStore.getState().setFileEditNotify({ filePath: String(args.file_path || args.project_name || ''), newContent: '__AI_EDITED__' })
              }

              // Living Skill: observe tool outcomes for learning
              if (result.status === 'error') {
                this.livingSkillManager?.onToolError(tc.name, result.summary)
              } else {
                this.livingSkillManager?.onToolSuccess(tc.name, args, result)
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

      // ── Hook: SessionStop ──
      if (this.hookEngine) {
        await this.hookEngine.fire('SessionStop', {
          sessionId: runId,
          projectId: this.config.projectId,
          configId: this.config.configId,
          timestamp: Date.now(),
        })
      }

      // Done
      this.emitter.emit('run:complete', {
        iterations: this.fsm.currentState.iteration,
        toolCalls: toolCallsCount,
        tokenUsage: totalTokens,
      })
      store.endRun()

      // G9: Rich result
      const lastResponse = this.fsm.currentState.lastApiResponse
      return {
        success: this.fsm.currentPhase !== 'ABORTED',
        text: collectedText, messageCount: this.messagesForApi.length,
        totalTokens, toolCalls: toolCallsCount, phase: this.fsm.currentPhase,
        thinkingPlan: null, toolsUsed, hallucinationWarnings: [],
        kbSources: [], webSources: [], images: [],
        reasoningContent: (lastResponse as unknown as Record<string, unknown>)?.reasoning_content as string || null,
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
        success: false, text: '', messageCount: 0,
        totalTokens, toolCalls: 0, phase: 'ERROR',
        thinkingPlan: null, toolsUsed: [], hallucinationWarnings: [],
        kbSources: [], webSources: [], images: [], reasoningContent: null,
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
