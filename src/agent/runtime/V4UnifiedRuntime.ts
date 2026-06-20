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
  private _nudgeCount = 0       // 自愈恢复轮次计数
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

    if (this.config.maxIterations < 1) {
      this.config.maxIterations = 30
    }
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
    this._nudgeCount = 0      // reset per run
    this._consecutiveFailures = 0
    this._consecutivePathErrors = 0
    this._userMessage = input.userMessage
    // v12.14.0: 统一使用 hasTaskKeywords 判断文件操作意图
    // 不再维护独立的 _explicitFileOp 正则 — 避免 Prompt 和 Runtime 两套关键词系统不一致
    this._userRequestedFileOp = hasTaskKeywords(input.userMessage)
    let _hasWriteCall = false  // track if model has called any write tool across iterations

    // v12.5.1: 阶段感知温度 — 初始为创作阶段
    let isExecutionPhase = false

    const contextResult = this.contextAssembler
      ? await this.contextAssembler(input.userMessage, this.historyMessages, this.config.projectId)
      : { systemMessages: [], totalTokens: 0, domains: [], breakdown: [] }

    this.messagesForApi = [
      ...contextResult.systemMessages,
      ...this.historyMessages,
      // v12.16.1: 任务边界 — 阻止模型纠结之前失败的任务
      // 原因: historyMessages 可能包含之前任务的残存上下文（失败、nudge、不完整的操作）
      // 模型看到这些会认为之前任务仍需继续，导致忽略当前用户的新请求
      ...(this.historyMessages.length > 0
        ? [{ role: 'system' as const, content: '[任务边界] 以上是之前的对话历史，下面是用户的新请求。你可以参考历史中的信息（如已读取的文件内容、已创建的角色设定），但不要自动继续之前未完成的工具操作——只响应当前的新请求。' }]
        : []),
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

      // ── 读操作计数：连续 N 次读取无写入时注入提醒 ──
      const READ_TOOLS_RE = /^(read_file|list_directory|search_content|find_files)$/
      const WRITE_TOOLS_RE = /^(create_file|edit_file|batch_replace|delete_file|rename_file|create_project|delete_project|kb_append_file)$/
      let consecutiveReads = 0
      let hasWritten = false
      for (let s = this.toolCallSteps.length - 1; s >= 0; s--) {
        const step = this.toolCallSteps[s]
        if (WRITE_TOOLS_RE.test(step.tool)) { hasWritten = true; break }
        if (READ_TOOLS_RE.test(step.tool)) consecutiveReads++
        else break  // non-read, non-write tool → stop counting
      }
      if (!hasWritten && consecutiveReads >= 5 && this._userRequestedFileOp) {
        this.messagesForApi.push({
          role: 'system',
          content: `[系统提醒] 已连续读取 ${consecutiveReads} 次。项目结构是标准模板——outline/有8个tab, characters/存角色YAML, summaries/存摘要, chapters/存正文。不要再探索，直接基于你的知识写入内容。先有再改。`,
        })
      } else if (!hasWritten && consecutiveReads >= 3 && this._userRequestedFileOp) {
        this.messagesForApi.push({
          role: 'system',
          content: `[系统提醒] 已读取 ${consecutiveReads} 次。信息应该足够了——项目结构是标准模板。现在开始写入，不要再读了。`,
        })
      }

      // ── API Call (with single retry for transient failures) ──
      const API_TIMEOUT = 180_000  // v12.16.4: 大型上下文需要更多响应时间
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
        // v12.16.2: 必须实际执行了写工具才接受"完成"声明
        // 防止模型说"全部完成！"但 create_file/edit_file 根本没调用
        const donePhrase = /[Tt]ask\s*[Cc]omplete|全部完成|所有.*已完成|任务完成|操作完毕|验证通过|最终.*完成|没有.*遗漏|都.*完成|已(?:经)?完成[了！。]?|完成了[！。]?|搞定[！。]?|已处理|上述.*完成|综上/.test(collectedText)
        if (donePhrase && (_hasWriteCall || !this._userRequestedFileOp)) {
          this.emitter.emit('response:streaming', {
            text: collectedText, accumulated: collectedText, timestamp: Date.now(),
          })
          break
        }
        // 说了"完成"但没写 → 不通过，进入自愈恢复
        if (donePhrase && this._userRequestedFileOp && !_hasWriteCall) {
          this.messagesForApi.push({
            role: 'user',
            content: '你说"完成"了，但工具调用记录显示你没有调用 create_file 或 edit_file。任务未完成——请实际执行写入操作。',
          })
          continue
        }

        // ── Continuing detection removed in v12.13.0 ──
        // 之前的 "继续/接下来/下一步" 关键词会无限绕过 Nudge 系统，导致只读死锁。
        // 现在所有文本响应都经过 nudge → 死锁检测 → 完成度自检 的完整链路。

        // ── No tools used → 模型自己选择不调工具 ──
        // v12.16.3: 用户要求了文件操作 → 不能接受"不用工具"，推入自愈恢复
        // 之前这里直接 break，导致模型说"全部完成"但没调任何工具也被接受
        if (this.toolsUsed.length === 0 && !this._userRequestedFileOp) {
          // 纯聊天 → 接受模型的选择
          break
        }
        if (this.toolsUsed.length === 0 && this._userRequestedFileOp) {
          // 用户要求了文件操作但模型完全没调工具 → 推入自愈恢复
          this.messagesForApi.push({
            role: 'user',
            content: `用户要求了文件操作：「${this._userMessage.slice(0, 200)}」。你必须调用 create_file 或 edit_file 实际执行。不要只输出文字描述——真的去创建或修改文件。`,
          })
          this._nudgeCount++
          continue
        }

        // ── Model used tools, now speaking text ──

        // Track write tool usage across iterations
        const _WRITE_TOOLS_RE = /^(create_file|edit_file|batch_replace|delete_file|rename_file|create_project|delete_project|kb_append_file)$/
        if (this.toolsUsed.some(t => _WRITE_TOOLS_RE.test(t))) _hasWriteCall = true

        // ── v12.16.0: 自愈恢复系统（替换梯度 Nudge）──
        // 思路: 不催促"快做！"，而是帮助模型分析问题、找到解决方案。
        // 模型按 System Prompt 的"操作失败处理"自我恢复 → Runtime 只在必要时提供诊断。
        if (collectedText.length > 200) {
          // 长文本回复 → 如果用户要求的文件操作还没做，不接受
          if (this._userRequestedFileOp && !_hasWriteCall) {
            this.messagesForApi.push({
              role: 'user',
              content: `你输出了长文本，但用户要求的文件操作还没有执行。请调用 create_file 或 edit_file 实际写入内容。不要只描述你会做什么——真的去做。`,
            })
            this._nudgeCount++
            continue
          }
          this.emitter.emit('response:streaming', {
            text: collectedText, accumulated: collectedText, timestamp: Date.now(),
          })
          break
        }

        // 已写入 → 任务完成
        if (_hasWriteCall) break

        // ── 以下: 用户要求了文件操作，但模型还没写 ──
        this._nudgeCount++

        // 向用户提问 → 不干预（等用户回答）
        if (/[？?]/.test(collectedText)) {
          this.emitter.emit('response:streaming', {
            text: collectedText, accumulated: collectedText, timestamp: Date.now(),
          })
          break
        }

        const userReq = this._userMessage.length > 200
          ? this._userMessage.slice(0, 200) + '…'
          : this._userMessage

        // 诊断数据
        const failedTools = this.toolCallSteps.filter(s => s.status === 'error')
        const readTools = this.toolCallSteps.filter(s => /^(read_file|list_directory|search_content|find_files)$/.test(s.tool))
        const writeTools = this.toolCallSteps.filter(s => /^(create_file|edit_file|batch_replace|delete_file|rename_file)$/.test(s.tool))

        let recoveryMsg: string

        if (this._nudgeCount >= 8) {
          // 8 轮仍未写入 → 最后诊断
          const errSummary = failedTools.slice(-3).map(s => `${s.tool}: ${s.summary.slice(0, 80)}`).join(' | ')
          recoveryMsg = `[自愈诊断-最终] 用户要求：「${userReq}」。已尝试 ${this._nudgeCount} 轮（${readTools.length} 读/${writeTools.length} 写），${failedTools.length} 个失败。${errSummary ? '失败摘要: ' + errSummary : ''}
请坦诚回复：如果任务可以完成 → 现在就做。如果确实无法完成 → 明确说明原因（不是"我做不到"而是"因为X导致Y所以无法Z"），让用户决定下一步。`
        } else if (failedTools.length >= 2 && this._nudgeCount >= 4) {
          // 重复失败 → 诊断分析
          const errSummary = failedTools.slice(-3).map(s => `${s.tool}: ${s.summary.slice(0, 80)}`).join(' | ')
          recoveryMsg = `[自愈诊断] 多个工具调用失败：${errSummary}
请分析失败原因，换一种完全不同的方法。例如：
- edit_file 匹配失败 → 用 __FULL_REPLACE__ 覆盖全文
- 路径错误 → list_directory() 确认目录结构后修正
- 文件不存在 → 直接用 create_file 新建
- 重复尝试相同参数无效 → 改变策略。分析后立即行动，不要重复同样的错误。`
        } else if (readTools.length >= 5 && writeTools.length === 0 && this._nudgeCount >= 3) {
          // 读太多不写
          recoveryMsg = `[自愈诊断] 已读取 ${readTools.length} 个文件但还未写入。用户要求：「${userReq}」。
信息应该已经足够。现在基于已有信息 + 你的知识直接创建内容。不确定的地方用你的判断填充——先有再改。不要再读文件了。`
        } else if (this._nudgeCount >= 5) {
          // 多轮无进展
          recoveryMsg = `[自愈诊断] 已尝试 ${this._nudgeCount} 轮，用户要求：「${userReq}」。
请分析当前状态：哪些成功了？哪些失败了？换一种方法继续推进。不要重复已经失败的操作。`
        } else {
          // 前几轮: 不干预，让 System Prompt 的自我恢复逻辑工作
          continue
        }

        this.emitter.emit('response:streaming', {
          text: collectedText, accumulated: collectedText, timestamp: Date.now(),
        })
        this.messagesForApi.push({ role: 'user', content: recoveryMsg })
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
      if (writeCalls.length > 0) _hasWriteCall = true  // v12.15.0: 工具执行路径中提前标记

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

      // v12.16.5: 重复读取提醒 — 同一文件被读2次以上 → 提醒直接引用历史
      const readFilePaths = this.toolCallSteps
        .filter(s => (s.tool === 'read_file' || s.tool === 'list_directory') && s.status === 'success')
        .map(s => { try { return JSON.parse(s.arguments || '{}').file_path || JSON.parse(s.arguments || '{}').dir_path } catch { return '' } })
        .filter(Boolean)
      const dupReads = readFilePaths.filter((p, i) => readFilePaths.indexOf(p) !== i)
      if (dupReads.length > 0 && this._userRequestedFileOp && !_hasWriteCall) {
        const dupSet = [...new Set(dupReads)].join('、')
        this.messagesForApi.push({
          role: 'user',
          content: `已重复读取: ${dupSet}。对话历史中已有这些结果——直接引用，不要重复。现在用 create_file 或 edit_file 写入。`,
        })
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
