// ── Chat Bridge 公共基类（v13.x: 合并 V4AgentChatBridge/V4AnthropicChatBridge 的 95% 重复）──
// 两协议 Bridge 仅差异：adapter 构造、流中止目标、runId 前缀。
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
  protected contextWindow = 1_000_000  // v14.9: 默认 1M
  protected history: Message[] = []
  protected abortController = new AbortController()
  protected runId = ''
  // v16.3.0: 联网会话级覆盖（三态循环）——sendMessage 暂存，createAdapter/BridgeContextBuilder 消费。
  // 'builtin'|'off' = 本会话临时不走原生通道；null/undefined = 跟随模型配置（不修改 nativeWebSearch 勾选）
  protected nativeOverride: 'builtin' | 'off' | null | undefined

  /** 协议差异：构造适配器（OpenAI/Anthropic） */
  protected abstract createAdapter(): Promise<ProtocolAdapter>
  /** 协议差异：中止在途 API 流（fileService vs anthropicService） */
  protected abstract abortStream(): void
  /** 协议差异：runId 前缀（区分协议会话） */
  protected abstract getRunId(): string

  constructor(projectId: string | null) {
    this.securityFence = new V4SecurityFence(projectId)
    ensureInitialized()
  }

  init(options: BridgeOptions): void {
    // v14.9(设计决策注释): configId 在此一次性锁定、终身不更新——同一对话内切换模型/协议
    // 不生效是设计决策（防止会话上下文/推理行为与模型不匹配），UI 已禁用切换；
    // 切换模型请新开对话（destroy 重建 bridge 后重新 init）。
    this.configId = options.configId
    this.projectId = options.projectId
    this.maxIterations = options.maxIterations ?? 30
    this.contextWindow = Math.max(1, options.contextWindow ?? 1_000_000)  // v14.9: 默认 1M
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

    // v16.3.0: 会话级联网覆盖暂存（本轮 run 的 adapter 选择与上下文注入消费）
    this.nativeOverride = options.nativeOverride

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
        // v16.0.1(审计 M15): 统一 runId——runtime 不再自生成，store.startRun 与 teardown
        // 守卫用同一 id（原两处各自生成 → 旧 run teardown 可能晚于新 run startRun 清空 UI 状态）
        runId: this.runId,
        // v15.3.1: 主 agent 压缩策略——85% 才自动压缩，达到 85% 链式一次到底（Claude Code 式回退 ~15%）
        compressConfig: {
          thresholds: { strip: 0.85, summarize: 0.9, collapse: 0.95 },
          deepAt: 0.85,
        },
        // v14 批处理: 审计接线 — api:call 事件带 cost/model（会话统计消费）
        auditTrail: this.auditTrail,
        model: (modelConfig as any)?.model,
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
        // v16.3.0: 联网会话级覆盖（原生判定用——原生生效时才跳过内置 DDG）
        nativeOverride: this.nativeOverride,
        selectedKbFileIds: options.selectedKbFileIds,
        // v14.8: 跨 run KB 去重 — 排除历史 run 已注入过的文件
        excludeKbFileIds: options.excludeKbFileIds,
        // v16.1.0(审查修复 B6): 章节全文注入门控——未变化轮不注入全文(成本优化)
        chapterFullText: options.chapterFullText,
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
        // v16.3.0(审计 M7 修复): 删除 onToolProgress 回调——全仓无订阅方（AgentStateBar
        // 已通过 store activeTools 实时显示工具状态），空调用纯浪费
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

      // v14.9(接线): 反馈横幅——runtime 的 hook:blocked（红 ✗）/hook:passed（绿 ✓）事件
      // → AgentStore.hookFeedback（原事件声明存在但无订阅、无写入，横幅死 UI）
      unsubscribes.push(emitter.on('hook:blocked', (data) => {
        store.setHookFeedback({ hookName: data.hookName, passed: false, feedback: data.feedback, timestamp: data.timestamp })
      }))
      unsubscribes.push(emitter.on('hook:passed', (data) => {
        store.setHookFeedback({ hookName: data.hookName, passed: data.passed !== false, feedback: data.feedback, timestamp: data.timestamp })
      }))

      // ── 7. Run ──
      const result = await this.runtime.run({
        userMessage,
        attachments: [],
        // v14.5.0: 跨 run 续跑 — 任务清单进度快照透传（中断未完成 → runtime 恢复门控语义）
        resumeTaskProgress: options.resumeTaskProgress,
        // v14.6.1: 工具开关透传（false → 本轮 tools 传空）
        toolsEnabled: options.toolsEnabled,
      })

      // v16.0.1(审计 M15): setIsStreaming 同样守卫——
      // 旧 run 的该处若晚于新 run startRun，会误清新 run 的流式指示（响应流被新 run 接管后仍显示加载态）
      // v16.3.0(审计 M10 修复): setPeakPromptTokens 已删（死状态——全仓无读取点）
      if (useAgentStore.getState().run.runId === this.runId) {
        useAgentStore.getState().setIsStreaming(false)
      }
      options.onComplete?.(result)
      // v16.0.1(审计 M15): teardown 守卫——仅当 store 中仍是本 run 才 endRun/setPhase。
      // 旧 run 的这三处若晚于新 run 的 startRun，会清空新 run 的 UI 状态（闪烁 IDLE）。
      // 注意：必须实时读 useAgentStore.getState()——sendMessage 开头捕获的 store 引用
      // 在新 run startRun 的 set() 后已 stale（run.runId 是旧值），用旧引用守卫恒失败
      if (useAgentStore.getState().run.runId === this.runId) {
        useAgentStore.getState().endRun()
        // v14.9(A3): endRun 会把 phase 重置为 IDLE——补回最终 phase，让「完成/错误/已中止」
        // 状态标签在运行结束后可见（原恒显示"就绪"，DONE/ERROR/ABORTED 标签从不出现）
        useAgentStore.getState().setPhase(result.phase)
      }
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
        // v14.2.0: 任务清单进度快照透传（中断未完成 → UI 持久化并注入续跑）
        taskProgress: result.taskProgress,
        // v14.3: 子代理执行快照透传（UI 持久化 + 跨 run 注入）
        subagentSummaries: result.subagentSummaries,
        // v14.8: 本轮 KB 预注入文件 id（UI 持久化，下轮排除避免跨 run 重复注入）
        kbInjectedFileIds: result.kbInjectedFileIds,
        // v16.0.1(审计 M11): 本轮工具结果（UI 持久化到 assistant 消息，跨 run 去重重建数据源）
        toolResults: result.toolResults,
        // v16.3.0(审计 H1 修复): 推理链 + API 逐轮明细透传——原缺失导致
        // 「思考过程」面板恒空（index.tsx 读 runResult.reasoningContent 恒 undefined）、
        // 会话记录 api-calls.jsonl 恒空（缓存命中率功能失效）
        reasoningContent: result.reasoningContent,
        apiCallDetails: result.apiCallDetails,
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error'
      store.setLastError(errMsg)
      // v16.0.1(审计 M15): 同正常路径——守卫 runId 防旧 run catch 晚于新 run startRun
      //（实时读 getState——store 快照在新 run startRun 后 stale）
      if (useAgentStore.getState().run.runId === this.runId) {
        useAgentStore.getState().endRun()
        useAgentStore.getState().setPhase('ERROR')  // v14.9(A3): 同正常路径——错误结束也保留 ERROR 标签
      }
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
    // v14.6.1: destroy 必须同时中止底层 controller——runtime.abort() 只置 emitter 标志，
    // 主循环靠 config.abortSignal 检查退出；原实现销毁桥后 run 继续执行（含写工具照常落盘）
    this.abortController.abort()
    this.runtime?.abort()
    this.auditTrail.persist().catch(() => {})
  }
}
