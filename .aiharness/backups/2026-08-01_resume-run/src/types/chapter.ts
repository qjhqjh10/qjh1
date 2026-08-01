export type ChapterStatus = 'incomplete' | 'completed'

export interface DetailedChapter {
  id: string
  title: string
  description: string            // 旧版兼容字段
  summary: string                // 旧版兼容字段（v3.7+ 普通小说不再使用）
  order: number
  status: ChapterStatus
  // v3.8 结构化细纲字段
  plotOverview?: string          // 本章剧情概述 (150—300字) — AI创建时必填
  characters?: string            // 出现的角色 (每行一个) — AI创建时必填
  location?: string              // 场景地点 — AI创建时必填
  keyEvents?: string             // 关键事件 (每行一个，通常5-7个) — AI创建时必填
  customContent?: string         // 自定义内容（伏笔/节奏/情绪/世界观关联等，可选）
  eroticContent?: string         // 情色剧情 (仅情色小说类型，非情色类型留空字符串)
  emotionCurve?: string          // 情绪曲线 (可选)
  writingNotes?: string          // 写作笔记 (可选)
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
  { value: 'erotic', label: '涩涩小说' },
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

