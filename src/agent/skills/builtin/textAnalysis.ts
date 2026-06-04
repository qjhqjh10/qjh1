// ── 内置技能: 文本分析 (填补"帮我分析这段文字"的Skill缺口) ──
// 路由型技能 — 读取文本→判断意图→建议行动(风格模板/场景模板/角色提取/导入)
import type { SkillDefinition } from '../types'

export const textAnalysisSkill: SkillDefinition = {
  id: 'text-analysis',
  name: '文本分析',
  description: '读取上传或粘贴的文本内容，分析类型后建议：创建风格模板/场景模板/提取角色/导入项目。不盲目操作，先分析再让用户选择。',
  triggerPatterns: [
    '分析.*[这段此]',
    '分析.*文本',
    '分析.*内容',
    '看看.*这段',
    '这段.*怎么样',
    '帮我.*分析',
    'read.*分析',
    '(?:评估|评价|审阅|审查|诊断).*(?:这段|这个|文字|文章|文本|内容|文风|写法|风格)',
    '这段.*(?:什么|哪个|哪种).*(?:风格|类型|写法|手法)',
    '(?:分析|看).*(?:文风|风格|写法|笔法).*(?:这段|这个|文字)',
    '这段.*(?:写得|写的).*怎么样',
  ],
  category: 'general',
  workflow: {
    description:
      '## 文本分析流程（路由型——不直接操作，先分析后建议）\n\n' +
      '1. **读取文本**: read_file 或直接读取用户粘贴的内容\n' +
      '2. **分析类型**: 判断内容的性质\n' +
      '   - 小说/故事段落 → 可做风格分析或场景分析\n' +
      '   - 角色描述 → 可提取为角色卡\n' +
      '   - 设定/世界观片段 → 可导入世界观或知识库\n' +
      '   - 灵感/想法 → 可保存为笔记\n' +
      '3. **输出分析结果**: 告诉用户这段内容的类型、特点\n' +
      '4. **给出选项**: 明确列出"接下来可以做什么"，让用户选择\n' +
      '   - "要不要建一个风格模板？"\n' +
      '   - "要不要提取角色信息创建角色卡？"\n' +
      '   - "要不要保存这段到知识库？"\n' +
      '5. **等待用户确认后才执行**: 不要自己决定就操作\n\n' +
      '★核心原则: 先分析后建议，让用户选择行动。不盲目创建文件。',
    steps: [
      { order: 1, tool: 'read_file', purpose: '读取要分析的文本内容（如果是粘贴的文本则跳过）', argsTemplate: { file_path: '${filePath}' }, optional: true },
      { order: 2, tool: 'create_style_template', purpose: '如果用户选择创建风格模板', argsTemplate: { name: '${name}', type: '${type}', dimensions: '${dimensions}' }, optional: true, condition: '用户明确选择"创建风格模板"' },
      { order: 3, tool: 'create_scene_template', purpose: '如果用户选择创建场景模板', argsTemplate: { name: '${name}', type: '${type}' }, optional: true, condition: '用户明确选择"创建场景模板"' },
      { order: 4, tool: 'write_note', purpose: '如果用户选择保存分析结果', argsTemplate: { name: '${name}', content: '${content}' }, optional: true, condition: '用户要求保存' },
    ],
  },
  qualityChecks: [
    { id: 'analyze-first', description: '必须先输出分析，再给出选项。不要一上来就创建文件', severity: 'error', check: '回复中先有分析内容，后有选项列表' },
    { id: 'wait-confirm', description: '必须等待用户确认后才执行操作', severity: 'error', check: '没有在用户确认前调用create_style_template/create_scene_template/create_file' },
    { id: 'offer-options', description: '必须明确列出2个以上的后续操作选项', severity: 'warn', check: '回复中包含多个建议操作' },
  ],
  inputSchema: {
    fields: [
      { name: 'filePath', description: '上传文件的路径', type: 'string', required: false, extractFrom: '(?:uploads/files/|文件[：:]\\s*)([\\w./-]+\\.\\w+)' },
    ],
    extractionHint: '提取文件路径(如果有上传文件)。如果是粘贴的文本则无需提取。',
  },
  examples: [
    { userInput: '帮我分析这段文字的风格', skillOutput: '这段文字是仙侠风格，叙事冷静克制，句式简短有力。要不要：①创建风格模板 ②分析场景结构 ③保存分析到笔记？', toolCallsExpected: ['read_file'] },
    { userInput: '看看这段写的是什么类型', skillOutput: '这是一段都市言情的小说开头，以心理描写为主。建议：①提取女主角色卡 ②分析写作风格建模板 ③保存为场景模板', toolCallsExpected: [] },
  ],
  metadata: { version: '1.0.0', author: '青剑内置', source: 'builtin', enabled: true, priority: 85, createdAt: '2026-06-04', updatedAt: '2026-06-04' },
}
