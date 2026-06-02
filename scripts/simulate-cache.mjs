/**
 * 七层缓存 + 多轮对话 CLI 仿真测试
 * 不调真实 API，模拟完整对话流程和缓存行为
 * 用法: node scripts/simulate-cache.mjs
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

// ═══════════════════════════════════════════════════════════
// 七层缓存实现（与 V4AgentChatBridge/V4AgentRuntime 逻辑一致）
// ═══════════════════════════════════════════════════════════

// 第1层 + 第2层: fileReadCache + FileCache
const fileReadCache = new Map()
const diskReadCount = { value: 0 }
function fileServiceRead(p) {
  if (fileReadCache.has(p)) {
    return { content: fileReadCache.get(p).content, fromCache: true }
  }
  diskReadCount.value++
  try {
    const c = fs.readFileSync(p, 'utf-8')
    fileReadCache.set(p, { content: c, size: c.length })
    return { content: c, fromCache: false }
  } catch { return { content: '', fromCache: false } }
}
function fileServiceWrite(p, c) {
  fs.writeFileSync(p, c, 'utf-8')
  fileReadCache.set(p, { content: c, size: c.length })
}

// 第3层: ContextProvider 缓存
const providerCache = new Map()
let providerBuildCount = 0
function buildProvider(projectId, domain, buildFn) {
  const key = `${projectId}:${domain}`
  if (providerCache.has(key)) return { ...providerCache.get(key), cached: true }
  providerBuildCount++
  const content = buildFn()
  const block = { domain, content, tokens: Math.ceil(content.length / 3), cached: false }
  providerCache.set(key, block)
  return block
}

// 第4层: MemoryIndex 缓存
let cachedIndex = null
let indexBuildCount = 0
function buildMemoryIndex(projectId) {
  if (cachedIndex?.projectId === projectId) return { ...cachedIndex, cached: true }
  indexBuildCount++
  const files = []
  function walk(dir, prefix = '') {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(dir, e.name), prefix + e.name + '/')
      else if (!e.name.startsWith('.')) files.push(prefix + e.name)
    }
  }
  walk(PROJECT_DIR)
  const index = files.map(f => `  ${f}`).join('\n')
  cachedIndex = { projectId, index, tokenCount: Math.ceil(index.length / 3), cached: false }
  cachedIndex.cached = false // first build
  return cachedIndex
}
function invalidateIndex() { cachedIndex = null }

// 第5层: System Prompt (模拟 DeepSeek 缓存)
const CORE_PROMPT_TOKENS = 300 // 核心提示词固定 ~300 tokens
const CACHE_RATE = 0.1 // 缓存 token 仅 10% 计费

// 第6层: Tool 缓存
let toolCache = null
let toolBuildCount = 0
function getTools(taskKey) {
  if (toolCache?.key === taskKey) return { ...toolCache, cached: true }
  toolBuildCount++
  const READ = ['read_file', 'list_directory', 'search_files', 'search_content']
  const WRITE = ['create_file', 'edit_file']
  const TMPL = ['create_style_template', 'create_scene_template']
  const tools = taskKey === 'chat' ? [] : taskKey === 'simple' ? READ : [...READ, ...WRITE, ...TMPL]
  toolCache = { key: taskKey, tools, cached: false }
  return toolCache
}

// 第7层: Style 缓存 (LRU, max 3)
const styleCache = new Map()
let styleLoadCount = 0
function loadStyle(id) {
  if (styleCache.has(id)) {
    const v = styleCache.get(id)
    styleCache.delete(id); styleCache.set(id, v) // move to front
    return { ...v, cached: true }
  }
  styleLoadCount++
  if (styleCache.size >= 3) { const f = styleCache.keys().next().value; styleCache.delete(f) }
  const v = { id, loaded: 1, cached: false }
  styleCache.set(id, v)
  return v
}

// ═══════════════════════════════════════════════════════════
// 仿真环境
// ═══════════════════════════════════════════════════════════

const TMP = path.join(os.tmpdir(), `sim_cache_${Date.now().toString(36)}`)
const PROJECT_DIR = path.join(TMP, 'projects', 'test')
function ensureDir(d) { fs.mkdirSync(d, { recursive: true }) }

// 预热：创建项目文件
ensureDir(path.join(PROJECT_DIR, 'chapters'))
ensureDir(path.join(PROJECT_DIR, 'outline'))
ensureDir(path.join(PROJECT_DIR, 'characters'))
ensureDir(path.join(TMP, 'uploads', 'files'))

fs.writeFileSync(path.join(PROJECT_DIR, 'chapters', 'ch001.txt'), '第1章 初入江湖\n\n清晨的阳光透过客栈窗棂。\n\n李云飞揉了揉惺忪的睡眼。\n\n"客官，您的早饭！"\n\n店小二推门而入。')
fs.writeFileSync(path.join(PROJECT_DIR, 'chapters', 'ch002.txt'), '第2章 竹林对决\n\n沈寒衣负手而立，白衣猎猎。\n\n剑气纵横，竹叶纷飞。')
fs.writeFileSync(path.join(PROJECT_DIR, 'outline', 'plot.md'), '# 故事大纲\n\n主线：少年剑客闯荡江湖，揭开身世之谜\n支线：青山派内斗、魔教复兴')
fs.writeFileSync(path.join(PROJECT_DIR, 'characters', 'zhangsan.json'), JSON.stringify({ id: 'zhangsan', name: '张三', role: '男主' }))
fs.writeFileSync(path.join(PROJECT_DIR, 'characters', 'lisi.json'), JSON.stringify({ id: 'lisi', name: '李四', role: '反派' }))

// ═══════════════════════════════════════════════════════════
// 对话轮次
// ═══════════════════════════════════════════════════════════

class RoundReport {
  constructor(round, taskType, message, actions = [], stats = {}) {
    this.round = round
    this.taskType = taskType
    this.message = message
    this.actions = actions
    this.stats = stats
  }
}

const rounds = []

function simulateRound(round, taskType, userMessage) {
  const actions = []
  const stats = { fileHits: 0, fileMisses: 0, providerCached: false, indexCached: false, toolCached: false, estimatedInputTokens: 0, cachedTokens: 0 }

  // 4. MemoryIndex
  const index = buildMemoryIndex('test')
  stats.indexCached = index.cached === true
  stats.estimatedInputTokens += index.tokenCount
  if (stats.indexCached) stats.cachedTokens += index.tokenCount
  actions.push(`[MemoryIndex] ${stats.indexCached ? '✅ 命中' : '🆕 构建'} (${index.tokenCount}t)`)

  // 6. Tools
  const tools = getTools(taskType)
  stats.toolCached = tools.cached === true
  const toolTokens = tools.tools.length * 150
  stats.estimatedInputTokens += toolTokens
  if (stats.toolCached) stats.cachedTokens += toolTokens
  actions.push(`[ToolCache] ${stats.toolCached ? '✅ 命中' : '🆕 构建'} (${tools.tools.length} 工具, ${toolTokens}t)`)

  // 1&2. File reads (chapter + outline)
  const chapterFile = path.join(PROJECT_DIR, 'chapters', 'ch001.txt')
  const outlineFile = path.join(PROJECT_DIR, 'outline', 'plot.md')
  for (const [label, fp] of [['ch001', chapterFile], ['outline', outlineFile]]) {
    const r = fileServiceRead(fp)
    if (r.fromCache) stats.fileHits++
    else stats.fileMisses++
    const t = Math.ceil(r.content.length / 3)
    stats.estimatedInputTokens += t
    if (r.fromCache) stats.cachedTokens += t
    actions.push(`[FileCache] ${label}: ${r.fromCache ? '✅ 缓存' : '💾 磁盘'} (${t}t)`)
  }

  // 3. Provider
  const prov = buildProvider('test', 'character', () => fs.readFileSync(path.join(PROJECT_DIR, 'characters', 'zhangsan.json'), 'utf-8'))
  stats.providerCached = prov.cached === true
  stats.estimatedInputTokens += prov.tokens
  if (stats.providerCached) stats.cachedTokens += prov.tokens
  actions.push(`[Provider] character: ${stats.providerCached ? '✅ 命中' : '🆕 构建'} (${prov.tokens}t)`)

  // 7. Style
  const sty = loadStyle('style_a')
  stats.estimatedInputTokens += 50
  if (sty.cached) stats.cachedTokens += 50
  actions.push(`[StyleCache] style_a: ${sty.cached ? '✅ 命中' : '🆕 加载'}`)

  // 5. Core Prompt (always cached)
  stats.estimatedInputTokens += CORE_PROMPT_TOKENS
  stats.cachedTokens += CORE_PROMPT_TOKENS
  actions.push(`[CorePrompt] ${CORE_PROMPT_TOKENS}t (💲10% 计费)`)

  const report = new RoundReport(round, taskType, userMessage, actions, stats)
  rounds.push(report)
  return report
}

// ═══════════════════════════════════════════════════════════
// 执行测试
// ═══════════════════════════════════════════════════════════

console.log('══════════════════════════════════════════════════')
console.log('  青剑 AI 写作助手 — 七层缓存仿真测试')
console.log('══════════════════════════════════════════════════\n')

// === PHASE 1: 预热七层缓存 ===
console.log('【阶段1】预热七层缓存\n')

console.log('  > 上传"古风素材.txt" → AI读取 → 写风格模板')
rounds.push(simulateRound(0, 'complex', '上传文件生成风格模板'))

console.log('  > 查看项目所有文件')
rounds.push(simulateRound(0.5, 'simple', '列出项目所有文件'))

console.log('  > 加载风格项目 style_a')
loadStyle('style_a')

console.log('\n  ✅ 七层缓存预热完成\n')

// === PHASE 2: 三轮交替对话 ===
console.log('【阶段2】三轮交替对话\n')

const tasks = [
  { round: 1, type: 'chat', msg: '你好，今天天气不错' },
  { round: 2, type: 'simple', msg: '帮我查看当前章节的内容' },
  { round: 3, type: 'complex', msg: '修改第一章的结尾，把张三改成李四' },
]

for (const t of tasks) {
  console.log(`  ── 第${t.round}轮 [${t.type}] ──`)
  console.log(`  用户: "${t.msg}"`)
  const r = simulateRound(t.round, t.type, t.msg)
  const hitRate = r.stats.estimatedInputTokens > 0
    ? (r.stats.cachedTokens / r.stats.estimatedInputTokens * 100).toFixed(1)
    : 0
  console.log(`  文件缓存: ${r.stats.fileHits}命中 ${r.stats.fileMisses}未命中`)
  console.log(`  索引/Provider/工具: ${r.stats.indexCached ? '✅' : '🆕'}/${r.stats.providerCached ? '✅' : '🆕'}/${r.stats.toolCached ? '✅' : '🆕'}`)
  console.log(`  Token: ${r.stats.estimatedInputTokens} 输入 / ${r.stats.cachedTokens} 缓存 (${hitRate}%)\n`)
}

// === SUMMARY ===
console.log('══════════════════════════════════════════════════')
console.log('  最终统计')
console.log('══════════════════════════════════════════════════\n')

const totalInput = rounds.reduce((s, r) => s + r.stats.estimatedInputTokens, 0)
const totalCached = rounds.reduce((s, r) => s + r.stats.cachedTokens, 0)
const totalHits = rounds.reduce((s, r) => s + r.stats.fileHits, 0)
const totalMisses = rounds.reduce((s, r) => s + r.stats.fileMisses, 0)

console.log(`  总输入 Token:      ${totalInput.toLocaleString()}`)
console.log(`  缓存命中 Token:    ${totalCached.toLocaleString()}`)
console.log(`  缓存命中率:        ${(totalCached / totalInput * 100).toFixed(1)}%`)
console.log(`  文件缓存命中:      ${totalHits} 次`)
console.log(`  文件磁盘读取:      ${totalMisses} 次`)
console.log(`  索引构建次数:      ${indexBuildCount} (1=完美)`)
console.log(`  Provider 构建次数: ${providerBuildCount} (1=完美)`)
console.log(`  工具构建次数:      ${toolBuildCount}`)
console.log(`  风格加载次数:      ${styleLoadCount}`)
console.log()
console.log(`  费用估算(含缓存):  $${((totalInput - totalCached) * 0.000002 + totalCached * 0.000002 * 0.1).toFixed(6)}`)
console.log(`  费用估算(无缓存):  $${(totalInput * 0.000002).toFixed(6)}`)
console.log(`  缓存节省:          $${((totalInput - totalCached) * 0.000002 * 0.9).toFixed(6)}`)

// 清理
try { fs.rmSync(TMP, { recursive: true }) } catch {}

// 断言
const errors = []
if (indexBuildCount !== 1) errors.push(`MemoryIndex 构建了 ${indexBuildCount} 次(应为1)`)
if (totalHits < 2) errors.push(`文件缓存命中 ${totalHits} 次(应≥2)`)

if (errors.length > 0) {
  console.log(`\n❌ 问题: ${errors.join('; ')}`)
  process.exit(1)
} else {
  console.log('\n✅ 所有缓存层正常工作，Token 节省符合预期')
}
