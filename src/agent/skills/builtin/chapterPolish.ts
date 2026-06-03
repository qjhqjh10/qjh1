import type { SkillDefinition } from '../types'

export const chapterPolishSkill: SkillDefinition = {
  id: 'chapter-polish', name: '章节润色',
  description: '润色已有章节：优化对话、丰富描写、调整节奏、修正语病。',
  triggerPatterns: ['润色', '修改.*[第章节]', '优化', '改写.*章节', '调整.*章节', '润饰'],
  category: 'chapter',
  workflow: { description: '读章节原文 → 分析需要改进的地方 → edit_file精确替换', steps: [
    { order: 1, tool: 'read_file', purpose: '读取章节原文', argsTemplate: { file_path: '${projectId}/chapters/chapter${n}.txt' }, optional: false },
    { order: 2, tool: 'edit_file', purpose: '精确替换需要改进的部分', argsTemplate: { file_path: '${projectId}/chapters/chapter${n}.txt', old_string: '${old}', new_string: '${new}' }, optional: false },
  ]},
  qualityChecks: [
    { id: 'preserve-plot', description: '润色不改剧情走向和关键事件', severity: 'error', check: 'old_string 和 new_string 长度差异不超过 20%' },
    { id: 'read-before-edit', description: 'edit_file 前必 read_file', severity: 'error', check: '工具调用顺序' },
  ],
  inputSchema: { fields: [{ name: 'chapterNumber', type: 'number', required: true }], extractionHint: '提取章节号' },
  examples: [{ userInput: '第3章润色一下，对话太生硬了', skillOutput: '已润色，改进了对话自然度', toolCallsExpected: ['read_file', 'edit_file'] }],
  metadata: { version: '1.0.0', author: '青剑内置', source: 'builtin', enabled: true, priority: 80, createdAt: '2026-06-03', updatedAt: '2026-06-03' },
}
