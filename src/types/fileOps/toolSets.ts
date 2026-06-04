export const DANGEROUS_TOOLS = new Set(['create_file', 'delete_file', 'rename_file', 'create_project', 'delete_project']) as ReadonlySet<string>
// Plan 模式工具集。名称保留 "READ_ONLY" 为历史兼容，实际允许以下写操作（设计意图）：
// - write_note/append_note/delete_note: 草稿笔记管理，Plan 模式下仍需正常使用
// - generate_image/search_images: 只生成/搜索不修改文件，视为安全操作
// - create_style_template/create_scene_template: 模板创建写入独立全局目录，不修改项目文件
// - kb_create_file/kb_append_file: 知识库写入独立目录，不修改项目文件
// - list_prompts/toggle_prompt/update_prompt: 提示词库管理，不影响项目文件
export const READ_ONLY_TOOLS = new Set(['list_directory', 'read_file', 'search_content', 'list_notes', 'read_note', 'write_note', 'append_note', 'delete_note', 'search_images', 'generate_image', 'list_prompts', 'toggle_prompt', 'update_prompt', 'create_style_template', 'create_scene_template', 'kb_list', 'kb_create_file', 'kb_append_file', 'kb_index_file']) as ReadonlySet<string>

// Generate one-line Chinese summary for operation logs
export function summarizeFileOp(
  toolName: string,
  args: Record<string, unknown>,
): string {
  switch (toolName) {
    case 'list_directory': return `列出目录: ${args.dir_path || '(根目录)'}`
    case 'read_file': return `读取: ${args.file_path}`
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

/**
 * Build a concise but complete tool invocation prompt that tells the AI
 * exactly what tools are available and forces it to use them.
 */