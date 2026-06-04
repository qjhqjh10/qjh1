// ── 内置技能: 章节创作 ── 自包含完整格式定义
import type { SkillDefinition } from '../types'

export const chapterWritingSkill: SkillDefinition = {
  id: 'chapter-writing', name: '章节创作',
  description: '根据大纲、角色卡、细纲和摘要，生成完整的章节正文(txt)。段落用空行分隔，字数达标。',
  triggerPatterns: ['写.*[第章节]', '创作.*[第章节]', '生成.*正文', '写.*正文', '继续写'],
  category: 'chapter',
  workflow: {
    description:
      '## 章节正文格式（chapters/chapter{N}.txt，纯文本）\n' +
      '```\n' +
      '# 第N章·章节标题\n\n' +
      '## 第一节名\n' +
      '段落1...\n\n' +
      '段落2...\n\n' +
      '## 第二节名\n' +
      '段落3...\n' +
      '```\n' +
      '- 自然段之间用空行分隔（两个换行）\n' +
      '- 段落不宜过长（3-8行）\n' +
      '- 角色切换或场景转换必须另起一段\n' +
      '- 禁止全文一堆到底\n\n' +
      '## 创作前必读顺序\n' +
      '1. 大纲(outline/plot.md) — 了解全局\n' +
      '2. 出场角色卡(characters/*.yaml) — 仅读本章出场的角色\n' +
      '3. 细纲(detailed_outline/chapter{N}.yaml) — 本章具体规划\n' +
      '4. 前章摘要(summaries/chapter{N-1}.md) — 了解前情（优先读summaries/几百字，不读chapters/全文几千字）\n\n' +
      '## 章节摘要格式（summaries/chapter{N}.md，Markdown）\n' +
      '```\n' +
      '# 第N章·标题 — 摘要\n' +
      '## 剧情概述 (200-400字)\n' +
      '## 关键事件 (3-5条)\n' +
      '## 出场角色 (列表)\n' +
      '```',
    steps: [
      { order: 1, tool: 'read_file', purpose: '读大纲', argsTemplate: { file_path: '${projectId}/outline/plot.md' }, optional: false },
      { order: 2, tool: 'read_file', purpose: '读本章出场角色卡', argsTemplate: { file_path: '${projectId}/characters/${name}.yaml' }, optional: false },
      { order: 3, tool: 'read_file', purpose: '读本章细纲', argsTemplate: { file_path: '${projectId}/detailed_outline/chapter${n}.yaml' }, optional: false },
      { order: 4, tool: 'read_file', purpose: '读前章摘要', argsTemplate: { file_path: '${projectId}/summaries/chapter${prev}.md' }, optional: false },
      { order: 5, tool: 'create_file', purpose: '创建章节正文', argsTemplate: { file_path: '${projectId}/chapters/chapter${n}.txt', content: '${text}' }, optional: false },
    ],
  },
  qualityChecks: [
    { id: 'word-count', description: '字数必须达标', severity: 'error', check: 'countWords >= targetWords' },
    { id: 'paragraph-spacing', description: '段落间空行分隔（\\n\\n），每段3-8行', severity: 'error', check: '检查空行' },
    { id: 'chapter-format', description: '# 标题 → ## 分节格式', severity: 'warn', check: 'Markdown标题检查' },
    { id: 'not-one-block', description: '禁止全文一堆到底，必须分段', severity: 'error', check: '段落数≥3' },
    { id: 'read-summary-not-chapter', description: '读摘要(summaries/)而非全文(chapters/)', severity: 'error', check: '未读取chapters/下完整文件' },
  ],
  inputSchema: {
    fields: [
      { name: 'chapterNumber', description: '章节号', type: 'number', required: true, extractFrom: '第(\\d+)章' },
      { name: 'wordTarget', description: '目标字数', type: 'number', required: false, extractFrom: '(\\d+)\\s*[字千]' },
    ],
    extractionHint: '提取章节号和目标字数。',
  },
  examples: [
    { userInput: '写第3章正文，3000字', skillOutput: '第3章已完成。', toolCallsExpected: ['read_file', 'read_file', 'read_file', 'read_file', 'create_file'] },
  ],
  metadata: { version: '2.0.0', author: '青剑内置', source: 'builtin', enabled: true, priority: 90, createdAt: '2026-06-04', updatedAt: '2026-06-04' },
}
