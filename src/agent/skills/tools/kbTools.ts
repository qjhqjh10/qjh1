// ── Knowledge Base Tools (2 tools) ──
// v11.5: kb_list/kb_create_file REMOVED.
// Use universal tools instead: list_directory("../knowledge_base/files") /
//   create_file("../knowledge_base/files/xxx.md", content)
// Kept: kb_append_file (uses file_id, not path) and kb_index_file (triggers embedding)

import type { ToolDefinition, ToolResult, ToolExecutionContext } from '../types'

export const kbTools: ToolDefinition[] = [
  {
    schema: {
      name: 'kb_search',
      description:
        '语义搜索知识库。输入查询关键词，返回最相关的 N 个文本片段（每段约500字符）及来源文件名。匹配到相关内容后，如需完整上下文，用 read_file 读取对应文件。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词或问题' },
          topK: { type: 'number', description: '返回片段数，默认5，最大20' },
        },
        required: ['query'],
      },
    },
    permission: 'AUTO',
    category: 'kb',
    executor: async (args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> => {
      try {
        const { kbService } = await import('@/services/fileService')
        const topK = Math.min(Math.max(Number(args.topK) || 5, 1), 20)
        const results = await kbService.search(
          String(args.query || '').slice(0, 4000),
          ctx.projectId || '',
          ctx.configId,
          topK,
        )
        if (!results || results.length === 0) {
          return { status: 'success', summary: '未找到匹配的知识库内容' }
        }
        const detail = results.map((r: any) =>
          `📄 ${r.fileName || '(未知)'} (相关度: ${r.score})\n${r.content || ''}`
        ).join('\n---\n')
        return {
          status: 'success',
          summary: `找到 ${results.length} 个相关片段`,
          detail,
        }
      } catch (e) {
        return { status: 'error', summary: `知识库搜索失败: ${e instanceof Error ? e.message : '未知错误'}` }
      }
    },
  },

  {
    schema: {
      name: 'kb_append_file',
      description:
        '追加内容到知识库文件。新建用 create_file("../knowledge_base/files/"), 追加后需 kb_index_file 建索引。',
      parameters: {
        type: 'object',
        properties: {
          file_id: { type: 'string', description: '目标文件 ID' },
          content: { type: 'string', description: '要追加的内容' },
        },
        required: ['file_id', 'content'],
      },
    },
    permission: 'AUTO',
    category: 'kb',
    executor: async (args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> => {
      try {
        const { kbService } = await import('@/services/fileService')
        await kbService.append(args.file_id as string, args.content as string, ctx.configId)
        return { status: 'success', summary: '已追加到知识库文件' }
      } catch (e) {
        return { status: 'error', summary: `追加知识库文件失败: ${e instanceof Error ? e.message : '未知错误'}` }
      }
    },
  },

  {
    schema: {
      name: 'kb_index_file',
      description:
        '对知识库文件建立语义搜索索引。kb_append_file 后必须调用。',
      parameters: {
        type: 'object',
        properties: {
          file_id: { type: 'string', description: '目标文件 ID' },
        },
        required: ['file_id'],
      },
    },
    permission: 'AUTO',
    category: 'kb',
    executor: async (args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> => {
      try {
        const { kbService } = await import('@/services/fileService')
        const fileId = String(args.file_id || '')
        const result = await kbService.index(fileId, ctx.configId)
        return { status: 'success', summary: `索引完成: ${result.chunkCount} 个片段` }
      } catch (e) {
        return { status: 'error', summary: `索引失败: ${e instanceof Error ? e.message : '未知错误'}` }
      }
    },
  },
]
