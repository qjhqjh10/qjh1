// 不再预先注入文件内容到上下文。模型通过工具（read_file / list_directory / search_content）
// 按需读取项目数据，CORE_SYSTEM_PROMPT + 工具 description 已提供完整的操作指引。
// 全局索引（~3k tokens）告诉模型有哪些文件，list_directory 用来探索具体目录。

import type { ContextProvider } from '../ContextAssembler'

export const ALL_PROVIDERS: ContextProvider[] = []
