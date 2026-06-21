// ── Project Tools (2 tools) ──
// Self-contained for skill system. Uses aiService from @/services/fileService
// for project creation and deletion.

import type { ToolDefinition, ToolResult, ToolExecutionContext } from '../types'

export const projectTools: ToolDefinition[] = [
  {
    schema: {
      name: 'create_project',
      description: '创建小说项目（含目录骨架+初始化文件）。创建后文件已存在——填充用 edit_file(__FULL_REPLACE__)，不要 create_file。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '项目名称' },
          type: { type: 'string', description: 'writing(写作) | imitation(仿写) | continuation(续写)' },
          novelCategory: { type: 'string', description: '小说类型' },
        },
        required: ['name'],
      },
    },
    permission: 'AUTO',
    category: 'project',
    executor: async (args: Record<string, unknown>): Promise<ToolResult> => {
      const { sanitizeFileName } = await import('@/utils/security')
      const nameCheck = sanitizeFileName(args.name)
      if (!nameCheck.valid) return { status: 'error', summary: nameCheck.error! }
      const projName = nameCheck.value
      try {
        const { aiService } = await import('@/services/fileService')
        const results = await aiService.executeFileTools([
          {
            callId: 'tool',
            toolName: 'create_project',
            args: { ...args, name: projName },
            confirmed: true,
          },
        ])
        return results[0] || { status: 'error', summary: '创建失败' }
      } catch (e) {
        return {
          status: 'error',
          summary: `创建项目失败: ${e instanceof Error ? e.message : '未知错误'}`,
        }
      }
    },
  },

  {
    schema: {
      name: 'delete_project',
      description: '删除整个项目及所有内容。不可恢复，需要用户确认。',
      parameters: {
        type: 'object',
        properties: {
          project_name: { type: 'string', description: '要删除的项目名称' },
        },
        required: ['project_name'],
      },
    },
    permission: 'DANGEROUS_ASK',
    category: 'project',
    executor: async (args: Record<string, unknown>): Promise<ToolResult> => {
      try {
        const { aiService } = await import('@/services/fileService')
        const results = await aiService.executeFileTools([
          {
            callId: 'tool',
            toolName: 'delete_project',
            args,
            confirmed: true,
          },
        ])
        return results[0] || { status: 'error', summary: '删除失败' }
      } catch (e) {
        return {
          status: 'error',
          summary: `删除项目失败: ${e instanceof Error ? e.message : '未知错误'}`,
        }
      }
    },
  },
]
