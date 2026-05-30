import type { ToolDefinition } from '../ToolRegistry'

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
        const { bridge } = await import('@/services/electronBridge')
        const result = await bridge.browser.open(String(args.url))
        return result || { status: 'error', summary: '浏览器工具不可用' }
      } catch { return { status: 'error', summary: '打开页面失败' } }
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
    permission: 'READ_ASK',
    category: 'browser',
    availableInPlanMode: true,
    executor: async (args) => {
      try {
        const { bridge } = await import('@/services/electronBridge')
        const result = await bridge.browser.search(String(args.query))
        return result || { status: 'error', summary: '搜索工具不可用' }
      } catch { return { status: 'error', summary: '搜索失败' } }
    },
  },
]
