import type { SkillDefinition } from '../types'

export const reviewSkill: SkillDefinition = {
  id: 'chapter-review', name: '章节审稿',
  description: '从节奏、对白、描写、情节一致性四个维度审稿，输出评分和修改建议。',
  triggerPatterns: ['审稿', '审阅', '检查.*[第章节]', 'review', '评价.*章节', '打分'],
  category: 'review',
  workflow: { description:
    '审稿只读不写。读章节全文 → 从节奏/对白/描写/情节一致性4个维度分析 → 输出结构化评分。' +
    '评分格式: 总分 X/10，节奏 X/10，对白 X/10，描写 X/10，情节一致性 X/10。每个扣分项给出具体修改建议。' +
    '审稿结果只输出到对话框，不写入文件（除非用户明确要求保存）。', steps: [
    { order: 1, tool: 'read_file', purpose: '读取要审稿的章节全文', argsTemplate: { file_path: '${projectId}/chapters/chapter${n}.txt' }, optional: false },
  ]},
  qualityChecks: [
    { id: 'four-dimensions', description: '必须从节奏、对白、描写、情节一致性4个维度分析', severity: 'error', check: '回复中包含4个维度的评分' },
    { id: 'score-format', description: '评分格式: 总分 X/10，节奏 X/10，对白 X/10，描写 X/10，情节一致性 X/10', severity: 'error', check: '检查评分格式' },
    { id: 'specific-suggestions', description: '每个扣分项给出具体修改建议', severity: 'warn', check: '每条评分后有具体建议' },
  ],
  inputSchema: { fields: [{ name: 'chapterNumber', type: 'number', required: true, extractFrom: '第(\\d+)章' }], extractionHint: '提取章节号' },
  examples: [{ userInput: '审稿第3章', skillOutput: '评分：总分7/10，节奏6/10...', toolCallsExpected: ['read_file'] }],
  metadata: { version: '1.0.0', author: '青剑内置', source: 'builtin', enabled: true, priority: 75, createdAt: '2026-06-03', updatedAt: '2026-06-03' },
}
