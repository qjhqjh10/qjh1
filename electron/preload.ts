import { contextBridge, ipcRenderer } from 'electron'

const api = {
  files: {
    read: (path: string): Promise<string> => ipcRenderer.invoke('files:read', path),
    write: (path: string, content: string): Promise<void> =>
      ipcRenderer.invoke('files:write', path, content),
    listDir: (dirPath: string): Promise<string[]> => ipcRenderer.invoke('files:listDir', dirPath),
    ensureDir: (dirPath: string): Promise<void> => ipcRenderer.invoke('files:ensureDir', dirPath),
    deleteFile: (path: string): Promise<void> => ipcRenderer.invoke('files:deleteFile', path),
    deleteDir: (dirPath: string): Promise<void> => ipcRenderer.invoke('files:deleteDir', dirPath),
    onExternalChange: (callback: (event: { path: string; content: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { path: string; content: string }) =>
        callback(data)
      ipcRenderer.on('files:external-change', handler)
      return () => ipcRenderer.removeListener('files:external-change', handler)
    },
  },
  project: {
    create: (name: string, basePath: string): Promise<void> =>
      ipcRenderer.invoke('project:create', name, basePath),
    delete: (projectPath: string): Promise<void> =>
      ipcRenderer.invoke('project:delete', projectPath),
    getMeta: (projectPath: string): Promise<{
      name: string; chapterCount: number; wordCount: number; path: string
    }> => ipcRenderer.invoke('project:getMeta', projectPath),
    listProjects: (basePath: string): Promise<string[]> =>
      ipcRenderer.invoke('project:listProjects', basePath),
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
  },
  ai: {
    chat: (messages: { role: string; content: string }[], configId: string, projectId?: string): Promise<string> =>
      ipcRenderer.invoke('ai:chat', messages, configId, projectId),
    chatStream: (messages: { role: string; content: string }[], configId: string, projectId?: string): Promise<void> =>
      ipcRenderer.invoke('ai:chat-stream', messages, configId, projectId),
    abortStream: (): void => { ipcRenderer.send('ai:abort-stream') },
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
  },
  settings: {
    saveConfigs: (configs: unknown[]): Promise<void> =>
      ipcRenderer.invoke('settings:saveConfigs', configs),
    loadConfigs: (): Promise<unknown[]> =>
      ipcRenderer.invoke('settings:loadConfigs'),
  },
  dialog: {
    selectDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:selectDirectory'),
    saveFile: (defaultName: string): Promise<string | null> =>
      ipcRenderer.invoke('dialog:saveFile', defaultName),
  },
  app: {
    getAppPath: (): Promise<string> => ipcRenderer.invoke('app:getAppPath'),
    getProjectsBasePath: (): Promise<string> => ipcRenderer.invoke('app:getProjectsBasePath'),
  },
  kb: {
    list: (): Promise<unknown> => ipcRenderer.invoke('kb:list'),
    read: (fileId: string): Promise<unknown> => ipcRenderer.invoke('kb:read', fileId),
    upload: (activeProjectId: string): Promise<unknown> => ipcRenderer.invoke('kb:upload', activeProjectId),
    selectFiles: (): Promise<string[]> => ipcRenderer.invoke('kb:selectFiles'),
    uploadFiles: (filePaths: string[], activeProjectId: string): Promise<unknown> =>
      ipcRenderer.invoke('kb:uploadFiles', filePaths, activeProjectId),
    delete: (fileId: string): Promise<void> => ipcRenderer.invoke('kb:delete', fileId),
    write: (fileId: string, content: string): Promise<void> => ipcRenderer.invoke('kb:write', fileId, content),
    index: (fileId: string, apiUrl: string, apiKey: string, embeddingModel: string): Promise<unknown> =>
      ipcRenderer.invoke('kb:index', fileId, apiUrl, apiKey, embeddingModel),
    search: (query: string, projectId: string, apiUrl: string, apiKey: string, embeddingModel: string, topK?: number, fileIds?: string[]): Promise<unknown[]> =>
      ipcRenderer.invoke('kb:search', query, projectId, apiUrl, apiKey, embeddingModel, topK ?? 3, fileIds),
    assignProject: (fileId: string, projectId: string, assigned: boolean): Promise<void> =>
      ipcRenderer.invoke('kb:assignProject', fileId, projectId, assigned),
    rename: (fileId: string, newName: string): Promise<void> =>
      ipcRenderer.invoke('kb:rename', fileId, newName),
    download: (fileId: string): Promise<boolean> =>
      ipcRenderer.invoke('kb:download', fileId),
    getEmbedding: (text: string, apiUrl: string, apiKey: string, embeddingModel: string): Promise<number[]> =>
      ipcRenderer.invoke('kb:getEmbedding', text, apiUrl, apiKey, embeddingModel),
    estimate: (filePath: string): Promise<unknown> => ipcRenderer.invoke('kb:estimate', filePath),
    webSearch: (query: string, maxResults?: number): Promise<unknown[]> =>
      ipcRenderer.invoke('kb:webSearch', query, maxResults ?? 5),
  },
  stats: {
    getUsage: (opts?: { projectId?: string; year?: number; month?: number; day?: number; configId?: string; model?: string }): Promise<unknown> =>
      ipcRenderer.invoke('stats:getUsage', opts || {}),
    getPrices: (): Promise<unknown> => ipcRenderer.invoke('stats:getPrices'),
    savePrices: (prices: unknown[]): Promise<void> => ipcRenderer.invoke('stats:savePrices', prices),
    deleteByLine: (lineNumber: number): Promise<void> => ipcRenderer.invoke('stats:deleteByLine', lineNumber),
  },
  styleProjects: {
    importFile: (): Promise<{ name: string; content: string } | null> => ipcRenderer.invoke('style:importFile'),
    listProjects: (): Promise<unknown[]> => ipcRenderer.invoke('style:listProjects'),
    loadProject: (id: string): Promise<unknown> => ipcRenderer.invoke('style:loadProject', id),
    saveProject: (project: unknown): Promise<void> => ipcRenderer.invoke('style:saveProject', project),
    deleteProject: (id: string): Promise<void> => ipcRenderer.invoke('style:deleteProject', id),
  },
  templates: {
    list: (): Promise<unknown[]> => ipcRenderer.invoke('template:list'),
    save: (template: unknown): Promise<void> => ipcRenderer.invoke('template:save', template),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('template:delete', id),
  },
  extractions: {
    importFile: (): Promise<{ name: string; content: string } | null> => ipcRenderer.invoke('extraction:importFile'),
    listProjects: (): Promise<unknown[]> => ipcRenderer.invoke('extraction:listProjects'),
    loadProject: (id: string): Promise<unknown> => ipcRenderer.invoke('extraction:loadProject', id),
    saveProject: (project: unknown): Promise<void> => ipcRenderer.invoke('extraction:saveProject', project),
    deleteProject: (id: string): Promise<void> => ipcRenderer.invoke('extraction:deleteProject', id),
  },
}

contextBridge.exposeInMainWorld('electron', api)

export type ElectronAPI = typeof api
