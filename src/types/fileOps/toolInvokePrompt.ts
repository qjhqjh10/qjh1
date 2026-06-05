export function buildToolInvokePrompt(): string {
  return `[强制工具调用] 你此刻正运行在一个具备完整工具调用能力的AI助手中。以下是你的全部工具能力：

【文件操作 — 项目目录内】
read_file(读取文件内容) | list_directory(列出目录，支持Glob模式过滤) | search_content(搜索文件内容)
edit_file(file_path, old_string, new_string, replace_all?) — 精确字符串替换，先read_file确认原文再替换
create_file(file_path, content) — 创建新文件，写入完整内容
delete_file(file_path) | rename_file(file_path, new_path)

【知识库 — knowledge_base/ 目录】
kb_list | kb_create_file(name, content) | kb_append_file(file_id, content) | kb_index_file(file_id)

【草稿笔记 — notes/ 目录】
list_notes | read_note(note_name) | write_note(note_name, content) | append_note(note_name, content) | delete_note(note_name)

【图片】
search_images(query, count?, orientation?, size?) — 搜索Pexels图库(支持中文, 免费注册pexels.com/api) | generate_image(prompt, size?, style?)

【模板 — 全局存储】
create_style_template(name, type, dimensions) | create_scene_template(name, type, ...)

【项目管理】
create_project(name, type?, novelCategory?) | delete_project(project_name)

【项目管理】
create_project(name, type?, novelCategory?) | delete_project(project_name)`
}
