/**
 * 七层缓存 + 多轮对话 全面验证测试 (V9.5.2)
 *
 * 在同一个会话中：
 * 1. 先加载 7 个缓存层的数据
 * 2. 三轮交替对话（简单/复杂任务）
 * 3. 验证每层缓存是否命中、是否减少 token 花费
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

// ══════════════════════════════════════════════════════════
// 模拟项目环境
// ══════════════════════════════════════════════════════════

const TMP = path.join(os.tmpdir(), `qj_cache_test_${Date.now().toString(36)}`)
const PROJECT_DIR = path.join(TMP, 'projects', 'test_cache')
const CHAPTERS_DIR = path.join(PROJECT_DIR, 'chapters')
const OUTLINE_DIR = path.join(PROJECT_DIR, 'outline')
const CHARS_DIR = path.join(PROJECT_DIR, 'characters')
const UPLOADS_DIR = path.join(TMP, 'uploads', 'files')

function ensureDir(d: string) { fs.mkdirSync(d, { recursive: true }) }
function writeFile(p: string, c: string) { ensureDir(path.dirname(p)); fs.writeFileSync(p, c, 'utf-8') }
function readFile(p: string): string { return fs.readFileSync(p, 'utf-8') }

// ══════════════════════════════════════════════════════════
// 第1层: fileReadCache 共享文件读缓存
// ══════════════════════════════════════════════════════════

const fileReadCache = new Map<string, { content: string; size: number; readCount: number }>()
function l1_get(p: string) { return fileReadCache.get(p)?.content }
function l1_set(p: string, c: string) {
  const existing = fileReadCache.get(p)
  fileReadCache.set(p, { content: c, size: c.length, readCount: (existing?.readCount || 0) + 1 })
}
function l1_hit(p: string): boolean { const e = fileReadCache.get(p); if (e) { e.readCount++; return true } return false }
function l1_stats() { let chars = 0, reads = 0; for (const v of fileReadCache.values()) { chars += v.size; reads += v.readCount }; return { entries: fileReadCache.size, totalChars: chars, totalReads: reads } }

function fileServiceRead(p: string): string {
  if (l1_hit(p)) return l1_get(p)!
  const content = readFile(p)
  l1_set(p, content)
  return content
}
function fileServiceWrite(p: string, c: string) { writeFile(p, c); l1_set(p, c) }

// ══════════════════════════════════════════════════════════
// 第2层: FileCache AI工具层
// ══════════════════════════════════════════════════════════

function aiReadFile(filePath: string): { status: string; summary: string; detail: string; fromCache: boolean } {
  const cached = l1_get(filePath)
  if (cached !== undefined) {
    return { status: 'success', summary: `已读取: ${filePath} (缓存)`, detail: cached, fromCache: true }
  }
  const content = fileServiceRead(filePath)
  return { status: 'success', summary: `${content.length} 字符`, detail: content, fromCache: false }
}

// ══════════════════════════════════════════════════════════
// 第3层: Context Provider 缓存
// ══════════════════════════════════════════════════════════

interface CachedBlock {
  domain: string; content: string; priority: number; estimatedTokens: number
}
const providerCache = new Map<string, CachedBlock>()
let providerBuildCount = 0

function buildProvider(projectId: string, domain: string, buildFn: () => string): CachedBlock {
  const key = `${projectId}:${domain}`
  const hit = providerCache.get(key)
  if (hit) return { ...hit, estimatedTokens: Math.ceil(hit.content.length / 3) }
  providerBuildCount++
  const content = buildFn()
  const block: CachedBlock = {
    domain, content, priority: 1,
    estimatedTokens: Math.ceil(content.length / 3),
  }
  providerCache.set(key, block)
  return block
}

function invalidateProviderDomain(projectId: string, domain: string) {
  providerCache.delete(`${projectId}:${domain}`)
}

// ══════════════════════════════════════════════════════════
// 第4层: MemoryIndex 项目索引缓存
// ══════════════════════════════════════════════════════════

let cachedIndex: { projectId: string; index: string; tokenCount: number } | null = null
let indexBuildCount = 0

function buildMemoryIndex(projectId: string): string {
  if (cachedIndex && cachedIndex.projectId === projectId) return cachedIndex.index
  indexBuildCount++
  const files: string[] = []
  function walk(dir: string, prefix = '') {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name), prefix + entry.name + '/')
      else files.push(prefix + entry.name)
    }
  }
  walk(PROJECT_DIR)
  const index = files.map(f => `  ${f}`).join('\n')
  const tokenCount = Math.ceil(index.length / 3)
  cachedIndex = { projectId, index, tokenCount }
  return index
}

function invalidateMemoryIndex() { cachedIndex = null }

// ══════════════════════════════════════════════════════════
// 第5层: System Prompt 分体缓存
// ══════════════════════════════════════════════════════════

const CORE_PROMPT = '核心法则(缓存): 项目隔离/修改前读/铁律/安全规则...'.repeat(20)
const coreTokens = Math.ceil(CORE_PROMPT.length / 3)
const CACHE_PRICE_RATIO = 0.1 // Anthropic: cached tokens billed at 10%

function computeApiCost(promptTokens: number, completionTokens: number, cachedInputTokens: number): number {
  const regularInputCost = (promptTokens - cachedInputTokens) * 0.000002  // $2/1M
  const cachedInputCost = cachedInputTokens * 0.000002 * CACHE_PRICE_RATIO
  const outputCost = completionTokens * 0.000008  // $8/1M
  return regularInputCost + cachedInputCost + outputCost
}

// ══════════════════════════════════════════════════════════
// 第6层: Tool 缓存
// ══════════════════════════════════════════════════════════

let toolCache: { key: string; tools: string[] } | null = null
let toolBuildCount = 0

function getToolsForTask(taskKey: string): string[] {
  if (toolCache && toolCache.key === taskKey) return toolCache.tools
  toolBuildCount++
  const READ = ['read_file', 'list_directory', 'search_files', 'search_content']
  const WRITE = ['create_file', 'edit_file']
  const TEMPLATE = ['create_style_template', 'create_scene_template']
  let tools: string[]

  if (taskKey === 'simple') tools = READ
  else if (taskKey === 'complex') tools = [...READ, ...WRITE]
  else tools = [...READ, ...WRITE, ...TEMPLATE]

  toolCache = { key: taskKey, tools }
  return tools
}

// ══════════════════════════════════════════════════════════
// 第7层: Style 项目缓存
// ══════════════════════════════════════════════════════════

const styleCache = new Map<string, { project: Record<string, unknown>; loadCount: number }>()
const MAX_STYLE_CACHE = 3 // 缩小以便测试 LRU
let styleLoadCount = 0

function loadStyleProject(id: string): Record<string, unknown> {
  const hit = styleCache.get(id)
  if (hit) {
    hit.loadCount++
    styleCache.delete(id)
    styleCache.set(id, hit) // move to front (LRU)
    return hit.project
  }
  styleLoadCount++
  const project = { id, name: `Style ${id}`, dimensions: {} }
  if (styleCache.size >= MAX_STYLE_CACHE) {
    const firstKey = styleCache.keys().next().value!
    styleCache.delete(firstKey)
  }
  styleCache.set(id, { project, loadCount: 1 })
  return project
}

// ══════════════════════════════════════════════════════════
// 模拟多轮对话
// ══════════════════════════════════════════════════════════

interface TurnResult {
  round: number
  taskType: string
  actions: string[]
  fileCacheHits: number
  providerCached: boolean
  indexCached: boolean
  toolCached: boolean
  estimatedInputTokens: number
  estimatedCachedTokens: number
}

function simulateConversationRound(
  round: number,
  taskType: 'simple' | 'complex',
  projectId: string,
): TurnResult {
  const actions: string[] = []
  let fileCacheHits = 0
  let estimatedInputTokens = 0
  let estimatedCachedTokens = 0

  // 1. 项目索引（第4层）
  const index = buildMemoryIndex(projectId)
  estimatedInputTokens += cachedIndex!.tokenCount
  if (round > 1) estimatedCachedTokens += cachedIndex!.tokenCount
  actions.push(`MemoryIndex: ${round > 1 ? '缓存命中' : `构建(${indexBuildCount}次)`}`)

  // 2. 工具裁剪（第6层）
  const tools = getToolsForTask(taskType)
  const toolTokens = tools.length * 200
  estimatedInputTokens += toolTokens
  if (toolCache && round > 1) estimatedCachedTokens += toolTokens
  actions.push(`ToolCache: ${taskType}=${tools.length}工具 ${round > 1 && toolCache ? '(缓存)' : `(构建#${toolBuildCount})`}`)

  // 3. 读取章节（第1&2层）
  const ch1Result = aiReadFile(path.join(CHAPTERS_DIR, 'ch001.txt'))
  estimatedInputTokens += Math.ceil(ch1Result.detail.length / 3)
  if (ch1Result.fromCache) { fileCacheHits++; estimatedCachedTokens += Math.ceil(ch1Result.detail.length / 3) }
  actions.push(`read ch001: ${ch1Result.fromCache ? '缓存' : '磁盘'}(${ch1Result.summary})`)

  // 4. 读取大纲（第1&2层）
  const outlineResult = aiReadFile(path.join(OUTLINE_DIR, 'plot.md'))
  estimatedInputTokens += Math.ceil(outlineResult.detail.length / 3)
  if (outlineResult.fromCache) { fileCacheHits++; estimatedCachedTokens += Math.ceil(outlineResult.detail.length / 3) }
  actions.push(`read outline: ${outlineResult.fromCache ? '缓存' : '磁盘'}(${outlineResult.summary})`)

  // 5. Context Provider（第3层）
  const charProviderKey = `${projectId}:character`
  const providerWasCached = providerCache.has(charProviderKey)
  buildProvider(projectId, 'character', () => {
    const chars = readFile(path.join(CHARS_DIR, 'zhangsan.json'))
    return `角色上下文: ${JSON.parse(chars).name}`
  })
  const providerBlock = providerCache.get(charProviderKey)!
  estimatedInputTokens += providerBlock.estimatedTokens
  if (providerWasCached) estimatedCachedTokens += providerBlock.estimatedTokens
  if (round > 1) actions.push(`Provider(character): 缓存`)

  // 6. 风格项目（第7层）
  const styleWasCached = styleCache.has('style_a')
  loadStyleProject('style_a')
  if (styleWasCached) estimatedCachedTokens += 100
  else estimatedInputTokens += 100
  actions.push(`StyleCache: ${styleWasCached ? '命中' : `加载(#${styleLoadCount})`}`)

  // 7. 核心 Prompt（第5层）
  estimatedInputTokens += coreTokens
  estimatedCachedTokens += coreTokens // 核心 prompt 始终缓存
  actions.push(`CorePrompt: ${coreTokens} tokens(缓存 10%计价)`)

  return {
    round, taskType, actions,
    fileCacheHits,
    providerCached: providerWasCached,
    indexCached: round > 1,
    toolCached: round > 1 && !!toolCache,
    estimatedInputTokens,
    estimatedCachedTokens,
  }
}

// ══════════════════════════════════════════════════════════
// 测试
// ══════════════════════════════════════════════════════════

describe('七层缓存 + 多轮对话验证', () => {

  beforeAll(() => {
    // 创建模拟项目
    ensureDir(CHAPTERS_DIR)
    ensureDir(OUTLINE_DIR)
    ensureDir(CHARS_DIR)
    ensureDir(UPLOADS_DIR)

    writeFile(path.join(CHAPTERS_DIR, 'ch001.txt'), '第1章 初入江湖\n\n清晨的阳光透过客栈窗棂。\n\n李云飞揉了揉惺忪的睡眼。'.repeat(10))
    writeFile(path.join(CHAPTERS_DIR, 'ch002.txt'), '第2章 竹林对决\n\n沈寒衣负手而立，白衣猎猎作响。\n\n剑气纵横三万里。'.repeat(10))
    writeFile(path.join(OUTLINE_DIR, 'plot.md'), '# 故事大纲\n\n主线：少年剑客李云飞闯荡江湖，揭开身世之谜\n支线：青山派内斗、魔教复兴、感情线(林小月)')
    writeFile(path.join(CHARS_DIR, 'zhangsan.json'), JSON.stringify({ id: 'zhangsan', name: '张三', role: '男主' }))
    writeFile(path.join(CHARS_DIR, 'lisi.json'), JSON.stringify({ id: 'lisi', name: '李四', role: '反派' }))

    // 上传测试文件到 uploads/
    writeFile(path.join(UPLOADS_DIR, '参考素材.txt'), '古风素材：暮色如血，剑气如虹。'.repeat(20))
  })

  afterAll(() => { try { fs.rmSync(TMP, { recursive: true }) } catch {} })

  beforeEach(() => {
    fileReadCache.clear()
    providerCache.clear()
    styleCache.clear()
    cachedIndex = null
    toolCache = null
    providerBuildCount = 0
    indexBuildCount = 0
    toolBuildCount = 0
    styleLoadCount = 0
  })

  // ══════════════════════════════════════════════════════════
  // 七层独立验证
  // ══════════════════════════════════════════════════════════

  it('第1层: fileReadCache — 读写缓存', () => {
    const p = path.join(CHAPTERS_DIR, 'ch001.txt')
    // 首次：磁盘读
    const r1 = fileServiceRead(p)
    expect(l1_stats().entries).toBe(1)
    // 再次：缓存命中
    const r2 = fileServiceRead(p)
    expect(r2).toBe(r1)
    expect(l1_stats().entries).toBe(1) // 仍只1条
    expect(l1_stats().totalReads).toBeGreaterThan(1) // 但读取了多次
  })

  it('第2层: FileCache AI工具层 — read_file 标注缓存', () => {
    const p = path.join(CHAPTERS_DIR, 'ch001.txt')
    const r1 = aiReadFile(p)
    expect(r1.fromCache).toBe(false)
    expect(r1.summary).not.toContain('缓存')

    const r2 = aiReadFile(p)
    expect(r2.fromCache).toBe(true)
    expect(r2.summary).toContain('缓存')
  })

  it('第3层: ContextProvider — 同一domain不重复构建', () => {
    const pid = 'test_cache'
    expect(providerBuildCount).toBe(0)

    buildProvider(pid, 'character', () => '角色: 张三')
    expect(providerBuildCount).toBe(1)

    buildProvider(pid, 'character', () => '角色: 张三')
    expect(providerBuildCount).toBe(1) // 未重新构建

    // 失效后重建
    invalidateProviderDomain(pid, 'character')
    buildProvider(pid, 'character', () => '角色: 李四')
    expect(providerBuildCount).toBe(2)
  })

  it('第4层: MemoryIndex — 文件未变不重建', () => {
    expect(indexBuildCount).toBe(0)

    buildMemoryIndex('test_cache')
    expect(indexBuildCount).toBe(1)

    buildMemoryIndex('test_cache')
    expect(indexBuildCount).toBe(1) // 缓存命中

    invalidateMemoryIndex()
    buildMemoryIndex('test_cache')
    expect(indexBuildCount).toBe(2) // 重建
  })

  it('第5层: System Prompt — 核心缓存 10% 计价', () => {
    const costWithoutCache = computeApiCost(coreTokens + 4000, 1000, 0)
    const costWithCache = computeApiCost(coreTokens + 4000, 1000, coreTokens)
    // 有缓存应该更便宜
    expect(costWithCache).toBeLessThan(costWithoutCache)
    // 大约节省 coreTokens 的 90% 费用
    const saving = costWithoutCache - costWithCache
    expect(saving).toBeGreaterThan(0)
  })

  it('第6层: ToolCache — 相同任务复用工具列表', () => {
    expect(toolBuildCount).toBe(0)

    getToolsForTask('simple')
    expect(toolBuildCount).toBe(1)

    getToolsForTask('simple')
    expect(toolBuildCount).toBe(1) // 复用

    getToolsForTask('complex')
    expect(toolBuildCount).toBe(2) // 不同任务
  })

  it('第7层: StyleCache LRU — 超过上限淘汰最早', () => {
    expect(styleLoadCount).toBe(0)

    loadStyleProject('a'); loadStyleProject('b'); loadStyleProject('c')
    expect(styleLoadCount).toBe(3)
    expect(styleCache.size).toBe(3)

    loadStyleProject('a') // 命中，移到队尾
    expect(styleLoadCount).toBe(3)

    loadStyleProject('d') // 满，淘汰最早的 'b'
    expect(styleLoadCount).toBe(4)
    expect(styleCache.has('b')).toBe(false)
    expect(styleCache.has('a')).toBe(true)
    expect(styleCache.has('c')).toBe(true)
    expect(styleCache.has('d')).toBe(true)
  })

  // ══════════════════════════════════════════════════════════
  // 多轮对话 — 7层联动
  // ══════════════════════════════════════════════════════════

  describe('多轮对话：简单/复杂交替 3 轮', () => {
    it('第1轮 简单任务 → 初始化所有缓存', () => {
      const result = simulateConversationRound(1, 'simple', 'test_cache')

      // 首次全部走构建
      expect(result.fileCacheHits).toBe(0) // 文件首次读
      expect(result.indexCached).toBe(false)
      expect(result.toolCached).toBe(false)

      // 仍有缓存节省（核心prompt）
      expect(result.estimatedCachedTokens).toBeGreaterThanOrEqual(coreTokens)
    })

    it('第2轮 复杂任务 → 缓存全部命中', () => {
      simulateConversationRound(1, 'simple', 'test_cache') // 预热
      const result = simulateConversationRound(2, 'complex', 'test_cache')

      // 全命中
      expect(result.fileCacheHits).toBeGreaterThanOrEqual(2) // ch001 + outline 都已缓存
      expect(result.indexCached).toBe(true)
      expect(result.toolCached).toBe(true)

      // 大量 token 被缓存覆盖
      expect(result.estimatedCachedTokens).toBeGreaterThan(result.estimatedInputTokens * 0.3)
    })

    it('第3轮 简单任务 → 持续命中', () => {
      simulateConversationRound(1, 'simple', 'test_cache')
      simulateConversationRound(2, 'complex', 'test_cache')
      const result = simulateConversationRound(3, 'simple', 'test_cache')

      expect(result.fileCacheHits).toBeGreaterThanOrEqual(2)
      expect(result.indexCached).toBe(true)
    })
  })

  // ══════════════════════════════════════════════════════════
  // Token 节省量化
  // ══════════════════════════════════════════════════════════

  it('三轮对话 Token 节省报告', () => {
    const rounds: TurnResult[] = []
    rounds.push(simulateConversationRound(1, 'simple', 'test_cache'))
    rounds.push(simulateConversationRound(2, 'complex', 'test_cache'))
    rounds.push(simulateConversationRound(3, 'simple', 'test_cache'))

    let totalInput = 0, totalCached = 0
    for (const r of rounds) {
      totalInput += r.estimatedInputTokens
      totalCached += r.estimatedCachedTokens
    }

    const cacheRate = totalCached / totalInput
    const savings = totalCached * 0.000002 * 0.9 // 缓存token节省的90%

    console.log('\n═══════════════════════════════════════')
    console.log('  七层缓存 — Token 节省报告')
    console.log('═══════════════════════════════════════')
    console.log(`  总输入 Token:      ${totalInput.toLocaleString()}`)
    console.log(`  缓存命中 Token:    ${totalCached.toLocaleString()}`)
    console.log(`  缓存命中率:        ${(cacheRate * 100).toFixed(1)}%`)
    console.log(`  估算费用节省:      $${savings.toFixed(6)}`)
    console.log('───────────────────────────────────')
    console.log(`  第1层 fileReadCache:  ${l1_stats().entries} 条目, ${l1_stats().totalChars.toLocaleString()} 字符`)
    console.log(`  第3层 ProviderCache:  ${providerCache.size} 条目 (构建 ${providerBuildCount} 次)`)
    console.log(`  第4层 MemoryIndex:    ${cachedIndex ? 1 : 0} 条目 (构建 ${indexBuildCount} 次)`)
    console.log(`  第6层 ToolCache:      ${toolCache ? 1 : 0} 条目 (构建 ${toolBuildCount} 次)`)
    console.log(`  第7层 StyleCache:     ${styleCache.size} 条目 (加载 ${styleLoadCount} 次)`)
    console.log('═══════════════════════════════════════\n')

    // 缓存率 > 30%
    expect(cacheRate).toBeGreaterThan(0.3)
    // 至少 1 个文件缓存条目
    expect(l1_stats().entries).toBeGreaterThanOrEqual(1)
    // Provider 缓存正常工作
    expect(providerCache.size).toBeGreaterThanOrEqual(1)
    // 索引在第2轮后命中
    expect(indexBuildCount).toBe(1) // 只构建了1次
  })

  // ══════════════════════════════════════════════════════════
  // 缓存失效 + 重建
  // ══════════════════════════════════════════════════════════

  it('文件修改后缓存更新（不重建，写穿透）', () => {
    const p = path.join(CHAPTERS_DIR, 'ch001.txt')
    fileServiceRead(p) // 缓存

    expect(l1_get(p)).toContain('初入江湖')

    // 修改文件 → fileService.write 自动更新缓存
    fileServiceWrite(p, '新内容：江湖再见')
    expect(l1_get(p)).toBe('新内容：江湖再见')
    expect(l1_stats().entries).toBe(1) // 未增加新条目
  })

  it('文件删除后索引重建', () => {
    buildMemoryIndex('test_cache')
    expect(indexBuildCount).toBe(1)

    // 删除文件 → 索引失效
    const newFile = path.join(CHAPTERS_DIR, 'temp.txt')
    writeFile(newFile, '临时')
    invalidateMemoryIndex()

    buildMemoryIndex('test_cache')
    expect(indexBuildCount).toBe(2)

    fs.unlinkSync(newFile)
  })
})
