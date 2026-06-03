// ── Note Tools (6 tools) ──
// Self-contained for skill system. Uses fileService from @/services/fileService
// for note CRUD operations under the global notes/ directory.

import type { ToolDefinition, ToolResult, ToolExecutionContext } from '../types'

// ── Helper: resolve global notes directory ──
async function getNotesDir(): Promise<string> {
  try {
    const { useStore } = await import('@/store')
    return (useStore.getState().projectsBasePath || '').replace(/[/\\]projects[/\\]?$/, '/notes')
  } catch {
    return ''
  }
}

// ── Per-file mutex to prevent lost updates on concurrent append_note calls ──
const _appendLocks = new Map<string, Promise<void>>()

function withAppendLock(filePath: string, fn: () => Promise<void>): Promise<void> {
  const prev = _appendLocks.get(filePath) || Promise.resolve()
  const next = prev.then(fn, fn)
  _appendLocks.set(
    filePath,
    next.then(
      () => {},
      () => {},
    ),
  )
  return next
}

export const noteTools: ToolDefinition[] = [
  {
    schema: {
      name: 'list_notes',
      description:
        '列出全局 notes/ 目录下的所有草稿笔记。何时使用：需要查看已有草稿时。草稿是全局的（不绑定项目），适合记录灵感、暂存想法。与知识库的区别：草稿是临时性的，知识库是长期积累的参考资料。',
      parameters: { type: 'object', properties: {}, required: [] },
    },
    permission: 'AUTO',
    category: 'note',
    availableInPlanMode: true,
    executor: async (_args: Record<string, unknown>): Promise<ToolResult> => {
      try {
        const { fileService } = await import('@/services/fileService')
        const dir = await getNotesDir()
        const files = await fileService.listDir(dir)
        const mdFiles = (files as string[]).filter((f: string) => f.endsWith('.md'))
        return {
          status: 'success',
          summary: `${mdFiles.length} 个草稿`,
          detail: mdFiles.join('\n') || '(无草稿)',
        }
      } catch (e) {
        return { status: 'error', summary: `列出草稿失败: ${e instanceof Error ? e.message : '未知错误'}` }
      }
    },
  },

  {
    schema: {
      name: 'read_note',
      description:
        '读取指定草稿笔记的完整内容。何时使用：需要查看某篇草稿的具体内容时。note_name 是文件名（如"灵感记录.md"），先用 list_notes 确认文件名。注意区分：读取项目文件用 read_file，读取草稿用 read_note。',
      parameters: {
        type: 'object',
        properties: {
          note_name: { type: 'string', description: '草稿文件名' },
        },
        required: ['note_name'],
      },
    },
    permission: 'AUTO',
    category: 'note',
    availableInPlanMode: true,
    executor: async (args: Record<string, unknown>): Promise<ToolResult> => {
      try {
        const { sanitizeFileName } = await import('@/utils/security')
        const { fileService } = await import('@/services/fileService')
        const noteName = sanitizeFileName(args.note_name).value
        if (!noteName) return { status: 'error', summary: '草稿名称无效' }
        const dir = await getNotesDir()
        const content = await fileService.read(`${dir}/${noteName}`)
        return { status: 'success', summary: `已读取: ${noteName}`, detail: content || '(草稿为空)' }
      } catch (e) {
        return { status: 'error', summary: `读取草稿失败: ${e instanceof Error ? e.message : '未知错误'}` }
      }
    },
  },

  {
    schema: {
      name: 'write_note',
      description:
        '创建或覆写草稿笔记。何时使用：记录灵感、保存分析结果、暂存对话中的重要信息。如果文件已存在会覆写全文——如果只想追加内容请用 append_note。草稿是全局的不绑定项目。',
      parameters: {
        type: 'object',
        properties: {
          note_name: { type: 'string', description: '草稿文件名' },
          content: { type: 'string', description: '完整内容（Markdown）' },
        },
        required: ['note_name', 'content'],
      },
    },
    permission: 'READ_ASK',
    category: 'note',
    availableInPlanMode: true,
    executor: async (args: Record<string, unknown>): Promise<ToolResult> => {
      try {
        const { sanitizeFileName } = await import('@/utils/security')
        const { fileService } = await import('@/services/fileService')
        let noteName = sanitizeFileName(args.note_name).value
        if (!noteName) return { status: 'error', summary: '草稿名称无效' }
        // Auto-append .md extension so note is visible in list_notes
        if (!noteName.endsWith('.md')) noteName += '.md'
        const dir = await getNotesDir()
        const filePath = `${dir}/${noteName}`.replace(/\\/g, '/')
        const content = String(args.content || '')
        await fileService.write(filePath, content)
        return { status: 'success', summary: `已写入草稿: ${noteName} (${content.length} 字符)` }
      } catch (e) {
        return { status: 'error', summary: `写入草稿失败: ${e instanceof Error ? e.message : '未知错误'}` }
      }
    },
  },

  {
    schema: {
      name: 'append_note',
      description: '向草稿笔记末尾追加内容。文件不存在则自动创建。',
      parameters: {
        type: 'object',
        properties: {
          note_name: { type: 'string', description: '草稿文件名' },
          content: { type: 'string', description: '要追加的内容' },
        },
        required: ['note_name', 'content'],
      },
    },
    permission: 'READ_ASK',
    category: 'note',
    availableInPlanMode: true,
    executor: async (args: Record<string, unknown>): Promise<ToolResult> => {
      try {
        const { sanitizeFileName } = await import('@/utils/security')
        const { fileService } = await import('@/services/fileService')
        let noteName = sanitizeFileName(args.note_name).value
        if (!noteName) return { status: 'error', summary: '草稿名称无效' }
        if (!noteName.endsWith('.md')) noteName += '.md'
        const dir = await getNotesDir()
        const filePath = `${dir}/${noteName}`.replace(/\\/g, '/')
        const newContent = String(args.content || '')
        // Serialize append operations to prevent lost updates
        await withAppendLock(filePath, async () => {
          let existing = ''
          try {
            existing = await fileService.read(filePath)
          } catch {
            /* new file — no existing content */
          }
          const combined = existing ? existing + '\n\n' + newContent : newContent
          await fileService.write(filePath, combined)
        })
        return { status: 'success', summary: `已追加到草稿: ${noteName} (+${newContent.length} 字符)` }
      } catch (e) {
        return { status: 'error', summary: `追加草稿失败: ${e instanceof Error ? e.message : '未知错误'}` }
      }
    },
  },

  {
    schema: {
      name: 'delete_note',
      description: '删除 notes/ 目录下的草稿笔记文件。',
      parameters: {
        type: 'object',
        properties: {
          note_name: { type: 'string', description: '草稿文件名' },
        },
        required: ['note_name'],
      },
    },
    permission: 'DANGEROUS_ASK',
    category: 'note',
    availableInPlanMode: true,
    executor: async (args: Record<string, unknown>): Promise<ToolResult> => {
      try {
        const { sanitizeFileName } = await import('@/utils/security')
        const { fileService } = await import('@/services/fileService')
        const noteName = sanitizeFileName(args.note_name).value
        if (!noteName) return { status: 'error', summary: '草稿名称无效' }
        const dir = await getNotesDir()
        const filePath = `${dir}/${noteName}`.replace(/\\/g, '/')
        await fileService.deleteFile(filePath)
        return { status: 'success', summary: `已删除草稿: ${noteName}` }
      } catch (e) {
        return { status: 'error', summary: `删除草稿失败: ${e instanceof Error ? e.message : '未知错误'}` }
      }
    },
  },

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
    availableInPlanMode: true,
    executor: async (args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> => {
      try {
        // Guard: window.electron may not exist in test/Node.js environments
        const win = typeof window !== 'undefined' ? (window as any) : null
        if (!win?.electron?.notes?.search) {
          return { status: 'error', summary: '笔记搜索不可用（非 Electron 环境或 notes API 未就绪）' }
        }
        const results =
          (await win.electron.notes.search(
            args.query as string,
            ctx.configId,
            (args.topK as number) || 3,
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
        return {
          status: 'error',
          summary: `搜索笔记失败: ${e instanceof Error ? e.message : '未知错误'}`,
        }
      }
    },
  },
]
