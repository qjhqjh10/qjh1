import { logError } from '@/utils/logger'
import type { ModelConfig } from '@/types/settings'
import type { StyleProject, SceneTemplate } from '@/types/story'
import type { ModelPrice } from '@/types/electron'

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
  create: (name: string, basePath: string, type?: string) => e().project.create(name, basePath, type),
  delete: (projectPath: string) => e().project.delete(projectPath),
  getMeta: (projectPath: string) => e().project.getMeta(projectPath),
  listProjects: (basePath: string) => e().project.listProjects(basePath),
  importProject: (zipPath: string) => e().project.importProject(zipPath),
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
  exportProject: (projectPath: string, outputPath: string) =>
    e().export.exportProject(projectPath, outputPath),
}

export const aiService = {
  chat: async (messages: { role: string; content: string }[], configId: string, projectId?: string): Promise<string> => {
    const raw = await e().ai.chat(messages, configId, projectId)
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed.text === 'string') return parsed.text
      return raw
    } catch (err) { logError('解析 AI 回复 JSON 失败', err); return raw }
  },
  chatWithUsage: async (messages: { role: string; content: string }[], configId: string, projectId?: string) => {
    const raw = await e().ai.chat(messages, configId, projectId)
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed.text === 'string') {
        return { text: parsed.text as string, usage: parsed.usage as { prompt_tokens: number; completion_tokens: number; total_tokens: number; cost: number } | undefined }
      }
      if (parsed && parsed.usage) {
        return { text: raw, usage: parsed.usage as { prompt_tokens: number; completion_tokens: number; total_tokens: number; cost: number } | undefined }
      }
    } catch (err) { logError('解析 AI 回复 JSON 失败 (chatWithUsage)', err) }
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
  selectFiles: () => e().kb.selectFiles(),
  uploadFiles: (filePaths: string[], activeProjectId: string) => e().kb.uploadFiles(filePaths, activeProjectId),
  delete: (fileId: string) => e().kb.delete(fileId),
  write: (fileId: string, content: string) => e().kb.write(fileId, content),
  index: (fileId: string, configId: string) =>
    e().kb.index(fileId, configId),
  search: (query: string, projectId: string, configId: string, topK?: number, fileIds?: string[]) =>
    e().kb.search(query, projectId, configId, topK, fileIds),
  assignProject: (fileId: string, projectId: string, assigned: boolean) =>
    e().kb.assignProject(fileId, projectId, assigned),
  getEmbedding: (text: string, configId: string) =>
    e().kb.getEmbedding(text, configId),
  estimate: (filePath: string) => e().kb.estimate(filePath),
  rename: (fileId: string, newName: string) => e().kb.rename(fileId, newName),
  download: (fileId: string) => e().kb.download(fileId),
  webSearch: (query: string, maxResults?: number, safeSearch?: string, prioritySites?: { url: string }[]) => e().kb.webSearch(query, maxResults, safeSearch, prioritySites),
}

export const dialogService = {
  saveFile: (defaultName: string) => e().dialog.saveFile(defaultName),
  saveZip: (defaultName: string) => e().dialog.saveZip(defaultName),
  openZip: () => e().dialog.openZip(),
}

export const appService = {
  getProjectsBasePath: () => e().app.getProjectsBasePath(),
}

export const settingsService = {
  saveConfigs: (configs: ModelConfig[]) => e().settings.saveConfigs(configs),
  loadConfigs: () => e().settings.loadConfigs(),
}

export const statsService = {
  getUsage: (opts?: { projectId?: string; year?: number; month?: number; day?: number; configId?: string; model?: string }) =>
    e().stats.getUsage(opts || {}),
  getPrices: () => e().stats.getPrices(),
  savePrices: (prices: ModelPrice[]) => e().stats.savePrices(prices),
  deleteByLine: (lineNumber: number) => e().stats.deleteByLine(lineNumber),
  getMonthCost: () => e().stats.getMonthCost(),
}

export const styleProjectService = {
  importFile: () => e().styleProjects.importFile(),
  listProjects: () => e().styleProjects.listProjects(),
  loadProject: (id: string) => e().styleProjects.loadProject(id),
  saveProject: (project: StyleProject) => e().styleProjects.saveProject(project),
  deleteProject: (id: string) => e().styleProjects.deleteProject(id),
}

export const styleTemplateService = {
  list: () => e().styleTemplates.list(),
  read: (id: string) => e().styleTemplates.read(id),
  save: (template: any) => e().styleTemplates.save(template),
  delete: (id: string) => e().styleTemplates.delete(id),
}

export const templateService = {
  list: () => e().templates.list(),
  save: (template: SceneTemplate) => e().templates.save(template),
  delete: (id: string) => e().templates.delete(id),
}

export const continuationService = {
  list: () => e().continuation.list(),
  read: (id: string) => e().continuation.read(id),
  save: (project: any) => e().continuation.save(project),
  delete: (id: string) => e().continuation.delete(id),
}

export const extractionService = {
  importFile: () => e().extractions.importFile(),
}
