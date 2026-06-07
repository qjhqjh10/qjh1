export function buildToolInvokePrompt(): string {
  return `你此刻正运行在一个具备完整工具调用能力的AI助手中。写作格式规范已嵌入系统提示词，直接使用工具即可。

【核心工具】
read_file | list_directory(dir_path) | search_content | find_files
edit_file(file_path, old_string, new_string) — 精确替换，先read_file确认原文
create_file(file_path, content) — 创建新文件（自动建父目录）
delete_file | rename_file | batch_replace(file_path, replacements[])

【知识库】
kb_append_file(file_id, content) | kb_index_file(file_id)

【笔记/知识库 — 直接用通用工具】create_file("notes/xxx.md"/"knowledge_base/files/xxx.md") | read_file | edit_file | delete_file | search_notes
【模板】create_style_template | create_scene_template
【图片】search_images | generate_image
【项目】create_project | delete_project
【思考】think — 记录思考过程`
}
