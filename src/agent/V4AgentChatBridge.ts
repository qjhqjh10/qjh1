// ── V4 Agent Chat Bridge ──
// Integration layer between V4AgentRuntime and the React chat UI.
// Wires 5 subsystems (down from V3's 20): Runtime, SecurityFence, AuditTrail,
// LearningEngine.
// ~180 lines (down from V3's 962).

import { V4UnifiedRuntime } from './runtime/V4UnifiedRuntime'
import { OpenAIAdapter } from './runtime/adapters/OpenAIAdapter'
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
// v11.6.1: isTaskMessage 暂时停用
// 参考 Claude 架构：无代码级工具路由，tool_choice:auto 让模型自己判断
// 联网确认：Claude Code 的哲学是 "No Router, No Classifier — The Model Decides Everything"
// 如需恢复：取消下面这行注释，并取消 if/else 块的注释
// import { isTaskMessage } from './utils/taskDetection'
import type { Message } from './state/types'
import type { V4AgentRunResult, ToolExecutorFn } from './runtime/RuntimeTypes'

// ── Init ──

let toolsRegistered = false

function ensureInitialized() {
  if (!toolsRegistered) {
    toolRegistry.registerAll(ALL_TOOLS as any)
    toolsRegistered = true
  }
}

// ── Types ──

export interface BridgeOptions {
  configId: string
  projectId: string | null
  maxIterations?: number
  historyMessages?: Message[]
  contextWindow?: number  // 模型上下文窗口大小, 传递给 ContextCompressor 做阈值计算
}

export interface SendOptions {
  kbEnabled?: boolean
  webSearchEnabled?: boolean
  selectedKbFileIds?: string[]
  planMode?: boolean  // Enable plan-first prompting via ThinkingEngine
  onResponse?: (chunk: { text: string; accumulated: string; timestamp: number }) => void
  onComplete?: (result: V4AgentRunResult) => void
  onToolProgress?: (event: { callId: string; toolName: string; phase: string; progress: number; message: string; timestamp: number }) => void
  onApprovalRequired?: (tools: Array<{ name: string; args: Record<string, unknown> }>) => Promise<boolean>
}

export interface BridgeSendResult {
  success: boolean
  text: string
  toolCalls: number
  totalTokens: number
  phase: string
  toolsUsed: string[]
  toolCallSteps: Array<{ tool: string; status: string; summary: string; durationMs: number; iteration: number }>
  contextBreakdown?: Array<{ domain: string; tokens: number }>
}

// ── Bridge ──

export class V4AgentChatBridge {
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
  private _toolCache: { key: string; tools: any[] } | null = null  // v4: reuse identical tool arrays for caching

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
      import('./context/FileCache').then(m => m.invalidateProjectFilesReexport(this.projectId!))
    }
    this.projectId = projectId
    this.securityFence = new V4SecurityFence(projectId)
  }

  updateHistory(messages: Message[]): void {
    this.history = messages
  }

  async sendMessage(userMessage: string, options: SendOptions = {}): Promise<BridgeSendResult> {
    if (!this.initialized) throw new Error('V4AgentChatBridge not initialized')

    // Guard: abort any in-progress run before starting a new one
    if (this.runtime) {
      this.abortController.abort()
      this.runtime.abort()
      // Dynamic import for abort stream — fire-and-forget
      import('@/services/fileService').then(m => m.aiService?.abortStream?.()).catch(() => {})
    }

    this.runId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    this.abortController = new AbortController()
    const store = useAgentStore.getState()

    this.auditTrail.startSession(this.runId)
    await this.learningEngine.load()
    diagnosticLogger.clearRecent()  // 🔧 Clear stale diagnostic events from previous runs

    // Collect emitter unsubscribe functions for cleanup
    const unsubscribes: Array<() => void> = []

    try {
      // ── 1. Create Runtime (via V4UnifiedRuntime + OpenAIAdapter — no setAIService needed) ──
      // Note: Skill scoping below may override maxIterations via this.runtime.setMaxIterations()
      const { aiService } = await import('@/services/fileService')
      const adapter = new OpenAIAdapter({
        chatWithTools: async (msgs, cid, pid, tools) => {
          const result = await aiService.chatWithTools(msgs, cid, pid, tools)
          return {
            text: result.text,
            toolCalls: result.toolCalls?.map(tc => ({
              id: tc.id, name: tc.function.name, arguments: tc.function.arguments,
            })) || null,
            finishReason: result.finishReason,
            usage: result.usage,
            reasoning_content: result.reasoning_content,
          }
        },
        abortStream: () => aiService.abortStream(),
      })
      this.runtime = new V4UnifiedRuntime({
        configId: this.configId,
        projectId: this.projectId,
        maxIterations: this.maxIterations,
        abortSignal: this.abortController.signal,
        contextWindow: this.contextWindow,
      }, adapter)

      // ── 2. 全部工具，第1条消息就发、就缓存 ──
      const allTools = toolRegistry.getAllSchemas()
      this.runtime.setTools(allTools)
      diagnosticLogger.recordInfo(`Agent2: ${allTools.length} tools`)

      // ── 3. Wire Context Assembler (v11.5.1: BridgeContextBuilder 共享模块) ──
      const CORE_PROMPT = buildSystemPrompt('', '')
      const contextBuilder = new BridgeContextBuilder({
        projectId: this.projectId,
        kbEnabled: !!options.kbEnabled,
        webSearchEnabled: !!options.webSearchEnabled,
        selectedKbFileIds: options.selectedKbFileIds,
        planMode: !!options.planMode,
        enableThinkingPlan: true,           // OpenAI: 使用 ThinkingEngine 生成详细规划提示
      })

      this.runtime.setContextAssembler(async (msg, hist, pid) => {
        return await contextBuilder.buildContext(msg, hist, pid, CORE_PROMPT)
      })

      // ── 5. Wire Tool Executor (SecurityFence → execute → audit → learning) ──
      const toolExecutor: ToolExecutorFn = async (args, ctx) => {
        // Security fence check
        const secCheck = this.securityFence.check(ctx.toolName, args)
        if (!secCheck.allowed) {
          this.auditTrail.recordToolResult(ctx.toolName, 'blocked', secCheck.reason || '')
          return { status: 'error', summary: secCheck.reason || '操作被安全围栏拦截' }
        }

        // Dangerous tool → user confirmation
        if (secCheck.needsApproval && options.onApprovalRequired) {
          const timeoutMs = 180_000
          const timeoutPromise = new Promise<boolean>(r => setTimeout(() => r(false), timeoutMs))
          const approved = await Promise.race([
            options.onApprovalRequired([{ name: ctx.toolName, args }]),
            timeoutPromise,
          ])
          if (!approved) {
            return { status: 'error', summary: '用户拒绝了此操作' }
          }
        }

        // Execute
        const result = await toolRegistry.execute(ctx.toolName, args, ctx)

        // Audit
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

      // ── 6. Set history ──
      this.runtime.setHistory(this.history)

      // ── 8. Wire events to store ──
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
      unsubscribes.push(emitter.on('agent:state', (data) => {
        store.setPhase(data.to)
        store.setIteration(data.state?.iteration || 0)
      }))

      let collectedText = ''
      unsubscribes.push(emitter.on('response:streaming', (data) => {
        collectedText = data.accumulated
        store.setStreamingText(data.accumulated)
        store.setIsStreaming(true)
        options.onResponse?.(data)
      }))

      // ── 9. Run ──
      const result = await this.runtime.run({
        userMessage,
        attachments: [],
      })

      store.setIsStreaming(false)
      options.onComplete?.(result)
      store.endRun()
      // V9.5.2: 会话结束时持久化审计数据到磁盘
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
      return { success: false, text: `错误: ${errMsg}`, toolCalls: 0, totalTokens: 0, phase: 'ERROR', toolsUsed: [], toolCallSteps: [] }
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
    // Dynamic import for abort stream — fire-and-forget
    import('@/services/fileService').then(m => m.aiService?.abortStream?.()).catch(() => {})
  }

  destroy(): void {
    this.auditTrail.persist().catch(() => {})
    this.abort()
    this.runtime = null
  }
}
