# 文本处理

**适用**: 用户要求操作文本内容（分析/导入/提取/生成摘要等）

**分支A-分析**: (分析源=对话内容)直接分析→输出结果到对话。随后列出可行的后续操作选项(创建模板/提取角色/存笔记/存摘要/存知识库/提取细纲)→等用户选择
- 用户直接粘贴文字到对话 = 分析源已在对话中 → 不需要 read_file，直接分析
- 用户指定文件(如"分析第1章") → 先 read_file 读取文件
- 分析结果始终先直接输出到对话中，让用户即时看到

**分支A2-分析并保存**: 用户要求分析内容并保存结果 → 在**同一个响应**中同时输出分析文字 + 调用 create_file 保存。不要分成两轮。
- 摘要: create_file("{项目名}/summaries/chapter{N}.md", 摘要内容)。字段结构已在路径速查中。
- 细纲: create_file("{项目名}/detailed_outline/chapter{N}.yaml", 细纲内容)。字段结构已在路径速查中。
- 对话内容为分析源 → 直接分析，不读文件。文件为分析源 → read_file 先读取。
- 如需完整格式参考: ../.aiharness/templates/chapter-summary.md 或 detailed-outline.yaml（可选）

**分支A3-提取细纲（从章节反向生成，支持两种输入源）**:

**输入源A-对话内容**: 用户直接在对话中粘贴了章节文字→内容已在对话中，不需要 read_file。直接跳到步骤②。
**输入源B-已有文件**: 用户指定章节号(如"第1章")→① read_file("{项目名}/chapters/chapter{N}.txt") 或 read_file("{项目名}/chapters/第N章.txt") 读取正文。

② 分析内容，直接输出到对话（字段结构见路径速查，包含剧情概述/出场角色/地点/关键事件/情绪曲线）。
③ 用户确认后→create_file("{项目名}/detailed_outline/chapter{N}.yaml", 细纲YAML)。如果用户说"分析并保存"则跳过确认直接保存。
- 如需完整格式参考: ../.aiharness/templates/detailed-outline.yaml（可选）

> ⚠️ 细纲是纯 YAML 格式，缩进 2 空格禁 Tab。多行文本用 | 或 >- 块标量。order 从 0 开始。

**分支B-导入**: 用户在对话中给了内容→分析类型→导入到对应位置:
- 剧情→read {项目名}/outline/plot.md→edit_file追加(空用FULL_REPLACE)
- 设定→read {项目名}/outline/worldbuilding.md→edit_file追加
- 角色→read参考1个已有角色(可选)→create_file 15字段
- 灵感→create_file("../notes/灵感记录.md", content)
- 摘要→create_file("{项目名}/summaries/chapter{N}.md", 摘要)
- 不确定类型→先问用户
