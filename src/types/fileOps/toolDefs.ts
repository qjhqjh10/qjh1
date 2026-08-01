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
  confirmed?: boolean
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
  reasoning_content?: string
  /** v14.5.0: 用户点击"停止生成"时主进程返回 aborted:true（此前被渲染层丢弃，中止被误显示为 API 失败） */
  aborted?: boolean
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number; cost: number }
}

// ── Tool Definitions (OpenAI Function Calling Schema) ──

export const FILE_TOOLS = [

  // ═══════════════════════════════════════════
  // 项目文件操作（作用于项目目录内）
  // ═══════════════════════════════════════════

  {
    type: 'function' as const,
    function: {
      name: 'list_directory',
      description:
        '列出项目目录中的文件和子目录。\n' +
        '【何时用】用户要求"看看项目结构""有哪些文件""列出目录"。\n' +
        '【何时不用】用户让你搜索资料、收集素材、保存知识库——这些不需要看项目目录。',
      parameters: {
        type: 'object',
        properties: {
          dir_path: { type: 'string', description: '相对于项目根目录的路径，如 "chapters"、"summaries"、"" （根目录）' },
        },
        required: ['dir_path'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'read_file',
      description:
        '读取项目文件的完整文本内容。\n' +
        '【何时用】需要查看角色JSON、大纲内容、细纲JSON、章节正文、项目配置等具体文件内容时。\n' +
        '【何时不用】需要列出目录内容时用 list_directory。需要搜索文件内容时用 search_content。\n' +
        '【注意】只能读取项目目录内的文件。知识库文件不在项目目录内，不能用此工具读取！',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '相对于项目根目录的文件路径，如 "outline/items.yaml"、"chapters/chapter1.txt"、"summaries/chapter1.md"' },
        },
        required: ['file_path'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_content',
      description:
        '在项目文件中搜索包含指定文本的行。\n' +
        '【何时用】需要查找某个角色名在哪些文件中出现、某个关键词的使用位置等。\n' +
        '【何时不用】查找文件名用 find_files。需要查看完整文件内容用 read_file。',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: '要搜索的文本（子串匹配）' },
          file_pattern: { type: 'string', description: '限定文件类型，如 "*.json" 只搜JSON文件，不填搜所有文本文件' },
          dir_path: { type: 'string', description: '搜索起始目录，默认项目根目录' },
        },
        required: ['pattern'],
      },
    },
  },

  // ── 编辑操作 ──

  {
    type: 'function' as const,
    function: {
      name: 'edit_file',
      description:
        '通过精确字符串替换编辑文件。系统自动备份原文件。\n' +
        '【何时用】修改角色属性、更新道具信息、编辑细纲字段、修改大纲内容、更新设定等。\n' +
        '【关键规则】old_string 必须与文件中原文精确匹配（含空白字符）。如果不唯一需提供更多上下文。\n' +
        '【流程】先 read_file 确认当前内容 → 构造 old_string/new_string → edit_file 执行替换。',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '要编辑的文件路径（相对项目根目录）' },
          old_string: { type: 'string', description: '文件中要被替换的精确原文（必须与原文字符完全匹配）' },
          new_string: { type: 'string', description: '替换后的新文本' },
          replace_all: { type: 'boolean', description: 'true=替换所有匹配处，默认false=仅替换第一处' },
        },
        required: ['file_path', 'old_string', 'new_string'],
      },
    },
  },

  // ── 危险操作（需用户确认）──

  {
    type: 'function' as const,
    function: {
      name: 'create_file',
      description:
        '创建新文件并写入内容。需要用户确认。\n' +
        '【何时用】新建章节文件、新建角色JSON、新建细纲JSON等。\n' +
        '【何时不用】保存资料到知识库用 kb_create_file。记笔记用 write_note。',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '新文件的相对路径，如 "chapters/chapter5.txt"、"summaries/chapter1.md"' },
          content: { type: 'string', description: '文件完整内容' },
          reason: { type: 'string', description: '创建原因（可选）' },
        },
        required: ['file_path', 'content'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'delete_file',
      description: '删除文件。不可恢复，需要用户确认。',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '要删除的文件路径' },
          reason: { type: 'string', description: '删除原因（可选）' },
        },
        required: ['file_path'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'rename_file',
      description: '重命名或移动文件。需要用户确认。',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '当前路径' },
          new_path: { type: 'string', description: '新路径' },
          reason: { type: 'string', description: '原因（可选）' },
        },
        required: ['file_path', 'new_path'],
      },
    },
  },

  // ── 项目管理（需确认）──

  {
    type: 'function' as const,
    function: {
      name: 'create_project',
      description: '创建新的小说项目（含完整目录骨架）。需要用户确认。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '项目名称' },
          type: { type: 'string', description: '项目类型: writing(写作)、imitation(仿写)、continuation(续写)' },
          novelCategory: { type: 'string', description: '小说类型，默认"普通小说"' },
          reason: { type: 'string', description: '创建原因（可选）' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'delete_project',
      description: '删除整个项目及所有内容。不可恢复，需要用户确认。',
      parameters: {
        type: 'object',
        properties: {
          project_name: { type: 'string', description: '要删除的项目名称' },
          reason: { type: 'string', description: '删除原因（可选）' },
        },
        required: ['project_name'],
      },
    },
  },

  // ═══════════════════════════════════════════
  // 知识库操作（作用于 knowledge_base/ 目录）
  // ═══════════════════════════════════════════

  {
    type: 'function' as const,
    function: {
      name: 'kb_append_file',
      description:
        '向知识库已有文件末尾追加内容。保留原有内容，新内容以分隔线隔开。\n' +
        '【何时用】用户已有相关素材文件，需要往里面添加更多信息时。\n' +
        '【流程】先 list_directory("knowledge_base/files") 查看文件 → 找到目标文件的 id → kb_append_file 追加。\n' +
        '【何时不用】没有相关文件时用 create_file("knowledge_base/files/xxx.md", content) 新建。',
      parameters: {
        type: 'object',
        properties: {
          file_id: { type: 'string', description: '目标文件的 id（从 kb_list 获取）' },
          content: { type: 'string', description: '要追加的内容（Markdown格式）' },
        },
        required: ['file_id', 'content'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'kb_index_file',
      description: '对知识库文件建立 embedding 语义搜索索引。\n【何时用】创建或修改KB文件后，建立索引以便语义搜索。\n【流程】先 kb_list 获取文件列表 → 找到目标文件的 id → kb_index_file 索引该文件。\n【注意】索引需要调用 Embedding API，会消耗少量 token。',
      parameters: {
        type: 'object',
        properties: {
          file_id: { type: 'string', description: '目标文件的 id（从 kb_list 返回的文件列表中获取）' },
        },
        required: ['file_id'],
      },
    },
  },

  // v11.5: 草稿笔记工具已删除 — 使用 create_file("notes/xxx.md") / read_file / edit_file / delete_file

  // ═══════════════════════════════════════════
  // 图片搜索（严格限制使用场景）
  // ═══════════════════════════════════════════

  {
    type: 'function' as const,
    function: {
      name: 'search_images',
      description:
        '在 Pexels 图库搜索免费高清图片并保存到 images/ 目录。\n' +
        '【严格限制】仅当用户明确要求图片/照片/插图/形象图/配图时才调用。\n' +
        '【绝对禁止】在以下场景使用：收集文字素材、记录信息到知识库、搜索写作参考资料、查找描写词汇。这些场景用 webSearch 或模型知识。\n' +
        '【可用场景】用户说"找张图""有照片吗""搜插图""给角色配图""找图片存草稿"。\n' +
        '【需 PEXELS_API_KEY 环境变量】免费注册 https://www.pexels.com/api/（200次/时，2万次/月）。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词（建议英文，如 "ancient chinese palace fantasy art"）' },
          count: { type: 'number', description: '返回数量（默认3，最多5）' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'generate_image',
      description:
        '使用当前配置的 AI 模型生成图片并保存到项目 images/ 目录。\n' +
        '【何时用】用户要求给角色配图/画形象图、生成章节插图、创建封面图等需要 AI 绘画的场景。\n' +
        '【何时不用】用户只是找参考图/素材图 — 用 search_images 搜索 Pexels 图库。\n' +
        '【流程】生成后图片自动保存到 images/ 目录，返回文件路径。给角色配图时需再调用 edit_file 设置 image 字段。\n' +
        '【注意】使用用户在设置中配置的模型（支持 DALL-E 3 或其他兼容 API）。',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: '图片描述（英文效果更好，详细描述角色外貌/服装/场景/风格）' },
          size: { type: 'string', description: '尺寸: 1024x1024(方形) | 1792x1024(横版) | 1024x1792(竖版)。默认 1024x1024' },
          style: { type: 'string', description: '风格: vivid(生动戏剧化) | natural(自然写实)。默认 vivid' },
        },
        required: ['prompt'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_prompts',
      description:
        '列出提示词库中所有提示词模板（id/title/type/enabled/content前80字）。\n' +
        '【何时用】用户问"有哪些提示词""当前用的什么模板""提示词库"时。',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'toggle_prompt',
      description:
        '启用或关闭某个提示词模板。每个类型（章节/角色/大纲等）只能有一个启用。\n' +
        '【何时用】用户要求"换成XX模板""启用XX提示词""改用XX"时。',
      parameters: {
        type: 'object',
        properties: {
          prompt_id: { type: 'string', description: '提示词模板的ID' },
          enabled: { type: 'boolean', description: 'true=启用, false=关闭' },
        },
        required: ['prompt_id', 'enabled'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'update_prompt',
      description:
        '修改提示词模板的标题或内容。\n' +
        '【何时用】用户要求"修改XX模板""把章节模板改成...""更新提示词"时。',
      parameters: {
        type: 'object',
        properties: {
          prompt_id: { type: 'string', description: '提示词模板的ID' },
          title: { type: 'string', description: '新标题（可选）' },
          content: { type: 'string', description: '新内容（可选）' },
          type: { type: 'string', description: '新类型（可选）: 灵感/世界观/角色/大纲/细纲/章节/润色/续写/摘要/审稿' },
        },
        required: ['prompt_id'],
      },
    },
  },
]

// Tools that require user confirmation