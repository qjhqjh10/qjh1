import type { ToolResult } from '../runtime/AgentRuntime'

export interface FailedTool {
  callId: string
  toolName: string
  error: string
  category: 'format' | 'not_found' | 'permission' | 'conflict' | 'timeout' | 'unknown'
}

export interface ReflectionResult {
  successCount: number
  failureCount: number
  failures: FailedTool[]
  shouldRetry: boolean
  retrySuggestions: string[]
  summary: string
}

export class ReflectionEngine {
  reflect(results: ToolResult[], toolNames: string[]): ReflectionResult {
    const failures: FailedTool[] = []
    let successCount = 0

    for (let i = 0; i < results.length; i++) {
      const r = results[i]
      if (r.status === 'success') {
        successCount++
      } else {
        failures.push({
          callId: `call_${i}`,
          toolName: toolNames[i] || 'unknown',
          error: r.summary || r.detail || '未知错误',
          category: this.categorizeError(r.summary),
        })
      }
    }

    const shouldRetry = failures.length > 0 && failures.every(f => f.category !== 'permission')
    const retrySuggestions = shouldRetry ? failures.map(f => this.suggestRetry(f)) : []

    return {
      successCount,
      failureCount: failures.length,
      failures,
      shouldRetry,
      retrySuggestions,
      summary: successCount === results.length
        ? `全部 ${successCount} 个工具执行成功`
        : `${successCount}/${results.length} 成功，${failures.length} 失败`,
    }
  }

  buildReflectionInject(reflection: ReflectionResult): string {
    if (reflection.failureCount === 0) return ''

    const lines = [
      '[执行反馈]',
      reflection.summary,
    ]

    for (const f of reflection.failures) {
      lines.push(`- ${f.toolName}: ${f.error} (${f.category})`)
    }

    if (reflection.shouldRetry) {
      lines.push('\n建议重试策略:')
      for (const s of reflection.retrySuggestions) {
        lines.push(`- ${s}`)
      }
    }

    return lines.join('\n')
  }

  private categorizeError(summary: string): FailedTool['category'] {
    const s = summary.toLowerCase()
    if (s.includes('格式') || s.includes('schema') || s.includes('json')) return 'format'
    if (s.includes('不存在') || s.includes('not found') || s.includes('找不到')) return 'not_found'
    if (s.includes('权限') || s.includes('未获用户确认') || s.includes('denied')) return 'permission'
    if (s.includes('已存在') || s.includes('冲突') || s.includes('already exists')) return 'conflict'
    if (s.includes('超时') || s.includes('timeout')) return 'timeout'
    return 'unknown'
  }

  private suggestRetry(f: FailedTool): string {
    switch (f.category) {
      case 'format':
        return `${f.toolName}: 检查 JSON/内容格式，参考系统提示词中的 schema`
      case 'not_found':
        return `${f.toolName}: 先用 list_directory 或 search_files 确认文件路径`
      case 'conflict':
        return `${f.toolName}: 目标已存在，使用不同路径或先删除`
      case 'timeout':
        return `${f.toolName}: 减少文件大小或拆分为多个操作`
      default:
        return `${f.toolName}: 查看错误详情后调整参数重试`
    }
  }
}
