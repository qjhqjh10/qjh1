/**
 * AgentOrchestrator — Multi-Agent Collaboration Pipeline
 *
 * Orchestrates a 4-agent workflow:
 *   Intent Agent → Plan Agent → Execute Agent → Review Agent
 *
 * Each agent is a SubAgent with isolated context, scoped tools, and a focused prompt.
 * The orchestrator manages state transitions, tool expansion loops, and approval gates.
 */

import { SubAgentManager, type SubAgentResult } from '../subagents/SubAgentManager'
import type { ThinkingPlan, ThinkingStep } from '../state/types'

// ── Types ──

export type OrchestratorPhase =
  | 'idle'
  | 'intent'
  | 'planning'
  | 'awaiting_approval'
  | 'executing'
  | 'reviewing'
  | 'done'

export interface IntentResult {
  intent: string
  category: string
  complexity: 'simple' | 'moderate' | 'complex'
  goal: string
  toolCategories: string[]
  needsPlan: boolean
  directResponse: string | null
}

export interface ExecResult {
  finalOutput: string
  toolCalls: number
  tokenCost: number
  needsMoreTools: boolean
  missingTools: string[]
  filesChanged: string[]
}

export interface ReviewResult {
  passed: boolean
  score: number
  issues: string[]
  suggestions: string[]
  needRetry: boolean
}

export interface OrchestratorResult {
  text: string
  phase: OrchestratorPhase
  plan: ThinkingPlan | null
  review: ReviewResult | null
  totalTokens: number
  totalToolCalls: number
}

export interface OrchestratorOptions {
  onApprovalRequired?: (steps: Array<{ name: string; args: Record<string, unknown> }>) => Promise<boolean>
  onPhaseChange?: (phase: OrchestratorPhase, agentName?: string) => void
}

// ── Constants ──

/** Core read tools always included in every phase */
const CORE_READ_TOOLS = ['read_file', 'list_directory', 'search_files', 'search_content']

/** Maximum iterations for the execute→review→replan loop */
const MAX_RETRY_LOOPS = 2

// ── Orchestrator ──

export class AgentOrchestrator {
  private subAgentMgr: SubAgentManager
  private phase: OrchestratorPhase = 'idle'

  constructor(subAgentMgr: SubAgentManager) {
    this.subAgentMgr = subAgentMgr
  }

  get currentPhase(): OrchestratorPhase {
    return this.phase
  }

  /**
   * Plan-only mode: runs Intent + Plan agents, returns the plan without executing.
   * Used by AgentChatBridge to get intelligent tool selection without double execution.
   */
  async analyzeOnly(
    userMessage: string,
    configId: string,
    projectId: string | null,
    options: OrchestratorOptions = {},
  ): Promise<{ plan: ThinkingPlan | null; totalTokens: number; totalToolCalls: number }> {
    let totalTokens = 0
    let totalToolCalls = 0

    this.setPhase('intent', 'intent-analyzer', options)
    const intent = await this.runIntentAgent(userMessage, configId, projectId)
    totalTokens += intent.tokenCost
    totalToolCalls += intent.toolCalls

    if (!intent.structuredOutput?.needsPlan) {
      this.setPhase('done', undefined, options)
      return { plan: null, totalTokens, totalToolCalls }
    }

    this.setPhase('planning', 'plan-designer', options)
    const planResult = await this.runPlanAgent(
      intent.structuredOutput as unknown as IntentResult,
      userMessage, configId, projectId,
    )
    totalTokens += planResult.tokenCost
    totalToolCalls += planResult.toolCalls

    this.setPhase('done', undefined, options)
    return { plan: planResult.plan, totalTokens, totalToolCalls }
  }

  // ── Full Pipeline Entry Point ──

  async process(
    userMessage: string,
    configId: string,
    projectId: string | null,
    options: OrchestratorOptions = {},
  ): Promise<OrchestratorResult> {
    let totalTokens = 0
    let totalToolCalls = 0
    let finalPlan: ThinkingPlan | null = null
    let finalReview: ReviewResult | null = null

    // ── Phase 1: Intent Analysis ──
    this.setPhase('intent', 'intent-analyzer', options)
    const intent = await this.runIntentAgent(userMessage, configId, projectId)
    totalTokens += intent.tokenCost
    totalToolCalls += intent.toolCalls

    // Simple chat: Intent Agent handles it directly
    if (!intent.structuredOutput?.needsPlan) {
      const reply = (intent.structuredOutput?.directResponse as string) || intent.output || '好的，我理解了。'
      this.setPhase('done', undefined, options)
      return {
        text: reply,
        phase: 'done',
        plan: null,
        review: null,
        totalTokens,
        totalToolCalls,
      }
    }

    // ── Phase 2: Plan Design ──
    this.setPhase('planning', 'plan-designer', options)
    const plan = await this.runPlanAgent(
      (intent.structuredOutput as unknown as IntentResult),
      userMessage,
      configId,
      projectId,
    )
    totalTokens += plan.tokenCost
    totalToolCalls += plan.toolCalls
    finalPlan = plan.plan

    if (!finalPlan || finalPlan.steps.length === 0) {
      this.setPhase('done', undefined, options)
      return {
        text: plan.output || '无法为此任务生成执行方案。',
        phase: 'done',
        plan: null,
        review: null,
        totalTokens,
        totalToolCalls,
      }
    }

    // ── Phase 3: Approval Gate ──
    this.setPhase('awaiting_approval', undefined, options)
    const canAutoApprove = this.canAutoApprove(finalPlan)
    let approved = canAutoApprove

    if (!canAutoApprove && options.onApprovalRequired) {
      const allSteps = finalPlan.steps.map(s => ({ name: s.tool, args: s.args }))
      try {
        approved = await options.onApprovalRequired(allSteps)
      } catch {
        approved = false
      }
    }

    if (!approved) {
      this.setPhase('done', undefined, options)
      return {
        text: '计划未获批准，操作已取消。',
        phase: 'done',
        plan: finalPlan,
        review: null,
        totalTokens,
        totalToolCalls,
      }
    }

    // ── Phase 4-6: Execute → Review → Loop ──
    let execResult: ExecResult = {
      finalOutput: '',
      toolCalls: 0,
      tokenCost: 0,
      needsMoreTools: false,
      missingTools: [],
      filesChanged: [],
    }
    let reviewResult: ReviewResult = { passed: false, score: 0, issues: [], suggestions: [], needRetry: false }
    let retryCount = 0
    let toolExpansionCount = 0
    const MAX_TOOL_EXPANSIONS = 2

    do {
      // Phase 4: Execute
      this.setPhase('executing', 'plan-executor', options)
      execResult = await this.runExecuteAgent(finalPlan, userMessage, configId, projectId)
      totalTokens += execResult.tokenCost
      totalToolCalls += execResult.toolCalls

      // Handle tool expansion: Execute needs more tools → replan (bounded)
      if (execResult.needsMoreTools && execResult.missingTools.length > 0) {
        if (++toolExpansionCount > MAX_TOOL_EXPANSIONS) {
          break  // Too many expansion attempts, proceed with review
        }
        this.setPhase('planning', 'plan-designer', options)
        const expandedPlan = await this.runPlanAgent(
          { ...(intent.structuredOutput as unknown as IntentResult) },
          `[工具扩展请求] 执行中发现需要以下额外工具: ${execResult.missingTools.join(', ')}。请更新计划。原始意图: ${userMessage}`,
          configId,
          projectId,
        )
        totalTokens += expandedPlan.tokenCost
        totalToolCalls += expandedPlan.toolCalls
        if (expandedPlan.plan) {
          finalPlan = expandedPlan.plan
        }
        continue  // Back to execute with expanded plan
      }

      // Phase 5: Review
      this.setPhase('reviewing', 'result-reviewer', options)
      const review = await this.runReviewAgent(finalPlan, execResult, configId, projectId)
      totalTokens += review.tokenCost
      totalToolCalls += review.toolCalls
      reviewResult = (review.structuredOutput as unknown as ReviewResult) || {
        passed: true, score: 0.8, issues: [], suggestions: [], needRetry: false,
      }
      finalReview = reviewResult
      retryCount++

    } while (reviewResult.needRetry && retryCount < MAX_RETRY_LOOPS)

    this.setPhase('done', undefined, options)

    return {
      text: execResult.finalOutput || plan.output || '任务完成。',
      phase: 'done',
      plan: finalPlan,
      review: finalReview,
      totalTokens,
      totalToolCalls,
    }
  }

  // ── Phase Runners ──

  private async runIntentAgent(
    userMessage: string,
    configId: string,
    projectId: string | null,
  ): Promise<SubAgentResult> {
    const result = await this.subAgentMgr.delegate(
      'intent-analyzer',
      userMessage,
      configId,
      projectId,
      { modelTierOverride: 'cheap' },
    )

    // Try to parse structured output from ```intent code block
    if (result.status === 'success' && result.output) {
      const match = result.output.match(/```intent[\s\S]*?\n([\s\S]*?)```/)
      if (match) {
        try {
          const rawText = match[1].trim()
          const jsonStart = rawText.indexOf('{')
          if (jsonStart >= 0) result.structuredOutput = JSON.parse(rawText.slice(jsonStart))
        } catch { /* fallback: use raw text */ }
      }
    }

    // Fallback: if no structured output, treat as direct response
    if (!result.structuredOutput) {
      result.structuredOutput = {
        intent: userMessage.slice(0, 100),
        category: 'read',
        complexity: 'simple',
        goal: userMessage,
        toolCategories: CORE_READ_TOOLS,
        needsPlan: false,
        directResponse: result.output || '收到。',
      }
    }

    return result
  }

  private async runPlanAgent(
    intent: IntentResult,
    originalMessage: string,
    configId: string,
    projectId: string | null,
  ): Promise<SubAgentResult & { plan: ThinkingPlan | null }> {
    const planInput = [
      `原始用户请求: ${originalMessage}`,
      `意图分析: ${intent.intent}`,
      `类别: ${intent.category} | 复杂度: ${intent.complexity}`,
      `需要的工具类别: ${(intent.toolCategories || []).join(', ')}`,
      '',
      '请基于以上信息设计执行方案。',
    ].join('\n')

    const result = await this.subAgentMgr.delegate(
      'plan-designer',
      planInput,
      configId,
      projectId,
      { modelTierOverride: 'cheap' },
    )

    let plan: ThinkingPlan | null = null
    if (result.status === 'success' && result.output) {
      const match = result.output.match(/```plan[\s\S]*?\n([\s\S]*?)```/)
      if (match) {
        try {
          const rawText = match[1].trim()
          const jsonStart = rawText.indexOf('{')
          const raw = jsonStart >= 0 ? JSON.parse(rawText.slice(jsonStart)) : JSON.parse(rawText)
          plan = {
            intent: intent.intent || originalMessage,
            steps: (raw.steps || []).map((s: Record<string, unknown>, i: number) => ({
              id: String(s.id || `step_${i}`),
              tool: String(s.tool || ''),
              action: String(s.action || ''),
              args: (s.args || {}) as Record<string, unknown>,
              expectedOutcome: String(s.expectedOutcome || ''),
              status: 'pending' as const,
              retryCount: 0,
              approvalStatus: 'pending' as const,
            })),
            neededTools: Array.isArray(raw.neededTools)
              ? raw.neededTools.map(String)
              : [],
            estimatedTokens: Number(raw.estimatedTokens) || 0,
            dependencies: Array.isArray(raw.dependencies) ? raw.dependencies as number[][] : [],
          }
          // Fallback: derive neededTools from steps
          if (plan.neededTools.length === 0) {
            plan.neededTools = [...new Set(plan.steps.map(s => s.tool))]
          }
          result.structuredOutput = raw
        } catch { /* fallback */ }
      }
    }

    return { ...result, plan }
  }

  private async runExecuteAgent(
    plan: ThinkingPlan,
    originalMessage: string,
    configId: string,
    projectId: string | null,
  ): Promise<ExecResult> {
    // Build scoped tool list from plan.neededTools + core reads
    const scopedTools = [...new Set([...plan.neededTools, ...CORE_READ_TOOLS])]

    const stepsText = plan.steps
      .map((s, i) => `${i + 1}. ${s.tool}: ${s.action} → ${s.expectedOutcome}`)
      .join('\n')

    const execInput = [
      `原始任务: ${originalMessage}`,
      `计划意图: ${plan.intent}`,
      '',
      '已批准的执行步骤:',
      stepsText,
      '',
      `可用工具: ${scopedTools.join(', ')}`,
    ].join('\n')

    const result = await this.subAgentMgr.delegate(
      'plan-executor',
      execInput,
      configId,
      projectId,
      {
        modelTierOverride: 'main',
        toolOverride: scopedTools,
      },
    )

    // Detect tool expansion requests
    let needsMoreTools = false
    let missingTools: string[] = []
    if (result.output) {
      const expandMatch = result.output.match(/\[TOOL_EXPAND:\s*([^\]]+)\]/)
      if (expandMatch) {
        needsMoreTools = true
        missingTools = expandMatch[1].split(',').map(t => t.trim()).filter(Boolean)
      }
    }

    return {
      finalOutput: result.output || '',
      toolCalls: result.toolCalls,
      tokenCost: result.tokenCost,
      needsMoreTools,
      missingTools,
      filesChanged: [],
    }
  }

  private async runReviewAgent(
    plan: ThinkingPlan,
    execResult: ExecResult,
    configId: string,
    projectId: string | null,
  ): Promise<SubAgentResult> {
    const stepsText = plan.steps
      .map((s, i) => `${i + 1}. ${s.tool}: ${s.action} → ${s.expectedOutcome}`)
      .join('\n')

    const reviewInput = [
      '请审查以下执行结果是否符合计划预期。',
      '',
      '计划步骤:',
      stepsText,
      '',
      '执行结果:',
      execResult.finalOutput || '(无文本输出)',
      `工具调用: ${execResult.toolCalls}次`,
      '',
      '请读取相关文件验证内容，然后输出审查结论。',
    ].join('\n')

    const result = await this.subAgentMgr.delegate(
      'result-reviewer',
      reviewInput,
      configId,
      projectId,
      { modelTierOverride: 'cheap' },
    )

    // Parse structured review output
    if (result.status === 'success' && result.output) {
      const match = result.output.match(/```review[\s\S]*?\n([\s\S]*?)```/)
      if (match) {
        try {
          const rawText = match[1].trim()
          const jsonStart = rawText.indexOf('{')
          if (jsonStart >= 0) result.structuredOutput = JSON.parse(rawText.slice(jsonStart))
        } catch { /* fallback */ }
      }
    }

    // Default: pass if no explicit review
    if (!result.structuredOutput) {
      result.structuredOutput = {
        passed: true,
        score: 0.8,
        issues: [],
        suggestions: [],
        needRetry: false,
      }
    }

    return result
  }

  // ── Helpers ──

  private setPhase(phase: OrchestratorPhase, agentName: string | undefined, options: OrchestratorOptions): void {
    this.phase = phase
    options.onPhaseChange?.(phase, agentName)
  }

  private canAutoApprove(plan: ThinkingPlan): boolean {
    // Guard: no tools = cannot execute safely
    if (plan.neededTools.length === 0 && plan.steps.length === 0) return false

    const writeTools = new Set([
      'create_file', 'edit_file', 'delete_file', 'rename_file',
      'write_note', 'append_note', 'delete_note',
      'create_project', 'delete_project',
      'kb_create_file', 'kb_append_file',
    ])
    const dangerousTools = new Set([
      'delete_file', 'delete_project', 'delete_note',
      'shell_exec', 'shell_run_script',
    ])

    // Check both neededTools AND steps for dangerous tools
    const hasDangerous = plan.neededTools.some(t => dangerousTools.has(t))
      || plan.steps.some(s => dangerousTools.has(s.tool))
    if (hasDangerous) return false

    const writeStepCount = plan.steps.filter(s => writeTools.has(s.tool)).length
    if (writeStepCount > 2) return false

    return true
  }
}
