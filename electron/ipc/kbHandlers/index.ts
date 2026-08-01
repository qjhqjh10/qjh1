import { IpcMain, BrowserWindow, SafeStorage } from 'electron'
import * as fs from 'fs/promises'
import { logError } from '../logger'
import * as path from 'path';
import { decryptKey, getOpenAI, getConfigStore, showOpenDialog, showSaveDialog } from '../utils'
import type { StoredConfig } from '../utils'
import { logTokenUsage } from '../statsHandlers'
import { setProjectsBasePath, CHUNK_SIZE, CHUNK_OVERLAP, chunkText, parseFile, getKBPath, safeKBFilePath, loadIndex, saveIndex, loadMetadata, saveMetadata, getEmbedding, getEmbeddingVector, buildEmbeddingUsageEntry, cosineSimilarity, saveKBFile, sanitizeFileName, getUniqueFileName } from './helpers';
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
  ipcMain.handle('kb:uploadFiles', async (_event, filePaths: string[], activeProjectId: string) => {
    const uploaded: KnowledgeFile[] = []
    for (const filePath of filePaths) {
      uploaded.push(await saveKBFile(filePath, activeProjectId))
    }
    return uploaded
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
  ipcMain.handle('kb:create', async (_event, name: string, content: string, projectId?: string) => {
    const meta = await loadMetadata()
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    const userFileName = name.endsWith('.md') ? name : `${name}.md`
    const safeName = await getUniqueFileName(sanitizeFileName(userFileName))
    const filePath = path.join(getKBPath(), 'files', safeName)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, content, 'utf-8')

    const newFile: KnowledgeFile = {
      id, name: safeName, originalName: name.endsWith('.md') ? name : `${name}.md`,
      type: 'md', size: Buffer.byteLength(content, 'utf-8'), chunkCount: 0,
      projects: projectId ? [projectId] : [],
      source: 'ai',
      uploadedAt: new Date().toISOString(),
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
  async function indexFile(file: KnowledgeFile, configId: string): Promise<void> {
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

    let totalEmbedTokens = 0
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i]
      let embedding: number[] = []
      try {
        const res = await getEmbedding(c.content, apiUrl, apiKey, embeddingModel)
        embedding = res.embedding
        totalEmbedTokens += res.promptTokens
      } catch (err) { logError(`Embedding 失败 (chunk ${i})`, err) }
      index.chunks.push({
        id: `${file.id}_chunk_${c.charStart}`, fileId: file.id, fileName: file.originalName,
        content: c.content, embedding, charStart: c.charStart, charEnd: c.charEnd,
      })
    }
    // v14 批处理: 按文件合并记 1 条 embedding token（500 字/chunk 逐条记会爆量）
    try {
      if (totalEmbedTokens > 0) {
        await logTokenUsage({ timestamp: new Date().toISOString(), ...buildEmbeddingUsageEntry(config, file, embeddingModel, totalEmbedTokens) })
      }
    } catch (err) { logError('Embedding 用量记录失败', err) }

    await saveIndex(index)
    const meta = await loadMetadata()
    const f = meta.files.find(x => x.id === file.id)
    if (f) f.chunkCount = chunks.length
    await saveMetadata(meta)
  }

  // Index a file (chunk + embed)
  ipcMain.handle('kb:index', async (_event, fileId: string, configId: string) => {
    const meta = await loadMetadata()
    const file = meta.files.find(f => f.id === fileId)
    if (!file) throw new Error('File not found')
    await indexFile(file, configId)
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

    // v14.3: 作用域过滤 — 用户显式勾选（fileIds 非空）优先于项目归属：
    // 勾选了其他项目的文件也能检索（不再被 projectId 过滤排除）；
    // 未勾选时保持原语义（projectId 为空 → 检索全部文件）
    let projectFiles: Array<{ id: string; projects: string[] }>
    if (fileIds && fileIds.length > 0) {
      const fileIdSet = new Set(fileIds)
      projectFiles = meta.files.filter(f => fileIdSet.has(f.id))
    } else {
      projectFiles = projectId
        ? meta.files.filter(f => f.projects.includes(projectId))
        : meta.files
    }
    const projectFileIds = new Set(projectFiles.map(f => f.id))

    // v14.3: 排除已注入上下文的知识库文件（按钮注入 + 工具检索去重，避免同一片段重复进入上下文）
    if (excludeFileIds && excludeFileIds.length > 0) {
      for (const fid of excludeFileIds) projectFileIds.delete(fid)
    }

    const relevantChunks = index.chunks.filter(c =>
      projectFileIds.has(c.fileId) && c.embedding.length > 0
    )

    // Cosine similarity scoring
    const scored = relevantChunks.map(c => ({
      chunk: c,
      score: cosineSimilarity(queryEmbedding, c.embedding),
    }))

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
    const oldExt = path.extname(file.name)
    const newSanitized = sanitizeFileName(
      newName.endsWith(oldExt) ? newName : `${newName}${oldExt}`
    )
    if (newSanitized !== file.name) {
      const oldPath = safeKBFilePath(file)
      const uniqueName = await getUniqueFileName(newSanitized)
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
