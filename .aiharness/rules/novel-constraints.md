# 小说写作约束

## 角色完整性
- 角色 JSON 必须包含 16 个必需字段（id, name, role, gender, age, occupation, background, appearance, personality, abilities, weaknesses, relationships, relationshipTags, arc, importance, image）
- 角色文件名使用拼音 ID，不用中文（如 `linwaner.json`，不是 `林婉儿.json`）
- 修改角色前必须搜索所有引用该角色的文件
- 不得擅自更改已确立的角色特征

## 情节连贯性
- 章节必须有对应的细纲（detailed_outline/*.json）
- 不得随意更改已确立的情节
- 伏笔必须在后续章节中解决
- 角色不能同时出现在两个不同地点

## 风格一致性
- 同一项目的章节应保持一致的叙事风格
- 角色对话应符合角色设定的性格和语气
- 章节字数不应偏离项目平均值太远

## 文件规范
- 章节文件: chapters/{id}.txt
- 角色文件: characters/{拼音id}.json
- 细纲文件: detailed_outline/{id}.json
- 大纲文件: outline/plot.md, outline/worldbuilding.md
