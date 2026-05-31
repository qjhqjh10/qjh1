import type { ContextProvider } from '../ContextAssembler'

export const notesProvider: ContextProvider = {
  domain: 'notes',
  relevance: (userMessage) => {
    if (/笔记|草稿|灵感|暂存|记录.*想法/i.test(userMessage)) return 0.8
    if (/记下|记录下来|保存.*草稿|写.*笔记/.test(userMessage)) return 1.0
    return 0.2
  },

  buildContext: async () => ({
    domain: 'notes',
    priority: 65,
    estimatedTokens: 150,
    content: [
      '## 草稿笔记',
      '',
      '草稿笔记存储在全局 notes/ 目录，不限于单个项目。',
      '',
      '工具:',
      '- list_notes: 列出所有草稿',
      '- read_note(note_name): 读取草稿内容',
      '- write_note(note_name, content): 创建/覆写草稿 (Markdown)',
      '- append_note(note_name, content): 追加到已有草稿',
      '- delete_note(note_name): 删除草稿',
      '',
      '适合: 记录灵感、暂存分析结果、保存用户想法。',
    ].join('\n'),
  }),
}
