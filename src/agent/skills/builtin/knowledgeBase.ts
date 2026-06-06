import type { SkillDefinition } from '../types'

export const knowledgeBaseSkill: SkillDefinition = {
  id: 'knowledge-base', name: '知识库',
  description: '管理知识库文件：创建、追加、列出、搜索、建立索引。',
  triggerPatterns: ['知识库', 'kb_', '保存.*参考', '素材', '写作.*参考', '设定.*保存'],
  category: 'knowledge',
  workflow: { description: '先kb_list查看已有文件 → 创建/追加内容 → 必须建立索引。文件名不存在则新建（kb_create_file），已存在则追加（kb_append_file）。索引不会自动建立，必须手动调用 kb_index_file！', steps: [
    { order: 1, tool: 'kb_list', purpose: '查看已有KB文件，判断新建还是追加', argsTemplate: {}, optional: false },
    { order: 2, tool: 'kb_create_file', purpose: '创建新KB文件（文件名不存在时）', argsTemplate: { name: '${name}', content: '${content}' }, optional: true },
    { order: 3, tool: 'kb_append_file', purpose: '追加到已有KB文件（文件名已存在时）', argsTemplate: { name: '${name}', content: '${content}' }, optional: true },
    { order: 4, tool: 'kb_index_file', purpose: '⚠️ 必须调用！建立索引以加速搜索。索引不会自动建立，创建或追加后必须手动调用。', argsTemplate: {}, optional: false },
  ]},
  qualityChecks: [
    { id: 'list-before-create', description: '创建前先 kb_list，让用户决定新建还是追加', severity: 'error', check: 'kb_list 在 kb_create_file 之前' },
    { id: 'remind-index', description: 'KB文件创建后必须调用 kb_index_file 建立索引（索引不会自动建立）', severity: 'error', check: 'kb_index_file 在 kb_create_file 之后' },
    { id: 'chinese-name', description: 'KB文件使用中文命名', severity: 'warn', check: '文件名含中文' },
  ],
  inputSchema: { fields: [{ name: 'name', type: 'string', required: true }, { name: 'content', type: 'string', required: true }], extractionHint: '提取KB文件名和内容' },
  examples: [{ userInput: '把修仙九境设定保存到知识库', skillOutput: '已保存到 knowledge_base/files/修仙九境设定.md', toolCallsExpected: ['kb_list', 'kb_create_file'] }],
  metadata: { version: '1.0.0', author: '青剑内置', source: 'builtin', enabled: true, priority: 80, createdAt: '2026-06-03', updatedAt: '2026-06-03' },
}
