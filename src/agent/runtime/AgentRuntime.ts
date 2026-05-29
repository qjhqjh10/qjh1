import { AgentStateMachine } from '../state/AgentStateMachine'
import { AgentEventEmitter } from './AgentEventEmitter'
import { diagnosticLogger } from '../diagnostics/DiagnosticLogger'
import { useAgentStore } from '../store/AgentStore'
import { useStore } from '@/store'
import type {
  AgentPhase, AgentState, ToolCallRequest,
  ApiResponse,
} from '../state/types'
import type {
  ThinkingContext, ThinkingProgress,
  ToolProgressEvent, ToolResultEvent,
  PermissionRequest,
} from './AgentEventEmitter'
import type { HookEngine } from '../hooks/HookEngine'
import type { LivingSkillManager } from '../living-skills/LivingSkillManager'
import { ThinkingEngine } from '../thinking/ThinkingEngine'
import { isTaskMessage } from '../utils/taskDetection'

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
  evaluationScore?: number | null; evaluationSuggestions?: string[]
  gcReport?: { totalIssues: number; issues: Array<{ type: string; severity: string; location: string; description: string; fixInstruction: string }>; summary: string } | null
  contextBreakdown?: Array<{ domain: string; tokens: number }>
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
  (userMessage: string, history: Message[], projectId: string | null, workMode?: string): Promise<{
    systemMessages: Array<{ role: 'system'; content: string }>
    totalTokens: number
    domains: string[]
    breakdown?: Array<{ domain: string; tokens: number }>
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

// ── Dependencies Interface ──

export interface AgentDependencies {
  toolExecutor?: ToolExecutorFn
  contextAssembler?: ContextAssemblerFn
  aiService?: AIService
  tools?: unknown[]
  hookEngine?: HookEngine
  budgetManager?: AgentRuntime['budgetManager']
  hallucinationDetector?: AgentRuntime['hallucinationDetector']
  checkpointManager?: AgentRuntime['checkpointManager']
  livingSkillManager?: LivingSkillManager
  reflectionEngine?: AgentRuntime['reflectionEngine']
  constraintEngine?: AgentRuntime['constraintEngine']
  policyEngine?: AgentRuntime['policyEngine']
  hallucinationCallback?: (text: string) => void
  credentialBroker?: AgentRuntime['credentialBroker']
  capabilityHandleId?: string
  evaluationPipeline?: AgentRuntime['evaluationPipeline']
  gcAgent?: AgentRuntime['gcAgent']
}

// ── Read-only tools: their detail (file contents) is stripped from API context
// to prevent context bloat. The AI can re-read files when needed.
const READ_ONLY_TOOLS = new Set(['read_file', 'list_directory', 'search_files', 'search_content', 'kb_list', 'kb_read', 'kb_search', 'list_notes', 'read_note', 'list_rules'])

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
  private budgetManager: { budget: { available: number; reserved: number; contextWindow: number }; addUsage(tokens: number): void; reset(): void; getCompressionStage(): string; shouldCompress(messages: unknown[]): boolean; shouldTriggerCompactHook(): boolean; compressMessages(messages: Array<{ role: string; content: string; [key: string]: unknown }>): Array<{ role: string; content: string; [key: string]: unknown }> } | null = null
  private hallucinationDetector: { detect(text: string, knownTools: Set<string>): string | null } | null = null
  private checkpointManager: { save(sessionId: string, state: AgentState, messages: Message[], tokenUsage: number, reason: string): Promise<unknown> } | null = null
  private livingSkillManager: LivingSkillManager | null = null
  private reflectionEngine: { reflect(results: ToolResult[], toolNames: string[]): { shouldRetry: boolean; retrySuggestions: string[]; summary: string }; buildReflectionInject(r: { retrySuggestions: string[] }): string } | null = null
  private constraintEngine: { check(args: Record<string, unknown>): { passed: boolean; message: string } } | null = null
  private policyEngine: { evaluate(toolName: string, args?: Record<string, unknown>): { effect: string; matchedPolicy: string | null; reason: string; requiresUserApproval: boolean } } | null = null
  private hallucinationCallback: ((text: string) => void) | null = null
  private thinkingEngine = new ThinkingEngine()
  private toolCallCounts = new Map<string, number>()
  private static readonly MAX_CALLS_PER_TOOL: Record<string, number> = {
    list_directory: 2, read_file: 5, search_files: 2, search_content: 3, list_notes: 2, kb_list: 2,
  }
  private credentialBroker: { verify(handleId: string, toolName: string, filePath?: string): { valid: boolean; reason?: string } } | null = null
  private capabilityHandleId: string | null = null
  private toolResultsBatch: ToolResult[] = []
  private allToolResults: ToolResult[] = []
  private evaluationPipeline: { run(input: { taskDescription: string; toolResults: unknown[]; messages: Message[]; auditTrail: unknown; skillLearner: unknown; livingSkillManager: unknown }): Promise<{ report: { overallScore: number; summary: string; layer: string }; autoSuggestions: string[]; failures: unknown[]; dominantCategory: string | null }> } | null = null
  private gcAgent: { generateReport(): { totalIssues: number; issues: Array<{ type: string; severity: string; location: string; description: string; fixInstruction: string }>; summary: string } } | null = null

  constructor(config: AgentConfig, deps?: AgentDependencies) {
    this.config = config
    this.emitter = new AgentEventEmitter()
    this.fsm = new AgentStateMachine(config.maxIterations)

    // Mirror state machine changes to the agent store for UI
    this.fsm.onStateChange((from, to, state) => {
      this.emitter.emit('agent:state', { from, to, state })
      const store = useAgentStore.getState()
      store.setPhase(to)
      store.setIteration(state.iteration)
      // Diagnostic logging
      diagnosticLogger.recordPhaseChange(from, to)
    })

    // Apply dependencies if provided
    if (deps) {
      if (deps.toolExecutor) this.toolExecutor = deps.toolExecutor
      if (deps.contextAssembler) this.contextAssembler = deps.contextAssembler
      if (deps.aiService) this.aiService = deps.aiService
      if (deps.tools) this.tools = deps.tools
      if (deps.hookEngine) this.hookEngine = deps.hookEngine
      if (deps.budgetManager) this.budgetManager = deps.budgetManager
      if (deps.hallucinationDetector) this.hallucinationDetector = deps.hallucinationDetector
      if (deps.checkpointManager) this.checkpointManager = deps.checkpointManager
      if (deps.livingSkillManager) this.livingSkillManager = deps.livingSkillManager
      if (deps.reflectionEngine) this.reflectionEngine = deps.reflectionEngine
      if (deps.constraintEngine) this.constraintEngine = deps.constraintEngine
      if (deps.policyEngine) this.policyEngine = deps.policyEngine
      if (deps.hallucinationCallback) this.hallucinationCallback = deps.hallucinationCallback
      if (deps.credentialBroker) this.credentialBroker = deps.credentialBroker
      if (deps.capabilityHandleId) this.capabilityHandleId = deps.capabilityHandleId
      if (deps.evaluationPipeline) this.evaluationPipeline = deps.evaluationPipeline
      if (deps.gcAgent) this.gcAgent = deps.gcAgent
    }
  }

  /** Check if required dependencies are configured */
  isReady(): boolean {
    return this.aiService !== null && this.toolExecutor !== null
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

  setBudgetManager(bm: typeof this.budgetManager): void { this.budgetManager = bm }
  setHallucinationDetector(hd: { detect(text: string, knownTools: Set<string>): string | null }): void { this.hallucinationDetector = hd }
  setCheckpointManager(cm: { save(sessionId: string, state: AgentState, messages: Message[], tokenUsage: number, reason: string): Promise<unknown> }): void { this.checkpointManager = cm }
  setLivingSkillManager(lsm: LivingSkillManager): void { this.livingSkillManager = lsm }
  setReflectionEngine(re: typeof this.reflectionEngine): void { this.reflectionEngine = re }
  setConstraintEngine(ce: typeof this.constraintEngine): void { this.constraintEngine = ce }
  setPolicyEngine(pe: typeof this.policyEngine): void { this.policyEngine = pe }
  setHallucinationCallback(cb: typeof this.hallucinationCallback): void { this.hallucinationCallback = cb }
  setEvaluationPipeline(ep: typeof this.evaluationPipeline): void { this.evaluationPipeline = ep }
  setGCAgent(gc: typeof this.gcAgent): void { this.gcAgent = gc }
  setCredentialBroker(cb: typeof this.credentialBroker, handleId: string): void { this.credentialBroker = cb; this.capabilityHandleId = handleId }

  setHistory(messages: Message[]): void {
    this.historyMessages = messages
  }

  getEmitter(): AgentEventEmitter {
    return this.emitter
  }

  getState(): Readonly<AgentState> {
    return this.fsm.currentState
  }

  approvePlan(): void {
    this.fsm.setPlanPhase('approved')
    if (this.fsm.currentState.executionPlan) {
      this.fsm.currentState.executionPlan.steps.forEach(s => { s.approvalStatus = 'approved' })
    }
  }

  rejectPlan(): void {
    this.fsm.setPlanPhase('rejected')
  }

  getMessagesForApi(): Message[] {
    return [...this.messagesForApi]
  }

  getToolResults(): readonly ToolResult[] {
    return this.allToolResults
  }

  // ── Run ──

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const store = useAgentStore.getState()
    const runId = Date.now().toString(36)
    const runStartTime = Date.now()
    const RUN_TIMEOUT = 300000 // 5 minutes wall-clock timeout
    let hallucinationRetries = 0
    const MAX_HALLUCINATION_RETRIES = 2
    store.startRun(runId)
    // Do NOT call emitter.reset() here — handlers registered by AgentChatBridge before run() would be cleared
    this.emitter.emit('run:start', { timestamp: Date.now() })
    this.budgetManager?.reset()

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
        contextResult = await this.contextAssembler(input.userMessage, this.historyMessages, this.config.projectId, this.config.workMode)
      } else {
        contextResult = { systemMessages: [], totalTokens: 0, domains: [], breakdown: [] }
      }
      const contextBreakdown = contextResult.breakdown || []
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

      // Step 3: PLANNING — inject plan-first instruction for action-mode tasks
      const isTask = isTaskMessage(input.userMessage)
      if (this.config.workMode === 'action' && isTask && this.fsm.canTransition('PLANNING')) {
        await this.fsm.transition('PLANNING')
        this.fsm.setPlanPhase('generating')
        this.emitter.emit('planning:start', { intent: input.userMessage.slice(0, 100), timestamp: Date.now() })
        // Inject plan instruction before the user message
        const planPrompt = this.thinkingEngine.generatePlanPrompt()
        this.messagesForApi.splice(this.messagesForApi.length - 1, 0, { role: 'system', content: planPrompt })
      }

      // Step 4: Main Loop — API Call + Tool Execution
      while (this.fsm.currentPhase !== 'IDLE' && this.fsm.currentPhase !== 'ABORTED') {
        if (this.config.abortSignal.aborted) {
          await this.fsm.transition('ABORTED')
          break
        }

        // CALLING_API (from ASSEMBLING_CONTEXT, PLANNING, REFLECTING, AWAITING_APPROVAL)
        if (this.fsm.currentPhase === 'ASSEMBLING_CONTEXT'
          || this.fsm.currentPhase === 'CALLING_API'
          || this.fsm.currentPhase === 'REFLECTING'
          || this.fsm.currentPhase === 'PLANNING') {

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

          // G6: Progressive compression check (5 stages: 50% → 60% → 70% → 85% → 95%)
          if (this.budgetManager && this.budgetManager.shouldCompress(this.messagesForApi as any[])) {
            if (this.budgetManager.shouldTriggerCompactHook()) {
              await this.hookEngine?.fire('PreCompact', {
                sessionId: 'runtime', projectId: this.config.projectId,
                configId: this.config.configId, messageCount: this.messagesForApi.length,
                estimatedTokens: 0, contextWindow: this.budgetManager.budget.contextWindow, timestamp: Date.now(),
              })
            }
            this.messagesForApi = this.budgetManager.compressMessages(this.messagesForApi as any[])
          }

          // On the LAST iteration, remove tools to force the AI to generate a text response.
          const isLastIteration = iteration >= this.config.maxIterations
          const toolsForThisRound = isLastIteration ? [] : this.tools

          diagnosticLogger.recordApiCallStart()
          const API_TIMEOUT = 90000
          let response
          try {
            const apiPromise = this.aiService.chatWithTools(
              this.messagesForApi,
              this.config.configId,
              this.config.projectId || undefined,
              toolsForThisRound,
            )
            const timeoutPromise = new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error(`API 调用超时 (${API_TIMEOUT / 1000}秒)`)), API_TIMEOUT)
            )
            response = await Promise.race([apiPromise, timeoutPromise])
            diagnosticLogger.recordApiCallEnd(response.usage?.total_tokens || 0, (response.toolCalls?.length ?? 0) > 0)
          } catch (apiErr) {
            diagnosticLogger.recordApiCallError(apiErr instanceof Error ? apiErr.message : 'Unknown')
            throw apiErr
          }

          totalTokens += response.usage?.total_tokens || 0
          store.addTokens(response.usage?.total_tokens || 0)
          this.budgetManager?.addUsage(response.usage?.total_tokens || 0)
          if (response.usage?.prompt_tokens) {
            store.setPeakPromptTokens(response.usage.prompt_tokens)
          }
          toolCallsCount += response.toolCalls?.length || 0

          // Emit API call metrics for audit trail
          this.emitter.emit('api:call', {
            promptTokens: response.usage?.prompt_tokens || 0,
            completionTokens: response.usage?.completion_tokens || 0,
            totalTokens: response.usage?.total_tokens || 0,
            timestamp: Date.now(),
          })

          this.fsm.setApiResponse({
            text: response.text,
            toolCalls: response.toolCalls,
            finishReason: response.finishReason,
            usage: response.usage,
          })

          // G5: Hallucination detection — runs even when tool calls exist (catches permission hallucinations)
          if (this.hallucinationDetector && hallucinationRetries < MAX_HALLUCINATION_RETRIES) {
            const hw = this.hallucinationDetector.detect(response.text || '', new Set(toolsUsed))
            if (hw) {
              hallucinationRetries++
              this.hallucinationCallback?.('hallucination: ' + (response.text || '').slice(0, 100))
              this.messagesForApi.push({ role: 'system', content: `[纠错] ${hw}` })
              this.fsm.setShouldContinue(true)
              if (this.fsm.canTransition('CALLING_API')) { await this.fsm.transition('CALLING_API') }
              continue
            }
          }

          // No tool calls → check for plan, or respond
          if (!response.toolCalls || response.toolCalls.length === 0) {

            // PLANNING phase: parse plan from AI response
            if (this.fsm.currentPhase === 'PLANNING' && response.text) {
              const plan = this.thinkingEngine.parseFromResponse(response.text)
              if (plan && plan.steps.length > 0) {
                const toolNames = new Set(this.tools.map((t: any) => t.function?.name || ''))
                const validation = this.thinkingEngine.validate(plan, toolNames as Set<string>)
                if (validation.valid) {
                  this.fsm.setExecutionPlan(plan)
                  this.fsm.setPlanPhase('awaiting_approval')
                  store.setExecutionPlan(plan)
                  store.setPlanPhase('awaiting_approval')
                  this.emitter.emit('plan:proposed', plan)
                  if (this.fsm.canTransition('AWAITING_APPROVAL')) {
                    await this.fsm.transition('AWAITING_APPROVAL')
                  }
                  // Pause — Bridge's onApprovalRequired resolves back via planPhase
                  this.fsm.setShouldContinue(false)
                  continue
                } else {
                  this.messagesForApi.push({ role: 'system', content: `计划验证失败: ${validation.errors.join('; ')}。请修正计划并重新输出。` })
                  this.fsm.setShouldContinue(true)
                  if (this.fsm.canTransition('CALLING_API')) { await this.fsm.transition('CALLING_API') }
                  continue
                }
              }
              // No plan parsed, AI answered directly → fall through to normal respond
              this.fsm.setPlanPhase('none')
            }

            // Parse thinking plan from AI response for progress tracking (non-PLANNING phases)
            if (response.text) {
              const plan = this.thinkingEngine.parseFromResponse(response.text)
              if (plan) {
                const toolNames = new Set(this.tools.map((t: any) => t.function?.name || ''))
                const validation = this.thinkingEngine.validate(plan, toolNames as Set<string>)
                if (!validation.valid) {
                  this.messagesForApi.push({ role: 'system', content: `思考计划验证失败: ${validation.errors.join('; ')}` })
                }
                store.setThinking({
                  intent: plan.intent,
                  steps: plan.steps.map(s => ({ tool: s.tool, action: s.action })),
                  filesNeeded: [],
                  estimatedTokens: plan.estimatedTokens,
                  timestamp: Date.now(),
                })
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
          // Convert flat format back to OpenAI format for the API
          const assistantMsg: Record<string, unknown> = {
            role: 'assistant',
            content: response.text,
            tool_calls: (response.toolCalls || []).map(tc => ({
              type: 'function',
              id: tc.id,
              function: { name: tc.name, arguments: tc.arguments },
            })),
          }
          // Preserve reasoning_content for DeepSeek chain-of-thought continuity
          if (response.reasoning_content) {
            assistantMsg.reasoning_content = response.reasoning_content
          }
          this.messagesForApi.push(assistantMsg as unknown as Message)
        }

        // EXECUTING
        if (this.fsm.currentPhase === 'AWAITING_TOOLS') {
          if (this.fsm.canTransition('EXECUTING')) {
            await this.fsm.transition('EXECUTING')
          }

          const calls = this.fsm.currentState.pendingToolCalls

          // Classify tools: safe tools (AUTO/READ_ASK) can run in parallel, dangerous ones sequential
          const { toolRegistry } = await import('../tools/ToolRegistry')
          const readOnlyCalls = calls.filter(tc => {
            const perm = toolRegistry.getPermissionLevel(tc.name)
            return perm === 'AUTO' || perm === 'READ_ASK'
          })
          const writeCalls = calls.filter(tc => {
            const perm = toolRegistry.getPermissionLevel(tc.name)
            return perm !== 'AUTO' && perm !== 'READ_ASK'
          })

          // Execute read-only tools in parallel
          if (readOnlyCalls.length > 0 && !this.config.abortSignal.aborted) {
            const readPromises = readOnlyCalls.map(tc => this.executeSingleTool(tc, runId, store, toolsUsed))
            await Promise.all(readPromises)
          }

          // Execute write tools sequentially (preserving order)
          for (const tc of writeCalls) {
            if (this.config.abortSignal.aborted) break
            await this.executeSingleTool(tc, runId, store, toolsUsed)
          }

          this.fsm.setPendingToolCalls([])
        }

        // ── AWAITING_APPROVAL: plan has been proposed, waiting for user ──
        if (this.fsm.currentPhase === 'AWAITING_APPROVAL') {
          const planPhase = this.fsm.currentState.planPhase
          if (planPhase === 'approved' && this.fsm.currentState.executionPlan) {
            // Inject plan enforcement context
            const planInject = this.thinkingEngine.buildPlanEnforcementInject(this.fsm.currentState.executionPlan)
            if (planInject) {
              this.messagesForApi.push({ role: 'system', content: planInject })
            }
            this.emitter.emit('plan:approved', { timestamp: Date.now() })
            if (this.fsm.canTransition('EXECUTING')) {
              this.fsm.setShouldContinue(true)
              await this.fsm.transition('CALLING_API')
            }
            continue
          } else if (planPhase === 'rejected') {
            this.emitter.emit('plan:rejected', { feedback: '', timestamp: Date.now() })
            if (this.fsm.canTransition('REFLECTING')) {
              await this.fsm.transition('REFLECTING')
            }
            this.fsm.setShouldContinue(false)
            continue
          }
          // Still waiting — break out (the approval callback will set planPhase and re-enter)
          if (this.fsm.canTransition('REFLECTING')) {
            await this.fsm.transition('REFLECTING')
          }
          this.fsm.setShouldContinue(false)
          continue
        }

        // ── RESPONDING: model produced text, no more tool calls ──
        if (this.fsm.currentPhase === 'RESPONDING') {
          if (this.fsm.canTransition('IDLE')) {
            await this.fsm.transition('IDLE')
          }
          break
        }

        // Wall-clock timeout: prevent infinite loops from any cause
        if (Date.now() - runStartTime > RUN_TIMEOUT) {
          diagnosticLogger.recordError(`运行超时 (${RUN_TIMEOUT / 1000}秒)`)
          if (this.fsm.canTransition('ABORTED')) {
            await this.fsm.transition('ABORTED')
          }
          break
        }

        // REFLECT and decide next
        await this.reflectAndDecide()
      }

      // ── VERIFYING: post-execution verification ──
      const execPlan = this.fsm.currentState.executionPlan
      if (this.fsm.currentState.planPhase === 'approved' && execPlan
        && this.fsm.currentPhase === 'RESPONDING'
        && execPlan.steps.some(s => s.status === 'completed')) {
        const completedSteps = execPlan.steps.filter(s => s.status === 'completed')
        if (completedSteps.length > 0 && this.fsm.canTransition('VERIFYING')) {
          await this.fsm.transition('VERIFYING')
          this.emitter.emit('verify:start', { stepCount: completedSteps.length, timestamp: Date.now() })
          const reports = await this.runVerification(completedSteps, toolsUsed)
          this.fsm.setVerificationReports(reports)
          store.setVerificationReports(reports)
          const passedCount = reports.filter(r => r.status === 'passed').length
          const failedCount = reports.filter(r => r.status === 'failed').length
          this.emitter.emit('verify:complete', { total: reports.length, passed: passedCount, failed: failedCount })
          if (failedCount > 0) {
            const verifySummary = reports.filter(r => r.status === 'failed')
              .map(r => `${r.planStepId}: ${r.discrepancy || '验证失败'}`).join('; ')
            this.messagesForApi.push({ role: 'system', content: `[验证结果] ${passedCount}/${reports.length} 步骤通过。${failedCount > 0 ? '失败: ' + verifySummary : ''}` })
          }
          if (this.fsm.canTransition('RESPONDING')) {
            await this.fsm.transition('RESPONDING')
          }
        }
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

      // ── Post-session: Evaluation Pipeline ──
      let evaluationScore: number | null = null
      let evaluationSuggestions: string[] = []
      if (this.evaluationPipeline) {
        try {
          const pipelineOutput = await this.evaluationPipeline.run({
            taskDescription: input.userMessage,
            toolResults: this.allToolResults,
            messages: this.messagesForApi,
            auditTrail: (this as any).auditTrail || null,
            skillLearner: (this as any).skillLearner || null,
            livingSkillManager: this.livingSkillManager,
          })
          evaluationScore = pipelineOutput.report.overallScore
          evaluationSuggestions = pipelineOutput.autoSuggestions
          if (evaluationScore < 0.6) {
            console.log(`[Evaluation] 评分 ${evaluationScore} (${pipelineOutput.report.layer}) — ${pipelineOutput.report.summary}`)
          }
          if (evaluationSuggestions.length > 0) {
            console.log(`[Evaluation] 建议:`, evaluationSuggestions.join('; '))
          }
        } catch { /* evaluation is best-effort */ }
      }

      // ── Post-session: GC Agent ──
      let gcReport: { totalIssues: number; issues: Array<{ type: string; severity: string; location: string; description: string; fixInstruction: string }>; summary: string } | null = null
      if (this.gcAgent) {
        try {
          gcReport = this.gcAgent.generateReport()
          if (gcReport.totalIssues > 0) {
            console.log(`[GCAgent] ${gcReport.totalIssues} 个问题 — ${gcReport.summary}`)
          }
        } catch { /* gc is best-effort */ }
      }

      // G9: Rich result
      // If collectedText is empty, try multiple fallback strategies:
      if (!collectedText) {
        // Strategy 1: Extract text from the last assistant message in API context
        for (let i = this.messagesForApi.length - 1; i >= 0; i--) {
          const m = this.messagesForApi[i]
          if (m.role === 'assistant' && m.content && typeof m.content === 'string' && m.content.trim()) {
            collectedText = m.content
            break
          }
        }
      }
      if (!collectedText) {
        // Strategy 2: Summarize from tool results
        const toolSummaries: string[] = []
        for (let i = this.messagesForApi.length - 1; i >= 0; i--) {
          const m = this.messagesForApi[i]
          if (m.role === 'tool' && m.content) {
            try {
              const parsed = JSON.parse(m.content)
              if (parsed.summary) toolSummaries.push(parsed.summary)
            } catch { /* not JSON */ }
            if (toolSummaries.length >= 3) break
          }
        }
        if (toolSummaries.length > 0) {
          collectedText = `操作完成：${toolSummaries.reverse().join('；')}。`
        }
      }

      const lastResponse = this.fsm.currentState.lastApiResponse
      return {
        success: this.fsm.currentPhase !== 'ABORTED',
        text: collectedText, messageCount: this.messagesForApi.length,
        totalTokens, toolCalls: toolCallsCount, phase: this.fsm.currentPhase,
        thinkingPlan: null, toolsUsed, hallucinationWarnings: [],
        kbSources: [], webSources: [], images: [],
        reasoningContent: (lastResponse as unknown as Record<string, unknown>)?.reasoning_content as string || null,
        evaluationScore, evaluationSuggestions,
        gcReport,
        contextBreakdown,
      }

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error'
      diagnosticLogger.recordError(errorMsg)
      await diagnosticLogger.flush()
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
        totalTokens, toolCalls: toolCallsCount, phase: 'ERROR',
        thinkingPlan: null, toolsUsed: [], hallucinationWarnings: [],
        kbSources: [], webSources: [], images: [], reasoningContent: null,
      }
    }
  }

  // ── Private helpers ──

  private async executeSingleTool(
    tc: ToolCallRequest,
    runId: string,
    store: ReturnType<typeof useAgentStore.getState>,
    toolsUsed: string[],
  ): Promise<void> {
    if (!toolsUsed.includes(tc.name)) toolsUsed.push(tc.name)
    diagnosticLogger.recordToolStart(tc.id, tc.name)

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
          sessionId: runId, projectId: this.config.projectId,
          configId: this.config.configId, toolName: tc.name, toolArgs: args, timestamp: Date.now(),
        })
        if (preResults.some(r => !r.passed)) {
          const feedback = this.hookEngine.buildBlockingFeedback(preResults)
          this.emitter.emit('hook:blocked', { hookName: 'PreToolUse', feedback, timestamp: Date.now() } as any)
          this.messagesForApi.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ status: 'error', summary: `PreToolUse hook 阻断: ${feedback}` }) })
          return
        }
      }

      // ── CredentialBroker Check ──
      if (this.credentialBroker && this.capabilityHandleId) {
        const targetPath = (args.file_path as string) || (args.dir_path as string) || (args.new_path as string) || ''
        const verifyResult = this.credentialBroker.verify(this.capabilityHandleId, tc.name, targetPath)
        if (!verifyResult.valid) {
          this.messagesForApi.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ status: 'error', summary: `[能力句柄拒绝] ${verifyResult.reason}` }) })
          return
        }
      }

      // ── Redundant call check ──
      const countThisRound = (this.toolCallCounts.get(tc.name) || 0) + 1
      this.toolCallCounts.set(tc.name, countThisRound)
      const maxCalls = AgentRuntime.MAX_CALLS_PER_TOOL[tc.name]
      if (maxCalls && countThisRound > maxCalls) {
        this.messagesForApi.push({
          role: 'system',
          content: `[工具限制] 你已经调用了 ${tc.name} ${countThisRound} 次（上限 ${maxCalls} 次）。请基于已有结果继续，不要再重复调用。`,
        })
      }

      // ── PolicyEngine Check (handled by toolExecutor callback in AgentChatBridge for full deny/ask support) ──

      // ── Plan Enforcement ──
      const currentPlan = this.fsm.currentState.executionPlan
      if (currentPlan && this.fsm.currentState.planPhase === 'approved') {
        const matchingStep = this.thinkingEngine.findMatchingStep(currentPlan, tc.name, args)
        if (!matchingStep) {
          this.messagesForApi.push({ role: 'tool', tool_call_id: tc.id,
            content: JSON.stringify({ status: 'error', summary: `[计划偏离] 工具 "${tc.name}" 不在已批准的计划中。如确有需要，请先更新计划。` }) })
          this.emitter.emit('plan:deviation', { toolName: tc.name, args, plannedSteps: currentPlan.steps.map(s => s.tool), timestamp: Date.now() })
          store.completeTool(tc.id, 'error', `计划偏离: 不在计划中`)
          return
        }
        if (matchingStep.approvalStatus === 'rejected') {
          this.messagesForApi.push({ role: 'tool', tool_call_id: tc.id,
            content: JSON.stringify({ status: 'error', summary: `[步骤已拒绝] 用户拒绝了步骤 "${matchingStep.action}"。跳过。` }) })
          store.completeTool(tc.id, 'error', `步骤已拒绝: ${matchingStep.userFeedback || ''}`)
          return
        }
        if (matchingStep.approvalStatus === 'pending') {
          this.messagesForApi.push({ role: 'tool', tool_call_id: tc.id,
            content: JSON.stringify({ status: 'error', summary: `[步骤待批准] 步骤 "${matchingStep.action}" 尚未获得用户批准。` }) })
          store.completeTool(tc.id, 'error', '步骤尚未批准')
          return
        }
        matchingStep.status = 'in_progress'
        this.emitter.emit('plan:stepStart', { stepId: matchingStep.id, action: matchingStep.action })
      }

      // ── Constraint Check ──
      if (this.constraintEngine) {
        const constraintResult = this.constraintEngine.check({
          toolName: tc.name, filePath: args.file_path as string || args.path as string || '',
          content: args.content as string || '', newPath: args.new_path as string || '', projectId: this.config.projectId,
        })
        if (!constraintResult.passed) {
          this.messagesForApi.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ status: 'error', summary: `[约束阻断] ${constraintResult.message}` }) })
          store.completeTool(tc.id, 'error', `约束阻断: ${constraintResult.message}`)
          this.emitter.emit('tool:failed', { callId: tc.id, toolName: tc.name, status: 'error', summary: `约束阻断: ${constraintResult.message}`, timestamp: Date.now() })
          return
        }
      }

      // ── Execute (with 60s timeout to prevent hanging) ──
      let result: ToolResult
      if (this.toolExecutor) {
        const TOOL_TIMEOUT = 60000
        const execPromise = this.toolExecutor(args, {
          projectId: this.config.projectId, configId: this.config.configId,
          callId: tc.id, toolName: tc.name, signal: this.config.abortSignal,
        })
        const timeoutPromise = new Promise<ToolResult>(r => setTimeout(() => {
          diagnosticLogger.recordToolTimeout(tc.name, TOOL_TIMEOUT)
          r({ status: 'error', summary: `工具 ${tc.name} 执行超时 (${TOOL_TIMEOUT / 1000}秒)` })
        }, TOOL_TIMEOUT))
        result = await Promise.race([execPromise, timeoutPromise])
      } else {
        result = { status: 'error', summary: '工具执行器未配置' }
      }

      // ── Post-execution steps (wrapped to prevent double-push on error) ──
      try {
        // Hook: PostToolUse
        if (this.hookEngine) {
          await this.hookEngine.fire('PostToolUse', {
            sessionId: runId, projectId: this.config.projectId,
            configId: this.config.configId, toolName: tc.name, toolArgs: args, toolResult: result, timestamp: Date.now(),
          })
        }

        // Notify file changes
        if (result.status === 'success' && /^(create_file|edit_file|delete_file|rename_file|create_project|delete_project)$/.test(tc.name)) {
          useStore.getState().setFileEditNotify({ filePath: String(args.file_path || args.project_name || ''), newContent: '__AI_EDITED__' })
        }

        // Living Skill learning
        if (result.status === 'error') {
          this.livingSkillManager?.onToolError(tc.name, result.summary)
        } else {
          this.livingSkillManager?.onToolSuccess(tc.name, args, result)
        }
      } catch (postErr) {
        // Post-execution errors should not replace the actual tool result
        console.warn('[AgentRuntime] PostToolUse hook error:', postErr)
      }

      // Record result (always the actual execution result, not hook errors)
      this.toolResultsBatch.push(result)
      diagnosticLogger.recordToolEnd(tc.id, tc.name, result.status)

      // Emit result
      if (result.status === 'success') {
        store.completeTool(tc.id, 'success', result.summary, result.detail)
        this.emitter.emit('tool:completed', { callId: tc.id, toolName: tc.name, status: 'success', summary: result.summary, detail: result.detail, timestamp: Date.now() })
        // Mark plan step as completed
        if (currentPlan) {
          const step = this.thinkingEngine.findMatchingStep(currentPlan, tc.name, args)
          if (step) {
            step.status = 'completed'
            this.emitter.emit('plan:stepComplete', { stepId: step.id, action: step.action, summary: result.summary })
          }
        }
      } else {
        store.completeTool(tc.id, 'error', result.summary, result.detail)
        this.emitter.emit('tool:failed', { callId: tc.id, toolName: tc.name, status: 'error', summary: result.summary, detail: result.detail, timestamp: Date.now() })
      }

      // Add tool result to API context — strip detail from read-only tools, truncate write tools
      const MAX_DETAIL_CHARS = 2000
      const resultForApi = READ_ONLY_TOOLS.has(tc.name)
        ? { status: result.status, summary: result.summary, note: '内容已省略，需要时请重新调用工具读取' }
        : (result.detail && result.detail.length > MAX_DETAIL_CHARS)
          ? { ...result, detail: result.detail.slice(0, MAX_DETAIL_CHARS) + '...(已截断)' }
          : result
      this.messagesForApi.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(resultForApi) })

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error'
      diagnosticLogger.recordToolError(tc.id, tc.name, errorMsg)
      const errorResult: ToolResult = { status: 'error', summary: errorMsg }
      this.toolResultsBatch.push(errorResult)
      store.completeTool(tc.id, 'error', errorMsg)
      this.emitter.emit('tool:failed', { callId: tc.id, toolName: tc.name, status: 'error', summary: errorMsg, timestamp: Date.now() })
      this.messagesForApi.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(errorResult) })
    }
  }

  private analyzeIntent(userMessage: string): ThinkingContext {
    const steps: { tool: string; action: string }[] = []
    // Simple keyword-based intent detection (replaced by ThinkingEngine in Phase 4)
    if (/创建|新建/.test(userMessage)) steps.push({ tool: 'create_file', action: '创建文件' })
    if (/编辑|修改(?!善)|改动/.test(userMessage)) steps.push({ tool: 'edit_file', action: '编辑文件' })
    if (/查看|读取/.test(userMessage)) steps.push({ tool: 'read_file', action: '读取文件' })
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

    // Use ReflectionEngine to analyze tool results and suggest retries
    if (this.reflectionEngine && this.toolResultsBatch.length > 0) {
      const failedCount = this.toolResultsBatch.filter(r => r.status === 'error').length
      if (failedCount > 0 && !this.config.abortSignal.aborted) {
        const reflection = this.reflectionEngine.reflect(this.toolResultsBatch, [])
        if (reflection.shouldRetry) {
          const inject = this.reflectionEngine.buildReflectionInject(reflection) || reflection.retrySuggestions.join('\n')
          if (inject) {
            this.messagesForApi.push({ role: 'system', content: inject })
          }
        }
      }
    }
    // Preserve results for post-session evaluation before clearing the per-iteration batch
    this.allToolResults.push(...this.toolResultsBatch)
    this.toolResultsBatch = []
    this.toolCallCounts.clear()

    const state = this.fsm.currentState
    // Should continue if: API returned tool_calls (by presence OR finishReason), not at max iterations, not aborted
    // Many API providers (DeepSeek, Qwen, etc.) return finish_reason: 'stop' even when tool_calls are present,
    // so we must check toolCalls existence, not just finishReason.
    const hasToolCalls = (state.lastApiResponse?.toolCalls?.length ?? 0) > 0

    const shouldContinue = (
      (hasToolCalls || state.lastApiResponse?.finishReason === 'tool_calls')
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
      // RESPONDING → IDLE happens in the main loop's next iteration
    }
  }

  private async runVerification(
    completedSteps: import('../state/types').ThinkingStep[],
    toolsUsed: string[],
  ): Promise<import('../state/types').VerificationReport[]> {
    const reports: import('../state/types').VerificationReport[] = []
    for (const step of completedSteps) {
      const report: import('../state/types').VerificationReport = {
        planStepId: step.id, expectedOutcome: step.expectedOutcome,
        actualOutcome: '', status: 'skipped',
      }
      if (!/^(create_file|edit_file|rename_file)$/.test(step.tool)) {
        report.status = 'passed'
        reports.push(report)
        continue
      }
      const filePath = String(step.args?.file_path || step.args?.path || '')
      if (!filePath || !this.toolExecutor) {
        report.status = 'skipped'
        reports.push(report)
        continue
      }
      try {
        const verifyResult = await this.toolExecutor(
          { file_path: filePath },
          { projectId: this.config.projectId, configId: this.config.configId,
            callId: `verify_${step.id}`, toolName: 'read_file', signal: this.config.abortSignal },
        )
        if (verifyResult.status === 'success') {
          report.actualOutcome = (verifyResult.detail || verifyResult.summary).slice(0, 200)
          const expected = step.expectedOutcome.slice(0, 50).toLowerCase()
          const actual = report.actualOutcome.toLowerCase()
          report.status = (expected && actual.includes(expected)) || report.actualOutcome.length > 0 ? 'passed' : 'failed'
        } else {
          report.actualOutcome = `读取失败: ${verifyResult.summary}`
          report.status = 'failed'
          report.discrepancy = '无法读取目标文件进行验证'
        }
      } catch (err) {
        report.status = 'failed'
        report.discrepancy = `验证异常: ${err instanceof Error ? err.message : 'Unknown'}`
      }
      reports.push(report)
    }
    return reports
  }

  // ── Abort ──

  abort(): void {
    this.emitter.abort()
    this.fsm.reset()
  }
}
