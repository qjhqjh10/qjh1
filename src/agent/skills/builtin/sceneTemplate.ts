import type { SkillDefinition } from '../types'

export const sceneTemplateSkill: SkillDefinition = {
  id: 'scene-template', name: '场景模板',
  description: '分析场景结构特征，创建可复用的场景模板(JSON)。通用10区块+情色26区块。',
  triggerPatterns: ['场景.*分析', '场景模板', 'create_scene_template', '分析.*场景'],
  category: 'scene',
  workflow: { description: '读取原文 → 分析场景结构 → create_scene_template保存', steps: [
    { order: 1, tool: 'read_file', purpose: '读取要分析的场景原文', argsTemplate: { file_path: '${file_path}' }, optional: false },
    { order: 2, tool: 'create_scene_template', purpose: '创建场景模板', argsTemplate: { name: '${name}', type: '${type}' }, optional: false },
  ]},
  qualityChecks: [
    { id: 'required-fields', description: '必填: name, type, sceneType, conflictType, scenePurpose, characters, location, plotOverview', severity: 'error', check: '逐字段检查' },
    { id: 'auto-fields', description: '不确定的字段放入autoFields数组，不要强填', severity: 'warn', check: '无把握的字段应标记为autoField' },
  ],
  inputSchema: { fields: [{ name: 'name', type: 'string', required: true }, { name: 'type', type: 'string', required: true }], extractionHint: '提取模板名和类型' },
  examples: [{ userInput: '分析这个雨夜对峙场景的结构', skillOutput: '场景模板已创建', toolCallsExpected: ['read_file', 'create_scene_template'] }],
  metadata: { version: '1.0.0', author: '青剑内置', source: 'builtin', enabled: true, priority: 85, createdAt: '2026-06-03', updatedAt: '2026-06-03' },
}
