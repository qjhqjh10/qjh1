import type { ToolDefinition } from '../ToolRegistry'

export const projectTools: ToolDefinition[] = [
  {
    schema: {
      name: 'create_project',
      description: '创建新的小说项目（含完整目录骨架）。需要用户确认。',
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
    permission: 'DANGEROUS_ASK',
    category: 'project',
    availableInPlanMode: false,
    executor: async (args) => {
      const { aiService } = await import('@/services/fileService')
      const results = await aiService.executeFileTools([{
        callId: 'tool', toolName: 'create_project', args, confirmed: true,
      }])
      return results[0] || { status: 'error', summary: '创建失败' }
    },
  },
  {
    schema: {
      name: 'delete_project',
      description: '删除整个项目及所有内容。不可恢复，需要用户确认。',
      parameters: {
        type: 'object',
        properties: { project_name: { type: 'string', description: '要删除的项目名称' } },
        required: ['project_name'],
      },
    },
    permission: 'DANGEROUS_ASK',
    category: 'project',
    availableInPlanMode: false,
    executor: async (args) => {
      const { aiService } = await import('@/services/fileService')
      const results = await aiService.executeFileTools([{
        callId: 'tool', toolName: 'delete_project', args, confirmed: true,
      }])
      return results[0] || { status: 'error', summary: '删除失败' }
    },
  },
]
