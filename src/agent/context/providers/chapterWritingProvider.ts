import type { ContextProvider } from '../ContextAssembler'

export const chapterWritingProvider: ContextProvider = {
  domain: 'chapter-writing',
  relevance: (userMessage) => {
    if (/章节|写作|chapter|生成.*章|写.*章|正文|续写|创作/i.test(userMessage)) return 0.8
    if (/生成.*正文|写本章|生成本章|写.*第.*章/.test(userMessage)) return 1.0
    return 0
  },

  buildContext: async () => ({
    domain: 'chapter-writing',
    priority: 70,
    estimatedTokens: 400,
    content: [
      '## 章节写作',
      '',
      '章节正文存储在 chapters/{章节id}.txt，摘要存储在 summaries/{章节id}.md。',
      '',
      '写作流程:',
      '1. 先 read_file 查看对应的细纲 (detailed_outline/{id}.json)',
      '2. 查看角色文件了解出场人物',
      '3. 查看大纲文件了解故事走向',
      '4. 撰写章节正文',
      '5. 使用 【生成本章】 命令触发章节生成弹窗',
      '',
      '摘要管理:',
      '- 章节完成后，为每章生成摘要写入 summaries/{章节id}.md',
      '- 摘要帮助 AI 在后续对话中快速回顾剧情',
      '',
      '注意: 章节正文是 .txt 纯文本，细纲是 .json，大纲是 .md，三者格式不同。',
    ].join('\n'),
  }),
}
