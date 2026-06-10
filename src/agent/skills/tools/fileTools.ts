// ── File Tools (9 tools) ──
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
        '列出指定目录内容（单层，不递归子目录）。\n\n' +
        '📁 支持目录:\n' +
        '- 项目内: {项目名}/ / characters/ / chapters/ / outline/ / detailed_outline/ / summaries/\n' +
        '- 全局: ../notes/ / ../knowledge_base/files/ / ../style_templates/ / ../scene_templates/ / ../uploads/\n' +
        '- 项目列表: projects/\n' +
        '- 用户任意指定目录\n\n' +
        '💡 已知路径时直接 read_file 即可，不必先 list_directory。确认目录状态、探索未知目录时使用。\n' +
        'pattern → Glob 过滤（如 "*.yaml"）。broad=true → 搜索电脑目录（需审批）。',
      parameters: {
        type: 'object',
        properties: {
          dir_path: { type: 'string', description: '目录路径。如"projects/"看项目列表，"1/characters"看角色，"../style_templates"看模板。不填则列出项目+全局资源目录。' },
          pattern: { type: 'string', description: 'Glob 过滤文件名，如 "*.json"。不填列出全部。支持 ** 做一层子目录匹配。' },
          broad: { type: 'boolean', description: '搜索电脑桌面/文档/下载目录（需审批）' },
        },
        required: [],
      },
    },
    permission: 'READ_ASK',
    category: 'file',
    executor: async (args, ctx) => ipcExecute('list_directory', args, ctx),
  },

  {
    schema: {
      name: 'read_file',
      description:
        '读取文件完整内容。支持所有文件类型和路径：\n' +
        '📁 项目内: {项目}/characters/*.yaml / chapters/*.txt / outline/*.md / outline/*.yaml / detailed_outline/*.yaml / summaries/*.md / 任意用户文件\n' +
        '📁 全局: ../notes/*.md / ../knowledge_base/files/*.md / ../style_templates/* / ../scene_templates/* / ../uploads/*\n' +
        '📁 模板: ../.aiharness/templates/* (16个格式模板)\n' +
        '📁 规则: ../.aiharness/rules/*\n\n' +
        '💡 不确定文件路径 → 用 find_files。修改前必须 read_file 确认原文再 edit_file。',
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
        '按文本内容搜索文件。默认子串匹配。\n' +
        '📁 搜索范围: 默认项目目录。dir_path="../" → 全局（notes/knowledge_base/style_templates/scene_templates/uploads）。\n' +
        '💡 regex=true → 正则 / context_around → 上下文行 / file_pattern → Glob过滤 / multiline → 跨行 / 最多500条。',
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
    executor: async (args, ctx) => ipcExecute('search_content', args, ctx),
  },

  // ── Write tool ──

  {
    schema: {
      name: 'edit_file',
      description:
        '精确字符串替换编辑。支持所有文件类型，路径与 create_file 相同：\n' +
        '项目内: {项目}/characters/*.yaml / chapters/*.txt / detailed_outline/*.yaml / summaries/*.md / outline/*.md / outline/*.yaml / 任意用户文件\n' +
        '全局: ../knowledge_base/files/*.md / ../notes/*.md / ../style_templates/*.yaml / ../scene_templates/*.yaml / 任意全局路径\n' +
        '\n规则:\n' +
        '- 必须先 read_file 确认原文 — old_string 必须逐字精确匹配（含换行和空格）\n' +
        '- old_string 设为 "__FULL_REPLACE__" 可全量替换（空文件或需要完全重写时用）\n' +
        '- replace_all: true 替换所有匹配处\n' +
        '- 小幅精准修改优先于全量替换\n' +
        '- 自动创建备份（.ai_backups/），可 restore_backup 恢复',
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
    permission: 'AUTO',
    category: 'file',
    executor: async (args, ctx) => {
      try {
        const { aiService } = await import('@/services/fileService')
        const results = await aiService.executeFileTools([
          { callId: ctx.callId, toolName: 'edit_file', args, confirmed: true },
        ])
        return results[0] || { status: 'error', summary: '无响应' }
      } catch (e) {
        return { status: 'error', summary: `编辑文件失败: ${e instanceof Error ? e.message : '未知错误'}` }
      }
    },
  },

  // ── Batch replace tool ──

  {
    schema: {
      name: 'batch_replace',
      description:
        '在单个文件中执行多个精确字符串替换，按数组顺序依次应用。\n' +
        '比多次调用 edit_file 更高效（减少工具调用轮次），且保证替换顺序。\n' +
        '适用: 批量修正错别字、多处追加大纲/世界观、格式化调整、同时改多个角色属性。\n' +
        '适用路径: 与 edit_file 相同（项目内/全局/任意用户文件）。\n' +
        '规则: 必须先 read_file 确认原文。每个 old_string 必须逐字精确匹配。任一替换失败则停止后续替换并报错。',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '相对路径' },
          replacements: {
            type: 'array',
            description: '替换列表，按数组顺序依次执行。每项含 old_string（要被替换的原文）和 new_string（替换后的新文本）',
            items: {
              type: 'object',
              properties: {
                old_string: { type: 'string', description: '要被替换的原文（必须逐字精确匹配，含换行和空格）' },
                new_string: { type: 'string', description: '替换后的新文本' },
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
          { callId: ctx.callId, toolName: 'batch_replace', args, confirmed: true },
        ])
        return results[0] || { status: 'error', summary: '无响应' }
      } catch (e) {
        return { status: 'error', summary: `批量替换失败: ${e instanceof Error ? e.message : '未知错误'}` }
      }
    },
  },

  // ── Dangerous tools ──

  {
    schema: {
      name: 'create_file',
      description:
        '创建新文件并写入内容。自动创建不存在的父目录。\n' +
        '\n📁 项目内预设路径:\n' +
        '- 角色: {项目名}/characters/{中文名}.yaml（先读 ../.aiharness/templates/character.yaml）\n' +
        '- 章节: {项目名}/chapters/chapter{N}.txt（先读 ../.aiharness/templates/chapter-body.txt）\n' +
        '- 细纲: {项目名}/detailed_outline/chapter{N}.yaml（先读 ../.aiharness/templates/detailed-outline.yaml）\n' +
        '- 摘要: {项目名}/summaries/chapter{N}.md（先读 ../.aiharness/templates/chapter-summary.md）\n' +
        '\n📁 全局预设路径:\n' +
        '- 知识库: ../knowledge_base/files/文件名.md（先读 ../.aiharness/templates/knowledge-base-file.md）\n' +
        '- 笔记: ../notes/文件名.md（先读 ../.aiharness/templates/note-draft.md）\n' +
        '- 风格模板: ../style_templates/模板名.yaml（先读 ../.aiharness/templates/style-template.yaml）\n' +
        '- 场景模板: ../scene_templates/模板名.yaml（先读 ../.aiharness/templates/scene-template.yaml）\n' +
        '\n📁 用户自定义路径（用户说放哪就放哪）:\n' +
        '- 项目根目录: {项目名}/文件名.md — 简介、写作计划、灵感、修订记录等\n' +
        '- 全局目录: ../文件名.md — 跨项目共享的写作素材、技巧笔记\n' +
        '- 任意子目录: 系统自动创建不存在的父目录，支持嵌套路径\n' +
        '\n⚠️ 已有模板的用模板格式。无模板的自由内容用 Markdown（# 标题 + ## 段落）。',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '相对路径' },
          content: { type: 'string', description: '文件内容' },
        },
        required: ['file_path', 'content'],
      },
    },
    // NOTE: create_file 的 permission 设为 AUTO 是有意为之（非 bug）。
    // 用户在创作流程中需要 AI 自动创建文件（角色、章节、细纲等），
    // 避免每次创作都弹出确认框打断工作流。后端服务会在覆盖已有文件前校验。
    permission: 'AUTO',
    category: 'file',
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
        '删除文件（不可恢复，自动备份到 .ai_backups/）。\n' +
        '📁 支持: 项目内/全局/任意用户文件。⚠️ DANGEROUS — 需用户确认。删除前向用户确认文件名。',
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
        '重命名或移动文件。支持所有路径（项目内/全局/任意）。\n' +
        '💡 new_path 可以是新文件名（同一目录）或新路径（移到其他目录）。⚠️ DANGEROUS — 需用户确认。',
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
        '按文件名 Glob 模式递归搜索（深度5层，最多200条）。\n' +
        '📁 搜索范围: 整个软件目录（项目+全局+模板+规则），跳过 node_modules/.git。\n' +
        '💡 pattern 必填（如 "*.yaml" "chapter*" "林*"），大小写不敏感。\n' +
        'scope="project"(默认) → 软件目录 / scope="computer" → 电脑用户目录（需审批）。\n' +
        '已知路径直接用 read_file，不确定时用 find_files 探索。',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob 模式匹配文件名（必填），如 "*.yaml" "chapter*" "林*"。大小写不敏感。' },
          scope: { type: 'string', description: '搜索范围: "project"(默认，整个软件目录) 或 "computer"(电脑用户目录，需审批)' },
          dir_path: { type: 'string', description: '额外搜索目录（scope=computer时可选）' },
          max_depth: { type: 'number', description: '最大递归深度（默认5，最大10）' },
        },
        required: ['pattern'],
      },
    },
    // scope="computer" 可搜索用户整个电脑 → 需要用户确认
    permission: 'DANGEROUS_ASK',
    category: 'file',
    executor: async (args, ctx) => ipcExecute('find_files', args, ctx),
  },
]
