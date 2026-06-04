// ── 内置技能: 润色+保存摘要 ──
// 组合型 — 接收一段章节概要→润色文本→保存到 summaries/ 目录
// 区别于 chapterPolish：chapterPolish 是编辑已有章节文件，这个是创建新摘要文件
import type { SkillDefinition } from '../types'

export const summarizePolishSkill: SkillDefinition = {
  id: 'summarize-polish',
  name: '润色保存摘要',
  description: '接收章节概要文本，润色优化后保存到 summaries/chapter{N}.md。保持核心事件不变，让描述更有画面感。',
  triggerPatterns: [
    '润色.*(?:摘要|概要|大纲|内容)',
    '(?:摘要|概要|大纲).*润色',
    '润色.*(?:完|后).*(?:存|保存|放)',
    '(?:帮我|请).*(?:润色|优化|改进).*(?:这段|这个|文字)',
    '(?:这段|这个).*(?:太|写得).*(?:流水账|不好|不行).*润色',
    '润色.*(?:然后|之后).*(?:存|写|创建)',
  ],
  category: 'general',
  workflow: {
    description:
      '理解用户提供的概要文本（已在消息中或需 read_file）→ 润色：保持核心事件不变，增强画面感和生动性 → create_file 保存到 summaries/chapter{N}.md。在文本回复中展示润色结果。',
    steps: [
      { order: 1, tool: 'read_file', purpose: '如果用户指定了源文件路径则读取', argsTemplate: { file_path: '${filePath}' }, optional: true },
      { order: 2, tool: 'create_file', purpose: '保存润色后的摘要', argsTemplate: { file_path: '${projectId}/summaries/${fileName}', content: '${polishedContent}' }, optional: false },
    ],
  },
  qualityChecks: [
    { id: 'preserve-events', description: '润色不改核心事件，old/new 事件列表一致', severity: 'error', check: '核心事件未丢失' },
    { id: 'vivid-language', description: '润色后比原文更有画面感（描述词增加≥30%）', severity: 'warn', check: '描述密度检查' },
    { id: 'content-saved', description: '润色结果必须保存到文件，不能只输出文本', severity: 'error', check: '使用了create_file' },
  ],
  inputSchema: {
    fields: [
      { name: 'filePath', description: '源文件路径，无则留空', type: 'string', required: false },
      { name: 'projectId', description: '目标项目名', type: 'string', required: true },
      { name: 'fileName', description: '保存的文件名，如 chapter1.md', type: 'string', required: true, extractFrom: 'chapter(\\d+)|第(\\d+)章' },
    ],
    extractionHint: '提取章节号和项目名。如果用户直接提供了概要文字，跳过 read_file。',
  },
  examples: [
    {
      userInput: '帮我润色这段第一章的概要然后存到 summaries/chapter1.md：林逸在青云宗后山捡到断剑...',
      skillOutput: '已润色并保存到 summaries/chapter1.md。核心事件保持不变，增加了画面感和情绪描写。',
      toolCallsExpected: ['create_file'],
    },
  ],
  metadata: {
    version: '1.0.0', author: '青剑内置', source: 'builtin',
    enabled: true, priority: 70,
    createdAt: '2026-06-05', updatedAt: '2026-06-05',
  },
}
