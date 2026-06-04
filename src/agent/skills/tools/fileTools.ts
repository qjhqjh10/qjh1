// ── File Tools (8 tools) ──
// Self-contained for skill system. Uses @/services/fileService backend via IPC.
// NOTE: read_file executor checks the shared FileCache (src/agent/context/FileCache)
// before making the IPC call. This avoids redundant reads within the same session.
// The cache is maintained externally; this executor reads from it but does not
// directly import from the old agent/context/ directory to stay self-contained.

import type { ToolDefinition, ToolResult, ToolExecutionContext } from '../types'

// ── Helper: IPC call for backend file tools ──
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
  // ── Read-only tools ──

  {
    schema: {
      name: 'list_directory',
      description:
        '列出软件内全部文件，支持 Glob 模式过滤。直接并行扫描全局资源(风格/场景/KB/上传/笔记)+所有项目目录。不填 pattern 列出全部。若找电脑其他位置设 broad=true(需批准)。',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob 模式过滤文件名，如 "*.json" "chapter*.txt"。不填则列出全部' },
          broad: { type: 'boolean', description: '搜索电脑桌面/文档/下载(需批准)' },
        },
        required: [],
      },
    },
    permission: 'AUTO',
    category: 'file',
    availableInPlanMode: true,
    executor: async (args, ctx) => ipcExecute('list_directory', args, ctx),
  },

  {
    schema: {
      name: 'read_file',
      description:
        '读取文件完整内容。何时使用：读角色/大纲/章节/细纲等。修改前必须先 read_file 确认原文。项目文件路径: 项目名/子路径（如 1/outline/plot.md）。全局文件路径: ../../前缀（如 ../../style_templates/模板名.yaml、../../knowledge_base/files/文件名.md）。不确定时用 list_directory 查找。返回内容在 detail 字段。',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '相对路径' },
        },
        required: ['file_path'],
      },
    },
    permission: 'AUTO',
    category: 'file',
    availableInPlanMode: true,
    executor: async (args, ctx) => {
      // NOTE: The shared FileCache (src/agent/context/FileCache) is checked first
      // inside the backend IPC handler for read_file, so the cache benefit is
      // retained without importing from the old agent/context/ directory here.
      return ipcExecute('read_file', args, ctx)
    },
  },

  {
    schema: {
      name: 'search_content',
      description:
        '在项目文件中搜索指定文本内容。默认子串匹配。设 regex=true 启用正则。设 context_around 获取匹配行前后上下文。file_pattern 支持 glob（如 "**/*.json"）。最多返回 500 条。' +
        '⚠️ 仅搜索项目目录。要在电脑全局搜索某文件内的文字→先用 find_files(scope="computer") 定位文件，再 read_file 查看内容。',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: '要搜索的文本（默认子串匹配，regex=true 时为正则）' },
          regex: { type: 'boolean', description: 'pattern 是否为正则表达式（默认 false）。解析失败时自动降级为子串匹配' },
          case_sensitive: { type: 'boolean', description: '是否区分大小写（默认 false）' },
          file_pattern: { type: 'string', description: 'Glob 模式过滤文件，如 "*.json" "**/*.md" "chapter*.txt"' },
          dir_path: { type: 'string', description: '搜索起始目录，默认项目根目录' },
          context_around: { type: 'number', description: '匹配行前后各N行上下文（默认 0）。设置后可减少后续 read_file 调用' },
          context_before: { type: 'number', description: '匹配行前N行（覆盖 context_around）' },
          context_after: { type: 'number', description: '匹配行后N行（覆盖 context_around）' },
          max_results: { type: 'number', description: '最大返回结果数（默认 500）' },
          max_columns: { type: 'number', description: '每行最大字符数（默认 200）' },
          multiline: { type: 'boolean', description: '跨行搜索模式（默认 false）。启用后 pattern 可包含 \\n 匹配换行符' },
        },
        required: ['pattern'],
      },
    },
    permission: 'AUTO',
    category: 'file',
    availableInPlanMode: true,
    executor: async (args, ctx) => ipcExecute('search_content', args, ctx),
  },

  // ── Write tool ──

  {
    schema: {
      name: 'edit_file',
      description:
        '精确字符串替换编辑已有文件。何时使用：修改文件部分内容（改角色属性、追加大纲段落、修正错字）。小幅修改优先于全量替换。必须先 read_file 确认原文——old_string 必须与文件逐字精确匹配（含换行和空格）。old_string 匹配失败时可用 "__FULL_REPLACE__" 做全量替换。replace_all=true 替换所有匹配处。',
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
    executor: async (args, ctx) => ipcExecute('edit_file', args, ctx),
  },

  // ── Dangerous tools ──

  {
    schema: {
      name: 'create_file',
      description:
        '创建新文件并写入内容。何时使用：创建新角色YAML、新章节正文、新细纲YAML、新摘要文件。项目内路径: 项目名/子路径（如 1/characters/林语晴.yaml）。KB文件路径: ../../knowledge_base/files/文件名.md。创建前先 read_file 参考已有同类型文件格式。自动创建不存在的父目录。需要用户确认。',
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
        const results = await aiService.executeFileTools([
          { callId: ctx.callId, toolName: 'create_file', args, confirmed: true },
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
      description:
        '删除项目文件。不可恢复。何时使用：仅当用户明确要求删除文件时。删除前向用户确认文件名是否正确。需要用户确认。',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '相对路径' },
        },
        required: ['file_path'],
      },
    },
    permission: 'DANGEROUS_ASK',
    category: 'file',
    availableInPlanMode: false,
    executor: async (args, ctx) => {
      try {
        const { aiService } = await import('@/services/fileService')
        const results = await aiService.executeFileTools([
          { callId: ctx.callId, toolName: 'delete_file', args, confirmed: true },
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
      description:
        '重命名或移动文件。何时使用：用户要求改名或调整文件位置时。new_path 可以是新文件名（同一目录）或新路径（移动到其他目录）。需要用户确认。',
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
        const results = await aiService.executeFileTools([
          { callId: ctx.callId, toolName: 'rename_file', args, confirmed: true },
        ])
        return results[0] || { status: 'error', summary: '无响应' }
      } catch (e) {
        return { status: 'error', summary: `重命名失败: ${e instanceof Error ? e.message : '未知错误'}` }
      }
    },
  },

  // ── File search tool (recursive) ──

  {
    schema: {
      name: 'find_files',
      description:
        '按文件名模式递归搜索文件。支持 Glob 模式（如 "*.json" "chapter*" "林*"）。' +
        'scope="project"（默认）：搜索项目+全局资源目录。' +
        'scope="computer"：搜索用户主目录下的常见文件夹（需用户审批）。' +
        '最多返回 200 条，递归深度限制 5 层。跳过 node_modules/.git/AppData 等系统目录。',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob 模式匹配文件名，如 "*.yaml" "chapter*" "林*"' },
          scope: { type: 'string', description: '搜索范围: "project"(默认) 或 "computer"(需审批)' },
          dir_path: { type: 'string', description: '指定起始目录（scope=computer时可选）' },
          max_depth: { type: 'number', description: '最大递归深度（默认 5，最大 10）' },
        },
        required: ['pattern'],
      },
    },
    permission: 'READ_ASK',
    category: 'file',
    availableInPlanMode: true,
    executor: async (args, ctx) => ipcExecute('find_files', args, ctx),
  },
]
