// ── Independent Evaluator Agent ──
// Two-layer evaluation:
//   Layer 1 — fast heuristic (always runs)
//   Layer 2 — LLM deep evaluation (only when Layer 1 score < threshold)
//
// Critical principle: evaluation must run in a SEPARATE context with
// read-only tools. Never self-evaluate.

import type { Message, ToolResult } from '../runtime/AgentRuntime'
import { EVALUATION_SYSTEM_PROMPT, EVALUATION_USER_PROMPT } from './prompts/evaluationPrompt'

export interface EvaluationIssue {
  severity: 'critical' | 'major' | 'minor' | 'info'
  description: string
  location?: string
  suggestion: string
}

export interface EvaluationDimension {
  name: 'correctness' | 'quality' | 'architecture' | 'security'
  score: number
  passThreshold: number
  passed: boolean
  issues: EvaluationIssue[]
}

export interface EvaluationReport {
  timestamp: number
  duration: number
  overallPassed: boolean
  overallScore: number
  dimensions: EvaluationDimension[]
  summary: string
  tokenCost: number
  layer: 'heuristic' | 'llm'
}

interface AIServiceForEval {
  chat(messages: Array<{ role: string; content: string }>): Promise<{ text: string; usage?: { total_tokens: number } }>
}

const DEFAULT_THRESHOLDS: Record<string, number> = {
  correctness: 0.7, quality: 0.6, architecture: 0.5, security: 0.8,
}

const DIMENSION_WEIGHTS: Record<string, number> = {
  correctness: 0.4, quality: 0.25, architecture: 0.2, security: 0.15,
}

// ═══════════════════════════════════════════════════════════════
// EvaluatorAgent
// ═══════════════════════════════════════════════════════════════

export class EvaluatorAgent {
  private llmTriggerThreshold = 0.6  // Overall score below this → trigger LLM evaluation
  private aiService: AIServiceForEval | null = null

  setAIService(svc: AIServiceForEval): void {
    this.aiService = svc
  }

  setLLMThreshold(t: number): void {
    this.llmTriggerThreshold = t
  }

  // ── Layer 1: Heuristic Evaluation ──

  async evaluateHeuristic(
    results: ToolResult[],
    messages: Message[],
  ): Promise<EvaluationReport> {
    const startTime = Date.now()

    const dimensions: EvaluationDimension[] = [
      this.evalCorrectness(results, messages),
      this.evalQuality(results),
      this.evalArchitecture(results),
      this.evalSecurity(results),
    ]

    const overallScore = dimensions.reduce(
      (sum, d) => sum + d.score * (DIMENSION_WEIGHTS[d.name] || 0.25), 0,
    )
    const overallPassed = dimensions.every(d => d.passed)

    return {
      timestamp: Date.now(),
      duration: Date.now() - startTime,
      overallPassed,
      overallScore: Math.round(overallScore * 100) / 100,
      dimensions,
      summary: overallPassed
        ? `全部 ${dimensions.length} 维通过`
        : `${dimensions.filter(d => !d.passed).length}/${dimensions.length} 维未通过`,
      tokenCost: 0,
      layer: 'heuristic',
    }
  }

  // ── Layer 2: LLM Deep Evaluation ──

  async evaluateLLM(
    heuristicReport: EvaluationReport,
    taskDescription: string,
    toolResults: ToolResult[],
  ): Promise<EvaluationReport> {
    const startTime = Date.now()
    if (!this.aiService) {
      // Fall back to heuristic
      heuristicReport.summary += ' (LLM评估不可用，使用启发式结果)'
      return heuristicReport
    }

    try {
      // Collect file contents from successful read operations
      const fileContents = toolResults
        .filter(r => r.status === 'success' && r.detail)
        .map(r => `### ${r.summary}\n${r.detail}`)
        .join('\n\n')

      const messages = [
        { role: 'system', content: EVALUATION_SYSTEM_PROMPT },
        { role: 'user', content: EVALUATION_USER_PROMPT(taskDescription, fileContents) },
      ]

      const response = await this.aiService.chat(messages)

      // Parse JSON from response
      const jsonMatch = response.text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        heuristicReport.summary += ' (LLM评估格式异常，使用启发式结果)'
        return heuristicReport
      }

      const parsed = JSON.parse(jsonMatch[0])

      const dimensions: EvaluationDimension[] = (parsed.dimensions || []).map((d: any) => ({
        name: d.name as EvaluationDimension['name'],
        score: Number(d.score) || 0,
        passThreshold: Number(d.passThreshold) || DEFAULT_THRESHOLDS[d.name] || 0.7,
        passed: Boolean(d.passed),
        issues: (d.issues || []).map((i: any) => ({
          severity: i.severity || 'minor',
          description: String(i.description || ''),
          suggestion: String(i.suggestion || ''),
        })),
      }))

      const overallScore = dimensions.reduce(
        (sum, d) => sum + d.score * (DIMENSION_WEIGHTS[d.name] || 0.25), 0,
      )

      return {
        timestamp: Date.now(),
        duration: Date.now() - startTime,
        overallPassed: Boolean(parsed.overallPassed),
        overallScore: Math.round(overallScore * 100) / 100,
        dimensions,
        summary: String(parsed.summary || ''),
        tokenCost: response.usage?.total_tokens || 0,
        layer: 'llm',
      }
    } catch {
      heuristicReport.summary += ' (LLM评估失败，使用启发式结果)'
      return heuristicReport
    }
  }

  // ── Combined: two-layer evaluation ──

  async evaluate(
    results: ToolResult[],
    messages: Message[],
    taskDescription: string,
  ): Promise<EvaluationReport> {
    const heuristic = await this.evaluateHeuristic(results, messages)

    // If heuristic score is low, trigger LLM evaluation
    if (heuristic.overallScore < this.llmTriggerThreshold && this.aiService) {
      return this.evaluateLLM(heuristic, taskDescription, results)
    }

    return heuristic
  }

  // ═══════════════════════════════════════════════════════
  // Dimension Evaluators
  // ═══════════════════════════════════════════════════════

  private evalCorrectness(results: ToolResult[], messages: Message[]): EvaluationDimension {
    const issues: EvaluationIssue[] = []
    const total = results.length
    const errors = results.filter(r => r.status === 'error').length
    const score = total > 0 ? Math.max(0, (total - errors) / total) : 1.0

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

  private evalQuality(results: ToolResult[]): EvaluationDimension {
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

  private evalArchitecture(results: ToolResult[]): EvaluationDimension {
    const issues: EvaluationIssue[] = []
    let score = 1.0

    const readOps = results.filter(r =>
      r.summary.includes('读取') || r.summary.includes('列出') || r.summary.includes('搜索'),
    )
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

  private evalSecurity(results: ToolResult[]): EvaluationDimension {
    const issues: EvaluationIssue[] = []
    let score = 1.0

    for (const r of results) {
      if (r.summary.includes('路径不在项目') || r.summary.includes('Invalid path')
        || r.summary.includes('路径超出') || r.summary.includes('约束阻断')) {
        score -= 0.3
        issues.push({
          severity: 'critical',
          description: '检测到路径遍历尝试或约束违反',
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
