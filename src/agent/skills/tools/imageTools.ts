// ── Image Tools (2 tools) ──
// Self-contained for skill system. Uses aiService from @/services/fileService
// for Pexels image search and AI image generation.

import type { ToolDefinition, ToolResult, ToolExecutionContext } from '../types'

export const imageTools: ToolDefinition[] = [
  {
    schema: {
      name: 'search_images',
      description:
        '在 Pexels 图库搜索免费高清图片并保存到 images/ 目录。支持中文搜索。需设置 PEXELS_API_KEY 环境变量（免费注册: https://www.pexels.com/api/）。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词（支持中文，如"古装美女""山水风景"）' },
          count: { type: 'number', description: '返回数量（默认3，最多10）' },
          orientation: { type: 'string', description: '图片方向: landscape(横版) / portrait(竖版) / square(方形)' },
          size: { type: 'string', description: '尺寸: large(大) / medium(中) / small(小)' },
        },
        required: ['query'],
      },
    },
    permission: 'AUTO',
    category: 'image',
    availableInPlanMode: false,
    executor: async (args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> => {
      try {
        const { aiService } = await import('@/services/fileService')
        const results = await aiService.executeFileTools([
          {
            callId: ctx.callId,
            toolName: 'search_images',
            args: {
              query: args.query,
              count: args.count,
              projectId: ctx.projectId || undefined,
            },
          },
        ])
        return results[0] || { status: 'error', summary: '图片搜索失败' }
      } catch (e) {
        return {
          status: 'error',
          summary: `图片搜索失败: ${e instanceof Error ? e.message : '未知错误'}`,
        }
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
    permission: 'AUTO',
    category: 'image',
    availableInPlanMode: false,
    executor: async (args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> => {
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
        return {
          status: 'success',
          summary: `已生成图片: ${result.path}（花费 $${result.cost.toFixed(2)}）`,
          detail: `图片已保存到项目 images/ 目录。\n路径: ${result.path}\n原始URL: ${result.url}\n提示词: ${result.prompt}`,
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '未知错误'
        if (msg.includes('[UNSUPPORTED_OPERATION]') || msg.includes('不支持')) {
          return {
            status: 'error',
            summary: '当前模型不支持图片生成',
            detail:
              '该 AI 模型（如 DeepSeek）仅支持文本生成，无法创建图片。\n' +
              '替代方案：\n' +
              '1. 使用 search_images 工具从 Unsplash 搜索现有图片\n' +
              '2. 在设置中切换到支持图片生成的模型（如 OpenAI dall-e-3）\n' +
              '3. 手动上传图片到角色档案或章节中',
          }
        }
        return { status: 'error', summary: `图片生成失败: ${msg}` }
      }
    },
  },
]
