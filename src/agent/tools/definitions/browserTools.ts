import type { ToolDefinition } from '../ToolRegistry'
import { err } from '../resultHelpers'
import { validateUrl } from '@/utils/security'

export const browserTools: ToolDefinition[] = [
  {
    schema: {
      name: 'browser_open',
      description: '打开网页 URL，提取并返回纯文本内容。用于查阅在线参考资料、研究资料。仅支持 HTTP/HTTPS。',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '网页 URL（https://...）' },
        },
        required: ['url'],
      },
    },
    permission: 'DANGEROUS_ASK',
    category: 'browser',
    availableInPlanMode: false,
    executor: async (args) => {
      try {
        const check = validateUrl(args.url)
        if (!check.valid) return { status: 'error', summary: check.error || 'URL 无效' }
        const { bridge } = await import('@/services/electronBridge')
        const result = await bridge.browser.open(check.value)
        return result || { status: 'error', summary: '浏览器工具不可用' }
      } catch (e) { return err('browser_open', e) }
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
    permission: 'DANGEROUS_ASK',
    category: 'browser',
    availableInPlanMode: false,
    executor: async (args) => {
      try {
        const { bridge } = await import('@/services/electronBridge')
        const result = await bridge.browser.search(String(args.query))
        return result || { status: 'error', summary: '搜索工具不可用' }
      } catch { return { status: 'error', summary: '搜索失败' } }
    },
  },
]
