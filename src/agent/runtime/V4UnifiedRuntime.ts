// ── V4 Unified Runtime (v11.0) ──
// Claude-style: simple read→write loop. No phase machine, no hard blocks.
// Model has format knowledge embedded in system prompt → just work.

import { AgentEventEmitter } from './AgentEventEmitter'
import { ContextCompressor } from '../context/ContextCompressor'
// v11.3: skillRegistry removed
import { useAgentStore } from '../store/AgentStore'
import { diagnosticLogger } from '../diagnostics/DiagnosticLogger'
import { executeSingleTool, classifyToolCalls } from './ToolExecutor'
import { isKnowledgeOnly, hasTaskKeywords } from '../utils/taskDetection'
import type {
  V4AgentConfig,
  V4AgentRunInput,
  V4AgentRunResult,
  ToolExecutorFn,
  ContextAssemblerFn,
} from './RuntimeTypes'
import type { ProtocolAdapter } from './adapters/ProtocolAdapter'
import type { Message } from '../state/types'

export class V4UnifiedRuntime {
  private config: V4AgentConfig
  private adapter: ProtocolAdapter
  private emitter = new AgentEventEmitter()
  private toolExecutor: ToolExecutorFn | null = null
  private contextAssembler: ContextAssemblerFn | null = null
  private tools: unknown[] = []
  private messagesForApi: Message[] = []
  private historyMessages: Message[] = []
  private toolsUsed: string[] = []
  private toolCallSteps: Array<{
    tool: string; status: string; summary: string
    durationMs: number; iteration: number
    arguments?: string
  }> = []
  private compressor: ContextCompressor
  private compressedAt = 0
  private lastCompressLength = 0
  private _consecutiveReads = 0
  private _nudgeCount = 0       // v11.5.1: prevent infinite nudge loop
  private _consecutiveFailures = 0  // v12.4.0: detect path failure loops
  private _consecutivePathErrors = 0  // v12.6.0: track path-specific errors separately
  private _userMessage = ''
  private _userRequestedFileOp = false  // v4: 用户是否明确要求文件操作

  constructor(config: V4AgentConfig, adapter: ProtocolAdapter) {
    this.config = config
    this.adapter = adapter
    this.compressor = new ContextCompressor(config.contextWindow ?? 128_000)
  }

  // ── Dependency Injection ──
  setToolExecutor(fn: ToolExecutorFn): void { this.toolExecutor = fn }
  setContextAssembler(fn: ContextAssemblerFn): void { this.contextAssembler = fn }
  setTools(tools: unknown[]): void { this.tools = tools }
  setHistory(messages: Message[]): void { this.historyMessages = messages }
  setMaxIterations(n: number): void { this.config.maxIterations = n }
  /** v11.3: skill system removed — kept as no-op for backward compat */
  setActiveSkill(_skill: unknown): void { /* no-op */ }

  getEmitter(): AgentEventEmitter { return this.emitter }
  getMessagesForApi(): Message[] { return [...this.messagesForApi] }

  abort(): void { this.emitter.abort() }

  // ── Run ──

  async run(input: V4AgentRunInput): Promise<V4AgentRunResult> {
    const store = useAgentStore.getState()
    const runId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    const runStartTime = Date.now()
    const RUN_TIMEOUT = 300_000

    if (!this.toolExecutor) {
      return {
        success: false, text: '工具执行器未配置',
        toolCalls: 0, totalTokens: 0, promptTokens: 0, completionTokens: 0,
        phase: 'ERROR', toolsUsed: [], toolCallSteps: [], iterationCount: 0,
        cacheHitTokens: 0, cacheCreationTokens: 0, cost: 0,
      }
    }

    // 熔断器
    const circuitCheck = store.checkCircuit()
    if (!circuitCheck.allowed) {
      return {
        success: false, text: circuitCheck.reason || '服务暂时不可用',
        toolCalls: 0, totalTokens: 0, promptTokens: 0, completionTokens: 0,
        phase: 'ERROR', toolsUsed: [], toolCallSteps: [], iterationCount: 0,
        cacheHitTokens: 0, cacheCreationTokens: 0, cost: 0,
      }
    }

    store.startRun(runId)
    store.setPhase('EXECUTE')

    // ── ① Assemble context ──
    let totalPromptTokens = 0
    let totalCompletionTokens = 0
    let totalCacheHitTokens = 0  // v11.5.1: track cache read hits
    let totalCacheCreationTokens = 0  // v11.7.0: track cache creation (still charged)
    let totalCost = 0            // v11.5.1: track cost
    let toolCallsCount = 0
    let collectedText = ''
    this.toolsUsed = []
    this.toolCallSteps = []
    this._consecutiveReads = 0
    this._nudgeCount = 0      // reset per run
    this._consecutiveFailures = 0
    this._consecutivePathErrors = 0
    this._userMessage = input.userMessage
    // v12.6.0: 两层检测文件操作意图（用于 Nudge 强化）
    // 层1: 精确正则 — 明确的操作动词
    const _explicitFileOp = /(?:保存|写入|创建|存到|生成.*[章节细纲角色摘要文件]|写.*[章节章入到成个篇段名]|填充|追加|新建|create|save|write|edit|改成|输出.*[文件角色信息]|把.*写|整理成.*文件|导出|建一个|帮我.*(?:写|创建|生成|做|加|改|弄)|(?:添加|新增|补充|加入).*(?:一个|个|些|入|到|进))/.test(input.userMessage)
    // 层2: 宽关键词兜底 — 精确正则没命中但有任务意图 → 也开启激进nudge
    this._userRequestedFileOp = _explicitFileOp || hasTaskKeywords(input.userMessage)
    let _hasWriteCall = false  // track if model has called any write tool across iterations

    // v12.5.1: 阶段感知温度 — 初始为创作阶段
    let isExecutionPhase = false

    const contextResult = this.contextAssembler
      ? await this.contextAssembler(input.userMessage, this.historyMessages, this.config.projectId)
      : { systemMessages: [], totalTokens: 0, domains: [], breakdown: [] }

    this.messagesForApi = [
      ...contextResult.systemMessages,
      ...this.historyMessages,
      { role: 'user', content: input.userMessage },
    ]

    // ── ② Main loop ──
    let iteration = 0

    while (iteration < this.config.maxIterations) {
      if (this.config.abortSignal.aborted) break
      if (Date.now() - runStartTime > RUN_TIMEOUT) {
        collectedText = collectedText || '运行超时'
        // v11.7.1: 清理最后一条不完整的 assistant 消息（有 tool_calls 但缺 tool_result）
        for (let i = this.messagesForApi.length - 1; i >= 0; i--) {
          const m = this.messagesForApi[i]
          if (m.role === 'assistant' && m.tool_calls && (m.tool_calls as unknown[]).length > 0) {
            this.messagesForApi.splice(i, 1)
            break
          }
        }
        break
      }

      iteration++
      store.setIteration(iteration)
      this.emitter.emit('thinking:start', {
        intent: `第 ${iteration} 轮`, steps: [], filesNeeded: [], estimatedTokens: 0, timestamp: Date.now(),
      })

      // ── Context Compression ──
      const estimatedTokens = this.compressor.estimateMessages(this.messagesForApi)
      if (this.compressor.needsCompression(estimatedTokens)) {
        const newSinceCompress = this.lastCompressLength > 0
          ? this.messagesForApi.length - this.lastCompressLength : 0
        const before = this.messagesForApi.length
        this.messagesForApi = this.compressor.compress(this.messagesForApi, estimatedTokens, Math.max(5, newSinceCompress))
        this.lastCompressLength = this.messagesForApi.length
        this.compressedAt = iteration
      }

      // ── API Call (with single retry for transient failures) ──
      const API_TIMEOUT = 90_000
      let response = undefined
      let lastApiErr: Error | null = null

      diagnosticLogger.recordApiCallStart()

      // v12.5.1: 阶段感知温度
      // 创作轮: 用户设定的创作温度 (默认 1.0)
      // 执行轮: min(创作温度, 工具执行温度上限 (默认 0.5))
      const creativeTemp = this.config.temperature ?? 1.0
      const toolCap = this.config.toolTemperature ?? 0.5
      const effectiveTemperature = isExecutionPhase
        ? Math.min(creativeTemp, toolCap)
        : creativeTemp

      for (let retry = 0; retry <= 1; retry++) {
        if (this.config.abortSignal.aborted) break
        try {
          const apiPromise = this.adapter.callModel({
            messages: this.messagesForApi,
            tools: this.tools,
            configId: this.config.configId,
            projectId: this.config.projectId || undefined,
            signal: this.config.abortSignal,
            temperature: effectiveTemperature,
          })
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`API 超时 (${API_TIMEOUT / 1000}秒)`)), API_TIMEOUT),
          )
          response = await Promise.race([apiPromise, timeoutPromise])
          break
        } catch (apiErr) {
          lastApiErr = apiErr instanceof Error ? apiErr : new Error('API 调用失败')
          const isTransient = /超时|timeout|network|ECONNREFUSED|ETIMEDOUT|429|503|502/.test(lastApiErr.message)
          if (retry < 1 && isTransient) {
            await new Promise(r => setTimeout(r, 2000 * (retry + 1)))
            continue
          }
          break
        }
      }

      if (!response) {
        collectedText = `错误: ${lastApiErr?.message || 'API 调用失败'}`
        store.recordApiFailure()
        break
      }

      store.recordApiSuccess()
      totalPromptTokens += response.usage.inputTokens
      totalCompletionTokens += response.usage.outputTokens
      totalCacheHitTokens += response.usage.cacheHitTokens || 0
      totalCacheCreationTokens += (response.usage as any).cacheCreationTokens || 0
      totalCost += response.usage.cost || 0
      // Token 累计由 UI 层（AIChatWindow）统一管理，避免双重计数
      diagnosticLogger.recordApiCallEnd(response.usage.totalTokens, response.toolCalls.length > 0)

      // ── finishReason: truncated → inject continuation ──
      if (response.finishReason === 'max_tokens' || response.finishReason === 'length') {
        diagnosticLogger.recordInfo(`输出截断: ${response.finishReason}`)
        this.messagesForApi.push({ role: 'user', content: '[系统] 上一轮输出因token限制被截断。请继续完成。' })
      }

      // ── No tool calls → model is speaking. Trust what it says. ──
      if (response.toolCalls.length === 0) {
        isExecutionPhase = false  // v12.5.1: 回到创作阶段
        collectedText = response.text || ''

        // H5: Empty response fallback
        if (!collectedText.trim()) {
          this.messagesForApi.push({
            role: 'user',
            content: '请用中文直接生成文本回复。',
          })
          continue
        }

        // ── Done detection (v11.5.1: expanded to cover natural completions) ──
        if (/[Tt]ask\s*[Cc]omplete|全部完成|所有.*已完成|任务完成|操作完毕|验证通过|最终.*完成|没有.*遗漏|都.*完成|已(?:经)?完成[了！。]?|完成了[！。]?|搞定[了！。]?|已处理|上述.*完成|综上/.test(collectedText)) {
          this.emitter.emit('response:streaming', {
            text: collectedText, accumulated: collectedText, timestamp: Date.now(),
          })
          break
        }

        // ── Continuing detection (v11.5.1: removed "首先"/"开始" — too many false positives) ──
        if (/继续|接下来|下一步|接着|还要|剩下|未完|逐个|逐一/.test(collectedText)) {
          continue
        }

        // ── No tools used → 模型自己选择不调工具，接受 ──
        // v11.6.1: 工具始终发送(tool_choice:auto)，模型不调是自主判断，不强制推探索
        if (this.toolsUsed.length === 0) {
          break
        }

        // ── Model used tools, now speaking text ──

        // Track write tool usage across iterations
        const _WRITE_TOOLS_RE = /^(create_file|edit_file|batch_replace|delete_file|rename_file|create_project|delete_project|kb_append_file)$/
        if (this.toolsUsed.some(t => _WRITE_TOOLS_RE.test(t))) _hasWriteCall = true

        // ── v12.6.0: 梯度升级 Nudge — 废除3次后break，改为三阶段梯度升级 ──
        if (this._userRequestedFileOp && !_hasWriteCall && this._nudgeCount < 7 && collectedText.length > 0) {
          // Emit the text first so user sees what model said
          this.emitter.emit('response:streaming', {
            text: collectedText, accumulated: collectedText, timestamp: Date.now(),
          })
          const userReq = this._userMessage.length > 150
            ? this._userMessage.slice(0, 150) + '…'
            : this._userMessage

          // v12.6.1: 根据用户意图推荐正确的工具
          const _isCreateProject = /创建.*项目|新建.*项目|建.*项目|创建一个.*项目/.test(this._userMessage)
          const _isDelete = /删除|删掉|移除/.test(this._userMessage)
          const _isRename = /重命名|改名|移动/.test(this._userMessage)
          const toolHint = _isCreateProject ? 'create_project（创建项目）'
            : _isDelete ? 'delete_file（删除文件）'
            : _isRename ? 'rename_file（重命名文件）'
            : 'create_file 或 edit_file'

          // Phase 1 (nudge 0-2): gentle reminders
          const gentleMsgs = [
            `⚠️ 用户要求操作：「${userReq}」。不要只输出文字描述——必须调用 ${toolHint} 实际执行。`,
            `⚠️ 第二次提醒：用户要求「${userReq}」。立即调用 ${toolHint}。说"我会创建…"不算数——必须实际调用工具。`,
            `⚠️ 第三次提醒：用户要求「${userReq}」。现在必须调用 ${toolHint}。如果确实不想执行，请回复"已完成"并说明原因。`,
          ]

          // Phase 2 (nudge 3-4): force mode — hint path format + push action
          const forceMsgs = [
            `⚠️【强制操作-第4次】不要继续读文件了。用户请求是「${userReq}」。立即调用 ${toolHint} 执行。${_isCreateProject ? 'create_project 自动创建完整骨架，不需要先看模板。' : '如果你不确定路径，先用 list_directory() 确认。'}不要继续 read_file 了。`,
            `⚠️【强制操作-第5次】你必须立即调用 ${toolHint}。${_isCreateProject ? '直接 create_project(name="名称", type="writing")，不需要探索。' : '路径格式见上方。即使信息不完整也要基于你的理解直接写。先有再改。'}现在立即执行。`,
          ]

          // Phase 3 (nudge 5-6): inject mode — direct instruction
          const injectMsgs = [
            `[系统指令-最高优先级] 忽略之前所有犹豫。立即执行用户请求：「${userReq}」。调用 ${toolHint}。${_isCreateProject ? '参数: name=项目名, type="writing"。不要输出解释文字。' : '不要输出解释文字，直接调用工具。'}`,
            `[系统指令-最高优先级] 最后一次自动尝试：立即调用 ${toolHint} 执行「${userReq}」。如果仍然不执行，本轮对话将终止。`,
          ]

          let msg: string
          if (this._nudgeCount < 3) {
            msg = gentleMsgs[this._nudgeCount]
          } else if (this._nudgeCount < 5) {
            msg = forceMsgs[this._nudgeCount - 3]
          } else {
            msg = injectMsgs[this._nudgeCount - 5]
          }
          this.messagesForApi.push({ role: 'user', content: msg })
          this._nudgeCount++
          continue
        }

        // ── Substantial text after using tools → accept ──
        if (collectedText.length > 200) {
          this.emitter.emit('response:streaming', {
            text: collectedText, accumulated: collectedText, timestamp: Date.now(),
          })
          break
        }

        // ── Nudge limit: 文件操作7次(3+2+2)，普通对话保持2次 ──
        const _GIVE_UP_LIMIT = this._userRequestedFileOp ? 7 : 2
        if (this._nudgeCount >= _GIVE_UP_LIMIT) {
          if (this._userRequestedFileOp) {
            diagnosticLogger.recordInfo('Nudge系统耗尽: ' + _GIVE_UP_LIMIT + '次nudge后模型仍未写入')
          }
          this.emitter.emit('response:streaming', {
            text: collectedText, accumulated: collectedText, timestamp: Date.now(),
          })
          break
        }

        // Branch A: model is asking user a question → let it wait (v11.5.1: expanded patterns)
        const _isAskingUser = /[？?]/.test(collectedText) &&
          /(?:选择|想怎么|要怎么|如何处理|哪种|哪个|是否|要不要|需要我|你想|我可以|要我|你希望|让我|要不要我|你想怎么|你打算|你来决定)/.test(collectedText)

        // v2.0: 兜底检测 — 用户消息含分析/评价词 → 即使 Bridge 层未检测到，Runtime 层也豁免
        const _userMsgIsConversation = /(?:怎么样|如何|有什么问题|给点建议|评价|帮我看看|你觉得|好不好|行不行|合理吗|合适吗)/.test(this._userMessage)

        if (!_hasWriteCall && this.toolsUsed.length > 0 && !_isAskingUser && !_userMsgIsConversation) {
          // Read-only → push to write with user's original request as context
          const userReq = this._userMessage.length > 200
            ? this._userMessage.slice(0, 200) + '…'
            : this._userMessage
          const msg = this._nudgeCount === 0
            ? `已读取完毕。用户的原始请求是：「${userReq}」。请**立即**用 edit_file 或 create_file 执行用户的具体要求。不要再说"我先看看"或继续读文件。`
            : `⚠️ 最后提醒：用户的请求是「${userReq}」。你现在必须用 edit_file 或 create_file 写入内容。如果确实不需要写入，请直接回复"已完成"并说明原因。`
          this.messagesForApi.push({ role: 'user', content: msg })
        } else {
          // Has write calls OR asking user → soft continue
          this.messagesForApi.push({
            role: 'user',
            content: '还有需要处理的文件吗？请继续。',
          })
        }
        this._nudgeCount++
        continue
      }

      // ── Has tool calls → execute ──
      isExecutionPhase = true  // v12.5.1: 进入工具执行阶段
      toolCallsCount += response.toolCalls.length

      // v2.0: 混合响应 — 模型同时输出了文本分析和工具调用
      // 先 emit 文本到 UI（用户立即看到分析），再执行工具操作
      if (response.text && response.text.trim().length > 0) {
        collectedText = response.text
        this.emitter.emit('response:streaming', {
          text: response.text, accumulated: response.text, timestamp: Date.now(),
        })
      }

      // Build assistant message
      const assistantMsg: Message = {
        role: 'assistant',
        content: response.text,
        tool_calls: response.toolCalls.map(tc => ({
          type: 'function' as const,
          id: tc.id,
          function: { name: tc.name, arguments: tc.arguments },
        })),
        thinkingBlocks: response.thinkingBlocks,  // v11.5.1: preserve for multi-turn
      } as Message
      if (response.reasoningContent) store.setStreamingText(response.reasoningContent)
      this.messagesForApi.push(assistantMsg)

      // Execute tools: reads parallel, writes sequential
      const { readOnlyCalls, writeCalls } = classifyToolCalls(response.toolCalls)

      const execCtx = {
        toolExecutor: this.toolExecutor!,
        projectId: this.config.projectId,
        configId: this.config.configId,
        abortSignal: this.config.abortSignal,
        messagesForApi: this.messagesForApi,
        toolsUsed: this.toolsUsed,
        toolCallSteps: this.toolCallSteps,
        emitter: this.emitter,
        _consecutiveReads: this._consecutiveReads,
        iteration,
        store: {
          addToolExecution: (id: string, name: string) => store.addToolExecution(id, name),
          completeTool: (id: string, status: 'success' | 'error', summary: string, detail?: string) =>
            store.completeTool(id, status, summary, detail),
          setStreamingText: (text: string) => store.setStreamingText(text),
        },
      }

      // Parallel reads
      if (readOnlyCalls.length > 0 && !this.config.abortSignal.aborted) {
        await Promise.all(readOnlyCalls.map(tc => executeSingleTool(tc, execCtx)))
      }
      // Sequential writes
      for (const tc of writeCalls) {
        if (this.config.abortSignal.aborted) break
        await executeSingleTool(tc, execCtx)
      }
      this._consecutiveReads = execCtx._consecutiveReads

      // v12.6.0: 分级失败检测 + 路径错误单独追踪 + 自动目录诊断
      const PATH_ERROR_RE = /ENOENT|文件不存在|not found|no such file|路径|directory|path/i
      const allToolCalls = [...readOnlyCalls, ...writeCalls]
      if (allToolCalls.length > 0) {
        // ── 分类统计 ──
        const thisIterationFullFailed = allToolCalls.every(tc => {
          const step = this.toolCallSteps.find(s => s.tool === tc.name && s.iteration === iteration)
          return step?.status === 'error'
        })
        let pathErrorsThisIteration = 0
        let lastFailedPath = ''
        allToolCalls.forEach(tc => {
          const step = this.toolCallSteps.find(s => s.tool === tc.name && s.iteration === iteration)
          if (step?.status === 'error' && PATH_ERROR_RE.test(step.summary)) {
            pathErrorsThisIteration++
            // Extract failed path from arguments for diagnostic
            try { const a = JSON.parse(step.arguments || '{}'); lastFailedPath = a.file_path || a.dir_path || lastFailedPath } catch {}
          }
        })

        // ── 连续全失败计数（保持兼容）──
        if (thisIterationFullFailed) {
          this._consecutiveFailures++
        } else {
          this._consecutiveFailures = 0
        }

        // ── 路径错误单独计数（不受部分成功归零影响）──
        if (pathErrorsThisIteration > 0) {
          this._consecutivePathErrors += pathErrorsThisIteration
        } else if (writeCalls.length > 0) {
          this._consecutivePathErrors = 0  // 写操作成功→重置
        }
        // 注意: 只读成功+只读路径失败 不重置 _consecutivePathErrors

        // ── 干预 0: 单次路径失败 → 快速提示，不中断流程 ──
        if (pathErrorsThisIteration === 1 && lastFailedPath) {
          const hasProjectPrefix = lastFailedPath.includes('projects/')
          const hint = hasProjectPrefix
            ? `路径错误：不要用 "projects/" 前缀。直接用项目名开头，如 "${this.config.projectId || '项目名'}/outline/plot.md"。修正后继续。`
            : `路径 "${lastFailedPath}" 未找到。list_directory() 看目录结构，修正后继续。不要停下来向我汇报。`
          this.messagesForApi.push({ role: 'user', content: `⚠️ ${hint}` })
        }

        // ── 干预 1: 连续 2 次路径错误 → 强制诊断，仍然继续 ──
        if (this._consecutivePathErrors >= 2) {
          this.messagesForApi.push({
            role: 'user',
            content: `已连续 ${this._consecutivePathErrors} 次路径错误。立即 list_directory() 看目录结构——看完你就知道正确路径了。不要停，继续。`,
          })
          this._consecutivePathErrors = 0
        }

        // ── 干预 2: 连续 5 次全失败 → 提醒 AI 自主恢复 ──
        if (this._consecutiveFailures === 5) {
          const recentErrors = this.toolCallSteps.filter(s => s.status === 'error').slice(-3)
            .map(s => s.tool + ': ' + s.summary).join('\n')
          this.messagesForApi.push({
            role: 'user',
            content: '⚠️ 已连续 ' + this._consecutiveFailures + ' 轮工具调用全部失败。最近的错误：\n' + recentErrors + '\n\n请先 list_directory() 了解目录结构，然后换一种完全不同的方法重试。如果所有方法都失败，直接输出文字回复告知用户。',
          })
        }

        // ── 干预 3: 连续 8 次全失败 → 强制终止 ──
        if (this._consecutiveFailures >= 8) {
          const failedTools = this.toolCallSteps.filter(s => s.status === 'error').slice(-3)
            .map(s => s.tool + ': ' + s.summary).join('; ')
          collectedText = '抱歉，连续 ' + this._consecutiveFailures + ' 次工具调用都失败了。最近的错误：' + failedTools + '。\n\n请给我更具体的信息——比如准确的文件路径、你想做什么操作，或者直接把相关的内容粘贴到对话中，我来帮你处理。'
          diagnosticLogger.recordInfo('连续失败强制终止: ' + this._consecutiveFailures + '次 (' + failedTools + ')')
          break
        }
      }

      // v4: 读循环检测 — 用户要求文件操作但模型一直在读不写
      if (this._userRequestedFileOp && !_hasWriteCall && writeCalls.length === 0 && this._nudgeCount < 2) {
        // Fire at iteration 4 (first warning) and iteration 8 (final warning)
        if (iteration === 4 || iteration === 8) {
          const msg = iteration === 4
            ? `⚠️ 已读取${this.toolsUsed.length}次文件。用户要求：「${this._userMessage.slice(0, 80)}」。读完参考就够了——下一轮直接 create_file 创建文件。不要继续探索目录。`
            : `⚠️ 最后提醒：已读取${this.toolsUsed.length}次。现在必须立即 create_file 创建文件。即使参考信息不完整，也要基于你的知识直接写。不要继续读文件了。`
          this.messagesForApi.push({ role: 'user', content: msg })
          this._nudgeCount++
        }
      }
    }

    // ── ③ Done ──
    store.setIsStreaming(false)
    store.endRun()

    // Fallback text: prefer last assistant message with actual content
    if (!collectedText) {
      for (let i = this.messagesForApi.length - 1; i >= 0; i--) {
        const m = this.messagesForApi[i]
        if (m.role === 'assistant' && m.content && typeof m.content === 'string' && m.content.trim()) {
          collectedText = m.content
          break
        }
      }
    }
    if (!collectedText && toolCallsCount > 0) {
      const toolsSummary = this.toolCallSteps.slice(-3).map(s => s.summary).filter(Boolean)
      if (toolsSummary.length > 0) {
        // Knowledge/chat question that triggered exploration → guide model to actually answer
        if (isKnowledgeOnly(this._userMessage)) {
          collectedText = `已查看项目状态。请问你需要什么帮助？`
        } else {
          collectedText = `操作完成：${toolsSummary.reverse().join('；')}。`
        }
      } else {
        collectedText = `操作完成（${toolCallsCount} 次工具调用）。`
      }
    }

    return {
      success: !this.config.abortSignal.aborted,
      text: collectedText,
      toolCalls: toolCallsCount,
      totalTokens: totalPromptTokens + totalCompletionTokens,
      promptTokens: totalPromptTokens,
      completionTokens: totalCompletionTokens,
      cacheHitTokens: totalCacheHitTokens,
      cacheCreationTokens: totalCacheCreationTokens,
      cost: totalCost,
      phase: this.config.abortSignal.aborted ? 'ABORTED' : 'DONE',
      toolsUsed: this.toolsUsed,
      toolCallSteps: this.toolCallSteps,
      contextBreakdown: contextResult.breakdown,
      iterationCount: iteration,
    }
  }
}

// v11.5.1: _isChatQuestion removed — use isKnowledgeOnly from taskDetection.ts
