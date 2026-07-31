/**
 * 统一知识注入管道 (KnowledgePipeline)
 * 所有 AI 调用使用相同的语义检索 + 注入策略，消除章节生成(全量50000字)
 * 与 AI 对话(Top3 1500字)之间的策略不一致。
 */
import { kbService } from './fileService'
import { logError } from '@/utils/logger'

export interface ChunkRef {
  content: string
  fileName: string
  score: number
}

export interface InjectionResult {
  prompt: string
  chunksInjected: number
  charsInjected: number
}

/**
 * 从知识库中检索与查询最相关的 chunks
 * @param query 搜索查询
 * @param projectId 项目ID
 * @param configId AI配置ID
 * @param fileIds 可选的文件ID过滤
 * @param topK 返回top K chunks (默认5)
 */
export async function searchKB(
  query: string,
  projectId: string,
  configId: string,
  fileIds?: string[],
  topK = 5,
): Promise<ChunkRef[]> {
  try {
    const results = await kbService.search(query.slice(0, 500), projectId, configId, topK, fileIds)
    if (Array.isArray(results) && results.length > 0) {
      return results.map((r: any) => ({
        content: r.content || '',
        fileName: r.fileName || '知识库',
        score: r.score || 0,
      }))
    }
  } catch (e) { logError('KB semantic search failed', e) }
  return []
}

/**
 * 将检索到的 chunks 注入到 prompt 中
 * @param prompt 原始 prompt
 * @param chunks 检索到的 chunks
 * @param position 注入位置: 'before'(开头) | 'after'(末尾) | 'before-writing'(在"创作要求"之前)
 */
export function injectChunks(
  prompt: string,
  chunks: ChunkRef[],
  position: 'before' | 'after' | 'before-writing' = 'before-writing',
): InjectionResult {
  if (chunks.length === 0) return { prompt, chunksInjected: 0, charsInjected: 0 }

  const header = `【知识库参考】
以下是从知识库中检索到的参考资料（共${chunks.length}条，按相关度排序），请在写作时融合这些信息：
`
  const body = chunks.map((c, i) => `${i + 1}. [${c.fileName}] (相关度: ${(c.score * 100).toFixed(0)}%)\n${c.content}`).join('\n\n---\n\n')
  const block = header + body
  const chars = block.length

  if (position === 'before') {
    const combined = block + '\n\n' + prompt
    if (combined.length > 100000) console.warn('[KnowledgePipeline] Combined prompt exceeds ~100K chars, may hit context limit')
    return { prompt: combined, chunksInjected: chunks.length, charsInjected: chars }
  }
  if (position === 'after') {
    const combined = prompt + '\n\n' + block
    if (combined.length > 100000) console.warn('[KnowledgePipeline] Combined prompt exceeds ~100K chars, may hit context limit')
    return { prompt: combined, chunksInjected: chunks.length, charsInjected: chars }
  }
  // 'before-writing': 在"创作要求"之前注入
  const reqIdx = prompt.lastIndexOf('【创作要求】')
  if (reqIdx > 0) {
    return {
      prompt: prompt.slice(0, reqIdx) + block + '\n\n' + prompt.slice(reqIdx),
      chunksInjected: chunks.length,
      charsInjected: chars,
    }
  }
  return { prompt: prompt + '\n\n' + block, chunksInjected: chunks.length, charsInjected: chars }
}

/**
 * 一键检索并注入 — 流畅API
 */
export async function injectKnowledge(
  prompt: string,
  query: string,
  projectId: string,
  configId: string,
  fileIds?: string[],
  topK = 5,
  position: 'before' | 'after' | 'before-writing' = 'before-writing',
): Promise<InjectionResult> {
  const chunks = await searchKB(query, projectId, configId, fileIds, topK)
  return injectChunks(prompt, chunks, position)
}

/**
 * 全量降级注入（当语义搜索不可用时）
 */
export async function injectKnowledgeFallback(
  prompt: string,
  fileIds: string[],
  maxChars = 10000,
  perFileMaxChars = 5000,
): Promise<InjectionResult> {
  const parts: string[] = []
  let total = 0
  for (const fid of fileIds) {
    if (total >= maxChars) break
    try {
      const result = await kbService.read(fid) as { file: { originalName: string }; content: string }
      const len = Math.min(result.content.length, perFileMaxChars, maxChars - total)
      parts.push(`【文件: ${result.file.originalName}】\n${result.content.slice(0, len)}`)
      total += len
    } catch (e) { logError('KB fallback read failed', e) }
  }
  if (parts.length === 0) return { prompt, chunksInjected: 0, charsInjected: 0 }
  const block = '【知识库参考】\n以下知识库内容可供参考：\n' + parts.join('\n\n')
  const reqIdx = prompt.lastIndexOf('【创作要求】')
  if (reqIdx > 0) {
    return { prompt: prompt.slice(0, reqIdx) + block + '\n\n' + prompt.slice(reqIdx), chunksInjected: parts.length, charsInjected: total }
  }
  return { prompt: prompt + '\n' + block, chunksInjected: parts.length, charsInjected: total }
}
