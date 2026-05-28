import type { ContextProvider } from '../ContextAssembler'

export const detailedOutlineProvider: ContextProvider = {
  domain: 'detailed-outline',
  relevance: (userMessage) => {
    if (/细纲|章节.*卡|卡片|detailed.*outline|每章/.test(userMessage)) return 0.9
    return 0.6
  },

  buildContext: async () => ({
    domain: 'detailed-outline',
    priority: 80,
    estimatedTokens: 450,
    content: [
      '## 细纲 JSON Schema',
      '细纲存储在 detailed_outline/{章节id}.json，每章一个文件。',
      '',
      '必填字段:',
      '- id: string — 章节ID',
      '- title: string — 章节标题',
      '- order: number — 排序序号（数字）',
      '- status: string — 状态: incomplete | in_progress | complete',
      '- plotOverview: string — 剧情概述',
      '- characters: string — 出场角色',
      '- location: string — 场景地点',
      '- keyEvents: string — 关键事件描述（纯文本）',
      '',
      '可选字段:',
      '- emotionalTone: string — 情绪基调',
      '- eroticContent: string — 情色内容说明',
      '- customContent: string — 自定义内容',
      '- emotionCurve: string — 情绪曲线',
      '- writingNotes: string — 写作笔记',
      '- summary: string — 摘要',
      '',
      '注意: 细纲是 JSON 文件不是 .md，禁止创建 detailed_outline/*.md。',
      '细纲文件夹是 detailed_outline/，大纲文件夹是 outline/，两者完全不同。',
    ].join('\n'),
  }),
}
