import React from 'react'

export interface VersionRecord {
  versionId: string
  chapterId: string
  modelConfigId: string
  modelName: string
  temperature: number
  promptTitle: string
  promptContent: string
  generatedContent: string
  tokens: { input: number; output: number; total: number }
  cost: number
  generatedAt: string
  contextUsed: string[]
}

export interface ChapterGenProps {
  isOpen: boolean
  onClose: () => void
  chapterId: string
  currentContent: string
  onApply: (content: string) => void
  onVersionSaved: (version: VersionRecord) => void
  onGenStart?: () => void
  onGenChunk?: (data: { accumulated: string; charCount: number }) => void
  onGenDone?: () => void
  onGenError?: (msg: string) => void
  externalAbortRef?: React.MutableRefObject<(() => void) | null>
  /** v16.4.0: 项目小说类型——仅 erotic（涩涩小说）时显示「涩涩剧情」细纲勾选 */
  novelCategory?: string
}
