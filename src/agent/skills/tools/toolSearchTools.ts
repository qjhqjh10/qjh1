// ── Tool Search (v11.7.1) ──
// 让模型按需发现扩展工具，而非每轮发送全部 34 个 Schema。
// 首轮: 全部工具（建立全局认知）
// 后续: 核心 7 个（含 tool_search）→ 模型按需调用 tool_search 查询扩展工具

import type { ToolDefinition, ToolResult, ToolExecutionContext } from '../types'
import { toolRegistry } from '../ToolRegistry'

/** 核心工具（每轮必发），覆盖 90%+ 使用场景 */
export const CORE_TOOL_NAMES = new Set([
  'read_file',
  'create_file',
  'edit_file',
  'delete_file',
  'list_directory',
  'search_content',
  'tool_search',
])

// v13.2.0: 后续消息扩展工具集 — 首条全量34个，后续发这12个高频工具
// kb_search 是知识库场景最高频工具，加入后续集合避免额外 tool_search 往返
export const SUBSEQUENT_TOOL_NAMES = new Set([
  ...CORE_TOOL_NAMES,
  'find_files',
  'batch_replace',
  'rename_file',
  'kb_search',
])

export const toolSearchTools: ToolDefinition[] = [{
  schema: {
    name: 'tool_search',
    description: '查询可用的扩展工具。输入关键词（如"图片"、"浏览器"、"风格分析"、"知识库"），返回匹配的工具名、描述和参数签名。不需要每轮列出全部工具，按需查询即可。',
    parameters: {
      type: 'object',
      required: ['query'],
      properties: {
        query: {
          type: 'string',
          description: '搜索关键词。例如: "图片"、"搜索"、"风格分析"、"浏览器"、"知识库"',
        },
      },
    },
  },
  permission: 'AUTO',
  category: 'harness',
  executor: async (args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolResult> => {
    const query = String(args.query || '')
    const allDefs = toolRegistry.getAllDefinitions()
    const lowered = query.toLowerCase()
    const matches = allDefs.filter(t => {
      const name = t.schema.name.toLowerCase()
      const desc = (t.schema.description || '').toLowerCase()
      return name.includes(lowered) || desc.includes(lowered)
    })

    if (matches.length === 0) {
      return {
        status: 'success',
        summary: `未找到匹配 "${query}" 的工具。可用核心工具: read_file, create_file, edit_file, delete_file, list_directory, search_content。尝试其他关键词。`,
      }
    }

    const detail = matches.map(t => {
      const params = t.schema.parameters?.required?.length
        ? ' 参数: ' + (t.schema.parameters.required as string[]).join(', ')
        : ''
      return `${t.schema.name} — ${t.schema.description}${params}`
    }).join('\n')

    return {
      status: 'success',
      summary: `找到 ${matches.length} 个工具匹配 "${query}"`,
      detail: `${detail}\n\n调用时使用上述工具名（不含中文描述部分）。`,
      // v13.2.0: 结构化返回匹配工具名 → Runtime 动态加载其完整 schema
      matchedTools: matches.map(t => t.schema.name),
    }
  },
}]

