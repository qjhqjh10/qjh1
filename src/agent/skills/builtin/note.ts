import type { SkillDefinition } from '../types'

export const noteSkill: SkillDefinition = {
  id: 'note-management', name: '笔记管理',
  description: '管理创作笔记：记录灵感、整理思路、搜索已有笔记。',
  triggerPatterns: ['笔记', '记.*灵感', '写.*笔记', '备忘', '记录.*想法', 'note'],
  category: 'note',
  workflow: { description:
    '笔记存储在全局 notes/ 目录（不绑定项目），.md 格式。文件名自动加 .md 后缀，不需手动加。' +
    '根据用户意图选择操作：新建用write_note，追加用append_note，查看用read_note，搜索用search_notes。' +
    '不要用 edit_file 编辑笔记（路径不兼容，必须用 write_note 覆写或 read_note→修改→write_note）。',
    steps: [
    { order: 1, tool: 'write_note', purpose: '创建新笔记', argsTemplate: { name: '${name}', content: '${content}' }, optional: true },
    { order: 2, tool: 'append_note', purpose: '追加到已有笔记', argsTemplate: { name: '${name}', content: '${content}' }, optional: true },
    { order: 3, tool: 'search_notes', purpose: '搜索已有笔记', argsTemplate: { query: '${query}' }, optional: true },
  ]},
  qualityChecks: [
    { id: 'correct-tool', description: '新建用write_note，追加用append_note，不要混用', severity: 'error', check: '操作类型匹配' },
    { id: 'auto-md', description: 'write_note 文件名自动加 .md 后缀，不需手动加', severity: 'warn', check: '文件名不含.md' },
  ],
  inputSchema: { fields: [{ name: 'name', type: 'string', required: true }, { name: 'content', type: 'string', required: true }], extractionHint: '提取笔记名和内容' },
  examples: [{ userInput: '记一个灵感：主角在第三章发现自己的真实身份', skillOutput: '笔记已保存', toolCallsExpected: ['write_note'] }],
  metadata: { version: '1.0.0', author: '青剑内置', source: 'builtin', enabled: true, priority: 75, createdAt: '2026-06-03', updatedAt: '2026-06-03' },
}
