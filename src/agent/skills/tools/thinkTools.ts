// ── Think Tool (1 tool) ──
// 让模型在工具调用之间暂停思考分析，不会改变任何文件。
// Anthropic 研究表明 Think Tool 在多步任务中提升 54% 准确率。
// https://www.anthropic.com/engineering/claude-think-tool

import type { ToolDefinition, ToolResult, ToolExecutionContext } from '../types'

export const thinkTools: ToolDefinition[] = [
  {
    schema: {
      name: 'think',
      description:
        '在工具调用之间暂停思考。分析当前状态（已完成什么、检查是否遗漏了什么、规划下一步）。何时使用：复杂多步任务中收到工具结果后、质量检查失败需要分析原因时、不确定下一步该做什么时。这个工具不会改变任何文件，仅将你的思考过程记录到对话中。',
      parameters: {
        type: 'object',
        properties: {
          thought: { type: 'string', description: '你的思考内容。分析当前状态、检查进度、规划下一步。' },
        },
        required: ['thought'],
      },
    },
    permission: 'AUTO',
    category: 'harness',
    availableInPlanMode: true,
    executor: async (args: Record<string, unknown>): Promise<ToolResult> => {
      const thought = String(args.thought || '').trim()
      if (!thought) return { status: 'error', summary: '思考内容不能为空' }
      // Think 工具不执行任何操作 — 仅将 thought 注入上下文
      return {
        status: 'success',
        summary: '已记录思考',
        detail: thought.slice(0, 2000),  // 保留在上下文中的思考内容
      }
    },
  },
]
