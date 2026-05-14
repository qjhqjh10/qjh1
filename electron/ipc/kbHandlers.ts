import { IpcMain, dialog, BrowserWindow } from 'electron'
import * as fs from 'fs/promises'
import * as path from 'path'
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
        console.error('PDF parse error:', err)
        return ''
      }
    case 'docx':
      try {
        const mammoth = (await import('mammoth')).default
        const buffer = await fs.readFile(filePath)
        const result = await mammoth.extractRawText({ buffer: buffer as unknown as Buffer })
        return result.value
      } catch (err) {
        console.error('DOCX parse error:', err)
        return ''
      }
    default:
      return ''
  }
}

// ====================== Index Management ======================

function getKBPath(): string {
  return path.join(projectsBasePath, '..', 'knowledge_base')
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

let cachedOpenAI: typeof import('openai').default | null = null
async function getOpenAIForKB(): Promise<typeof import('openai').default> {
  if (!cachedOpenAI) {
    cachedOpenAI = (await import('openai')).default
  }
  return cachedOpenAI
}

async function getEmbedding(text: string, apiUrl: string, apiKey: string, model: string): Promise<number[]> {
  const OpenAI = await getOpenAIForKB()
  const client = new OpenAI({ apiKey, baseURL: apiUrl || undefined })
  const response = await client.embeddings.create({
    model,
    input: text,
  })
  return response.data[0]?.embedding || []
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

// ====================== Auto-Index Project Files ======================

const autoIndexTimers = new Map<string, ReturnType<typeof setTimeout>>()

export async function autoIndexProjectFile(filePath: string, content: string, basePath: string) {
  // Only index files within project directories
  const rel = path.relative(basePath, filePath)
  if (rel.startsWith('..')) return // Not in a project

  const projectName = rel.split(path.sep)[0]
  if (!projectName) return

  // Debounce per file (2 seconds after last write)
  const existing = autoIndexTimers.get(filePath)
  if (existing) clearTimeout(existing)
  autoIndexTimers.set(filePath, setTimeout(async () => {
    autoIndexTimers.delete(filePath)
    try {
      const meta = await loadMetadata()
      const fileName = path.basename(filePath)
      // Find or create metadata entry
      let file = meta.files.find(f => f.name === fileName && f.source === 'project')
      if (!file) {
        const id = `proj_${fileName.replace(/[^a-zA-Z0-9一-鿿]/g, '_')}`
        file = {
          id,
          name: fileName,
          originalName: fileName,
          type: 'txt',
          size: Buffer.byteLength(content, 'utf-8'),
          chunkCount: 0,
          projects: [projectName],
          source: 'project',
          uploadedAt: new Date().toISOString(),
        }
        meta.files.push(file)
      } else {
        file.size = Buffer.byteLength(content, 'utf-8')
      }

      // Chunk
      const chunks = chunkText(content)
      const index = await loadIndex()
      index.chunks = index.chunks.filter(c => c.fileId !== file!.id)

      // Try to embed using first available config
      try {
        const { default: Store } = await import('electron-store')
        const store = new Store<{ configs: { id: string; apiUrl: string; apiKey: string; encrypted: boolean; embeddingModel: string }[] }>({ defaults: { configs: [] } })
        const configs = store.get('configs', [])
        const config = configs.find(c => c.embeddingModel && c.apiKey)
        let apiKey = config?.apiKey || ''
        if (config?.encrypted) {
          try {
            const { safeStorage } = await import('electron')
            if (safeStorage.isEncryptionAvailable()) {
              apiKey = safeStorage.decryptString(Buffer.from(apiKey, 'base64'))
            }
          } catch { /* keep raw */ }
        }

        if (config && apiKey) {
          for (const c of chunks) {
            try {
              const emb = await getEmbedding(c.content, config.apiUrl, apiKey, config.embeddingModel || 'text-embedding-3-small')
              index.chunks.push({
                id: `${file!.id}_chunk_${c.charStart}`,
                fileId: file!.id,
                fileName: file!.originalName,
                content: c.content,
                embedding: emb,
                charStart: c.charStart,
                charEnd: c.charEnd,
              })
            } catch { /* skip failed embeddings */ }
          }
        }
      } catch { /* no config available, just chunk */ }

      file!.chunkCount = chunks.length
      await saveIndex(index)
      await saveMetadata(meta)
    } catch (err) {
      console.error('Auto-index failed:', err)
    }
  }, 2000))
}

// ====================== IPC Registration ======================

export function registerKbHandlers(ipcMain: IpcMain, pBasePath: string, getWindow: () => BrowserWindow | null) {
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
    const filePath = path.join(getKBPath(), 'files', file.name)
    const content = await parseFile(filePath, file.type)
    return { file, content }
  })

  // Open file dialog for KB upload
  ipcMain.handle('kb:selectFiles', async () => {
    const win = getWindow()
    const result = win
      ? await dialog.showOpenDialog(win, {
          title: '选择知识库文件',
          filters: [{ name: '文档文件', extensions: ['txt', 'md', 'pdf', 'docx'] }],
          properties: ['openFile', 'multiSelections'],
        })
      : await dialog.showOpenDialog({
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
      uploaded.push(file)
    }
    return uploaded
  })

  // Upload a file (kept for backward compat)
  ipcMain.handle('kb:upload', async (_event, activeProjectId: string) => {
    const win = getWindow()
    const result = win
      ? await dialog.showOpenDialog(win, {
          title: '选择知识库文件',
          filters: [
            { name: '文档文件', extensions: ['txt', 'md', 'pdf', 'docx'] },
          ],
          properties: ['openFile', 'multiSelections'],
        })
      : await dialog.showOpenDialog({
          title: '选择知识库文件',
          filters: [
            { name: '文档文件', extensions: ['txt', 'md', 'pdf', 'docx'] },
          ],
          properties: ['openFile', 'multiSelections'],
        })
    if (result.canceled || result.filePaths.length === 0) return null

    const uploaded: KnowledgeFile[] = []
    for (const filePath of result.filePaths) {
      const stat = await fs.stat(filePath)
      if (stat.size > 50 * 1024 * 1024) {
        throw new Error(`文件 ${path.basename(filePath)} 超过50MB限制，请压缩或拆分后再上传`)
      }

      const ext = path.extname(filePath).toLowerCase().replace('.', '')
      const type = (['txt', 'md', 'pdf', 'docx'].includes(ext) ? ext : 'txt') as KnowledgeFile['type']
      const id = `kb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const safeName = `${id}.${ext}`

      await fs.mkdir(path.join(getKBPath(), 'files'), { recursive: true })
      await fs.copyFile(filePath, path.join(getKBPath(), 'files', safeName))

      const file: KnowledgeFile = {
        id,
        name: safeName,
        originalName: path.basename(filePath),
        type,
        size: stat.size,
        chunkCount: 0,
        projects: activeProjectId ? [activeProjectId] : [],
        source: 'upload',
        uploadedAt: new Date().toISOString(),
      }

      const meta = await loadMetadata()
      meta.files.push(file)
      await saveMetadata(meta)
      uploaded.push(file)
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
      await fs.unlink(path.join(getKBPath(), 'files', file.name))
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

    const filePath = path.join(getKBPath(), 'files', file.name)
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
  ipcMain.handle('kb:index', async (_event, fileId: string, apiUrl: string, apiKey: string, embeddingModel: string) => {
    const meta = await loadMetadata()
    const file = meta.files.find(f => f.id === fileId)
    if (!file) throw new Error('File not found')

    const filePath = path.join(getKBPath(), 'files', file.name)
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
        console.error(`Embedding failed for chunk ${i}:`, err)
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
  ipcMain.handle('kb:search', async (_event, query: string, projectId: string, apiUrl: string, apiKey: string, embeddingModel: string, topK: number = 3, fileIds?: string[]) => {
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
    const content = await fs.readFile(path.join(getKBPath(), 'files', `${file.id}.${file.type}`), 'utf-8')
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = win
      ? await dialog.showSaveDialog(win, {
          defaultPath: file.originalName,
          filters: [{ name: 'Text Files', extensions: ['txt', 'md'] }],
        })
      : await dialog.showSaveDialog({
          defaultPath: file.originalName,
          filters: [{ name: 'Text Files', extensions: ['txt', 'md'] }],
        })
    if (!result.canceled && result.filePath) {
      await fs.writeFile(result.filePath, content, 'utf-8')
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
  ipcMain.handle('kb:getEmbedding', async (_event, text: string, apiUrl: string, apiKey: string, embeddingModel: string) => {
    return await getEmbedding(text, apiUrl, apiKey, embeddingModel)
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
  ipcMain.handle('kb:webSearch', async (_event, query: string, maxResults: number = 5) => {
    try {
      const { search } = await import('duckduckgo-search')
      const results: { title: string; snippet: string; url: string }[] = []
      for await (const result of search(query, { maxResults })) {
        results.push({
          title: result.title || '',
          snippet: result.description || result.snippet || '',
          url: result.url || '',
        })
      }
      return results
    } catch (err) {
      console.error('Web search failed:', err)
      return []
    }
  })
}
