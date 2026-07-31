import type { ModelConfig } from './settings'
import type { StyleProject, SceneTemplate } from './story'
import type { StyleTemplate, RuleTemplate } from './styleTemplate'
import type { KnowledgeFile, KnowledgeMetadata } from './knowledge'
import type { ContinuationProject } from './continuation'

export interface FileAPI {
  read: (path: string) => Promise<string>
  write: (path: string, content: string) => Promise<void>
  listDir: (dirPath: string) => Promise<string[]>
  ensureDir: (dirPath: string) => Promise<void>
  deleteFile: (path: string) => Promise<void>
  deleteDir: (dirPath: string) => Promise<void>
  readBinary: (filePath: string) => Promise<string>
  writeBinary: (filePath: string, base64: string) => Promise<void>
  saveImageUrl: (imageUrl: string, projectPath: string) => Promise<string>
  onExternalChange: (callback: (event: { path: string; content: string }) => void) => () => void
}

export interface ProjectAPI {
  create: (name: string, basePath: string, type?: string) => Promise<void>
  delete: (projectPath: string) => Promise<void>
  getMeta: (projectPath: string) => Promise<{
    name: string; chapterCount: number; wordCount: number; path: string; type: string; novelCategory?: string; coverImage?: string
  }>
  listProjects: (basePath: string) => Promise<string[]>
  importProject: (zipPath: string) => Promise<{ name: string; type: string }>
  updateCategory: (projectPath: string, novelCategory: string) => Promise<void>
  rename: (projectPath: string, newName: string) => Promise<{ name: string }>
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
  exportEpub: (options: {
    title: string; author: string
    chapters: { title: string; content: string }[]
    outputPath: string
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
  listModels: (configId: string, scope?: string) => Promise<string[]>
  generateImage: (prompt: string, configId: string, projectId?: string, size?: string, style?: string) => Promise<{ path: string; url: string; cost: number; prompt: string }>
  chatWithTools: (messages: { role: string; content: string; tool_calls?: unknown[]; tool_call_id?: string }[], configId: string, projectId?: string, tools?: unknown[], temperature?: number) => Promise<string>
  executeFileTools: (calls: Array<{ callId: string; toolName: string; args: Record<string, unknown> }>) => Promise<Array<{ callId: string; toolName: string; status: string; summary: string; detail?: string }>>
  // ── Anthropic 协议 ──
  chatAnthropicStream: (params: {
    system: Array<string | { type: string; text: string; cache_control?: { type: string } }>
    messages: Array<{
      role: string
      content: Array<{
        type: string
        text?: string
        tool_use_id?: string
        id?: string
        name?: string
        input?: Record<string, unknown>
        content?: string
      }>
    }>
    configId: string
    projectId?: string
    tools?: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>
    /** v12.5.1: 阶段感知温度 */
    temperature?: number
  }) => Promise<string>
  abortAnthropicStream: () => void
  onAnthropicChunk: (callback: (data: { chunk: string; accumulated: string }) => void) => () => void
  onAnthropicDone: (callback: (data: { text: string; usage?: StreamUsage & { cacheHitTokens?: number } }) => void) => () => void
  onAnthropicError: (callback: (data: { message: string }) => void) => () => void
}

export interface DialogAPI {
  saveFile: (defaultName: string) => Promise<string | null>
  saveZip: (defaultName: string) => Promise<string | null>
  openZip: () => Promise<string | null>
}

export interface AppAPI {
  getProjectsBasePath: () => Promise<string>
  getImitationProjectsPath: () => Promise<string>
  getContinuationProjectDirsPath: () => Promise<string>
  getRewriteProjectsPath: () => Promise<string>
  getStoryWorkspacePath: () => Promise<string>
  getSystemPrompt: () => Promise<string>
  openFolder: (folderPath: string) => Promise<void>
  openFile: (filePath: string) => Promise<void>
}

export interface SettingsAPI {
  saveConfigs: (configs: ModelConfig[]) => Promise<{warning?: string}>
  loadConfigs: () => Promise<ModelConfig[]>
  clearConfigs: () => Promise<void>
  savePexelsKey: (key: string) => Promise<void>
  loadPexelsKey: () => Promise<string>
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

export interface SessionStatEntry {
  sessionId: string
  startedAt: string
  duration: number
  apiCallCount: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  toolCalls: Array<{ toolName: string; count: number; lastUsed: string }>
  operations: string[]
  errorCount: number
}

export interface SessionStatsResult {
  sessions: SessionStatEntry[]
  totalSessions: number
  totals: {
    apiCalls: number
    promptTokens: number
    completionTokens: number
    totalTokens: number
    toolCalls: number
  }
}

export interface StatsAPI {
  getUsage: (opts?: { projectId?: string; year?: number; month?: number; day?: number; configId?: string; model?: string }) => Promise<UsageResult>
  getPrices: () => Promise<ModelPrice[]>
  savePrices: (prices: ModelPrice[]) => Promise<void>
  deleteByLine: (lineNumber: number) => Promise<void>
  getMonthCost: () => Promise<number>
  getSessionStats: () => Promise<SessionStatsResult>
  reset: () => Promise<any>
  deleteSession: (sessionId: string) => Promise<any>
  resetSessions: () => Promise<any>
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
  write: (fileId: string, content: string, configId?: string) => Promise<void>
  index: (fileId: string, configId: string) => Promise<{ chunkCount: number }>
  search: (query: string, projectId: string, configId: string, topK?: number, fileIds?: string[]) => Promise<KBSearchResult[]>
  assignProject: (fileId: string, projectId: string, assigned: boolean) => Promise<void>
  rename: (fileId: string, newName: string) => Promise<void>
  create: (name: string, content: string, projectId?: string) => Promise<{ id: string; name: string }>
  append: (fileId: string, content: string, configId?: string) => Promise<void>
  download: (fileId: string) => Promise<boolean>
  getEmbedding: (text: string, configId: string) => Promise<number[]>
  estimate: (filePath: string) => Promise<KBFileEstimate>
  webSearch: (query: string, maxResults?: number, safeSearch?: string, prioritySites?: { url: string }[]) => Promise<KBWebSearchResult[]>
}

export interface ExtractionAPI {
  importFile: () => Promise<{ name: string; content: string } | null>
  importFromPath: (filePath: string) => Promise<{ name: string; content: string }>
}

export interface StoryAPI {
  list: () => Promise<any[]>
  create: (name: string) => Promise<any>
  readMeta: (id: string) => Promise<any>
  saveMeta: (id: string, meta: any) => Promise<void>
  readChapter: (id: string, chId: string) => Promise<string>
  writeChapter: (id: string, chId: string, content: string) => Promise<void>
  readAnalysis: (id: string, chId: string) => Promise<string>
  writeAnalysis: (id: string, chId: string, content: string) => Promise<void>
  readGraph: (id: string) => Promise<string>
  writeGraph: (id: string, content: string) => Promise<void>
  delete: (id: string) => Promise<void>
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
  notes: { search: (query: string, configId: string, topK?: number) => Promise<{ content: string; fileName: string; score: number }[]> }
  stats: StatsAPI
  styleProjects: StyleProjectsAPI
  styleTemplates: { list: () => Promise<StyleTemplate[]>; listProject: (projectPath: string) => Promise<StyleTemplate[]>; read: (id: string) => Promise<StyleTemplate | null>; save: (template: StyleTemplate) => Promise<StyleTemplate>; delete: (id: string) => Promise<void>; readPrompt: (id: string) => Promise<string | null>; savePrompt: (id: string, content: string) => Promise<void>; deletePrompt: (id: string) => Promise<void>; listRuleTemplates: () => Promise<RuleTemplate[]>; readRuleTemplate: (id: string) => Promise<RuleTemplate | null>; saveRuleTemplate: (template: RuleTemplate) => Promise<RuleTemplate>; deleteRuleTemplate: (id: string) => Promise<void> }
  templates: { list: () => Promise<SceneTemplate[]>; listProject: (projectPath: string) => Promise<SceneTemplate[]>; save: (t: SceneTemplate) => Promise<SceneTemplate>; delete: (id: string) => Promise<void> }
  continuation: { list: () => Promise<ContinuationProject[]>; read: (id: string) => Promise<ContinuationProject | null>; save: (p: ContinuationProject) => Promise<ContinuationProject>; delete: (id: string) => Promise<void> }
  rewrite: { list: () => Promise<any[]>; read: (id: string) => Promise<any>; save: (p: any) => Promise<any>; delete: (id: string) => Promise<void>; create: (arg: { name: string; sourceFileName: string; content: string }) => Promise<any>; importFile: () => Promise<{ name: string; content: string; sourceFileName: string } | null>; saveChapters: (arg: { projectId: string; sourceWordCount: number; chapters: { title: string; content: string }[] }) => Promise<any>; getProjectPath: (id: string) => Promise<string>; readChapter: (id: string, fileName: string) => Promise<string>; saveAnalysis: (id: string, fileName: string, content: string) => Promise<void>; readAnalysis: (id: string, fileName: string) => Promise<string>; deleteAnalysis: (id: string, fileName: string) => Promise<void>; saveRewrite: (id: string, fileName: string, content: string) => Promise<void>; readRewrite: (id: string, fileName: string) => Promise<string>; deleteRewrite: (id: string, fileName: string) => Promise<void>; mergeRewrites: (id: string, outputPath: string, chapterIds?: string[]) => Promise<any>; templates: { list: () => Promise<any[]>; read: (id: string) => Promise<any>; save: (t: any) => Promise<any>; delete: (id: string) => Promise<void>; import: () => Promise<any>; export: (id: string) => Promise<string | null> } }
  extractions: ExtractionAPI
  story: StoryAPI

  http: { fetch: (url: string, options?: Record<string, unknown>) => Promise<any>; get: (url: string) => Promise<any> }
  browser: { open: (url: string) => Promise<any>; screenshot: (url: string, path?: string) => Promise<any>; search: (query: string) => Promise<any> }
  mcp: {
    listServers: () => Promise<any>
    connectServer: (name: string, config: { name: string; command: string; args: string[]; env?: Record<string, string> }) => Promise<any>
    disconnectServer: (name: string) => Promise<any>
    callTool: (serverName: string, toolName: string, args: Record<string, unknown>) => Promise<any>
    listTools: (serverName: string) => Promise<any>
    saveConfig: (servers: Array<{ name: string; command: string; args: string[]; env?: Record<string, string>; enabled?: boolean }>) => Promise<void>
    loadConfig: () => Promise<Array<{ name: string; command: string; args: string[]; env?: Record<string, string>; enabled?: boolean }>>
  }
  lsp: { diagnose: (filePath?: string) => Promise<any> }
  agent: {
    sessionSave: (id: string, data: string) => Promise<{ success: boolean }>
    sessionLoad: (id: string) => Promise<any>
    sessionList: () => Promise<any[]>
    sessionDelete: (id: string) => Promise<{ success: boolean }>
    permissionRecord: (toolName: string, approved: boolean) => Promise<{ success: boolean }>
    permissionPatterns: () => Promise<Record<string, any>>
    getSessionsPath: () => Promise<string>
    optimize: (configId: string, command: string) => Promise<string>
  }
  appendDebugLog: (name: string, line: string) => Promise<void>
}

declare global {
  interface Window {
    electron?: ElectronAPI
  }
}
