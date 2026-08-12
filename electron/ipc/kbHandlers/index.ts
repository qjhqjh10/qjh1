import { IpcMain, BrowserWindow, SafeStorage } from 'electron'
import * as fs from 'fs/promises'
import { logError } from '../logger'
import * as path from 'path';
import { decryptKey, getOpenAI, getConfigStore, showOpenDialog, showSaveDialog } from '../utils'
import type { StoredConfig } from '../utils'
import { logTokenUsage } from '../statsHandlers'
import { setProjectsBasePath, CHUNK_SIZE, CHUNK_OVERLAP, chunkText, parseFile, getKBPath, safeKBFilePath, safeKBFolderPath, sanitizeFolderName, listKBFolderTree, loadIndex, saveIndex, loadMetadata, saveMetadata, getEmbedding, getEmbeddingVector, buildEmbeddingUsageEntry, cosineSimilarity, saveKBFile, sanitizeFileName, getUniqueFileName, getUniqueFileNameInDir, embedChunks, applySceneKeywordActivation } from './helpers';
import type { KnowledgeFile, KnowledgeIndex, KnowledgeMetadata } from '../../../src/types/knowledge';


export function registerKbHandlers(ipcMain: IpcMain, pBasePath: string, getWindow: () => BrowserWindow | null, safeStorage: SafeStorage) {
  setProjectsBasePath(pBasePath)

  // List all files
  ipcMain.handle('kb:list', async () => {
    return await loadMetadata()
  })

  // Read a file
  ipcMain.handle('kb:read', async (_event, fileId: string) => {
    const meta = await loadMetadata()
    const file = meta.files.find(f => f.id === fileId)
    if (!file) throw new Error('File not found')
    const filePath = safeKBFilePath(file)
    const content = await parseFile(filePath, file.type)
    return { file, content }
  })

  // Open file dialog for KB upload
  ipcMain.handle('kb:selectFiles', async () => {
    const win = getWindow()
    const result = await showOpenDialog(win, {
      title: '选择知识库文件',
      filters: [{ name: '文档文件', extensions: ['txt', 'md', 'pdf', 'docx'] }],
      properties: ['openFile', 'multiSelections'],
    })
    if (result.canceled) return []
    return result.filePaths
  })

  // Upload files given paths (after estimate confirmed)
  // v16: 第 3 参 folder——三级目录（"一级/二级"，空 = 根目录）
  ipcMain.handle('kb:uploadFiles', async (_event, filePaths: string[], activeProjectId: string, folder?: string) => {
    const uploaded: KnowledgeFile[] = []
    for (const filePath of filePaths) {
      uploaded.push(await saveKBFile(filePath, activeProjectId, folder))
    }
    return uploaded
  })

  // ── v16: 三级目录管理 ──
  // 目录树（根/一级/二级）
  ipcMain.handle('kb:listFolders', async () => {
    return await listKBFolderTree()
  })

  // 新建子目录（level: 0 = 根下新建一级目录；1 = 指定一级目录下新建二级目录）
  ipcMain.handle('kb:createFolder', async (_event, name: string, parent: string = '') => {
    const clean = sanitizeFolderName(name)
    if (!clean) throw new Error('文件夹名不能为空')
    const parentDir = safeKBFolderPath(parent)
    const folderPath = path.join(parentDir, clean)
    if (parent && parent.split(/[\\/]+/).filter(Boolean).length >= 2) {
      throw new Error('最多支持两级子目录（根目录下可建两级）')
    }
    await fs.mkdir(folderPath, { recursive: true })
    return { name: clean }
  })

  // 重命名子目录（只改目录名，不移动其下文件）
  ipcMain.handle('kb:renameFolder', async (_event, folder: string, newName: string) => {
    const clean = sanitizeFolderName(newName)
    if (!clean) throw new Error('文件夹名不能为空')
    const dirPath = safeKBFolderPath(folder)
    const parent = path.dirname(dirPath)
    const newPath = path.join(parent, clean)
    if (dirPath === path.join(getKBPath(), 'files')) throw new Error('不能重命名根目录')
    if (dirPath === newPath) return true
    try { await fs.rename(dirPath, newPath) } catch (e: any) {
      if (e?.code === 'ENOTEMPTY' || e?.code === 'EEXIST') throw new Error(`目标目录已存在: ${clean}`)
      throw e
    }
    // 同步 metadata 中该目录下文件的 folder 归属（前缀替换）
    const meta = await loadMetadata()
    let changed = false
    for (const f of meta.files) {
      if (f.folder === folder) { f.folder = newName; changed = true }
      else if (f.folder?.startsWith(folder + '/')) { f.folder = newName + f.folder.slice(folder.length); changed = true }
    }
    if (changed) await saveMetadata(meta)
    return true
  })

  // 删除空子目录（非空返回错误提示）
  ipcMain.handle('kb:deleteFolder', async (_event, folder: string) => {
    const dirPath = safeKBFolderPath(folder)
    if (dirPath === path.join(getKBPath(), 'files')) throw new Error('不能删除根目录')
    const entries = await fs.readdir(dirPath).catch(() => [] as string[])
    if (entries.length > 0) {
      throw new Error('目录非空，请先移出或删除其中的文件')
    }
    await fs.rmdir(dirPath)
    const meta = await loadMetadata()
    const folderKey = (folder || '').split(/[\\/]+/).map(p => p.trim()).filter(Boolean).join('/')
    const orphan = meta.files.filter(f => f.folder === folderKey)
    if (orphan.length > 0) {  // 目录空了但 metadata 残留（异常态）→ 清理归属
      for (const f of orphan) delete f.folder
      await saveMetadata(meta)
    }
    return true
  })

  // 移动文件到其他目录（folder 为相对路径，空 = 根目录）
  ipcMain.handle('kb:moveFile', async (_event, fileId: string, folder: string) => {
    const meta = await loadMetadata()
    const file = meta.files.find(f => f.id === fileId)
    if (!file) throw new Error('File not found')
    const oldPath = safeKBFilePath(file)
    // 归一化 folder（最多两级）
    const folderParts = String(folder || '')
      .split(/[\\/]+/).map(p => p.trim()).filter(Boolean).filter(p => p !== '.' && p !== '..').slice(0, 2)
    const newFolder = folderParts.join('/')
    const targetDir = path.join(getKBPath(), 'files', ...folderParts)
    await fs.mkdir(targetDir, { recursive: true })
    const uniqueName = await getUniqueFileNameInDir(targetDir, path.basename(file.name))
    const newPath = path.join(targetDir, uniqueName)
    if (oldPath !== newPath) {
      await fs.rename(oldPath, newPath)
      file.name = uniqueName
    }
    file.folder = newFolder || undefined
    await saveMetadata(meta)
    return true
  })

  // Delete a file
  ipcMain.handle('kb:delete', async (_event, fileId: string) => {
    const meta = await loadMetadata()
    const fileIdx = meta.files.findIndex(f => f.id === fileId)
    if (fileIdx === -1) throw new Error('File not found')

    const file = meta.files[fileIdx]
    // Remove original file
    try {
      await fs.unlink(safeKBFilePath(file))
    } catch { /* ignore */ }

    // Remove chunks from index
    const index = await loadIndex()
    index.chunks = index.chunks.filter(c => c.fileId !== fileId)
    await saveIndex(index)

    // Remove from metadata
    meta.files.splice(fileIdx, 1)
    await saveMetadata(meta)
  })

  // Update file content
  ipcMain.handle('kb:write', async (_event, fileId: string, content: string, configId?: string) => {
    const meta = await loadMetadata()
    const file = meta.files.find(f => f.id === fileId)
    if (!file) throw new Error('File not found')

    const filePath = safeKBFilePath(file)
    await fs.writeFile(filePath, content, 'utf-8')

    // Remove old chunks + re-chunk
    const index = await loadIndex()
    index.chunks = index.chunks.filter(c => c.fileId !== fileId)
    const chunks = chunkText(content)
    for (const c of chunks) {
      index.chunks.push({
        id: `${fileId}_chunk_${c.charStart}`, fileId, fileName: file.originalName,
        content: c.content, embedding: [], charStart: c.charStart, charEnd: c.charEnd,
      })
    }
    await saveIndex(index)
    file.chunkCount = chunks.length
    await saveMetadata(meta)

    // Auto-reindex if configId provided
    if (configId) {
      try { await indexFile(file, configId) } catch { /* silent — index is best-effort */ }
    }
  })

  // Create a new KB file
  // v16: 第 4 参 folder——三级目录（"一级/二级"，空 = 根目录）
  ipcMain.handle('kb:create', async (_event, name: string, content: string, projectId?: string, folder?: string) => {
    const meta = await loadMetadata()
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    const userFileName = name.endsWith('.md') ? name : `${name}.md`
    const folderParts = String(folder || '')
      .split(/[\\/]+/).map(p => p.trim()).filter(Boolean).filter(p => p !== '.' && p !== '..').slice(0, 2)
    const safeFolder = folderParts.join('/')
    const targetDir = path.join(getKBPath(), 'files', ...folderParts)
    const safeName = await getUniqueFileNameInDir(targetDir, sanitizeFileName(userFileName))
    const filePath = path.join(targetDir, safeName)
    await fs.mkdir(targetDir, { recursive: true })
    await fs.writeFile(filePath, content, 'utf-8')

    const newFile: KnowledgeFile = {
      id, name: safeName, originalName: name.endsWith('.md') ? name : `${name}.md`,
      type: 'md', size: Buffer.byteLength(content, 'utf-8'), chunkCount: 0,
      projects: projectId ? [projectId] : [],
      source: 'ai',
      uploadedAt: new Date().toISOString(),
      folder: safeFolder || undefined,
    }
    meta.files.push(newFile)
    await saveMetadata(meta)
    return { id, name: newFile.originalName }
  })

  // Append content to an existing KB file
  ipcMain.handle('kb:append', async (_event, fileId: string, content: string, configId?: string) => {
    const meta = await loadMetadata()
    const file = meta.files.find(f => f.id === fileId)
    if (!file) throw new Error('File not found')

    const filePath = safeKBFilePath(file)
    const existing = await fs.readFile(filePath, 'utf-8')
    const newContent = existing + '\n\n---\n\n' + content
    await fs.writeFile(filePath, newContent, 'utf-8')

    file.size = Buffer.byteLength(newContent, 'utf-8')
    file.uploadedAt = new Date().toISOString()
    await saveMetadata(meta)

    // Remove old chunks + re-chunk
    const index = await loadIndex()
    index.chunks = index.chunks.filter(c => c.fileId !== fileId)
    const chunks = chunkText(newContent)
    for (const c of chunks) {
      index.chunks.push({
        id: `${fileId}_chunk_${c.charStart}`, fileId, fileName: file.originalName,
        content: c.content, embedding: [], charStart: c.charStart, charEnd: c.charEnd,
      })
    }
    file.chunkCount = chunks.length
    await saveIndex(index)
    await saveMetadata(meta)

    // Auto-reindex if configId provided
    if (configId) {
      try { await indexFile(file, configId) } catch { /* silent */ }
    }
  })

  // Shared helper: index a file (used by kb:index, kb:write, kb:append)
  // v14.9: 返回片段数（kb:index 处理器透传给 kb_index_file 工具显示）
  // v16.0.1(审计 S3): 返回 {chunkCount, failedCount}——embedding 失败的 chunk 不入 index，
  // 失败数如实上报（原空向量 chunk 入 index 后 kb_search 用 embedding.length>0 过滤 → 永搜不到
  // 的"假成功"：工具报"索引完成"实际零检索结果）
  async function indexFile(file: KnowledgeFile, configId: string): Promise<{ chunkCount: number; failedCount: number }> {
    const store = await getConfigStore()
    const configs = store.get('configs', []) as StoredConfig[]
    const config = configs.find(c => c.id === configId)
    if (!config || !config.apiKey) throw new Error('配置未找到或API密钥为空')

    const apiKey = decryptKey(config.apiKey, config.encrypted, safeStorage)
    const apiUrl = config.apiUrl
    const embeddingModel = config.embeddingModel || 'text-embedding-3-small'

    const filePath = safeKBFilePath(file)
    const content = await parseFile(filePath, file.type)
    const chunks = chunkText(content)

    const index = await loadIndex()
    index.chunks = index.chunks.filter(c => c.fileId !== file.id)

    // v16.0.1(审计 S3): 批量嵌入提取为纯函数 embedChunks（可单测）——
    // 失败的 chunk 返回 null 不入 index（原空向量入 index = 假成功）
    const { embeddings, totalPromptTokens, failedCount } = await embedChunks(
      chunks.map(c => ({ charStart: c.charStart, content: c.content })),
      async (text) => {
        try {
          return await getEmbedding(text, apiUrl, apiKey, embeddingModel)
        } catch (err) {
          logError(`Embedding 失败`, err)
          throw err
        }
      },
    )
    chunks.forEach((c, i) => {
      const embedding = embeddings[i]
      if (!embedding) return  // 失败 chunk 跳过（不入 index）
      index.chunks.push({
        id: `${file.id}_chunk_${c.charStart}`, fileId: file.id, fileName: file.originalName,
        content: c.content, embedding, charStart: c.charStart, charEnd: c.charEnd,
      })
    })
    // v14 批处理: 按文件合并记 1 条 embedding token（500 字/chunk 逐条记会爆量）
    try {
      if (totalPromptTokens > 0) {
        await logTokenUsage({ timestamp: new Date().toISOString(), ...buildEmbeddingUsageEntry(config, file, embeddingModel, totalPromptTokens) })
      }
    } catch (err) { logError('Embedding 用量记录失败', err) }

    await saveIndex(index)
    const meta = await loadMetadata()
    const f = meta.files.find(x => x.id === file.id)
    if (f) f.chunkCount = chunks.length - failedCount
    await saveMetadata(meta)
    return { chunkCount: chunks.length - failedCount, failedCount }
  }

  // Index a file (chunk + embed)
  ipcMain.handle('kb:index', async (_event, fileId: string, configId: string) => {
    const meta = await loadMetadata()
    const file = meta.files.find(f => f.id === fileId)
    if (!file) throw new Error('File not found')
    // v14.9(审计): 返回片段数——electron.d.ts 已声明 Promise<{chunkCount}> 但处理器未返回
    // → kb_index_file 工具 summary 恒显示 "undefined 个片段"
    // v16.0.1(S3): 返回 {chunkCount, failedCount}（失败 chunk 不入 index）
    return await indexFile(file, configId)
  })

  // Semantic search
  // v14.3: 第 7 参 excludeFileIds — 排除已注入上下文的知识库文件（按钮注入 + 工具检索去重）
  ipcMain.handle('kb:search', async (_event, query: string, projectId: string, configId: string, topK: number = 5, fileIds?: string[], excludeFileIds?: string[]) => {
    // Look up config from electron-store (like ai:chat does)
    const store = await getConfigStore()
    const configs = store.get('configs', []) as StoredConfig[]
    const config = configs.find(c => c.id === configId)
    if (!config || !config.apiKey) return []

    const apiKey = decryptKey(config.apiKey, config.encrypted, safeStorage)
    const apiUrl = config.apiUrl
    const embeddingModel = config.embeddingModel || 'text-embedding-3-small'

    // Get query embedding
    let queryEmbedding: number[]
    try {
      const res = await getEmbedding(query, apiUrl, apiKey, embeddingModel)
      queryEmbedding = res.embedding
      // v14 批处理: 检索为真实 embedding 调用 → 记账（query 无文件归属 → __global__）
      if (res.promptTokens > 0) {
        logTokenUsage({ timestamp: new Date().toISOString(), ...buildEmbeddingUsageEntry(config, null, embeddingModel, res.promptTokens) })
          .catch(err => logError('Embedding 用量记录失败', err))
      }
    } catch {
      return []
    }

    const meta = await loadMetadata()
    const index = await loadIndex()

    // v16.3.0: 文件与项目解绑（用户决策）——任意项目可检索/勾选任意知识库文件：
    // 不再按 projectId 过滤（原 v14.3：未勾选时只检索当前项目文件，跨项目文件即使"全部"也搜不到）；
    // 用户显式勾选（fileIds 非空）优先于全局——勾选集直接限定检索范围
    const fileIdSet = new Set(fileIds && fileIds.length > 0 ? fileIds : [])
    const projectFiles = fileIdSet.size > 0
      ? meta.files.filter(f => fileIdSet.has(f.id))
      : meta.files
    const projectFileIds = new Set(projectFiles.map(f => f.id))

    // v14.3: 排除已注入上下文的知识库文件（按钮注入 + 工具检索去重，避免同一片段重复进入上下文）
    if (excludeFileIds && excludeFileIds.length > 0) {
      for (const fid of excludeFileIds) projectFileIds.delete(fid)
    }

    const relevantChunks = index.chunks.filter(c =>
      projectFileIds.has(c.fileId) && c.embedding.length > 0
    )

    // Cosine similarity scoring
    let scored = relevantChunks.map(c => ({
      chunk: c,
      score: cosineSimilarity(queryEmbedding, c.embedding),
    }))

    // v16.4.0: 场景标记触发（酒馆世界书式）——设定文件内「## 场景：关键词」条目命中
    // 用户消息关键词即 score=1 置顶（纯函数实现见 helpers.applySceneKeywordActivation）。
    // 被排除文件已在上游过滤（projectFileIds 已删 exclude 集合），无需再查。
    scored = applySceneKeywordActivation(scored, query)

    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, topK).map(s => ({
      // v14.3: 返回 fileId — 渲染层据此记录"已注入"文件，供 kb_search 工具去重
      fileId: s.chunk.fileId,
      content: s.chunk.content,
      fileName: s.chunk.fileName,
      score: Math.round(s.score * 100) / 100,
    }))
  })

  // Assign/remove file from project
  ipcMain.handle('kb:rename', async (_event, fileId: string, newName: string) => {
    const meta = await loadMetadata()
    const file = meta.files.find(f => f.id === fileId)
    if (!file) throw new Error('File not found')

    // Rename physical file on disk to match the new display name
    // v16: 重命名保持所在三级目录不变（safeKBFilePath 已按 file.folder 定位）
    const oldExt = path.extname(file.name)
    const newSanitized = sanitizeFileName(
      newName.endsWith(oldExt) ? newName : `${newName}${oldExt}`
    )
    if (newSanitized !== file.name) {
      const oldPath = safeKBFilePath(file)
      const uniqueName = await getUniqueFileNameInDir(path.dirname(oldPath), newSanitized)
      const newPath = path.join(path.dirname(oldPath), uniqueName)
      await fs.rename(oldPath, newPath)
      file.name = uniqueName
    }

    file.originalName = newName
    await saveMetadata(meta)
  })

  ipcMain.handle('kb:download', async (event, fileId: string) => {
    const meta = await loadMetadata()
    const file = meta.files.find(f => f.id === fileId)
    if (!file) throw new Error('File not found')
    const filePath = safeKBFilePath(file)
    const win = BrowserWindow.fromWebContents(event.sender)
    const ext = path.extname(file.name).toLowerCase()
    const isBinary = ext === '.pdf' || ext === '.docx'
    const result = await showSaveDialog(win, {
      defaultPath: file.originalName,
      filters: isBinary
        ? [{ name: 'Document', extensions: [ext.replace('.', '')] }]
        : [{ name: 'Text Files', extensions: ['txt', 'md'] }],
    })
    if (!result.canceled && result.filePath) {
      if (isBinary) {
        const buffer = await fs.readFile(filePath)
        await fs.writeFile(result.filePath, buffer)
      } else {
        const content = await fs.readFile(filePath, 'utf-8')
        await fs.writeFile(result.filePath, content, 'utf-8')
      }
      return true
    }
    return false
  })

  ipcMain.handle('kb:assignProject', async (_event, fileId: string, projectId: string, assigned: boolean) => {
    const meta = await loadMetadata()
    const file = meta.files.find(f => f.id === fileId)
    if (!file) throw new Error('File not found')

    if (assigned && !file.projects.includes(projectId)) {
      file.projects.push(projectId)
    } else if (!assigned) {
      file.projects = file.projects.filter(p => p !== projectId)
    }

    await saveMetadata(meta)
  })

  // Get embedding for a text (used by AI chat for automatic retrieval)
  ipcMain.handle('kb:getEmbedding', async (_event, text: string, configId: string) => {
    const store = await getConfigStore()
    const configs = store.get('configs', []) as StoredConfig[]
    const config = configs.find(c => c.id === configId)
    if (!config || !config.apiKey) return []

    const apiKey = decryptKey(config.apiKey, config.encrypted, safeStorage)
    const apiUrl = config.apiUrl
    const embeddingModel = config.embeddingModel || 'text-embedding-3-small'
    // v14 批处理: 用 getEmbeddingVector（IPC 契约返回 number[]；前端按钮低频测试用途，不记账）
    return await getEmbeddingVector(text, apiUrl, apiKey, embeddingModel)
  })

  // Estimate chunks (for upload confirmation)
  ipcMain.handle('kb:estimate', async (_event, filePath: string) => {
    const stat = await fs.stat(filePath)
    const ext = path.extname(filePath).toLowerCase().replace('.', '')
    const type = (['txt', 'md', 'pdf', 'docx'].includes(ext) ? ext : 'txt') as KnowledgeFile['type']
    const content = await parseFile(filePath, type)
    const chunks = chunkText(content)
    return {
      name: path.basename(filePath),
      size: stat.size,
      type,
      chunkCount: chunks.length,
    }
  })

  // Web search via DuckDuckGo
  ipcMain.handle('kb:webSearch', async (_event, query: string, maxResults: number = 5, safeSearch: string = 'moderate', prioritySites: { url: string }[] = []) => {
    const sanitized = query.slice(0, 500).trim()
    if (!sanitized) return []

    // Build site filter from priority sites
    let siteFilter = ''
    const validSites = prioritySites
      .map(s => { try { return new URL(s.url).hostname.replace(/^www\./, '') } catch { return '' } })
      .filter(Boolean)
    if (validSites.length > 0) {
      siteFilter = validSites.map(d => `site:${d}`).join(' OR ') + ' '
    }

    const searchQuery = siteFilter + sanitized

    try {
      const { search } = await import('duckduckgo-search')
      const results: { title: string; snippet: string; url: string }[] = []
      const searchOptions: { maxResults: number; safeSearch?: 'strict' | 'moderate' | 'off' } = { maxResults }
      if (safeSearch === 'strict' || safeSearch === 'off') {
        searchOptions.safeSearch = safeSearch
      }
      for await (const result of search(searchQuery, searchOptions)) {
        results.push({
          title: result.title || '',
          snippet: result.description || result.snippet || '',
          url: result.url || '',
        })
      }
      return results
    } catch (err) {
      logError('网页搜索失败', err)
      return []
    }
  })

  // ── Notes (Scratchpad) Semantic Search ──
  ipcMain.handle('notes:search', async (_event, query: string, configId: string, topK = 3) => {
    try {
      // v16.0.3(审查修复): 主进程 topK 兜底钳制 1-10——渲染层工具已有钳制，但主进程
      // 是最终防线（未来其他调用方/模型直传大值会逐 chunk 打 embedding，费用/耗时失控）
      topK = Math.min(Math.max(Math.floor(Number(topK) || 3), 1), 10)
      const notesDir = path.join(path.dirname(pBasePath), 'notes')
      const files = await fs.readdir(notesDir).catch(() => [] as string[])
      const mdFiles = files.filter(f => f.endsWith('.md'))
      if (mdFiles.length === 0) return []

      // Get config for embedding
      const store = await getConfigStore()
      const configs = store.get('configs', []) as StoredConfig[]
      const config = configs.find(c => c.id === configId)
      if (!config || !config.apiKey) return []

      const apiKey = decryptKey(config.apiKey, config.encrypted, safeStorage)
      const embeddingModel = config.embeddingModel || 'text-embedding-3-small'

      // v14 批处理: 笔记检索也是真实 embedding 调用 → 记账（query + 全部 chunk 合并 1 条）
      const recordEmbed = (inputTokens: number) => {
        if (inputTokens > 0) {
          logTokenUsage({ timestamp: new Date().toISOString(), ...buildEmbeddingUsageEntry(config, null, embeddingModel, inputTokens) })
            .catch(err => logError('Embedding 用量记录失败', err))
        }
      }

      // Get query embedding
      let queryEmbedTokens = 0
      let queryEmbedding: number[]
      try {
        const qres = await getEmbedding(query.slice(0, 500), config.apiUrl, apiKey, embeddingModel)
        queryEmbedding = qres.embedding
        queryEmbedTokens = qres.promptTokens
      } catch {
        return []
      }

      // Chunk + embed all notes
      const chunks: { content: string; fileName: string; embedding: number[] }[] = []
      let chunkEmbedTokens = 0
      for (const f of mdFiles) {
        const filePath = path.join(notesDir, f)
        const content = await fs.readFile(filePath, 'utf-8')
        const fileChunks = chunkText(content)
        for (const c of fileChunks) {
          try {
            const res = await getEmbedding(c.content, config.apiUrl, apiKey, embeddingModel)
            chunks.push({ content: c.content, fileName: f, embedding: res.embedding })
            chunkEmbedTokens += res.promptTokens
          } catch { /* skip failed chunks */ }
        }
      }
      recordEmbed(queryEmbedTokens + chunkEmbedTokens)

      // Rank by cosine similarity
      const scored = chunks.map(c => ({ ...c, score: cosineSimilarity(queryEmbedding, c.embedding) }))
      scored.sort((a, b) => b.score - a.score)
      return scored.slice(0, topK).map(c => ({ content: c.content, fileName: c.fileName, score: c.score }))
    } catch (err) {
      logError('笔记搜索失败', err)
      return []
    }
  })
}
