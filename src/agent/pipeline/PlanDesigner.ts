// ── Plan Designer ──
// Used for the "simplified" route (skip intent, plan only).
// The "full" route uses the merged Intent+Plan prompt in IntentAnalyzer.ts.

import type { ThinkingPlan, ThinkingStep } from '../state/types'

export const PLAN_ONLY_PROMPT = `你是一个小说写作方案设计师。根据用户需求设计可执行的工具调用序列。

设计原则:
1. 只读步骤可并行（无依赖关系）
2. 写入步骤必须在所有必要的读取完成后
3. 每个步骤对应一个具体的工具调用
4. args 必须包含准确的文件路径
5. 预估总 token 消耗

请用以下格式输出：
` + '```plan' + `
{
  "intent": "一句话描述",
  "steps": [
    {
      "id": "step_1",
      "tool": "read_file",
      "action": "描述操作内容",
      "args": {"file_path": "outline/plot.md"},
      "expectedOutcome": "预期的结果",
      "dependsOn": []
    }
  ],
  "neededTools": ["read_file", "create_file"],
  "estimatedTokens": 5000
}
` + '```'

const PLAN_PATTERN = /```plan\s*([\s\S]*?)```/

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
