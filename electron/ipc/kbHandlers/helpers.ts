import { IpcMain, BrowserWindow, SafeStorage } from 'electron'
import * as fs from 'fs/promises'
import * as path from 'path'
import { decryptKey, getOpenAI, getConfigStore, isSafePath } from '../utils'
import type { StoredConfig } from '../utils'
import { logError } from '../logger'
import { netFetch } from '../netFetch'
import type { KnowledgeFile, KnowledgeIndex, KnowledgeMetadata } from '../../../src/types/knowledge'

let _projectsBasePath = ''
export function setProjectsBasePath(p: string) { _projectsBasePath = p }
export function getProjectsBasePath() { return _projectsBasePath }

// ====================== Chunking ======================

export const CHUNK_SIZE = 500
export const CHUNK_OVERLAP = 100

export function chunkText(text: string): { content: string; charStart: number; charEnd: number }[] {
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

export async function parseFile(filePath: string, type: string): Promise<string> {
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

export function getKBPath(): string {
  return path.join(path.dirname(getProjectsBasePath()), 'knowledge_base')
}

export function safeKBFilePath(file: { name: string; folder?: string }): string {
  const filesDir = path.join(getKBPath(), 'files')
  // v16: 三级目录——folder 为相对路径（"一级/二级"，空 = 根目录）。
  // 归一化防路径穿越：只保留一层/二层纯目录名（不含 .. 与分隔符）
  const folderParts = String(file.folder || '')
    .split(/[\\/]+/).map(p => p.trim()).filter(Boolean)
    .filter(p => p !== '.' && p !== '..')
    .slice(0, 2)
  const filePath = path.join(filesDir, ...folderParts, path.basename(file.name))
  if (!filePath.startsWith(filesDir + path.sep) && filePath !== filesDir) {
    throw new Error('非法文件路径')
  }
  return filePath
}

/** v16: 三级目录——文件夹路径（根/一级/二级），归一化防穿越 */
export function safeKBFolderPath(folder: string): string {
  const filesDir = path.join(getKBPath(), 'files')
  const parts = String(folder || '')
    .split(/[\\/]+/).map(p => p.trim()).filter(Boolean)
    .filter(p => p !== '.' && p !== '..')
    .slice(0, 2)
  const dirPath = path.join(filesDir, ...parts)
  if (!dirPath.startsWith(filesDir + path.sep) && dirPath !== filesDir) {
    throw new Error('非法文件夹路径')
  }
  return dirPath
}

/** v16: 目录名清洗（去非法字符，去路径分隔符） */
export function sanitizeFolderName(name: string): string {
  return sanitizeFileName(name.replace(/[\\/]/g, '_'))
}

/** v16: 列出知识库文件目录树（三级）——每项含 dir + 子项 dirs/files */
export async function listKBFolderTree(): Promise<
  Array<{
    dir: string
    subdirs: string[]
    files: Array<{ id: string; name: string }>
  }>
> {
  const filesDir = path.join(getKBPath(), 'files')
  const tree: Array<{ dir: string; subdirs: string[]; files: Array<{ id: string; name: string }> }> = []
  try {
    const level1 = await fs.readdir(filesDir, { withFileTypes: true })
    for (const d1 of level1) {
      if (!d1.isDirectory() || d1.name.startsWith('.')) continue
      const l1Path = path.join(filesDir, d1.name)
      const entry = { dir: d1.name, subdirs: [] as string[], files: [] as Array<{ id: string; name: string }> }
      try {
        const level2 = await fs.readdir(l1Path, { withFileTypes: true })
        for (const d2 of level2) {
          if (!d2.isDirectory() || d2.name.startsWith('.')) continue
          entry.subdirs.push(d2.name)
        }
      } catch { /* 忽略子目录读取失败 */ }
      tree.push(entry)
    }
  } catch { /* files 目录不存在 → 空树 */ }
  return tree
}

export async function loadIndex(): Promise<KnowledgeIndex> {
  try {
    const raw = await fs.readFile(path.join(getKBPath(), 'index.json'), 'utf-8')
    return JSON.parse(raw)
  } catch {
    return { chunks: [] }
  }
}

export async function saveIndex(index: KnowledgeIndex): Promise<void> {
  await fs.mkdir(getKBPath(), { recursive: true })
  await fs.writeFile(path.join(getKBPath(), 'index.json'), JSON.stringify(index, null, 2), 'utf-8')
}

export async function loadMetadata(): Promise<KnowledgeMetadata> {
  try {
    const raw = await fs.readFile(path.join(getKBPath(), 'metadata.json'), 'utf-8')
    return JSON.parse(raw)
  } catch {
    return { files: [] }
  }
}

export async function saveMetadata(meta: KnowledgeMetadata): Promise<void> {
  await fs.mkdir(getKBPath(), { recursive: true })
  await fs.writeFile(path.join(getKBPath(), 'metadata.json'), JSON.stringify(meta, null, 2), 'utf-8')
}

// ====================== Embedding ======================

export interface EmbeddingResult {
  embedding: number[]
  /** v14 批处理: embedding 请求的 input token 数（response.usage.prompt_tokens，无则 0）——token 统计用 */
  promptTokens: number
}

/** v14 批处理: getEmbedding 返回向量+usage（usage.jsonl 记账需要 token 数；部分兼容端点无 usage 字段 → 0） */
export async function getEmbedding(text: string, apiUrl: string, apiKey: string, model: string): Promise<EmbeddingResult> {
  const OpenAI = await getOpenAI()
  // v14.6.1: netFetch（系统代理/证书——别人电脑在代理网络下可连通）
  const client = new OpenAI({ apiKey, baseURL: apiUrl || undefined, fetch: netFetch })
  const response = await client.embeddings.create({
    model,
    input: text,
  })
  return {
    embedding: response.data[0]?.embedding || [],
    promptTokens: (response as any).usage?.prompt_tokens ?? 0,
  }
}

/** 兼容包装：仅取向量（kb:getEmbedding IPC 前端契约不变，不记账） */
export async function getEmbeddingVector(text: string, apiUrl: string, apiKey: string, model: string): Promise<number[]> {
  const { embedding } = await getEmbedding(text, apiUrl, apiKey, model)
  return embedding
}

// ====================== 批量嵌入（v16.0.1 审计 S3 提取，供 indexFile 与单测复用） ======================

export interface ChunkInput {
  charStart: number
  content: string
}

export interface EmbedChunksResult {
  /** 每个 chunk 的 embedding（失败的 chunk 为 null——调用方跳过不入 index） */
  embeddings: Array<number[] | null>
  /** 成功 embedding 的总 promptTokens（记账用） */
  totalPromptTokens: number
  /** 失败 chunk 数 */
  failedCount: number
}

/**
 * v16.0.1(审计 S3): 逐 chunk 批量嵌入——embedding 失败的 chunk 返回 null（不入 index），
 * 失败数如实累计。原实现失败时 push 空向量 → 假成功（kb_search 按 embedding.length>0
 * 过滤 → 空向量 chunk 永远搜不到，但工具报"索引完成"）。
 * 纯函数便于单测（embedFn 可注入 mock）。
 */
export async function embedChunks(
  chunks: ChunkInput[],
  embedFn: (text: string) => Promise<EmbeddingResult>,
): Promise<EmbedChunksResult> {
  const embeddings: Array<number[] | null> = []
  let totalPromptTokens = 0
  let failedCount = 0
  for (const c of chunks) {
    try {
      const res = await embedFn(c.content)
      if (res.embedding.length > 0) {
        embeddings.push(res.embedding)
        totalPromptTokens += res.promptTokens || 0
      } else {
        // 端点返回空向量（罕见）——同样视为失败（空向量无法检索）
        embeddings.push(null)
        failedCount++
      }
    } catch {
      embeddings.push(null)
      failedCount++
    }
  }
  return { embeddings, totalPromptTokens, failedCount }
}

/**
 * v14 批处理: 构造 embedding 记账条目（source='embedding'，供 logTokenUsage）。
 * projectId 兜底 file.projects[0]（kb:index 无 projectId 参数，metadata 含归属）→ '__global__'。
 * cost 记 0：ModelConfig 无 embedding 价格字段且端点价格不一，固定常量会误导预算条；
 * TODO(后续): 引入 EMBEDDING_PRICE_PER_M 常量或配置字段后补算。
 */
export function buildEmbeddingUsageEntry(
  config: { id: string; name?: string },
  file: { id: string; projects?: string[] } | null,
  model: string,
  inputTokens: number,
): Omit<import('../statsHandlers').TokenUsageEntry, 'timestamp'> {
  return {
    projectId: file?.projects?.[0] || '__global__',
    configId: config.id,
    configName: config.name || '默认',
    model,
    inputTokens,
    outputTokens: 0,
    cacheHitTokens: 0,
    cost: 0,
    source: 'embedding',
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
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

// ====================== File Name Helpers ======================

/** Sanitize a user-provided filename for filesystem safety (keeps Chinese/Unicode) */
export function sanitizeFileName(name: string): string {
  // Replace Windows-illegal characters with underscore
  let sanitized = name.replace(/[<>:"/\\|?*]/g, '_')
  // Trim whitespace and control characters
  sanitized = sanitized.replace(/[\x00-\x1f\x7f]/g, '').trim()
  // Remove leading/trailing dots and spaces (Windows issue)
  sanitized = sanitized.replace(/^[. ]+/, '').replace(/[. ]+$/, '')
  // If empty after sanitization, use a fallback
  if (!sanitized) sanitized = 'untitled'
  return sanitized
}

/** Ensure a filename is unique in the KB files directory; appends _1, _2 if needed */
export async function getUniqueFileName(baseName: string): Promise<string> {
  const filesDir = path.join(getKBPath(), 'files')
  return getUniqueFileNameInDir(filesDir, baseName)
}

/** v16: 带目标目录的唯一文件名（三级目录内重名 → _1, _2） */
export async function getUniqueFileNameInDir(dir: string, baseName: string): Promise<string> {
  const ext = path.extname(baseName)
  const stem = path.basename(baseName, ext)
  let candidate = baseName
  let counter = 1
  while (true) {
    try {
      await fs.access(path.join(dir, candidate))
      // File exists — try next counter
      candidate = `${stem}_${counter}${ext}`
      counter++
    } catch {
      return candidate  // Available
    }
  }
}

// ====================== Upload Helper ======================

export async function saveKBFile(filePath: string, activeProjectId: string, folder?: string): Promise<KnowledgeFile> {
  const stat = await fs.stat(filePath)
  if (stat.size > 50 * 1024 * 1024) {
    throw new Error(`文件 ${path.basename(filePath)} 超过50MB限制`)
  }
  const ext = path.extname(filePath).toLowerCase().replace('.', '')
  const type = (['txt', 'md', 'pdf', 'docx'].includes(ext) ? ext : 'txt') as KnowledgeFile['type']
  const id = `kb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  // v16: 三级目录——folder 归一化后写入对应子目录
  const safeFolder = folder
    ? String(folder).split(/[\\/]+/).map(p => p.trim()).filter(Boolean).filter(p => p !== '.' && p !== '..').slice(0, 2).join('/')
    : ''
  const filesDir = path.join(getKBPath(), 'files')
  const targetDir = safeFolder ? path.join(filesDir, ...safeFolder.split('/')) : filesDir
  await fs.mkdir(targetDir, { recursive: true })
  const safeName = await getUniqueFileNameInDir(targetDir, sanitizeFileName(path.basename(filePath)))
  await fs.copyFile(filePath, path.join(targetDir, safeName))
  const file: KnowledgeFile = {
    id, name: safeName, originalName: path.basename(filePath),
    type, size: stat.size, chunkCount: 0,
    projects: activeProjectId ? [activeProjectId] : [],
    source: 'upload', uploadedAt: new Date().toISOString(),
    folder: safeFolder || undefined,
  }
  const meta = await loadMetadata()
  meta.files.push(file)
  await saveMetadata(meta)
  return file
}

// ====================== IPC Registration ======================
