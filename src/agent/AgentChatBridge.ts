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
import { GCAgent } from './gc/GCAgent'
import { MetricsCollector } from './metrics/MetricsCollector'
import { PostSessionAnalyzer } from './metrics/PostSessionAnalyzer'
import { FeedbackChannel } from './feedback/FeedbackChannel'
import { SubAgentManager } from './subagents/SubAgentManager'
import { MemoryLayers } from './memory/MemoryLayers'
import { diagnosticLogger } from './diagnostics/DiagnosticLogger'
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
  toolsEnabled?: boolean
  selectedKbFileIds?: string[]
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
  contextBreakdown?: Array<{ domain: string; tokens: number }>
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
  // Use the same session path as the main process's agentHandlers
  // The fileService resolves '../agent-sessions' relative to projectsBasePath
  // which maps to {appRoot}/agent-sessions/ in both dev and production
  private sessionMgr = new SessionManager('../agent-sessions')

  /** Resolve session storage path — delegates to the main process if available */
  private async getSessionBasePath(): Promise<string> {
    try {
      if ((window as any).electron?.agent?.getSessionsPath) {
        return await (window as any).electron.agent.getSessionsPath()
      }
    } catch { /* fallback to default */ }
    return '../agent-sessions'
  }
  private evaluationPipeline = new EvaluationPipeline()
  private metricsCollector = new MetricsCollector()
  private postSessionAnalyzer = new PostSessionAnalyzer(this.metricsCollector)
  private gcAgent = new GCAgent()
  private feedbackChannel = new FeedbackChannel()
  private subAgentManager = new SubAgentManager(toolRegistry)
  private memoryLayers = new MemoryLayers()
  private pipeline: import('./pipeline/TaskPipeline').TaskPipeline | null = null
  private lastPipelineResult: import('./pipeline/types').PipelineResult | null = null

  private initialized = false
  private configId = ''
  private projectId: string | null = null
  private workMode: 'plan' | 'action' = 'action'
  private maxIterations = 20
  private history: Message[] = []
  private abortController: AbortController = new AbortController()
  private runId = ''
  private sessionId: string | null = null
  private isRunning = false

  // ── Init ──

  init(options: BridgeInitOptions): void {
    ensureInitialized()

    this.configId = options.configId
    this.projectId = options.projectId
    this.workMode = options.workMode
    this.maxIterations = options.maxIterations ?? 20
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

    // Re-entrancy guard: prevent concurrent sendMessage calls
    if (this.isRunning) {
      diagnosticLogger.recordInfo('sendMessage 被重入守卫阻止')
      return { success: false, text: '上一个请求仍在处理中', toolCalls: 0, totalTokens: 0, phase: 'ERROR' }
    }
    this.isRunning = true
    diagnosticLogger.recordInfo(`sendMessage 开始: "${userMessage.slice(0, 50)}..."`)

    // Circuit breaker check
    const cbCheck = this.circuitBreaker.beforeCall()
    if (!cbCheck.allowed) {
      this.isRunning = false
      return { success: false, text: cbCheck.reason || '断路保护已激活', toolCalls: 0, totalTokens: 0, phase: 'ERROR' }
    }

    this.runId = Date.now().toString(36)
    this.abortController = new AbortController()

    let collectedText = ''
    let runResult: Awaited<ReturnType<typeof this.executeRun>> | null = null
    try {
      await this.initSession(userMessage)
      const result = await this.executeRun(userMessage, options)
      collectedText = result.collectedText
      runResult = result

      return {
        success: result.result.success,
        text: collectedText || '',
        toolCalls: result.result.toolCalls,
        totalTokens: result.result.totalTokens,
        phase: result.result.phase,
        contextBreakdown: result.result.contextBreakdown,
      }
    } finally {
      // Persist session in finally block — guarantees save even on errors
      if (this.sessionId) {
        try {
          // Build deduplicated session messages from runtime context (most complete source)
          const runtimeMessages = this.runtime?.getMessagesForApi() || []
          // Filter to user/assistant only; runtimeMessages already includes full history
          const seen = new Set<string>()
          const sessionMessages: Array<{ role: string; content: string; timestamp: number }> = []
          for (const m of runtimeMessages) {
            if (m.role !== 'user' && m.role !== 'assistant') continue
            const key = `${m.role}:${m.content?.slice(0, 100)}`
            if (seen.has(key)) continue
            seen.add(key)
            sessionMessages.push({ role: m.role, content: m.content || '', timestamp: Date.now() })
          }
          // Ensure current user message and assistant response are included
          if (!sessionMessages.some(m => m.role === 'user' && m.content === userMessage)) {
            sessionMessages.push({ role: 'user', content: userMessage, timestamp: Date.now() })
          }
          if (collectedText && !sessionMessages.some(m => m.role === 'assistant' && m.content === collectedText)) {
            sessionMessages.push({ role: 'assistant', content: collectedText, timestamp: Date.now() })
          }
          await this.sessionMgr.save(this.sessionId, sessionMessages as any, runResult?.result.totalTokens || 0)
        } catch (err) {
          console.error('[AgentBridge] 会话保存失败 — 对话历史可能丢失:', err)
          // Notify the UI that session persistence failed
          useAgentStore.getState().setLastError(
            `会话保存失败: ${err instanceof Error ? err.message : '未知错误'}`
          )
        }
      }
      this.isRunning = false
      diagnosticLogger.recordInfo('sendMessage 结束')
      await diagnosticLogger.flush()
    }
  }

  private async initSession(userMessage: string): Promise<void> {
    this.auditTrail.startSession(this.runId)
    this.skillLearner.startSession(this.runId, this.projectId)
    await this.skillLearner.loadLearned()

    try { await this.metricsCollector.load() } catch { /* first session — no saved metrics yet */ }

    try {
      const session = await this.sessionMgr.create(userMessage.slice(0, 50), this.projectId)
      this.sessionId = session.id
      useAgentStore.getState().addSession(session as any)
      try {
        const prevSessions = await this.sessionMgr.list({ projectId: this.projectId || undefined })
        if (prevSessions.length > 1) {
          const prevSession = await this.sessionMgr.load(prevSessions[1].id)
          if (prevSession && prevSession.messages.length > 0) {
            console.log(`[AgentBridge] 已加载上次会话 (${prevSession.meta.messageCount} 条消息)`)
          }
        }
      } catch { /* prev session load is optional */ }
    } catch (err) { console.warn('[AgentBridge] Session creation failed:', err) }
  }

  private async executeRun(
    userMessage: string,
    options: SendMessageOptions,
  ): Promise<{ collectedText: string; result: Awaited<ReturnType<AgentRuntime['run']>> }> {
    const store2 = useAgentStore.getState()

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
          // Convert OpenAI format to flat format for runtime's ToolCallRequest type
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
          const results = await kbService.search(msg, this.projectId, this.configId || '', 3, options.selectedKbFileIds)
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
        // If plan is approved and this step is approved, skip per-tool approval
        const runtimePlan = this.runtime?.getState().executionPlan
        const runtimePlanPhase = this.runtime?.getState().planPhase
        let stepApproved = false
        if (runtimePlan && runtimePlanPhase === 'approved') {
          const matching = runtimePlan.steps.find(
            s => s.approvalStatus === 'approved' && s.tool === ctx.toolName
          )
          if (matching) stepApproved = true
        }
        if (!stepApproved) {
          diagnosticLogger.recordApprovalPending(ctx.toolName)
          const timeoutPromise = new Promise<boolean>(r => setTimeout(() => r(false), 180000))
          const approved = await Promise.race([
            options.onApprovalRequired([{ name: ctx.toolName, args }]),
            timeoutPromise,
          ])
          diagnosticLogger.recordApprovalResolved(ctx.toolName, approved)
          if (!approved) {
            return { status: 'error', summary: '用户拒绝了此操作（或审批超时）' }
          }
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
        this.policyEngine.setDefaultEffect(config.permissions.defaultEffect === 'allow' ? 'allow' : 'deny')
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

      // Budget: use config values instead of hardcoded defaults
      if (config.budget.maxTokensPerSession > 0) {
        this.budgetMgr = new BudgetManager(config.budget.maxTokensPerSession)
      }

      // Circuit breaker: use config values
      if (config.circuitBreaker.maxConsecutiveFailures > 0) {
        this.circuitBreaker = new CircuitBreaker(config.circuitBreaker.maxConsecutiveFailures, config.circuitBreaker.cooldownMs)
      }
    } catch (err) {
      console.error('[AgentBridge] AiHarnessConfig 加载失败，回退到宽松默认值:', err)
      // When config fails to load, default to ALLOW so tools still work
      this.policyEngine.setDefaultEffect('allow')
    }

    // Wire Harness into runtime
    this.runtime.setHookEngine(this.hookEngine)
    this.runtime.setLivingSkillManager(this.livingSkillManager)
    this.runtime.setReflectionEngine(this.reflectionEng)
    this.runtime.setConstraintEngine(this.constraintEngine)
    this.runtime.setPolicyEngine(this.policyEngine)
    this.runtime.setSkillLearner(this.skillLearner)
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
    // Wire up hallucination detector so AI can't claim actions without calling tools
    const { HallucinationDetector } = await import('./runtime/HallucinationDetector')
    this.runtime.setHallucinationDetector(new HallucinationDetector())
    this.runtime.setEvaluationPipeline(this.evaluationPipeline)
    // Wire EvaluatorAgent layer 2 (LLM-based deep evaluation) using the same AI service
    this.evaluationPipeline.setEvaluatorAIService({
      chat: async (msgs) => {
        const result = await aiService.chatWithTools(msgs, this.configId, this.projectId || undefined)
        return { text: result.text, usage: result.usage ? { total_tokens: result.usage.total_tokens } : undefined }
      },
    })
    this.runtime.setGCAgent(this.gcAgent)
    // Run novel-specific GC scans (orphan characters, plot continuity, etc.)
    if (this.projectId) {
      this.gcAgent.reset()
      // Await scans so the report is populated before it's read later
      try { await this.gcAgent.runNovelScans(this.projectId) } catch (err) {
        console.warn('[AgentBridge] GC novel scans failed (non-blocking):', err)
      }
    }
    this.livingSkillManager.startSession(this.runId, this.projectId)
    this.circuitBreaker.reset()

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
      const learnedRules = this.skillLearner.getActiveRules()
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
    } catch (err) { console.warn('[AgentBridge] Skill learner rule registration failed:', err) }

    // ── Inject MemoryLayers (cross-session memory) ──
    try {
      // Load CLAUDE.md as permanent layer
      const { fileService: fs } = await import('@/services/fileService')
      try {
        const claudeMd = await fs.read('CLAUDE.md')
        if (claudeMd && claudeMd.trim()) {
          this.memoryLayers.addLayer({ name: 'project-rules', priority: 95, lifetime: 'permanent', content: claudeMd.slice(0, 3000) })
        }
      } catch { /* CLAUDE.md not found */ }
      // Load learned rules as auto-memory layer
      const learnedForMemory = this.skillLearner.getContextInject()
      if (learnedForMemory) {
        this.memoryLayers.addLayer({ name: 'learned-experience', priority: 90, lifetime: 'session', content: learnedForMemory })
      }
      const memoryPrompt = this.memoryLayers.getSystemPrompt(3000)
      if (memoryPrompt) {
        contextAssembler.register({
          domain: 'memory-layers',
          relevance: () => 1.0,
          buildContext: async () => ({ domain: 'memory-layers', priority: 105, estimatedTokens: Math.ceil(memoryPrompt.length / 3), content: memoryPrompt }),
        })
      }
    } catch (err) { console.warn('[AgentBridge] Memory layers failed:', err) }

    // ── TaskPipeline: Classifier → Intent+Plan → Approval (V2) ──
    try {
      if (!this.pipeline) {
        this.pipeline = new (await import('./pipeline/TaskPipeline')).TaskPipeline(
          this.configId, this.projectId,
        )
      }
      this.lastPipelineResult = await this.pipeline.run(userMessage)

      if (this.lastPipelineResult.phase === 'awaiting_approval'
        && this.lastPipelineResult.clarificationQuestions?.length) {
        // Intent was ambiguous — return clarification questions to user
        this.isRunning = false
        return {
          collectedText: this.lastPipelineResult.clarificationQuestions.map(q => `• ${q}`).join('\n'),
          result: { success: true, text: '', messageCount: 0, totalTokens: this.lastPipelineResult.pipelineTokens, toolCalls: 0, phase: 'AWAITING_APPROVAL', thinkingPlan: null, toolsUsed: [], hallucinationWarnings: [], kbSources: [], webSources: [], images: [], reasoningContent: null },
        }
      }

      if (this.lastPipelineResult.phase === 'done' && this.lastPipelineResult.directText) {
        // Simple chat — return direct response without tool execution
        this.isRunning = false
        return {
          collectedText: this.lastPipelineResult.directText,
          result: { success: true, text: this.lastPipelineResult.directText, messageCount: 1, totalTokens: this.lastPipelineResult.pipelineTokens, toolCalls: 0, phase: 'RESPONDING', thinkingPlan: null, toolsUsed: [], hallucinationWarnings: [], kbSources: [], webSources: [], images: [], reasoningContent: null },
        }
      }

      // Complex task: pre-populate the plan for approval flow
      if (this.lastPipelineResult.plan && this.runtime) {
        this.runtime.injectPlan(this.lastPipelineResult.plan)
        // If auto-approved (low complexity), skip waiting — planPhase is already 'approved'
      }
    } catch (err) {
      console.warn('[AgentBridge] TaskPipeline failed, falling back to direct execution:', err)
      // Fallback: continue with existing flow
    }

    // ── SubAgentManager: delegate complex tasks to specialized sub-agents ──
    let subAgentResult: string | null = null
    try {
      const msg = userMessage || ''
      const subAgentMap: Array<{ pattern: RegExp; agentName: string }> = [
        { pattern: /检查.*(?:角色|人物).*(?:矛盾|一致|冲突)/, agentName: 'consistency-checker' },
        { pattern: /分析.*(?:风格|文风|笔风)/, agentName: 'style-analyzer' },
        { pattern: /规划.*(?:章节|第.*章).*结构/, agentName: 'chapter-planner' },
        { pattern: /创建.*场景.*模板/, agentName: 'scene-builder' },
        { pattern: /整理.*知识库|知识库.*整理/, agentName: 'knowledge-curator' },
      ]
      for (const { pattern, agentName } of subAgentMap) {
        if (pattern.test(msg)) {
          this.subAgentManager.setParentRuntime(this.runtime)
          const result = await this.subAgentManager.delegate(agentName, msg, this.configId, this.projectId)
          if (result.status === 'success' && result.output) {
            subAgentResult = `[子Agent ${agentName} 分析结果]\n${result.output}`
          }
          break
        }
      }
    } catch (err) { console.warn('[AgentBridge] Sub-agent delegation failed:', err) }

    // Inject sub-agent result as context if available
    if (subAgentResult) {
      contextAssembler.register({
        domain: 'sub-agent-result',
        relevance: () => 1.0,
        buildContext: async () => ({ domain: 'sub-agent-result', priority: 120, estimatedTokens: Math.ceil(subAgentResult!.length / 3), content: subAgentResult! }),
      })
    }

    // Set tools: full tool set for AgentRuntime (planning + execution handled internally)
    // The Orchestrator multi-agent pipeline is available via CLI (scripts/agent-cli.mjs)
    if (options.toolsEnabled !== false) {
      const schemas = toolRegistry.getFilteredSchemas(this.workMode, undefined)
      try {
        const settingsStore = (await import('@/store')).useSettingsStore.getState()
        const config = settingsStore.configs?.find((c: any) => c.id === this.configId)
        if (!/dall-e|imagen|stable.diffusion|midjourney|flux/i.test(config?.model || '')) {
          this.runtime.setTools(schemas.filter((s: any) => s.function?.name !== 'generate_image'))
        } else {
          this.runtime.setTools(schemas)
        }
      } catch {
        this.runtime.setTools(schemas)
      }
    }

    // Set history
    this.runtime.setHistory(this.history)

    // Wire events to callbacks
    const emitter = this.runtime.getEmitter()

    // Start run in store (activates AgentStateBar + AgentThinkingPanel)
    store2.startRun(this.runId)

    emitter.on('thinking:start', (data) => {
      store2.setThinking(data)
      options.onThinking?.(data)
    })

    emitter.on('thinking:progress', (data) => {
      // Update thinking context with progress info
      const current = useAgentStore.getState().run.thinking
      if (current) {
        store2.setThinking({ ...current, intent: `[${data.step}/${data.totalSteps}] ${data.description}` })
      }
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
      store2.setStreamingText(data.accumulated)
      store2.setIsStreaming(true)
      options.onResponse?.(data)
    })

    emitter.on('agent:state', (data) => {
      store2.setPhase(data.to)
      store2.setIteration(data.state.iteration)
      this.auditTrail.recordStateTransition(data.from, data.to)
    })

    emitter.on('hook:blocked', (data) => {
      store2.setHookFeedback({ hookName: data.hookName, passed: false, feedback: data.feedback, timestamp: data.timestamp })
    })

    emitter.on('error', (data) => {
      store2.setLastError(data.message)
    })

    emitter.on('api:call', (data) => {
      this.auditTrail.recordApiCall(data.promptTokens, data.completionTokens)
    })

    // ── Plan event handlers ──
    emitter.on('plan:proposed', (plan) => {
      store2.setExecutionPlan(plan)
      store2.setPlanPhase('awaiting_approval')
      // Show PlanCard for ALL plans — user approves/rejects every step
      if (options.onApprovalRequired && plan.steps.length > 0) {
        const allSteps = plan.steps.map(s => ({ name: s.tool, args: s.args }))
        options.onApprovalRequired(allSteps).then(approved => {
          if (approved) {
            this.runtime?.approvePlan()
          } else {
            this.runtime?.rejectPlan()
          }
        }).catch(err => {
          console.error('[AgentBridge] Plan approval callback failed:', err)
          // Auto-reject on error to prevent hanging in AWAITING_APPROVAL
          this.runtime?.rejectPlan()
        })
      } else {
        // No callback available or empty plan — auto-approve
        this.runtime?.approvePlan()
      }
    })

    emitter.on('plan:approved', () => {
      store2.setPlanPhase('approved')
    })

    emitter.on('plan:rejected', () => {
      store2.setPlanPhase('rejected')
    })

    emitter.on('plan:deviation', (data) => {
      store2.setPlanDeviation({ toolName: data.toolName, message: '不在批准的计划中' })
    })

    emitter.on('verify:start', (_data) => {
      store2.setVerificationReports([])
    })

    emitter.on('verify:stepResult', (report) => {
      store2.addVerificationReport(report)
    })

    let result: Awaited<ReturnType<typeof this.runtime.run>>
    try {
      result = await this.runtime.run({
        userMessage,
        attachments: [],
        kbEnabled: options.kbEnabled ?? false,
        webSearchEnabled: options.webSearchEnabled ?? false,
        selectedRefs: options.selectedRefs ?? [],
      })
    } catch (err) {
      store2.setIsStreaming(false)
      store2.endRun()
      throw err
    }

    // Keep isRunning=true through onComplete so tool cards remain visible
    store2.setIsStreaming(false)
    options.onComplete?.(result)
    store2.endRun()

    // ── End-of-session learning ──
    const promotedSkills = await this.livingSkillManager.endSession()
    const learnedRules = await this.skillLearner.generateRules()
    try { await this.skillLearner.persistPatterns() } catch (err) { console.warn('[AgentBridge] Pattern persistence failed:', err) }
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
    } catch (err) { console.warn('[AgentBridge] Metrics collection failed:', err) }

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
    } catch (err) { console.warn('[AgentBridge] Evaluation pipeline failed:', err) }

    // ── Post-Session Analysis ──
    try {
      const analysis = await this.postSessionAnalyzer.analyze(
        this.runId, this.auditTrail,
        runtimeToolResults as any, this.livingSkillManager,
      )
      if (analysis.suggestions.length > 0) {
        console.log(`[PostSession] ${analysis.suggestions.join('; ')}`)
      }
    } catch (err) { console.warn('[AgentBridge] Post-session analysis failed:', err) }

    // ── Feedback Channel: check metrics → generate suggestions ──
    try {
      const aggregate = this.metricsCollector.getAggregate(20)
      if (aggregate) {
        const newSuggestions = this.feedbackChannel.check(aggregate)
        if (newSuggestions.length > 0) {
          await this.feedbackChannel.persistNewSuggestions(newSuggestions)
          console.log(`[Feedback] ${newSuggestions.length} 条新建议 → .aiharness/feedback/auto-suggestions.md`)
        }
      }
    } catch (err) { console.warn('[AgentBridge] Feedback channel failed:', err) }

    // Persist metrics for trend analysis across sessions
    try { await this.metricsCollector.save() } catch (err) { console.warn('[AgentBridge] Metrics save failed:', err) }

    // ── Write health state to store (for Agent settings page) ──
    try {
      const store = useAgentStore.getState()
      const aggregate = this.metricsCollector.getAggregate(20)
      store.setHealth({
        circuitState: this.circuitBreaker.currentState,
        circuitFailures: (this.circuitBreaker as any).failureCount ?? 0,
        checkpointCount: this.checkpointMgr.count,
        autoApprovedTools: [],
        lastSessionMetrics: aggregate ? {
          toolSuccessRate: aggregate.avgToolSuccessRate,
          hallucinationRate: aggregate.hallucinationRate,
          iterationCycles: aggregate.avgIterationCycles,
          trend: aggregate.trend,
        } : store.health.lastSessionMetrics,
      })
    } catch (err) { console.warn('[AgentBridge] Health state update failed:', err) }

    return { collectedText, result }
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
