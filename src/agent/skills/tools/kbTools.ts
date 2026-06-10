// ── Knowledge Base Tools (2 tools) ──
// v11.5: kb_list/kb_create_file REMOVED.
// Use universal tools instead: list_directory("../knowledge_base/files") /
//   create_file("../knowledge_base/files/xxx.md", content)
// Kept: kb_append_file (uses file_id, not path) and kb_index_file (triggers embedding)

import type { ToolDefinition, ToolResult, ToolExecutionContext } from '../types'

export const kbTools: ToolDefinition[] = [
  {
    schema: {
      name: 'kb_append_file',
      description:
        '向知识库已有文件末尾追加内容。file_id 是 KB 文件的 UUID。⚠️ 新建 KB 文件：用 create_file("../knowledge_base/files/文件名.md", content)。追加已有文件：用此工具 + file_id。追加后必须调用 kb_index_file 建立语义搜索索引。',
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
        '对知识库文件建立语义搜索索引。kb_append_file 追加内容后必须调用此工具。file_id 是 KB 文件的 UUID。建索引后内容可被语义搜索检索。',
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
