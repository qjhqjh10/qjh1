import type { SkillDefinition } from '../types'

export const styleTemplateSkill: SkillDefinition = {
  id: 'style-template', name: '风格模板',
  description: '分析文本的26个文风维度，创建可复用的风格模板(JSON)。支持11个必填维度+6个选填维度+7个情色专属+5个类型专属。',
  triggerPatterns: ['风格.*分析', '文风', 'create_style_template', '分析.*风格', '风格模板'],
  category: 'style',
  workflow: { description: '读取原文 → 逐维度分析文风特征 → create_style_template保存', steps: [
    { order: 1, tool: 'read_file', purpose: '读取要分析的原文', argsTemplate: { file_path: '${file_path}' }, optional: false },
    { order: 2, tool: 'create_style_template', purpose: '创建风格模板（26维度）', argsTemplate: { name: '${name}', type: '${type}' }, optional: false },
  ]},
  qualityChecks: [
    { id: '11-required-dims', description: '必填11维度: narrativeTone,sentenceStyle,vocabularyStyle,rhetoricStyle,rhythmStyle,dialogueStyle,moodStyle,perspectiveStyle,bodyLanguageStyle,sensoryStyle,descriptionPattern', severity: 'error', check: '每个维度必须有description+examples+writingRules+vocabularyList' },
    { id: 'no-empty-dims', description: '禁止传空的dimensions对象', severity: 'error', check: 'dimensions不为空对象' },
    { id: 'vocabulary-limit', description: 'vocabularyList ≤ 80词，writingRules ≤ 30条', severity: 'warn', check: '长度检查' },
  ],
  inputSchema: { fields: [{ name: 'file_path', type: 'string', required: true }, { name: 'name', type: 'string', required: true }, { name: 'type', type: 'enum', required: true, enumValues: ['修仙小说','古风小说','都市小说','奇幻','科幻小说','情色小说','恋爱小说','悬疑小说','历史小说','玄幻小说','灵异小说','轻小说','普通小说','穿越小说','末世小说','游戏小说'] }], extractionHint: '提取文件名和模板名' },
  examples: [{ userInput: '分析这段古风武侠的文风，创建"古风仙侠"模板', skillOutput: '风格模板已创建，26维度分析完成', toolCallsExpected: ['read_file', 'create_style_template'] }],
  metadata: { version: '1.0.0', author: '青剑内置', source: 'builtin', enabled: true, priority: 85, createdAt: '2026-06-03', updatedAt: '2026-06-03' },
}
