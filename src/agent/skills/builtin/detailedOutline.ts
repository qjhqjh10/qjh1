// ── 内置技能: 细纲创作 ──
import type { SkillDefinition } from '../types'

export const detailedOutlineSkill: SkillDefinition = {
  id: 'detailed-outline',
  name: '细纲创作',
  description: '为每章生成详细的细纲JSON，包含剧情概述、出场角色、场景地点、关键事件、分幕设计等。',
  triggerPatterns: ['细纲', 'detailed_outline', '章节.*计划', '分幕', '章节.*安排'],
  category: 'chapter',
  workflow: { description: '读大纲了解背景 → 读前章摘要了解前情 → 创建细纲JSON → 生成摘要MD', steps: [
    { order: 1, tool: 'read_file', purpose: '读取大纲了解整体剧情', argsTemplate: { file_path: '${projectId}/outline/plot.md' }, optional: false },
    { order: 2, tool: 'read_file', purpose: '读取前章摘要了解前情', argsTemplate: { file_path: '${projectId}/summaries/chapter${prevChapter}.md' }, optional: true },
    { order: 3, tool: 'create_file', purpose: '创建细纲YAML', argsTemplate: { file_path: '${projectId}/detailed_outline/chapter${n}.yaml', content: '${yaml}' }, optional: false },
  ]},
  qualityChecks: [
    { id: 'required-fields', description: '必填字段: id,title,order,status,plotOverview,characters,location,keyEvents', severity: 'error', check: '逐字段检查' },
    { id: 'multiline-escape', description: '多行文本必须用 \\\\n 转义，禁止JSON内直接换行', severity: 'error', check: '检查content中没有原始换行符' },
    { id: 'plot-length', description: 'plotOverview 150-300字', severity: 'warn', check: '字数检查' },
  ],
  inputSchema: { fields: [
    { name: 'chapterNumber', description: '章节号', type: 'number', required: true, extractFrom: '第(\\d+)章' },
  ], extractionHint: '从用户消息中提取章节号' },
  examples: [{
    userInput: '给第5章写细纲，剧情是主角在雨夜仓库与反派对峙',
    skillOutput: '第5章细纲已创建',
    toolCallsExpected: ['read_file', 'read_file', 'create_file'],
  }],
  metadata: { version: '1.0.0', author: '青剑内置', source: 'builtin', enabled: true, priority: 80, createdAt: '2026-06-03', updatedAt: '2026-06-03' },
}
