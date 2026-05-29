import type { ContextProvider } from '../ContextAssembler'

export const kbProvider: ContextProvider = {
  domain: 'knowledge-base',
  relevance: (userMessage) => {
    if (/知识库|kb|素材|资料|参考|保存|索引|embedding/i.test(userMessage)) return 0.8
    if (/保存.*知识库|添加到.*知识库|索引.*文件/.test(userMessage)) return 1.0
    return 0.2
  },

  buildContext: async () => ({
    domain: 'knowledge-base',
    priority: 70,
    estimatedTokens: 350,
    content: [
      '## 知识库操作',
      '',
      '知识库文件存储在 knowledge_base/ 目录，与项目文件隔离。',
      '',
      '操作流程:',
      '1. 保存资料前先 kb_list 查看已有文件',
      '2. 已有相关文件时用 kb_append_file 追加，而非新建',
      '3. 全新主题时用 kb_create_file 创建新文件',
      '4. 创建/修改后可用 kb_index_file 建立语义搜索索引',
      '',
      'kb_append_file: 需要 file_id（从 kb_list 获取），内容以分隔线隔开追加',
      'kb_index_file: 调用 Embedding API，消耗少量 token',
      '知识库文件是 Markdown 格式，支持标题、列表等。',
    ].join('\n'),
  }),
}
