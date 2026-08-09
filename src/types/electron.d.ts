import type { ModelConfig } from './settings'
import type { StyleProject, SceneTemplate } from './story'
import type { StyleTemplate, RuleTemplate } from './styleTemplate'
import type { KnowledgeFile, KnowledgeMetadata } from './knowledge'
import type { ContinuationProject } from './continuation'
import type { ModelPricePreset } from '../utils/modelPricing'

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
  /** v14.6.1: requestId 可选 — 带 id 精确中止该请求（并行子代理），不带 = 中止全部 */
  abortStream: (requestId?: string) => void
  onChatChunk: (callback: (data: { chunk: string; accumulated: string }) => void) => () => void
  onChatDone: (callback: (data: { text: string; usage?: StreamUsage }) => void) => () => void
  onChatError: (callback: (data: { message: string }) => void) => () => void
  onChatCancelled: (callback: (data: { message: string }) => void) => () => void
  listModels: (configId: string, scope?: string) => Promise<string[]>
  /** v15.2.1: 联网获取模型实时价格（OpenRouter 公开目录，免密钥，USD 价） */
  fetchModelPricing: () => Promise<{ models: Record<string, ModelPricePreset>; source: string; fetchedAt: number }>
  generateImage: (prompt: string, configId: string, projectId?: string, size?: string, style?: string) => Promise<{ path: string; url: string; cost: number; prompt: string }>
  chatWithTools: (messages: { role: string; content: string; tool_calls?: unknown[]; tool_call_id?: string }[], configId: string, projectId?: string, tools?: unknown[], temperature?: number, source?: string, requestId?: string) => Promise<string>
  /** v14.8: DeepSeek Responses API（原生联网搜索通道）— 模型配置勾选原生联网时由 ResponsesAdapter 路由 */
  responsesChat: (messages: { role: string; content: string; tool_calls?: unknown[]; tool_call_id?: string }[], configId: string, projectId?: string, tools?: unknown[], temperature?: number, source?: string, requestId?: string) => Promise<string>
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
    // v15.5: input_schema 可选——服务端工具（web_search_20250305）无 input_schema
    tools?: Array<{ name: string; description: string; input_schema?: Record<string, unknown>; type?: string; max_uses?: number }>
    /** v12.5.1: 阶段感知温度 */
    temperature?: number
    /** v14.2.1: 调用来源（main/subagent/pipeline）— 供 token 统计区分 */
    source?: string
    /** v14.6.1: 请求标识 — per-request abort（并行子代理精确中止） */
    requestId?: string
  }) => Promise<string>
  /** v14.6.1: requestId 可选 — 带 id 精确中止该请求，不带 = 中止全部 */
  abortAnthropicStream: (requestId?: string) => void
  onAnthropicChunk: (callback: (data: { chunk: string; accumulated: string }) => void) => () => void
  // M3: onAnthropicDone/onAnthropicError 已删除——usage/cost/error 全部随 invoke 返回值下发
}

export interface DialogAPI {
  saveFile: (defaultName: string) => Promise<string | null>
  saveZip: (defaultName: string) => Promise<string | null>
  openZip: () => Promise<string | null>
}

export interface AppAPI {
  // v14.9.x: checkUpdate 已移除——GitHub 网络受限，版本更新改为腾讯在线文档方式
  getProjectsBasePath: () => Promise<string>
  getImitationProjectsPath: () => Promise<string>
  getContinuationProjectDirsPath: () => Promise<string>
  getRewriteProjectsPath: () => Promise<string>
  getStoryWorkspacePath: () => Promise<string>
  // v14.0.1: getSystemPrompt 已移除——系统提示词以代码内 CORE_SYSTEM_PROMPT 为唯一来源
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

export interface UsageResult {
  entries: { timestamp: string; projectId: string; configId: string; configName: string; model: string; inputTokens: number; outputTokens: number; cacheHitTokens: number; cost: number; source?: string; _line: number }[]
  totalCount: number
  totals: { input: number; output: number; cacheHit: number; cost: number; count: number }
  byDay: { date: string; input: number; output: number; cacheHit: number; cost: number; count: number }[]
  byConfig: { configId: string; configName: string; model: string; input: number; output: number; cacheHit: number; cost: number; count: number }[]
  byModel: { model: string; input: number; output: number; cacheHit: number; cost: number; count: number }[]
  /** v14.2.1: 按调用来源汇总（main/subagent/pipeline/image；旧数据无 source 归 main） */
  bySource: { source: string; input: number; output: number; cacheHit: number; cost: number; count: number }[]
}

export interface SessionStatEntry {
  sessionId: string
  startedAt: string
  duration: number
  apiCallCount: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  /** v14 批处理: 会话内 API 调用费用（audit api:call cost 求和；旧日志无 → 0） */
  cost: number
  toolCalls: Array<{ toolName: string; count: number; lastUsed: string }>
  operations: string[]
  errorCount: number
  /** v14 批处理: 工具执行失败/被拦截次数（audit tool:result 非 success） */
  toolErrors: number
  /** v14 批处理: 权限拒绝次数（audit permission:decision effect=deny） */
  permissionDenied: number
  /** v14 批处理: 末事件时间戳（ISO） */
  lastUsed: string
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
    /** v14 批处理: 全部会话 API 费用合计 */
    cost: number
  }
}

export interface StatsAPI {
  getUsage: (opts?: { projectId?: string; year?: number; month?: number; day?: number; configId?: string; model?: string; source?: string }) => Promise<UsageResult>
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
  /** v14.3: 来源文件 id（渲染层据此记录"已注入"文件，供 kb_search 工具去重） */
  fileId?: string
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
  uploadFiles: (filePaths: string[], activeProjectId: string, folder?: string) => Promise<KnowledgeFile[]>
  delete: (fileId: string) => Promise<void>
  write: (fileId: string, content: string, configId?: string) => Promise<void>
  index: (fileId: string, configId: string) => Promise<{ chunkCount: number; failedCount?: number }>
  search: (query: string, projectId: string, configId: string, topK?: number, fileIds?: string[], excludeFileIds?: string[]) => Promise<KBSearchResult[]>
  assignProject: (fileId: string, projectId: string, assigned: boolean) => Promise<void>
  rename: (fileId: string, newName: string) => Promise<void>
  create: (name: string, content: string, projectId?: string, folder?: string) => Promise<{ id: string; name: string }>
  append: (fileId: string, content: string, configId?: string) => Promise<void>
  download: (fileId: string) => Promise<boolean>
  getEmbedding: (text: string, configId: string) => Promise<number[]>
  estimate: (filePath: string) => Promise<KBFileEstimate>
  webSearch: (query: string, maxResults?: number, safeSearch?: string, prioritySites?: { url: string }[]) => Promise<KBWebSearchResult[]>
  // v16: 三级目录
  listFolders: () => Promise<Array<{ dir: string; subdirs: string[]; files: Array<{ id: string; name: string }> }>>
  createFolder: (name: string, parent?: string) => Promise<{ name: string }>
  renameFolder: (folder: string, newName: string) => Promise<boolean>
  deleteFolder: (folder: string) => Promise<boolean>
  moveFile: (fileId: string, folder: string) => Promise<boolean>
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
  browser: { open: (url: string) => Promise<any>; search: (query: string) => Promise<any> }
  mcp: {
    listServers: () => Promise<any>
    connectServer: (name: string, config: { name: string; command: string; args: string[]; env?: Record<string, string> }) => Promise<any>
    disconnectServer: (name: string) => Promise<any>
    callTool: (serverName: string, toolName: string, args: Record<string, unknown>) => Promise<any>
    listTools: (serverName: string) => Promise<any>
    saveConfig: (servers: Array<{ name: string; command: string; args: string[]; env?: Record<string, string>; enabled?: boolean }>) => Promise<void>
    loadConfig: () => Promise<Array<{ name: string; command: string; args: string[]; env?: Record<string, string>; enabled?: boolean }>>
  }
  appendDebugLog: (name: string, line: string) => Promise<void>
}

declare global {
  interface Window {
    electron?: ElectronAPI
  }
}
