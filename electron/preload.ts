import { contextBridge, ipcRenderer } from 'electron'
import type { ModelConfig } from '../src/types/settings'
import type { StyleProject, SceneTemplate } from '../src/types/story'
import type { KnowledgeFile, KnowledgeMetadata } from '../src/types/knowledge'
import type { KBSearchResult, KBWebSearchResult, KBFileEstimate, ModelPrice, UsageResult, SessionStatsResult } from '../src/types/electron'

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
    generateImage: (prompt: string, configId: string, projectId?: string, size?: string, style?: string): Promise<{ path: string; url: string; cost: number }> =>
      ipcRenderer.invoke('ai:generateImage', prompt, configId, projectId, size, style),
    abortStream: (): void => { ipcRenderer.send('ai:abort-stream'); ipcRenderer.send('ai:abort-tool-chat') },
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
    listModels: (configId: string): Promise<string[]> =>
      ipcRenderer.invoke('ai:listModels', configId),
    chatWithTools: (messages: { role: string; content: string; tool_calls?: unknown[]; tool_call_id?: string }[], configId: string, projectId?: string, tools?: unknown[]): Promise<string> =>
      ipcRenderer.invoke('ai:chat-with-tools', messages, configId, projectId, tools),
    executeFileTools: (calls: Array<{ callId: string; toolName: string; args: Record<string, unknown> }>): Promise<Array<{ callId: string; toolName: string; status: string; summary: string; detail?: string }>> =>
      ipcRenderer.invoke('ai:execute-file-tool', calls),
    // ── Anthropic 协议（流式 content blocks，独立通道） ──
    chatAnthropicStream: (params: {
      system: string[]
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
    }): Promise<string> =>
      ipcRenderer.invoke('ai:anthropic-messages', params),
    abortAnthropicStream: (): void => {
      ipcRenderer.send('ai:abort-anthropic')
    },
    onAnthropicChunk: (callback: (data: { chunk: string; accumulated: string }) => void) => {
      const handler = (_event: unknown, data: { chunk: string; accumulated: string }) => callback(data)
      ipcRenderer.on('ai:anthropic-chunk', handler)
      return () => ipcRenderer.removeListener('ai:anthropic-chunk', handler)
    },
    onAnthropicDone: (callback: (data: { text: string; usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number; cost: number; cacheHitTokens?: number } }) => void) => {
      const handler = (_event: unknown, data: { text: string; usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number; cost: number; cacheHitTokens?: number } }) => callback(data)
      ipcRenderer.on('ai:anthropic-done', handler)
      return () => ipcRenderer.removeListener('ai:anthropic-done', handler)
    },
    onAnthropicError: (callback: (data: { message: string }) => void) => {
      const handler = (_event: unknown, data: { message: string }) => callback(data)
      ipcRenderer.on('ai:anthropic-error', handler)
      return () => ipcRenderer.removeListener('ai:anthropic-error', handler)
    },
  },
  settings: {
    saveConfigs: (configs: ModelConfig[]): Promise<{warning?: string}> =>
      ipcRenderer.invoke('settings:saveConfigs', configs),
    loadConfigs: (): Promise<ModelConfig[]> =>
      ipcRenderer.invoke('settings:loadConfigs'),
    clearConfigs: (): Promise<void> =>
      ipcRenderer.invoke('settings:clearConfigs'),
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
    getStoryWorkspacePath: (): Promise<string> => ipcRenderer.invoke('app:getStoryWorkspacePath'),
  },
  kb: {
    list: (): Promise<KnowledgeMetadata> => ipcRenderer.invoke('kb:list'),
    read: (fileId: string): Promise<{ file: KnowledgeFile; content: string }> => ipcRenderer.invoke('kb:read', fileId),
    selectFiles: (): Promise<string[]> => ipcRenderer.invoke('kb:selectFiles'),
    uploadFiles: (filePaths: string[], activeProjectId: string): Promise<KnowledgeFile[]> =>
      ipcRenderer.invoke('kb:uploadFiles', filePaths, activeProjectId),
    delete: (fileId: string): Promise<void> => ipcRenderer.invoke('kb:delete', fileId),
    write: (fileId: string, content: string, configId?: string): Promise<void> => ipcRenderer.invoke('kb:write', fileId, content, configId),
    index: (fileId: string, configId: string): Promise<{ chunkCount: number }> =>
      ipcRenderer.invoke('kb:index', fileId, configId),
    search: (query: string, projectId: string, configId: string, topK?: number, fileIds?: string[]): Promise<KBSearchResult[]> =>
      ipcRenderer.invoke('kb:search', query, projectId, configId, topK ?? 3, fileIds),
    assignProject: (fileId: string, projectId: string, assigned: boolean): Promise<void> =>
      ipcRenderer.invoke('kb:assignProject', fileId, projectId, assigned),
    rename: (fileId: string, newName: string): Promise<void> =>
      ipcRenderer.invoke('kb:rename', fileId, newName),
    download: (fileId: string): Promise<boolean> =>
      ipcRenderer.invoke('kb:download', fileId),
    getEmbedding: (text: string, configId: string): Promise<number[]> =>
      ipcRenderer.invoke('kb:getEmbedding', text, configId),
    estimate: (filePath: string): Promise<KBFileEstimate> => ipcRenderer.invoke('kb:estimate', filePath),
    create: (name: string, content: string, projectId?: string): Promise<{ id: string; name: string }> =>
      ipcRenderer.invoke('kb:create', name, content, projectId),
    append: (fileId: string, content: string, configId?: string): Promise<void> =>
      ipcRenderer.invoke('kb:append', fileId, content, configId),
    webSearch: (query: string, maxResults?: number, safeSearch?: string, prioritySites?: { url: string }[]): Promise<KBWebSearchResult[]> =>
      ipcRenderer.invoke('kb:webSearch', query, maxResults ?? 5, safeSearch ?? 'moderate', prioritySites ?? []),
  },
  notes: {
    search: (query: string, configId: string, topK?: number): Promise<{ content: string; fileName: string; score: number }[]> =>
      ipcRenderer.invoke('notes:search', query, configId, topK ?? 3),
  },
  stats: {
    getUsage: (opts?: { projectId?: string; year?: number; month?: number; day?: number; configId?: string; model?: string }): Promise<UsageResult> =>
      ipcRenderer.invoke('stats:getUsage', opts || {}),
    getPrices: (): Promise<ModelPrice[]> => ipcRenderer.invoke('stats:getPrices'),
    savePrices: (prices: ModelPrice[]): Promise<void> => ipcRenderer.invoke('stats:savePrices', prices),
    deleteByLine: (lineNumber: number): Promise<void> => ipcRenderer.invoke('stats:deleteByLine', lineNumber),
    getMonthCost: (): Promise<number> => ipcRenderer.invoke('stats:getMonthCost'),
    getSessionStats: (): Promise<SessionStatsResult> => ipcRenderer.invoke('stats:getSessionStats'),
    reset: (): Promise<any> => ipcRenderer.invoke('stats:reset'),
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
  },
  templates: {
    list: (): Promise<SceneTemplate[]> => ipcRenderer.invoke('template:list'),
    listProject: (projectPath: string): Promise<SceneTemplate[]> => ipcRenderer.invoke('template:listProject', projectPath),
    save: (template: SceneTemplate): Promise<void> => ipcRenderer.invoke('template:save', template),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('template:delete', id),
  },
  continuation: {
    list: (): Promise<any[]> => ipcRenderer.invoke('continuation:list'),
    read: (id: string): Promise<any> => ipcRenderer.invoke('continuation:read', id),
    save: (project: any): Promise<any> => ipcRenderer.invoke('continuation:save', project),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('continuation:delete', id),
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
  rewrite: {
    list: (): Promise<any[]> => ipcRenderer.invoke('rewrite:list'),
    create: (name: string): Promise<any> => ipcRenderer.invoke('rewrite:create', name),
    readMeta: (id: string): Promise<any> => ipcRenderer.invoke('rewrite:readMeta', id),
    saveMeta: (id: string, meta: any): Promise<void> => ipcRenderer.invoke('rewrite:saveMeta', id, meta),
    readChapter: (id: string, chId: string): Promise<string> => ipcRenderer.invoke('rewrite:readChapter', id, chId),
    writeChapter: (id: string, chId: string, content: string): Promise<void> => ipcRenderer.invoke('rewrite:writeChapter', id, chId, content),
    readAnalysis: (id: string, chId: string): Promise<string> => ipcRenderer.invoke('rewrite:readAnalysis', id, chId),
    writeAnalysis: (id: string, chId: string, content: string): Promise<void> => ipcRenderer.invoke('rewrite:writeAnalysis', id, chId, content),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('rewrite:delete', id),
  },
  appendDebugLog: (name: string, line: string): Promise<void> => ipcRenderer.invoke('debug:append-log', name, line),
  agent: {
    sessionSave: (id: string, data: string): Promise<{ success: boolean }> => ipcRenderer.invoke('agent:session-save', id, data),
    sessionLoad: (id: string): Promise<any> => ipcRenderer.invoke('agent:session-load', id),
    sessionList: (): Promise<any[]> => ipcRenderer.invoke('agent:session-list'),
    sessionDelete: (id: string): Promise<{ success: boolean }> => ipcRenderer.invoke('agent:session-delete', id),
    permissionRecord: (toolName: string, approved: boolean): Promise<{ success: boolean }> => ipcRenderer.invoke('agent:permission-record', toolName, approved),
    permissionPatterns: (): Promise<Record<string, any>> => ipcRenderer.invoke('agent:permission-patterns'),
    getSessionsPath: (): Promise<string> => ipcRenderer.invoke('agent:get-sessions-path'),
    optimize: (configId: string, command: string): Promise<string> => ipcRenderer.invoke('agent:optimize', configId, command),
  },
  http: {
    fetch: (url: string, options?: Record<string, unknown>): Promise<any> => ipcRenderer.invoke('http:fetch', url, options),
    get: (url: string): Promise<any> => ipcRenderer.invoke('http:get', url),
  },
  browser: {
    open: (url: string): Promise<any> => ipcRenderer.invoke('browser:open', url),
    screenshot: (url: string, path?: string): Promise<any> => ipcRenderer.invoke('browser:screenshot', url, path),
    search: (query: string): Promise<any> => ipcRenderer.invoke('browser:search', query),
  },
  shell: {
    exec: (command: string, cwd?: string): Promise<any> => ipcRenderer.invoke('shell:exec', command, cwd),
    runScript: (name: string): Promise<any> => ipcRenderer.invoke('shell:run-script', name),
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
  lsp: {
    diagnose: (filePath?: string): Promise<any> => ipcRenderer.invoke('lsp:diagnose', filePath),
  },
}

contextBridge.exposeInMainWorld('electron', api)

export type ElectronAPI = typeof api
