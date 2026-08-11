// ── Image Tools (2 tools) ──
// Self-contained for skill system. Uses aiService from @/services/fileService
// for Pexels image search and secondary-model vision analysis.
// v16.3.0: generate_image 文生图已移除——副模型定位纯多模态理解，图片获取仅 search_images。

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
          count: { type: 'number', description: '返回数量（默认3，最多5）' },  // v14.9(审计): 实际上限 5（主进程 Pexels 分页硬上限），schema 原写 10 → 模型传 8 只回 5
          orientation: { type: 'string', description: '图片方向: landscape(横版) / portrait(竖版) / square(方形)' },
          size: { type: 'string', description: '尺寸: large(大) / medium(中) / small(小)' },
        },
        required: ['query'],
      },
    },
    permission: 'AUTO',
    category: 'image',
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
              // v14.6.1: 透传 orientation/size——schema 声明了但此前被 executor 丢弃，
              // AI 按描述传"竖版/横版"恒不生效
              orientation: args.orientation,
              size: args.size,
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

  // ── v16.2.0: analyze_image — AI 主动看图（副模型多模态）──
  // 主模型写作中需要"看图"时主动调用（项目 images/ 目录、知识库图片、用户提及的图片文件）。
  // 与上传图片自动分析共用 ai:vision-chat IPC；主进程读文件→缩放→副模型→描述回灌。
  // v16.3.0: 原 generate_image 工具已移除（副模型纯多模态，文生图功能取消）。
  {
    schema: {
      name: 'analyze_image',
      description:
        '调用副模型（多模态，OpenAI 兼容）分析图片文件并返回结构化描述。' +
        '副模型独立看图，描述文本回灌你的上下文（图片数据不进入对话）。' +
        '适用于：用户提及图片文件需要理解内容、查看项目 images/ 目录或知识库中的图片、比对参考图等。' +
        '注意：需在设置→模型设置→副模型配置支持图片理解的模型（如 MiniMax-M3 / qwen-vl-plus）；未配置时返回错误。',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '图片文件路径（相对路径，支持项目 images/、uploads/ 等目录）' },
          question: { type: 'string', description: '分析问题（可选，如"她穿什么衣服""这是什么场景"，不传则输出通用描述）' },
        },
        required: ['file_path'],
      },
    },
    permission: 'AUTO',
    category: 'image',
    executor: async (args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> => {
      const filePath = String(args.file_path || '').trim()
      if (!filePath) return { status: 'error', summary: 'file_path 为空' }
      const question = String(args.question || '').trim()
      try {
        const { aiService } = await import('@/services/fileService')
        const { useSettingsStore } = await import('@/store')
        const cfg = useSettingsStore.getState().configs.find(c => c.id === ctx.configId)
        if (!cfg?.secondaryModel) {
          return {
            status: 'error',
            summary: '未配置副模型，无法分析图片',
            detail: '请在 设置→模型设置→副模型 填写支持图片理解的模型（如 MiniMax-M3 / qwen-vl-plus）后重试。',
          }
        }
        const template = useSettingsStore.getState().aiSettings?.visionTemplate || 'standard'
        // v16.2.0(审查修复 E1): 复用共享提示词常量（原内联同语义文案 + TOOL_VISION_PROMPT 死导出）
        const { TOOL_VISION_PROMPT } = await import('@/utils/visionAnalyzer')
        const prompt = question
          ? `请仔细观察这张图片，回答分析问题：${question}。若图片中能找到相关依据请具体说明，找不到则如实说明。用中文，条理清晰。`
          : TOOL_VISION_PROMPT
        const result = await aiService.visionChat({
          configId: ctx.configId,
          projectId: ctx.projectId || undefined,
          prompt,
          images: [{ path: filePath }],
          template,
        })
        return {
          status: 'success',
          summary: `图片分析完成: ${filePath}（花费 $${(result.cost || 0).toFixed(4)}）`,
          detail: `图片: ${filePath}\n\n${(result.text || '').slice(0, 8000)}`,
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return { status: 'error', summary: `图片分析失败: ${msg}` }
      }
    },
  },
]
