# 知识库

**适用**: 用户要求操作知识库（保存参考/搜索/查看等）

- 用户给了内容→直接 create_file("../knowledge_base/files/中文名.md", content)。格式: # 标题 → > 来源/日期/标签 → ## 正文。
- 追加到已有文件→先 list_directory 或 read_file 确认文件存在→kb_append_file(file_id, content)→kb_index_file(file_id) 建立索引。
- **搜索知识库**: kb_search(query="关键词")，语义搜索已索引内容。后续消息中需先 tool_search("知识库") 发现此工具。
- **删除知识库文件**: delete_file("../knowledge_base/files/文件名.md") 或 read_file 确认 file_id 后用相应工具。
- 如需完整格式参考: ../.aiharness/templates/knowledge-base-file.md

---

# 草稿笔记

**适用**: 用户要求操作草稿笔记（记笔记/存草稿/查看/删除等）→ 路径 ../notes/文件名.md（全局，非项目内）

- **创建**: 用户给了内容→直接 create_file。格式: # 标题 → > 记录时间/类型 → ## 正文。
- **查看**: read_file("../notes/文件名.md") 或 list_directory("../notes/")
- **修改**: read_file → edit_file 精确替换
- **删除**: delete_file("../notes/文件名.md")，自动备份
- **重命名**: rename_file("../notes/旧名.md", "../notes/新名.md")
- **搜索**: search_notes(query="关键词") 语义搜索。后续消息中需先 tool_search("笔记") 发现
- 与知识库区别: 草稿=临时笔记, 知识库=长期参考。
- 如需完整格式参考: ../.aiharness/templates/note-draft.md
