// ── Template Tools (1 tool) ──
// analyze_text_style: 调用风格工坊/仿写的分析引擎

import type { ToolDefinition, ToolResult } from '../types'

export const templateTools: ToolDefinition[] = [
  {
    schema: {
      name: 'analyze_text_style',
      description:
        '调用风格工坊的分析引擎分析文本写作风格。传入原文内容和维度列表，返回结构化维度分析。' +
        '内部使用 buildStyleAnalyzePrompt + parseStyleAnalysisReply，与风格工坊/仿写使用完全相同的分析引擎。',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: '原文内容' },
          dimensions: {
            type: 'array', items: { type: 'string' },
            description: '要分析的维度key列表，如 ["narrativeTone","sentenceStyle","vocabularyStyle"]',
          },
          novelType: { type: 'string', description: '小说类型(可选)' },
        },
        required: ['content', 'dimensions'],
      },
    },
    permission: 'AUTO',
    category: 'template',
    executor: async (args: Record<string, unknown>): Promise<ToolResult> => {
      const content = String(args.content || '')
      const dims: string[] = Array.isArray(args.dimensions) ? args.dimensions.map(String) : []
      if (!content.trim()) return { status: 'error', summary: 'content 为空' }
      if (dims.length === 0) return { status: 'error', summary: 'dimensions 为空' }

      try {
        const { buildStyleAnalyzePrompt, parseStyleAnalysisReply } = await import('@/services/extractionService')
        const { useSettingsStore } = await import('@/store')
        const configId = useSettingsStore.getState().activeConfigId
        if (!configId) return { status: 'error', summary: '未配置AI' }

        const prompt = buildStyleAnalyzePrompt(dims, String(args.novelType || '') || undefined)
        const { chatAI } = await import('@/utils/chatAI')
        const reply = await chatAI([{ role: 'user', content: `${prompt}\n\n[原文]\n${content}` }], configId)
        const result = parseStyleAnalysisReply(reply, dims)
        const dims2 = result.dimAnalyses || {}
        const keys = Object.keys(dims2)
        if (keys.length === 0) return { status: 'error', summary: '未提取到维度，原文可能太短' }

        return { status: 'success', summary: `${keys.length}维: ${keys.join(', ')}`, detail: JSON.stringify(dims2) }
      } catch (e) {
        return { status: 'error', summary: `分析失败: ${e instanceof Error ? e.message : '未知'}` }
      }
    },
  },
]
