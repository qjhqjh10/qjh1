# 风格模板

**适用**: 用户要求操作风格模板（分析文风/创建模板等）

#### A. 获取原文（三选一）
- 用户粘贴文字到对话 → 直接使用，不读文件
- 用户指定文件（如"分析第1章"）→ read_file("{项目名}/chapters/chapter{N}.txt")
- 用户上传了 TXT → read_file("../uploads/files/文件名.txt")

#### B. 分析文风
① **确定小说类型**: 如果用户没说，先问（普通/修仙/都市/情色/恋爱/武侠/古风/悬疑/历史/科幻/穿越 等17种）
② **选择分析维度**: 全维度分析 → analyze_text_style(content=原文, dimensions=DIMS, novelType=类型)。
   常用维度关键词参考: narrativeTone(叙事基调), sentenceStyle(句式风格), vocabularyStyle(词汇风格), rhetoricStyle(修辞), rhythmStyle(节奏), dialogueStyle(对话), moodStyle(情绪), perspectiveStyle(视角), descriptionPattern(描写模式) 等。具体有哪些维度通过 tool_search("风格") 查看 analyze_text_style 的参数说明。
③ 分析结果返回 JSON（dimAnalyses），包含每维度的 description/examples/writingRules/vocabularyList。

#### C. 生成模板
① 先读格式参考: read_file("../.aiharness/templates/style_templates/INDEX.yaml") 找到对应小说类型的模板文件 → read_file 该模板文件了解 YAML 结构
② 将分析结果映射到模板字段:
   - dimensions: 每维度一个 DimAnalysis（description/examples/writingRules/vocabularyList）
   - vocabularyList: 汇总高频词汇
   - writingRules: 汇总写作规则
   - tone: { word, description, attitude } 从分析中的 TONE 块提取
   - worldType: 自行判断（古代/现代/西幻/日系/末日/科幻/灵异）
③ create_file("../style_templates/模板名.yaml", 完整YAML内容)
   格式: 缩进2空格，多行文本用 | 或 >-，与参考模板一致

#### D. Prompt TXT 文件
- 模板创建后，用户可能在 UI 中操作生成 prompt TXT，生成后文件为 ../style_templates/{模板id}.prompt.txt
- 查看: read_file("../style_templates/{id}.prompt.txt")
- 编辑: read_file → edit_file 精确替换
- 用户说"生成 prompt"或"导出 prompt" → 用户需在风格工坊 UI 中操作，AI 无法直接调用 buildStylePrompt 函数
  但可以告知用户操作路径: 风格工坊 → 选择模板 → 生成 Prompt TXT

#### E. 查看/编辑已有模板
- 列出: list_directory("../style_templates/")
- 查看: read_file("../style_templates/模板名.yaml")
- 编辑: read_file → edit_file 或 batch_replace
- 搜索: find_files("../style_templates/*.yaml")

---

# 场景模板

**适用**: 用户要求操作场景模板

① (可选)read_file("../.aiharness/templates/scene-template.yaml") 查看格式。字段多，建议读模板。
② 获取原文: 用户在对话中粘贴了文字→直接用；用户指定了文件→read_file 读取；细纲内容→read_file {项目名}/detailed_outline/。
③ create_file("../scene_templates/模板名.yaml", 内容) 保存
