// ── 内置技能: 大纲创作 ── 自包含完整格式定义
import type { SkillDefinition } from '../types'

export const outlineSkill: SkillDefinition = {
  id: 'outline-creation',
  name: '大纲创作',
  description: '编写、修改、导入故事大纲(plot.md)和世界观(worldbuilding.md)。Markdown格式，支持追加和编辑。',
  triggerPatterns: [
    '大纲', 'plot', '剧情', 'worldbuilding', '世界观', '故事主线', '修炼体系',
    '导入.*(?:世界观|设定|worldbuilding)', '(?:世界观|设定|世界设定).*导入',
    '(?:加到|追加|写入|整理到).*(?:世界观|设定|worldbuilding)',
    '(?:整理|添加|补充).*(?:设定|世界观|世界)',
    'Tab', '填充.*Tab', '填充.*tab', 'items\\.yaml', 'locations\\.yaml', 'factions\\.yaml',
    'power_system', 'outline_meta', 'emotion\\.yaml',
  ],
  category: 'outline',
  workflow: {
    description:
      '## 大纲格式（outline/plot.md, Markdown）\n' +
      '```\n' +
      '# 故事剧情 — 标题\n' +
      '> 一句话梗概\n\n' +
      '## 第X章·章节名（状态）\n' +
      '段落正文...\n' +
      '```\n\n' +
      '## 世界观格式（outline/worldbuilding.md, Markdown）\n' +
      '```\n' +
      '# 世界观设定 — 标题\n' +
      '> 类型·基调\n\n' +
      '## 一、核心规则\n' +
      '### 规则名\n' +
      '描述...\n' +
      '```\n\n' +
      '## 编辑策略\n' +
      '- 追加: read_file读末尾200字 → 取最后一段做old_string → new_string=原文+新Markdown内容\n' +
      '- 修改: read_file确认原文 → 用整段做old_string → 替换\n' +
      '- old_string必须逐字精确匹配（含换行和空格）\n' +
      '- 匹配失败时用 __FULL_REPLACE__ 做全量替换\n' +
      '- 新设定>500字: 可创建 outline/worldbuilding_supplement.md 作为补充，在worldbuilding.md末尾追加引用\n\n' +
      '## 大纲Tab（outline/{tab}.yaml）— ⚠️ 批量填充规则\n' +
      '每个 Tab 文件独立处理，完成一个再处理下一个（不要同时操作多个 tab）。\n\n' +
      '- items.yaml: 道具列表 {\"items\":[{\"id\",\"name\",\"type\",\"grade\",\"ability\",\"owner\",\"description\"}]}\n' +
      '- locations.yaml: 地点列表 {\"locations\":[{\"id\",\"name\",\"description\",\"type\"}]}\n' +
      '- factions.yaml: 势力列表 {\"factions\":[{\"id\",\"name\",\"description\",\"type\"}]}\n' +
      '- power_system.yaml: 等级体系 {\"name\",\"levels\":[{\"name\",\"description\"}],\"description\"}\n' +
      '- outline_meta.yaml: 伏笔+故事线 {\"foreshadowing\":[...],\"plotThreads\":[...]}\n' +
      '- emotion.yaml: 情绪曲线 {\"segments\":[{\"chapterStart\",\"chapterEnd\",\"dominantEmotion\"}]}\n\n' +
      'Tab 填充工作流（必须遵守）：\n' +
      '1. read_file 读取当前 tab 文件（了解格式和现有内容）\n' +
      '2. 空文件或仅模板占位 → old_string=\"__FULL_REPLACE__\" 全量覆写 JSON\n' +
      '3. 已有内容 → edit_file 追加，old_string=最后条目末尾原文\n' +
      '4. 确认status:\"success\"后立即处理下一个 tab\n' +
      '5. 全部 tab 完成后汇报"X个tab已填充"',
    steps: [
      { order: 1, tool: 'read_file', purpose: '读取现有大纲了解结构和已有内容（追加时读末尾200字）', argsTemplate: { file_path: '${projectId}/outline/plot.md' }, optional: false },
      { order: 2, tool: 'edit_file', purpose: '精确替换或追加内容到 plot.md / worldbuilding.md', argsTemplate: { file_path: '${projectId}/outline/plot.md', old_string: '${old}', new_string: '${new}' }, optional: false },
      { order: 3, tool: 'read_file', purpose: '读 Tab YAML 文件了解当前结构和格式（items/locations/factions/power_system 等）。如果文件为空（content=""），用 __FULL_REPLACE__ 写入完整内容', argsTemplate: { file_path: '${projectId}/outline/${tabName}.yaml' }, optional: true, condition: '用户要求填充YAML Tab文件时执行' },
      { order: 4, tool: 'edit_file', purpose: '编辑Tab YAML文件追加条目或替换内容。空文件用 old_string="__FULL_REPLACE__"', argsTemplate: { file_path: '${projectId}/outline/${tabName}.yaml', old_string: '${old}', new_string: '${new}' }, optional: true, condition: '用户要求填充YAML Tab文件时执行' },
    ],
    verification: {
      script: 'validate-outline-tabs.mjs',
      description: '验证所有大纲Tab文件存在且内容有效，plot.md有内容',
      requiredSteps: [1, 2],
      mandatoryChecks: ['content-length'],
    },
  },
  qualityChecks: [
    { id: 'read-before-edit', description: 'edit_file 前必须先 read_file 确认原文', severity: 'error', check: '工具调用顺序: read_file在edit_file之前' },
    { id: 'old-string-exact', description: 'old_string 从 read_file 结果中原样复制（含换行和空格）', severity: 'error', check: '逐字精确匹配' },
    { id: 'append-not-overwrite', description: '追加内容用edit_file追加，不要create_file覆盖已有文件', severity: 'error', check: '使用了edit_file' },
    { id: 'content-length', description: '导入的追加内容至少 50 字，太短说明提取不完整', severity: 'warn', check: 'new_string长度≥50' },
  ],
  inputSchema: {
    fields: [
      { name: 'content', description: '要写的大纲内容', type: 'string', required: true },
      { name: 'type', description: '大纲类型: plot(剧情) 或 worldbuilding(世界观)', type: 'enum', required: false, enumValues: ['plot', 'worldbuilding'] },
    ],
    extractionHint: '提取用户要写的内容和类型（plot还是worldbuilding）。',
  },
  examples: [
    { userInput: '帮我写一个修仙世界观，包含修炼体系和社会结构', skillOutput: '世界观已追加到 worldbuilding.md', toolCallsExpected: ['read_file', 'edit_file'] },
    { userInput: '在故事剧情里加一段主角发现古籍的描写', skillOutput: '已追加到故事剧情末尾', toolCallsExpected: ['read_file', 'edit_file'] },
  ],
  metadata: { version: '2.0.0', author: '青剑内置', source: 'builtin', enabled: true, priority: 85, createdAt: '2026-06-04', updatedAt: '2026-06-04' },
}
