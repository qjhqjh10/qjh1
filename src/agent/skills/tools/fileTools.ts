// ── File Tools (9 tools) ──
// Tool descriptions are minimal — path references, format details, and operation
// guides are in CORE_SYSTEM_PROMPT. Each tool only describes its function + params.

import type { ToolDefinition, ToolResult, ToolExecutionContext } from '../types'

async function ipcExecute(
  toolName: string,
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
): Promise<ToolResult> {
  try {
    const { aiService } = await import('@/services/fileService')
    const callId = `${toolName}_${Date.now().toString(36)}`
    const results = await aiService.executeFileTools([{ callId, toolName, args }])
    return results[0] || { status: 'error', summary: '无响应' }
  } catch (e) {
    return { status: 'error', summary: `${toolName} 失败: ${e instanceof Error ? e.message : '未知错误'}` }
  }
}

export const fileTools: ToolDefinition[] = [
  {
    schema: {
      name: 'list_directory',
      description: '列出目录内容（单层，不递归）。路径参考 System Prompt 路径速查。',
      parameters: {
        type: 'object',
        properties: {
          dir_path: { type: 'string', description: '目录路径。不填则列出项目+全局资源目录。' },
          pattern: { type: 'string', description: 'Glob 过滤，如 "*.yaml"' },
          broad: { type: 'boolean', description: '同时扫描电脑常用目录（桌面/文档/下载）' },
        },
        required: [],
      },
    },
    // v14.5.1 全自由模式（个人使用）：目录浏览一律免审批；系统目录由 IPC 层硬拦截
    permission: 'AUTO',
    category: 'file',
    executor: async (args, ctx) => ipcExecute('list_directory', args, ctx),
  },

  {
    schema: {
      name: 'read_file',
      description: '读取文件内容。路径参考 System Prompt 路径速查。支持 offset/limit 部分读取。',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '相对路径' },
          offset: { type: 'number', description: '起始字符位置（默认0）' },
          limit: { type: 'number', description: '最大字符数（默认全文，上限50万）' },
        },
        required: ['file_path'],
      },
    },
    permission: 'AUTO',
    category: 'file',
    executor: async (args, ctx) => ipcExecute('read_file', args, ctx),
  },

  {
    schema: {
      name: 'search_content',
      description: '按文本内容搜索文件（子串/正则）。路径参考 System Prompt 路径速查。',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: '搜索文本（默认子串，regex=true 时为正则）' },
          regex: { type: 'boolean', description: '是否正则（默认 false）' },
          case_sensitive: { type: 'boolean', description: '区分大小写（默认 false）' },
          file_pattern: { type: 'string', description: 'Glob 过滤文件，如 "*.yaml"' },
          dir_path: { type: 'string', description: '搜索起始目录，默认项目根' },
          context_around: { type: 'number', description: '匹配行前后各N行上下文' },
          context_before: { type: 'number', description: '匹配行前N行' },
          context_after: { type: 'number', description: '匹配行后N行' },
          max_results: { type: 'number', description: '最大结果数（默认500）' },
          max_columns: { type: 'number', description: '每行最大字符（默认200）' },
          multiline: { type: 'boolean', description: '跨行搜索（默认 false）' },
        },
        required: ['pattern'],
      },
    },
    permission: 'AUTO',
    category: 'file',
    executor: async (args, ctx) => ipcExecute('search_content', args, ctx),
  },

  {
    schema: {
      name: 'edit_file',
      description: '精确字符串替换。old_string 逐字匹配，设为 __FULL_REPLACE__ 覆盖全文。操作指南见 System Prompt。',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '相对路径' },
          old_string: { type: 'string', description: '被替换原文（或 __FULL_REPLACE__ 全量覆盖）' },
          new_string: { type: 'string', description: '替换后文本' },
          replace_all: { type: 'boolean', description: '替换所有匹配处' },
        },
        required: ['file_path', 'old_string', 'new_string'],
      },
    },
    permission: 'AUTO',
    category: 'file',
    executor: async (args, ctx) => {
      try {
        const { aiService } = await import('@/services/fileService')
        const results = await aiService.executeFileTools([
          { callId: ctx.callId, toolName: 'edit_file', args },
        ])
        return results[0] || { status: 'error', summary: '无响应' }
      } catch (e) {
        return { status: 'error', summary: `编辑文件失败: ${e instanceof Error ? e.message : '未知错误'}` }
      }
    },
  },

  {
    schema: {
      name: 'batch_replace',
      description: '同文件多段批量替换，每段替换所有匹配处（全局替换语义），按顺序应用。任一失败则停止。操作指南见 System Prompt。',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '相对路径' },
          replacements: {
            type: 'array',
            description: '替换列表 [{old_string, new_string}]',
            items: {
              type: 'object',
              properties: {
                old_string: { type: 'string', description: '被替换原文' },
                new_string: { type: 'string', description: '替换后文本' },
              },
              required: ['old_string', 'new_string'],
            },
          },
        },
        required: ['file_path', 'replacements'],
      },
    },
    permission: 'AUTO',
    category: 'file',
    executor: async (args, ctx) => {
      try {
        const { aiService } = await import('@/services/fileService')
        const results = await aiService.executeFileTools([
          { callId: ctx.callId, toolName: 'batch_replace', args },
        ])
        return results[0] || { status: 'error', summary: '无响应' }
      } catch (e) {
        return { status: 'error', summary: `批量替换失败: ${e instanceof Error ? e.message : '未知错误'}` }
      }
    },
  },

  {
    schema: {
      name: 'create_file',
      description: '创建新文件。自动创建父目录。路径和格式参考 System Prompt 路径速查+写作规范手册。',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '相对路径' },
          content: { type: 'string', description: '文件内容' },
        },
        required: ['file_path', 'content'],
      },
    },
    permission: 'AUTO',
    category: 'file',
    executor: async (args, ctx) => {
      try {
        const { aiService } = await import('@/services/fileService')
        const results = await aiService.executeFileTools([
          { callId: ctx.callId, toolName: 'create_file', args },
        ])
        return results[0] || { status: 'error', summary: '无响应' }
      } catch (e) {
        return { status: 'error', summary: `创建文件失败: ${e instanceof Error ? e.message : '未知错误'}` }
      }
    },
  },

  {
    schema: {
      name: 'delete_file',
      description: '删除文件（系统自动备份原文件到 .ai_backups/，可在文件管理器中手动恢复）。',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '相对路径' },
        },
        required: ['file_path'],
      },
    },
    // v14.5.1 全自由模式：删除免审批（自动备份 + 操作历史留痕，事后可查）
    permission: 'AUTO',
    category: 'file',
    executor: async (args, ctx) => {
      try {
        const { aiService } = await import('@/services/fileService')
        const results = await aiService.executeFileTools([
          { callId: ctx.callId, toolName: 'delete_file', args },
        ])
        return results[0] || { status: 'error', summary: '无响应' }
      } catch (e) {
        return { status: 'error', summary: `删除文件失败: ${e instanceof Error ? e.message : '未知错误'}` }
      }
    },
  },

  {
    schema: {
      name: 'rename_file',
      description: '重命名或移动文件。',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '当前路径' },
          new_path: { type: 'string', description: '新路径' },
        },
        required: ['file_path', 'new_path'],
      },
    },
    // v14.5.1 全自由模式：重命名免审批（操作历史留痕）
    permission: 'AUTO',
    category: 'file',
    executor: async (args, ctx) => {
      try {
        const { aiService } = await import('@/services/fileService')
        const results = await aiService.executeFileTools([
          { callId: ctx.callId, toolName: 'rename_file', args },
        ])
        return results[0] || { status: 'error', summary: '无响应' }
      } catch (e) {
        return { status: 'error', summary: `重命名失败: ${e instanceof Error ? e.message : '未知错误'}` }
      }
    },
  },

  {
    schema: {
      name: 'find_files',
      description: '按文件名 Glob 模式递归搜索。路径参考 System Prompt 路径速查。',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob 模式（必填），如 "*.yaml" "chapter*"' },
          scope: { type: 'string', description: '"project"(默认，软件目录) 或 "computer"(桌面/文档/下载等常用目录)' },
          dir_path: { type: 'string', description: '额外搜索目录' },
          max_depth: { type: 'number', description: '递归深度（默认5，最大10）' },
        },
        required: ['pattern'],
      },
    },
    // v14.5.1 全自由模式：两 scope 一律免审批；系统目录由 IPC 层硬拦截
    permission: 'AUTO',
    category: 'file',
    executor: async (args, ctx) => ipcExecute('find_files', args, ctx),
  },
]
