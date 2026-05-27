// ── Structured Thinking Protocol ──

export interface ThinkingStep {
  id: string
  tool: string
  action: string
  args: Record<string, unknown>
  expectedOutcome: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  retryCount: number
}

export interface ThinkingPlan {
  intent: string
  steps: ThinkingStep[]
  estimatedTokens: number
  dependencies: number[][] // step indices: which steps depend on which
}

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

// ── Engine ──

export class ThinkingEngine {
  /**
   * Parse thinking plan from AI response text.
   * Supports two formats:
   * 1. Old: [思考计划]...text...[/思考计划] markdown convention
   * 2. New: ```thinking ... JSON ... ``` code block
   */
  parseFromResponse(text: string): ThinkingPlan | null {
    // Try JSON format first
    const jsonMatch = text.match(/```thinking\s*([\s\S]*?)```/)
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1])
        return this.normalizePlan(parsed)
      } catch { /* fall through to markdown format */ }
    }

    // Fallback: parse markdown convention
    const markdownMatch = text.match(/\[思考计划\]([\s\S]*?)\[\/思考计划\]/)
    if (markdownMatch) {
      return this.parseMarkdownPlan(markdownMatch[1])
    }

    return null
  }

  private normalizePlan(raw: Record<string, unknown>): ThinkingPlan {
    return {
      intent: String(raw.intent || ''),
      steps: Array.isArray(raw.steps) ? raw.steps.map((s: Record<string, unknown>, i: number) => ({
        id: String(s.id || `step_${i}`),
        tool: String(s.tool || ''),
        action: String(s.action || ''),
        args: (s.args as Record<string, unknown>) || {},
        expectedOutcome: String(s.expectedOutcome || ''),
        status: 'pending' as const,
        retryCount: 0,
      })) : [],
      estimatedTokens: Number(raw.estimatedTokens) || 0,
      dependencies: Array.isArray(raw.dependencies) ? raw.dependencies as number[][] : [],
    }
  }

  private parseMarkdownPlan(text: string): ThinkingPlan {
    const lines = text.trim().split('\n').filter(l => l.trim())
    const steps: ThinkingStep[] = lines.map((line, i) => {
      const cleaned = line.replace(/^[\d]+[\.\)、]\s*/, '').trim()
      // Try to extract tool name from line like "read_file: 读取大纲"
      const toolMatch = cleaned.match(/^(\w+)[:：]/)
      return {
        id: `step_${i}`,
        tool: toolMatch?.[1] || 'unknown',
        action: cleaned,
        args: {},
        expectedOutcome: '',
        status: 'pending' as const,
        retryCount: 0,
      }
    })
    return {
      intent: text.slice(0, 200),
      steps,
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
}
