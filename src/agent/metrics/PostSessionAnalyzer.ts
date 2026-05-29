// ── Post-Session Analyzer ──
// Runs after each agent session to produce structured feedback.
// Integrates MetricsCollector + FailureTaxonomy + LivingSkillManager.

import { MetricsCollector } from './MetricsCollector'
import { FailureTaxonomy } from '../evaluators/FailureTaxonomy'
import type { AuditTrail } from '../audit/AuditTrail'
import type { LivingSkillManager } from '../living-skills/LivingSkillManager'
import type { ToolResult } from '../runtime/AgentRuntime'

export interface PostSessionReport {
  sessionId: string
  timestamp: number
  toolSummary: { successes: number; failures: number; hallucinations: number }
  failureCategories: Record<string, number>
  newSkills: string[]
  repeatedErrors: Array<{ toolName: string; count: number }>
  suggestions: string[]
  metricsSnapshot: {
    toolSuccessRate: number
    iterationCycles: number
    totalTokens: number
    trend: string
  }
}

export class PostSessionAnalyzer {
  private metrics: MetricsCollector
  private taxonomy = new FailureTaxonomy()

  constructor(metricsCollector?: MetricsCollector) {
    this.metrics = metricsCollector || new MetricsCollector()
  }

  async analyze(
    sessionId: string,
    auditTrail: AuditTrail,
    toolResults: ToolResult[],
    livingSkills: LivingSkillManager,
  ): Promise<PostSessionReport> {
    const events = auditTrail.getEvents()

    // Collect metrics
    const sessionMetrics = this.metrics.collect(events, sessionId)
    const aggregate = this.metrics.getAggregate(20)

    // Classify failures
    const failures = this.taxonomy.classifyBatch(toolResults)
    const failureCategories: Record<string, number> = {}
    for (const f of failures) {
      failureCategories[f.category] = (failureCategories[f.category] || 0) + 1
    }

    // Check for repeated errors
    const toolErrorMap = new Map<string, number>()
    for (const r of toolResults) {
      if (r.status === 'error') {
        const toolName = r.summary.split(':')[0] || 'unknown'
        toolErrorMap.set(toolName, (toolErrorMap.get(toolName) || 0) + 1)
      }
    }
    const repeatedErrors = [...toolErrorMap.entries()]
      .filter(([, count]) => count >= 2)
      .map(([toolName, count]) => ({ toolName, count }))

    // Get newly promoted skills
    const allSkills = livingSkills.getAll()
    const newSkills = allSkills
      .filter(s => s.promotedAt && s.promotedAt > Date.now() - 600000) // promoted in last 10 min
      .map(s => s.title)

    // Generate suggestions
    const suggestions: string[] = []

    if (sessionMetrics.toolFailures > sessionMetrics.toolSuccesses) {
      suggestions.push('本次会话失败率 > 50%，建议回顾工具参数是否正确')
    }

    if (sessionMetrics.hallucinationTriggers > 0) {
      suggestions.push(`检测到 ${sessionMetrics.hallucinationTriggers} 次幻觉，检查 HallucinationDetector 规则`)
    }

    if (repeatedErrors.length > 0) {
      suggestions.push(`重复错误: ${repeatedErrors.map(e => `${e.toolName}(×${e.count})`).join(', ')}`)
    }

    if (aggregate.trend === 'declining') {
      suggestions.push('⚠️ Agent 成功率呈下降趋势，建议审查最近的变更')
    }

    if (sessionMetrics.iterationCycles > 5) {
      suggestions.push(`迭代轮次 ${sessionMetrics.iterationCycles} 偏高，考虑优化任务拆分`)
    }

    return {
      sessionId,
      timestamp: Date.now(),
      toolSummary: {
        successes: sessionMetrics.toolSuccesses,
        failures: sessionMetrics.toolFailures,
        hallucinations: sessionMetrics.hallucinationTriggers,
      },
      failureCategories,
      newSkills,
      repeatedErrors,
      suggestions,
      metricsSnapshot: {
        toolSuccessRate: aggregate.avgToolSuccessRate,
        iterationCycles: sessionMetrics.iterationCycles,
        totalTokens: sessionMetrics.totalTokens,
        trend: aggregate.trend,
      },
    }
  }

  getMetricsCollector(): MetricsCollector {
    return this.metrics
  }
}
