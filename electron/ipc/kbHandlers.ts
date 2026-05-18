import { IpcMain, BrowserWindow, SafeStorage } from 'electron'
import * as fs from 'fs/promises'
import * as path from 'path'
import { decryptKey, getOpenAI, getConfigStore, showOpenDialog, showSaveDialog, isSafePath } from './utils'
import type { StoredConfig } from './utils'
import { logError } from './logger'
import type { KnowledgeFile, KnowledgeChunk, KnowledgeIndex, KnowledgeMetadata } from '../../src/types/knowledge'

let projectsBasePath = ''

// ====================== Chunking ======================

const CHUNK_SIZE = 500
const CHUNK_OVERLAP = 100

function chunkText(text: string): { content: string; charStart: number; charEnd: number }[] {
  const chunks: { content: string; charStart: number; charEnd: number }[] = []
  if (!text || text.trim().length === 0) return chunks

  // Split by paragraphs first
  const paragraphs = text.split(/\n\n+/)
  let currentChunk = ''
  let currentStart = 0
  let globalPos = 0

  for (const para of paragraphs) {
    if ((currentChunk + '\n\n' + para).replace(/\s/g, '').length > CHUNK_SIZE && currentChunk.length > 0) {
      chunks.push({
        content: currentChunk.trim(),
        charStart: currentStart,
        charEnd: globalPos - 2, // -2 for the \n\n separator
      })
      // Overlap: keep last ~100 chars
      const overlap = currentChunk.slice(-CHUNK_OVERLAP)
      currentChunk = overlap
      currentStart = Math.max(currentStart, globalPos - CHUNK_OVERLAP)
    }
    const separator = currentChunk ? '\n\n' : ''
    currentChunk += separator + para
    globalPos += separator.length + para.length
  }

  // Final chunk
  if (currentChunk.trim()) {
    chunks.push({
      content: currentChunk.trim(),
      charStart: currentStart,
      charEnd: globalPos,
    })
  }

  return chunks
}

// ====================== File Parsing ======================

async function parseFile(filePath: string, type: string): Promise<string> {
  switch (type) {
    case 'txt':
    case 'md':
      return await fs.readFile(filePath, 'utf-8')
    case 'pdf':
      try {
        const pdfParseModule = await import('pdf-parse')
        const pdfParse = (pdfParseModule as any).default || pdfParseModule
        const buffer = await fs.readFile(filePath)
        const data = await pdfParse(buffer)
        return data.text
      } catch (err) {
        logError('PDF 解析失败', err)
        return ''
      }
    case 'docx':
      try {
        const mammoth = (await import('mammoth')).default
        const buffer = await fs.readFile(filePath)
        const result = await mammoth.extractRawText({ buffer: buffer as unknown as Buffer })
        return result.value
      } catch (err) {
        logError('DOCX 解析失败', err)
        return ''
      }
    default:
      return ''
  }
}

// ====================== Index Management ======================

function getKBPath(): string {
  return path.join(path.dirname(projectsBasePath), 'knowledge_base')
}

function safeKBFilePath(file: { name: string }): string {
  const filesDir = path.join(getKBPath(), 'files')
  const filePath = path.join(filesDir, path.basename(file.name))
  if (!filePath.startsWith(filesDir + path.sep) && filePath !== filesDir) {
    throw new Error('非法文件路径')
  }
  return filePath
}

async function loadIndex(): Promise<KnowledgeIndex> {
  try {
    const raw = await fs.readFile(path.join(getKBPath(), 'index.json'), 'utf-8')
    return JSON.parse(raw)
  } catch {
    return { chunks: [] }
  }
}

async function saveIndex(index: KnowledgeIndex): Promise<void> {
  await fs.mkdir(getKBPath(), { recursive: true })
  await fs.writeFile(path.join(getKBPath(), 'index.json'), JSON.stringify(index, null, 2), 'utf-8')
}

async function loadMetadata(): Promise<KnowledgeMetadata> {
  try {
    const raw = await fs.readFile(path.join(getKBPath(), 'metadata.json'), 'utf-8')
    return JSON.parse(raw)
  } catch {
    return { files: [] }
  }
}

async function saveMetadata(meta: KnowledgeMetadata): Promise<void> {
  await fs.mkdir(getKBPath(), { recursive: true })
  await fs.writeFile(path.join(getKBPath(), 'metadata.json'), JSON.stringify(meta, null, 2), 'utf-8')
}

// ====================== Embedding ======================

async function getEmbedding(text: string, apiUrl: string, apiKey: string, model: string): Promise<number[]> {
  const OpenAI = await getOpenAI()
  const client = new OpenAI({ apiKey, baseURL: apiUrl || undefined })
  const response = await client.embeddings.create({
    model,
    input: text,
  })
  return response.data[0]?.embedding || []
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

// ====================== Upload Helper ======================

async function saveKBFile(filePath: string, activeProjectId: string): Promise<KnowledgeFile> {
  const stat = await fs.stat(filePath)
  if (stat.size > 50 * 1024 * 1024) {
    throw new Error(`文件 ${path.basename(filePath)} 超过50MB限制`)
  }
  const ext = path.extname(filePath).toLowerCase().replace('.', '')
  const type = (['txt', 'md', 'pdf', 'docx'].includes(ext) ? ext : 'txt') as KnowledgeFile['type']
  const id = `kb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const safeName = `${id}.${ext}`
  await fs.mkdir(path.join(getKBPath(), 'files'), { recursive: true })
  await fs.copyFile(filePath, path.join(getKBPath(), 'files', safeName))
  const file: KnowledgeFile = {
    id, name: safeName, originalName: path.basename(filePath),
    type, size: stat.size, chunkCount: 0,
    projects: activeProjectId ? [activeProjectId] : [],
    source: 'upload', uploadedAt: new Date().toISOString(),
  }
  const meta = await loadMetadata()
  meta.files.push(file)
  await saveMetadata(meta)
  return file
}

// ====================== IPC Registration ======================

export function registerKbHandlers(ipcMain: IpcMain, pBasePath: string, getWindow: () => BrowserWindow | null, safeStorage: SafeStorage) {
  projectsBasePath = pBasePath

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
    if (!isSafePath(filePath, kbPath) && !isSafePath(filePath, projectsBasePath)) {
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
