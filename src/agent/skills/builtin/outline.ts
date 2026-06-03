// ── 内置技能: 大纲创作 ──
import type { SkillDefinition } from '../types'

export const outlineSkill: SkillDefinition = {
  id: 'outline-creation',
  name: '大纲创作',
  description: '编写、修改故事大纲(plot.md)和世界观(worldbuilding.md)。支持Markdown格式追加和编辑。',
  triggerPatterns: ['大纲', 'plot', '剧情', 'worldbuilding', '世界观', '故事主线', '修炼体系'],
  category: 'outline',
  workflow: { description: '先读现有大纲了解结构 → 生成/追加新内容 → 精确edit_file替换', steps: [
    { order: 1, tool: 'read_file', purpose: '读取现有大纲了解结构和已有内容', argsTemplate: { file_path: '${projectId}/outline/plot.md' }, optional: false },
    { order: 2, tool: 'edit_file', purpose: '精确替换或追加内容', argsTemplate: { file_path: '${projectId}/outline/plot.md', old_string: '${oldContent}', new_string: '${newContent}' }, optional: false },
  ]},
  qualityChecks: [
    { id: 'read-before-edit', description: 'edit_file 前必须先 read_file 确认原文', severity: 'error', check: '工具调用顺序: read_file 必须在 edit_file 之前' },
    { id: 'old-string-exact', description: 'old_string 必须逐字精确匹配原文（含换行和空格）', severity: 'error', check: '从 read_file 结果中原样复制' },
  ],
  inputSchema: { fields: [
    { name: 'content', description: '要写的大纲内容', type: 'string', required: true },
    { name: 'type', description: '大纲类型: plot(剧情) 或 worldbuilding(世界观)', type: 'enum', required: false, enumValues: ['plot', 'worldbuilding'] },
  ], extractionHint: '从用户消息中提取要写的大纲内容和类型' },
  examples: [{
    userInput: '帮我写一个修仙世界观，包含修炼体系和社会结构',
    skillOutput: '世界观已追加到 worldbuilding.md',
    toolCallsExpected: ['read_file', 'edit_file'],
  }],
  metadata: { version: '1.0.0', author: '青剑内置', source: 'builtin', enabled: true, priority: 85, createdAt: '2026-06-03', updatedAt: '2026-06-03' },
}
