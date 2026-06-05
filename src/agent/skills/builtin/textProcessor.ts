// ── 内置技能: 文本处理（合并 textAnalysis + textImport）─
// 两个分支：A) 纯分析（不写入） B) 导入（分析类型→路由到目标）
import type { SkillDefinition } from '../types'

export const textProcessorSkill: SkillDefinition = {
  id: 'text-processor',
  name: '文本处理',
  description: '分析上传/粘贴的文本内容。分支A（纯分析）：判断文本类型和写作特点，给出选项让用户选择。分支B（导入）：自动判断内容类型后导入到正确位置（剧情→plot.md、设定→worldbuilding.md、角色→characters/、灵感→notes/）。',
  triggerPatterns: [
    // 分支A — 纯分析
    '分析.*[这段此].*(?:风格|文风|写法|类型|结构|特点)',
    '这段.*(?:写得|写的).*怎么样',
    '这段.*(?:什么|哪个|哪种).*(?:风格|类型|写法|手法)',
    '(?:评估|评价|审阅|审查).*(?:这段|这个|文字|文章|文风|写法|风格)',
    '(?:看看|帮我看).*这段.*(?:风格|文风|写法)',
    // 分支B — 导入
    '导入.*(?:大纲|故事|剧情|世界观|草稿|角色|知识库)',
    '(?:加到|追加到|写入|放入).*(?:大纲|故事|剧情|世界观|角色|草稿|知识库)',
    '把.*(?:导入|追加|加到|存到).*(?:大纲|故事|剧情|世界观|角色|草稿)',
    '上传.*(?:导入|分析.*导入|保存)',
    '这段.*(?:存|保存|导入|写入|追加).*(?:大纲|故事|剧情|世界观|角色|草稿)',
  ],
  category: 'general',
  workflow: {
    description:
      '## 文本处理流程\n' +
      '### 分支A — 纯分析（用户只想了解，不想写入）\n' +
      '1. read_file 读取文本\n' +
      '2. 分析内容类型和写作特点\n' +
      '3. 列出"接下来可以做"的选项（创建风格模板/创建场景模板/提取角色/保存笔记等）\n' +
      '4. 等待用户选择后才执行操作\n\n' +
      '### 分支B — 导入（用户明确指定了导入目标）\n' +
      '1. read_file 读取源文本\n' +
      '2. 分析内容类型：\n' +
      '   - 剧情/故事 → read_file outline/plot.md → edit_file 追加（空模板用 __FULL_REPLACE__）\n' +
      '   - 世界观/设定 → read_file outline/worldbuilding.md → edit_file 追加\n' +
      '   - 角色描述 → list_directory characters/ → read_file 参考 → create_file 16字段YAML\n' +
      '   - 灵感/随笔 → write_note 存入笔记\n' +
      '3. 执行写入操作\n\n' +
      '### 核心原则\n' +
      '- 不确定类型时先分析再问用户\n' +
      '- 追加到已有文件时用 edit_file，绝对不要 create_file 覆盖\n' +
      '- 空模板用 __FULL_REPLACE__ 全量覆写',
    steps: [
      { order: 1, tool: 'read_file', purpose: '读取源文本内容（若内容已在用户消息中则跳过）', argsTemplate: { file_path: '${filePath}' }, optional: false },
      { order: 2, tool: 'read_file', purpose: '读取目标文件了解当前结构。如果文件为空，后续用 __FULL_REPLACE__', argsTemplate: { file_path: '${projectId}/outline/plot.md' }, optional: true, condition: '导入目标为 plot/worldbuilding' },
      { order: 3, tool: 'edit_file', purpose: '追加或覆写内容到目标文件', argsTemplate: { file_path: '${targetFile}', old_string: '${old}', new_string: '${new}' }, optional: true, condition: '导入目标为已有文件' },
      { order: 4, tool: 'create_file', purpose: '创建角色YAML，16字段完整', argsTemplate: { file_path: '${projectId}/characters/${name}.yaml', content: '${yaml}' }, optional: true, condition: '内容类型为角色描述' },
      { order: 5, tool: 'write_note', purpose: '存入草稿笔记', argsTemplate: { name: '${noteName}', content: '${content}' }, optional: true, condition: '内容类型为灵感/随笔' },
    ],
  },
  qualityChecks: [
    { id: 'analyze-first', description: '导入前必须先分析文本内容类型，告知判断依据', severity: 'error', check: '回复中说明了内容类型判断' },
    { id: 'read-before-edit', description: '追加前必须 read_file 确认目标文件内容，确保 old_string 精确匹配', severity: 'error', check: 'read_file 在 edit_file 之前' },
    { id: 'append-not-overwrite', description: '追加时用 edit_file，禁止 create_file 覆盖已有文件', severity: 'error', check: '使用 edit_file 操作已有文件' },
    { id: 'confirm-type', description: '不确定内容类型时先问用户，不要猜测后直接导入', severity: 'warn', check: '不确定时先输出分析询问用户' },
  ],
  inputSchema: {
    fields: [
      { name: 'filePath', description: '上传文件的路径', type: 'string', required: false },
      { name: 'targetType', description: '导入目标类型', type: 'enum', required: false, enumValues: ['plot', 'worldbuilding', 'character', 'note'] },
    ],
    extractionHint: '识别文件路径和导入目标类型。如果目标不明确，先分析文本内容再建议导入位置。',
  },
  examples: [
    { userInput: '帮我分析这段文字的风格', skillOutput: '这段文字是仙侠风格...要不要创建风格模板？', toolCallsExpected: ['read_file'] },
    { userInput: '分析 ref.txt，把剧情导入到故事剧情里', skillOutput: '已分析：剧情构想。已追加到 plot.md。', toolCallsExpected: ['read_file', 'read_file', 'edit_file'] },
  ],
  metadata: { version: '1.0.0', author: '青剑内置', source: 'builtin', enabled: true, priority: 85, createdAt: '2026-06-06', updatedAt: '2026-06-06' },
}
