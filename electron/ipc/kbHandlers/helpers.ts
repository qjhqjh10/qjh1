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

export function safeKBFilePath(file: { name: string }): string {
  const filesDir = path.join(getKBPath(), 'files')
  const filePath = path.join(filesDir, path.basename(file.name))
  if (!filePath.startsWith(filesDir + path.sep) && filePath !== filesDir) {
    throw new Error('非法文件路径')
  }
  return filePath
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
  const ext = path.extname(baseName)
  const stem = path.basename(baseName, ext)
  let candidate = baseName
  let counter = 1
  while (true) {
    try {
      await fs.access(path.join(filesDir, candidate))
      // File exists — try next counter
      candidate = `${stem}_${counter}${ext}`
      counter++
    } catch {
      return candidate  // Available
    }
  }
}

// ====================== Upload Helper ======================

export async function saveKBFile(filePath: string, activeProjectId: string): Promise<KnowledgeFile> {
  const stat = await fs.stat(filePath)
  if (stat.size > 50 * 1024 * 1024) {
    throw new Error(`文件 ${path.basename(filePath)} 超过50MB限制`)
  }
  const ext = path.extname(filePath).toLowerCase().replace('.', '')
  const type = (['txt', 'md', 'pdf', 'docx'].includes(ext) ? ext : 'txt') as KnowledgeFile['type']
  const id = `kb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  await fs.mkdir(path.join(getKBPath(), 'files'), { recursive: true })
  const safeName = await getUniqueFileName(sanitizeFileName(path.basename(filePath)))
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
