// ── 内置技能: 章节润色 ── 自包含完整格式定义
import type { SkillDefinition } from '../types'

export const chapterPolishSkill: SkillDefinition = {
  id: 'chapter-polish', name: '章节润色',
  description: '润色已有章节：优化对话、丰富描写、调整节奏、修正语病。保持剧情不变。',
  triggerPatterns: ['润色', '修改.*[第章节]', '优化', '改写.*章节', '调整.*章节', '润饰'],
  category: 'chapter',
  workflow: {
    description:
      '## 润色规则\n' +
      '- 只改表达方式，不改剧情走向和关键事件\n' +
      '- old_string 和 new_string 长度差异控制在20%以内\n' +
      '- 用 edit_file 精确替换，不要重写整章\n' +
      '- 必须先 read_file 确认原文再 edit_file\n\n' +
      '## 流程\n' +
      '读章节原文 → 分析需要改进的地方 → edit_file精确替换。',
    steps: [
      { order: 1, tool: 'read_file', purpose: '读取章节原文', argsTemplate: { file_path: '${projectId}/chapters/chapter${n}.txt' }, optional: false },
      { order: 2, tool: 'edit_file', purpose: '精确替换需要改进的段落', argsTemplate: { file_path: '${projectId}/chapters/chapter${n}.txt', old_string: '${old}', new_string: '${new}' }, optional: false },
    ],
  },
  qualityChecks: [
    { id: 'preserve-plot', description: '润色不改剧情走向和关键事件，old/new长度差异≤20%', severity: 'error', check: '长度检查' },
    { id: 'read-before-edit', description: 'edit_file前必须read_file确认原文', severity: 'error', check: '工具调用顺序' },
    { id: 'partial-edit', description: '只改需要改的段落，不要重写全章', severity: 'error', check: 'old_string不是__FULL_REPLACE__' },
  ],
  inputSchema: { fields: [{ name: 'chapterNumber', type: 'number', required: true, extractFrom: '第(\\d+)章' }], extractionHint: '提取章节号' },
  examples: [{ userInput: '第3章润色一下，对话太生硬了', skillOutput: '已润色对话，保持剧情不变', toolCallsExpected: ['read_file', 'edit_file'] }],
  metadata: { version: '2.0.0', author: '青剑内置', source: 'builtin', enabled: true, priority: 80, createdAt: '2026-06-04', updatedAt: '2026-06-04' },
}
