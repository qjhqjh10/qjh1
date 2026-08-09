import { contextBridge, ipcRenderer } from 'electron'
import type { ModelConfig } from '../src/types/settings'
import type { StyleProject, SceneTemplate } from '../src/types/story'
import type { KnowledgeFile, KnowledgeMetadata } from '../src/types/knowledge'
import type { KBSearchResult, KBWebSearchResult, KBFileEstimate, UsageResult, SessionStatsResult } from '../src/types/electron'
import type { ModelPricePreset } from '../src/utils/modelPricing'

const api = {
  files: {
    read: (path: string): Promise<string> => ipcRenderer.invoke('files:read', path),
    write: (path: string, content: string): Promise<void> =>
      ipcRenderer.invoke('files:write', path, content),
    listDir: (dirPath: string): Promise<string[]> => ipcRenderer.invoke('files:listDir', dirPath),
    ensureDir: (dirPath: string): Promise<void> => ipcRenderer.invoke('files:ensureDir', dirPath),
    deleteFile: (path: string): Promise<void> => ipcRenderer.invoke('files:deleteFile', path),
    deleteDir: (dirPath: string): Promise<void> => ipcRenderer.invoke('files:deleteDir', dirPath),
    readBinary: (filePath: string): Promise<string> => ipcRenderer.invoke('files:readBinary', filePath),
    writeBinary: (filePath: string, base64: string): Promise<void> => ipcRenderer.invoke('files:writeBinary', filePath, base64),
    saveImageUrl: (imageUrl: string, projectPath: string): Promise<string> => ipcRenderer.invoke('files:saveImageUrl', imageUrl, projectPath),
    onExternalChange: (callback: (event: { path: string; content: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { path: string; content: string }) =>
        callback(data)
      ipcRenderer.on('files:external-change', handler)
      return () => ipcRenderer.removeListener('files:external-change', handler)
    },
  },
  project: {
    create: (name: string, basePath: string, type?: string): Promise<void> =>
      ipcRenderer.invoke('project:create', name, basePath, type),
    delete: (projectPath: string): Promise<void> =>
      ipcRenderer.invoke('project:delete', projectPath),
    getMeta: (projectPath: string): Promise<{
      name: string; chapterCount: number; wordCount: number; path: string; type: string
      novelCategory?: string; coverImage?: string
    }> => ipcRenderer.invoke('project:getMeta', projectPath),
    listProjects: (basePath: string): Promise<string[]> =>
      ipcRenderer.invoke('project:listProjects', basePath),
    importProject: (zipPath: string): Promise<{ name: string; type: string }> =>
      ipcRenderer.invoke('project:import', zipPath),
    updateCategory: (projectPath: string, novelCategory: string): Promise<void> =>
      ipcRenderer.invoke('project:updateCategory', projectPath, novelCategory),
    rename: (projectPath: string, newName: string): Promise<{ name: string }> =>
      ipcRenderer.invoke('project:rename', projectPath, newName),
  },
  export: {
    exportChapters: (options: {
      chapters: { title: string; content: string }[]
      outputPath: string
      type: 'summary' | 'body'
    }): Promise<void> => ipcRenderer.invoke('export:chapters', options),
    exportSingleChapter: (options: {
      title: string; content: string; outputPath: string
    }): Promise<void> => ipcRenderer.invoke('export:singleChapter', options),
    exportProject: (projectPath: string, outputPath: string): Promise<void> =>
      ipcRenderer.invoke('export:project', projectPath, outputPath),
    exportEpub: (options: { title: string; author: string; chapters: { title: string; content: string }[]; outputPath: string }): Promise<void> => ipcRenderer.invoke('export:epub', options),
  },
  ai: {
    chat: (messages: { role: string; content: string }[], configId: string, projectId?: string): Promise<string> =>
      ipcRenderer.invoke('ai:chat', messages, configId, projectId),
    chatStream: (messages: { role: string; content: string }[], configId: string, projectId?: string): Promise<void> =>
      ipcRenderer.invoke('ai:chat-stream', messages, configId, projectId),
    generateImage: (prompt: string, configId: string, projectId?: string, size?: string, style?: string): Promise<{ path: string; url: string; cost: number; prompt: string }> =>
      ipcRenderer.invoke('ai:generateImage', prompt, configId, projectId, size, style),
    // v14.6.1: requestId 可选——带 id 精确中止该请求（并行子代理）；不带 = 中止全部在途请求
    abortStream: (requestId?: string): void => { ipcRenderer.send('ai:abort-stream'); ipcRenderer.send('ai:abort-tool-chat', requestId); ipcRenderer.send('ai:abort-image') },
    onChatChunk: (callback: (data: { chunk: string; accumulated: string }) => void) => {
      const handler = (_event: unknown, data: { chunk: string; accumulated: string }) => callback(data)
      ipcRenderer.on('ai:chat-chunk', handler)
      return () => ipcRenderer.removeListener('ai:chat-chunk', handler)
    },
    onChatDone: (callback: (data: { text: string; usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number; cost: number } }) => void) => {
      const handler = (_event: unknown, data: { text: string; usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number; cost: number } }) => callback(data)
      ipcRenderer.on('ai:chat-done', handler)
      return () => ipcRenderer.removeListener('ai:chat-done', handler)
    },
    onChatError: (callback: (data: { message: string }) => void) => {
      const handler = (_event: unknown, data: { message: string }) => callback(data)
      ipcRenderer.on('ai:chat-error', handler)
      return () => ipcRenderer.removeListener('ai:chat-error', handler)
    },
    onChatCancelled: (callback: (data: { message: string }) => void) => {
      const handler = (_event: unknown, data: { message: string }) => callback(data)
      ipcRenderer.on('ai:chat-cancelled', handler)
      return () => ipcRenderer.removeListener('ai:chat-cancelled', handler)
    },
    listModels: (configId: string, scope?: string): Promise<string[]> =>
      ipcRenderer.invoke('ai:listModels', configId, scope),
    // v15.2.1: 联网获取模型实时价格（OpenRouter 公开目录，免密钥）
    fetchModelPricing: (): Promise<{ models: Record<string, ModelPricePreset>; source: string; fetchedAt: number }> =>
      ipcRenderer.invoke('ai:fetch-model-pricing'),
    chatWithTools: (messages: { role: string; content: string; tool_calls?: unknown[]; tool_call_id?: string }[], configId: string, projectId?: string, tools?: unknown[], temperature?: number, source?: string, requestId?: string): Promise<string> =>
      ipcRenderer.invoke('ai:chat-with-tools', messages, configId, projectId, tools, temperature, source, requestId),
    // v14.8: DeepSeek Responses API（原生联网搜索通道）— 模型配置勾选原生联网时由 ResponsesAdapter 路由
    responsesChat: (messages: { role: string; content: string; tool_calls?: unknown[]; tool_call_id?: string }[], configId: string, projectId?: string, tools?: unknown[], temperature?: number, source?: string, requestId?: string): Promise<string> =>
      ipcRenderer.invoke('ai:responses-chat', messages, configId, projectId, tools, temperature, source, requestId),
    executeFileTools: (calls: Array<{ callId: string; toolName: string; args: Record<string, unknown> }>): Promise<Array<{ callId: string; toolName: string; status: string; summary: string; detail?: string }>> =>
      ipcRenderer.invoke('ai:execute-file-tool', calls),
    // ── Anthropic 协议（流式 content blocks，独立通道） ──
    chatAnthropicStream: (params: {
      // v11.7.0: system 支持 string 或 content block（含 cache_control）
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
      /** v14.6.1: 请求标识 — per-request abort（并行子代理场景精确中止） */
      requestId?: string
    }): Promise<string> =>
      ipcRenderer.invoke('ai:anthropic-messages', params),
    abortAnthropicStream: (requestId?: string): void => {
      ipcRenderer.send('ai:abort-anthropic', requestId)
    },
    onAnthropicChunk: (callback: (data: { chunk: string; accumulated: string }) => void) => {
      const handler = (_event: unknown, data: { chunk: string; accumulated: string }) => callback(data)
      ipcRenderer.on('ai:anthropic-chunk', handler)
      return () => ipcRenderer.removeListener('ai:anthropic-chunk', handler)
    },
    // M3: onAnthropicDone/onAnthropicError 已删除——usage/cost/error 全部随 invoke 返回值下发
  },
  settings: {
    saveConfigs: (configs: ModelConfig[]): Promise<{warning?: string}> =>
      ipcRenderer.invoke('settings:saveConfigs', configs),
    loadConfigs: (): Promise<ModelConfig[]> =>
      ipcRenderer.invoke('settings:loadConfigs'),
    clearConfigs: (): Promise<void> =>
      ipcRenderer.invoke('settings:clearConfigs'),
    savePexelsKey: (key: string): Promise<void> =>
      ipcRenderer.invoke('settings:savePexelsKey', key),
    loadPexelsKey: (): Promise<string> =>
      ipcRenderer.invoke('settings:loadPexelsKey'),
  },
  dialog: {
    saveFile: (defaultName: string): Promise<string | null> =>
      ipcRenderer.invoke('dialog:saveFile', defaultName),
    saveZip: (defaultName: string): Promise<string | null> =>
      ipcRenderer.invoke('dialog:saveZip', defaultName),
    openZip: (): Promise<string | null> =>
      ipcRenderer.invoke('dialog:openZip'),
  },
  app: {
    getProjectsBasePath: (): Promise<string> => ipcRenderer.invoke('app:getProjectsBasePath'),
    getImitationProjectsPath: (): Promise<string> => ipcRenderer.invoke('app:getImitationProjectsPath'),
    getContinuationProjectDirsPath: (): Promise<string> => ipcRenderer.invoke('app:getContinuationProjectDirsPath'),
    getStoryWorkspacePath: (): Promise<string> => ipcRenderer.invoke('app:getStoryWorkspacePath'),
    getRewriteProjectsPath: (): Promise<string> => ipcRenderer.invoke('app:getRewriteProjectsPath'),
    openFolder: (folderPath: string): Promise<void> => ipcRenderer.invoke('app:openFolder', folderPath),
    openFile: (filePath: string): Promise<void> => ipcRenderer.invoke('app:openFile', filePath),
    // v14.0.1: getSystemPrompt 已移除——系统提示词以代码内 CORE_SYSTEM_PROMPT 为唯一来源
  },
  kb: {
    list: (): Promise<KnowledgeMetadata> => ipcRenderer.invoke('kb:list'),
    read: (fileId: string): Promise<{ file: KnowledgeFile; content: string }> => ipcRenderer.invoke('kb:read', fileId),
    selectFiles: (): Promise<string[]> => ipcRenderer.invoke('kb:selectFiles'),
    uploadFiles: (filePaths: string[], activeProjectId: string, folder?: string): Promise<KnowledgeFile[]> =>
      ipcRenderer.invoke('kb:uploadFiles', filePaths, activeProjectId, folder),
    delete: (fileId: string): Promise<void> => ipcRenderer.invoke('kb:delete', fileId),
    write: (fileId: string, content: string, configId?: string): Promise<void> => ipcRenderer.invoke('kb:write', fileId, content, configId),
    index: (fileId: string, configId: string): Promise<{ chunkCount: number }> =>
      ipcRenderer.invoke('kb:index', fileId, configId),
    search: (query: string, projectId: string, configId: string, topK?: number, fileIds?: string[], excludeFileIds?: string[]): Promise<KBSearchResult[]> =>
      // v14.4.0 修复: 第 6 参 excludeFileIds 透传（此前丢弃 → v14.3 注入去重特性静默失效）
      ipcRenderer.invoke('kb:search', query, projectId, configId, topK ?? 3, fileIds, excludeFileIds),
    assignProject: (fileId: string, projectId: string, assigned: boolean): Promise<void> =>
      ipcRenderer.invoke('kb:assignProject', fileId, projectId, assigned),
    rename: (fileId: string, newName: string): Promise<void> =>
      ipcRenderer.invoke('kb:rename', fileId, newName),
    download: (fileId: string): Promise<boolean> =>
      ipcRenderer.invoke('kb:download', fileId),
    getEmbedding: (text: string, configId: string): Promise<number[]> =>
      ipcRenderer.invoke('kb:getEmbedding', text, configId),
    estimate: (filePath: string): Promise<KBFileEstimate> => ipcRenderer.invoke('kb:estimate', filePath),
    create: (name: string, content: string, projectId?: string, folder?: string): Promise<{ id: string; name: string }> =>
      ipcRenderer.invoke('kb:create', name, content, projectId, folder),
    append: (fileId: string, content: string, configId?: string): Promise<void> =>
      ipcRenderer.invoke('kb:append', fileId, content, configId),
    // v16: 三级目录
    listFolders: (): Promise<Array<{ dir: string; subdirs: string[]; files: Array<{ id: string; name: string }> }>> =>
      ipcRenderer.invoke('kb:listFolders'),
    createFolder: (name: string, parent?: string): Promise<{ name: string }> =>
      ipcRenderer.invoke('kb:createFolder', name, parent),
    renameFolder: (folder: string, newName: string): Promise<boolean> =>
      ipcRenderer.invoke('kb:renameFolder', folder, newName),
    deleteFolder: (folder: string): Promise<boolean> =>
      ipcRenderer.invoke('kb:deleteFolder', folder),
    moveFile: (fileId: string, folder: string): Promise<boolean> =>
      ipcRenderer.invoke('kb:moveFile', fileId, folder),
    webSearch: (query: string, maxResults?: number, safeSearch?: string, prioritySites?: { url: string }[]): Promise<KBWebSearchResult[]> =>
      ipcRenderer.invoke('kb:webSearch', query, maxResults ?? 5, safeSearch ?? 'moderate', prioritySites ?? []),
  },
  notes: {
    search: (query: string, configId: string, topK?: number): Promise<{ content: string; fileName: string; score: number }[]> =>
      ipcRenderer.invoke('notes:search', query, configId, topK ?? 3),
  },
  stats: {
    getUsage: (opts?: { projectId?: string; year?: number; month?: number; day?: number; configId?: string; model?: string; source?: string }): Promise<UsageResult> =>
      ipcRenderer.invoke('stats:getUsage', opts || {}),
    deleteByLine: (lineNumber: number): Promise<void> => ipcRenderer.invoke('stats:deleteByLine', lineNumber),
    getMonthCost: (): Promise<number> => ipcRenderer.invoke('stats:getMonthCost'),
    getSessionStats: (): Promise<SessionStatsResult> => ipcRenderer.invoke('stats:getSessionStats'),
    reset: (): Promise<any> => ipcRenderer.invoke('stats:reset'),
    deleteSession: (sessionId: string): Promise<any> => ipcRenderer.invoke('stats:deleteSession', sessionId),
    resetSessions: (): Promise<any> => ipcRenderer.invoke('stats:resetSessions'),
  },
  styleProjects: {
    importFile: (): Promise<{ name: string; content: string } | null> => ipcRenderer.invoke('style:importFile'),
    listProjects: (): Promise<{ id: string; name: string; sourceFileName: string; chapterCount: number; totalCharCount: number; hasProfile: boolean; createdAt: string }[]> => ipcRenderer.invoke('style:listProjects'),
    loadProject: (id: string): Promise<StyleProject> => ipcRenderer.invoke('style:loadProject', id),
    saveProject: (project: StyleProject): Promise<void> => ipcRenderer.invoke('style:saveProject', project),
    deleteProject: (id: string): Promise<void> => ipcRenderer.invoke('style:deleteProject', id),
  },
  styleTemplates: {
    list: (): Promise<any[]> => ipcRenderer.invoke('styleTemplate:list'),
    listProject: (projectPath: string): Promise<any[]> => ipcRenderer.invoke('styleTemplate:listProject', projectPath),
    read: (id: string): Promise<any> => ipcRenderer.invoke('styleTemplate:read', id),
    save: (template: any): Promise<any> => ipcRenderer.invoke('styleTemplate:save', template),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('styleTemplate:delete', id),
    readPrompt: (id: string): Promise<string | null> => ipcRenderer.invoke('styleTemplate:readPrompt', id),
    savePrompt: (id: string, content: string): Promise<void> => ipcRenderer.invoke('styleTemplate:savePrompt', id, content),
    deletePrompt: (id: string): Promise<void> => ipcRenderer.invoke('styleTemplate:deletePrompt', id),
    listRuleTemplates: (): Promise<any[]> => ipcRenderer.invoke('styleTemplate:listRuleTemplates'),
    readRuleTemplate: (id: string): Promise<any> => ipcRenderer.invoke('styleTemplate:readRuleTemplate', id),
    saveRuleTemplate: (template: any): Promise<any> => ipcRenderer.invoke('styleTemplate:saveRuleTemplate', template),
    deleteRuleTemplate: (id: string): Promise<void> => ipcRenderer.invoke('styleTemplate:deleteRuleTemplate', id),
  },
  templates: {
    list: (): Promise<SceneTemplate[]> => ipcRenderer.invoke('template:list'),
    listProject: (projectPath: string): Promise<SceneTemplate[]> => ipcRenderer.invoke('template:listProject', projectPath),
    save: (template: SceneTemplate): Promise<SceneTemplate> => ipcRenderer.invoke('template:save', template),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('template:delete', id),
  },
  continuation: {
    list: (): Promise<any[]> => ipcRenderer.invoke('continuation:list'),
    read: (id: string): Promise<any> => ipcRenderer.invoke('continuation:read', id),
    save: (project: any): Promise<any> => ipcRenderer.invoke('continuation:save', project),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('continuation:delete', id),
  },
  rewrite: {
    list: (): Promise<any[]> => ipcRenderer.invoke('rewrite:list'),
    read: (id: string): Promise<any> => ipcRenderer.invoke('rewrite:read', id),
    save: (project: any): Promise<any> => ipcRenderer.invoke('rewrite:save', project),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('rewrite:delete', id),
    create: (arg: { name: string; sourceFileName: string; content: string }): Promise<any> => ipcRenderer.invoke('rewrite:create', arg),
    importFile: (): Promise<{ name: string; content: string; sourceFileName: string } | null> => ipcRenderer.invoke('rewrite:importFile'),
    saveChapters: (arg: { projectId: string; sourceWordCount: number; chapters: { title: string; content: string }[] }): Promise<any> => ipcRenderer.invoke('rewrite:saveChapters', arg),
    getProjectPath: (id: string): Promise<string> => ipcRenderer.invoke('rewrite:getProjectPath', id),
    readChapter: (id: string, fileName: string): Promise<string> => ipcRenderer.invoke('rewrite:readChapter', id, fileName),
    saveAnalysis: (id: string, fileName: string, content: string): Promise<void> => ipcRenderer.invoke('rewrite:saveAnalysis', id, fileName, content),
    readAnalysis: (id: string, fileName: string): Promise<string> => ipcRenderer.invoke('rewrite:readAnalysis', id, fileName),
    deleteAnalysis: (id: string, fileName: string): Promise<void> => ipcRenderer.invoke('rewrite:deleteAnalysis', id, fileName),
    saveRewrite: (id: string, fileName: string, content: string): Promise<void> => ipcRenderer.invoke('rewrite:saveRewrite', id, fileName, content),
    readRewrite: (id: string, fileName: string): Promise<string> => ipcRenderer.invoke('rewrite:readRewrite', id, fileName),
    deleteRewrite: (id: string, fileName: string): Promise<void> => ipcRenderer.invoke('rewrite:deleteRewrite', id, fileName),
    mergeRewrites: (id: string, outputPath: string, chapterIds?: string[]): Promise<any> => ipcRenderer.invoke('rewrite:mergeRewrites', id, outputPath, chapterIds),
    // 提示词模板
    templates: {
      list: () => ipcRenderer.invoke('rewriteTemplate:list'),
      read: (id: string) => ipcRenderer.invoke('rewriteTemplate:read', id),
      save: (template: any) => ipcRenderer.invoke('rewriteTemplate:save', template),
      delete: (id: string) => ipcRenderer.invoke('rewriteTemplate:delete', id),
      import: () => ipcRenderer.invoke('rewriteTemplate:import'),
      export: (id: string) => ipcRenderer.invoke('rewriteTemplate:export', id),
    },
  },
  extractions: {
    importFile: (): Promise<{ name: string; content: string } | null> => ipcRenderer.invoke('extraction:importFile'),
    importFromPath: (filePath: string): Promise<{ name: string; content: string }> => ipcRenderer.invoke('extraction:importFromPath', filePath),
  },
  story: {
    list: (): Promise<any[]> => ipcRenderer.invoke('story:list'),
    create: (name: string): Promise<any> => ipcRenderer.invoke('story:create', name),
    readMeta: (id: string): Promise<any> => ipcRenderer.invoke('story:readMeta', id),
    saveMeta: (id: string, meta: any): Promise<void> => ipcRenderer.invoke('story:saveMeta', id, meta),
    readChapter: (id: string, chId: string): Promise<string> => ipcRenderer.invoke('story:readChapter', id, chId),
    writeChapter: (id: string, chId: string, content: string): Promise<void> => ipcRenderer.invoke('story:writeChapter', id, chId, content),
    readAnalysis: (id: string, chId: string): Promise<string> => ipcRenderer.invoke('story:readAnalysis', id, chId),
    writeAnalysis: (id: string, chId: string, content: string): Promise<void> => ipcRenderer.invoke('story:writeAnalysis', id, chId, content),
    readGraph: (id: string): Promise<string> => ipcRenderer.invoke('story:readGraph', id),
    writeGraph: (id: string, content: string): Promise<void> => ipcRenderer.invoke('story:writeGraph', id, content),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('story:delete', id),
  },


  appendDebugLog: (name: string, line: string): Promise<void> => ipcRenderer.invoke('debug:append-log', name, line),
  http: {
    fetch: (url: string, options?: Record<string, unknown>): Promise<any> => ipcRenderer.invoke('http:fetch', url, options),
    get: (url: string): Promise<any> => ipcRenderer.invoke('http:get', url),
  },
  browser: {
    open: (url: string): Promise<any> => ipcRenderer.invoke('browser:open', url),
    search: (query: string): Promise<any> => ipcRenderer.invoke('browser:search', query),
  },
  mcp: {
    listServers: (): Promise<any> => ipcRenderer.invoke('mcp:list-servers'),
    connectServer: (name: string, config: { name: string; command: string; args: string[]; env?: Record<string, string> }): Promise<any> => ipcRenderer.invoke('mcp:connect', name, config),
    disconnectServer: (name: string): Promise<any> => ipcRenderer.invoke('mcp:disconnect', name),
    callTool: (serverName: string, toolName: string, args: Record<string, unknown>): Promise<any> => ipcRenderer.invoke('mcp:call-tool', serverName, toolName, args),
    listTools: (serverName: string): Promise<any> => ipcRenderer.invoke('mcp:list-tools', serverName),
    saveConfig: (servers: Array<{ name: string; command: string; args: string[]; env?: Record<string, string>; enabled?: boolean }>): Promise<void> => ipcRenderer.invoke('mcp:save-config', servers),
    loadConfig: (): Promise<Array<{ name: string; command: string; args: string[]; env?: Record<string, string>; enabled?: boolean }>> => ipcRenderer.invoke('mcp:load-config'),
  },
}

contextBridge.exposeInMainWorld('electron', api)

export type ElectronAPI = typeof api
