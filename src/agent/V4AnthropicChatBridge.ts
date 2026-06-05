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

import { V4AnthropicRuntime } from './V4AnthropicRuntime'
import type { V4AgentRunResult, ToolExecutorFn } from './V4AnthropicRuntime'
import { V4SecurityFence } from './V4SecurityFence'
import {
  buildSystemPrompt,
  buildSystemPromptWithSkills,
  selectDomainModules,
  CHARACTER_DOMAIN_MODULE,
  OUTLINE_DOMAIN_MODULE,
} from './V4SystemPrompt'
import { skillRegistry } from './skills/SkillRegistry'
import { AuditTrail } from './audit/AuditTrail'
import { LearningEngine } from './learning/LearningEngine'
import { toolRegistry } from './skills/ToolRegistry'
import { contextAssembler, ContextAssembler } from './context/ContextAssembler'
import { ALL_TOOLS } from './skills/tools'
import { ALL_PROVIDERS } from './context/providers'
import { useAgentStore } from './store/AgentStore'
import { diagnosticLogger } from './diagnostics/DiagnosticLogger'
import { estimateTokens } from './utils/tokenEstimation'
import type { Message } from './state/types'
import type {
  BridgeOptions,
  SendOptions,
  BridgeSendResult,
} from './ChatBridgeInterface'

// ── Init ──

let toolsRegistered = false
let providersRegistered = false

function ensureInitialized() {
  if (!toolsRegistered) {
    toolRegistry.registerAll(ALL_TOOLS as any)
    toolsRegistered = true
  }
  if (!providersRegistered) {
    for (const p of ALL_PROVIDERS) {
      if (!contextAssembler.getProviders().some(ex => ex.domain === p.domain)) {
        contextAssembler.register(p)
      }
    }
    providersRegistered = true
  }
}

// ── Bridge ──

export class V4AnthropicChatBridge {
  private runtime: V4AnthropicRuntime | null = null
  private securityFence: V4SecurityFence
  private auditTrail = new AuditTrail()
  private learningEngine = new LearningEngine()

  private initialized = false
  private configId = ''
  private projectId: string | null = null
  private maxIterations = 8
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
    this.maxIterations = options.maxIterations ?? 8
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

    // 中止之前的运行
    if (this.runtime) {
      this.abortController.abort()
      this.runtime.abort()
    }

    this.runId = `ant_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
    this.abortController = new AbortController()
    const store = useAgentStore.getState()

    this.auditTrail.startSession(this.runId)
    await this.learningEngine.load()
    diagnosticLogger.clearRecent()

    const unsubscribes: Array<() => void> = []

    try {
      // ── 1. 创建 Runtime ──
      this.runtime = new V4AnthropicRuntime({
        configId: this.configId,
        projectId: this.projectId,
        maxIterations: this.maxIterations,
        abortSignal: this.abortController.signal,
        contextWindow: this.contextWindow,
      })

      // ── 2. 注入 Anthropic AI Service ──
      const { anthropicService } = await import('@/services/anthropicService')
      this.runtime.setAIService({
        chatAnthropicStream: async (params) => {
          const result = await anthropicService.chatAnthropicStream(params)
          return result
        },
        abortStream: () => anthropicService.abortAnthropicStream(),
      })

      // ── 3. 注入 Context Assembler ──
      // V5.1: Domain Modules 已恢复 — 格式规范对模板/角色/大纲创建至关重要
      const selectedModules = selectDomainModules(userMessage)
      const coreDomainModules = selectedModules.length > 0 ? selectedModules : []

      const CORE_PROMPT = await buildSystemPromptWithSkills(coreDomainModules, '', '', userMessage)
      const coreSystemMsg = { role: 'system' as const, content: CORE_PROMPT }
      const coreTokens = estimateTokens(CORE_PROMPT)

      this.runtime.setContextAssembler(async (msg, hist, pid) => {
        // 闲聊/简单消息 → 跳过全局索引和 Provider，节省 ~6k+ tokens
        const isChatOnly = /^(你好|谢谢|再见|嗯|哦|哈哈|好的|知道了|ok|hi|hello|thanks|bye|早上好|晚上好|下午好|晚安|早|在吗|在不在|你是谁|你叫什么|你能做什么|你有什么功能)[!！。.，,～~]*$/i.test(msg.trim())
        const hasTaskKeywords = /角色|人物|大纲|剧情|章节|写|创作|生成|续写|风格|文风|分析|模板|知识库|搜索|查找|创建|删除|编辑|导入|保存|整理|修改|改|图片|图|插图|搜|画|草稿|笔记|项目|世界|细纲|仿写/i.test(msg)

        // 动态内容（每轮刷新）
        let globalIndex = ''
        if (hasTaskKeywords || hist.length > 0) {
          try {
            const { buildGlobalIndex } = await import('./context/MemoryIndex')
            globalIndex = await buildGlobalIndex(pid)
          } catch { /* unavailable */ }
        }

        let searchContext = ''
        if (options.kbEnabled && this.projectId) {
          try {
            const { kbService } = await import('@/services/fileService')
            const results = await kbService.search(
              msg, this.projectId, this.configId, 3, options.selectedKbFileIds,
            )
            if (Array.isArray(results) && results.length > 0) {
              searchContext += '\n[知识库]\n' +
                results.map((r: any) => r.content || '').join('\n---\n')
            }
          } catch { /* unavailable */ }
        }
        if (options.webSearchEnabled) {
          try {
            const { kbService } = await import('@/services/fileService')
            const results = await kbService.webSearch(msg.slice(0, 500), 3)
            if (Array.isArray(results) && results.length > 0) {
              searchContext += '\n[网络搜索]\n' +
                results.map((r: any) => r.snippet || r.title || '').join('\n---\n')
            }
          } catch { /* unavailable */ }
        }

        // 闲聊消息跳过 Provider 内容（节省 ~10k+ tokens）
        const base = isChatOnly
          ? { systemMessages: [], totalTokens: 0, domains: [], breakdown: [] }
          : await contextAssembler.assemble(msg, hist, pid)
        const { buildToolInvokePrompt } = await import('@/types/fileOps')
        const toolInvokePrompt = isChatOnly ? '' : buildToolInvokePrompt()

        const searchTokens = searchContext ? estimateTokens(searchContext) : 0
        const globalIndexTokens = estimateTokens(globalIndex || '')
        const historyTokens = hist.reduce(
          (s, m) => s + estimateTokens(m.content || '') + 4, 0,
        )
        const fullTotal =
          coreTokens + base.totalTokens + searchTokens + globalIndexTokens +
          historyTokens + estimateTokens(msg)

        const dynamicContent = [
          ...base.systemMessages.map(m => m.content),
          searchContext,
          toolInvokePrompt,
        ].filter(Boolean).join('\n\n')

        const systemMessages = [
          coreSystemMsg,
          ...(globalIndex
            ? [{ role: 'system' as const, content: `⬇️ 以下是项目文件索引：\n\n${globalIndex}` }]
            : []),
          { role: 'system' as const, content: dynamicContent },
        ]

        return {
          systemMessages,
          totalTokens: fullTotal,
          domains: ['core-prompt', ...base.domains],
          breakdown: [
            { domain: '核心法则(缓存)', tokens: coreTokens },
            { domain: 'Provider+索引', tokens: globalIndexTokens + (base.totalTokens || 0) },
            ...(searchContext ? [{ domain: '知识库', tokens: searchTokens }] : []),
            { domain: '对话历史', tokens: historyTokens },
            { domain: '当前消息', tokens: estimateTokens(msg) },
          ],
        }
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

        // 驱动缓存失效（与 OpenAI Bridge 相同逻辑）
        if (result.status === 'success') {
          const fp = String(args.file_path || args.path || '')
          const ctxAssembler = (await import('./context/ContextAssembler')).contextAssembler
          const [mi, fc] = await Promise.all([
            import('./context/MemoryIndex'),
            import('./context/FileCache'),
          ])

          if (/^(create_style_template|create_scene_template)$/.test(ctx.toolName)) {
            mi.invalidateMemoryIndexCache()
            const domain = ctx.toolName === 'create_style_template' ? 'style' : 'scene'
            ctxAssembler.invalidateProvider(this.projectId, domain)
          } else if (ctx.toolName === 'edit_file') {
            fc.invalidateFile(fp)
            const domains = ContextAssembler.domainsForPath(fp)
            for (const d of domains) ctxAssembler.invalidateProvider(this.projectId, d)
          } else if (
            ctx.toolName === 'create_file' || ctx.toolName === 'delete_file'
          ) {
            mi.invalidateMemoryIndexCache()
            fc.invalidateFile(fp)
            const dir = fp.replace(/\/[^/]+$/, '')
            const { invalidateDir } = fc
            invalidateDir(dir)
            const domains = ContextAssembler.domainsForPath(fp)
            for (const d of domains) ctxAssembler.invalidateProvider(this.projectId, d)
          } else if (ctx.toolName === 'rename_file') {
            mi.invalidateMemoryIndexCache()
            const newPath = String(args.new_path || '')
            fc.invalidateFile(fp)
            if (newPath) fc.invalidateFile(newPath)
            const domains = new Set([
              ...ContextAssembler.domainsForPath(fp),
              ...ContextAssembler.domainsForPath(newPath),
            ])
            for (const d of domains) ctxAssembler.invalidateProvider(this.projectId, d)
          } else if (
            /^(write_note|delete_note|kb_create_file|kb_append_file|create_project|delete_project)$/.test(
              ctx.toolName,
            )
          ) {
            mi.invalidateMemoryIndexCache()
          }
        }

        // 通知 GUI 文件变更 → 触发 UI 刷新
        if (
          result.status === 'success' &&
          /^(create_file|edit_file|delete_file|rename_file|create_project|delete_project|write_note|delete_note|kb_create_file|kb_append_file)$/.test(ctx.toolName)
        ) {
          const { useStore } = await import('@/store')
          useStore.getState().bumpFileVersion()
          useStore.getState().setFileEditNotify({
            filePath: String(args.file_path || ''),
            newContent: '__AI_EDITED__',
          })
        }

        return result
      }
      this.runtime.setToolExecutor(toolExecutor)

      // ── 5. Skill 驱动的工具裁剪 ──
      const allTools = toolRegistry.getAllSchemas()
      const skillMatch = skillRegistry.matchBest(userMessage, 0.5)
      let toolsForRuntime = allTools
      if (skillMatch && skillMatch.confidence >= 0.6) {
        const neededTools = new Set(skillMatch.skill.workflow.steps.map(s => s.tool))
        neededTools.add('read_file')
        neededTools.add('list_directory')
        neededTools.add('search_content')
        toolsForRuntime = allTools.filter((t: any) => neededTools.has(t.function.name))
      }
      this.runtime.setTools(toolsForRuntime)

      // v5: Skill 运行时上下文 — 命中时传给 Runtime 做步骤追踪+质量检查
      let activeSkillCtx: import('./skills/types').ActiveSkillContext | null = null
      if (skillMatch && skillMatch.confidence >= 0.6) {
        activeSkillCtx = {
          skillId: skillMatch.skill.id,
          currentStep: 1,
          completedSteps: new Set(),
          extractedFields: skillMatch.extractedFields,
          retryCount: 0,
        }
      }

      // ── 6. 注入历史 ──
      this.runtime.setHistory(this.history)
      this.runtime.setActiveSkill(activeSkillCtx)

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
