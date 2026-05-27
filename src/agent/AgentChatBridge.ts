/**
 * AgentChatBridge — the integration layer between the new AgentRuntime
 * and the existing React chat UI (AIChatWindow).
 *
 * This class encapsulates all the new agent logic and exposes a simple
 * interface that the existing chat component can consume, enabling a
 * gradual migration from old handleSend() to new AgentRuntime.
 *
 * Usage in AIChatWindow:
 *
 *   const bridge = useRef(new AgentChatBridge())
 *   bridge.current.init({ configId, projectId, workMode, historyMessages })
 *   const result = await bridge.current.sendMessage(userInput, {
 *     kbEnabled, webSearchEnabled, selectedRefs, onThinking, onToolProgress, onResponse
 *   })
 */

import { AgentRuntime } from './runtime/AgentRuntime'
import { toolRegistry } from './tools/ToolRegistry'
import { contextAssembler } from './context/ContextAssembler'
import { useAgentStore } from './store/AgentStore'

import { BudgetManager } from './budget/BudgetManager'
import { ReflectionEngine } from './reflection/ReflectionEngine'
import { ToolCache } from './cache/ToolCache'
import { ALL_TOOLS } from './tools/definitions'
import { ALL_PROVIDERS } from './context/providers'
import { aiService } from '@/services/fileService'
import { HookEngine } from './hooks/HookEngine'
import { AiHarnessConfigLoader } from './config/AiHarnessConfig'
import { PolicyEngine } from './permissions/PolicyEngine'
import { PermissionManager } from './permissions/PermissionManager'
import { CheckpointManager } from './checkpoint/CheckpointManager'
import { CircuitBreaker } from './circuit/CircuitBreaker'
import { ConstraintEngine } from './constraints/ConstraintEngine'
import { GatekeeperRunner } from './gatekeeper/GatekeeperRunner'
import { AuditTrail } from './audit/AuditTrail'
import { SkillLearner } from './evolution/SkillLearner'
import { LivingSkillManager } from './living-skills/LivingSkillManager'
import { CredentialBroker } from './security/CredentialBroker'
import { SessionManager } from './sessions/SessionManager'
import { EvaluationPipeline } from './evaluators/EvaluationPipeline'
import { MetricsCollector } from './metrics/MetricsCollector'
import { PostSessionAnalyzer } from './metrics/PostSessionAnalyzer'
import { FeedbackChannel } from './feedback/FeedbackChannel'
import type { Message, AgentRunResult } from './runtime/AgentRuntime'
import type { ToolProgressEvent, ResponseChunk, ThinkingContext } from './runtime/AgentEventEmitter'

// ── Initialization state ──
let toolsRegistered = false
let providersRegistered = false

function ensureInitialized() {
  if (!toolsRegistered) {
    toolRegistry.registerAll(ALL_TOOLS)
    toolsRegistered = true
  }
  if (!providersRegistered) {
    for (const p of ALL_PROVIDERS) {
      if (!contextAssembler.getProviders().some(existing => existing.domain === p.domain)) {
        contextAssembler.register(p)
      }
    }
    providersRegistered = true
  }
}

// ── Options ──

export interface BridgeInitOptions {
  configId: string
  projectId: string | null
  workMode: 'plan' | 'action'
  maxIterations?: number
  historyMessages?: Message[]
}

export interface SendMessageOptions {
  kbEnabled?: boolean
  webSearchEnabled?: boolean
  selectedRefs?: { id: string; name: string }[]
  onThinking?: (ctx: ThinkingContext) => void
  onToolProgress?: (event: ToolProgressEvent) => void
  onResponse?: (chunk: ResponseChunk) => void
  onComplete?: (result: AgentRunResult) => void
  onApprovalRequired?: (tools: Array<{ name: string; args: Record<string, unknown> }>) => Promise<boolean>
}

export interface BridgeSendResult {
  success: boolean
  text: string
  toolCalls: number
  totalTokens: number
  phase: string
}

// ── Bridge ──

export class AgentChatBridge {
  private runtime: AgentRuntime | null = null
  private budgetMgr = new BudgetManager(128000)
  private reflectionEng = new ReflectionEngine()
  private toolCache = new ToolCache()

  // New Harness subsystems
  private policyEngine = new PolicyEngine()
  private checkpointMgr = new CheckpointManager()
  private circuitBreaker = new CircuitBreaker()
  private constraintEngine = new ConstraintEngine()
  private gatekeeper = new GatekeeperRunner()
  private auditTrail = new AuditTrail()
  private hookEngine = new HookEngine()
  private skillLearner = new SkillLearner('.aiharness')
  private livingSkillManager = new LivingSkillManager()
  private credentialBroker = new CredentialBroker()
  private sessionMgr = new SessionManager('agent-sessions')
  private evaluationPipeline = new EvaluationPipeline()
  private metricsCollector = new MetricsCollector()
  private postSessionAnalyzer = new PostSessionAnalyzer()
  private feedbackChannel = new FeedbackChannel()

  private initialized = false
  private configId = ''
  private projectId: string | null = null
  private workMode: 'plan' | 'action' = 'action'
  private maxIterations = 8
  private history: Message[] = []
  private abortController: AbortController = new AbortController()
  private runId = ''
  private sessionId: string | null = null

  // ── Init ──

  init(options: BridgeInitOptions): void {
    ensureInitialized()

    this.configId = options.configId
    this.projectId = options.projectId
    this.workMode = options.workMode
    this.maxIterations = options.maxIterations ?? 8
    this.history = options.historyMessages || []
    this.initialized = true
  }

  updateProject(projectId: string | null): void {
    this.projectId = projectId
  }

  updateWorkMode(mode: 'plan' | 'action'): void {
    this.workMode = mode
  }

  updateHistory(messages: Message[]): void {
    this.history = messages
  }

  // ── Send ──

  async sendMessage(
    userMessage: string,
    options: SendMessageOptions = {},
  ): Promise<BridgeSendResult> {
    if (!this.initialized) {
      throw new Error('AgentChatBridge not initialized. Call init() first.')
    }

    // Circuit breaker check
    const cbCheck = this.circuitBreaker.beforeCall()
    if (!cbCheck.allowed) {
      return { success: false, text: cbCheck.reason || '断路保护已激活', toolCalls: 0, totalTokens: 0, phase: 'ERROR' }
    }

    // Build runtime
    this.runId = Date.now().toString(36)
    this.abortController = new AbortController()
    const store2 = useAgentStore.getState()

    // Start audit trail + skill learner + session persistence
    this.auditTrail.startSession(this.runId)
    this.skillLearner.startSession(this.runId, this.projectId)
    await this.skillLearner.loadLearned()

    // Load persisted metrics from previous sessions
    try { await this.metricsCollector.load() } catch { /* first session */ }

    // Create or resume session for persistence
    try {
      const session = await this.sessionMgr.create(
        userMessage.slice(0, 50), this.projectId,
      )
      this.sessionId = session.id
      useAgentStore.getState().addSession(session as any)

      // Try loading previous session's context (for trend awareness)
      try {
        const prevSessions = await this.sessionMgr.list({ projectId: this.projectId || undefined })
        if (prevSessions.length > 1) {
          const prevSession = await this.sessionMgr.load(prevSessions[1].id) // second-most-recent
          if (prevSession && prevSession.messages.length > 0) {
            console.log(`[AgentBridge] 已加载上次会话 (${prevSession.meta.messageCount} 条消息)`)
          }
        }
      } catch { /* session load is optional */ }
    } catch { /* session persistence is best-effort */ }

    this.runtime = new AgentRuntime({
      configId: this.configId,
      projectId: this.projectId,
      workMode: this.workMode,
      maxIterations: this.maxIterations,
      abortSignal: this.abortController.signal,
    })

    // Inject learned context into runtime history (must happen after runtime creation)
    const learnedContext = this.skillLearner.getContextInject()
    if (learnedContext) {
      this.runtime.setHistory([...this.history, { role: 'system', content: learnedContext }])
    }

    // Wire BudgetManager for token budget enforcement
    this.runtime.setBudgetManager(this.budgetMgr)

    // Inject AI service
    this.runtime.setAIService({
      chatWithTools: async (msgs, cid, pid, tools) => {
        const result = await aiService.chatWithTools(msgs, cid, pid, tools)
        return {
          text: result.text,
          toolCalls: result.toolCalls?.map(tc => ({
            id: tc.id,
            name: tc.function.name,
            arguments: tc.function.arguments,
          })) || null,
          finishReason: result.finishReason,
          images: result.images,
          reasoning_content: result.reasoning_content,
          usage: result.usage,
        }
      },
      abortStream: () => aiService.abortStream(),
    })

    // Inject context assembler with KB/Web search
    this.runtime.setContextAssembler(async (msg, hist, pid, _mode) => {
      let searchContext = ''

      // G7: KB search
      if (options.kbEnabled && this.projectId) {
        try {
          const { kbService } = await import('@/services/fileService')
          const results = await kbService.search(msg, this.projectId, this.configId || '', 3)
          if (Array.isArray(results) && results.length > 0) {
            searchContext += '\n[知识库搜索结果]\n' + results.map((r: any) => r.content || r.text || '').join('\n---\n')
          }
        } catch (err) { console.warn('[AgentBridge] KB search unavailable:', err) }
      }

      // G7: Web search
      if (options.webSearchEnabled) {
        try {
          const { kbService } = await import('@/services/fileService')
          const results = await kbService.webSearch(msg, 3)
          if (Array.isArray(results) && results.length > 0) {
            searchContext += '\n[网络搜索结果]\n' + results.map((r: any) => r.snippet || r.title || '').join('\n---\n')
          }
        } catch (err) { console.warn('[AgentBridge] Web search unavailable:', err) }
      }

      if (searchContext) {
        return {
          systemMessages: [{ role: 'system', content: searchContext }],
          totalTokens: Math.ceil(searchContext.length / 3),
          domains: ['kb-web-search'],
        }
      }
      return contextAssembler.assemble(msg, hist, this.projectId)
    })

    // Inject tool executor (with caching + policy check + audit)
    this.runtime.setToolExecutor(async (args, ctx) => {
      // Policy check (deny-first)
      const perm = this.policyEngine.evaluate(ctx.toolName, args)
      this.auditTrail.recordPermissionDecision(ctx.toolName, perm.effect, perm.reason)
      if (perm.effect === 'deny') {
        return { status: 'error', summary: `[Policy Deny] ${perm.reason}` }
      }
      if (perm.effect === 'ask' && options.onApprovalRequired) {
        const approved = await options.onApprovalRequired([{ name: ctx.toolName, args }])
        if (!approved) {
          return { status: 'error', summary: '用户拒绝了此操作' }
        }
      }

      // For reads, check cache first
      const cacheKey = `${ctx.toolName}:${JSON.stringify(args)}`
      if (this.toolCache.has(cacheKey)) {
        return this.toolCache.get(cacheKey)!
      }

      const result = await toolRegistry.execute(ctx.toolName, args, ctx)

      // Audit + circuit breaker + skill learning
      this.auditTrail.recordToolResult(ctx.toolName, result.status, result.summary)
      if (result.status === 'success') {
        this.circuitBreaker.recordSuccess()
        this.skillLearner.recordSuccess(ctx.toolName)
        if (ctx.toolName === 'read_file') this.toolCache.set(cacheKey, result)
      } else {
        this.circuitBreaker.recordFailure()
        this.skillLearner.recordError(ctx.toolName, result.summary)
      }

      return result
    })

    // ── Initialize and wire all Harness subsystems ──
    const projectRoot = this.projectId || '.'

    // Load config
    try {
      const configLoader = new AiHarnessConfigLoader(
        projectRoot,
        process.env.HOME || process.env.USERPROFILE || '~',
      )
      const config = await configLoader.load()

      // Hooks
      if (config.hooks.length > 0) {
        this.hookEngine.loadFromDefinitions(config.hooks, projectRoot)
      }

      // Permissions: deny-first policy + learned patterns
      this.policyEngine.setPermissionManager(new PermissionManager())
      if (config.permissions.defaultEffect === 'deny' || config.permissions.policies.length > 0) {
        this.policyEngine.load(config.permissions.policies)
      }

      // Constraints: architectural + taste invariants
      if (config.constraints) {
        this.constraintEngine.updateConfig(config.constraints)
      }

      // Gatekeeper scripts
      const evalScripts = config.evaluators.filter(e => e.enabled).map(e => `${e.dimension}-evaluator.mjs`)
      this.gatekeeper.loadScripts(evalScripts, projectRoot)

      // Checkpoint
      this.checkpointMgr = new CheckpointManager(config.durableExecution.maxCheckpoints)
    } catch (err) { console.warn('[AgentBridge] AiHarnessConfig load failed, using defaults:', err) }

    // Wire Harness into runtime
    this.runtime.setHookEngine(this.hookEngine)
    this.runtime.setLivingSkillManager(this.livingSkillManager)
    this.runtime.setReflectionEngine(this.reflectionEng)
    this.runtime.setConstraintEngine(this.constraintEngine)
    this.runtime.setPolicyEngine(this.policyEngine)
    // Issue capability handle for this session (scoped to project + 1 hour)
    const handle = this.credentialBroker.issue(this.runId, [
      { tool: '*', pathPrefix: this.projectId || '.', operation: 'read' },
      { tool: '*', pathPrefix: this.projectId || '.', operation: 'write' },
      { tool: '*', pathPrefix: this.projectId || '.', operation: 'delete' },
    ])
    this.runtime.setCredentialBroker(this.credentialBroker, handle.id)
    this.runtime.setHallucinationCallback((text) => {
      this.skillLearner.recordError('hallucination', text, 'hallucination')
    })
    this.livingSkillManager.startSession(this.runId, this.projectId)
    this.circuitBreaker.reset()
    this.auditTrail.startSession(this.runId)

    // ── Inject living skills (6-stage lifecycle learning) ──
    const livingSkillsContext = this.livingSkillManager.getContextInject()
    if (livingSkillsContext) {
      contextAssembler.register({
        domain: 'living-skills',
        relevance: () => 1.0,
        buildContext: async () => ({ domain: 'living-skills', priority: 115, estimatedTokens: Math.ceil(livingSkillsContext.length / 3), content: livingSkillsContext }),
      })
    }

    // ── Inject learned rules from SkillLearner ──
    try {
      const learnedRules = await this.skillLearner.loadLearned()
      const learnedContext = this.skillLearner.getContextInject()
      if (learnedContext && learnedRules.length > 0) {
        contextAssembler.register({
          domain: 'learned-rules',
          relevance: () => 1.0,
          buildContext: async () => ({
            domain: 'learned-rules',
            priority: 110,
            estimatedTokens: Math.ceil(learnedContext.length / 3),
            content: learnedContext,
          }),
        })
      }
    } catch { /* skill learner may not have storage access */ }

    // Set tools based on work mode
    const schemas = toolRegistry.getFilteredSchemas(
      this.workMode,
      undefined, // all tools within mode
    )
    this.runtime.setTools(schemas)

    // Set history
    this.runtime.setHistory(this.history)

    // Wire events to callbacks
    const emitter = this.runtime.getEmitter()

    emitter.on('thinking:start', (data) => {
      store2.setThinking(data)
      options.onThinking?.(data)
    })

    emitter.on('tool:started', (data) => {
      store2.addToolExecution(data.callId, data.toolName)
    })

    emitter.on('tool:progress', (data) => {
      store2.updateToolProgress(data)
      options.onToolProgress?.(data)
    })

    emitter.on('tool:completed', (data) => {
      store2.completeTool(data.callId, 'success', data.summary, data.detail)
      options.onToolProgress?.({
        callId: data.callId, toolName: data.toolName,
        phase: 'done', progress: 1, message: data.summary,
        timestamp: Date.now(),
      })
    })

    emitter.on('tool:failed', (data) => {
      store2.completeTool(data.callId, 'error', data.summary, data.detail)
    })

    let collectedText = ''
    emitter.on('response:streaming', (data) => {
      collectedText = data.accumulated
      options.onResponse?.(data)
    })

    emitter.on('agent:state', (data) => {
      store2.setPhase(data.to)
      store2.setIteration(data.state.iteration)
      this.auditTrail.recordStateTransition(data.from, data.to)
    })

    const result = await this.runtime.run({
      userMessage,
      attachments: [],
      kbEnabled: options.kbEnabled ?? false,
      webSearchEnabled: options.webSearchEnabled ?? false,
      selectedRefs: options.selectedRefs ?? [],
    })

    options.onComplete?.(result)

    // ── End-of-session learning ──
    const promotedSkills = await this.livingSkillManager.endSession()
    const learnedRules = await this.skillLearner.generateRules()
    try { await this.skillLearner.persistPatterns() } catch { /* best-effort */ }
    if (promotedSkills.length > 0) {
      console.log(`[LivingSkill] ${promotedSkills.length} 个技能升级:`, promotedSkills.map(s => `${s.title} → ${s.stage}`).join(', '))
    }
    if (learnedRules.length > 0) {
      console.log(`[SkillLearner] 生成了 ${learnedRules.length} 条新规则:`, learnedRules.map(r => r.title).join(', '))
    }

    // ── Metrics Collection: aggregate audit trail ──
    const runtimeToolResults = this.runtime?.getToolResults() || []
    const runtimeMessages = this.runtime?.getMessagesForApi() || []
    try {
      this.metricsCollector.collect(this.auditTrail.getEvents(), this.runId)
    } catch { /* metrics best-effort */ }

    // ── Evaluation Pipeline: analyze this session ──
    try {
      const pipelineOutput = await this.evaluationPipeline.run({
        taskDescription: userMessage,
        toolResults: runtimeToolResults as any,
        messages: runtimeMessages.length > 0 ? runtimeMessages : [
          ...this.history,
          { role: 'user', content: userMessage },
          { role: 'assistant', content: collectedText },
        ],
        auditTrail: this.auditTrail,
        skillLearner: this.skillLearner,
        livingSkillManager: this.livingSkillManager,
      })
      if (pipelineOutput.report.overallScore < 0.6) {
        console.log(`[Evaluator] 评分 ${pipelineOutput.report.overallScore} (${pipelineOutput.report.layer}) — ${pipelineOutput.report.summary}`)
      }
      if (pipelineOutput.autoSuggestions.length > 0) {
        console.log(`[Evaluator] 建议:`, pipelineOutput.autoSuggestions.join('; '))
      }
    } catch { /* evaluation is best-effort */ }

    // ── Post-Session Analysis ──
    try {
      const analysis = await this.postSessionAnalyzer.analyze(
        this.runId, this.auditTrail,
        runtimeToolResults as any, this.livingSkillManager,
      )
      if (analysis.suggestions.length > 0) {
        console.log(`[PostSession] ${analysis.suggestions.join('; ')}`)
      }
    } catch { /* analysis is best-effort */ }

    // ── Feedback Channel: check metrics → generate suggestions ──
    try {
      const aggregate = this.metricsCollector.getAggregate(20)
      const newSuggestions = this.feedbackChannel.check(aggregate)
      if (newSuggestions.length > 0) {
        await this.feedbackChannel.persistNewSuggestions(newSuggestions)
        console.log(`[Feedback] ${newSuggestions.length} 条新建议 → .aiharness/feedback/auto-suggestions.md`)
      }
    } catch { /* feedback is best-effort */ }

    // Persist metrics for trend analysis across sessions
    try { await this.metricsCollector.save() } catch { /* best-effort */ }

    // Persist session
    if (this.sessionId) {
      try {
        const sessionMessages = [
          ...this.history.map(m => ({ ...m, timestamp: (m as any).timestamp || Date.now() })),
          { role: 'user', content: userMessage, timestamp: Date.now() },
          { role: 'assistant', content: collectedText, timestamp: Date.now() },
        ]
        await this.sessionMgr.save(this.sessionId, sessionMessages as any, result.totalTokens)
      } catch { /* session save is best-effort */ }
    }

    return {
      success: result.success,
      text: collectedText || '',
      toolCalls: result.toolCalls,
      totalTokens: result.totalTokens,
      phase: result.phase,
    }
  }

  // ── Abort ──

  abort(): void {
    this.abortController.abort()
    this.runtime?.abort()
  }

  // ── Budget ──

  getBudgetManager(): BudgetManager {
    return this.budgetMgr
  }

  // ── Cleanup ──

  destroy(): void {
    this.abort()
    this.runtime = null
    this.toolCache.invalidateAll()
  }
}
