// @deprecated v11.5.1: Provider 系统已退役。模型通过工具（read_file / list_directory / search_content）
// 按需读取项目数据，CORE_SYSTEM_PROMPT + 工具 description 已提供完整的操作指引。
// ALL_PROVIDERS 保持为空数组以兼容现有 imports。后续版本将完全移除此文件和 ContextProvider 类型。
// 全局索引（~3k tokens）告诉模型有哪些文件，list_directory 用来探索具体目录。

import type { ContextProvider } from '../ContextAssembler'

export const ALL_PROVIDERS: ContextProvider[] = []
