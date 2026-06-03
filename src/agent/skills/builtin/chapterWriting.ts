// ── 内置技能: 章节创作 ──
import type { SkillDefinition } from '../types'

export const chapterWritingSkill: SkillDefinition = {
  id: 'chapter-writing', name: '章节创作',
  description: '根据大纲、角色卡、细纲和摘要，生成完整的章节正文(txt)。段落用空行分隔，字数达标。',
  triggerPatterns: ['写.*[第章节]', '创作.*[第章节]', '生成.*正文', '写.*正文', '继续写'],
  category: 'chapter',
  workflow: { description: '读大纲 → 读出场角色卡 → 读细纲 → 读前章摘要 → 创建章节正文', steps: [
    { order: 1, tool: 'read_file', purpose: '读大纲了解整体剧情走向', argsTemplate: { file_path: '${projectId}/outline/plot.md' }, optional: false },
    { order: 2, tool: 'read_file', purpose: '读本章出场角色的角色卡', argsTemplate: { file_path: '${projectId}/characters/${name}.yaml' }, optional: false },
    { order: 3, tool: 'read_file', purpose: '读本章细纲', argsTemplate: { file_path: '${projectId}/detailed_outline/chapter${n}.yaml' }, optional: false },
    { order: 4, tool: 'read_file', purpose: '读前章摘要了解前情', argsTemplate: { file_path: '${projectId}/summaries/chapter${prev}.md' }, optional: false },
    { order: 5, tool: 'create_file', purpose: '创建章节正文', argsTemplate: { file_path: '${projectId}/chapters/chapter${n}.txt', content: '${chapterText}' }, optional: false },
  ]},
  qualityChecks: [
    { id: 'word-count', description: '字数必须达标（用户指定多少就该写多少）', severity: 'error', check: 'countWords(text) >= targetWords' },
    { id: 'paragraph-spacing', description: '自然段之间用空行分隔（两个换行），段落3-8行', severity: 'error', check: '检查段落间空行' },
    { id: 'chapter-format', description: '# 标题 → ## 分节格式', severity: 'warn', check: '检查 Markdown 标题格式' },
    { id: 'not-one-block', description: '禁止全文一堆到底，必须分段', severity: 'error', check: '检查存在段落分隔' },
    { id: 'donut-hole', description: '读 summaries/ 摘要（几百字），不要读 chapters/ 全文（几千字）', severity: 'error', check: '检查未读取 chapters/ 下的完整章节文件' },
  ],
  inputSchema: { fields: [
    { name: 'chapterNumber', description: '章节号', type: 'number', required: true, extractFrom: '第(\\d+)章' },
    { name: 'wordTarget', description: '目标字数', type: 'number', required: false, extractFrom: '(\\d+)\\s*[字千]' },
  ], extractionHint: '从用户消息中提取章节号和目标字数' },
  examples: [{
    userInput: '写第3章正文，3000字',
    skillOutput: '第3章已完成，3217字。保存在 chapters/chapter3.txt。',
    toolCallsExpected: ['read_file', 'read_file', 'read_file', 'read_file', 'create_file'],
  }],
  metadata: { version: '1.0.0', author: '青剑内置', source: 'builtin', enabled: true, priority: 90, createdAt: '2026-06-03', updatedAt: '2026-06-03' },
}
