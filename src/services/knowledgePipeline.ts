/**
 * 统一知识注入管道 (KnowledgePipeline)
 * 所有 AI 调用使用相同的语义检索 + 注入策略，消除章节生成(全量50000字)
 * 与 AI 对话(Top3 1500字)之间的策略不一致。
 *
 * v15.4.0: 生成场景支持「全量 / 片段」两种注入模式（injectKnowledgeForScene / buildKBBlock）；
 * 相关度阈值常量从 BridgeContextBuilder 收敛至此（单一真源）；删除死代码 injectKnowledge。
 */
import { kbService } from './fileService'
import { logError } from '@/utils/logger'
import type { KBSettings, KBSceneSettings, KBInjectMode } from '@/types/settings'
import { DEFAULT_KB_SCENE } from '@/types/settings'

// v15.4.0: KB 注入相关度阈值（cosine 相似度）——低于此值的片段视为无关不注入。
// 与 agent 场景（BridgeContextBuilder）共用单一真源；各 embedding 模型分数分布略有差异，0.3 为保守值。
export const KB_INJECT_SCORE_THRESHOLD = 0.3

/** v15.4.0: 知识库参考块头——统一使用指引文案（三处共用单一真源） */
export const KB_REF_HEADER = (count: number): string => `【知识库参考】
以下是知识库中与本次创作需求相关的内容（共${count}条，按相关度排序）。使用要求：
1. 与本章细纲/角色设定/创作要求相关的设定细节、伏笔与限制，必须融合进正文，不得遗漏
2. 与本次创作无关或互相冲突的内容，直接忽略，不得强行写入
3. 参考内容仅用于获取设定细节，不要在正文中复述或解释参考资料
`

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

/** v15.4.0: 生成场景注入配置（由三处生成 UI 传入） */
export interface InjectSceneOpts {
  mode: KBInjectMode
  keywords: string
  projectId: string
  configId: string
  scene: KBSceneSettings
}

/**
 * v15.4.0: 读取指定场景的知识库设置（含旧 generation 键兜底双保险——
 * v9 迁移后数据必然含新键；万一 store 异常缺键，回退旧 generation 值仍合理）。
 */
export function getSceneKb(
  kbSettings: KBSettings | undefined,
  scene: 'agent' | 'chapterGen' | 'characterGen',
): KBSceneSettings {
  const s = kbSettings?.[scene]
  const gen = kbSettings?.generation
  return {
    ...DEFAULT_KB_SCENE,
    ...(s ?? gen ?? {}),
  }
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
 * v15.4.0: 多关键词语义检索 — 每个关键词单独检索（每词最多 ceil(topK/N) 条），
 * 按内容全文去重后 score 降序截取 topK。
 * 分查询而非拼接：关键词语义差异大时拼接会互相稀释；代价仅多 N 次 query embedding 调用
 * （text-embedding-3-small 每次约几 token，成本可忽略），检索本身在本地索引完成。
 */
export async function searchKBMulti(
  keywords: string[],
  projectId: string,
  configId: string,
  fileIds?: string[],
  topK = 5,
): Promise<ChunkRef[]> {
  const kws = keywords.map(k => k.trim()).filter(Boolean)
  if (kws.length === 0) return []
  const perKw = Math.max(1, Math.ceil(topK / kws.length))
  const seen = new Map<string, ChunkRef>()
  for (const kw of kws) {
    const results = await searchKB(kw, projectId, configId, fileIds, perKw)
    for (const r of results) if (!seen.has(r.content)) seen.set(r.content, r)
  }
  return [...seen.values()].sort((a, b) => b.score - a.score).slice(0, topK)
}

/** v15.4.0: 片段块格式化（injectChunks 与 buildKBBlock 共用） */
function formatChunksBlock(chunks: ChunkRef[]): string {
  const body = chunks.map((c, i) => `${i + 1}. [${c.fileName}] (相关度: ${(c.score * 100).toFixed(0)}%)\n${c.content}`).join('\n\n---\n\n')
  return KB_REF_HEADER(chunks.length) + body
}

/** v15.4.0: 定位"创作要求"之前插入注入块（injectChunks 与 fallback 共用；找不到标记时追加末尾） */
function insertBeforeWriting(prompt: string, block: string): string {
  const reqIdx = prompt.lastIndexOf('【创作要求】')
  if (reqIdx > 0) {
    return prompt.slice(0, reqIdx) + block + '\n\n' + prompt.slice(reqIdx)
  }
  return prompt + '\n\n' + block
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

  const block = formatChunksBlock(chunks)
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
  return { prompt: insertBeforeWriting(prompt, block), chunksInjected: chunks.length, charsInjected: chars }
}

/**
 * 全量降级注入（当语义搜索不可用时 / 用户选择全量模式）
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
  const block = KB_REF_HEADER(parts.length) + parts.join('\n\n')
  return { prompt: insertBeforeWriting(prompt, block), chunksInjected: parts.length, charsInjected: total }
}

/**
 * v15.4.0: 构建知识库注入块文本（不含定位插入）——供批量生成预取一次、N 章复用；
 * 也供 AI 生成角色拼入 referenceContext（其 prompt 无【创作要求】标记）。
 * 返回 null = 无需注入（无文件 / 片段模式关键词为空 / 片段模式零结果）。
 */
export async function buildKBBlock(
  fileIds: string[],
  opts: InjectSceneOpts,
): Promise<string | null> {
  if (fileIds.length === 0) return null
  if (opts.mode === 'chunk') {
    const keywords = opts.keywords.split(/[,，、;；\s\n]+/)
    if (!keywords.some(k => k.trim())) return null
    const chunks = await searchKBMulti(keywords, opts.projectId, opts.configId, fileIds, opts.scene.searchTopK)
    const filtered = chunks.filter(c => (c.score ?? 1) >= KB_INJECT_SCORE_THRESHOLD)
    if (filtered.length === 0) return null
    return formatChunksBlock(filtered)
  }
  const result = await injectKnowledgeFallback('', fileIds, opts.scene.fallbackTotalMaxChars, opts.scene.fallbackPerFileMaxChars)
  return result.prompt || null
}

/**
 * v15.4.0: 生成场景知识库注入统一入口（替代三处内联实现）——注入位置在【创作要求】之前。
 * 降级规则：
 * - chunk 模式关键词为空 → 退回 full（用户可见提示在 UI 文案）
 * - chunk 模式检索/embedding 失败或零结果 → 不注入（与 agent 场景行为一致，静默空；
 *   不做"失败回退全量"——全量/片段是用户显式选择，静默回退可能注入远超预期的长文）
 */
export async function injectKnowledgeForScene(
  prompt: string,
  fileIds: string[],
  opts: InjectSceneOpts,
): Promise<InjectionResult> {
  if (fileIds.length === 0) return { prompt, chunksInjected: 0, charsInjected: 0 }
  if (opts.mode === 'chunk') {
    const keywords = opts.keywords.split(/[,，、;；\s\n]+/)
    if (keywords.some(k => k.trim())) {
      const chunks = await searchKBMulti(keywords, opts.projectId, opts.configId, fileIds, opts.scene.searchTopK)
      const filtered = chunks.filter(c => (c.score ?? 1) >= KB_INJECT_SCORE_THRESHOLD)
      if (filtered.length > 0) return injectChunks(prompt, filtered, 'before-writing')
      return { prompt, chunksInjected: 0, charsInjected: 0 }
    }
    console.warn('[KnowledgePipeline] 片段模式未填写关键词，退回全量注入')
  }
  return injectKnowledgeFallback(prompt, fileIds, opts.scene.fallbackTotalMaxChars, opts.scene.fallbackPerFileMaxChars)
}
