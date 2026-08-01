// ── Chat Bridge 公共基类（v13.x: 合并 V4AgentChatBridge/V4AnthropicChatBridge 的 95% 重复）──
// 两协议 Bridge 仅差异：adapter 构造、流中止目标、runId 前缀、enableThinkingPlan。
// 其余 init/updateProject/updateHistory/sendMessage/abort/destroy 逐行相同 → 收敛于此。

import { V4UnifiedRuntime } from './runtime/V4UnifiedRuntime'
import { V4SecurityFence } from './V4SecurityFence'
import { buildSystemPrompt } from './V4SystemPrompt'
import { AuditTrail } from './audit/AuditTrail'
import { toolRegistry } from './skills/ToolRegistry'
import { BridgeContextBuilder } from './context/BridgeContextBuilder'
import { createToolExecutor } from './bridge/toolExecutorFactory'
import { ALL_TOOLS } from './skills/tools'
import { useAgentStore } from './store/AgentStore'
import { diagnosticLogger } from './diagnostics/DiagnosticLogger'
import type { Message } from './state/types'
import type { ProtocolAdapter } from './runtime/adapters/ProtocolAdapter'
import type { BridgeOptions, SendOptions, BridgeSendResult } from './ChatBridgeInterface'

// ── Init ──

let toolsRegistered = false

function ensureInitialized() {
  if (!toolsRegistered) {
    toolRegistry.registerAll(ALL_TOOLS as any)
    toolsRegistered = true
  }
}

// ── Bridge ──

export abstract class BaseChatBridge {
  protected runtime: V4UnifiedRuntime | null = null
  protected securityFence: V4SecurityFence
  protected auditTrail = new AuditTrail()

  protected initialized = false
  protected configId = ''
  protected projectId: string | null = null
  protected maxIterations = 30  // v11.5.1: 60→30，nudge上限+写优先已消除死锁，30足够
  protected contextWindow = 128_000
  protected history: Message[] = []
  protected abortController = new AbortController()
  protected runId = ''

  /** 协议差异：构造适配器（OpenAI/Anthropic） */
  protected abstract createAdapter(): Promise<ProtocolAdapter>
  /** 协议差异：中止在途 API 流（fileService vs anthropicService） */
  protected abstract abortStream(): void
  /** 协议差异：runId 前缀（区分协议会话） */
  protected abstract getRunId(): string
  /** 协议差异：是否启用 thinking plan */
  protected abstract getEnableThinkingPlan(): boolean

  constructor(projectId: string | null) {
    this.securityFence = new V4SecurityFence(projectId)
    ensureInitialized()
  }

  init(options: BridgeOptions): void {
    this.configId = options.configId
    this.projectId = options.projectId
    this.maxIterations = options.maxIterations ?? 30
    this.contextWindow = Math.max(1, options.contextWindow ?? 128_000)
    this.history = options.historyMessages || []
    this.securityFence = new V4SecurityFence(this.projectId)
    this.initialized = true
  }

  updateProject(projectId: string | null): void {
    if (this.projectId && this.projectId !== projectId) {
      import('./context/FileCache').then(m => m.invalidateProjectFiles(this.projectId!))
    }
    this.projectId = projectId
    // 索引是全局的（含所有项目），切换项目无需重发
    this.securityFence = new V4SecurityFence(projectId)
  }

  updateHistory(messages: Message[]): void {
    this.history = messages
  }

  async sendMessage(userMessage: string, options: SendOptions = {}): Promise<BridgeSendResult> {
    if (!this.initialized) throw new Error('ChatBridge not initialized')

    // Guard: abort any in-progress run before starting a new one
    if (this.runtime) {
      this.abortController.abort()
      this.runtime.abort()
      this.abortStream()
    }

    this.runId = this.getRunId()
    this.abortController = new AbortController()
    const store = useAgentStore.getState()

    this.auditTrail.startSession(this.runId)
    diagnosticLogger.clearRecent()  // Clear stale diagnostic events from previous runs

    // Collect emitter unsubscribe functions for cleanup
    const unsubscribes: Array<() => void> = []

    try {
      // ── 0. 加载模型配置 (v12.5.1: 阶段感知温度需要 temperature/toolTemperature) ──
      const { useSettingsStore } = await import('@/store')
      const settingsConfigs = useSettingsStore.getState().configs
      const modelConfig = settingsConfigs.find(c => c.id === this.configId)
      const creativeTemp = (modelConfig as any)?.temperature ?? 1.0
      const toolTemp = (modelConfig as any)?.toolTemperature ?? 0.5

      // ── 1. Create Runtime (V4UnifiedRuntime + 协议 adapter) ──
      const adapter = await this.createAdapter()
      this.runtime = new V4UnifiedRuntime({
        configId: this.configId,
        projectId: this.projectId,
        maxIterations: this.maxIterations,
        abortSignal: this.abortController.signal,
        contextWindow: this.contextWindow,
        temperature: creativeTemp,
        toolTemperature: toolTemp,
      }, adapter)

      // ── 2. 工具: 始终全量 — 前缀缓存使重复传输几乎免费 ──
      const schemas = toolRegistry.getAllSchemas()
      this.runtime.setTools(schemas)

      // ── 3. Wire Context Assembler ──
      const CORE_PROMPT = await buildSystemPrompt()
      const contextBuilder = new BridgeContextBuilder({
        projectId: this.projectId,
        configId: this.configId,
        kbEnabled: !!options.kbEnabled,
        webSearchEnabled: !!options.webSearchEnabled,
        selectedKbFileIds: options.selectedKbFileIds,
        enableThinkingPlan: this.getEnableThinkingPlan(),
      })

      this.runtime.setContextAssembler(async (msg, hist, pid) => {
        const result = await contextBuilder.buildContext(msg, hist, pid, CORE_PROMPT)
        return result
      })

      // ── 4. Wire Tool Executor (shared factory: SecurityFence → Approval → Execute → Audit → Cache) ──
      const toolExecutor = createToolExecutor({
        securityFence: this.securityFence,
        auditTrail: this.auditTrail,
        projectId: this.projectId,
        onApprovalRequired: options.onApprovalRequired,
      })
      this.runtime.setToolExecutor(toolExecutor)

      // ── 5. Set history ──
      this.runtime.setHistory(this.history)

      // ── 6. Wire events to store ──
      const emitter = this.runtime.getEmitter()
      store.startRun(this.runId)

      unsubscribes.push(emitter.on('thinking:start', (data) => { store.setThinking(data) }))
      unsubscribes.push(emitter.on('tool:started', (data) => { store.addToolExecution(data.callId, data.toolName) }))
      unsubscribes.push(emitter.on('tool:completed', (data) => {
        store.completeTool(data.callId, 'success', data.summary, data.detail)
        options.onToolProgress?.({ callId: data.callId, toolName: data.toolName, phase: 'done', progress: 1, message: data.summary, timestamp: Date.now() })
      }))
      unsubscribes.push(emitter.on('tool:failed', (data) => {
        store.completeTool(data.callId, 'error', data.summary, data.detail)
      }))

      let collectedText = ''
      unsubscribes.push(emitter.on('response:streaming', (data) => {
        collectedText = data.accumulated
        store.setStreamingText(data.accumulated)
        store.setIsStreaming(true)
        options.onResponse?.(data)
      }))

      // ── 7. Run ──
      const result = await this.runtime.run({
        userMessage,
        attachments: [],
      })

      store.setIsStreaming(false)
      options.onComplete?.(result)
      store.setPeakPromptTokens(result.promptTokens)
      store.endRun()
      // 会话结束时持久化审计数据到磁盘
      this.auditTrail.persist().catch(() => {})

      return {
        success: result.success,
        text: result.text || collectedText,
        toolCalls: result.toolCalls,
        totalTokens: result.totalTokens,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        cacheHitTokens: result.cacheHitTokens || 0,
        cacheCreationTokens: result.cacheCreationTokens || 0,
        cost: result.cost || 0,
        phase: result.phase,
        toolsUsed: result.toolsUsed,
        iterationCount: result.iterationCount,
        toolCallSteps: result.toolCallSteps,
        contextBreakdown: result.contextBreakdown,
        estimatedContextTokens: result.estimatedContextTokens,
        subAgentUsage: result.subAgentUsage,
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error'
      store.setLastError(errMsg)
      store.endRun()
      this.auditTrail.persist().catch(() => {})
      return { success: false, text: `错误: ${errMsg}`, toolCalls: 0, totalTokens: 0, promptTokens: 0, completionTokens: 0, cacheHitTokens: 0, cacheCreationTokens: 0, cost: 0, phase: 'ERROR', toolsUsed: [], iterationCount: 0, toolCallSteps: [] }
    } finally {
      // Clean up all emitter listeners to prevent leaks on re-send
      for (const unsub of unsubscribes) {
        try { unsub() } catch { /* defensive */ }
      }
    }
  }

  abort(): void {
    this.abortController.abort()
    this.runtime?.abort()
    // Persist audit trail before aborting (best-effort)
    this.auditTrail.persist().catch(() => {})
  }

  destroy(): void {
    this.runtime?.abort()
    this.auditTrail.persist().catch(() => {})
  }
}
