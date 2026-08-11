export const DANGEROUS_TOOLS = new Set(['create_file', 'delete_file', 'rename_file', 'create_project', 'delete_project', 'batch_replace']) as ReadonlySet<string>

// Plan 模式工具集（只读+安全写操作）
export const READ_ONLY_TOOLS = new Set(['list_directory', 'read_file', 'search_content', 'find_files', 'search_notes', 'search_images', 'list_prompts', 'toggle_prompt', 'update_prompt', 'kb_index_file', 'list_rules', 'tool_search']) as ReadonlySet<string>

// Generate one-line Chinese summary for operation logs
export function summarizeFileOp(
  toolName: string,
  args: Record<string, unknown>,
): string {
  switch (toolName) {
    case 'list_directory': return `列出目录: ${args.dir_path || '(根目录)'}`
    case 'read_file': return `读取: ${args.file_path}`
    case 'search_content': return `搜索内容: "${(args.pattern as string || '').slice(0, 40)}"`
    case 'find_files': return `搜索文件: "${(args.pattern as string || '').slice(0, 40)}"`
    case 'create_file': return `创建: ${args.file_path}`
    case 'edit_file': return `编辑: ${args.file_path}`
    case 'delete_file': return `删除: ${args.file_path}`
    case 'rename_file': return `重命名: ${args.file_path} → ${args.new_path}`
    case 'batch_replace': return `批量替换: ${args.file_path}`
    case 'create_project': return `创建项目: ${args.name}`
    case 'delete_project': return `删除项目: ${args.project_name}`
    case 'kb_append_file': return `追加到KB: ${args.file_id}`
    case 'kb_index_file': return `索引KB: ${args.file_id}`
    case 'search_notes': return `搜索笔记: ${args.query}`
    case 'search_images': return `搜索图片: ${args.query}`
    case 'list_prompts': return '列出提示词库'
    case 'toggle_prompt': return `${args.enabled ? '启用' : '关闭'}提示词: ${args.prompt_id}`
    case 'update_prompt': return `修改提示词: ${args.prompt_id}`
    case 'list_rules': return '列出规则'
    case 'tool_search': return `搜索工具: ${args.query}`
    case 'analyze_text_style': return `风格分析: ${(args.dimensions as string[] || []).join(',')}`
    case 'create_style_template': return `创建风格模板: ${args.name}`
    case 'create_scene_template': return `创建场景模板: ${args.name}`
    case 'http_get': return `HTTP GET: ${args.url}`
    case 'http_fetch': return `HTTP FETCH: ${args.url}`
    case 'browser_open': return `打开浏览器: ${args.url}`
    case 'browser_search': return `浏览器搜索: ${args.query}`
    default: return `未知操作: ${toolName}`
  }
}
