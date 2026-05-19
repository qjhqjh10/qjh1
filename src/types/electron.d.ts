import type { ModelConfig } from './settings'
import type { StyleProject, SceneTemplate } from './story'
import type { KnowledgeFile, KnowledgeMetadata } from './knowledge'
import type { StyleTemplate } from './styleTemplate'
import type { ContinuationProject } from './continuation'

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
  create: (name: string, basePath: string, type?: string) => Promise<void>
  delete: (projectPath: string) => Promise<void>
  getMeta: (projectPath: string) => Promise<{
    name: string; chapterCount: number; wordCount: number; path: string; type: string
  }>
  listProjects: (basePath: string) => Promise<string[]>
  importProject: (zipPath: string) => Promise<{ name: string; type: string }>
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
  exportProject: (projectPath: string, outputPath: string) => Promise<void>
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
  saveFile: (defaultName: string) => Promise<string | null>
  saveZip: (defaultName: string) => Promise<string | null>
  openZip: () => Promise<string | null>
}

export interface AppAPI {
  getProjectsBasePath: () => Promise<string>
  getStoryWorkspacePath: () => Promise<string>
}

export interface SettingsAPI {
  saveConfigs: (configs: ModelConfig[]) => Promise<{warning?: string}>
  loadConfigs: () => Promise<ModelConfig[]>
}

export interface ModelPrice {
  modelId: string
  modelName: string
  inputPricePerM: number
  cacheHitPricePerM: number
  outputPricePerM: number
}

export interface UsageResult {
  entries: { timestamp: string; projectId: string; configId: string; configName: string; model: string; inputTokens: number; outputTokens: number; cacheHitTokens: number; cost: number; _line: number }[]
  totalCount: number
  totals: { input: number; output: number; cacheHit: number; cost: number; count: number }
  byDay: { date: string; input: number; output: number; cacheHit: number; cost: number; count: number }[]
  byConfig: { configId: string; configName: string; model: string; input: number; output: number; cacheHit: number; cost: number; count: number }[]
  byModel: { model: string; input: number; output: number; cacheHit: number; cost: number; count: number }[]
}

export interface StatsAPI {
  getUsage: (opts?: { projectId?: string; year?: number; month?: number; day?: number; configId?: string; model?: string }) => Promise<UsageResult>
  getPrices: () => Promise<ModelPrice[]>
  savePrices: (prices: ModelPrice[]) => Promise<void>
  deleteByLine: (lineNumber: number) => Promise<void>
  getMonthCost: () => Promise<number>
}

export interface StyleProjectsAPI {
  importFile: () => Promise<{ name: string; content: string } | null>
  listProjects: () => Promise<{ id: string; name: string; sourceFileName: string; chapterCount: number; totalCharCount: number; hasProfile: boolean; createdAt: string }[]>
  loadProject: (id: string) => Promise<StyleProject>
  saveProject: (project: StyleProject) => Promise<void>
  deleteProject: (id: string) => Promise<void>
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
  list: () => Promise<KnowledgeMetadata>
  read: (fileId: string) => Promise<{ file: KnowledgeFile; content: string }>
  selectFiles: () => Promise<string[]>
  uploadFiles: (filePaths: string[], activeProjectId: string) => Promise<KnowledgeFile[]>
  delete: (fileId: string) => Promise<void>
  write: (fileId: string, content: string) => Promise<void>
  index: (fileId: string, configId: string) => Promise<{ chunkCount: number }>
  search: (query: string, projectId: string, configId: string, topK?: number, fileIds?: string[]) => Promise<KBSearchResult[]>
  assignProject: (fileId: string, projectId: string, assigned: boolean) => Promise<void>
  rename: (fileId: string, newName: string) => Promise<void>
  download: (fileId: string) => Promise<boolean>
  getEmbedding: (text: string, configId: string) => Promise<number[]>
  estimate: (filePath: string) => Promise<KBFileEstimate>
  webSearch: (query: string, maxResults?: number, safeSearch?: string, prioritySites?: { url: string }[]) => Promise<KBWebSearchResult[]>
}

export interface ExtractionAPI {
  importFile: () => Promise<{ name: string; content: string } | null>
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
  styleProjects: StyleProjectsAPI
  styleTemplates: { list: () => Promise<StyleTemplate[]>; read: (id: string) => Promise<StyleTemplate | null>; save: (template: StyleTemplate) => Promise<StyleTemplate>; delete: (id: string) => Promise<void> }
  templates: { list: () => Promise<SceneTemplate[]>; save: (t: SceneTemplate) => Promise<void>; delete: (id: string) => Promise<void> }
  continuation: { list: () => Promise<ContinuationProject[]>; read: (id: string) => Promise<ContinuationProject | null>; save: (p: ContinuationProject) => Promise<ContinuationProject>; delete: (id: string) => Promise<void> }
  extractions: ExtractionAPI
}

declare global {
  interface Window {
    electron?: ElectronAPI
  }
}
