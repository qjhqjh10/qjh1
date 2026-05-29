import type { ToolDefinition } from '../ToolRegistry'
import type { ToolResult, ToolExecutionContext } from '../../runtime/AgentRuntime'

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
      description: '列出项目目录中的文件和子目录。返回 { status, summary, detail: "条目列表" }，条目带 [DIR]/[FILE] 前缀。空目录显示"(空目录)"。路径相对于当前项目根目录。',
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
      description: '读取项目文件的完整文本内容。返回 { status:"success"|"error", summary, detail: "文件内容" }。文件不存在时 status="error"、summary="文件不存在"。路径相对于当前项目根目录。',
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
      description: '在项目目录中按文件名关键词搜索文件。支持子串匹配（如"ch01"可匹配"chapter01.txt"）。返回 { status, summary, detail: "匹配的文件列表" }。',
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
      description: '在项目文件中搜索指定文本（支持正则）。返回 { status, summary, detail: "匹配行列表" }。可用 file_pattern 限定文件类型如 "*.json"。',
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
      description: '精确字符串替换编辑文件。必须先 read_file 确认内容。old_string 必须在文件中唯一全匹配。失败时用 old_string="__FULL_REPLACE__" 做全量替换。replace_all=true 替换所有匹配处。返回 { status, summary }。',
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
      description: '创建新文件并写入内容。需要用户确认。',
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
      description: '删除文件。需要用户确认。',
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
      description: '重命名或移动文件。需要用户确认。',
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
