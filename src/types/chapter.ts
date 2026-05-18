export type ChapterStatus = 'incomplete' | 'completed'

export interface DetailedChapter {
  id: string
  title: string
  description: string
  summary: string
  order: number
  status: ChapterStatus
}

export interface WritingChapter {
  id: string
  detailedChapterId: string
  title: string
  content: string
  summary: string
}
