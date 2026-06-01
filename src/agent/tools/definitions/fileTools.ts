import type { ToolDefinition } from '../ToolRegistry'
import type { ToolResult, ToolExecutionContext } from '../../state/types'

// ── Helper: IPC call for backend file tools ──
async function ipcExecute(toolName: string, args: Record<string, unknown>, projectId: string | null): Promise<ToolResult> {
  try {
    const { aiService } = await import('@/services/fileService')
    const callId = `${toolName}_${Date.now().toString(36)}`
    const results = await aiService.executeFileTools([{ callId, toolName, args }])
    return results[0] || { status: 'error', summary: '无响应' }
  } catch (e) { return { status: 'error', summary: `${toolName} 失败: ${e instanceof Error ? e.message : '未知错误'}` } }
}

export const fileTools: ToolDefinition[] = [
  // ── Read-only ──
  {
    schema: {
      name: 'list_directory',
      description: '列出目录中的文件和子目录。⚠️ 项目索引已包含所有文件路径和数量——列出内容时直接用索引回复，绝大多数情况不需要此工具。仅在极少数确实需要查看子目录结构细节时使用（如确认 uploads 目录内容）。',
      parameters: { type: 'object', properties: { dir_path: { type: 'string', description: '相对于项目根目录的路径' } }, required: ['dir_path'] },
    },
    permission: 'AUTO',
    category: 'file',
    availableInPlanMode: true,
    executor: async (args, ctx) => ipcExecute('list_directory', args, ctx.projectId),
  },
  {
    schema: {
      name: 'read_file',
      description: '读取项目文件的完整文本内容。何时使用：需要了解大纲、角色设定、细纲、章节正文的具体内容时。修改文件前必须先调用此工具确认原文——否则 edit_file 的 old_string 无法匹配。路径相对于项目根目录（如 outline/plot.md、characters/许倩.json）。不确定路径时先用 search_files 查找。返回完整内容在 detail 字段。',
      parameters: { type: 'object', properties: { file_path: { type: 'string', description: '相对路径' } }, required: ['file_path'] },
    },
    permission: 'AUTO',
    category: 'file',
    availableInPlanMode: true,
    executor: async (args, ctx) => ipcExecute('read_file', args, ctx.projectId),
  },
  {
    schema: {
      name: 'search_files',
      description: '按文件名关键词搜索项目文件。⚠️ 项目索引已列出所有文件，已知文件名时直接 read_file 即可。仅在不记得具体文件名、需要模糊匹配时使用。',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '文件名关键词' },
          dir_path: { type: 'string', description: '起始目录' },
        },
        required: ['keyword'],
      },
    },
    permission: 'AUTO',
    category: 'file',
    availableInPlanMode: true,
    executor: async (args, ctx) => ipcExecute('search_files', args, ctx.projectId),
  },
  {
    schema: {
      name: 'search_content',
      description: '在项目文件中搜索指定文本内容。何时使用：需要找到某个角色名、关键词或文本片段在哪些文件中出现时。支持正则表达式。可用 file_pattern 限定搜索范围（如 "*.json" 只搜JSON文件）。找到匹配后对目标文件调用 read_file 获取完整上下文。',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: '要搜索的文本' },
          file_pattern: { type: 'string', description: '限定文件类型，如 "*.json"' },
          dir_path: { type: 'string', description: '起始目录' },
        },
        required: ['pattern'],
      },
    },
    permission: 'AUTO',
    category: 'file',
    availableInPlanMode: true,
    executor: async (args, ctx) => ipcExecute('search_content', args, ctx.projectId),
  },

  // ── Write ──
  {
    schema: {
      name: 'edit_file',
      description: '精确字符串替换编辑已有文件。何时使用：修改文件部分内容（改角色属性、追加大纲段落、修正错字）。小幅修改优先于全量替换。必须先 read_file 确认原文——old_string 必须与文件逐字精确匹配（含换行和空格）。old_string 匹配失败时可用 "__FULL_REPLACE__" 做全量替换。replace_all=true 替换所有匹配处。',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '相对路径' },
          old_string: { type: 'string', description: '要被替换的原文' },
          new_string: { type: 'string', description: '替换后的新文本' },
          replace_all: { type: 'boolean', description: '是否替换所有匹配处' },
        },
        required: ['file_path', 'old_string', 'new_string'],
      },
    },
    permission: 'PROJECT_ASK',
    category: 'file',
    availableInPlanMode: false,
    executor: async (args, ctx) => ipcExecute('edit_file', args, ctx.projectId),
  },

  // ── Dangerous ──
  {
    schema: {
      name: 'create_file',
      description: '创建新文件并写入内容。何时使用：创建新角色JSON、新章节正文、新细纲JSON、新摘要文件。创建角色用 characters/{拼音id}.json，细纲用 detailed_outline/{id}.json。创建前先 read_file 参考已有同类型文件格式。会自动创建不存在的父目录。需要用户确认。',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '相对路径' },
          content: { type: 'string', description: '文件内容' },
        },
        required: ['file_path', 'content'],
      },
    },
    permission: 'DANGEROUS_ASK',
    category: 'file',
    availableInPlanMode: false,
    executor: async (args, ctx) => {
      try {
        const { aiService } = await import('@/services/fileService')
        const results = await aiService.executeFileTools([{ callId: 'tool', toolName: 'create_file', args, confirmed: true }])
        return results[0] || { status: 'error', summary: '无响应' }
      } catch (e) { return { status: 'error', summary: `创建文件失败: ${e instanceof Error ? e.message : '未知错误'}` } }
    },
  },
  {
    schema: {
      name: 'delete_file',
      description: '删除项目文件。不可恢复。何时使用：仅当用户明确要求删除文件时。删除前向用户确认文件名是否正确。需要用户确认。',
      parameters: {
        type: 'object',
        properties: { file_path: { type: 'string', description: '相对路径' } },
        required: ['file_path'],
      },
    },
    permission: 'DANGEROUS_ASK',
    category: 'file',
    availableInPlanMode: false,
    executor: async (args, ctx) => {
      try {
        const { aiService } = await import('@/services/fileService')
        const results = await aiService.executeFileTools([{ callId: 'tool', toolName: 'delete_file', args, confirmed: true }])
        return results[0] || { status: 'error', summary: '无响应' }
      } catch (e) { return { status: 'error', summary: `删除文件失败: ${e instanceof Error ? e.message : '未知错误'}` } }
    },
  },
  {
    schema: {
      name: 'rename_file',
      description: '重命名或移动文件。何时使用：用户要求改名或调整文件位置时。new_path 可以是新文件名（同一目录）或新路径（移动到其他目录）。需要用户确认。',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '当前路径' },
          new_path: { type: 'string', description: '新路径' },
        },
        required: ['file_path', 'new_path'],
      },
    },
    permission: 'DANGEROUS_ASK',
    category: 'file',
    availableInPlanMode: false,
    executor: async (args, ctx) => {
      try {
        const { aiService } = await import('@/services/fileService')
        const results = await aiService.executeFileTools([{ callId: 'tool', toolName: 'rename_file', args, confirmed: true }])
        return results[0] || { status: 'error', summary: '无响应' }
      } catch (e) { return { status: 'error', summary: `重命名失败: ${e instanceof Error ? e.message : '未知错误'}` } }
    },
  },
]
