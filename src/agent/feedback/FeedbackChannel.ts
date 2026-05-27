// ── Feedback Channel ──
// Structured pathway from Sensors back to Guides.
// When metrics cross thresholds, auto-generate suggestions written to .aiharness/feedback/

import type { AggregateMetrics } from '../metrics/MetricsCollector'

export interface FeedbackSuggestion {
  id: string
  timestamp: number
  trigger: string          // Which metric triggered this
  currentValue: number
  threshold: number
  summary: string
  suggestion: string
  targetFile: string       // Which Guide file to update
  severity: 'info' | 'warn' | 'critical'
}

const THRESHOLDS = {
  toolSuccessRate: { min: 0.5, severity: 'critical' as const, file: 'golden-rules.md' },
  hallucinationRate: { max: 0.5, severity: 'warn' as const, file: 'golden-rules.md' },
  firstPassRate: { min: 0.3, severity: 'warn' as const, file: 'CLAUDE.md' },
  avgIterationCycles: { max: 5, severity: 'warn' as const, file: 'CLAUDE.md' },
}

export class FeedbackChannel {
  private suggestions: FeedbackSuggestion[] = []
  private maxSuggestions = 50

  /** Check metrics against thresholds and generate feedback */
  check(metrics: AggregateMetrics): FeedbackSuggestion[] {
    const newSuggestions: FeedbackSuggestion[] = []

    const checks: Array<{
      trigger: string; currentValue: number; threshold: number
      file: string; severity: 'info' | 'warn' | 'critical'
      summary: string; suggestion: string
    }> = []

    if (metrics.avgToolSuccessRate < THRESHOLDS.toolSuccessRate.min) {
      checks.push({
        trigger: 'toolSuccessRate',
        currentValue: metrics.avgToolSuccessRate,
        threshold: THRESHOLDS.toolSuccessRate.min,
        file: THRESHOLDS.toolSuccessRate.file,
        severity: THRESHOLDS.toolSuccessRate.severity,
        summary: '工具成功率低于阈值',
        suggestion: '检查工具描述是否需要更新。检查 FailureTaxonomy 中最常见的失败类别。考虑增强 read_file 在写操作前的使用规范。',
      })
    }

    if (metrics.hallucinationRate > THRESHOLDS.hallucinationRate.max) {
      checks.push({
        trigger: 'hallucinationRate',
        currentValue: metrics.hallucinationRate,
        threshold: THRESHOLDS.hallucinationRate.max,
        file: THRESHOLDS.hallucinationRate.file,
        severity: THRESHOLDS.hallucinationRate.severity,
        summary: '幻觉率升高',
        suggestion: '增强 HallucinationDetector 规则，增加更严格的行动声明检测。考虑在系统提示词中强调"没有工具调用就没有操作完成"。',
      })
    }

    if (metrics.firstPassRate < THRESHOLDS.firstPassRate.min && metrics.totalSessions >= 5) {
      checks.push({
        trigger: 'firstPassRate',
        currentValue: metrics.firstPassRate,
        threshold: THRESHOLDS.firstPassRate.min,
        file: THRESHOLDS.firstPassRate.file,
        severity: THRESHOLDS.firstPassRate.severity,
        summary: '首次通过率偏低',
        suggestion: '可能需要调整工具参数 schema 或增强系统提示词中的操作流程描述。',
      })
    }

    if (metrics.avgIterationCycles > THRESHOLDS.avgIterationCycles.max) {
      checks.push({
        trigger: 'avgIterationCycles',
        currentValue: metrics.avgIterationCycles,
        threshold: THRESHOLDS.avgIterationCycles.max,
        file: THRESHOLDS.avgIterationCycles.file,
        severity: THRESHOLDS.avgIterationCycles.severity,
        summary: '平均迭代轮次偏高',
        suggestion: '任务可能过于复杂。考虑在初始 prompt 中提供更清晰的步骤分解。',
      })
    }

    for (const c of checks) {
      const s: FeedbackSuggestion = {
        id: `fb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        timestamp: Date.now(),
        trigger: c.trigger,
        currentValue: c.currentValue,
        threshold: c.threshold,
        summary: c.summary,
        suggestion: c.suggestion,
        targetFile: c.file,
        severity: c.severity,
      }
      this.suggestions.push(s)
      newSuggestions.push(s)
    }

    // Trim old suggestions
    if (this.suggestions.length > this.maxSuggestions) {
      this.suggestions = this.suggestions.slice(-this.maxSuggestions)
    }

    return newSuggestions
  }

  /** Persist suggestions to .aiharness/feedback/auto-suggestions.md */
  async persistNewSuggestions(newSuggestions: FeedbackSuggestion[]): Promise<void> {
    if (newSuggestions.length === 0) return

    const content = this.buildMarkdown(newSuggestions)
    try {
      const { fileService } = await import('@/services/fileService')
      const filePath = '.aiharness/feedback/auto-suggestions.md'
      await fileService.ensureDir('.aiharness/feedback')
      // Read existing, keep only last 5 sections to prevent unbounded growth
      let existing = ''
      try {
        existing = await fileService.read(filePath)
        const sections = existing.split('## 自动反馈')
        if (sections.length > 6) {
          existing = '## 自动反馈' + sections.slice(-5).join('## 自动反馈')
        }
      } catch { /* new file */ }
      await fileService.write(filePath, existing + '\n\n' + content)
    } catch { /* persist failure is non-fatal */ }
  }

  private buildMarkdown(suggestions: FeedbackSuggestion[]): string {
    const now = new Date().toISOString()
    const lines = [
      `## 自动反馈 — ${now}`,
      '',
      ...suggestions.map(s => [
        `### ${s.severity.toUpperCase()}: ${s.summary}`,
        '',
        `- **指标**: ${s.trigger} = ${s.currentValue.toFixed(3)} (阈值: ${s.threshold})`,
        `- **目标文件**: ${s.targetFile}`,
        `- **建议**: ${s.suggestion}`,
        '',
      ].join('\n')),
    ]
    return lines.join('\n')
  }

  getSuggestions(): readonly FeedbackSuggestion[] {
    return this.suggestions
  }

  get recentCount(): number {
    return this.suggestions.length
  }
}
