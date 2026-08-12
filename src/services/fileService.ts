import { logError } from '@/utils/logger'
import type { ModelConfig } from '@/types/settings'
import type { StyleProject, SceneTemplate } from '@/types/story'
import type { StyleTemplate } from '@/types/styleTemplate'
import type { SessionStatsResult } from '@/types/electron'
import type { ChatWithToolsResult, ResponsesChatResult, ToolCallArgs, ToolCallResult } from '@/types/fileOps'
import type { RewritePromptTemplate } from '@/types/rewritePrompts'
import { getFileCache, setFileCache, invalidateFileCache, invalidateDirCache } from '@/utils/fileReadCache'

function e() {
  if (!window.electron) throw new Error('Electron bridge not available - run in Electron environment')
  return window.electron
}

export const fileService = {
  /** Read file with shared cache — GUI and AI reads share the same cache layer */
  read: async (path: string) => {
    const cached = getFileCache(path)
    if (cached !== undefined) return cached
    const content = await e().files.read(path)
    setFileCache(path, content)
    return content
  },
  /** Write file and update shared cache so subsequent reads hit cache. Also invalidate index. */
  write: async (path: string, content: string) => {
    await e().files.write(path, content)
    setFileCache(path, content)
  },
  listDir: (dirPath: string) => e().files.listDir(dirPath),
  ensureDir: (dirPath: string) => e().files.ensureDir(dirPath),
  deleteFile: async (path: string) => {
    await e().files.deleteFile(path)
    invalidateFileCache(path)
  },
  deleteDir: async (dirPath: string) => {
    await e().files.deleteDir(dirPath)
    invalidateDirCache(dirPath)
  },
  readBinary: (filePath: string) => e().files.readBinary(filePath),
  writeBinary: (filePath: string, base64: string) => e().files.writeBinary(filePath, base64),
  saveImageUrl: (imageUrl: string, projectPath: string) => e().files.saveImageUrl(imageUrl, projectPath),
  onExternalChange: (cb: (event: { path: string; content: string }) => void) =>
    e().files.onExternalChange(cb),
}

export const projectService = {
  create: async (name: string, basePath: string, type?: string) => {
    const result = e().project.create(name, basePath, type)
    return result
  },
  delete: async (projectPath: string) => {
    const result = e().project.delete(projectPath)
    return result
  },
  getMeta: (projectPath: string) => e().project.getMeta(projectPath),
  listProjects: (basePath: string) => e().project.listProjects(basePath),
  importProject: (zipPath: string) => e().project.importProject(zipPath),
  updateCategory: (projectPath: string, novelCategory: string) => e().project.updateCategory(projectPath, novelCategory),
  rename: (projectPath: string, newName: string) => e().project.rename(projectPath, newName),
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
  exportEpub: (opts: {
    title: string; author: string
    chapters: { title: string; content: string }[]
    outputPath: string
  }) => e().export.exportEpub(opts),
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
        // v16.0.2(A-1): 类型补 cached_tokens——aiHandlers 已下发该字段（M5），
        // 原类型声明遗漏使 pipeline 调用方拿不到缓存命中统计
        return { text: parsed.text as string, usage: parsed.usage as { prompt_tokens: number; completion_tokens: number; total_tokens: number; cost: number; cached_tokens?: number } | undefined }
      }
      if (parsed && parsed.usage) {
        return { text: raw, usage: parsed.usage as { prompt_tokens: number; completion_tokens: number; total_tokens: number; cost: number; cached_tokens?: number } | undefined }
      }
    } catch (err) { logError('解析 AI 回复 JSON 失败 (chatWithUsage)', err) }
    return { text: raw, usage: undefined }
  },
  listModels: (configId: string, scope?: string) => e().ai.listModels(configId, scope),
  /** v15.2.1: 联网获取模型实时价格（OpenRouter，USD） */
  fetchModelPricing: () => e().ai.fetchModelPricing(),
  chatWithTools: async (
    messages: { role: string; content: string; tool_calls?: unknown[]; tool_call_id?: string }[],
    configId: string,
    projectId: string | undefined,
    tools?: unknown[],
    /** v12.5.1: 阶段感知温度 */
    temperature?: number,
    /** v14.2.1: 调用来源（子代理传 'subagent'，主 agent 不传）— 供 token 统计区分 */
    source?: string,
    /** v14.6.1: 请求标识 — per-request abort（并行子代理场景精确中止） */
    requestId?: string,
  ): Promise<ChatWithToolsResult> => {
    const raw = await e().ai.chatWithTools(messages, configId, projectId, tools, temperature, source, requestId)
    try {
      const parsed = JSON.parse(raw)
      // #15: Validate tool_calls structure
      const rawCalls = Array.isArray(parsed.tool_calls) ? parsed.tool_calls : []
      const validCalls = rawCalls.filter((tc: unknown) => {
        const t = tc as Record<string, unknown> | null
        return t && typeof t.id === 'string'
          && t.function && typeof (t.function as Record<string, unknown>).name === 'string'
          && typeof (t.function as Record<string, unknown>).arguments === 'string'
      })
      const toolCalls = validCalls.length > 0 ? validCalls as ChatWithToolsResult['toolCalls'] : null
      return {
        text: typeof parsed.text === 'string' ? parsed.text : '',
        toolCalls,
        finishReason: parsed.finish_reason || 'stop',
        images: Array.isArray(parsed.images) ? parsed.images : undefined,
        reasoning_content: typeof parsed.reasoning_content === 'string' ? parsed.reasoning_content : undefined,
        // v14.5.0: 透传中止标记（原实现丢弃 → 用户点"停止生成"被误显示为 API 超时失败）
        aborted: parsed.aborted === true,
        usage: parsed.usage,
      }
    } catch (err) { logError('解析 chatWithTools 回复失败', err); return { text: raw, toolCalls: null, finishReason: 'stop' } }
  },
  executeFileTools: async (calls: ToolCallArgs[]): Promise<ToolCallResult[]> => {
    return e().ai.executeFileTools(calls) as Promise<ToolCallResult[]>
  },
  // v14.8: DeepSeek Responses API（原生联网搜索通道）— 由 ResponsesAdapter 路由调用。
  // 与 chatWithTools 区别：toolCalls 为已归一化 {id,name,arguments}（主进程转换器输出）。
  responsesChat: async (
    messages: { role: string; content: string; tool_calls?: unknown[]; tool_call_id?: string }[],
    configId: string,
    projectId: string | undefined,
    tools?: unknown[],
    temperature?: number,
    source?: string,
    requestId?: string,
  ): Promise<ResponsesChatResult> => {
    const raw = await e().ai.responsesChat(messages, configId, projectId, tools, temperature, source, requestId)
    try {
      const parsed = JSON.parse(raw)
      const rawCalls = Array.isArray(parsed.tool_calls) ? parsed.tool_calls : []
      const validCalls = rawCalls.filter((tc: unknown) => {
        const t = tc as Record<string, unknown> | null
        return t && typeof t.id === 'string' && typeof t.name === 'string' && typeof t.arguments === 'string'
      })
      return {
        text: typeof parsed.text === 'string' ? parsed.text : '',
        toolCalls: validCalls.length > 0 ? validCalls as ResponsesChatResult['toolCalls'] : null,
        finishReason: parsed.finish_reason || 'stop',
        reasoning_content: typeof parsed.reasoning_content === 'string' ? parsed.reasoning_content : undefined,
        // v14.5.0 语义同 chatWithTools：中止标记透传
        aborted: parsed.aborted === true,
        // v14.8: v4-pro 等尚未支持 responses 时主进程已降级 chat.completions（无感知）
        fallbackUsed: parsed.fallbackUsed === true,
        usage: parsed.usage,
      }
    } catch (err) { logError('解析 responsesChat 回复失败', err); return { text: raw, toolCalls: null, finishReason: 'stop' } }
  },
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

    function cleanupAll() { cleanupChunk(); cleanupDone(); cleanupError(); cleanupCancelled() }

    const abort = () => {
      e().ai.abortStream()
      // Do NOT cleanupAll() here — let the backend's cancellation event
      // trigger onCancelled/onError which will then cleanupAll().
      // Cleaning up early would remove listeners before the event arrives,
      // causing the UI overlay to freeze.
    }

    e().ai.chatStream(messages, configId, projectId)
    return { abort }
  },
  // v16.2.0: 副模型多模态图片理解（v16.3.0: generateImage 文生图已移除）
  visionChat: async (opts: { configId: string; projectId?: string; prompt: string; images: Array<{ base64?: string; path?: string }>; template?: string }): Promise<{ text: string; usage: { prompt_tokens: number; completion_tokens: number } | null; cost: number }> => {
    return e().ai.visionChat(opts) as Promise<{ text: string; usage: { prompt_tokens: number; completion_tokens: number } | null; cost: number }>
  },
  // v14.6.1: requestId 可选——无 id = 中止该 webContents 全部在途请求（用户停止语义）
  abortStream: (requestId?: string) => { e().ai.abortStream(requestId) },
}

export const httpService = {
  fetch: (url: string, options?: Record<string, unknown>) => e().http.fetch(url, options),
  get: (url: string) => e().http.get(url),
}

// IMPORTANT: Browser, shell, MCP, and LSP services are now exported from
// electronBridge.ts — do NOT monkey-patch fileService here.
// Use: import { bridge } from '@/services/electronBridge'

export const kbService = {
  list: () => e().kb.list(),
  read: (fileId: string) => e().kb.read(fileId),
  selectFiles: () => e().kb.selectFiles(),
  uploadFiles: (filePaths: string[], activeProjectId: string, folder?: string) => e().kb.uploadFiles(filePaths, activeProjectId, folder),
  delete: (fileId: string) => e().kb.delete(fileId),
  write: (fileId: string, content: string, configId?: string) => e().kb.write(fileId, content, configId),
  index: (fileId: string, configId: string) =>
    e().kb.index(fileId, configId),
  search: (query: string, projectId: string, configId: string, topK?: number, fileIds?: string[], excludeFileIds?: string[]) =>
    e().kb.search(query, projectId, configId, topK, fileIds, excludeFileIds),
  assignProject: (fileId: string, projectId: string, assigned: boolean) =>
    e().kb.assignProject(fileId, projectId, assigned),
  getEmbedding: (text: string, configId: string) =>
    e().kb.getEmbedding(text, configId),
  estimate: (filePath: string) => e().kb.estimate(filePath),
  create: (name: string, content: string, projectId?: string, folder?: string) =>
    e().kb.create(name, content, projectId, folder),
  append: (fileId: string, content: string, configId?: string) => e().kb.append(fileId, content, configId),
  rename: (fileId: string, newName: string) => e().kb.rename(fileId, newName),
  download: (fileId: string) => e().kb.download(fileId),
  webSearch: (query: string, maxResults?: number, safeSearch?: string, prioritySites?: { url: string }[]) => e().kb.webSearch(query, maxResults, safeSearch, prioritySites),
  // v16: 三级目录
  listFolders: () => e().kb.listFolders(),
  createFolder: (name: string, parent?: string) => e().kb.createFolder(name, parent),
  renameFolder: (folder: string, newName: string) => e().kb.renameFolder(folder, newName),
  deleteFolder: (folder: string) => e().kb.deleteFolder(folder),
  moveFile: (fileId: string, folder: string) => e().kb.moveFile(fileId, folder),
}

export const dialogService = {
  saveFile: (defaultName: string) => e().dialog.saveFile(defaultName),
  saveZip: (defaultName: string) => e().dialog.saveZip(defaultName),
  openZip: () => e().dialog.openZip(),
}

export const appService = {
  getProjectsBasePath: () => e().app.getProjectsBasePath(),
  getImitationProjectsPath: () => e().app.getImitationProjectsPath(),
  getContinuationProjectDirsPath: () => e().app.getContinuationProjectDirsPath(),
  getRewriteProjectsPath: () => e().app.getRewriteProjectsPath(),
  getStoryWorkspacePath: () => e().app.getStoryWorkspacePath(),
}

export const settingsService = {
  saveConfigs: (configs: ModelConfig[]) => e().settings.saveConfigs(configs),
  loadConfigs: () => e().settings.loadConfigs(),
  clearConfigs: () => e().settings.clearConfigs(),
  savePexelsKey: (key: string) => e().settings.savePexelsKey(key),
  loadPexelsKey: () => e().settings.loadPexelsKey(),
}

export const statsService = {
  getUsage: (opts?: { projectId?: string; year?: number; month?: number; day?: number; configId?: string; model?: string; source?: string }) =>
    e().stats.getUsage(opts || {}),
  deleteByLine: (lineNumber: number) => e().stats.deleteByLine(lineNumber),
  getMonthCost: () => e().stats.getMonthCost(),
  getSessionStats: () => e().stats.getSessionStats(),
  reset: () => e().stats.reset(),
  deleteSession: (sessionId: string) => e().stats.deleteSession(sessionId),
  resetSessions: () => e().stats.resetSessions(),
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
  listProject: (projectPath: string) => e().styleTemplates.listProject(projectPath),
  read: (id: string) => e().styleTemplates.read(id),
  save: (template: StyleTemplate) => e().styleTemplates.save(template as any),
  delete: (id: string) => e().styleTemplates.delete(id),
  readPrompt: (id: string) => e().styleTemplates.readPrompt(id),
  savePrompt: (id: string, content: string) => e().styleTemplates.savePrompt(id, content),
  deletePrompt: (id: string) => e().styleTemplates.deletePrompt(id),
  listRuleTemplates: () => e().styleTemplates.listRuleTemplates(),
  readRuleTemplate: (id: string) => e().styleTemplates.readRuleTemplate(id),
  saveRuleTemplate: (template: any) => e().styleTemplates.saveRuleTemplate(template),
  deleteRuleTemplate: (id: string) => e().styleTemplates.deleteRuleTemplate(id),
}

export const templateService = {
  list: () => e().templates.list(),
  listProject: (projectPath: string) => e().templates.listProject(projectPath),
  save: (template: SceneTemplate) => e().templates.save(template),
  delete: (id: string) => e().templates.delete(id),
}

export const continuationService = {
  list: () => e().continuation.list(),
  read: (id: string) => e().continuation.read(id),
  save: (project: any) => e().continuation.save(project),
  delete: (id: string) => e().continuation.delete(id),
}

export const rewriteService = {
  list: () => e().rewrite.list(),
  read: (id: string) => e().rewrite.read(id),
  save: (project: any) => e().rewrite.save(project),
  delete: (id: string) => e().rewrite.delete(id),
  create: (arg: { name: string; sourceFileName: string; content: string }) => e().rewrite.create(arg),
  importFile: () => e().rewrite.importFile(),
  saveChapters: (arg: { projectId: string; sourceWordCount: number; chapters: { title: string; content: string }[] }) => e().rewrite.saveChapters(arg),
  getProjectPath: (id: string) => e().rewrite.getProjectPath(id),
  readChapter: (id: string, fileName: string) => e().rewrite.readChapter(id, fileName),
  // Stage 2+3: Analysis
  saveAnalysis: (id: string, fileName: string, content: string) => e().rewrite.saveAnalysis(id, fileName, content),
  readAnalysis: (id: string, fileName: string) => e().rewrite.readAnalysis(id, fileName),
  deleteAnalysis: (id: string, fileName: string) => e().rewrite.deleteAnalysis(id, fileName),
  // Stage 4: Rewrites
  saveRewrite: (id: string, fileName: string, content: string) => e().rewrite.saveRewrite(id, fileName, content),
  readRewrite: (id: string, fileName: string) => e().rewrite.readRewrite(id, fileName),
  deleteRewrite: (id: string, fileName: string) => e().rewrite.deleteRewrite(id, fileName),
  // Stage 5: Merge
  mergeRewrites: (id: string, outputPath: string, chapterIds?: string[]) => e().rewrite.mergeRewrites(id, outputPath, chapterIds),
}

// ── 提示词模板 service ──

export const rewriteTemplateService = {
  list: (): Promise<RewritePromptTemplate[]> => e().rewrite.templates.list(),
  read: (id: string): Promise<RewritePromptTemplate | null> => e().rewrite.templates.read(id),
  save: (template: RewritePromptTemplate): Promise<RewritePromptTemplate> => e().rewrite.templates.save(template),
  delete: (id: string): Promise<void> => e().rewrite.templates.delete(id),
  import: (): Promise<RewritePromptTemplate | null> => e().rewrite.templates.import(),
  export: (id: string): Promise<string | null> => e().rewrite.templates.export(id),
}

export const extractionService = {
  importFile: () => e().extractions.importFile(),
  importFromPath: (filePath: string) => e().extractions.importFromPath(filePath),
}

// v16.4.0: 角色模板文件夹 service——「一个模板=一个文件夹」
// （role_templates/<id>/：template.json + characters/*.yaml + 世界观.md + 场景对话设定.md）
export const roleTemplateService = {
  exportFolder: (template: unknown): Promise<{ ok: boolean; folder: string }> =>
    e().roleTemplates.exportFolder(template),
  readFolder: (id: string): Promise<any | null> => e().roleTemplates.readFolder(id),
  listFolders: (): Promise<Array<{ id: string; name: string }>> => e().roleTemplates.listFolders(),
  deleteFolder: (id: string): Promise<boolean> => e().roleTemplates.deleteFolder(id),
}

export const storyService = {
  list: () => e().story.list(),
  create: (name: string) => e().story.create(name),
  readMeta: (id: string) => e().story.readMeta(id),
  saveMeta: (id: string, meta: any) => e().story.saveMeta(id, meta),
  readChapter: (id: string, chId: string) => e().story.readChapter(id, chId),
  writeChapter: (id: string, chId: string, content: string) => e().story.writeChapter(id, chId, content),
  readAnalysis: (id: string, chId: string) => e().story.readAnalysis(id, chId),
  writeAnalysis: (id: string, chId: string, content: string) => e().story.writeAnalysis(id, chId, content),
  readGraph: (id: string) => e().story.readGraph(id),
  writeGraph: (id: string, content: string) => e().story.writeGraph(id, content),
  delete: (id: string) => e().story.delete(id),
}



