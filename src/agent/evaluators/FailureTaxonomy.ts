// ── Failure Taxonomy ──
// Classifies tool failures into 4 root-cause categories.
// Lightweight keyword matching → LLM classification for ambiguous cases.

import type { ToolResult } from '../runtime/AgentRuntime'

export type FailureCategory =
  | 'prompt_design'   // Prompt is unclear, incomplete, or contradictory
  | 'tool_design'     // Tool description inaccurate or parameter schema wrong
  | 'model_limits'    // Model capability boundary (context window, reasoning)
  | 'data_gaps'       // Missing info (file not found, KB no results)

export interface ClassifiedFailure {
  toolName: string
  error: string
  category: FailureCategory
  confidence: number       // 0.0 - 1.0
  suggestedFix: string
  feedbackTarget: 'prompt' | 'tool_schema' | 'context' | 'kb' | 'unknown'
}

const CATEGORY_PATTERNS: Array<{ category: FailureCategory; patterns: RegExp[] }> = [
  {
    category: 'data_gaps',
    patterns: [
      /不存在|not found|找不到|no such file|ENOENT/i,
      /文件不存在|目录不存在|路径不正确/i,
    ],
  },
  {
    category: 'tool_design',
    patterns: [
      /格式错误|schema|JSON.*错误|校验失败|invalid.*format/i,
      /参数.*无效|缺少.*参数|required.*missing/i,
      /未知工具/i,
    ],
  },
  {
    category: 'model_limits',
    patterns: [
      /超时|timeout|截断|truncat/i,
      /上下文.*不足|context.*limit|token.*超出/i,
      /无法完成|过于复杂/i,
    ],
  },
  {
    category: 'prompt_design',
    patterns: [
      /权限不足|未获用户确认|denied|拒绝/i,
      /已存在|冲突|already exist|conflict/i,
      /未指定|不明确|ambiguous/i,
    ],
  },
]

const FIX_SUGGESTIONS: Record<FailureCategory, string> = {
  prompt_design: '系统提示词需更明确地描述此场景的处理方式',
  tool_design: '工具描述或参数 schema 可能需要修正',
  model_limits: '减少单次操作规模或拆分为多步',
  data_gaps: '先用 list_directory 或 search_files 确认目标存在',
}

const FEEDBACK_TARGETS: Record<FailureCategory, 'prompt' | 'tool_schema' | 'context' | 'kb' | 'unknown'> = {
  prompt_design: 'prompt',
  tool_design: 'tool_schema',
  model_limits: 'context',
  data_gaps: 'kb',
}

export class FailureTaxonomy {
  classify(result: ToolResult): ClassifiedFailure | null {
    if (result.status === 'success') return null
    const error = result.summary || ''

    // Match against known patterns
    let bestMatch: { category: FailureCategory; confidence: number } | null = null

    for (const { category, patterns } of CATEGORY_PATTERNS) {
      for (const p of patterns) {
        if (p.test(error)) {
          const confidence = 0.7 // keyword match = medium confidence
          if (!bestMatch || confidence > bestMatch.confidence) {
            bestMatch = { category, confidence }
          }
        }
      }
    }

    const category = bestMatch?.category || 'model_limits'
    const confidence = bestMatch?.confidence || 0.3

    return {
      toolName: '',
      error,
      category,
      confidence,
      suggestedFix: FIX_SUGGESTIONS[category],
      feedbackTarget: FEEDBACK_TARGETS[category],
    }
  }

  /** Classify multiple failures at once */
  classifyBatch(results: ToolResult[]): ClassifiedFailure[] {
    return results
      .filter(r => r.status === 'error')
      .map(r => this.classify(r)!)
      .filter(Boolean)
  }

  /** Get category distribution stats */
  getDistribution(failures: ClassifiedFailure[]): Record<FailureCategory, number> {
    const dist: Record<FailureCategory, number> = {
      prompt_design: 0,
      tool_design: 0,
      model_limits: 0,
      data_gaps: 0,
    }
    for (const f of failures) {
      dist[f.category]++
    }
    return dist
  }

  /** Get dominant failure category */
  getDominantCategory(failures: ClassifiedFailure[]): FailureCategory | null {
    const dist = this.getDistribution(failures)
    let max = 0
    let dominant: FailureCategory | null = null
    for (const [cat, count] of Object.entries(dist)) {
      if (count > max) { max = count; dominant = cat as FailureCategory }
    }
    return dominant
  }
}
