import type { SkillDefinition } from '../types'

export const projectSkill: SkillDefinition = {
  id: 'project-management', name: '项目管理',
  description: '创建新小说项目或删除已有项目。创建时自动初始化characters/chapters/outline/detailed_outline/summaries子目录。',
  triggerPatterns: ['创建.*项目', '新建.*项目', '删除.*项目', '新.*小说'],
  category: 'project',
  workflow: { description: '根据用户意图创建或删除项目', steps: [
    { order: 1, tool: 'create_project', purpose: '创建新项目（含5个子目录）', argsTemplate: { name: '${name}' }, optional: true },
    { order: 2, tool: 'delete_project', purpose: '删除项目（不可恢复）', argsTemplate: { name: '${name}' }, optional: true },
  ]},
  qualityChecks: [
    { id: 'confirm-delete', description: '删除项目前必须让用户确认', severity: 'error', check: 'delete_project 前有用户确认消息' },
  ],
  inputSchema: { fields: [{ name: 'name', type: 'string', required: true, extractFrom: '[《]([^》]+)[》]|项目[：:]\s*(\\S+)' }], extractionHint: '提取项目名' },
  examples: [{ userInput: '创建一个新项目《剑来》', skillOutput: '项目剑来已创建', toolCallsExpected: ['create_project'] }],
  metadata: { version: '1.0.0', author: '青剑内置', source: 'builtin', enabled: true, priority: 70, createdAt: '2026-06-03', updatedAt: '2026-06-03' },
}
