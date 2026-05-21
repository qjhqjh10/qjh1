export type ChapterStatus = 'incomplete' | 'completed'

export interface DetailedChapter {
  id: string
  title: string
  description: string            // 旧版兼容字段
  summary: string                // 旧版兼容字段（v3.7+ 普通小说不再使用）
  order: number
  status: ChapterStatus
  // v3.8 结构化细纲字段
  plotOverview?: string          // 本章剧情概述 (150—250字)
  characters?: string            // 出现的角色 (姓名、性别、特征等)
  location?: string              // 场景地点
  keyEvents?: string             // 关键事件 (多条，每行一个)
  eroticContent?: string         // 情色剧情 (仅情色小说类型启用)
}

export interface WritingChapter {
  id: string
  detailedChapterId: string
  title: string
  content: string
  summary: string
}

// 小说类型定义
export const NOVEL_CATEGORIES = [
  { value: 'general', label: '普通小说' },
  { value: 'erotic', label: '情色小说' },
  { value: 'urban', label: '都市小说' },
  { value: 'cultivation', label: '修仙小说' },
  { value: 'martial', label: '武侠小说' },
  { value: 'romance', label: '恋爱小说' },
  { value: 'ancient', label: '古风小说' },
  { value: 'mystery', label: '悬疑小说' },
  { value: 'historical', label: '历史小说' },
  { value: 'scifi', label: '科幻小说' },
  { value: 'transmigration', label: '穿越小说' },
] as const

export type NovelCategory = (typeof NOVEL_CATEGORIES)[number]['value']

