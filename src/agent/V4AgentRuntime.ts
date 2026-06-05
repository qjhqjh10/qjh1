// ── V4 Agent Runtime ──
// Single unified while loop — model is the sole decision-maker.
// Replaces V3's: 13-state FSM, TaskPipeline, PlanEnforcer, ReflectionEngine,
// HallucinationDetector, BudgetManager, CheckpointManager, CircuitBreaker.

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
  ApiResponse,
  ToolResult,
  ToolExecutionContext,
  Message,
} from './state/types'

// These types are defined IN the imports above — no local redefinition needed.
// ToolResult, ToolExecutionContext, Message are now in state/types.ts

// ── Config ──

export interface V4AgentConfig {
  configId: string
  projectId: string | null
  maxIterations: number
  abortSignal: AbortSignal
  contextWindow?: number  // 模型上下文窗口大小 (默认 128K)，用于压缩阈值计算
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
  toolCallSteps: Array<{ tool: string; status: string; summary: string; durationMs: number; iteration: number }>
  contextBreakdown?: Array<{ domain: string; tokens: number }>
  iterationCount: number
}

// ── Dependency Contracts ──

export interface ToolExecutorFn {
  (args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult>
}

export interface AIService {
  chatWithTools(
    messages: Message[],
    configId: string,
    projectId: string | undefined,
    tools?: unknown[],
  ): Promise<{
    text: string
    toolCalls: ToolCallRequest[] | null
    finishReason: string
    usage?: ApiResponse['usage']
    reasoning_content?: string
  }>
  abortStream(): void
}

export interface ContextAssemblerFn {
  (userMessage: string, history: Message[], projectId: string | null): Promise<{
    systemMessages: Array<{ role: 'system'; content: string }>
    totalTokens: number
    domains: string[]
    breakdown?: Array<{ domain: string; tokens: number }>
  }>
}

// ── Runtime ──

export class V4AgentRuntime {
  private config: V4AgentConfig
  private emitter = new AgentEventEmitter()
  private toolExecutor: ToolExecutorFn | null = null
  private contextAssembler: ContextAssemblerFn | null = null
  private aiService: AIService | null = null
  private tools: unknown[] = []
  private extendedTools: unknown[] = []  // v4.1: progressive disclosure — added on iteration 3+
  private toolsExpanded = false
  private messagesForApi: Message[] = []
  private historyMessages: Message[] = []
  private toolsUsed: string[] = []
  private toolCallSteps: Array<{ tool: string; status: string; summary: string; durationMs: number; iteration: number }> = []
  private compressor: ContextCompressor  // set in constructor from config.contextWindow
  private compressedAt = 0
  private lastCompressLength = 0  // v4.2: protect recent tool results from being compressed away
  private activeSkill: ActiveSkillContext | null = null  // v5: Skill 运行时追踪

  constructor(config: V4AgentConfig) {
    this.config = config
    this.compressor = new ContextCompressor(config.contextWindow ?? 128_000)
  }

  // ── Dependency Injection ──

  setToolExecutor(fn: ToolExecutorFn): void { this.toolExecutor = fn }
  setContextAssembler(fn: ContextAssemblerFn): void { this.contextAssembler = fn }
  setAIService(svc: AIService): void { this.aiService = svc }
  setTools(tools: unknown[]): void { this.tools = tools }
  setExtendedTools(tools: unknown[]): void { this.extendedTools = tools }  // v4.1 progressive disclosure
  setHistory(messages: Message[]): void { this.historyMessages = messages }
  setActiveSkill(skill: ActiveSkillContext | null): void { this.activeSkill = skill }  // v5: Skill 运行时追踪

  getEmitter(): AgentEventEmitter { return this.emitter }
  getToolResults(): readonly ToolResult[] { return [] }
  getMessagesForApi(): Message[] { return [...this.messagesForApi] }

  abort(): void {
    this.emitter.abort()
  }

  // ── Run ──

  async run(input: V4AgentRunInput): Promise<V4AgentRunResult> {
    const store = useAgentStore.getState()
    const runId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    const runStartTime = Date.now()
    const RUN_TIMEOUT = 300_000 // 5 minutes wall-clock

    if (!this.aiService || !this.toolExecutor) {
      return { success: false, text: 'AI 服务未配置', toolCalls: 0, totalTokens: 0, promptTokens: 0, completionTokens: 0, phase: 'ERROR' as AgentPhase, toolsUsed: [], toolCallSteps: [], iterationCount: 0 }
    }

    store.startRun(runId)

    // ── ① Assemble initial messages ──
    let totalTokens = 0
    let totalPromptTokens = 0
    let totalCompletionTokens = 0
    let toolCallsCount = 0
    let collectedText = ''
    this.toolsUsed = []
    this.toolCallSteps = []

    store.setPhase('RUNNING' as AgentPhase)
    diagnosticLogger.recordPhaseChange('IDLE' as AgentPhase, 'RUNNING' as AgentPhase)
    this.emitter.emit('agent:state', { from: 'IDLE' as AgentPhase, to: 'RUNNING' as AgentPhase, state: { phase: 'RUNNING' as AgentPhase, iteration: 0, maxIterations: this.config.maxIterations, errors: [] } })

    // Build context
    let contextResult
    if (this.contextAssembler) {
      contextResult = await this.contextAssembler(input.userMessage, this.historyMessages, this.config.projectId)
    } else {
      contextResult = { systemMessages: [], totalTokens: 0, domains: [], breakdown: [] }
    }

    // v4: Agent 4 — full constitution on iteration 1, minimal on iterations 2+
    const fullSystemMessages = contextResult.systemMessages

    this.messagesForApi = [
      ...fullSystemMessages,
      ...this.historyMessages,
      { role: 'user', content: input.userMessage },
    ]

    // ── ② Main loop ──
    let iteration = 0
    let shouldContinue = true

    while (iteration < this.config.maxIterations && shouldContinue) {
      // Abort check
      if (this.config.abortSignal.aborted) {
        shouldContinue = false
        break
      }

      // Wall-clock timeout
      if (Date.now() - runStartTime > RUN_TIMEOUT) {
        collectedText = collectedText || '运行超时'
        shouldContinue = false
        break
      }

      iteration++
      store.setIteration(iteration)

      // v4.1: Keep core prompt intact for DeepSeek prefix caching.
      // The cache_control on messagesForApi[0] only works if content never changes.
      // On iteration 3+, inject a brief execution hint as a separate system message
      // (after the core + dynamic system messages). This preserves prefix caching
      // across all iterations while still nudging the model to stop when appropriate.
      if (iteration >= 3) {
        const hintIdx = fullSystemMessages.length  // after system messages, before history
        // Remove ALL previous hint messages before inserting the new one
        for (let i = this.messagesForApi.length - 1; i >= hintIdx; i--) {
          const m = this.messagesForApi[i]
          if (m.role === 'system' && typeof m.content === 'string' &&
              (m.content.startsWith('[提示]') || m.content.startsWith('[最后轮次]'))) {
            this.messagesForApi.splice(i, 1)
          }
        }
        // Insert the new hint
        this.messagesForApi.splice(hintIdx, 0, {
          role: 'system',
          content: iteration >= this.config.maxIterations - 1
            ? '[最后轮次] 已达到最大操作轮次。请基于已完成的工具结果生成最终文本回复。'
            : `[提示] 当前第${iteration}轮。如果已有足够信息回复用户，请直接输出文本回复，不要继续工具调用。`,
        })
      }
      this.emitter.emit('thinking:start', { intent: `第 ${iteration} 轮`, steps: [], filesNeeded: [], estimatedTokens: 0, timestamp: Date.now() })

      // ── Context Compression (Claude-style, transparent) ──
      const estimatedTokens = this.compressor.estimateMessages(this.messagesForApi)
      if (this.compressor.needsCompression(estimatedTokens)) {
        const stage = this.compressor.getStage(estimatedTokens)
        // H10: Protect messages added since last compression (tool results + assistant)
        // from being truncated — they contain fresh context the model just requested.
        const newSinceCompress = this.lastCompressLength > 0
          ? this.messagesForApi.length - this.lastCompressLength
          : 0
        const protectRecent = Math.max(5, newSinceCompress)
        const before = this.messagesForApi.length
        this.messagesForApi = this.compressor.compress(this.messagesForApi, estimatedTokens, protectRecent)
        this.lastCompressLength = this.messagesForApi.length
        diagnosticLogger.recordInfo(`上下文压缩: ${stage} | ${before}→${this.messagesForApi.length}条(保护${protectRecent}) | ~${Math.round(estimatedTokens/1000)}K tokens`)
        this.compressedAt = iteration
      }

      // ── API Call (with single retry for transient failures) ──
      const isLastIteration = iteration >= this.config.maxIterations
      // v4.1 Progressive tool disclosure:
      //   Iteration 1-2: core tools only (最小工具集)
      //   Iteration 3+:   core + extended (扩展工具集) — 核心工具不够用时自动追加
      //   Last iteration:  no tools (强制文本回复)
      if (!this.toolsExpanded && iteration >= 3 && this.extendedTools.length > 0) {
        this.tools = [...this.tools, ...this.extendedTools]
        this.toolsExpanded = true
        diagnosticLogger.recordInfo(`工具扩展: +${this.extendedTools.length}个 (迭代${iteration})`)
      }
      const toolsForThisRound = isLastIteration ? [] : this.tools
      const API_TIMEOUT = 90_000
      const MAX_RETRIES = 1

      let response
      let lastApiErr: Error | null = null

      for (let retry = 0; retry <= MAX_RETRIES; retry++) {
        if (this.config.abortSignal.aborted) { shouldContinue = false; break }
        diagnosticLogger.recordApiCallStart()
        try {
          const apiPromise = this.aiService.chatWithTools(
            this.messagesForApi,
            this.config.configId,
            this.config.projectId || undefined,
            toolsForThisRound,
          )
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`API 超时 (${API_TIMEOUT / 1000}秒)`)), API_TIMEOUT)
          )
          response = await Promise.race([apiPromise, timeoutPromise])
          break // Success — exit retry loop
        } catch (apiErr) {
          lastApiErr = apiErr instanceof Error ? apiErr : new Error('API 调用失败')
          const isTransient = lastApiErr.message.includes('超时') ||
                              lastApiErr.message.includes('timeout') ||
                              lastApiErr.message.includes('network') ||
                              lastApiErr.message.includes('ECONNREFUSED') ||
                              lastApiErr.message.includes('ETIMEDOUT') ||
                              lastApiErr.message.includes('429') ||
                              lastApiErr.message.includes('503') ||
                              lastApiErr.message.includes('502')
          if (retry < MAX_RETRIES && isTransient) {
            diagnosticLogger.recordInfo(`API 重试 ${retry + 1}/${MAX_RETRIES}: ${lastApiErr.message}`)
            await new Promise(r => setTimeout(r, 2000 * (retry + 1))) // Exponential backoff
            continue
          }
          break // Non-transient or retries exhausted
        }
      }

      if (!response) {
        const errMsg = lastApiErr?.message || 'API 调用失败'
        collectedText = `错误: ${errMsg}`
        shouldContinue = false
        break
      }

      totalTokens += response.usage?.total_tokens || 0
      totalPromptTokens += response.usage?.prompt_tokens || 0
      totalCompletionTokens += response.usage?.completion_tokens || 0
      store.addTokens(response.usage?.total_tokens || 0)
      diagnosticLogger.recordApiCallEnd(response.usage?.total_tokens || 0, (response.toolCalls?.length ?? 0) > 0)

      // ── No tool calls → model is done ──
      if (!response.toolCalls || response.toolCalls.length === 0) {
        collectedText = response.text || ''
        // H5: If model returns neither tool calls nor text, give it one more
        // chance to produce a text reply (may be a premature stop with empty content).
        if (!collectedText.trim() && !isLastIteration) {
          this.messagesForApi.push({
            role: 'user',
            content: '请用中文直接生成文本回复。不要调用工具，直接输出回复内容。',
          })
          continue  // retry the loop — model gets another shot
        }
        this.emitter.emit('response:streaming', { text: response.text, accumulated: response.text, timestamp: Date.now() })
        shouldContinue = false
        break
      }

      // ── Has tool calls → execute ──
      toolCallsCount += response.toolCalls.length

      // Add assistant message to context (I3: strip reasoning_content to avoid re-sending)
      const assistantMsg: Message = {
        role: 'assistant',
        content: response.text,
        tool_calls: (response.toolCalls || []).map(tc => ({
          type: 'function',
          id: tc.id,
          function: { name: tc.name, arguments: tc.arguments },
        })),
        // reasoning_content NOT included in messagesForApi — stored via store/emitter for UI only
      }
      // Emit reasoning_content to store for UI display (not re-sent to API)
      if (response.reasoning_content) {
        store.setStreamingText(response.reasoning_content) // piggyback on streaming for UI
      }
      this.messagesForApi.push(assistantMsg)

      // ── Execute tools ──
      // Read tools → parallel, write tools → sequential (based on operation type, not permission)
      const WRITE_TOOLS = new Set(['create_file','edit_file','delete_file','rename_file','create_project','delete_project',
        'create_style_template','create_scene_template','kb_create_file','kb_append_file','write_note','append_note','delete_note',
        'shell_exec','shell_run_script','generate_image','http_get','http_fetch','browser_open','browser_search'])
      const readOnlyCalls: ToolCallRequest[] = []
      const writeCalls: ToolCallRequest[] = []

      for (const tc of response.toolCalls) {
        if (WRITE_TOOLS.has(tc.name)) {
          writeCalls.push(tc)
        } else {
          readOnlyCalls.push(tc)
        }
      }

      // Execute read-only tools in parallel
      if (readOnlyCalls.length > 0 && !this.config.abortSignal.aborted) {
        await Promise.all(readOnlyCalls.map(tc =>
          this.executeSingleTool(tc, runId, store, iteration)
        ))
      }

      // Execute write tools sequentially
      for (const tc of writeCalls) {
        if (this.config.abortSignal.aborted) break
        await this.executeSingleTool(tc, runId, store, iteration)
      }

    }

    // ── ③ Done ──
    diagnosticLogger.recordPhaseChange('RUNNING' as AgentPhase, 'DONE' as AgentPhase)
    store.setIsStreaming(false)
    store.endRun()

    // Fallback: if no text collected, extract from messages
    if (!collectedText) {
      for (let i = this.messagesForApi.length - 1; i >= 0; i--) {
        const m = this.messagesForApi[i]
        if (m.role === 'assistant' && m.content && typeof m.content === 'string' && m.content.trim()) {
          collectedText = m.content
          break
        }
      }
    }
    if (!collectedText) {
      const toolSummaries = this.messagesForApi
        .filter(m => m.role === 'tool' && m.content)
        .slice(-3)
        .map(m => {
          try { return JSON.parse(m.content).summary || '' } catch { return '' }
        })
        .filter(Boolean)
      collectedText = toolSummaries.length > 0
        ? `操作完成：${toolSummaries.reverse().join('；')}。`
        : '操作完成。'
    }

    return {
      success: !this.config.abortSignal.aborted,
      text: collectedText,
      toolCalls: toolCallsCount,
      totalTokens,
      promptTokens: totalPromptTokens,
      completionTokens: totalCompletionTokens,
      phase: this.config.abortSignal.aborted ? 'ABORTED' as AgentPhase : 'DONE' as AgentPhase,
      toolsUsed: this.toolsUsed,
      toolCallSteps: this.toolCallSteps,
      contextBreakdown: contextResult.breakdown,
      iterationCount: iteration,
    }
  }

  // ── Tool Execution ──

  private async executeSingleTool(
    tc: ToolCallRequest,
    runId: string,
    store: ReturnType<typeof useAgentStore.getState>,
    iteration = 0,
  ): Promise<void> {
    if (!this.toolsUsed.includes(tc.name)) this.toolsUsed.push(tc.name)

    diagnosticLogger.recordToolStart(tc.id, tc.name)
    store.addToolExecution(tc.id, tc.name)
    this.emitter.emit('tool:started', {
      callId: tc.id, toolName: tc.name,
      phase: 'started', progress: 0,
      message: `${tc.name} 开始执行`,
      timestamp: Date.now(),
    })

    let args: Record<string, unknown>
    try {
      args = JSON.parse(tc.arguments)
    } catch {
      const errResult = { status: 'error' as const, summary: `工具参数 JSON 解析失败` }
      this.messagesForApi.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(errResult) })
      store.completeTool(tc.id, 'error', errResult.summary)
      return
    }

    // Execute (with 60s timeout)
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
        setTimeout(() => r({ status: 'error', summary: `工具 ${tc.name} 执行超时` }), TOOL_TIMEOUT)
      )
      result = await Promise.race([execPromise, timeoutPromise])
    } else {
      result = { status: 'error', summary: '工具执行器未配置' }
    }
    const durationMs = Date.now() - t0
    this.toolCallSteps.push({ tool: tc.name, status: result.status, summary: result.summary || '', durationMs, iteration })

    // Emit result
    diagnosticLogger.recordToolEnd(tc.id, tc.name, result.status)
    if (result.status === 'success') {
      store.completeTool(tc.id, 'success', result.summary, result.detail)
      this.emitter.emit('tool:completed', {
        callId: tc.id, toolName: tc.name,
        status: 'success', summary: result.summary, detail: result.detail,
        timestamp: Date.now(),
      })
    } else {
      store.completeTool(tc.id, 'error', result.summary, result.detail)
      this.emitter.emit('tool:failed', {
        callId: tc.id, toolName: tc.name,
        status: 'error', summary: result.summary, detail: result.detail,
        timestamp: Date.now(),
      })
    }

    // ── v5: Skill 质量检查 ──
    if (this.activeSkill && result.status === 'success') {
      const skill = skillRegistry.get(this.activeSkill.skillId)
      if (skill) {
        // 标记步骤完成
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

        // 运行质量检查（仅 write/create 类工具）
        if (/^(create_file|edit_file|create_style_template|create_scene_template)$/.test(tc.name)) {
          const failed = this.runQualityChecks(skill, tc.name, result, args)
          if (failed.length > 0 && this.activeSkill.retryCount < 3) {
            this.activeSkill.retryCount++
            const correctionMsg = `[自动纠错] 以下质量检查未通过，请修正后重试：\n` +
              failed.map(f => `- ${f.description}`).join('\n') +
              `\n请基于以上反馈修正后重新调用 ${tc.name}。`
            this.messagesForApi.push({ role: 'user', content: correctionMsg })
            diagnosticLogger.recordInfo(`Skill QC: ${failed.length} checks failed for ${skill.id}`)
          }
        }
      }
    }

    // Filter result for API context (ContractExecutor: strip verbose detail)
    const { resultForApi, note } = ContractExecutor.filterForContext(tc.name, result)
    // I5: Progressive trim — after iteration 1, truncate read tool detail to 500 chars
    if (iteration > 1 && resultForApi.detail && resultForApi.detail.length > 500) {
      resultForApi.detail = resultForApi.detail.slice(0, 500) + '…(已截断)'
    }
    const finalResult = note ? { ...resultForApi, note } : resultForApi
    this.messagesForApi.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(finalResult) })
  }

  // ── v5: Skill 质量检查执行器 ──

  private runQualityChecks(
    skill: { qualityChecks: Array<{ id: string; description: string; severity: string; check: string }> },
    toolName: string,
    result: ToolResult,
    args: Record<string, unknown>,
  ): Array<{ id: string; description: string }> {
    const failed: Array<{ id: string; description: string }> = []
    const content = String(args.content || result.detail || '')

    for (const qc of skill.qualityChecks) {
      // 只对 write/create 工具运行检查
      if (!this.isQualityCheckApplicable(qc.id, toolName)) continue

      const passed = this.evaluateQualityCheck(qc.id, content)
      if (!passed) {
        failed.push({ id: qc.id, description: qc.description })
      }
    }
    return failed
  }

  private isQualityCheckApplicable(checkId: string, toolName: string): boolean {
    // 角色相关检查 → 仅 create_file 创建角色文件时
    if (/^qc-/.test(checkId) && toolName === 'create_file') {
      return true
    }
    // 风格/场景模板检查 → 仅对应模板工具
    if (/^(no-empty-dims|11-required-dims|vocabulary-limit)$/.test(checkId)) {
      return toolName === 'create_style_template'
    }
    if (/^(required-fields|auto-fields)$/.test(checkId)) {
      return toolName === 'create_scene_template' || toolName === 'create_style_template'
    }
    // 字数/格式检查 → 章节创建
    if (/^(word-count|paragraph-spacing|not-one-block)$/.test(checkId)) {
      return toolName === 'create_file'  // 章节正文
    }
    return false
  }

  private evaluateQualityCheck(checkId: string, content: string): boolean {
    switch (checkId) {
      case 'qc-all-fields': {
        // 检查角色 16 字段是否全存在
        const requiredFields = ['id','name','role','gender','age','occupation',
          'background','appearance','personality','abilities','weaknesses',
          'relationships','relationshipTags','arc','importance']
        return requiredFields.every(f => content.includes(f))
      }
      case 'qc-abilities-string':
        return !/\babilities\b.*:\s*\{/.test(content)
      case 'qc-role-enum':
        return /\brole\b.*:\s*(男主|女主|男配|女配|反派|其他)/.test(content)
      case 'qc-relationship-tags':
        return /relationshipTags\b.*:\s*\[/.test(content)
      case 'qc-importance-number':
        return /\bimportance\b.*:\s*\d+/.test(content)
      case 'no-empty-dims':
        return !/\bdimensions\b.*:\s*\{\s*\}/.test(content)
      case 'word-count':
        return content.length >= 500  // 最低 500 字
      case 'paragraph-spacing':
        return /\n\n/.test(content)
      case 'not-one-block':
        return content.split('\n').filter(l => l.trim()).length >= 3
      default:
        return true  // 无法自动检测的 → 默认通过
    }
  }
}
