# 章节创作

**适用**: 用户要求操作章节（创作/查看/删除/重命名等）

- 格式要求: 自然段间空行分隔 | 每段3-8行 | 角色切换或场景转换另起段 | 禁止一堆到底。
- **删除章节**: delete_file("{项目名}/chapters/chapter{N}.txt")，自动备份可恢复
- **重命名章节**: rename_file("{项目名}/chapters/旧名.txt", "{项目名}/chapters/新名.txt")
- 如需完整格式参考: 章节格式 ../.aiharness/templates/chapter-body.txt，摘要格式 ../.aiharness/templates/chapter-summary.md。

---

# 细纲创作

**适用**: 用户要求操作细纲（章节计划/分幕等）

- 字段结构已在路径速查中。order 从 0 开始 | 多行文本用|或>-块标量 | 禁止YAML内直接换行。
- 如需完整格式参考: ../.aiharness/templates/detailed-outline.yaml

---

# 章节润色

**适用**: 用户要求操作已有章节（润色/优化/修改等）

- 只改表达，不改剧情→old/new长度差异≤20%
- 获取原文: 用户指定了章节号→read_file 读取；用户在对话中粘贴了文字→直接用。
- 分析问题→edit_file精确替换→不重写全章
