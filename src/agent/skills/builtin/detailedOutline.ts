// ── 内置技能: 细纲创作 ── 自包含完整格式定义
import type { SkillDefinition } from '../types'

export const detailedOutlineSkill: SkillDefinition = {
  id: 'detailed-outline',
  name: '细纲创作',
  description: '为每章生成详细的细纲YAML，含剧情概述、出场角色、场景地点、关键事件、分幕设计。',
  triggerPatterns: ['细纲', 'detailed_outline', '章节.*计划', '分幕', '章节.*安排'],
  category: 'chapter',
  workflow: {
    description:
      '## 细纲格式（detailed_outline/chapter{N}.yaml，YAML）\n' +
      '### 必填字段\n' +
      '- id: 唯一ID（如 chapter5）\n' +
      '- title: 章节标题\n' +
      '- order: 序号（从0开始的数字）\n' +
      '- status: incomplete | completed\n' +
      '- plotOverview: 150-300字剧情概述\n' +
      '- characters: 出场角色（每行一个，可附带情绪如"主角(紧张但坚定)"）\n' +
      '- location: 场景地点\n' +
      '- keyEvents: 关键事件（用 | 块标量，每行一个事件，通常5-7个）\n\n' +
      '### 可选字段\n' +
      '- eroticContent: 情色内容（情色类型填写，否则空字符串）\n' +
      '- customContent: 自定义内容（创作指引/分幕结构/伏笔预留等）\n' +
      '- emotionCurve: 情绪曲线\n' +
      '- writingNotes: 写作要点（视角/节奏/感官侧重/伏笔）\n\n' +
      '### YAML 规则\n' +
      '- 缩进2空格，禁止Tab\n' +
      '- 多行文本用 | (保留换行) 块标量，不需要 \\n 转义\n' +
      '- 禁止在YAML字符串内直接插入真实换行符\n\n' +
      '### 创建流程\n' +
      '读大纲了解背景 → 读前章摘要了解前情 → 创建细纲YAML。',
    steps: [
      { order: 1, tool: 'read_file', purpose: '读取大纲了解整体剧情', argsTemplate: { file_path: '${projectId}/outline/plot.md' }, optional: false },
      { order: 2, tool: 'read_file', purpose: '读取前章摘要了解前情。如果文件不存在（read_file 返回 error），直接跳过此步继续创建细纲。不要重复尝试读取。', argsTemplate: { file_path: '${projectId}/summaries/chapter${prevChapter}.md' }, optional: true },
      { order: 3, tool: 'create_file', purpose: '创建细纲YAML', argsTemplate: { file_path: '${projectId}/detailed_outline/chapter${n}.yaml', content: '${yaml}' }, optional: false },
    ],
  },
  qualityChecks: [
    { id: 'required-fields', description: '必填字段完整: id,title,order,status,plotOverview,characters,location,keyEvents', severity: 'error', check: '逐字段检查' },
    { id: 'yaml-format', description: '多行文本使用 | 块标量，禁止YAML内直接换行', severity: 'error', check: '检查格式' },
    { id: 'plot-length', description: 'plotOverview 150-300字', severity: 'warn', check: '字数检查' },
    { id: 'file-extension', description: '后缀为 .yaml', severity: 'error', check: 'file_path以.yaml结尾' },
  ],
  inputSchema: {
    fields: [
      { name: 'chapterNumber', description: '章节号', type: 'number', required: true, extractFrom: '第(\\d+)章' },
      { name: 'title', description: '章节标题', type: 'string', required: false },
    ],
    extractionHint: '提取章节号和标题。',
  },
  examples: [
    { userInput: '给第5章写细纲，剧情是主角在雨夜仓库与反派对峙', skillOutput: '第5章细纲已创建', toolCallsExpected: ['read_file', 'read_file', 'create_file'] },
  ],
  metadata: { version: '2.0.0', author: '青剑内置', source: 'builtin', enabled: true, priority: 80, createdAt: '2026-06-04', updatedAt: '2026-06-04' },
}
