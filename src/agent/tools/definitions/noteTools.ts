import type { ToolDefinition } from '../ToolRegistry'

// Helper: resolve global notes directory via dynamic import
async function getNotesDir(): Promise<string> {
  try {
    const { useStore } = await import('@/store')
    return (useStore.getState().projectsBasePath || '').replace(/[/\\]projects[/\\]?$/, '/notes')
  } catch {
    return ''
  }
}

function sanitizeFileName(name: string): string {
  return String(name || '').replace(/\.\./g, '').replace(/[\\/]/g, '')
}

export const noteTools: ToolDefinition[] = [
  {
    schema: {
      name: 'list_notes',
      description: '列出全局 notes/ 目录下的所有草稿笔记。',
      parameters: { type: 'object', properties: {}, required: [] },
    },
    permission: 'AUTO',
    category: 'note',
    availableInPlanMode: true,
    executor: async () => {
      const { fileService } = await import('@/services/fileService')
      const dir = await getNotesDir()
      const files = await fileService.listDir(dir)
      const mdFiles = files.filter((f: string) => f.endsWith('.md'))
      return { status: 'success', summary: `${mdFiles.length} 个草稿`, detail: mdFiles.join('\n') || '(无草稿)' }
    },
  },
  {
    schema: {
      name: 'read_note',
      description: '读取指定草稿笔记的完整内容。',
      parameters: {
        type: 'object',
        properties: { note_name: { type: 'string', description: '草稿文件名' } },
        required: ['note_name'],
      },
    },
    permission: 'AUTO',
    category: 'note',
    availableInPlanMode: true,
    executor: async (args) => {
      const { fileService } = await import('@/services/fileService')
      const noteName = sanitizeFileName(args.note_name as string)
      if (!noteName) return { status: 'error', summary: '草稿名称无效' }
      const dir = await getNotesDir()
      const content = await fileService.read(`${dir}/${noteName}`)
      return { status: 'success', summary: `已读取: ${noteName}`, detail: content || '(草稿为空)' }
    },
  },
  {
    schema: {
      name: 'write_note',
      description: '创建或覆写草稿笔记。',
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
    executor: async (args) => {
      const { fileService } = await import('@/services/fileService')
      const noteName = sanitizeFileName(args.note_name as string)
      if (!noteName) return { status: 'error', summary: '草稿名称无效' }
      const dir = await getNotesDir()
      const filePath = `${dir}/${noteName}`.replace(/\\/g, '/')
      const content = String(args.content || '')
      await fileService.write(filePath, content)
      return { status: 'success', summary: `已写入草稿: ${noteName} (${content.length} 字符)` }
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
    executor: async (args) => {
      const { fileService } = await import('@/services/fileService')
      const noteName = sanitizeFileName(args.note_name as string)
      if (!noteName) return { status: 'error', summary: '草稿名称无效' }
      const dir = await getNotesDir()
      const filePath = `${dir}/${noteName}`.replace(/\\/g, '/')
      const newContent = String(args.content || '')
      let existing = ''
      try { existing = await fileService.read(filePath) } catch { /* new file */ }
      const combined = existing ? existing + '\n\n' + newContent : newContent
      await fileService.write(filePath, combined)
      return { status: 'success', summary: `已追加到草稿: ${noteName} (+${newContent.length} 字符)` }
    },
  },
  {
    schema: {
      name: 'delete_note',
      description: '删除 notes/ 目录下的草稿笔记文件。',
      parameters: {
        type: 'object',
        properties: { note_name: { type: 'string', description: '草稿文件名' } },
        required: ['note_name'],
      },
    },
    permission: 'READ_ASK',
    category: 'note',
    availableInPlanMode: true,
    executor: async (args) => {
      const { fileService } = await import('@/services/fileService')
      const noteName = sanitizeFileName(args.note_name as string)
      if (!noteName) return { status: 'error', summary: '草稿名称无效' }
      const dir = await getNotesDir()
      const filePath = `${dir}/${noteName}`.replace(/\\/g, '/')
      await fileService.deleteFile(filePath)
      return { status: 'success', summary: `已删除草稿: ${noteName}` }
    },
  },
]
