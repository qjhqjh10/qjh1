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
import { AgentEventEmitter } from './runtime/AgentEventEmitter'
import { toolRegistry } from './tools/ToolRegistry'
import { contextAssembler } from './context/ContextAssembler'
import { useAgentStore } from './store/AgentStore'
import { PermissionManager } from './permissions/PermissionManager'
import { BudgetManager } from './budget/BudgetManager'
import { ReflectionEngine } from './reflection/ReflectionEngine'
import { ToolCache } from './cache/ToolCache'
import { ALL_TOOLS } from './tools/definitions'
import { ALL_PROVIDERS } from './context/providers'
import { aiService } from '@/services/fileService'
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
  private emitter: AgentEventEmitter | null = null
  private permissionMgr = new PermissionManager()
  private budgetMgr = new BudgetManager(128000)
  private reflectionEng = new ReflectionEngine()
  private toolCache = new ToolCache()

  private initialized = false
  private configId = ''
  private projectId: string | null = null
  private workMode: 'plan' | 'action' = 'action'
  private history: Message[] = []
  private abortController: AbortController = new AbortController()

  // ── Init ──

  init(options: BridgeInitOptions): void {
    ensureInitialized()

    this.configId = options.configId
    this.projectId = options.projectId
    this.workMode = options.workMode
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

    const store = useAgentStore.getState()

    // Build runtime
    this.abortController = new AbortController()
    this.emitter = new AgentEventEmitter()
    const store2 = useAgentStore.getState()

    this.runtime = new AgentRuntime({
      configId: this.configId,
      projectId: this.projectId,
      workMode: this.workMode,
      maxIterations: 8,
      abortSignal: this.abortController.signal,
    })

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

    // Inject context assembler
    this.runtime.setContextAssembler(async (msg, hist) => {
      return contextAssembler.assemble(msg, hist, this.projectId)
    })

    // Inject tool executor (with caching)
    this.runtime.setToolExecutor(async (args, ctx) => {
      // For reads, check cache first
      const cacheKey = `${ctx.toolName}:${JSON.stringify(args)}`
      if (this.toolCache.has(cacheKey)) {
        return this.toolCache.get(cacheKey)!
      }
      const result = await toolRegistry.execute(ctx.toolName, args, ctx)
      // Cache successful reads
      if (result.status === 'success' && ctx.toolName === 'read_file') {
        this.toolCache.set(cacheKey, result)
      }
      return result
    })

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

    emitter.on('response:streaming', (data) => {
      options.onResponse?.(data)
    })

    emitter.on('agent:state', (data) => {
      store2.setPhase(data.to)
      store2.setIteration(data.state.iteration)
    })

    // Run!
    let collectedText = ''
    emitter.on('response:streaming', (d) => { collectedText = d.accumulated })

    const result = await this.runtime.run({
      userMessage,
      attachments: [],
      kbEnabled: options.kbEnabled ?? false,
      webSearchEnabled: options.webSearchEnabled ?? false,
      selectedRefs: options.selectedRefs ?? [],
    })

    options.onComplete?.(result)

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
    this.emitter?.abort()
  }

  // ── Permissions ──

  getPermissionManager(): PermissionManager {
    return this.permissionMgr
  }

  recordPermissionDecision(toolName: string, approved: boolean): void {
    this.permissionMgr.recordDecision(toolName, approved)
  }

  // ── Budget ──

  getBudgetManager(): BudgetManager {
    return this.budgetMgr
  }

  // ── Cleanup ──

  destroy(): void {
    this.abort()
    this.runtime = null
    this.emitter = null
    this.toolCache.invalidateAll()
  }
}
