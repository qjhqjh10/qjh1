// ── Task Classifier ──
// First stage of the pipeline. Uses a cheap model to classify
// the user message and determine the routing strategy.
// Supports client-side pre-filtering for common patterns (zero API cost).

import type { ClassificationResult } from './types'

// Zero-cost client-side pre-filter patterns
const CHAT_PATTERN = /^(你好|谢谢|再见|好的|嗯|哦|哈哈|是的|没错|知道了|ok|hi|hello|thanks|bye)/i
const QUERY_PATTERN = /^(列出|查看|有几个|显示|告诉我|有哪些|帮我看看|查一下)/i
const TASK_PATTERN = /^(写|续写|创作|生成|修改|编辑|删除|创建|分析|整理|规划|设计|帮.*写|帮.*改|帮.*创建)/i

export function prefilterClient(message: string): ClassificationResult | null {
  const trimmed = message.trim()
  if (!trimmed) return null

  if (CHAT_PATTERN.test(trimmed)) {
    return {
      isComplexTask: false,
      taskType: 'simple_chat',
      reasoning: '客户端预过滤: 对话类关键词',
      estimatedComplexity: 'low',
      suggestedRoute: 'direct',
    }
  }

  if (QUERY_PATTERN.test(trimmed) && trimmed.length < 30) {
    return {
      isComplexTask: false,
      taskType: 'simple_query',
      reasoning: '客户端预过滤: 查询类关键词',
      estimatedComplexity: 'low',
      suggestedRoute: 'simplified',
    }
  }

  if (TASK_PATTERN.test(trimmed)) {
    // High-confidence task → full pipeline, but we still run the LLM classifier
    // for accurate taskType detection (chapter_writing vs chapter_edit vs project_analysis)
    return null // let LLM classifier handle exact categorization
  }

  return null // ambiguous — let LLM classifier decide
}

const SYSTEM_PROMPT = `你是一个任务分类器。分析用户消息，判断路由策略。

分类标准:
- simple_chat: 问候、感谢、闲聊（不需要工具操作）
- simple_query: 简单信息查询（"列出角色"/"有几个文件"）
- file_single: 单文件读写操作
- chapter_writing: 章节创作/续写（需要多步操作）
- chapter_edit: 修改润色已有内容
- project_analysis: 跨文件/全项目级别分析
- ambiguous: 意图不明确，需要追问

路由建议:
- direct: 简单回复即可，无需工具
- simplified: 跳过意图分析，直接设计方案
- full: 完整流水线（意图分析→方案设计→审批→执行）

只输出JSON，不要任何其他文字:
{"isComplexTask":true/false,"taskType":"...","reasoning":"简短理由","estimatedComplexity":"low|medium|high","suggestedRoute":"direct|simplified|full"}`

const PARSE_PATTERN = /\{[\s\S]*\}/

export function parseClassification(text: string): ClassificationResult {
  try {
    const match = text.match(PARSE_PATTERN)
    if (!match) throw new Error('No JSON found')
    const raw = JSON.parse(match[0])
    return {
      isComplexTask: !!raw.isComplexTask,
      taskType: raw.taskType || 'simple_chat',
      reasoning: raw.reasoning || '',
      estimatedComplexity: raw.estimatedComplexity || 'low',
      suggestedRoute: raw.suggestedRoute || 'full',
    }
  } catch {
    // Fallback: default to full pipeline
    return {
      isComplexTask: true,
      taskType: 'simple_query',
      reasoning: '分类解析失败，默认走完整流水线',
      estimatedComplexity: 'medium',
      suggestedRoute: 'full',
    }
  }
}

export { SYSTEM_PROMPT as CLASSIFIER_PROMPT }
