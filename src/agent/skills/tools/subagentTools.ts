// ── Subagent Tools (v15) ──
// analyze_file / edit_file_task：主 agent 委托子 agent（独立上下文窗口）处理大文件。
// 仿 analyze_text_style 的"executor 内嵌子任务"模式——此处子任务是一个独立 V4UnifiedRuntime。
// 上下文隔离：子 agent 的 messagesForApi 不进入主 agent 上下文，只返回结构化 detail + subAgentUsage。

import type { ToolDefinition, ToolResult } from '../types'
import { runSubagent, SUBAGENT_TOOL_NAMES } from '../../subagent/SubagentService'

/** detail 回灌主上下文的截断上限（防撑爆） */
const MAX_DETAIL_CHARS: Record<string, number> = {
  analyze_file: 4000,
  edit_file_task: 2000,
}

function buildTaskMessage(
  toolName: string,
  filePath: string,
  extra: string,
): string {
  const lines = [
    `任务文件: ${filePath}`,
    extra,
  ]
  if (toolName === 'analyze_file') {
    lines.push('请读取该文件并按要求输出结构化分析摘要。')
  } else {
    lines.push('请按上述指令精确定位并修改该文件，输出修改前后摘要。')
  }
  return lines.join('\n')
}

export const subagentTools: ToolDefinition[] = [
  {
    schema: {
      name: 'analyze_file',
      description:
        '委托子分析代理（独立上下文窗口）读取文件并输出结构化分析摘要。' +
        '适用于大文件（超过2万字符）或需要深入分析的文件内容——子代理读取全文但只把摘要返回给你，不占用你的上下文。' +
        '小文件请直接 read_file，不要使用本工具。',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '要分析的文件路径（相对路径）' },
          question: { type: 'string', description: '分析问题（可选，不传则输出通用结构摘要）' },
        },
        required: ['file_path'],
      },
    },
    permission: 'AUTO',
    category: 'file',
    executor: async (args: Record<string, unknown>, ctx): Promise<ToolResult> => {
      const filePath = String(args.file_path || '').trim()
      const question = String(args.question || '').trim()
      if (!filePath) return { status: 'error', summary: 'file_path 为空' }

      try {
        const { useSettingsStore } = await import('@/store')
        const configId = useSettingsStore.getState().activeConfigId
        if (!configId) return { status: 'error', summary: '未配置AI' }

        const taskMessage = buildTaskMessage(
          'analyze_file', filePath,
          question ? `分析问题: ${question}` : '分析问题: 请输出文件的整体结构、核心内容与亮点。',
        )
        const result = await runSubagent({
          role: 'analyze',
          projectId: ctx.projectId,
          configId,
          userMessage: taskMessage,
          signal: ctx.signal,
        })

        return {
          status: result.success ? 'success' : 'error',
          summary: result.success ? `子代理分析完成: ${filePath}` : `子代理分析失败: ${filePath}`,
          detail: result.text.slice(0, MAX_DETAIL_CHARS.analyze_file),
          subAgentUsage: result.usage,
        }
      } catch (e) {
        return { status: 'error', summary: `子代理分析异常: ${e instanceof Error ? e.message : '未知'}` }
      }
    },
  },
  {
    schema: {
      name: 'edit_file_task',
      description:
        '委托子编辑代理（独立上下文窗口）对长文件执行精确修改。' +
        '子代理定位目标区域、执行修改并返回修改前后摘要，不占用你的上下文。' +
        '适用于大文件（超过2万字符）或需要多处修改的长文件。小文件请直接 edit_file/batch_replace。' +
        '子代理只改指令要求的部分，不删除/重命名文件。',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '要修改的文件路径（相对路径）' },
          instruction: { type: 'string', description: '修改指令（要改什么、改成什么，尽量具体）' },
        },
        required: ['file_path', 'instruction'],
      },
    },
    permission: 'AUTO',
    category: 'file',
    executor: async (args: Record<string, unknown>, ctx): Promise<ToolResult> => {
      const filePath = String(args.file_path || '').trim()
      const instruction = String(args.instruction || '').trim()
      if (!filePath) return { status: 'error', summary: 'file_path 为空' }
      if (!instruction) return { status: 'error', summary: 'instruction 为空' }

      try {
        const { useSettingsStore } = await import('@/store')
        const configId = useSettingsStore.getState().activeConfigId
        if (!configId) return { status: 'error', summary: '未配置AI' }

        const taskMessage = buildTaskMessage('edit_file_task', filePath, `修改指令: ${instruction}`)
        const result = await runSubagent({
          role: 'edit',
          projectId: ctx.projectId,
          configId,
          userMessage: taskMessage,
          signal: ctx.signal,
        })

        return {
          status: result.success ? 'success' : 'error',
          summary: result.success ? `子代理修改完成: ${filePath}` : `子代理修改失败: ${filePath}`,
          detail: result.text.slice(0, MAX_DETAIL_CHARS.edit_file_task),
          subAgentUsage: result.usage,
        }
      } catch (e) {
        return { status: 'error', summary: `子代理修改异常: ${e instanceof Error ? e.message : '未知'}` }
      }
    },
  },
]

export { SUBAGENT_TOOL_NAMES }
