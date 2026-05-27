import type { ToolDefinition } from '../ToolRegistry'

export const imageTools: ToolDefinition[] = [
  {
    schema: {
      name: 'search_images',
      description: '在 Unsplash 图库搜索高清图片并保存到项目 images/ 目录。仅当用户明确要求图片时才调用。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词（建议英文）' },
          count: { type: 'number', description: '返回数量（默认3，最多5）' },
        },
        required: ['query'],
      },
    },
    permission: 'AUTO',
    category: 'image',
    availableInPlanMode: true,
    executor: async (args, ctx) => {
      const { aiService } = await import('@/services/fileService')
      const results = await aiService.executeFileTools([{
        callId: 'tool', toolName: 'search_images',
        args: { query: args.query, count: args.count },
      }])
      return results[0] || { status: 'error', summary: '图片搜索失败' }
    },
  },
  {
    schema: {
      name: 'generate_image',
      description: '使用 AI 模型生成图片并保存到项目 images/ 目录。',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: '图片描述（英文效果更好）' },
          size: { type: 'string', description: '尺寸: 1024x1024 | 1792x1024 | 1024x1792' },
          style: { type: 'string', description: '风格: vivid | natural' },
        },
        required: ['prompt'],
      },
    },
    permission: 'READ_ASK',
    category: 'image',
    availableInPlanMode: true,
    executor: async (args, ctx) => {
      const { aiService } = await import('@/services/fileService')
      const result = await aiService.generateImage(
        String(args.prompt || '').slice(0, 1000),
        ctx.configId,
        ctx.projectId || undefined,
        String(args.size || '1024x1024'),
        String(args.style || 'vivid'),
      )
      return { status: 'success', summary: '已生成图片', detail: `图片路径: ${result.path}\n花费: $${result.cost.toFixed(2)}` }
    },
  },
]
