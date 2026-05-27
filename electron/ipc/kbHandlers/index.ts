import { IpcMain, BrowserWindow, SafeStorage } from 'electron'
import * as fs from 'fs/promises'
import { logError } from '../logger'
import * as path from 'path';
import { decryptKey, getOpenAI, getConfigStore, showOpenDialog, showSaveDialog, isSafePath } from '../utils'
import type { StoredConfig } from '../utils'
import { setProjectsBasePath, CHUNK_SIZE, CHUNK_OVERLAP, chunkText, parseFile, getKBPath, safeKBFilePath, loadIndex, saveIndex, loadMetadata, saveMetadata, getEmbedding, cosineSimilarity, saveKBFile } from './helpers';
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
  ipcMain.handle('kb:write', async (_event, fileId: string, content: string) => {
    const meta = await loadMetadata()
    const file = meta.files.find(f => f.id === fileId)
    if (!file) throw new Error('File not found')

    const filePath = safeKBFilePath(file)
    await fs.writeFile(filePath, content, 'utf-8')

    // Remove old chunks
    const index = await loadIndex()
    index.chunks = index.chunks.filter(c => c.fileId !== fileId)

    // Re-chunk
    const chunks = chunkText(content)
    for (const c of chunks) {
      index.chunks.push({
        id: `${fileId}_chunk_${c.charStart}`,
        fileId,
        fileName: file.originalName,
        content: c.content,
        embedding: [],
        charStart: c.charStart,
        charEnd: c.charEnd,
      })
    }

    await saveIndex(index)
    meta.files.find(f => f.id === fileId)!.chunkCount = chunks.length
    await saveMetadata(meta)
  })

  // Create a new KB file
  ipcMain.handle('kb:create', async (_event, name: string, content: string, projectId?: string) => {
    const meta = await loadMetadata()
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    const safeName = `${id}.md`
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
  ipcMain.handle('kb:append', async (_event, fileId: string, content: string) => {
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

    // Remove old chunks so they can be re-indexed
    const index = await loadIndex()
    index.chunks = index.chunks.filter(c => c.fileId !== fileId)
    const chunks = chunkText(newContent)
    for (const c of chunks) {
      index.chunks.push({
        id: `${fileId}_chunk_${c.charStart}`,
        fileId, fileName: file.originalName,
        content: c.content, embedding: [],
        charStart: c.charStart, charEnd: c.charEnd,
      })
    }
    file.chunkCount = chunks.length
    await saveIndex(index)
    await saveMetadata(meta)
  })

  // Index a file (chunk + embed)
  ipcMain.handle('kb:index', async (_event, fileId: string, configId: string) => {
    // Look up config from electron-store (like ai:chat does)
    const store = await getConfigStore()
    const configs = store.get('configs', []) as StoredConfig[]
    const config = configs.find(c => c.id === configId)
    if (!config || !config.apiKey) throw new Error('配置未找到或API密钥为空')

    const apiKey = decryptKey(config.apiKey, config.encrypted, safeStorage)
    const apiUrl = config.apiUrl
    const embeddingModel = config.embeddingModel || 'text-embedding-3-small'

    const meta = await loadMetadata()
    const file = meta.files.find(f => f.id === fileId)
    if (!file) throw new Error('File not found')

    const filePath = safeKBFilePath(file)
    const content = await parseFile(filePath, file.type)
    const chunks = chunkText(content)

    // Remove old chunks for this file
    const index = await loadIndex()
    index.chunks = index.chunks.filter(c => c.fileId !== fileId)

    // Embed each chunk
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i]
      let embedding: number[] = []
      try {
        embedding = await getEmbedding(c.content, apiUrl, apiKey, embeddingModel)
      } catch (err) {
        logError(`Embedding 失败 (chunk ${i})`, err)
      }
      index.chunks.push({
        id: `${fileId}_chunk_${c.charStart}`,
        fileId,
        fileName: file.originalName,
        content: c.content,
        embedding,
        charStart: c.charStart,
        charEnd: c.charEnd,
      })
    }

    await saveIndex(index)
    file.chunkCount = chunks.length
    await saveMetadata(meta)
    return { chunkCount: chunks.length }
  })

  // Semantic search
  ipcMain.handle('kb:search', async (_event, query: string, projectId: string, configId: string, topK: number = 3, fileIds?: string[]) => {
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
      queryEmbedding = await getEmbedding(query, apiUrl, apiKey, embeddingModel)
    } catch {
      return []
    }

    const meta = await loadMetadata()
    const index = await loadIndex()

    // Filter chunks by project
    let projectFiles = meta.files.filter(f => f.projects.includes(projectId))
    // Further restrict to specific file IDs if provided
    if (fileIds && fileIds.length > 0) {
      const fileIdSet = new Set(fileIds)
      projectFiles = projectFiles.filter(f => fileIdSet.has(f.id))
    }
    const projectFileIds = new Set(projectFiles.map(f => f.id))

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
    return await getEmbedding(text, apiUrl, apiKey, embeddingModel)
  })

  // Estimate chunks (for upload confirmation)
  ipcMain.handle('kb:estimate', async (_event, filePath: string) => {
    const kbPath = getKBPath()
    if (!isSafePath(filePath, kbPath) && !isSafePath(filePath, pBasePath)) {
      throw new Error('不允许访问该路径')
    }
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
}
