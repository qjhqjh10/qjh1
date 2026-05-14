import { logError } from '@/utils/logger'

function e() {
  if (!window.electron) throw new Error('Electron bridge not available - run in Electron environment')
  return window.electron
}

export const fileService = {
  read: (path: string) => e().files.read(path),
  write: (path: string, content: string) => e().files.write(path, content),
  listDir: (dirPath: string) => e().files.listDir(dirPath),
  ensureDir: (dirPath: string) => e().files.ensureDir(dirPath),
  deleteFile: (path: string) => e().files.deleteFile(path),
  deleteDir: (dirPath: string) => e().files.deleteDir(dirPath),
  onExternalChange: (cb: (event: { path: string; content: string }) => void) =>
    e().files.onExternalChange(cb),
}

export const projectService = {
  create: (name: string, basePath: string) => e().project.create(name, basePath),
  delete: (projectPath: string) => e().project.delete(projectPath),
  getMeta: (projectPath: string) => e().project.getMeta(projectPath),
  listProjects: (basePath: string) => e().project.listProjects(basePath),
}

export const exportService = {
  exportChapters: (opts: {
    chapters: { title: string; content: string }[]
    outputPath: string
    type: 'summary' | 'body'
  }) => e().export.exportChapters(opts),
  exportSingleChapter: (opts: {
    title: string; content: string; outputPath: string
  }) => e().export.exportSingleChapter(opts),
}

export const aiService = {
  chat: async (messages: { role: string; content: string }[], configId: string, projectId?: string): Promise<string> => {
    const raw = await e().ai.chat(messages, configId, projectId)
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed.text === 'string') return parsed.text
      return raw
    } catch (e) { logError('解析 AI 回复 JSON 失败', e); return raw }
  },
  chatWithUsage: async (messages: { role: string; content: string }[], configId: string, projectId?: string) => {
    const raw = await e().ai.chat(messages, configId, projectId)
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed.text === 'string') return { text: parsed.text as string, usage: parsed.usage as { prompt_tokens: number; completion_tokens: number; total_tokens: number; cost: number } | undefined }
    } catch (e) { logError('解析 AI 回复 JSON 失败 (chatWithUsage)', e) }
    return { text: raw, usage: undefined }
  },
  listModels: (configId: string) => e().ai.listModels(configId),
  chatStream: (
    messages: { role: string; content: string }[],
    configId: string,
    projectId: string | undefined,
    onChunk: (data: { chunk: string; accumulated: string }) => void,
    onDone: (data: { text: string; usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number; cost: number } }) => void,
    onError: (data: { message: string }) => void,
    onCancelled?: (data: { message: string }) => void,
  ): { abort: () => void } => {
    const cleanupChunk = e().ai.onChatChunk(onChunk)
    const cleanupDone = e().ai.onChatDone((data) => { cleanupAll(); onDone(data) })
    const cleanupError = e().ai.onChatError((data) => { cleanupAll(); onError(data) })
    const cleanupCancelled = e().ai.onChatCancelled((data) => { cleanupAll(); onCancelled?.(data) })

    const cleanupAll = () => { cleanupChunk(); cleanupDone(); cleanupError(); cleanupCancelled() }

    const abort = () => {
      e().ai.abortStream()
      cleanupAll()
    }

    e().ai.chatStream(messages, configId, projectId)
    return { abort }
  },
}

export const kbService = {
  list: () => e().kb.list(),
  read: (fileId: string) => e().kb.read(fileId),
  upload: (activeProjectId: string) => e().kb.upload(activeProjectId),
  selectFiles: () => e().kb.selectFiles(),
  uploadFiles: (filePaths: string[], activeProjectId: string) => e().kb.uploadFiles(filePaths, activeProjectId),
  delete: (fileId: string) => e().kb.delete(fileId),
  write: (fileId: string, content: string) => e().kb.write(fileId, content),
  index: (fileId: string, apiUrl: string, apiKey: string, embeddingModel: string) =>
    e().kb.index(fileId, apiUrl, apiKey, embeddingModel),
  search: (query: string, projectId: string, apiUrl: string, apiKey: string, embeddingModel: string, topK?: number, fileIds?: string[]) =>
    e().kb.search(query, projectId, apiUrl, apiKey, embeddingModel, topK, fileIds),
  assignProject: (fileId: string, projectId: string, assigned: boolean) =>
    e().kb.assignProject(fileId, projectId, assigned),
  getEmbedding: (text: string, apiUrl: string, apiKey: string, embeddingModel: string) =>
    e().kb.getEmbedding(text, apiUrl, apiKey, embeddingModel),
  estimate: (filePath: string) => e().kb.estimate(filePath),
  rename: (fileId: string, newName: string) => e().kb.rename(fileId, newName),
  download: (fileId: string) => e().kb.download(fileId),
  webSearch: (query: string, maxResults?: number) => e().kb.webSearch(query, maxResults),
}

export const dialogService = {
  selectDirectory: () => e().dialog.selectDirectory(),
  saveFile: (defaultName: string) => e().dialog.saveFile(defaultName),
}

export const appService = {
  getProjectsBasePath: () => e().app.getProjectsBasePath(),
}

export const settingsService = {
  saveConfigs: (configs: unknown[]) => e().settings.saveConfigs(configs),
  loadConfigs: () => e().settings.loadConfigs(),
}

export const statsService = {
  getUsage: (opts?: { projectId?: string; year?: number; month?: number; day?: number; configId?: string; model?: string }) =>
    e().stats.getUsage(opts || {}),
  getPrices: () => e().stats.getPrices(),
  savePrices: (prices: unknown[]) => e().stats.savePrices(prices),
  deleteByLine: (lineNumber: number) => e().stats.deleteByLine(lineNumber),
}

export const styleProjectService = {
  importFile: () => e().styleProjects.importFile(),
  listProjects: () => e().styleProjects.listProjects(),
  loadProject: (id: string) => e().styleProjects.loadProject(id),
  saveProject: (project: unknown) => e().styleProjects.saveProject(project),
  deleteProject: (id: string) => e().styleProjects.deleteProject(id),
}

export const templateService = {
  list: () => e().templates.list(),
  save: (template: unknown) => e().templates.save(template),
  delete: (id: string) => e().templates.delete(id),
}
