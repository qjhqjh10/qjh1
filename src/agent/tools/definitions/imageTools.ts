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
    permission: 'DANGEROUS_ASK',
    category: 'image',
    availableInPlanMode: false,
    executor: async (args, ctx) => {
      try {
        const { aiService } = await import('@/services/fileService')
        const results = await aiService.executeFileTools([{
          callId: 'tool', toolName: 'search_images',
          args: { query: args.query, count: args.count, projectId: ctx.projectId || undefined },
        }])
        return results[0] || { status: 'error', summary: '图片搜索失败' }
      } catch (e) {
        return { status: 'error', summary: `图片搜索失败: ${e instanceof Error ? e.message : '未知错误'}` }
      }
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
    permission: 'DANGEROUS_ASK',
    category: 'image',
    availableInPlanMode: false,
    executor: async (args, ctx) => {
      const prompt = String(args.prompt ?? '').trim().slice(0, 1000)
      if (!prompt) return { status: 'error', summary: '图片描述不能为空' }
      try {
        const { aiService } = await import('@/services/fileService')
        const result = await aiService.generateImage(
          prompt,
          ctx.configId,
          ctx.projectId || undefined,
          String(args.size || '1024x1024'),
          String(args.style || 'vivid'),
        )
        return { status: 'success', summary: '已生成图片', detail: `图片路径: ${result.path}\n花费: $${result.cost.toFixed(2)}` }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '未知错误'
        if (msg.includes('[UNSUPPORTED_OPERATION]') || msg.includes('不支持')) {
          return {
            status: 'error',
            summary: '当前模型不支持图片生成',
            detail: '该 AI 模型（如 DeepSeek）仅支持文本生成，无法创建图片。\n'
              + '替代方案：\n'
              + '1. 使用 search_images 工具从 Unsplash 搜索现有图片\n'
              + '2. 在设置中切换到支持图片生成的模型（如 OpenAI dall-e-3）\n'
              + '3. 手动上传图片到角色档案或章节中',
          }
        }
        return { status: 'error', summary: `图片生成失败: ${msg}` }
      }
    },
  },
]
