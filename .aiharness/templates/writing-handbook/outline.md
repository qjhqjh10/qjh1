# 大纲创作

**适用**: 用户要求操作大纲相关文件（剧情 plot.md / 世界观 worldbuilding.md / Tab YAML 等）

⚠️ create_project 已创建所有tab文件（含占位内容）→ **填充=edit_file(old_string="__FULL_REPLACE__")**，不是 create_file。

**plot.md/worldbuilding.md (Markdown)**
- plot.md: # 故事剧情 → > 梗概 → ## 第X章·标题（状态） → 段落
- worldbuilding.md: # 世界观 → > 类型·基调 → ## 一、核心规则 → ### 规则名 → 描述
- 追加: 参考"文件操作指南"中的追加模式（取末尾30-50字做old_string）
- 修改: read_file确认原文→精确old_string→替换
- 新设定>500字: 创建 {项目名}/outline/worldbuilding_supplement.md，{项目名}/outline/worldbuilding.md末尾追加引用

**Tab YAML（纯YAML格式，与角色文件一致）**
- 所有 .yaml 文件使用纯 YAML 格式（缩进2空格，禁止Tab），不使用 JSON
- Tab填充: 空文件→直接edit_file(old_string="__FULL_REPLACE__")。已有内容→先read_file确认原文→edit_file追加

**格式模板（仅在需要完整格式参考时 read_file）**
- 6个 YAML Tab（items/locations/factions/power_system/outline_meta/emotion）的字段结构已在路径速查中，普通填充不需要读模板。
- plot.md/worldbuilding.md 的 Markdown 格式参考: ../.aiharness/templates/outline-plot.md 和 ../.aiharness/templates/outline-worldbuilding.md（可选）
- YAML Tab 格式模板（仅在需要完整示例时）: ../.aiharness/templates/outline-items.yaml、outline-locations.yaml、outline-factions.yaml、outline-power_system.yaml、outline-outline_meta.yaml、outline-emotion.yaml
