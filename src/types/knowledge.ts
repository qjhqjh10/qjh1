export interface KnowledgeFile {
  id: string
  name: string
  originalName: string
  type: 'txt' | 'md' | 'pdf' | 'docx'
  size: number
  chunkCount: number
  projects: string[]
  source: 'upload' | 'project' | 'review'
  uploadedAt: string
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
