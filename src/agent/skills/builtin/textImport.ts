// ── 内置技能: 文本导入 ──
// 路由型技能 — 根据文本内容类型自动选择导入目标（大纲/世界观/角色/草稿）
import type { SkillDefinition } from '../types'

export const textImportSkill: SkillDefinition = {
  id: 'text-import',
  name: '文本导入',
  description: '分析上传/粘贴的文本内容，根据类型自动导入：剧情→故事剧情Tab、设定→世界观Tab、灵感→草稿、角色→角色卡。',
  triggerPatterns: [
    '导入.*(?:大纲|故事|剧情|世界观|草稿|角色)',
    '保存.*(?:大纲|故事|剧情|世界观|草稿)',
    '上传.*分析',
    '分析.*导入',
    '加到.*(?:大纲|故事|剧情|世界观)',
    '这段.*(?:存|保存|导入|写入)',
    '把.*(?:导入|追加|加到|存到)',
    '(?:分析|看看|读一下).*(?:这段|这个|这句|文字|内容|txt|TXT|文章)',
    '(?:写入|追加|加入|放到).*(?:大纲|故事|剧情|世界观|角色|草稿)',
    '(?:整理|归类|判断).*(?:内容|文字|这段|文本)',
    '(?:存为|保存为|写成).*(?:草稿|笔记|大纲)',
  ],
  category: 'general',
  workflow: {
    description:
      '分析文本内容类型，选择正确的导入路径：\n' +
      '• 剧情/故事/章节构想 → read_file读outline/plot.md末尾→edit_file追加（old_string=末尾段落原文，new_string=原文+新内容）\n' +
      '• 世界观/设定/体系 → read_file读outline/worldbuilding.md末尾→edit_file追加\n' +
      '• 角色/人物描述 → list_directory characters/→read_file参考已有角色→create_file创建16字段YAML（必须平铺，禁止嵌套）\n' +
      '• 灵感/随笔/片段 → write_note存入草稿（notes/目录，文件名自动加.md）\n' +
      '• 不确定类型 → 先分析内容特征告诉用户判断依据，问用户想导入到哪里',
    steps: [
      { order: 1, tool: 'read_file', purpose: '读取要导入的文本内容（若内容已在用户消息中则跳过此步）', argsTemplate: { file_path: '${filePath}' }, optional: true },
      { order: 2, tool: 'read_file', purpose: '读取目标文件末尾了解现有结构（导入到plot/worldbuilding时必做）', argsTemplate: { file_path: '${projectId}/outline/plot.md' }, optional: true },
      { order: 3, tool: 'edit_file', purpose: '追加剧情/世界观内容（old_string=末尾段落，new_string=原文+新内容）', argsTemplate: { file_path: '${targetFile}', old_string: '${old}', new_string: '${new}' }, optional: true },
      { order: 4, tool: 'create_file', purpose: '创建角色YAML（16字段完整，先read_file参考已有角色格式）', argsTemplate: { file_path: '${projectId}/characters/${name}.yaml', content: '${yaml}' }, optional: true },
      { order: 5, tool: 'write_note', purpose: '存入草稿笔记', argsTemplate: { name: '${noteName}', content: '${content}' }, optional: true },
    ],
  },
  qualityChecks: [
    { id: 'analyze-first', description: '导入前必须先分析文本内容类型，告诉用户判断依据', severity: 'error', check: '模型回复中说明了内容类型判断' },
    { id: 'read-before-edit', description: '追加到plot/worldbuilding前必须先read_file读取文件末尾内容，确保old_string精确匹配', severity: 'error', check: '工具调用顺序: read_file在edit_file之前' },
    { id: 'append-not-overwrite', description: '追加到已有文件时用edit_file追加，绝对不要create_file覆盖已有文件', severity: 'error', check: '使用了edit_file而非create_file操作已有文件' },
    { id: 'confirm-type', description: '不确定内容类型时先问用户，不要猜测后直接导入', severity: 'warn', check: '不确定时先输出分析结果询问用户' },
  ],
  inputSchema: {
    fields: [
      { name: 'filePath', description: '上传文件的路径（uploads/files/xxx.txt），无文件则留空', type: 'string', required: false, extractFrom: '(?:uploads/files/|上传文件[：:]\\s*)([\\w./-]+\\.\\w+)' },
      { name: 'targetType', description: '导入目标类型', type: 'enum', required: false, enumValues: ['plot', 'worldbuilding', 'character', 'note'], extractFrom: '(故事剧情|大纲|世界观|角色|草稿|笔记)' },
    ],
    extractionHint: '识别用户消息中的文件路径和导入目标类型。如果目标不明确，先分析文本内容再建议导入位置。',
  },
  examples: [
    {
      userInput: '分析 uploads/files/chapter3_idea.txt，把剧情内容导入到故事剧情里',
      skillOutput: '已分析文本：这是第三章的剧情构想（修仙血脉觉醒+仓库对峙）。已追加到故事剧情末尾。',
      toolCallsExpected: ['read_file', 'read_file', 'edit_file'],
    },
    {
      userInput: '这段文字帮我存为草稿：主角的武器是一把会说话的剑，性格傲娇毒舌，名为碎星',
      skillOutput: '已保存到草稿：会说话的剑.md',
      toolCallsExpected: ['write_note'],
    },
    {
      userInput: '分析这段人物描述，创建角色：陈远山，45岁，主角的师父，外表严厉内心温柔',
      skillOutput: '已分析并创建角色陈远山，16字段完整。',
      toolCallsExpected: ['list_directory', 'read_file', 'create_file'],
    },
  ],
  metadata: {
    version: '1.0.0', author: '青剑内置', source: 'builtin',
    enabled: true, priority: 80,
    createdAt: '2026-06-04', updatedAt: '2026-06-04',
  },
}
