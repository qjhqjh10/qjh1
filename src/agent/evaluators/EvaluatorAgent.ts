// ── Independent Evaluator Agent ──
// Critical Anthropic finding: evaluation must run in a SEPARATE agent instance
// with restricted tools (read-only). Never self-evaluate.

import type { Message, ToolResult } from '../runtime/AgentRuntime'

export interface EvaluationIssue {
  severity: 'critical' | 'major' | 'minor' | 'info'
  description: string
  location?: string
  suggestion: string
}

export interface EvaluationDimension {
  name: 'correctness' | 'quality' | 'architecture' | 'security'
  score: number           // 0.0 - 1.0
  passThreshold: number
  passed: boolean
  issues: EvaluationIssue[]
}

export interface EvaluationReport {
  timestamp: number
  duration: number
  overallPassed: boolean
  dimensions: EvaluationDimension[]
  summary: string
  tokenCost: number
}

const EVALUATOR_SYSTEM_PROMPT = `你是一个独立的评估 Agent。你的任务是评估主 Agent 的工作质量。
你只能读取文件，不能创建、修改或删除任何内容。

评估 4 个维度，每个维度评分 0.0-1.0:
1. **correctness** (正确性): 任务是否按要求完成？文件是否正确创建/修改？JSON 格式是否有效？
2. **quality** (质量): 输出是否完整？文字是否连贯？格式是否符合规范？
3. **architecture** (架构): 是否使用了正确的工具？文件位置是否符合项目结构？是否遵循了最佳实践？
4. **security** (安全): 是否有路径遍历？是否操作了不应操作的文件？是否有敏感信息泄露？

对每个维度列出具体问题（如有），给出严重程度和建议。
最后输出 JSON 格式的评估报告。`

const DEFAULT_THRESHOLDS: Record<string, number> = {
  correctness: 0.7, quality: 0.6, architecture: 0.5, security: 0.8,
}

export class EvaluatorAgent {
  private configId: string
  private projectId: string | null

  constructor(configId: string, projectId: string | null) {
    this.configId = configId
    this.projectId = projectId
  }

  async evaluate(
    mainAgentMessages: Message[],
    mainAgentResults: ToolResult[],
  ): Promise<EvaluationReport> {
    const startTime = Date.now()

    const successCount = mainAgentResults.filter(r => r.status === 'success').length
    const failureCount = mainAgentResults.filter(r => r.status === 'error').length

    // Heuristic evaluation (lightweight, no API call required)
    // Full AI-based evaluation would use SubAgentManager infrastructure
    const dimensions: EvaluationDimension[] = [
      this.evaluateCorrectness(mainAgentResults, mainAgentMessages),
      this.evaluateQuality(mainAgentResults),
      this.evaluateArchitecture(mainAgentResults),
      this.evaluateSecurity(mainAgentResults),
    ]

    const overallPassed = dimensions.every(d => d.passed)
    const summary = overallPassed
      ? `全部 ${dimensions.length} 维评估通过 (${successCount} 成功, ${failureCount} 失败)`
      : `${dimensions.filter(d => !d.passed).length}/${dimensions.length} 维未通过`

    return {
      timestamp: Date.now(),
      duration: Date.now() - startTime,
      overallPassed,
      dimensions,
      summary,
      tokenCost: 0, // heuristic evaluation uses no tokens
    }
  }

  private evaluateCorrectness(results: ToolResult[], messages: Message[]): EvaluationDimension {
    const issues: EvaluationIssue[] = []
    const total = results.length
    const errors = results.filter(r => r.status === 'error').length
    const score = total > 0 ? (total - errors) / total : 1.0

    for (const r of results) {
      if (r.status === 'error') {
        issues.push({
          severity: 'major',
          description: r.summary,
          suggestion: '检查工具参数和文件路径后重试',
        })
      }
    }

    const lastMsg = messages.filter(m => m.role === 'assistant').pop()
    if (lastMsg && !lastMsg.content?.trim()) {
      issues.push({
        severity: 'minor',
        description: 'AI 最终回复为空',
        suggestion: '确保 AI 在操作完成后提供回复',
      })
    }

    return {
      name: 'correctness',
      score, passThreshold: DEFAULT_THRESHOLDS.correctness,
      passed: score >= DEFAULT_THRESHOLDS.correctness,
      issues,
    }
  }

  private evaluateQuality(results: ToolResult[]): EvaluationDimension {
    const issues: EvaluationIssue[] = []
    let score = 1.0

    for (const r of results) {
      if (r.status === 'success' && r.detail) {
        if (r.detail.includes('截断') || r.detail.includes('省略')) {
          score -= 0.1
          issues.push({
            severity: 'minor',
            description: '输出被截断',
            suggestion: '减少读取量或分批处理',
          })
        }
      }
    }

    return {
      name: 'quality',
      score: Math.max(0, score), passThreshold: DEFAULT_THRESHOLDS.quality,
      passed: score >= DEFAULT_THRESHOLDS.quality,
      issues,
    }
  }

  private evaluateArchitecture(results: ToolResult[]): EvaluationDimension {
    const issues: EvaluationIssue[] = []
    let score = 1.0

    // Check for excessive read operations (inefficiency)
    const readOps = results.filter(r => r.summary.includes('读取') || r.summary.includes('列出'))
    if (readOps.length > 10) {
      score -= 0.2
      issues.push({
        severity: 'minor',
        description: `执行了 ${readOps.length} 次读取操作，可能过多`,
        suggestion: '使用更精确的路径直接读取目标文件',
      })
    }

    return {
      name: 'architecture',
      score: Math.max(0, score), passThreshold: DEFAULT_THRESHOLDS.architecture,
      passed: score >= DEFAULT_THRESHOLDS.architecture,
      issues,
    }
  }

  private evaluateSecurity(results: ToolResult[]): EvaluationDimension {
    const issues: EvaluationIssue[] = []
    let score = 1.0

    for (const r of results) {
      if (r.summary.includes('路径不在项目') || r.summary.includes('Invalid path')) {
        score -= 0.3
        issues.push({
          severity: 'critical',
          description: '检测到路径遍历尝试',
          suggestion: '仅操作项目目录内的文件',
        })
      }
    }

    return {
      name: 'security',
      score: Math.max(0, score), passThreshold: DEFAULT_THRESHOLDS.security,
      passed: score >= DEFAULT_THRESHOLDS.security,
      issues,
    }
  }
}
