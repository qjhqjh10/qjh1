export interface KnowledgeFile {
  id: string
  name: string
  originalName: string
  type: 'txt' | 'md' | 'pdf' | 'docx'
  size: number
  chunkCount: number
  projects: string[]
  source: 'upload' | 'project' | 'review' | 'ai'
  uploadedAt: string
  /** v16: 三级目录归属（相对 knowledge_base/files/ 的路径，如 "玄幻/东方玄幻"；空/缺省 = 根目录）。
   * 根目录 → 一级子目录 → 二级子目录（共三层，含根） */
  folder?: string
}

export interface KnowledgeChunk {
  id: string
  fileId: string
  fileName: string
  content: string
  embedding: number[]
  charStart: number
  charEnd: number
}

export interface KnowledgeIndex {
  chunks: KnowledgeChunk[]
}

export interface KnowledgeMetadata {
  files: KnowledgeFile[]
}
