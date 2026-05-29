import type { ContextProvider } from '../ContextAssembler'

export const promptLibraryProvider: ContextProvider = {
  domain: 'prompt-library',
  relevance: (userMessage) => {
    if (/提示词|prompt|模板.*格式|提示.*库/i.test(userMessage)) return 0.8
    if (/切换.*提示词|启用.*模板|修改.*提示词/.test(userMessage)) return 1.0
    return 0.2
  },

  buildContext: async () => ({
    domain: 'prompt-library',
    priority: 60,
    estimatedTokens: 300,
    content: [
      '## 提示词库管理',
      '',
      '提示词模板按类型分组: 灵感/世界观/角色/大纲/细纲/章节/润色/续写/摘要/审稿。',
      '每种类型同时只能启用一个模板。',
      '',
      '工具:',
      '- list_prompts: 查看所有模板 (id/title/type/enabled/content前80字)',
      '- toggle_prompt(prompt_id, enabled): 切换启用状态，同类型启用新模板会自动关闭旧的',
      '- update_prompt(prompt_id, title?, content?, type?): 修改模板的标题/内容/类型',
      '',
      'AI 生成内容时应参考当前启用的模板格式要求。',
    ].join('\n'),
  }),
}
