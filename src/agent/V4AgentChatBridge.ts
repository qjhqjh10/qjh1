// ── V4 Agent Chat Bridge ──
// Integration layer between V4AgentRuntime and the React chat UI.
// Wires 5 subsystems (down from V3's 20): Runtime, SecurityFence, AuditTrail,
// LearningEngine.
// ~180 lines (down from V3's 962).

import { V4AgentRuntime } from './V4AgentRuntime'
import { V4SecurityFence } from './V4SecurityFence'
import { buildSystemPrompt, CHARACTER_DOMAIN_MODULE, OUTLINE_DOMAIN_MODULE, CHAPTER_DOMAIN_MODULE, STYLE_DOMAIN_MODULE, SCENE_DOMAIN_MODULE, KB_DOMAIN_MODULE } from './V4SystemPrompt'
import { AuditTrail } from './audit/AuditTrail'
import { LearningEngine } from './learning/LearningEngine'
import { toolRegistry } from './tools/ToolRegistry'
import { contextAssembler, ContextAssembler } from './context/ContextAssembler'
import { ALL_TOOLS } from './tools/definitions'
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
    toolRegistry.registerAll(ALL_TOOLS)
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
  private maxIterations = 30
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
    this.maxIterations = options.maxIterations ?? 8
    this.contextWindow = options.contextWindow ?? 128_000
    this.history = options.historyMessages || []
    this.securityFence = new V4SecurityFence(this.projectId)
    this.initialized = true
  }

  updateProject(projectId: string | null): void {
    // Clear ALL old project caches to prevent token bloat from stale data
    if (this.projectId && this.projectId !== projectId) {
      contextAssembler.clearProject(this.projectId)
      import('./context/MemoryIndex').then(m => m.invalidateMemoryIndexCache())
      import('./context/FileCache').then(m => m.clearFileCache())
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
      // ── 0.5 Agent 2: Task-aware tool scoping (v4.1 progressive disclosure) ──
      // Classify task by keywords → give core tools first → expand on iteration 3+
      // Saves 50-80% tool tokens vs always sending all 38 tools.
      const { classifyIntent } = await import('./IntentClassifier')
      const intentResult = await classifyIntent(userMessage, this.configId)
      const intent = intentResult.intent
      const reqCount = intentResult.requirementCount
      intent !== 'complex' && diagnosticLogger.recordInfo(`Agent1: intent=${intent} reqs=${reqCount}`)

      const allTools = toolRegistry.getAllSchemas()
      const msg = userMessage

      // ── Task Profiles: core (一定给) + extended (迭代3+追加) ──
      const READ   = new Set(['read_file','list_directory','search_files','search_content'])
      const WRITE  = new Set(['create_file','edit_file'])
      const DANGER = new Set(['delete_file','rename_file'])
      const NOTE   = new Set(['list_notes','read_note','write_note','append_note'])
      const KB     = new Set(['kb_list','kb_create_file','kb_index_file','kb_append_file'])
      const TMPL   = new Set(['create_style_template','create_scene_template'])
      const IMG    = new Set(['search_images','generate_image'])
      const WEB    = new Set(['http_get','browser_search'])
      const SHELL  = new Set(['shell_exec','shell_run_script'])

      // Classify by keyword patterns — ordered by priority (first match wins)
      let coreTools: Set<string>, extendedTools: Set<string>
      const taskKey: string = (() => {
        if (/风格|文风|仿写|分析.*文/.test(msg))                               return 'style'
        if (/场景.*(?:模板|创建|生成)|创建.*场景/.test(msg))                     return 'scene'
        if (/创建.*角色|添加.*角色|角色.*创建|新建.*角色/.test(msg))              return 'character'
        if (/写.{0,5}章|创作|生成.{0,5}章|续写|章节.*写|写.*第[一二三\d]/.test(msg)) return 'chapter'
        if (/知识库|kb|素材.*保存|保存.*素材|索引.*知识/.test(msg))              return 'kb'
        if (/笔记|草稿|便签/.test(msg) && !/章节|大纲/.test(msg))                return 'note'
        if (/图片|插图|配图|生成.*图|画.*图/.test(msg))                         return 'image'
        if (/删除|移除|清理/.test(msg))                                        return 'delete'
        if (/修改|编辑|改|替换|重命名|追加/.test(msg))                           return 'edit'
        if (/搜索|上网|查.*网页|浏览器/.test(msg))                              return 'web'
        if (/执行.*命令|运行.*脚本|shell/.test(msg))                            return 'shell'
        if (/查看|检查|列出|读取|看看|显示|搜索|找|读|浏览|打开/.test(msg))       return 'read'
        if (intent === 'chat')                                                 return 'chat'
        return 'default'
      })()

      const PROFILES: Record<string, { core: Set<string>; extended: Set<string> }> = {
        chat:      { core: new Set([]),                         extended: new Set([]) },
        read:      { core: READ,                                extended: new Set([...NOTE, ...KB, ...IMG]) },
        chapter:   { core: new Set([...READ, ...WRITE]),        extended: new Set([...DANGER, ...NOTE, 'search_content']) },
        character: { core: new Set([...READ, 'create_file']),   extended: new Set([...WRITE, 'search_files', 'search_content']) },
        style:     { core: new Set(['read_file', ...TMPL]),     extended: new Set([...READ, 'search_content']) },
        scene:     { core: new Set(['read_file', 'create_scene_template']), extended: new Set([...READ, 'create_style_template']) },
        kb:        { core: KB,                                  extended: new Set([...READ, ...WRITE]) },
        note:      { core: NOTE,                                extended: new Set([...READ, 'delete_note']) },
        image:     { core: IMG,                                 extended: READ },
        edit:      { core: new Set([...READ, ...WRITE]),        extended: new Set([...DANGER, 'search_content']) },
        delete:    { core: new Set(['read_file', ...DANGER]),   extended: new Set([...READ, ...WRITE]) },
        web:       { core: WEB,                                 extended: READ },
        shell:     { core: SHELL,                               extended: READ },
        default:   { core: new Set([...READ, ...WRITE]),        extended: new Set([...DANGER,...NOTE,...KB,...TMPL,...IMG]) },
      }

      const profile = PROFILES[taskKey]
      coreTools = profile.core
      extendedTools = profile.extended

      // ── Build scoped tool arrays (with caching) ──
      const cacheKey = `${taskKey}`
      let scopedCore: any[], scopedExtended: any[]
      if (this._toolCache && this._toolCache.key === cacheKey) {
        scopedCore = this._toolCache.tools
        scopedExtended = (this._toolCache as any).extended || []
      } else {
        scopedCore = allTools.filter((t: any) => coreTools.has(t.function.name))
        scopedExtended = allTools.filter((t: any) => extendedTools.has(t.function.name) && !coreTools.has(t.function.name))
        this._toolCache = { key: cacheKey, tools: scopedCore, extended: scopedExtended } as any
      }

      diagnosticLogger.recordInfo(`Agent2: task=${taskKey} core=${scopedCore.length} ext=${scopedExtended.length}`)

      const planInstruction = intent === 'complex'
        ? `\n## 执行方案\n用户提出了${reqCount}个要求。第一轮列出步骤清单（如"①read_file读大纲 ②edit_file改世界观 ③create_file写角色"），然后立即执行第一步。每轮只做一步，用最精准的工具。全部完成后一句话汇报，不要展开。`
        : ''

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
      // Dynamic rebuilt per message → fresh project index + relevant providers
      const coreDomainModules = [
        CHARACTER_DOMAIN_MODULE, OUTLINE_DOMAIN_MODULE, CHAPTER_DOMAIN_MODULE,
        STYLE_DOMAIN_MODULE, SCENE_DOMAIN_MODULE, KB_DOMAIN_MODULE,
      ]
      // V5: Learning entries are applied via self-optimization (modifying prompts/tools),
      // NOT injected at runtime. The user triggers "应用此经验" from the Learning page.
      const CORE_PROMPT = buildSystemPrompt(coreDomainModules, '', '') + planInstruction
      const coreSystemMsg = { role: 'system' as const, content: CORE_PROMPT }
      const coreTokens = estimateTokens(CORE_PROMPT)

      this.runtime.setContextAssembler(async (msg, hist, pid) => {
        // Dynamic: project index + provider content (fresh per message)
        let projectIndex = ''
        if (pid) {
          try {
            const { buildMemoryIndex } = await import('./context/MemoryIndex')
            projectIndex = await buildMemoryIndex(pid)
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

        const base = await contextAssembler.assemble(msg, hist, pid)

        // Plan mode: inject plan-first instruction before the user message
        let planPrompt: string | null = null
        if (options.planMode) {
          try {
            const { ThinkingEngine } = await import('./thinking/ThinkingEngine')
            planPrompt = new ThinkingEngine().generatePlanPrompt()
          } catch { /* planPrompt stays null; no impact */ }
        }

        // Token accounting: core (cached) + dynamic (per-message)
        const searchTokens = searchContext ? estimateTokens(searchContext) : 0
        const planTokens = planPrompt ? estimateTokens(planPrompt) : 0
        const projectIndexTokens = estimateTokens(projectIndex || '')
        const historyTokens = hist.reduce((s, m) => s + estimateTokens(m.content || '') + 4, 0)
        const userMsgTokens = estimateTokens(msg)

        const fullTotal = coreTokens + base.totalTokens + searchTokens + planTokens + projectIndexTokens + historyTokens + userMsgTokens

        const fullBreakdown: Array<{ domain: string; tokens: number }> = [
          { domain: '核心法则(缓存)', tokens: coreTokens },
          { domain: '项目索引+Provider', tokens: projectIndexTokens + (base.totalTokens || 0) },
          ...(searchContext ? [{ domain: '知识库', tokens: searchTokens }] : []),
          ...(planPrompt ? [{ domain: '执行规划', tokens: planTokens }] : []),
          { domain: '对话历史', tokens: historyTokens },
          { domain: '当前消息', tokens: userMsgTokens },
        ].filter(b => b.tokens > 0)

        // v4: Split architecture — [0] core (cached) + [1] dynamic (per-message)
        // [0]: Core rules + domain modules + learned patterns → cached
        // [1]: Project index (PROJECT.md + file tree) + providers + KB/web search → fresh each time
        const dynamicContent = [
          projectIndex,                                            // 项目索引: PROJECT.md + 文件列表
          ...base.systemMessages.map(m => m.content),              // Context Providers
          searchContext,                                           // 知识库/网络搜索
          planPrompt,                                              // Plan模式提示
        ].filter(Boolean).join('\n\n')

        const systemMessages = [
          coreSystemMsg,                                          // [0] 核心提示词 — 永远不变, DeepSeek缓存
          { role: 'system' as const, content: dynamicContent },   // [1] 索引+Provider — 每次动态构建
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
          const { contextAssembler, invalidateMemoryIndexCache } = await (async () => {
            const [mi, ca] = await Promise.all([
              import('./context/MemoryIndex'),
              import('./context/ContextAssembler')
            ])
            return { invalidateMemoryIndexCache: mi.invalidateMemoryIndexCache, contextAssembler: ca.contextAssembler }
          })()
          const { invalidateFile } = await import('./context/FileCache')

          if (/^(create_style_template|create_scene_template)$/.test(ctx.toolName)) {
            // Template created → structural change
            invalidateMemoryIndexCache()
            const domain = ctx.toolName === 'create_style_template' ? 'style' : 'scene'
            contextAssembler.invalidateProvider(this.projectId, domain)
          } else if (ctx.toolName === 'edit_file') {
            // Content edit → invalidate ONLY that file + its provider domain
            invalidateFile(fp)
            const domains = ContextAssembler.domainsForPath(fp)
            for (const d of domains) contextAssembler.invalidateProvider(this.projectId, d)
          } else if (ctx.toolName === 'create_file' || ctx.toolName === 'delete_file') {
            // Structural change → invalidate the whole directory + MemoryIndex
            invalidateMemoryIndexCache()
            invalidateFile(fp)
            const dir = fp.replace(/\/[^/]+$/, '')  // e.g. "characters" from "characters/张明.json"
            const { invalidateDir } = await import('./context/FileCache')
            invalidateDir(dir)
            const domains = ContextAssembler.domainsForPath(fp)
            for (const d of domains) contextAssembler.invalidateProvider(this.projectId, d)
          } else if (ctx.toolName === 'rename_file') {
            // Both old and new paths affected
            invalidateMemoryIndexCache()
            const newPath = String(args.new_path || '')
            invalidateFile(fp)
            if (newPath) invalidateFile(newPath)
            const domains = new Set([
              ...ContextAssembler.domainsForPath(fp),
              ...ContextAssembler.domainsForPath(newPath),
            ])
            for (const d of domains) contextAssembler.invalidateProvider(this.projectId, d)
          }
        }

        // File change notification
        if (result.status === 'success' && /^(create_file|edit_file|delete_file|rename_file)$/.test(ctx.toolName)) {
          const { useStore } = await import('@/store')
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
        contextBreakdown: result.contextBreakdown,
      }

    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error'
      store.setLastError(errMsg)
      store.endRun()
      this.auditTrail.persist().catch(() => {})
      return { success: false, text: `错误: ${errMsg}`, toolCalls: 0, totalTokens: 0, phase: 'ERROR' }
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
    // Dynamic import for abort stream — fire-and-forget
    import('@/services/fileService').then(m => m.aiService?.abortStream?.()).catch(() => {})
  }

  destroy(): void {
    this.abort()
    this.runtime = null
  }
}
