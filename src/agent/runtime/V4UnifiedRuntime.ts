// ── V4 Unified Runtime ──
// Single runtime for both OpenAI and Anthropic protocols.
// Protocol differences are abstracted behind ProtocolAdapter.
// Replaces V4AgentRuntime (744行) + V4AnthropicRuntime (791行).
//
// v9.6.0: Merged + extracted QualityCheckEngine / ToolExecutor / ToolActionPrompter.

import { AgentEventEmitter } from './AgentEventEmitter'
import { ContextCompressor } from '../context/ContextCompressor'
import { skillRegistry } from '../skills/SkillRegistry'
import { useAgentStore } from '../store/AgentStore'
import { diagnosticLogger } from '../diagnostics/DiagnosticLogger'
import { executeSingleTool, classifyToolCalls } from './ToolExecutor'
import { PhaseManager } from './PhaseManager'
import type {
  V4AgentConfig,
  V4AgentRunInput,
  V4AgentRunResult,
  ToolExecutorFn,
  ContextAssemblerFn,
} from './RuntimeTypes'
import type { ProtocolAdapter, NormalizedModelResponse } from './adapters/ProtocolAdapter'
import type { ActiveSkillContext } from '../skills/types'
import type { Message, AgentPhase } from '../state/types'

export class V4UnifiedRuntime {
  private config: V4AgentConfig
  private adapter: ProtocolAdapter
  private emitter = new AgentEventEmitter()
  private toolExecutor: ToolExecutorFn | null = null
  private contextAssembler: ContextAssemblerFn | null = null
  private tools: unknown[] = []
  private extendedTools: unknown[] = []
  private toolsExpanded = false
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
  private activeSkill: ActiveSkillContext | null = null
  private _consecutiveReads = 0
  private _verificationRan = false  // v9.7.0: 防止验证注入死循环
  private phaseManager = new PhaseManager()  // v10.0.0: 三阶段状态机
  private _complexityRouted = false  // v10.0.1: 复杂度路由只触发一次

  constructor(config: V4AgentConfig, adapter: ProtocolAdapter) {
    this.config = config
    this.adapter = adapter
    this.compressor = new ContextCompressor(config.contextWindow ?? 128_000)
  }

  // ── Dependency Injection ──

  setToolExecutor(fn: ToolExecutorFn): void { this.toolExecutor = fn }
  setContextAssembler(fn: ContextAssemblerFn): void { this.contextAssembler = fn }
  setTools(tools: unknown[]): void { this.tools = tools }
  setExtendedTools(tools: unknown[]): void { this.extendedTools = tools }
  setHistory(messages: Message[]): void { this.historyMessages = messages }
  setActiveSkill(skill: ActiveSkillContext | null): void { this.activeSkill = skill }
  setMaxIterations(n: number): void { this.config.maxIterations = n }

  getEmitter(): AgentEventEmitter { return this.emitter }
  getMessagesForApi(): Message[] { return [...this.messagesForApi] }

  abort(): void {
    this.emitter.abort()
  }

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
        phase: 'ERROR' as AgentPhase, toolsUsed: [], toolCallSteps: [],
        iterationCount: 0,
      }
    }

    // v9.5.5: 熔断器
    const circuitCheck = store.checkCircuit()
    if (!circuitCheck.allowed) {
      return {
        success: false, text: circuitCheck.reason || '服务暂时不可用',
        toolCalls: 0, totalTokens: 0, promptTokens: 0, completionTokens: 0,
        phase: 'ERROR' as AgentPhase, toolsUsed: [], toolCallSteps: [],
        iterationCount: 0,
      }
    }

    store.startRun(runId)

    // ── v10.0.0: 启动三阶段状态机 ──
    this.phaseManager.startRun(input.userMessage)  // 始终计算复杂度
    this._complexityRouted = false
    if (this.config.skipAnalyze) {
      this.phaseManager.transition('EXECUTE')  // 跳过 ANALYZE，直接进入 EXECUTE
    }

    // ── ① Assemble initial messages ──
    let totalPromptTokens = 0
    let totalCompletionTokens = 0
    let toolCallsCount = 0
    let collectedText = ''
    this.toolsUsed = []
    this.toolCallSteps = []
    this._verificationRan = false

    const initPhase: AgentPhase = 'ANALYZE'
    store.setPhase(initPhase)
    diagnosticLogger.recordPhaseChange('IDLE' as AgentPhase, initPhase)
    this.emitter.emit('agent:state', {
      from: 'IDLE' as AgentPhase, to: initPhase,
      state: { phase: initPhase, iteration: 0, maxIterations: this.config.maxIterations, errors: [] },
    })

    let contextResult
    if (this.contextAssembler) {
      contextResult = await this.contextAssembler(input.userMessage, this.historyMessages, this.config.projectId)
    } else {
      contextResult = { systemMessages: [], totalTokens: 0, domains: [], breakdown: [] }
    }

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
      if (this.config.abortSignal.aborted) { shouldContinue = false; break }
      if (Date.now() - runStartTime > RUN_TIMEOUT) {
        collectedText = collectedText || '运行超时'
        shouldContinue = false
        break
      }

      iteration++
      store.setIteration(iteration)

      // ── Iteration hints (v10.0.3: 复杂任务不注入提示，仅在最后轮次警告) ──
      const isComplex = this.phaseManager.getTaskComplexity() === 'complex'
      const isLastIter = iteration >= this.config.maxIterations - 1
      // 复杂任务：仅在最后轮次注入警告；简单任务：迭代5+时温和提示
      if (isLastIter || (!isComplex && iteration >= 5)) {
        const caps = this.adapter.capabilities
        const hintRole = caps.systemRoleHints ? 'system' : 'user'
        const hintContent = isLastIter
          ? '[最后轮次] 这是最后一轮操作。请基于已完成的结果生成最终文本回复。'
          : `[提示] 当前第${iteration}轮。请确认所有要求的文件/操作是否都已完成。如有遗漏请继续，不要提前停止。`

        if (caps.systemRoleHints) {
          // System role: splice after system messages (preserve prefix caching)
          const hintIdx = fullSystemMessages.length
          for (let i = this.messagesForApi.length - 1; i >= hintIdx; i--) {
            const m = this.messagesForApi[i]
            if (m.role === 'system' && typeof m.content === 'string' &&
                (m.content.startsWith('[提示]') || m.content.startsWith('[最后轮次]'))) {
              this.messagesForApi.splice(i, 1)
            }
          }
          this.messagesForApi.splice(hintIdx, 0, { role: 'system', content: hintContent })
        } else {
          // User role: push to end (Anthropic skips system in messages)
          for (let i = this.messagesForApi.length - 1; i >= 0; i--) {
            const m = this.messagesForApi[i]
            if (m.role === 'user' && typeof m.content === 'string' &&
                (m.content.startsWith('[提示]') || m.content.startsWith('[最后轮次]'))) {
              this.messagesForApi.splice(i, 1)
            }
          }
          this.messagesForApi.push({ role: 'user', content: hintContent })
        }
      }
      this.emitter.emit('thinking:start', {
        intent: `第 ${iteration} 轮`, steps: [], filesNeeded: [], estimatedTokens: 0, timestamp: Date.now(),
      })

      // ── Context Compression ──
      const estimatedTokens = this.compressor.estimateMessages(this.messagesForApi)
      if (this.compressor.needsCompression(estimatedTokens)) {
        const stage = this.compressor.getStage(estimatedTokens)
        const newSinceCompress = this.lastCompressLength > 0
          ? this.messagesForApi.length - this.lastCompressLength
          : 0
        const protectRecent = Math.max(5, newSinceCompress)
        const before = this.messagesForApi.length
        this.messagesForApi = this.compressor.compress(this.messagesForApi, estimatedTokens, protectRecent)
        this.lastCompressLength = this.messagesForApi.length
        diagnosticLogger.recordInfo(`上下文压缩: ${stage} | ${before}→${this.messagesForApi.length}条(保护${protectRecent}) | ~${Math.round(estimatedTokens / 1000)}K tokens`)
        this.compressedAt = iteration
      }

      // ── Progressive tool disclosure (protocol-gated) ──
      const caps = this.adapter.capabilities
      if (caps.progressiveDisclosure && !this.toolsExpanded && iteration >= 3 && this.extendedTools.length > 0) {
        this.tools = [...this.tools, ...this.extendedTools]
        this.toolsExpanded = true
        diagnosticLogger.recordInfo(`工具扩展: +${this.extendedTools.length}个 (迭代${iteration})`)
      }
      const isLastIteration = iteration >= this.config.maxIterations
      const toolsForThisRound = this.tools  // v10.0.3: 最后一轮也保留工具，让模型完成剩余任务

      // ── API Call (with single retry for transient failures) ──
      const API_TIMEOUT = 90_000
      const MAX_RETRIES = 1

      // v9.6.0: recordApiCallStart outside retry loop (Bug 4 fix)
      diagnosticLogger.recordApiCallStart()
      let response: NormalizedModelResponse | undefined
      let lastApiErr: Error | null = null

      for (let retry = 0; retry <= MAX_RETRIES; retry++) {
        if (this.config.abortSignal.aborted) { shouldContinue = false; break }
        try {
          const apiPromise = this.adapter.callModel({
            messages: this.messagesForApi,
            tools: toolsForThisRound,
            configId: this.config.configId,
            projectId: this.config.projectId || undefined,
            signal: this.config.abortSignal,
          })
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`API 超时 (${API_TIMEOUT / 1000}秒)`)), API_TIMEOUT),
          )
          response = await Promise.race([apiPromise, timeoutPromise])
          break
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
            await new Promise(r => setTimeout(r, 2000 * (retry + 1)))
            continue
          }
          break
        }
      }

      if (!response) {
        const errMsg = lastApiErr?.message || 'API 调用失败'
        collectedText = `错误: ${errMsg}`
        shouldContinue = false
        store.recordApiFailure()
        break
      }

      store.recordApiSuccess()

      totalPromptTokens += response.usage.inputTokens
      totalCompletionTokens += response.usage.outputTokens
      store.addTokens(response.usage.totalTokens)
      diagnosticLogger.recordApiCallEnd(response.usage.totalTokens, response.toolCalls.length > 0)

      // ── v10.0.0: ANALYZE 阶段门控 ──
      if (this.phaseManager.isInPhase('ANALYZE')) {
        const check = this.phaseManager.checkAnalyzePhase(response)
        if (!check.canProceed) {
          this.messagesForApi.push({ role: 'user', content: check.injection! })
          continue
        }
        // 分析完成 → 转入 EXECUTE（继续到下面的复杂度路由）
        this.phaseManager.transition('EXECUTE')
        store.setPhase('EXECUTE' as AgentPhase)
        diagnosticLogger.recordInfo(`Phase: ANALYZE→EXECUTE (${this.phaseManager.getTaskComplexity()})`)
        this.emitter.emit('agent:state', {
          from: 'ANALYZE' as AgentPhase, to: 'EXECUTE' as AgentPhase,
          state: { phase: 'EXECUTE' as AgentPhase, iteration, maxIterations: this.config.maxIterations, errors: [] },
        })
      }

      // ── v10.0.1: 复杂度路由（ANALYZE→EXECUTE 或 skipAnalyze 后首次 EXECUTE）──
      if (this.phaseManager.isInPhase('EXECUTE') && !this._complexityRouted) {
        this._complexityRouted = true
        if (this.phaseManager.getTaskComplexity() === 'complex' && !this.activeSkill) {
          const catalogEntry = this.getSkillCatalogSuggestion()
          if (catalogEntry) {
            this.messagesForApi.push({ role: 'user', content: catalogEntry })
            // 从 ANALYZE 转入时用 continue 避免执行未分析完的工具调用
            // 从 skipAnalyze 直接 EXECUTE 时不 continue——让本轮工具正常执行
            if (this.config.skipAnalyze) {
              // 本轮工具正常执行，建议在下轮生效
            } else {
              continue
            }
          }
        }
      }

      // ── v10.0.1: EXECUTE 阶段 Skill Gate（允许但建议模式）──
      if (!this.config.skipSkillGate && this.phaseManager.isInPhase('EXECUTE') && response.toolCalls.length > 0) {
        for (const tc of response.toolCalls) {
          let args: Record<string, unknown> = {}
          try { args = JSON.parse(tc.arguments) } catch {}
          const check = this.phaseManager.checkSkillGate(tc.name, args, this.activeSkill)
          if (check.suggestion) {
            this.messagesForApi.push({ role: 'user', content: check.suggestion })
          }
        }
      }

      // ── No tool calls → model thinks it's done ──
      if (response.toolCalls.length === 0) {
        collectedText = response.text || ''
        if (!collectedText.trim()) {
          this.messagesForApi.push({
            role: 'user',
            content: '请用中文直接生成文本回复。不要调用工具，直接输出回复内容。',
          })
          continue
        }

        // v10.0.1: 检查任务是否真的完成了
        let shouldNudge = false
        let nudgeReason = ''

        if (this.activeSkill) {
          const skill = skillRegistry.get(this.activeSkill.skillId)
          if (skill) {
            const mandatorySteps = skill.workflow.steps.filter(s => !s.optional)
            const incomplete = mandatorySteps.filter(s => !this.activeSkill!.completedSteps.has(s.order))
            if (incomplete.length > 0 && iteration < this.config.maxIterations) {
              shouldNudge = true
              nudgeReason = `[任务未完成] 以下必要步骤尚未执行:\n${incomplete.map(s => `步骤${s.order}: ${s.purpose}`).join('\n')}`
            }
          }

          if (!shouldNudge && !this._verificationRan) {
            const vMsg = this.buildVerificationInjection()
            if (vMsg) {
              this._verificationRan = true
              this.messagesForApi.push({ role: 'user', content: vMsg })
              continue
            }
          }
        }

        // 通用检查：复杂任务迭代不足8轮 → 模型可能提前停止，强制继续
        if (!shouldNudge && this.phaseManager.getTaskComplexity() === 'complex' && iteration < 8 && !isLastIteration) {
          shouldNudge = true
          nudgeReason = '[任务未完成] 这是一个复杂任务，你可能还需要处理更多文件。请检查是否所有要求的操作都已完成。如果还需要操作其他文件，请继续。'
        }

        if (shouldNudge && iteration < this.config.maxIterations) {
          this.messagesForApi.push({ role: 'user', content: `${nudgeReason}\n\n请继续执行，不要停止。` })
          continue
        }

        this.emitter.emit('response:streaming', {
          text: collectedText, accumulated: collectedText, timestamp: Date.now(),
        })
        shouldContinue = false
        break
      }

      // ── Has tool calls → execute ──
      toolCallsCount += response.toolCalls.length

      // Build assistant message in canonical OpenAI format
      const assistantMsg: Message = {
        role: 'assistant',
        content: response.text,
        tool_calls: response.toolCalls.map(tc => ({
          type: 'function' as const,
          id: tc.id,
          function: { name: tc.name, arguments: tc.arguments },
        })),
      } as Message
      if (response.reasoningContent) {
        store.setStreamingText(response.reasoningContent)
      }
      this.messagesForApi.push(assistantMsg)

      // Execute tools (delegated to ToolExecutor)
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
        activeSkill: this.activeSkill,
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
      // v9.6.1: invoke_skill 可能激活新的 activeSkillCtx，同步回来 + 覆盖 maxIterations
      if (execCtx.activeSkill && execCtx.activeSkill !== this.activeSkill) {
        this.activeSkill = execCtx.activeSkill
        const skill = skillRegistry.get(this.activeSkill.skillId)
        if (skill?.workflow.maxIterations) {
          const newMax = Math.max(this.config.maxIterations, skill.workflow.maxIterations)
          if (newMax > this.config.maxIterations) {
            this.config.maxIterations = newMax
            diagnosticLogger.recordInfo(`Skill maxIterations override: ${skill.id} → ${newMax}`)
          }
        }
      }
    }

    // ── ③ Done ──
    const exitPhase: AgentPhase = this.phaseManager.getPhase() === 'ANALYZE' ? 'ANALYZE' : 'EXECUTE'
    diagnosticLogger.recordPhaseChange(exitPhase, 'DONE' as AgentPhase)
    store.setIsStreaming(false)
    store.endRun()

    // Two-tier fallback text
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
        : `操作完成（${toolCallsCount} 次工具调用）。`
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

  // ── v10.0.0: Skill Catalog 建议 ──

  private getSkillCatalogSuggestion(): string | null {
    const skills = skillRegistry.getEnabled()
    if (skills.length === 0) return null
    const entries = skills.map(s => `- **${s.id}**: ${s.description}`).join('\n')
    return `[任务路由] 这是一个复杂任务，建议先调用 \`invoke_skill\` 获取完整工作流。可用技能:\n${entries}\n\n请选择最匹配的技能调用 invoke_skill。`
  }

  // ── v9.7.0: 事后验证 ──

  private buildVerificationInjection(): string | null {
    if (!this.activeSkill) return null
    const skill = skillRegistry.get(this.activeSkill.skillId)
    if (!skill) return null

    const parts: string[] = ['[后处理验证]']
    const v = skill.workflow.verification

    if (v) {
      // 检查强制步骤是否完成
      const missing = v.requiredSteps.filter(s => !this.activeSkill!.completedSteps.has(s))
      if (missing.length > 0) {
        parts.push(`⚠️ 以下必要步骤未执行: ${missing.join(', ')}。请补全后再验证。`)
      }

      // 引导运行验证脚本
      if (v.script) {
        parts.push(`请运行验证脚本: shell_run_script name="${v.script}"`)
        parts.push(`验证内容: ${v.description}`)
        parts.push('如果返回 status: "fail"，根据 checks 中的错误修正后重新验证。')
        parts.push('如果返回 status: "pass"，回复"验证通过，任务完成"。')
      }

      // 引用强制检查项
      if (v.mandatoryChecks.length > 0) {
        parts.push(`强制质量检查项: ${v.mandatoryChecks.join(', ')}`)
      }
    }

    if (parts.length === 1) return null  // 无实质验证内容
    return parts.join('\n')
  }
}
