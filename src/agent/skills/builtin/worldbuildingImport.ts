// ── 内置技能: 世界观导入 ──
// 路由型 — 长篇设定文本导入到大纲 worldbuilding.md
// 与 outline-creation 的区别：导入是在已有文件末尾追加，不是创作新内容
import type { SkillDefinition } from '../types'

export const worldbuildingImportSkill: SkillDefinition = {
  id: 'worldbuilding-import',
  name: '世界观导入',
  description: '将长篇世界观设定导入到 outline/worldbuilding.md 追加。自动分块编辑，每块一条设定。',
  triggerPatterns: [
    '导入.*(?:世界观|设定|worldbuilding)',
    '(?:世界观|设定|世界设定).*导入',
    '(?:加到|追加|写入|整理到).*(?:世界观|设定|worldbuilding)',
    '(?:整理|添加|补充).*(?:设定|世界观|世界)',
    '(?:把这个|把这些).*(?:设定|世界观).*(?:加|写|存|放)',
  ],
  category: 'general',
  workflow: {
    description:
      '读取已存在的 outline/worldbuilding.md 末尾→定位最后一段做 old_string→将要追加的新设定作为 new_string→edit_file 追加。分块追加，不要全量替换。',
    steps: [
      { order: 1, tool: 'read_file', purpose: '读取要导入的原文（若内容已在用户消息中则跳过）', argsTemplate: { file_path: '${filePath}' }, optional: true },
      { order: 2, tool: 'read_file', purpose: '读取 worldbuilding.md 末尾了解现有结构', argsTemplate: { file_path: '${projectId}/outline/worldbuilding.md' }, optional: false },
      { order: 3, tool: 'edit_file', purpose: '追加世界观内容到 worldbuilding.md 末尾', argsTemplate: { file_path: '${projectId}/outline/worldbuilding.md', old_string: '${oldEnd}', new_string: '${oldEnd}\n\n${newContent}' }, optional: false },
    ],
  },
  qualityChecks: [
    { id: 'read-before-edit', description: 'edit_file 前必须 read_file 确认 worldbuilding.md 末尾内容', severity: 'error', check: '工具调用顺序: read_file在edit_file之前' },
    { id: 'append-not-overwrite', description: '用 edit_file 追加，不用 create_file 覆盖', severity: 'error', check: '使用了edit_file' },
    { id: 'content-length', description: '追加内容至少 50 字，太短说明提取不完整', severity: 'warn', check: 'new_string长度≥50' },
  ],
  inputSchema: {
    fields: [
      { name: 'filePath', description: '源文件路径（uploads/files/xxx 或 summaries/xxx），无文件则留空', type: 'string', required: false, extractFrom: '(?:uploads/files/|summaries/|文件[：:]\\s*)([\\w./-]+\\.\\w+)' },
      { name: 'projectId', description: '目标项目名', type: 'string', required: true, extractFrom: '(?:项目|project)[：:\\s]*([\\w\\u4e00-\\u9fff]+)' },
    ],
    extractionHint: '识别要导入的设定内容。如用户在消息中直接写了设定→跳过 step1，直接从 step2 开始。',
  },
  examples: [
    {
      userInput: '帮我把天元大陆的世界观加到项目设定里。三大势力青云宗魔渊殿散修联盟...',
      skillOutput: '已追加世界观到 worldbuilding.md 末尾。',
      toolCallsExpected: ['read_file', 'edit_file'],
    },
    {
      userInput: '分析 uploads/files/world.txt，把世界设定导入到世界观里',
      skillOutput: '已读取文件→分析内容→追加到 worldbuilding.md。',
      toolCallsExpected: ['read_file', 'read_file', 'edit_file'],
    },
  ],
  metadata: {
    version: '1.0.0', author: '青剑内置', source: 'builtin',
    enabled: true, priority: 75,
    createdAt: '2026-06-05', updatedAt: '2026-06-05',
  },
}
