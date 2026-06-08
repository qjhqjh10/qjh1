// ── V4 Anthropic Chat Bridge ──
// Anthropic 协议专用 Bridge。独立于 V4AgentChatBridge（OpenAI 协议），
// 共享相同的依赖：SecurityFence、AuditTrail、LearningEngine、ContextAssembler、
// ToolRegistry、SystemPrompt、Providers。
//
// 与 V4AgentChatBridge 的主要差异：
//   - 使用 V4AnthropicRuntime → Anthropic 流式 content blocks 循环
//   - 使用 anthropicService → fetch + SSE 呼叫 DeepSeek /anthropic 端点
//   - 不需要 IntentClassifier / 工具裁剪（模型自然选择工具）
//   - 不需要渐进工具展开（模型决定何时调工具）

import { V4UnifiedRuntime } from './runtime/V4UnifiedRuntime'
import { AnthropicAdapter } from './runtime/adapters/AnthropicAdapter'
import type { V4AgentRunResult, ToolExecutorFn } from './runtime/RuntimeTypes'
import { V4SecurityFence } from './V4SecurityFence'
import { buildSystemPrompt } from './V4SystemPrompt'
import { AuditTrail } from './audit/AuditTrail'
import { LearningEngine } from './learning/LearningEngine'
import { toolRegistry } from './skills/ToolRegistry'
import { BridgeContextBuilder } from './context/BridgeContextBuilder'
import { invalidateAfterTool } from './context/CacheInvalidator'
import { contextAssembler } from './context/ContextAssembler'
import { ALL_TOOLS } from './skills/tools'
import { useAgentStore } from './store/AgentStore'
import { diagnosticLogger } from './diagnostics/DiagnosticLogger'
// v11.6.1: isTaskMessage 暂时停用 — 参考 Claude 架构 tool_choice:auto
// import { isTaskMessage } from './utils/taskDetection'
import type { Message } from './state/types'
import type {
  BridgeOptions,
  SendOptions,
  BridgeSendResult,
} from './ChatBridgeInterface'

// ── Init ──

let toolsRegistered = false

function ensureInitialized() {
  if (!toolsRegistered) {
    toolRegistry.registerAll(ALL_TOOLS as any)
    toolsRegistered = true
  }
}

// ── Bridge ──

export class V4AnthropicChatBridge {
  private runtime: V4UnifiedRuntime | null = null
  private securityFence: V4SecurityFence
  private auditTrail = new AuditTrail()
  private learningEngine = new LearningEngine()

  private initialized = false
  private configId = ''
  private projectId: string | null = null
  private maxIterations = 30  // v11.5.1: 60→30，nudge上限+写优先已消除死锁，30足够
  private contextWindow = 128_000
  private history: Message[] = []
  private abortController = new AbortController()
  private runId = ''

  constructor(projectId: string | null) {
    this.securityFence = new V4SecurityFence(projectId)
    ensureInitialized()
  }

  init(options: BridgeOptions): void {
    this.configId = options.configId
    this.projectId = options.projectId
    this.maxIterations = options.maxIterations ?? 60
    this.contextWindow = options.contextWindow ?? 128_000
    this.history = options.historyMessages || []
    this.securityFence = new V4SecurityFence(this.projectId)
    this.initialized = true
  }

  updateProject(projectId: string | null): void {
    if (this.projectId && this.projectId !== projectId) {
      contextAssembler.clearProject(this.projectId)
      import('./context/FileCache').then(m =>
        m.invalidateProjectFilesReexport(this.projectId!),
      )
    }
    this.projectId = projectId
    this.securityFence = new V4SecurityFence(projectId)
  }

  updateHistory(messages: Message[]): void {
    this.history = messages
  }

  async sendMessage(
    userMessage: string,
    options: SendOptions = {},
  ): Promise<BridgeSendResult> {
    if (!this.initialized) throw new Error('V4AnthropicChatBridge not initialized')

    // 中止之前的运行（v9.6.0: 补充 anthropicService stream abort — Bug 1 修复）
    if (this.runtime) {
      this.abortController.abort()
      this.runtime.abort()
      import('@/services/anthropicService').then(m =>
        m.anthropicService.abortAnthropicStream(),
      ).catch(() => {})
    }

    this.runId = `ant_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
    this.abortController = new AbortController()
    const store = useAgentStore.getState()

    this.auditTrail.startSession(this.runId)
    await this.learningEngine.load()
    diagnosticLogger.clearRecent()

    const unsubscribes: Array<() => void> = []

    try {
      // ── 1. 创建 Runtime (V4UnifiedRuntime + AnthropicAdapter — constructor-injected) ──
      const { anthropicService } = await import('@/services/anthropicService')
      const adapter = new AnthropicAdapter({
        chatAnthropicStream: async (params) => {
          const result = await anthropicService.chatAnthropicStream(params)
          return result
        },
        abortStream: () => anthropicService.abortAnthropicStream(),
      })
      this.runtime = new V4UnifiedRuntime({
        configId: this.configId,
        projectId: this.projectId,
        maxIterations: this.maxIterations,
        abortSignal: this.abortController.signal,
        contextWindow: this.contextWindow,
      }, adapter)

      // ── 2.5. 工具准备 ──
      // v11.6.1: isTaskMessage 停用，工具始终发送，模型自己判断
      const allTools = toolRegistry.getAllSchemas()
      this.runtime.setTools(allTools)

      // ── 3. 注入 Context Assembler (v11.5.1: BridgeContextBuilder 共享模块) ──
      const CORE_PROMPT = buildSystemPrompt('', '')
      const contextBuilder = new BridgeContextBuilder({
        projectId: this.projectId,
        kbEnabled: !!options.kbEnabled,
        webSearchEnabled: !!options.webSearchEnabled,
        selectedKbFileIds: options.selectedKbFileIds,
        planMode: !!options.planMode,         // v11.5.1: 补齐 Anthropic planMode 支持
        enableThinkingPlan: false,            // Anthropic: 简单规划指令（不需要 ThinkingEngine）
      })

      this.runtime.setContextAssembler(async (msg, hist, pid) => {
        return await contextBuilder.buildContext(msg, hist, pid, CORE_PROMPT)
      })

      // ── 4. 注入 Tool Executor（SecurityFence → execute → audit → cache） ──
      const toolExecutor: ToolExecutorFn = async (args, ctx) => {
        const secCheck = this.securityFence.check(ctx.toolName, args)
        if (!secCheck.allowed) {
          this.auditTrail.recordToolResult(ctx.toolName, 'blocked', secCheck.reason || '')
          return { status: 'error', summary: secCheck.reason || '操作被安全围栏拦截' }
        }

        if (secCheck.needsApproval && options.onApprovalRequired) {
          const timeoutMs = 180_000
          const timeoutPromise = new Promise<boolean>(r =>
            setTimeout(() => r(false), timeoutMs),
          )
          const approved = await Promise.race([
            options.onApprovalRequired([{ name: ctx.toolName, args }]),
            timeoutPromise,
          ])
          if (!approved) {
            return { status: 'error', summary: '用户拒绝了此操作' }
          }
        }

        const result = await toolRegistry.execute(ctx.toolName, args, ctx)
        this.auditTrail.recordToolResult(ctx.toolName, result.status, result.summary)

        // v11.5.1: 使用共享 CacheInvalidator 模块（替代内联 ~60 行重复代码）
        if (result.status === 'success') {
          await invalidateAfterTool(ctx.toolName, args, this.projectId, {
            onFileChanged: async (filePath) => {
              const { useStore } = await import('@/store')
              useStore.getState().bumpFileVersion()
              useStore.getState().setFileEditNotify({
                filePath,
                newContent: '__AI_EDITED__',
              })
            },
          })
        }

        return result
      }
      this.runtime.setToolExecutor(toolExecutor)

      // ── 5. 注入历史 ──
      this.runtime.setHistory(this.history)

      // ── 7. 事件监听 ──
      const emitter = this.runtime.getEmitter()
      store.startRun(this.runId)

      unsubscribes.push(
        emitter.on('thinking:start', (data) => store.setThinking(data)),
      )
      unsubscribes.push(
        emitter.on('tool:started', (data) =>
          store.addToolExecution(data.callId, data.toolName),
        ),
      )
      unsubscribes.push(
        emitter.on('tool:completed', (data) => {
          store.completeTool(data.callId, 'success', data.summary, data.detail)
          options.onToolProgress?.({
            callId: data.callId,
            toolName: data.toolName,
            phase: 'done',
            progress: 1,
            message: data.summary,
            timestamp: Date.now(),
          })
        }),
      )
      unsubscribes.push(
        emitter.on('tool:failed', (data) =>
          store.completeTool(data.callId, 'error', data.summary, data.detail),
        ),
      )
      unsubscribes.push(
        emitter.on('agent:state', (data) => {
          store.setPhase(data.to)
          store.setIteration(data.state?.iteration || 0)
        }),
      )

      let collectedText = ''
      unsubscribes.push(
        emitter.on('response:streaming', (data) => {
          collectedText = data.accumulated
          store.setStreamingText(data.accumulated)
          store.setIsStreaming(true)
          options.onResponse?.(data)
        }),
      )

      // ── 8. 运行 ──
      const result = await this.runtime.run({
        userMessage,
        attachments: [],
      })

      store.setIsStreaming(false)
      options.onComplete?.(result)
      store.endRun()
      this.auditTrail.persist().catch(() => {})

      return {
        success: result.success,
        text: result.text || collectedText,
        toolCalls: result.toolCalls,
        totalTokens: result.totalTokens,
        phase: result.phase,
        toolsUsed: result.toolsUsed,
        toolCallSteps: result.toolCallSteps,
        contextBreakdown: result.contextBreakdown,
        cacheHitTokens: result.cacheHitTokens || 0,
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error'
      store.setLastError(errMsg)
      store.endRun()
      this.auditTrail.persist().catch(() => {})
      return {
        success: false,
        text: `错误: ${errMsg}`,
        toolCalls: 0,
        totalTokens: 0,
        phase: 'ERROR',
        toolsUsed: [],
        toolCallSteps: [],
      }
    } finally {
      for (const unsub of unsubscribes) {
        try { unsub() } catch { /* defensive */ }
      }
    }
  }

  abort(): void {
    this.abortController.abort()
    this.runtime?.abort()
    this.auditTrail.persist().catch(() => {})
    import('@/services/anthropicService').then(m =>
      m.anthropicService.abortAnthropicStream(),
    ).catch(() => {})
  }

  destroy(): void {
    this.auditTrail.persist().catch(() => {})
    this.abort()
    this.runtime = null
  }
}
