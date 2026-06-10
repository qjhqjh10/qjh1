// ── Browser Tools (2 tools) ──
// Self-contained for skill system. Uses electronBridge for web page
// opening/content extraction and web search.

import type { ToolDefinition, ToolResult, ToolExecutionContext } from '../types'
import { validateUrl } from '../../../utils/security'

export const browserTools: ToolDefinition[] = [
  {
    schema: {
      name: 'browser_open',
      description:
        '打开网页 URL，提取并返回纯文本内容。用于查阅在线参考资料、研究资料。仅支持 HTTP/HTTPS。',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '网页 URL（https://...）' },
        },
        required: ['url'],
      },
    },
    permission: 'AUTO',
    category: 'browser',
    executor: async (args: Record<string, unknown>): Promise<ToolResult> => {
      try {
        const check = validateUrl(args.url)
        if (!check.valid) return { status: 'error', summary: check.error || 'URL 无效' }
        const { bridge } = await import('@/services/electronBridge')
        const result = await bridge.browser.open(check.value)
        return result || { status: 'error', summary: '浏览器工具不可用' }
      } catch (e) {
        return {
          status: 'error',
          summary: `browser_open 失败: ${e instanceof Error ? e.message : '未知错误'}`,
        }
      }
    },
  },

  {
    schema: {
      name: 'browser_search',
      description: '使用搜索引擎搜索关键词，返回搜索结果摘要。用于快速查找资料。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词' },
        },
        required: ['query'],
      },
    },
    permission: 'AUTO',
    category: 'browser',
    executor: async (args: Record<string, unknown>): Promise<ToolResult> => {
      try {
        const { bridge } = await import('@/services/electronBridge')
        const result = await bridge.browser.search(String(args.query))
        return result || { status: 'error', summary: '搜索工具不可用' }
      } catch {
        return { status: 'error', summary: '搜索失败' }
      }
    },
  },
]
