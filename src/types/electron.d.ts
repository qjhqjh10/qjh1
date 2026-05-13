export interface FileAPI {
  read: (path: string) => Promise<string>
  write: (path: string, content: string) => Promise<void>
  listDir: (dirPath: string) => Promise<string[]>
  ensureDir: (dirPath: string) => Promise<void>
  deleteFile: (path: string) => Promise<void>
  deleteDir: (dirPath: string) => Promise<void>
  onExternalChange: (callback: (event: { path: string; content: string }) => void) => () => void
}

export interface ProjectAPI {
  create: (name: string, basePath: string) => Promise<void>
  delete: (projectPath: string) => Promise<void>
  getMeta: (projectPath: string) => Promise<{
    name: string; chapterCount: number; wordCount: number; path: string
  }>
  listProjects: (basePath: string) => Promise<string[]>
}

export interface ExportAPI {
  exportChapters: (options: {
    chapters: { title: string; content: string }[]
    outputPath: string
    type: 'summary' | 'body'
  }) => Promise<void>
  exportSingleChapter: (options: {
    title: string; content: string; outputPath: string
  }) => Promise<void>
}

export interface StreamUsage { prompt_tokens: number; completion_tokens: number; total_tokens: number; cost: number }

export interface AIAPI {
  chat: (messages: { role: string; content: string }[], configId: string, projectId?: string) => Promise<string>
  chatStream: (messages: { role: string; content: string }[], configId: string, projectId?: string) => Promise<void>
  abortStream: () => void
  onChatChunk: (callback: (data: { chunk: string; accumulated: string }) => void) => () => void
  onChatDone: (callback: (data: { text: string; usage?: StreamUsage }) => void) => () => void
  onChatError: (callback: (data: { message: string }) => void) => () => void
  onChatCancelled: (callback: (data: { message: string }) => void) => () => void
  listModels: (configId: string) => Promise<string[]>
}

export interface DialogAPI {
  selectDirectory: () => Promise<string | null>
  saveFile: (defaultName: string) => Promise<string | null>
}

export interface AppAPI {
  getAppPath: () => Promise<string>
  getProjectsBasePath: () => Promise<string>
}

export interface SettingsAPI {
  saveConfigs: (configs: unknown[]) => Promise<void>
  loadConfigs: () => Promise<unknown[]>
}

export interface StatsAPI {
  getUsage: (opts?: { projectId?: string; year?: number; month?: number; day?: number; configId?: string; model?: string }) => Promise<unknown>
  getPrices: () => Promise<unknown>
  savePrices: (prices: unknown[]) => Promise<void>
}

export interface KBSearchResult {
  content: string
  fileName: string
  score: number
}

export interface KBWebSearchResult {
  title: string
  snippet: string
  url: string
}

export interface KBFileEstimate {
  name: string
  size: number
  type: string
  chunkCount: number
}

export interface KBAPI {
  list: () => Promise<{ files: { id: string; originalName: string }[] }>
  read: (fileId: string) => Promise<{ file: { id: string; originalName: string; content: string }; content: string }>
  upload: (activeProjectId: string) => Promise<{ id: string; originalName: string }[] | null>
  selectFiles: () => Promise<string[]>
  uploadFiles: (filePaths: string[], activeProjectId: string) => Promise<{ id: string; originalName: string }[]>
  delete: (fileId: string) => Promise<void>
  write: (fileId: string, content: string) => Promise<void>
  index: (fileId: string, apiUrl: string, apiKey: string, embeddingModel: string) => Promise<{ chunkCount: number }>
  search: (query: string, projectId: string, apiUrl: string, apiKey: string, embeddingModel: string, topK?: number, fileIds?: string[]) => Promise<KBSearchResult[]>
  assignProject: (fileId: string, projectId: string, assigned: boolean) => Promise<void>
  rename: (fileId: string, newName: string) => Promise<void>
  download: (fileId: string) => Promise<boolean>
  getEmbedding: (text: string, apiUrl: string, apiKey: string, embeddingModel: string) => Promise<number[]>
  estimate: (filePath: string) => Promise<KBFileEstimate>
  webSearch: (query: string, maxResults?: number) => Promise<KBWebSearchResult[]>
}

export interface ElectronAPI {
  files: FileAPI
  project: ProjectAPI
  export: ExportAPI
  ai: AIAPI
  dialog: DialogAPI
  app: AppAPI
  settings: SettingsAPI
  kb: KBAPI
  stats: StatsAPI
}

declare global {
  interface Window {
    electron?: ElectronAPI
  }
}
