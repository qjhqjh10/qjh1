import type { ThinkingPlan, ThinkingStep } from '../state/types'

// ── Engine ──

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

export interface ProgressReport {
  totalSteps: number
  completed: number
  failed: number
  pending: number
  percentComplete: number
  currentStep: ThinkingStep | null
}

export class ThinkingEngine {
  /**
   * Parse thinking plan from AI response text.
   * Supports two formats:
   * 1. New: ```thinking ... JSON ... ``` code block
   * 2. Old: [思考计划]...text...[/思考计划] markdown convention
   */
  parseFromResponse(text: string): ThinkingPlan | null {
    const jsonMatch = text.match(/```thinking\s*([\s\S]*?)```/)
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1])
        return this.normalizePlan(parsed)
      } catch { /* fall through to markdown format */ }
    }

    const markdownMatch = text.match(/\[思考计划\]([\s\S]*?)\[\/思考计划\]/)
    if (markdownMatch) {
      return this.parseMarkdownPlan(markdownMatch[1])
    }

    return null
  }

  private normalizePlan(raw: Record<string, unknown>): ThinkingPlan {
    const steps = Array.isArray(raw.steps) ? raw.steps.map((s: Record<string, unknown>, i: number) => ({
      id: String(s.id || `step_${i}`),
      tool: String(s.tool || ''),
      action: String(s.action || ''),
      args: (s.args as Record<string, unknown>) || {},
      expectedOutcome: String(s.expectedOutcome || ''),
      status: 'pending' as const,
      retryCount: 0,
      approvalStatus: 'pending' as const,
      userFeedback: undefined,
    })) : []

    const neededTools: string[] = (Array.isArray(raw.neededTools) && raw.neededTools.length > 0)
      ? raw.neededTools.map(String).filter(t => t.length > 0)
      : [...new Set(steps.map(s => s.tool))]

    return {
      intent: String(raw.intent || ''),
      steps,
      neededTools,
      estimatedTokens: Number(raw.estimatedTokens) || 0,
      dependencies: Array.isArray(raw.dependencies) ? raw.dependencies as number[][] : [],
    }
  }

  private parseMarkdownPlan(text: string): ThinkingPlan {
    const lines = text.trim().split('\n').filter(l => l.trim())
    const steps: ThinkingStep[] = lines.map((line, i) => {
      const cleaned = line.replace(/^[\d]+[\.\)、]\s*/, '').trim()
      const toolMatch = cleaned.match(/^(\w+)[:：]/)
      return {
        id: `step_${i}`,
        tool: toolMatch?.[1] || 'unknown',
        action: cleaned,
        args: {},
        expectedOutcome: '',
        status: 'pending' as const,
        retryCount: 0,
        approvalStatus: 'pending' as const,
      }
    })
    return {
      intent: text.slice(0, 200),
      steps,
      neededTools: [...new Set(steps.map(s => s.tool))],
      estimatedTokens: 0,
      dependencies: [],
    }
  }

  validate(plan: ThinkingPlan, availableTools: Set<string>): ValidationResult {
    const errors: string[] = []
    for (const step of plan.steps) {
      if (!availableTools.has(step.tool)) {
        errors.push(`步骤 "${step.action}": 工具 "${step.tool}" 不可用`)
      }
    }
    if (plan.steps.length === 0) {
      errors.push('思考计划为空')
    }
    return { valid: errors.length === 0, errors }
  }

  trackProgress(plan: ThinkingPlan): ProgressReport {
    const totalSteps = plan.steps.length
    const completed = plan.steps.filter(s => s.status === 'completed').length
    const failed = plan.steps.filter(s => s.status === 'failed').length
    const pending = plan.steps.filter(s => s.status === 'pending' || s.status === 'in_progress').length
    const current = plan.steps.find(s => s.status === 'in_progress') || null

    return {
      totalSteps,
      completed,
      failed,
      pending,
      percentComplete: totalSteps > 0 ? Math.round((completed / totalSteps) * 100) : 0,
      currentStep: current,
    }
  }

  generateSystemInject(plan: ThinkingPlan): string {
    if (plan.steps.length === 0) return ''
    const steps = plan.steps.map((s, i) => `${i + 1}. ${s.action} [${s.tool}]`).join('\n')
    return [
      `[当前计划] 目标: ${plan.intent}`,
      `执行步骤:\n${steps}`,
      '状态: ' + this.trackProgress(plan).percentComplete + '% 完成',
    ].join('\n')
  }

  // ── Plan enforcement ──

  /**
   * Find the matching plan step for a tool call.
   * Returns null if the tool call is not in the plan (deviation).
   */
  findMatchingStep(plan: ThinkingPlan, toolName: string, args: Record<string, unknown>): ThinkingStep | null {
    return plan.steps.find(s => {
      if (s.tool !== toolName) return false
      const planFilePath = String(s.args?.['file_path'] ?? s.args?.['path'] ?? '')
      const callFilePath = String(args?.['file_path'] ?? args?.['path'] ?? '')
      if (planFilePath && callFilePath) {
        return planFilePath.includes(callFilePath) || callFilePath.includes(planFilePath)
      }
      return true
    }) ?? null
  }

  /**
   * Build the plan enforcement system inject for API context after plan approval.
   */
  buildPlanEnforcementInject(plan: ThinkingPlan): string {
    const approved = plan.steps.filter(s => s.approvalStatus === 'approved')
    const rejected = plan.steps.filter(s => s.approvalStatus === 'rejected')

    const parts: string[] = [
      '[计划执行] 以下已批准的计划步骤必须执行，不得执行计划外的操作:',
      ...approved.map((s, i) =>
        `${i + 1}. [${s.tool}] ${s.action} → 预期结果: ${s.expectedOutcome}`),
    ]

    if (rejected.length > 0) {
      parts.push('\n以下步骤已被用户拒绝，必须跳过:')
      rejected.forEach(s =>
        parts.push(`- [${s.tool}] ${s.action}: ${s.userFeedback || '用户未提供原因'}`))
    }

    parts.push('\n严格遵循批准的计划。如需偏离，在回复中说明原因并请求批准新步骤。')
    return parts.join('\n')
  }

  /**
   * Generate the plan-first instruction injected before the first API call.
   */
  generatePlanPrompt(): string {
    return [
      '[执行前规划] 在采取任何行动前，请先输出一个结构化的执行计划（不要同时调用工具）。',
      '使用以下 JSON 格式，包裹在 ```thinking 代码块中:',
      '```thinking',
      JSON.stringify({
        intent: '用户意图的一句话描述',
        steps: [
          {
            id: 'step_1',
            tool: '工具名称',
            action: '描述要做什么',
            args: { file_path: '相对文件路径' },
            expectedOutcome: '预期的结果',
          },
        ],
        neededTools: ['read_file', 'edit_file'],
        dependencies: [],
        estimatedTokens: 500,
      }, null, 2),
      '```',
      '注意:',
      '- 先输出计划，等待用户批准后再执行（不要在同一轮回复中既输出计划又调用工具）',
      '- 如果是问候、闲聊等不需要工具的消息，直接回复即可，不需要输出计划',
      '- 计划中的每个步骤应该是独立可执行的具体工具调用',
    ].join('\n')
  }
}
