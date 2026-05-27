import type { ContextProvider } from '../ContextAssembler'

export const outlineProvider: ContextProvider = {
  domain: 'outline',
  relevance: (userMessage) => {
    if (/大纲|剧情|情节|故事线|世界观|设定|worldbuilding|outline|plot/i.test(userMessage)) return 0.9
    if (/修改.*outline|编辑.*大纲|写.*大纲/.test(userMessage)) return 1.0
    return 0
  },

  buildContext: async () => ({
    domain: 'outline',
    priority: 85,
    estimatedTokens: 400,
    content: [
      '## 大纲与世界观',
      '',
      '文件位置:',
      '- outline/plot.md — 故事剧情（Markdown格式）',
      '- outline/worldbuilding.md — 世界观设定（Markdown格式）',
      '',
      '编辑规则:',
      '- 这两个文件是 Markdown 格式，不是 JSON',
      '- 编辑前先 read_file 确认当前内容',
      '- 修改特定段落时，用该段落的原文做 old_string',
      '- 追加内容时，用末尾几行原文做 old_string，new_string = old_string + 新增内容',
      '- 如果匹配失败，用 old_string="__FULL_REPLACE__" 全量替换',
      '',
      '注意: 大纲文件夹是 outline/，细纲文件夹是 detailed_outline/，两者完全不同。',
    ].join('\n'),
  }),
}
