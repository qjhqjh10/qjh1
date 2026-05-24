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
          dir_path: { type: 'string', description: '相对于项目根目录的路径，如 "chapters"、"" （根目录）' },
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
          file_path: { type: 'string', description: '相对于项目根目录的文件路径，如 "outline/items.json"、"chapters/chapter1.txt"' },
        },
        required: ['file_path'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_files',
      description:
        '在项目目录中按文件名搜索文件。\n' +
        '【何时用】需要找到某个文件名包含特定关键词的文件时，如搜索"章节"找到所有章节文件。\n' +
        '【何时不用】需要搜索文件内容时用 search_content。需要列出目录时用 list_directory。\n' +
        '【注意】不能搜索知识库文件（KB文件不在项目目录内），搜索KB文件用 kb_list。',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '文件名关键词（部分匹配），如 "items" 匹配 "items.json"' },
          dir_path: { type: 'string', description: '搜索起始目录，默认项目根目录' },
        },
        required: ['keyword'],
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
        '【何时不用】查找文件名用 search_files。需要查看完整文件内容用 read_file。',
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
          file_path: { type: 'string', description: '新文件的相对路径，如 "chapters/chapter5.txt"' },
          content: { type: 'string', description: '文件完整内容' },
          reason: { type: 'string', description: '创建原因' },
        },
        required: ['file_path', 'content', 'reason'],
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
          reason: { type: 'string', description: '删除原因' },
        },
        required: ['file_path', 'reason'],
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
          reason: { type: 'string', description: '原因' },
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
      description: '创建新的小说项目（含完整目录骨架）。需要用户确认。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '项目名称' },
          type: { type: 'string', description: '项目类型: writing(写作)、imitation(仿写)、continuation(续写)' },
          novelCategory: { type: 'string', description: '小说类型，默认"普通小说"' },
          reason: { type: 'string', description: '创建原因' },
        },
        required: ['name', 'reason'],
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
          reason: { type: 'string', description: '删除原因' },
        },
        required: ['project_name', 'reason'],
      },
    },
  },

  // ═══════════════════════════════════════════
  // 知识库操作（作用于 knowledge_base/ 目录）
  // ═══════════════════════════════════════════

  {
    type: 'function' as const,
    function: {
      name: 'kb_list',
      description:
        '列出知识库中所有文件的名称、ID和类型。\n' +
        '【何时用】保存前查看已有文件、决定是追加已有文件还是新建。每次保存到知识库前应先调用此工具。\n' +
        '【返回】文件名列表，含 id（用于 kb_append_file）和类型。',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'kb_create_file',
      description:
        '在知识库中创建新的 .md 文件保存资料。\n' +
        '【何时用】收集到新素材、研究成果、写作灵感等需要长期保存的内容。\n' +
        '【何时不用】已有相关文件时优先用 kb_append_file 追加而非新建。\n' +
        '【注意】创建后文件即保存成功，无需再验证。可用 kb_index_file 建立语义搜索索引。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '文件名（建议含中文描述，如"古风服饰描写.md"）' },
          content: { type: 'string', description: '文件内容（Markdown格式，支持标题、列表等）' },
        },
        required: ['name', 'content'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'kb_append_file',
      description:
        '向知识库已有文件末尾追加内容。保留原有内容，新内容以分隔线隔开。\n' +
        '【何时用】用户已有相关素材文件，需要往里面添加更多信息时。\n' +
        '【流程】先 kb_list 查看文件列表 → 找到相关文件的 id → kb_append_file 追加。\n' +
        '【何时不用】没有相关文件时用 kb_create_file 新建。',
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

  // ═══════════════════════════════════════════
  // 草稿笔记（作用于项目 notes/ 目录）
  // ═══════════════════════════════════════════

  {
    type: 'function' as const,
    function: {
      name: 'list_notes',
      description: '列出当前项目 notes/ 目录下的所有草稿笔记。',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'read_note',
      description: '读取指定草稿笔记的完整内容。',
      parameters: {
        type: 'object',
        properties: {
          note_name: { type: 'string', description: '草稿文件名，如 "灵感记录.md"' },
        },
        required: ['note_name'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'write_note',
      description: '创建或覆写草稿笔记。适合记录灵感、暂存分析结果。',
      parameters: {
        type: 'object',
        properties: {
          note_name: { type: 'string', description: '草稿文件名，如 "角色想法.md"' },
          content: { type: 'string', description: '完整内容（Markdown）' },
        },
        required: ['note_name', 'content'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'append_note',
      description: '向草稿笔记末尾追加内容。文件不存在则自动创建。适合向已有笔记补充新想法。',
      parameters: {
        type: 'object',
        properties: {
          note_name: { type: 'string', description: '草稿文件名' },
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
          note_name: { type: 'string', description: '要删除的草稿文件名' },
        },
        required: ['note_name'],
      },
    },
  },

  // ═══════════════════════════════════════════
  // 图片搜索（严格限制使用场景）
  // ═══════════════════════════════════════════

  {
    type: 'function' as const,
    function: {
      name: 'search_images',
      description:
        '在 Unsplash 图库搜索高清图片并保存到项目 images/ 目录。\n' +
        '【严格限制】仅当用户明确要求图片/照片/插图/形象图/配图时才调用。\n' +
        '【绝对禁止】在以下场景使用：收集文字素材、记录信息到知识库、搜索写作参考资料、查找描写词汇。这些场景用 webSearch 或模型知识。\n' +
        '【可用场景】用户说"找张图""有照片吗""搜插图""给角色配图""找图片存草稿"。',
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
        '【何时不用】用户只是找参考图/素材图 — 用 search_images 搜索 Unsplash 图库。\n' +
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
  {
    type: 'function' as const,
    function: {
      name: 'create_style_template',
      description: '创建风格模板并保存到模板库。type为小说类型（如"古风小说"），dimensions为各维度分析结果。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '模板名称' },
          type: { type: 'string', description: '小说类型: 普通小说/情色小说/玄幻小说/奇幻小说/灵异小说/游戏小说/末世小说/轻小说/都市小说/修仙小说/武侠小说/恋爱小说/古风小说/悬疑小说/历史小说/科幻小说/穿越小说' },
          worldType: { type: 'string', description: '世界观类型: 古代/现代/西幻/日系/末日/科幻/灵异/架空历史/玄幻/游戏/混合，或自定义' },
          description: { type: 'string', description: '简短描述' },
          dimensions: { type: 'object', description: '【强烈要求】各维度分析结果。格式: {"维度名":{"description":"分析描述","examples":["例句1","例句2"],"writingRules":["规则1"],"vocabularyList":["词1","词2"]}}。description为字符串，examples/writingRules/vocabularyList为字符串数组。有信号则详填，无信号跳过该维度' },
          vocabularyList: { type: 'array', items: { type: 'string' }, description: '词汇清单' },
          writingRules: { type: 'array', items: { type: 'string' }, description: '写作规则' },
          tone: { type: 'object', properties: { word: { type: 'string' }, description: { type: 'string' }, attitude: { type: 'string' } }, description: '叙事基调' },
        },
        required: ['name', 'type', 'dimensions'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_scene_template',
      description:
        '创建场景模板并保存到场景工坊。根据细纲分析填写尽可能多的字段，不确定的字段设为AI自动。\n' +
        '【重要】必须使用此工具！不要用 create_file 替代！\n' +
        '【何时用】用户要求根据细纲创建场景模板、配置场景参数时。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '模板名称（必填）' },
          type: { type: 'string', description: '小说类型: 普通小说/情色小说/都市小说/修仙小说等' },
          plotOverview: { type: 'string', description: '剧情概述（150-300字）' },
          sceneType: { type: 'string', description: '场景类型: 日常/战斗/对话/内心独白/过渡/高潮/情色' },
          conflictType: { type: 'string', description: '冲突类型: 无冲突/内心冲突/人际冲突/群体冲突/生死冲突' },
          scenePurpose: { type: 'array', items: { type: 'string' }, description: '场景目的: 推进剧情/揭示角色/建立世界观/制造悬念/情感爆发/过渡衔接' },
          characters: { type: 'string', description: '出场角色及情绪状态（每行一个: 角色名-情绪）' },
          location: { type: 'string', description: '场景地点' },
          time: { type: 'string', description: '时间: 不限/清晨/上午/午后/黄昏/深夜/自定义' },
          weather: { type: 'string', description: '天气: 不限/晴/阴/雨/雪/风/雾/自定义' },
          atmosphere: { type: 'string', description: '氛围: 不限/温馨/紧张/压抑/欢快/悲伤/神秘/恐怖/浪漫/肃穆' },
          senses: { type: 'array', items: { type: 'string' }, description: '感官侧重: 视觉/听觉/嗅觉/触觉/味觉' },
          dialogueRatio: { type: 'string', description: '对话占比: 极少(10%)/少量(25%)/适量(30%)/较多(50%)/大量(70%)' },
          subtextLevel: { type: 'string', description: '潜台词难度: 无/一般/较多/极多' },
          sentenceStyle: { type: 'string', description: '句式风格: 混合/短句为主/长句为主/长短交替' },
          paragraphDensity: { type: 'string', description: '段落密度: 稀疏/适中/密集' },
          wordTarget: { type: 'number', description: '目标字数' },
          narrativePOV: { type: 'string', description: '叙事视角: 第一人称/第三人称有限/第三人称全知' },
          narrativeStyle: { type: 'string', description: '叙事技法: 沉浸式长镜/快速切换/倒叙/插叙/多线并行' },
          timeCompression: { type: 'string', description: '时间压缩: 实时/加速/减速/跳跃/停顿' },
          introspection: { type: 'string', description: '内心描写量。有效值: 无/低/中/高' },
          emotionStart: { type: 'string', description: '场景起始情绪' },
          emotionEnd: { type: 'string', description: '场景结束情绪' },
          dominantEmotion: { type: 'string', description: '主导情绪' },
          pacing: { type: 'string', description: '节奏: 舒缓/渐进/紧凑/急促/爆发' },
          // 情色专属字段
          eroticIntensity: { type: 'number', description: '情色浓度 1-5。仅情色类型。也可用 intensity' },
          selectedKinks: { type: 'array', items: { type: 'string' }, description: '性癖/玩法标签。仅情色类型' },
          opening: { type: 'array', items: { type: 'string' }, description: '起始方式。仅情色类型' },
          mainPose: { type: 'string', description: '主体位。仅情色类型' },
          climax: { type: 'array', items: { type: 'string' }, description: '高潮方式。仅情色类型' },
          aftermath: { type: 'array', items: { type: 'string' }, description: '余韵处理。仅情色类型' },
          // 伏笔与转折
          foreshadowUse: { type: 'string', description: '伏笔: 无/埋伏笔/回收伏笔/两者都有' },
          sceneTurningPoint: { type: 'string', description: '场景转折点描述' },
          // 场景细节（普通+情色通用）
          sensoryAnchors: { type: 'string', description: '感官锚点描述，如"檀香与汗水""硝烟与铁锈"' },
          props: { type: 'string', description: '关键道具（普通小说），如"破损的怀表"' },
          appearance: { type: 'string', description: '角色外观要点' },
          bodyLanguage: { type: 'string', description: '身体语言描述，如"呼吸同步""指尖轻颤"' },
          propList: { type: 'string', description: '道具清单（情色小说），逗号分隔，如"束缚套装,口球,皮鞭"' },
          worldRules: { type: 'string', description: '世界观规则要点，如"口交可传功"' },
          costumeList: { type: 'string', description: '服装清单，如"女仆装+猫耳,护士服+白丝"' },
          // 情色专属字段
          publicity: { type: 'string', description: '公开度: 私密/半公开(有旁观者)/完全公开' },
          kinkNote: { type: 'string', description: '性癖补充说明' },
          soundDensity: { type: 'string', description: '声音密度: 稀少/中等/密集/极密集' },
          moanStyle: { type: 'string', description: '呻吟风格: 含蓄/哭喊破音/压抑低吟/放浪叫唤' },
          degradeLangs: { type: 'array', items: { type: 'string' }, description: '羞辱语言数组，如["母狗","精壶"]' },
          bannedWords: { type: 'string', description: '禁用词' },
          mainRhythm: { type: 'string', description: '主体节奏: 无偏好/持续快速/持续慢速/变速冲击' },
          poseChanges: { type: 'string', description: '姿势转换次数，如"2-3次转换"' },
          consentDynamic: { type: 'string', description: '同意动态: 明确同意/半推半就/角色扮演抗拒/TPE全权委托/从抗拒到迎合/醉酒药物影响/催眠精神控制/交易契约' },
          aftercareDetail: { type: 'string', description: '事后关怀: 无/简单清理/温存安抚/深度护理/调教延续/温柔对话/共同洗浴' },
          bodyFluidFocus: { type: 'array', items: { type: 'string' }, description: '体液焦点: 爱液/精液/汗液/唾液/泪液/血液/乳汁/尿液' },
          bodyPartFocus: { type: 'array', items: { type: 'string' }, description: '身体部位焦点: 胸/臀/腿/足/口/颈/腰/手/耳' },
          tactileFocus: { type: 'array', items: { type: 'string' }, description: '触感焦点: 温度/湿度/压力/摩擦/振动' },
          emotionCurveInput: { type: 'string', description: '情绪曲线，如"羞耻(开头)→兴奋(渐进)→失控(高潮)→羞耻(余韵)"' },
          triggerWords: { type: 'string', description: '触发词，如"求你了主人"' },
          // 不确定的字段设为"AI自动"
          autoFields: { type: 'array', items: { type: 'string' }, description: '设为AI自动的字段名列表。无法从细纲推断的字段列入此数组，生成时AI根据上下文自主决定' },
          extraNote: { type: 'string', description: '额外要求/备注' },
          detail: { type: 'string', description: '详细场景配置（Markdown格式，可包含分幕结构、写作要点等）' },
        },
        required: ['name', 'type'],
      },
    },
  },
]

// Tools that require user confirmation
export const DANGEROUS_TOOLS = new Set(['create_file', 'delete_file', 'rename_file', 'create_project', 'delete_project']) as ReadonlySet<string>
export const PREVIEW_TOOLS = new Set(['edit_file']) as ReadonlySet<string>
// Plan 模式工具集。名称保留 "READ_ONLY" 为历史兼容，实际允许以下写操作（设计意图）：
// - write_note/append_note/delete_note: 草稿笔记管理，Plan 模式下仍需正常使用
// - generate_image/search_images: 只生成/搜索不修改文件，视为安全操作
// - create_style_template/create_scene_template: 模板创建写入独立全局目录，不修改项目文件
// - kb_create_file/kb_append_file: 知识库写入独立目录，不修改项目文件
// - list_prompts/toggle_prompt/update_prompt: 提示词库管理，不影响项目文件
export const READ_ONLY_TOOLS = new Set(['list_directory', 'read_file', 'search_files', 'search_content', 'list_notes', 'read_note', 'write_note', 'append_note', 'delete_note', 'search_images', 'generate_image', 'list_prompts', 'toggle_prompt', 'update_prompt', 'create_style_template', 'create_scene_template', 'kb_list', 'kb_create_file', 'kb_append_file', 'kb_index_file']) as ReadonlySet<string>

// Generate one-line Chinese summary for operation logs
export function summarizeFileOp(
  toolName: string,
  args: Record<string, unknown>,
): string {
  switch (toolName) {
    case 'list_directory': return `列出目录: ${args.dir_path || '(根目录)'}`
    case 'read_file': return `读取: ${args.file_path}`
    case 'search_files': return `搜索文件: "${args.keyword}"`
    case 'search_content': return `搜索内容: "${(args.pattern as string || '').slice(0, 40)}"`
    case 'create_file': return `创建: ${args.file_path}`
    case 'edit_file': return `编辑: ${args.file_path}`
    case 'delete_file': return `删除: ${args.file_path}`
    case 'rename_file': return `重命名: ${args.file_path} → ${args.new_path}`
    case 'create_project': return `创建项目: ${args.name}`
    case 'delete_project': return `删除项目: ${args.project_name}`
    case 'kb_list': return `列出知识库文件`
    case 'kb_create_file': return `创建KB文件: ${args.name}`
    case 'kb_append_file': return `追加到KB: ${args.file_id}`
    case 'kb_index_file': return `索引KB: ${args.file_id}`
    case 'list_notes': return `列出草稿`
    case 'read_note': return `读取草稿: ${args.note_name}`
    case 'write_note': return `写草稿: ${args.note_name}`
    case 'append_note': return `追加草稿: ${args.note_name}`
    case 'delete_note': return `删除草稿: ${args.note_name}`
    case 'search_images': return `搜索图片: ${args.query}`
    case 'generate_image': return `AI生成图片: ${(args.prompt as string || '').slice(0, 40)}`
    case 'create_style_template': return `创建风格模板: ${args.name}`
    case 'create_scene_template': return `创建场景模板: ${args.name}`
    case 'list_prompts': return '列出提示词库'
    case 'toggle_prompt': return `${args.enabled ? '启用' : '关闭'}提示词: ${args.prompt_id}`
    case 'update_prompt': return `修改提示词: ${args.prompt_id}`
    default: return `未知操作: ${toolName}`
  }
}
