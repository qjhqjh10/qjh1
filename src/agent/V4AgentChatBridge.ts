// ── V4 Agent Chat Bridge ──
// Integration layer between V4AgentRuntime and the React chat UI.
// Wires 5 subsystems (down from V3's 20): Runtime, SecurityFence, AuditTrail,
// LearningEngine.
// ~180 lines (down from V3's 962).

import { V4AgentRuntime } from './V4AgentRuntime'
import { V4SecurityFence } from './V4SecurityFence'
import { buildSystemPromptWithSkills, selectDomainModules } from './V4SystemPrompt'
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
import type { V4AgentRunResult, ToolExecutorFn } from './V4AgentRuntime'

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
  private runtime: V4AgentRuntime | null = null
  private securityFence: V4SecurityFence
  private auditTrail = new AuditTrail()
  private learningEngine = new LearningEngine()

  private initialized = false
  private configId = ''
  private projectId: string | null = null
  private maxIterations = 12  // v9.5.3: 8→12，为多步Skill工作流留足余量
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
    this.maxIterations = options.maxIterations ?? 12
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
      // ── Skill-driven tool scoping ──
      // v9.5.4: SKILL 模式 = 任务复杂度（多文件 / 多步骤 / 多 Skill），不再依赖 confidence 阈值
      const allTools = toolRegistry.getAllSchemas()
      const msg = userMessage
      const skillMatch = skillRegistry.matchBest(msg, 0.3)

      // ── Tool scoping ──
      const READ   = new Set(['read_file','list_directory','search_content','find_files','search_files'])
      const ALWAYS = new Set(['think'])
      const WRITE  = new Set(['create_file','edit_file','batch_replace'])
      const DANGER = new Set(['delete_file','rename_file','delete_project'])
      const NOTE   = new Set(['list_notes','read_note','write_note','append_note','delete_note','search_notes'])
      const KB     = new Set(['kb_list','kb_create_file','kb_index_file','kb_append_file'])
      const TMPL   = new Set(['create_style_template','create_scene_template'])
      const PROJ   = new Set(['create_project'])

      // v9.5.4: SKILL 模式判断
      const allMatches = skillRegistry.match(msg).filter(m => m.confidence >= 0.3)
      const isMultiSkill = allMatches.length >= 2
      const isComplexSkill = skillMatch && skillMatch.skill.workflow.steps.filter((s: any) => !s.optional).length >= 3
      const isMultiFile = /(?:每个|所有|各个|全部|分别).*(?:tab|文件|yaml|md)|(?:填写|创建|写入).*(?:各个|多个|每个)/i.test(msg)
      const useSkillMode = isMultiFile || isComplexSkill || isMultiSkill

      let scopedCore: any[], scopedExtended: any[]
      let taskLabel: string
      let activeSkillCtx: import('./skills/types').ActiveSkillContext | null = null

      if (useSkillMode && skillMatch) {
        // SKILL 模式：合并所有匹配 Skill 的工具 + 通用工具
        taskLabel = `skill:${skillMatch.skill.id}${isMultiSkill ? '+multi' : ''}`
        const neededTools = new Set(skillMatch.skill.workflow.steps.map(s => s.tool))
        if (isMultiSkill) {
          for (const m of allMatches) {
            for (const s of m.skill.workflow.steps) neededTools.add(s.tool)
          }
        }
        neededTools.add('read_file')
        neededTools.add('list_directory')
        neededTools.add('search_content')
        scopedCore = allTools.filter((t: any) => neededTools.has(t.function.name) || ALWAYS.has(t.function.name))
        scopedExtended = []

        activeSkillCtx = {
          skillId: skillMatch.skill.id,
          currentStep: 1,
          completedSteps: new Set(),
          extractedFields: skillMatch.extractedFields,
          retryCount: 0,
          missingFiles: new Set(),
        }
      }

      // v9.5.3: Skill 可覆盖 maxIterations
      if (activeSkillCtx) {
        const skill = skillRegistry.get(activeSkillCtx.skillId)
        if (skill?.workflow.maxIterations) {
          this.runtime.setMaxIterations(Math.max(this.maxIterations, skill.workflow.maxIterations))
        }
      } else {
        // TOOL 模式：全工具集，零 Skill 开销
        taskLabel = skillMatch ? `tool:${skillMatch.skill.id}` : 'default'
        scopedCore = allTools.filter((t: any) =>
          READ.has(t.function.name) || WRITE.has(t.function.name) || TMPL.has(t.function.name) || PROJ.has(t.function.name) || ALWAYS.has(t.function.name))
        scopedExtended = allTools.filter((t: any) =>
          DANGER.has(t.function.name) || NOTE.has(t.function.name) || KB.has(t.function.name))
      }

      diagnosticLogger.recordInfo(`Agent2: task=${taskLabel} core=${scopedCore.length} ext=${scopedExtended.length}`)

      // v9.5.4: planInstruction 使用 useSkillMode
      const planInstruction = useSkillMode ? (isMultiFile ? '逐个文件完成。' : '逐步骤完成。') : ''

      // ── 1. Create Runtime ──
      this.runtime = new V4AgentRuntime({
        configId: this.configId,
        projectId: this.projectId,
        maxIterations: this.maxIterations,
        abortSignal: this.abortController.signal,
        contextWindow: this.contextWindow,
      })

      // ── 2. Wire AI Service ──
      const { aiService } = await import('@/services/fileService')
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
            usage: result.usage,
            reasoning_content: result.reasoning_content,
          }
        },
        abortStream: () => aiService.abortStream(),
      })

      // ── 3. Wire Context Assembler ──
      // v4: Split System Prompt — core (locked, cached) + dynamic (index + providers)
      // Core never changes → DeepSeek prefix caching → 10% billing
      // Dynamic rebuilt per message → fresh global index + relevant providers
      //
      // V5.1: Domain Modules 已恢复 — 格式规范对模板/角色/大纲创建至关重要
      const selectedModules = selectDomainModules(userMessage)
      const coreDomainModules = selectedModules.length > 0 ? selectedModules : []
      // V5: Learning entries are applied via self-optimization (modifying prompts/tools),
      // NOT injected at runtime. The user triggers "应用此经验" from the Learning page.
      // V9.5.2: planInstruction moved to dynamicContent to keep CORE_PROMPT stable for cache
      const CORE_PROMPT = await buildSystemPromptWithSkills(coreDomainModules, '', '', userMessage)
      const coreSystemMsg = { role: 'system' as const, content: CORE_PROMPT }
      const coreTokens = estimateTokens(CORE_PROMPT)

      this.runtime.setContextAssembler(async (msg, hist, pid) => {
        // 闲聊/简单消息 → 跳过全局索引和 Provider，节省 ~6k+ tokens
        const isChatOnly = /^(你好|谢谢|再见|嗯|哦|哈哈|好的|知道了|ok|hi|hello|thanks|bye|早上好|晚上好|下午好|晚安|早|在吗|在不在|你是谁|你叫什么|你能做什么|你有什么功能)[!！。.，,～~]*$/i.test(msg.trim())
        const hasTaskKeywords = /角色|人物|大纲|剧情|章节|写|创作|生成|续写|风格|文风|分析|模板|知识库|搜索|查找|创建|删除|编辑|导入|保存|整理|修改|改|图片|图|插图|搜|画|草稿|笔记|项目|世界|细纲|仿写/i.test(msg)

        // Dynamic: global index + provider content (fresh per message)
        let globalIndex = ''
        if (hasTaskKeywords || hist.length > 0) {
          try {
            const { buildGlobalIndex } = await import('./context/MemoryIndex')
            globalIndex = await buildGlobalIndex(pid)
          } catch {}
        }
        // KB search
        let searchContext = ''
        if (options.kbEnabled && this.projectId) {
          try {
            const { kbService } = await import('@/services/fileService')
            const results = await kbService.search(msg, this.projectId, this.configId, 3, options.selectedKbFileIds)
            if (Array.isArray(results) && results.length > 0) {
              searchContext += '\n[知识库]\n' + results.map((r: any) => r.content || r.text || '').join('\n---\n')
            }
          } catch { /* unavailable */ }
        }
        if (options.webSearchEnabled) {
          try {
            const { kbService } = await import('@/services/fileService')
            const results = await kbService.webSearch(msg.slice(0, 500), 3)
            if (Array.isArray(results) && results.length > 0) {
              searchContext += '\n[网络搜索]\n' + results.map((r: any) => r.snippet || r.title || '').join('\n---\n')
            }
          } catch { /* unavailable */ }
        }

        // 闲聊消息跳过 Provider 内容（节省 ~10k+ tokens）
        const base = isChatOnly
          ? { systemMessages: [], totalTokens: 0, domains: [], breakdown: [] }
          : await contextAssembler.assemble(msg, hist, pid)

        // Plan mode: inject plan-first instruction before the user message
        let planPrompt: string | null = null
        if (options.planMode && !isChatOnly) {
          try {
            const { ThinkingEngine } = await import('./thinking/ThinkingEngine')
            planPrompt = new ThinkingEngine().generatePlanPrompt()
          } catch { /* planPrompt stays null; no impact */ }
        }

        // Token accounting: [0]core(cached) + [1]index + [2]providers + [3]dynamic
        const searchTokens = searchContext ? estimateTokens(searchContext) : 0
        const planTokens = planPrompt ? estimateTokens(planPrompt) : 0
        const globalIndexTokens = estimateTokens(globalIndex || '')
        const providerTokens = base.totalTokens || 0
        const historyTokens = hist.reduce((s, m) => s + estimateTokens(m.content || '') + 4, 0)
        const userMsgTokens = estimateTokens(msg)

        const fullTotal = coreTokens + globalIndexTokens + providerTokens + searchTokens + planTokens + historyTokens + userMsgTokens

        const fullBreakdown: Array<{ domain: string; tokens: number }> = [
          { domain: '核心法则(缓存)', tokens: coreTokens },
          { domain: '全局索引', tokens: globalIndexTokens },
          { domain: 'Provider(项目不变则缓存)', tokens: providerTokens },
          ...(searchContext ? [{ domain: '知识库', tokens: searchTokens }] : []),
          ...(planPrompt ? [{ domain: '执行规划', tokens: planTokens }] : []),
          { domain: '对话历史', tokens: historyTokens },
          { domain: '当前消息', tokens: userMsgTokens },
        ].filter(b => b.tokens > 0)

        // [0] Core rules → cached, never changes
        // [1] Project index → cached, changes on structure
        // [2] Context Providers → stable while project files unchanged
        // [3] Truly dynamic → KB/search/toolInvoke/plan (per-message)
        const indexDirective = globalIndex
          ? `⬇️ 以下是软件完整文件索引。索引中列出了所有目录和文件的路径——已知路径的文件直接用 read_file 读取，无需 list_directory。\n\n${globalIndex}`
          : ''
        const { buildToolInvokePrompt } = await import('@/types/fileOps')
        const toolInvokePrompt = isChatOnly ? '' : buildToolInvokePrompt()

        const providerContent = base.systemMessages.map(m => m.content).filter(Boolean).join('\n\n')
        const dynamicContent = [searchContext, toolInvokePrompt, planInstruction, planPrompt].filter(Boolean).join('\n\n')

        const systemMessages = [
          coreSystemMsg,                                          // [0] 核心提示词 — cached
          ...(indexDirective ? [{ role: 'system' as const, content: indexDirective }] : []),  // [1] 索引
          ...(providerContent ? [{ role: 'system' as const, content: providerContent }] : []),  // [2] Provider — stable
          ...(dynamicContent ? [{ role: 'system' as const, content: dynamicContent }] : []),   // [3] 动态内容
        ]

        return {
          systemMessages,
          totalTokens: fullTotal,
          domains: ['core-prompt', ...(searchContext ? ['kb-web-search'] : []), ...(planPrompt ? ['plan-mode'] : []), ...base.domains],
          breakdown: fullBreakdown,
        }
      })

      // ── 4. Wire Tool Executor (SecurityFence → execute → audit → learning) ──
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

        // v4.1 Change-driven caching: per-file precision invalidation
        if (result.status === 'success') {
          const fp = String(args.file_path || args.path || '')
          const contextAssembler = (await import('./context/ContextAssembler')).contextAssembler
          const { invalidateFile, invalidateMemoryIndexCache } = await (async () => {
            const [mi, fc] = await Promise.all([import('./context/MemoryIndex'), import('./context/FileCache')])
            return { invalidateMemoryIndexCache: mi.invalidateMemoryIndexCache, invalidateFile: fc.invalidateFile }
          })()

          if (/^(create_style_template|create_scene_template)$/.test(ctx.toolName)) {
            // Template created → invalidate index + provider domain
            invalidateMemoryIndexCache()
            const domain = ctx.toolName === 'create_style_template' ? 'style' : 'scene'
            contextAssembler.invalidateProvider(this.projectId, domain)
          } else if (ctx.toolName === 'edit_file') {
            // Content edit → invalidate ONLY that file + its provider domain
            invalidateFile(fp)
            const domains = ContextAssembler.domainsForPath(fp)
            for (const d of domains) contextAssembler.invalidateProvider(this.projectId, d)
          } else if (ctx.toolName === 'create_file' || ctx.toolName === 'delete_file') {
            // Structural change → invalidate index + directory cache + provider domain
            invalidateMemoryIndexCache()
            invalidateFile(fp)
            const dir = fp.replace(/\/[^/]+$/, '')
            const { invalidateDir } = await import('./context/FileCache')
            invalidateDir(dir)
            const domains = ContextAssembler.domainsForPath(fp)
            for (const d of domains) contextAssembler.invalidateProvider(this.projectId, d)
          } else if (ctx.toolName === 'rename_file') {
            // Both old and new paths affected → invalidate index
            invalidateMemoryIndexCache()
            const newPath = String(args.new_path || '')
            invalidateFile(fp)
            if (newPath) invalidateFile(newPath)
            const domains = new Set([
              ...ContextAssembler.domainsForPath(fp),
              ...ContextAssembler.domainsForPath(newPath),
            ])
            for (const d of domains) contextAssembler.invalidateProvider(this.projectId, d)
          } else if (/^(write_note|delete_note|kb_create_file|kb_append_file|create_project|delete_project)$/.test(ctx.toolName)) {
            // Global/structural changes → invalidate index
            invalidateMemoryIndexCache()
          }
        }

        // File change notification → 触发 UI 刷新
        if (result.status === 'success' && /^(create_file|edit_file|delete_file|rename_file|create_project|delete_project|write_note|delete_note|kb_create_file|kb_append_file)$/.test(ctx.toolName)) {
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

      // ── 5. Set core + extended tools (v4.1 progressive disclosure) ──
      this.runtime.setTools(scopedCore)
      this.runtime.setExtendedTools(scopedExtended)

      // ── 7. Set history ──
      this.runtime.setHistory(this.history)

      // v5: 传递 Skill 上下文给 Runtime（触发步骤追踪+质量检查）
      this.runtime.setActiveSkill(activeSkillCtx)

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
