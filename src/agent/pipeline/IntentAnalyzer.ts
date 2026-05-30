// ── Intent Analyzer + Plan Designer (Merged) ──
// Second stage of the pipeline. Merges Intent + Plan into a single
// cheap-model API call to save tokens. Outputs both intent analysis
// and executable plan steps in one response.

import type { IntentResult } from './types'

export const INTENT_PLAN_PROMPT = `你是一个小说写作助手。请分两步完成分析：

第一步：意图分析 (intent)
深入理解用户的写作需求，包括：
- 首要目标和次要目标
- 字数、风格、角色聚焦等硬约束
- 需要避开的内容
- 需要了解的上下文（当前剧情、角色状态、伏笔）
- 如果意图模糊，列出追问问题（isAmbiguous=true）

第二步：执行方案 (plan)
设计可执行的工具调用序列：
- 先用只读工具了解现状（read_file, list_directory, search_content）
- 再用写入工具执行操作（create_file, edit_file, write_note）
- 每个步骤包含准确的 args（file_path等）
- 声明步骤间依赖关系（dependsOn）
- 预估总 token 消耗

请用以下格式输出（先intent后plan，两个代码块之间不要有其他文字）：
` + '```intent' + `
{JSON格式的意图分析}
` + '```' + `

` + '```plan' + `
{JSON格式的执行方案}
` + '```'

// ── Intent Parsing ──

const INTENT_PATTERN = /```intent\s*([\s\S]*?)```/

export function parseIntent(text: string): IntentResult | null {
  try {
    const match = text.match(INTENT_PATTERN)
    if (!match) return null
    const raw = JSON.parse(match[1])
    return {
      intent: raw.intent || '',
      goal: { primary: raw.goal?.primary || '', secondary: raw.goal?.secondary || [] },
      constraints: {
        wordCount: raw.constraints?.wordCount,
        styleRef: raw.constraints?.styleRef,
        characterFocus: raw.constraints?.characterFocus,
        plotRequirements: raw.constraints?.plotRequirements || [],
        avoidance: raw.constraints?.avoidance || [],
      },
      contextNeeded: {
        currentPlot: raw.contextNeeded?.currentPlot || '',
        characterState: raw.contextNeeded?.characterState || '',
        foreshadowing: raw.contextNeeded?.foreshadowing || '',
      },
      isAmbiguous: !!raw.isAmbiguous,
      clarificationQuestions: raw.clarificationQuestions || [],
      suggestedApproach: raw.suggestedApproach || '',
    }
  } catch {
    return null
  }
}

// ── Plan Parsing ──

const PLAN_PATTERN = /```plan\s*([\s\S]*?)```/
import type { ThinkingPlan, ThinkingStep } from '../state/types'

export function parsePlan(text: string): ThinkingPlan | null {
  try {
    const match = text.match(PLAN_PATTERN)
    if (!match) return null
    const raw = JSON.parse(match[1])
    const steps: ThinkingStep[] = (raw.steps || []).map((s: Record<string, unknown>, i: number) => ({
      id: String(s.id || `step_${i + 1}`),
      tool: String(s.tool || 'read_file'),
      action: String(s.action || ''),
      args: (s.args as Record<string, unknown>) || {},
      expectedOutcome: String(s.expectedOutcome || ''),
      status: 'pending' as const,
      retryCount: 0,
      approvalStatus: 'pending' as const,
    }))
    return {
      intent: raw.intent || '',
      steps,
      neededTools: raw.neededTools || [...new Set(steps.map(s => s.tool))],
      estimatedTokens: raw.estimatedTokens || 5000,
      dependencies: raw.dependencies || [],
    }
  } catch {
    return null
  }
}
