// ── V4 Anthropic Runtime ──
// Anthropic Messages API 协议专用。使用流式 content blocks 替代 OpenAI 的
// request/response while 循环。模型在同一个流式响应中交替输出 text 和 tool_use
// blocks，运行时只需响应式执行工具并反馈结果。
//
// 相比 V4AgentRuntime（OpenAI 协议）可省去的逻辑：
//   - 渐进工具展开（模型自然选择）
//   - 迭代提示注入（v9.5.3: 已添加，以 user 角色注入）
//   - 手动并行/顺序工具控制（流式自然顺序）
//   - 空响应兜底（流式无空响应）
//   - reasoning_content 剥离（Anthropic thinking blocks 保留）

import { AgentEventEmitter } from './runtime/AgentEventEmitter'
import { ContractExecutor } from './context/ContractExecutor'
import { ContextCompressor } from './context/ContextCompressor'
import { toolRegistry } from './skills/ToolRegistry'
import { skillRegistry } from './skills/SkillRegistry'
import type { ActiveSkillContext } from './skills/types'
import { useAgentStore } from './store/AgentStore'
import { diagnosticLogger } from './diagnostics/DiagnosticLogger'
import type {
  AgentPhase,
  ToolCallRequest,
  ToolResult,
  ToolExecutionContext,
  Message,
} from './state/types'
import type { AnthropicToolDef, AnthropicStreamResult } from '@/types/anthropicTypes'

// ── Anthropic AIService 接口（不同于 OpenAI 版本） ──

export interface AnthropicAIService {
  chatAnthropicStream(params: {
    system: string[]
    messages: Array<{
      role: string
      content: Array<{
        type: string
        text?: string
        tool_use_id?: string
        id?: string
        name?: string
        input?: Record<string, unknown>
        content?: string
        thinking?: string
        signature?: string
      }>
    }>
    configId: string
    projectId?: string
    tools?: AnthropicToolDef[]
  }): Promise<AnthropicStreamResult>
  abortStream(): void
}

// ── Config（与 V4AgentRuntime 相同） ──

export interface V4AgentConfig {
  configId: string
  projectId: string | null
  maxIterations: number
  abortSignal: AbortSignal
  contextWindow?: number
}

export interface V4AgentRunInput {
  userMessage: string
  attachments: Array<{ type: string; name: string; content: string }>
}

export interface V4AgentRunResult {
  success: boolean
  text: string
  toolCalls: number
  totalTokens: number
  promptTokens: number
  completionTokens: number
  phase: AgentPhase
  toolsUsed: string[]
  toolCallSteps: Array<{
    tool: string; status: string; summary: string
    durationMs: number; iteration: number
  }>
  contextBreakdown?: Array<{ domain: string; tokens: number }>
  iterationCount: number
  /** v9.5.3: Skill 任务完成进度 */
  skillProgress?: { completed: number; total: number }
}

export interface ToolExecutorFn {
  (args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult>
}

export interface ContextAssemblerFn {
  (
    userMessage: string,
    history: Message[],
    projectId: string | null,
  ): Promise<{
    systemMessages: Array<{ role: 'system'; content: string }>
    totalTokens: number
    domains: string[]
    breakdown?: Array<{ domain: string; tokens: number }>
  }>
}

// ── 类型转换工具 ──

function toAnthropicTools(openaiTools: unknown[]): AnthropicToolDef[] {
  return openaiTools
    .map((t: any) => {
      const fn = t?.function
      if (!fn) return null
      return {
        name: fn.name,
        description: fn.description || '',
        input_schema: {
          type: 'object' as const,
          properties: fn.parameters?.properties || {},
          required: fn.parameters?.required || [],
        },
      }
    })
    .filter(Boolean) as AnthropicToolDef[]
}

function messagesToAnthropic(msgs: Message[]): Array<{
  role: string
  content: Array<{
    type: string
    text?: string
    tool_use_id?: string
    id?: string
    name?: string
    input?: Record<string, unknown>
    content?: string
  }>
}> {
  const result: Array<{
    role: string
    content: Array<{
      type: string
      text?: string
      tool_use_id?: string
      id?: string
      name?: string
      input?: Record<string, unknown>
      content?: string
    }>
  }> = []

  for (const m of msgs) {
    if (m.role === 'system') continue // system 作为独立参数传递

    const content: Array<{
      type: string
      text?: string
      tool_use_id?: string
      id?: string
      name?: string
      input?: Record<string, unknown>
      content?: string
    }> = []

    if (m.role === 'tool') {
      // 工具结果 → user 消息（Anthropic 要求）
      content.push({
        type: 'tool_result',
        tool_use_id: (m as any).tool_call_id || '',
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      })
      result.push({ role: 'user', content })
    } else if (m.role === 'assistant' && (m as any).tool_calls) {
      // Assistant 含工具调用
      if (m.content && typeof m.content === 'string' && m.content.trim()) {
        content.push({ type: 'text', text: m.content })
      }
      for (const tc of (m as any).tool_calls) {
        let input: Record<string, unknown> = {}
        try {
          input = typeof tc.function?.arguments === 'string'
            ? JSON.parse(tc.function.arguments)
            : (tc.function?.arguments || {})
        } catch { /* keep empty */ }
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function?.name || tc.name,
          input,
        })
      }
      result.push({ role: 'assistant', content })
    } else {
      // 普通 user/assistant 消息
      const text = typeof m.content === 'string' ? m.content : ''
      if (text) content.push({ type: 'text', text })
      if (content.length === 0) content.push({ type: 'text', text: '' })
      result.push({ role: m.role, content })
    }
  }

  return result
}

// ── Runtime ──

export class V4AnthropicRuntime {
  private config: V4AgentConfig
  private emitter = new AgentEventEmitter()
  private toolExecutor: ToolExecutorFn | null = null
  private contextAssembler: ContextAssemblerFn | null = null
  private aiService: AnthropicAIService | null = null
  private tools: unknown[] = []
  private messagesForApi: Message[] = []
  private historyMessages: Message[] = []
  private toolsUsed: string[] = []
  private toolCallSteps: Array<{
    tool: string; status: string; summary: string
    durationMs: number; iteration: number
  }> = []
  private compressor: ContextCompressor
  private compressedAt = 0
  private lastCompressLength = 0
  private activeSkill: ActiveSkillContext | null = null  // v5: Skill 运行时追踪
  private _consecutiveReads = 0  // v9.5.3: 行动提示计数器

  constructor(config: V4AgentConfig) {
    this.config = config
    this.compressor = new ContextCompressor(config.contextWindow ?? 128_000)
  }

  // ── Dependency Injection ──

  setToolExecutor(fn: ToolExecutorFn): void { this.toolExecutor = fn }
  setContextAssembler(fn: ContextAssemblerFn): void { this.contextAssembler = fn }
  setAIService(svc: AnthropicAIService): void { this.aiService = svc }
  setTools(tools: unknown[]): void { this.tools = tools }
  setHistory(messages: Message[]): void { this.historyMessages = messages }
  setActiveSkill(skill: ActiveSkillContext | null): void { this.activeSkill = skill }  // v5: Skill 运行时追踪
  setMaxIterations(n: number): void { this.config.maxIterations = n }  // v9.5.3: Skill 可覆盖

  getEmitter(): AgentEventEmitter { return this.emitter }

  abort(): void {
    this.emitter.abort()
  }

  // ── Run ──

  async run(input: V4AgentRunInput): Promise<V4AgentRunResult> {
    const store = useAgentStore.getState()
    const runStartTime = Date.now()
    const RUN_TIMEOUT = 300_000

    if (!this.aiService || !this.toolExecutor) {
      return {
        success: false, text: 'AI 服务未配置',
        toolCalls: 0, totalTokens: 0, promptTokens: 0, completionTokens: 0,
        phase: 'ERROR' as AgentPhase, toolsUsed: [], toolCallSteps: [],
        iterationCount: 0,
      }
    }

    store.startRun('anthropic_run')
    store.setPhase('RUNNING' as AgentPhase)
    diagnosticLogger.recordPhaseChange('IDLE' as AgentPhase, 'RUNNING' as AgentPhase)

    let totalPromptTokens = 0
    let totalCompletionTokens = 0
    let toolCallsCount = 0
    let collectedText = ''
    this.toolsUsed = []
    this.toolCallSteps = []

    // ① 构建上下文
    let contextResult
    if (this.contextAssembler) {
      contextResult = await this.contextAssembler(
        input.userMessage, this.historyMessages, this.config.projectId,
      )
    } else {
      contextResult = { systemMessages: [], totalTokens: 0, domains: [], breakdown: [] }
    }

    const systemMessages = contextResult.systemMessages
    this.messagesForApi = [
      ...systemMessages,
      ...this.historyMessages,
      { role: 'user', content: input.userMessage },
    ]

    // ② 提取 system 文本（Anthropic 作为顶层参数）
    const systemTexts = systemMessages.map(m => m.content)

    // ③ 主循环（Anthropic 流式）
    let iteration = 0
    let shouldContinue = true

    while (iteration < this.config.maxIterations && shouldContinue) {
      if (this.config.abortSignal.aborted) break
      if (Date.now() - runStartTime > RUN_TIMEOUT) {
        collectedText = collectedText || '运行超时'
        break
      }

      iteration++
      store.setIteration(iteration)

      // v9.5.3: Anthropic Runtime 迭代提示
      // 注意：Anthropic 协议下 system 消息作为独立参数传递（不在 messages 中），
      // messagesToAnthropic() 会跳过 role: 'system'。因此迭代提示以 user 角色注入。
      if (iteration >= 3) {
        for (let i = this.messagesForApi.length - 1; i >= 0; i--) {
          const m = this.messagesForApi[i]
          if (m.role === 'user' && typeof m.content === 'string' &&
              (m.content.startsWith('[提示]') || m.content.startsWith('[最后轮次]'))) {
            this.messagesForApi.splice(i, 1)
          }
        }
        const hintMsg = {
          role: 'user' as const,
          content: iteration >= this.config.maxIterations - 1
            ? '[最后轮次] 已达到最大操作轮次。请基于已完成的工具结果生成最终文本回复。'
            : `[提示] 当前第${iteration}轮。如果已有足够信息回复用户，请直接输出文本回复，不要继续工具调用。`,
        }
        this.messagesForApi.push(hintMsg)
      }

      // 上下文压缩（与 OpenAI Runtime 相同逻辑）
      const estimatedTokens = this.compressor.estimateMessages(this.messagesForApi)
      if (this.compressor.needsCompression(estimatedTokens)) {
        const stage = this.compressor.getStage(estimatedTokens)
        const newSinceCompress = this.lastCompressLength > 0
          ? this.messagesForApi.length - this.lastCompressLength
          : 0
        const protectRecent = Math.max(5, newSinceCompress)
        const before = this.messagesForApi.length
        this.messagesForApi = this.compressor.compress(
          this.messagesForApi, estimatedTokens, protectRecent,
        )
        this.lastCompressLength = this.messagesForApi.length
        diagnosticLogger.recordInfo(
          `[Anthropic] 压缩: ${stage} | ${before}→${this.messagesForApi.length}条`,
        )
        this.compressedAt = iteration
      }

      // 转换消息格式
      const anthropicMessages = messagesToAnthropic(this.messagesForApi)
      const anthropicTools = toAnthropicTools(this.tools)

      // 调用 Anthropic 流式 API
      diagnosticLogger.recordApiCallStart()
      let response: AnthropicStreamResult

      try {
        response = await this.aiService.chatAnthropicStream({
          system: systemTexts,
          messages: anthropicMessages,
          configId: this.config.configId,
          projectId: this.config.projectId || undefined,
          tools: anthropicTools.length > 0 ? anthropicTools : undefined,
        })
      } catch (apiErr) {
        const errMsg = apiErr instanceof Error ? apiErr.message : 'API 调用失败'
        collectedText = `错误: ${errMsg}`
        shouldContinue = false
        break
      }

      const promptTok = response.usage?.input_tokens || 0
      const completionTok = response.usage?.output_tokens || 0
      totalPromptTokens += promptTok
      totalCompletionTokens += completionTok
      store.addTokens(promptTok + completionTok)
      diagnosticLogger.recordApiCallEnd(
        promptTok + completionTok,
        response.toolUses.length > 0,
      )

      collectedText = response.text || collectedText
      this.emitter.emit('response:streaming', {
        text: collectedText,
        accumulated: collectedText,
        timestamp: Date.now(),
      })

      // 无工具调用 → 完成
      if (response.toolUses.length === 0) {
        // 如果有文本，直接结束；无文本则追加提示
        if (!collectedText.trim()) {
          this.messagesForApi.push({
            role: 'user',
            content: '请用中文直接生成文本回复。',
          })
          continue
        }
        shouldContinue = false
        break
      }

      // 有工具调用 → 构建 assistant 消息并执行
      toolCallsCount += response.toolUses.length

      // 转换 toolUses 为统一的 ToolCallRequest 格式
      const toolCalls: ToolCallRequest[] = response.toolUses.map(tu => ({
        id: tu.id,
        name: tu.name,
        arguments: JSON.stringify(tu.input),
      }))

      // 存储 assistant 消息：content 存纯文本，tool_calls 存 OpenAI 格式。
      // messagesToAnthropic() 会通过 tool_calls 正确重建 tool_use content blocks，
      // 避免将 JSON 序列化字符串误传为纯文本导致 Anthropic API 协议违规。
      this.messagesForApi.push({
        role: 'assistant',
        content: response.text || '',
        tool_calls: toolCalls.map(tc => ({
          type: 'function' as const,
          id: tc.id,
          function: { name: tc.name, arguments: tc.arguments },
        })),
      } as Message)

      // Read tools → parallel, write tools → sequential
      const WRITE_TOOLS = new Set(['create_file','edit_file','batch_replace','delete_file','rename_file','create_project','delete_project',
        'create_style_template','create_scene_template','kb_create_file','kb_append_file','write_note','append_note','delete_note',
        'shell_exec','shell_run_script','generate_image','http_get','http_fetch','browser_open','browser_search'])
      const readOnlyCalls: ToolCallRequest[] = []
      const writeCalls: ToolCallRequest[] = []

      for (const tc of toolCalls) {
        if (WRITE_TOOLS.has(tc.name)) {
          writeCalls.push(tc)
        } else {
          readOnlyCalls.push(tc)
        }
      }

      // 并行执行只读工具
      if (readOnlyCalls.length > 0 && !this.config.abortSignal.aborted) {
        await Promise.all(
          readOnlyCalls.map(tc => this.executeSingleTool(tc, store, iteration)),
        )
      }

      // 顺序执行写入工具
      for (const tc of writeCalls) {
        if (this.config.abortSignal.aborted) break
        await this.executeSingleTool(tc, store, iteration)
      }

      // Anthropic 要求：所有 tool_result 必须合并在一条 user 消息中
      // 这已通过 messagesForApi 中的 tool 角色消息在下一轮 messagesToAnthropic 中合并
    }

    // ④ 完成
    diagnosticLogger.recordPhaseChange('RUNNING' as AgentPhase, 'DONE' as AgentPhase)
    store.setIsStreaming(false)
    store.endRun()

    if (!collectedText) {
      for (let i = this.messagesForApi.length - 1; i >= 0; i--) {
        const m = this.messagesForApi[i]
        if (
          m.role === 'assistant' &&
          typeof m.content === 'string' &&
          m.content.trim()
        ) {
          collectedText = m.content
          break
        }
      }
    }
    if (!collectedText) {
      collectedText = `操作完成（${toolCallsCount} 次工具调用）。`
    }

    return {
      success: !this.config.abortSignal.aborted,
      text: collectedText,
      toolCalls: toolCallsCount,
      totalTokens: totalPromptTokens + totalCompletionTokens,
      promptTokens: totalPromptTokens,
      completionTokens: totalCompletionTokens,
      phase: this.config.abortSignal.aborted ? 'ABORTED' as AgentPhase : 'DONE' as AgentPhase,
      toolsUsed: this.toolsUsed,
      toolCallSteps: this.toolCallSteps,
      contextBreakdown: contextResult.breakdown,
      iterationCount: iteration,
      skillProgress: this.activeSkill
        ? { completed: this.activeSkill.completedSteps.size, total: skillRegistry.get(this.activeSkill.skillId)?.workflow.steps.length ?? 0 }
        : undefined,
    }
  }

  // ── Tool Execution（与 OpenAI Runtime 相同） ──

  private async executeSingleTool(
    tc: ToolCallRequest,
    store: ReturnType<typeof useAgentStore.getState>,
    iteration = 0,
  ): Promise<void> {
    if (!this.toolsUsed.includes(tc.name)) this.toolsUsed.push(tc.name)

    diagnosticLogger.recordToolStart(tc.id, tc.name)
    store.addToolExecution(tc.id, tc.name)

    let args: Record<string, unknown>
    try {
      args = JSON.parse(tc.arguments)
    } catch {
      const errResult = { status: 'error' as const, summary: '工具参数 JSON 解析失败' }
      this.messagesForApi.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(errResult),
      } as Message)
      store.completeTool(tc.id, 'error', errResult.summary)
      return
    }

    const t0 = Date.now()
    let result: ToolResult
    if (this.toolExecutor) {
      const TOOL_TIMEOUT = 60_000
      const execPromise = this.toolExecutor(args, {
        projectId: this.config.projectId,
        configId: this.config.configId,
        callId: tc.id,
        toolName: tc.name,
        signal: this.config.abortSignal,
      })
      const timeoutPromise = new Promise<ToolResult>(r =>
        setTimeout(
          () => r({ status: 'error', summary: `工具 ${tc.name} 执行超时` }),
          TOOL_TIMEOUT,
        ),
      )
      result = await Promise.race([execPromise, timeoutPromise])
    } else {
      result = { status: 'error', summary: '工具执行器未配置' }
    }

    const durationMs = Date.now() - t0
    this.toolCallSteps.push({
      tool: tc.name,
      status: result.status,
      summary: result.summary || '',
      durationMs,
      iteration,
    })

    diagnosticLogger.recordToolEnd(tc.id, tc.name, result.status)
    if (result.status === 'success') {
      store.completeTool(tc.id, 'success', result.summary, result.detail)
    } else {
      store.completeTool(tc.id, 'error', result.summary, result.detail)
    }

    // ── v9.5.3: 前置条件 — 跟踪缺失文件 ──
    if (this.activeSkill && tc.name === 'read_file' && result.status === 'error') {
      const fp = String(args.file_path || '')
      if (fp) this.activeSkill.missingFiles.add(fp)
    }

    // ── v9.5.3: 行动提示 — 连续读取后无写入则注入提醒 ──
    const READ_TOOLS = new Set(['read_file','list_directory','search_content','find_files'])
    const WRITE_TOOLS_ACTION = new Set(['create_file','edit_file','batch_replace','delete_file','rename_file',
      'kb_create_file','kb_append_file','write_note','append_note'])
    if (READ_TOOLS.has(tc.name)) {
      this._consecutiveReads = (this._consecutiveReads || 0) + 1
    } else if (WRITE_TOOLS_ACTION.has(tc.name)) {
      this._consecutiveReads = 0
    }
    if ((this._consecutiveReads || 0) >= 2 && result.status === 'success') {
      this.messagesForApi.push({
        role: 'user',
        content: '[行动提示] 已连续读取多个文件，请立即对需要修改的文件调用 edit_file 或 create_file 写入。',
      } as Message)
      this._consecutiveReads = 0  // reset after injecting prompt
    }

    // ── v5: Skill 质量检查 ──
    if (this.activeSkill && result.status === 'success') {
      const skill = skillRegistry.get(this.activeSkill.skillId)
      if (skill) {
        // v9.5.3: 前置条件 — 下一步文件已知缺失则自动跳过
        const nextStep = skill.workflow.steps.find(s => s.order === this.activeSkill!.currentStep + 1)
        if (nextStep?.precondition && this.activeSkill!.missingFiles.has(nextStep.precondition.path)) {
          this.activeSkill!.completedSteps.add(nextStep.order)
          this.activeSkill!.currentStep = Math.min(nextStep.order + 1, skill.workflow.steps.length + 1)
          this.messagesForApi.push({
            role: 'user',
            content: `[前置条件] 步骤 ${nextStep.order}（${nextStep.purpose}）所需文件已知不存在，已自动跳过。`,
          } as Message)
        }

        const matchedStep = skill.workflow.steps.find(
          s => s.tool === tc.name && s.order === this.activeSkill!.currentStep
        )
        if (matchedStep) {
          this.activeSkill.completedSteps.add(matchedStep.order)
          this.activeSkill.currentStep = Math.min(
            matchedStep.order + 1,
            skill.workflow.steps.length + 1
          )
        }
        if (/^(create_file|edit_file|create_style_template|create_scene_template)$/.test(tc.name)) {
          const failed = this.runQualityChecks(skill, tc.name, result, args)
          if (failed.length > 0 && this.activeSkill.retryCount < 3) {
            this.activeSkill.retryCount++
            const correctionMsg = `[自动纠错] 以下质量检查未通过，请修正后重试：\n` +
              failed.map(f => `- ${f.description}`).join('\n') +
              `\n请基于以上反馈修正后重新调用 ${tc.name}。`
            this.messagesForApi.push({ role: 'user', content: correctionMsg } as Message)
          } else if (failed.length > 0 && this.activeSkill.retryCount >= 3) {
            // v9.5.3: 熔断反馈
            this.messagesForApi.push({
              role: 'user',
              content: `[质量检查] 已重试 ${this.activeSkill.retryCount} 次仍未通过以下检查，当前结果已接受，请继续后续步骤：\n` +
                failed.map(f => `- ${f.description}`).join('\n'),
            } as Message)
          }
        }
      }
    }

    // 过滤结果后加入上下文（ContractExecutor）
    const { resultForApi, note } = ContractExecutor.filterForContext(tc.name, result)
    // v9.5.3: I5 截断阈值对齐 OpenAI Runtime（500→2000）
    if (iteration > 1 && resultForApi.detail && resultForApi.detail.length > 2000) {
      resultForApi.detail = resultForApi.detail.slice(0, 2000) + '...(已截断)'
    }
    const finalResult = note ? { ...resultForApi, note } : resultForApi

    this.messagesForApi.push({
      role: 'tool',
      tool_call_id: tc.id,
      content: JSON.stringify(finalResult),
    } as Message)
  }

  // ── v5: Skill 质量检查（与 OpenAI Runtime 共用逻辑） ──
  // 质量检查分两类：
  //   A. 代码可自动检测 — 正则/结构校验（如字段完整性、格式合法性）
  //   B. 行为约束 — 依赖提示词约束（如"必须先 read_file"、"等待用户确认"）
  //     此类在 evaluateQualityCheck 中 default → true，不会误报

  private runQualityChecks(
    skill: { qualityChecks: Array<{ id: string; description: string; severity: string; check: string }> },
    toolName: string,
    result: ToolResult,
    args: Record<string, unknown>,
  ): Array<{ id: string; description: string }> {
    const failed: Array<{ id: string; description: string }> = []
    const content = String(args.content || result.detail || '')
    for (const qc of skill.qualityChecks) {
      if (!this.isQualityCheckApplicable(qc.id, toolName)) continue
      if (!this.evaluateQualityCheck(qc.id, content, args)) {
        failed.push({ id: qc.id, description: qc.description })
      }
    }
    return failed
  }

  private isQualityCheckApplicable(checkId: string, toolName: string): boolean {
    if (/^qc-/.test(checkId) && toolName === 'create_file') return true
    if (/^(word-count|paragraph-spacing|not-one-block|chapter-format|read-summary-not-chapter)$/.test(checkId)) return toolName === 'create_file'
    if (/^(no-empty-dims|11-required-dims|vocabulary-limit|english-keys)$/.test(checkId)) return toolName === 'create_style_template'
    if (/^(required-fields|auto-fields-limit|no-empty-config)$/.test(checkId)) return toolName === 'create_scene_template'
    if (/^(content-length|old-string-exact|append-not-overwrite)$/.test(checkId)) return toolName === 'edit_file' || toolName === 'create_file'
    if (/^(list-before-create|remind-index|chinese-name)$/.test(checkId)) return toolName === 'kb_create_file'
    if (/^(yaml-format|plot-length|analyze-first|wait-confirm|offer-options|confirm-type|read-before-edit)$/.test(checkId)) return false
    return false
  }

  private evaluateQualityCheck(checkId: string, content: string, args: Record<string, unknown>): boolean {
    const filePath = String(args.file_path || '')
    const fileName = filePath.replace(/^.*[/\\]/, '').replace(/\.(yaml|yml|json)$/, '')

    switch (checkId) {
      // ═══ 角色卡检查 ═══
      case 'qc-all-fields': {
        const requiredFields = ['id','name','role','gender','age','occupation',
          'background','appearance','personality','abilities','weaknesses',
          'relationships','relationshipTags','arc','importance']
        return requiredFields.every(f => content.includes(f + ':'))
      }
      case 'qc-abilities-string':
        return !/\babilities\b.*:\s*[\{\[]/.test(content)
      case 'qc-role-enum':
        return /\brole\b.*:\s*(男主|女主|男配|女配|反派|其他)/.test(content)
      case 'qc-relationship-tags':
        return /relationshipTags\b.*:\s*\[/.test(content)
      case 'qc-importance-number':
        return /\bimportance\b.*:\s*\d+/.test(content)
      case 'qc-no-nesting':
        return !/^(id|name|role|gender|age|occupation|background|appearance|personality|abilities|weaknesses|relationships|relationshipTags|arc|importance):\s*\n\s+\w+:/m.test(content)
      case 'qc-name-match': {
        if (!fileName || !content) return true
        const nameField = content.match(/^name:\s*(.+)$/m)
        return nameField ? nameField[1].trim() === fileName : true
      }
      case 'qc-file-extension':
        return filePath.endsWith('.yaml') || filePath.endsWith('.yml')

      // ═══ 风格模板检查 ═══
      case 'no-empty-dims':
        return !/\bdimensions\b.*:\s*\{\s*\}/.test(content) && !/\bdimensions\b.*:\s*""/.test(content)
      case '11-required-dims': {
        const requiredDims = ['narrativeTone','sentenceStyle','vocabularyStyle','rhetoricStyle',
          'rhythmStyle','dialogueStyle','moodStyle','perspectiveStyle','bodyLanguageStyle',
          'sensoryStyle','descriptionPattern']
        let dims: Record<string, unknown> | null = null
        const rawDims = args.dimensions
        if (typeof rawDims === 'string') {
          try { dims = JSON.parse(rawDims) } catch { /* not JSON */ }
        } else if (rawDims && typeof rawDims === 'object') {
          dims = rawDims as Record<string, unknown>
        }
        if (dims) {
          return requiredDims.every(d => dims![d] && typeof dims![d] === 'object')
        }
        return requiredDims.every(d => content.includes(`"${d}"`) || content.includes(d + ':'))
      }
      case 'vocabulary-limit':
        return true
      case 'english-keys': {
        let dimsStr = ''
        const rawDims = args.dimensions
        if (typeof rawDims === 'string') dimsStr = rawDims
        else if (rawDims && typeof rawDims === 'object') dimsStr = JSON.stringify(rawDims)
        else dimsStr = content
        const keyMatch = dimsStr.match(/"dimensions"\s*:\s*\{([^}]+)\}/)
        if (keyMatch) return !/[一-鿿]/.test(keyMatch[1])
        return true
      }

      // ═══ 章节正文检查 ═══
      case 'word-count':
        return content.length >= 500
      case 'paragraph-spacing':
        return /\n\n/.test(content)
      case 'not-one-block':
        return content.split('\n').filter(l => l.trim()).length >= 3
      case 'chapter-format':
        return /^#\s+.+/m.test(content) && content.split('\n').filter(l => l.trim()).length >= 3

      // ═══ 场景模板检查 ═══
      case 'required-fields': {
        const hasName = typeof args.name === 'string' && args.name.trim().length > 0
        const hasType = typeof args.type === 'string' && args.type.trim().length > 0
        return hasName && hasType
      }
      case 'auto-fields-limit': {
        const af = args.autoFields
        return !Array.isArray(af) || af.length <= 10
      }
      case 'no-empty-config': {
        const plotOk = typeof args.plotOverview === 'string' && args.plotOverview.trim().length > 0
        const sceneOk = typeof args.sceneType === 'string' && args.sceneType.trim().length > 0
        return plotOk || sceneOk
      }

      // ═══ 大纲/KB 检查 ═══
      case 'content-length':
        return content.length >= 50
      case 'chinese-name':
        return /[一-鿿]/.test(fileName)

      default:
        return true
    }
  }
}
