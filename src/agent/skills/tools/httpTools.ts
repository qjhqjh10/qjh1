// ── HTTP Tools (2 tools) ──
// Self-contained for skill system. Uses electronBridge for HTTP requests
// with SSRF protection via validateUrl from @/utils/security.

import type { ToolDefinition, ToolResult, ToolExecutionContext } from '../types'
import { validateUrl } from '../../../utils/security'

export const httpTools: ToolDefinition[] = [
  {
    schema: {
      name: 'http_get',
      description:
        '发起 HTTP GET 请求获取网页或 API 数据。返回文本/html/json 响应体。可用于查阅在线文档、参考资料、API 数据。禁止访问内网地址。',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '完整的 URL（https://...）' },
        },
        required: ['url'],
      },
    },
    permission: 'AUTO',
    category: 'http',
    executor: async (args: Record<string, unknown>): Promise<ToolResult> => {
      try {
        const check = validateUrl(args.url)
        if (!check.valid) return { status: 'error', summary: check.error || 'URL 无效' }
        const url = check.value
        const { bridge } = await import('@/services/electronBridge')
        const result = await bridge.http.get(url)
        return result || { status: 'error', summary: 'HTTP 工具不可用' }
      } catch (e) {
        // v14.9(审计): 带底层错误信息——原 catch 吞掉 e.message，IPC 层故障时模型拿不到自愈线索
        return { status: 'error', summary: `HTTP 请求失败: ${e instanceof Error ? e.message : '未知错误'}` }
      }
    },
  },

  {
    schema: {
      name: 'http_fetch',
      description:
        '发起 HTTP 请求（支持 GET/POST），可自定义请求头、请求体。用于调用外部 API、提交数据。禁止访问内网地址。自动执行（无需用户确认）。',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '完整的 URL' },
          method: { type: 'string', description: 'HTTP 方法: GET 或 POST，默认 GET' },
          headers: {
            type: 'string',
            description: 'JSON 格式的请求头，如 {"Content-Type":"application/json"}',
          },
          body: { type: 'string', description: '请求体内容（POST 时使用）' },
        },
        required: ['url'],
      },
    },
    permission: 'AUTO',
    category: 'http',
    executor: async (args: Record<string, unknown>): Promise<ToolResult> => {
      try {
        const check = validateUrl(args.url)
        if (!check.valid) return { status: 'error', summary: check.error || 'URL 无效' }
        const url = check.value
        let headers: Record<string, string> | undefined
        if (args.headers) {
          try {
            headers = JSON.parse(String(args.headers))
          } catch {
            return { status: 'error', summary: '请求头 JSON 格式无效，请检查语法' }
          }
        }
        const { bridge } = await import('@/services/electronBridge')
        const result = await bridge.http.fetch(url, {
          method: String(args.method || 'GET'),
          headers,
          body: args.body ? String(args.body) : undefined,
        })
        return result || { status: 'error', summary: 'HTTP 工具不可用' }
      } catch (e) {
        // v14.9(审计): 带底层错误信息（同 http_get）
        return { status: 'error', summary: `HTTP 请求失败: ${e instanceof Error ? e.message : '未知错误'}` }
      }
    },
  },
]
