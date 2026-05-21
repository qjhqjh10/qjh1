// ── File Operation Types & Tool Definitions ──

export interface FileOpCard {
  callId: string
  toolName: string
  args: Record<string, unknown>
  status: 'executing' | 'success' | 'error' | 'pending_confirm' | 'confirmed' | 'denied' | 'needs_preview' | 'undone'
  summary: string
  detail?: string
  preview?: { old: string; new: string }
}

export interface ToolCallArgs {
  callId: string
  toolName: string
  args: Record<string, unknown>
}

export interface ToolCallResult {
  callId: string
  toolName: string
  status: 'success' | 'error' | 'pending_confirm'
  summary: string
  detail?: string
  confirmArgs?: Record<string, unknown>
}

export interface ChatWithToolsResult {
  text: string
  toolCalls: Array<{
    id: string
    function: { name: string; arguments: string }
  }> | null
  finishReason: string
  images?: string[]
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number; cost: number }
}

// ── Tool Definitions (OpenAI Function Calling Schema) ──

export const FILE_TOOLS = [
  // ── Read-only (no confirmation) ──
  {
    type: 'function' as const,
    function: {
      name: 'list_directory',
      description: '列出项目目录中的文件和子目录。参数 dir_path 必须是相对于项目根目录的路径，使用空字符串或 "." 表示项目根目录。',
      parameters: {
        type: 'object',
        properties: {
          dir_path: { type: 'string', description: '相对于项目根目录的路径，例如 "characters" 或 "" 表示根目录' },
        },
        required: ['dir_path'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'read_file',
      description: '读取指定文件的内容。返回文件的完整文本内容。',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '相对于项目根目录的文件路径，例如 "chapters/chapter1.txt"' },
        },
        required: ['file_path'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_files',
      description: '在项目目录中递归搜索文件名包含指定关键词的文件。返回匹配的文件路径列表。',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '文件名搜索关键词，支持部分匹配' },
          dir_path: { type: 'string', description: '搜索的起始目录，默认为项目根目录' },
        },
        required: ['keyword'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_content',
      description: '在项目文件中搜索包含指定文本内容的文件。返回匹配的文件路径和匹配行内容。',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: '要搜索的文本内容（子字符串匹配）' },
          file_pattern: { type: 'string', description: '限定文件扩展名，如 "*.txt" 或 "*.json"，不填则搜索所有文本文件' },
          dir_path: { type: 'string', description: '搜索的起始目录，默认为项目根目录' },
        },
        required: ['pattern'],
      },
    },
  },

  // ── Write operations ──
  {
    type: 'function' as const,
    function: {
      name: 'edit_file',
      description: '通过对现有文件执行精确字符串替换来编辑内容。使用 old_string 定位要替换的文本，替换为 new_string。如果 old_string 在文件中不唯一，需要提供更多上下文。注意：old_string 必须精确匹配（包括空白字符）。',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '要编辑的文件路径（相对于项目根目录）' },
          old_string: { type: 'string', description: '文件中要被替换的精确文本' },
          new_string: { type: 'string', description: '替换后的新文本' },
          replace_all: { type: 'boolean', description: '如果为 true 且 old_string 出现多次，则替换所有出现。默认为 false（仅替换第一次出现）。' },
        },
        required: ['file_path', 'old_string', 'new_string'],
      },
    },
  },

  // ── Backup management ──
  {
    type: 'function' as const,
    function: {
      name: 'list_backups',
      description: '列出文件的备份版本。可以列出所有文件的备份（不传参数），或列出指定文件的备份（传入 file_path）。每个文件最多保留最近 10 份备份。',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '可选，要查看备份的文件路径（相对于项目根目录）。不填则列出所有文件的备份。' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'restore_backup',
      description: '从备份恢复文件。此操作会覆盖目标文件，需要用户确认。备份路径可从 list_backups 获取。',
      parameters: {
        type: 'object',
        properties: {
          backup_path: { type: 'string', description: '备份文件的路径（相对于项目根目录，如 .ai_backups/20260519_143025___chapter1.txt）' },
          target_path: { type: 'string', description: '恢复到的目标文件路径（相对于项目根目录），不填则恢复到原始位置' },
          reason: { type: 'string', description: '恢复此文件的原因说明（将展示给用户）' },
        },
        required: ['backup_path', 'reason'],
      },
    },
  },

  // ── Dangerous operations (require confirmation) ──
  {
    type: 'function' as const,
    function: {
      name: 'create_file',
      description: '创建一个新文件并写入内容。此操作需要用户确认后才能执行。请在调用前向用户解释创建原因和内容概要。',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '相对于项目根目录的新文件路径' },
          content: { type: 'string', description: '要写入的完整文件内容' },
          reason: { type: 'string', description: '创建此文件的原因说明（将展示给用户）' },
        },
        required: ['file_path', 'content', 'reason'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'delete_file',
      description: '删除指定的文件。此操作需要用户确认后才能执行。请在调用前向用户解释删除原因。删除后不可恢复。',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '要删除的文件路径（相对于项目根目录）' },
          reason: { type: 'string', description: '删除此文件的原因说明（将展示给用户）' },
        },
        required: ['file_path', 'reason'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'rename_file',
      description: '重命名或移动文件。new_path 是新文件路径（相对于项目根目录）。如果新路径包含不存在的目录，会自动创建。此操作需要用户确认。',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '当前文件路径（相对于项目根目录）' },
          new_path: { type: 'string', description: '新的文件路径（相对于项目根目录）' },
          reason: { type: 'string', description: '重命名/移动的原因说明（将展示给用户）' },
        },
        required: ['file_path', 'new_path', 'reason'],
      },
    },
  },
  // ── 项目管理（需确认）──
  {
    type: 'function' as const,
    function: {
      name: 'create_project',
      description: '创建一个新的小说项目，包含完整的目录骨架（chapters/、characters/、detailed_outline/、outline/ 等）。此操作需要用户确认。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '项目名称' },
          type: { type: 'string', description: '项目类型: writing(写作)、imitation(仿写)、continuation(续写)，默认writing' },
          novelCategory: { type: 'string', description: '小说类型: 普通小说、情色小说、都市小说、修仙小说、武侠小说、恋爱小说、古风小说、悬疑小说、历史小说、科幻小说、穿越小说，默认普通小说' },
          reason: { type: 'string', description: '创建项目的原因说明' },
        },
        required: ['name', 'reason'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'delete_project',
      description: '删除整个项目目录及其所有内容。此操作不可恢复，需要用户确认。',
      parameters: {
        type: 'object',
        properties: {
          project_name: { type: 'string', description: '要删除的项目名称（项目目录名）' },
          reason: { type: 'string', description: '删除项目的原因说明' },
        },
        required: ['project_name', 'reason'],
      },
    },
  },
  // ── 知识库管理 ──
  {
    type: 'function' as const,
    function: {
      name: 'kb_index_file',
      description: '触发对知识库文件的 embedding 索引更新。当修改了 knowledge_base/ 目录下的原始文件后，可调用此工具让语义搜索反映最新内容。',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '知识库文件的路径（相对于项目根目录，通常在 knowledge_base/ 目录下）' },
        },
        required: ['file_path'],
      },
    },
  },
  // ── 草稿笔记 ──
  {
    type: 'function' as const,
    function: {
      name: 'list_notes',
      description: '列出当前项目 notes/ 目录下的所有草稿笔记文件（.md 文件）。返回文件名列表和修改时间。',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'read_note',
      description: '读取 notes/ 目录下指定草稿笔记的完整内容。',
      parameters: {
        type: 'object',
        properties: {
          note_name: { type: 'string', description: '草稿文件名（不含路径，如 "灵感记录.md"）' },
        },
        required: ['note_name'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'write_note',
      description: '创建或覆写草稿笔记。如果 notes/ 目录不存在会自动创建。适合记录灵感、暂存分析结果、保存对话上下文。',
      parameters: {
        type: 'object',
        properties: {
          note_name: { type: 'string', description: '草稿文件名（不含路径，如 "角色设定想法.md"）' },
          content: { type: 'string', description: '草稿的完整内容（Markdown 格式）' },
        },
        required: ['note_name', 'content'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'append_note',
      description: '向已有草稿笔记末尾追加内容。如果文件不存在则自动创建。适合在已有笔记上补充新想法。',
      parameters: {
        type: 'object',
        properties: {
          note_name: { type: 'string', description: '草稿文件名（不含路径）' },
          content: { type: 'string', description: '要追加的内容' },
        },
        required: ['note_name', 'content'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'delete_note',
      description: '删除 notes/ 目录下的草稿笔记文件。',
      parameters: {
        type: 'object',
        properties: {
          note_name: { type: 'string', description: '要删除的草稿文件名（不含路径）' },
        },
        required: ['note_name'],
      },
    },
  },
  // ── 图片搜索 ──
  {
    type: 'function' as const,
    function: {
      name: 'search_images',
      description: '在 Unsplash 免费图库中搜索高清图片。适合查找场景插图、角色参考图、氛围图等。返回图片 URL 和描述，可直接用 ![描述](URL) 格式展示给用户。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词（建议用英文，如 "mountain meditation fantasy"）' },
          count: { type: 'number', description: '返回数量（默认3，最多5）' },
        },
        required: ['query'],
      },
    },
  },
]

// Tools that require user confirmation
export const DANGEROUS_TOOLS = new Set(['create_file', 'delete_file', 'restore_backup', 'rename_file', 'create_project', 'delete_project']) as ReadonlySet<string>
export const PREVIEW_TOOLS = new Set(['edit_file']) as ReadonlySet<string>
export const READ_ONLY_TOOLS = new Set(['list_directory', 'read_file', 'search_files', 'search_content', 'list_backups', 'list_notes', 'read_note', 'write_note', 'append_note', 'delete_note', 'search_images']) as ReadonlySet<string>

// Generate one-line Chinese summary for operation logs
export function summarizeFileOp(
  toolName: string,
  args: Record<string, unknown>,
): string {
  switch (toolName) {
    case 'list_directory': return `已列出目录: ${args.dir_path || '(根目录)'}`
    case 'read_file': return `已读取文件: ${args.file_path}`
    case 'search_files': return `搜索文件 "${args.keyword}"`
    case 'search_content': return `搜索内容 "${(args.pattern as string || '').slice(0, 40)}"`
    case 'create_file': return `创建文件: ${args.file_path}`
    case 'edit_file': return `编辑文件: ${args.file_path}`
    case 'delete_file': return `删除文件: ${args.file_path}`
    case 'list_backups': return `列出备份: ${args.file_path || '(全部文件)'}`
    case 'restore_backup': return `恢复备份: ${args.backup_path}`
    case 'rename_file': return `重命名: ${args.file_path} → ${args.new_path}`
    case 'create_project': return `创建项目: ${args.name}`
    case 'delete_project': return `删除项目: ${args.project_name}`
    case 'kb_index_file': return `知识库索引: ${args.file_path}`
    case 'list_notes': return '列出草稿笔记'
    case 'read_note': return `读取草稿: ${args.note_name}`
    case 'write_note': return `写入草稿: ${args.note_name}`
    case 'append_note': return `追加草稿: ${args.note_name}`
    case 'delete_note': return `删除草稿: ${args.note_name}`
    case 'search_images': return `搜索图片: ${args.query}`
    default: return `已执行: ${toolName}`
  }
}
