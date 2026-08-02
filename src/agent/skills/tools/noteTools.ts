// ── Note Search Tool (1 tool) ──
// v11.5: list_notes/read_note/write_note/edit_note/append_note/delete_note REMOVED.
// Use universal tools instead: list_directory("../notes") / read_file("../notes/xxx.md") /
//   create_file("../notes/xxx.md", content) / edit_file("../notes/xxx.md", old, new) /
//   delete_file("../notes/xxx.md")

import type { ToolDefinition, ToolResult, ToolExecutionContext } from '../types'

export const noteTools: ToolDefinition[] = [
  {
    schema: {
      name: 'search_notes',
      description: '在草稿中语义搜索相关内容。支持中文自然语言查询，返回最相关的笔记片段。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索查询（支持中文）' },
          topK: { type: 'number', description: '返回结果数量（默认3）' },
        },
        required: ['query'],
      },
    },
    permission: 'AUTO',
    category: 'note',
    executor: async (args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> => {
      try {
        const win = typeof window !== 'undefined' ? (window as any) : null
        if (!win?.electron?.notes?.search) {
          return { status: 'error', summary: '笔记搜索不可用（非 Electron 环境或 notes API 未就绪）' }
        }
        // v14.9(审计): topK 钳制 1-10——原裸传模型值，传 100 会对全部笔记逐 chunk 打 embedding
        // （费用/耗时失控；主进程只做默认值兜底不封顶）
        const topK = Math.min(Math.max(Math.floor(Number(args.topK) || 3), 1), 10)
        const results =
          (await win.electron.notes.search(
            args.query as string,
            ctx.configId,
            topK,
          )) || []
        if (!Array.isArray(results) || results.length === 0) {
          return { status: 'success', summary: '未找到相关笔记', detail: '[]' }
        }
        const detail = results
          .map(
            (r: any) =>
              `[${r.fileName}] (相关度:${(r.score * 100).toFixed(0)}%)\n${r.content}`,
          )
          .join('\n---\n')
        return { status: 'success', summary: `找到${results.length}条相关笔记`, detail }
      } catch (e) {
        return { status: 'error', summary: `搜索笔记失败: ${e instanceof Error ? e.message : '未知错误'}` }
      }
    },
  },
]
