import { IpcMain, app } from 'electron'
import * as fs from 'fs/promises'
import * as path from 'path'
import { join } from 'path'

interface TokenUsageEntry {
  timestamp: string
  projectId: string
  configId: string
  configName: string
  model: string
  inputTokens: number
  outputTokens: number
  cacheHitTokens: number
  cost: number
}

interface ModelPrice {
  modelId: string
  modelName: string
  inputPricePerM: number
  cacheHitPricePerM: number
  outputPricePerM: number
}

let statsBasePath = ''

export function getStatsPath(): string {
  if (!statsBasePath) {
    statsBasePath = path.join(app.getPath('userData'), 'stats')
  }
  return statsBasePath
}

async function ensureStatsDir() {
  await fs.mkdir(getStatsPath(), { recursive: true })
}

export async function logTokenUsage(entry: TokenUsageEntry) {
  try {
    await ensureStatsDir()
    const logPath = path.join(getStatsPath(), 'usage.jsonl')
    await fs.appendFile(logPath, JSON.stringify(entry) + '\n', 'utf-8')
    // Debug: verify write succeeded by checking file size
    try {
      const stat = await fs.stat(logPath)
      if (stat.size === 0) console.warn(`[stats] WARNING: usage.jsonl is empty after append`)
    } catch {}
  } catch (err) {
    console.error(`[stats] logTokenUsage primary failed (path: ${getStatsPath()}):`, err)
    // Fallback: write to app root so we can debug
    try {
      const fallbackPath = path.join(app.getAppPath(), 'stats-fallback.jsonl')
      await fs.appendFile(fallbackPath, JSON.stringify(entry) + '\n', 'utf-8')
      console.log(`[stats] Fallback written to ${fallbackPath}`)
    } catch (err2) {
      console.error(`[stats] Fallback also failed:`, err2)
    }
  }
}

// Get current month's total cost for budget check
export async function getCurrentMonthCost(): Promise<number> {
  try {
    const logPath = path.join(getStatsPath(), 'usage.jsonl')
    let content = ''
    try { content = await fs.readFile(logPath, 'utf-8') } catch { return 0 }

    const now = new Date()
    const year = now.getFullYear()
    const month = now.getMonth() + 1

    let total = 0
    for (const line of content.split('\n')) {
      if (!line) continue
      try {
        const entry: TokenUsageEntry = JSON.parse(line)
        const d = new Date(entry.timestamp)
        if (d.getFullYear() === year && d.getMonth() + 1 === month) {
          total += entry.cost || 0
        }
      } catch { /* skip malformed */ }
    }
    return total
  } catch {
    return 0
  }
}

interface GetUsageOptions {
  projectId?: string
  year?: number
  month?: number
  day?: number
  configId?: string
  model?: string
}

export function registerStatsHandlers(ipcMain: IpcMain, projectsPath?: string) {
  ipcMain.handle('stats:getUsage', async (_event, opts: GetUsageOptions = {}) => {
    try {
      const logPath = path.join(getStatsPath(), 'usage.jsonl')
      let content = ''
      try { content = await fs.readFile(logPath, 'utf-8') } catch { return emptyResult() }

      const entries: (TokenUsageEntry & { _line: number })[] = content.split('\n').filter(Boolean).reduce<(TokenUsageEntry & { _line: number })[]>((acc, line, idx) => {
        try { acc.push({ ...JSON.parse(line), _line: idx + 1 }) } catch { /* skip malformed lines */ }
        return acc
      }, [])

      // Filters
      let filtered = entries
      if (opts.projectId) filtered = filtered.filter(e => e.projectId === opts.projectId)
      if (opts.configId) filtered = filtered.filter(e => e.configId === opts.configId)
      if (opts.model) filtered = filtered.filter(e => e.model === opts.model)
      if (opts.year) filtered = filtered.filter(e => {
        const d = new Date(e.timestamp)
        if (d.getFullYear() !== opts.year) return false
        if (opts.month !== undefined && d.getMonth() + 1 !== opts.month) return false
        if (opts.day !== undefined && d.getDate() !== opts.day) return false
        return true
      })

      const totalCount = filtered.length

      // Totals
      const totals = filtered.reduce((acc, e) => ({
        input: acc.input + e.inputTokens,
        output: acc.output + e.outputTokens,
        cacheHit: acc.cacheHit + (e.cacheHitTokens || 0),
        cost: acc.cost + (e.cost || 0),
        count: acc.count + 1,
      }), { input: 0, output: 0, cacheHit: 0, cost: 0, count: 0 })

      // By day grouping
      const byDayMap = new Map<string, { input: number; output: number; cacheHit: number; cost: number; count: number }>()
      for (const e of filtered) {
        const day = e.timestamp.split('T')[0]
        const g = byDayMap.get(day) || { input: 0, output: 0, cacheHit: 0, cost: 0, count: 0 }
        g.input += e.inputTokens
        g.output += e.outputTokens
        g.cacheHit += e.cacheHitTokens || 0
        g.cost += e.cost || 0
        g.count++
        byDayMap.set(day, g)
      }
      const byDay = [...byDayMap.entries()].map(([date, d]) => ({ date, ...d })).sort((a, b) => b.date.localeCompare(a.date))

      // By config grouping
      const byConfigMap = new Map<string, { configName: string; model: string; input: number; output: number; cacheHit: number; cost: number; count: number }>()
      for (const e of filtered) {
        const g = byConfigMap.get(e.configId) || { configName: e.configName, model: e.model, input: 0, output: 0, cacheHit: 0, cost: 0, count: 0 }
        g.input += e.inputTokens
        g.output += e.outputTokens
        g.cacheHit += e.cacheHitTokens || 0
        g.cost += e.cost || 0
        g.count++
        byConfigMap.set(e.configId, g)
      }
      const byConfig = [...byConfigMap.entries()].map(([configId, d]) => ({ configId, ...d })).sort((a, b) => b.cost - a.cost)

      // By model grouping
      const byModelMap = new Map<string, { input: number; output: number; cacheHit: number; cost: number; count: number }>()
      for (const e of filtered) {
        const g = byModelMap.get(e.model) || { input: 0, output: 0, cacheHit: 0, cost: 0, count: 0 }
        g.input += e.inputTokens
        g.output += e.outputTokens
        g.cacheHit += e.cacheHitTokens || 0
        g.cost += e.cost || 0
        g.count++
        byModelMap.set(e.model, g)
      }
      const byModel = [...byModelMap.entries()].map(([model, d]) => ({ model, ...d })).sort((a, b) => b.cost - a.cost)

      return {
        entries: filtered.slice(-500).reverse(),
        totalCount,
        totals,
        byDay,
        byConfig,
        byModel,
      }
    } catch {
      return emptyResult()
    }
  })

  ipcMain.handle('stats:getPrices', async () => {
    try {
      const raw = await fs.readFile(path.join(getStatsPath(), 'prices.json'), 'utf-8')
      return JSON.parse(raw)
    } catch {
      return [
        { modelId: 'gpt-4o', modelName: 'gpt-4o', inputPricePerM: 2.50, cacheHitPricePerM: 1.25, outputPricePerM: 10.00 },
        { modelId: 'deepseek-v3', modelName: 'deepseek-v3', inputPricePerM: 0.27, cacheHitPricePerM: 0.07, outputPricePerM: 1.10 },
      ]
    }
  })

  ipcMain.handle('stats:savePrices', async (_event, prices: ModelPrice[]) => {
    await ensureStatsDir()
    await fs.writeFile(path.join(getStatsPath(), 'prices.json'), JSON.stringify(prices, null, 2), 'utf-8')
  })

  ipcMain.handle('stats:deleteByLine', async (_event, lineNumber: number) => {
    const logPath = path.join(getStatsPath(), 'usage.jsonl')
    let content = ''
    try { content = await fs.readFile(logPath, 'utf-8') } catch { return }
    const lines = content.split('\n')
    if (lineNumber < 1 || lineNumber > lines.length) return
    lines.splice(lineNumber - 1, 1)
    await fs.writeFile(logPath, lines.join('\n'), 'utf-8')
  })

  ipcMain.handle('stats:getMonthCost', async () => {
    return await getCurrentMonthCost()
  })

  ipcMain.handle('stats:getSessionStats', async () => {
    return await readSessionStats(projectsPath)
  })

  ipcMain.handle('stats:reset', async () => {
    try {
      const logPath = path.join(getStatsPath(), 'usage.jsonl')
      await fs.writeFile(logPath, '', 'utf-8')
      return { status: 'success', summary: 'Token 统计数据已清空' }
    } catch (e) {
      return { status: 'error', summary: `清除失败: ${e instanceof Error ? e.message : '未知错误'}` }
    }
  })
}

function emptyResult() {
  return { entries: [], totalCount: 0, totals: { input: 0, output: 0, cacheHit: 0, cost: 0, count: 0 }, byDay: [], byConfig: [], byModel: [] }
}

// ── Session Statistics Types ──

interface AuditEvent {
  timestamp: number
  sessionId: string
  event: string
  data: Record<string, unknown>
}

export interface SessionStatEntry {
  sessionId: string
  startedAt: string        // ISO timestamp
  duration: number         // seconds
  apiCallCount: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  toolCalls: Array<{ toolName: string; count: number; lastUsed: string }>
  operations: string[]     // human-readable operation descriptions
  errorCount: number
}

export interface SessionStatsResult {
  sessions: SessionStatEntry[]
  totalSessions: number
  totals: {
    apiCalls: number
    promptTokens: number
    completionTokens: number
    totalTokens: number
    toolCalls: number
  }
}

// ── Session Stats Helper ──

async function getAuditBasePath(projectsPath?: string): Promise<string> {
  if (projectsPath) return join(projectsPath, '..', '.aiharness', 'audit')
  // Fallback: use app.getPath('userData')
  return join(app.getPath('userData'), '.aiharness', 'audit')
}

async function readSessionStats(projectsPath?: string): Promise<SessionStatsResult> {
  const empty: SessionStatsResult = {
    sessions: [],
    totalSessions: 0,
    totals: { apiCalls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, toolCalls: 0 },
  }

  const auditPath = await getAuditBasePath(projectsPath)

  let files: string[]
  try {
    files = await fs.readdir(auditPath)
  } catch {
    return empty  // no audit directory yet
  }

  const jsonlFiles = files.filter(f => f.endsWith('.jsonl')).sort()
  const sessions: SessionStatEntry[] = []

  for (const file of jsonlFiles) {
    let content: string
    try {
      content = await fs.readFile(join(auditPath, file), 'utf-8')
    } catch {
      continue
    }

    const lines = content.split('\n').filter(Boolean)
    if (lines.length === 0) continue

    const sessionId = file.replace('.jsonl', '')
    let startedAt = ''
    let lastTimestamp = 0
    let apiCallCount = 0
    let promptTokens = 0
    let completionTokens = 0
    const toolCallMap = new Map<string, { count: number; lastTimestamp: number }>()
    const operations: string[] = []
    let errorCount = 0

    for (const line of lines) {
      let ev: AuditEvent
      try { ev = JSON.parse(line) } catch { continue }

      if (ev.event === 'session:start') {
        startedAt = new Date(ev.timestamp).toISOString()
        lastTimestamp = ev.timestamp
      }

      if (ev.event === 'api:call') {
        apiCallCount++
        const pt = Number(ev.data.promptTokens) || 0
        const ct = Number(ev.data.completionTokens) || 0
        promptTokens += pt
        completionTokens += ct
        lastTimestamp = Math.max(lastTimestamp, ev.timestamp)
      }

      if (ev.event === 'tool:call') {
        const tn = String(ev.data.toolName || 'unknown')
        const existing = toolCallMap.get(tn)
        if (existing) {
          existing.count++
          existing.lastTimestamp = Math.max(existing.lastTimestamp, ev.timestamp)
        } else {
          toolCallMap.set(tn, { count: 1, lastTimestamp: ev.timestamp })
        }
        lastTimestamp = Math.max(lastTimestamp, ev.timestamp)

        // Generate operation description from tool + args
        const args = ev.data.args as Record<string, unknown> | undefined
        const opDesc = describeOperation(tn, args)
        if (opDesc && !operations.includes(opDesc)) {
          operations.push(opDesc)
        }
      }

      if (ev.event === 'error') {
        errorCount++
      }
    }

    if (!startedAt) continue  // skip sessions without start marker

    const duration = lastTimestamp > 0
      ? Math.round((lastTimestamp - new Date(startedAt).getTime()) / 1000)
      : 0

    const toolCalls = [...toolCallMap.entries()]
      .map(([toolName, { count, lastTimestamp: ts }]) => ({
        toolName,
        count,
        lastUsed: new Date(ts).toISOString(),
      }))
      .sort((a, b) => b.count - a.count)

    const totalTokens = promptTokens + completionTokens

    sessions.push({
      sessionId: sessionId.slice(0, 16),
      startedAt,
      duration,
      apiCallCount,
      promptTokens,
      completionTokens,
      totalTokens,
      toolCalls,
      operations: operations.slice(0, 10),  // cap at 10 for readability
      errorCount,
    })
  }

  // Sort by start time descending (newest first)
  sessions.sort((a, b) => b.startedAt.localeCompare(a.startedAt))

  const totals = sessions.reduce((acc, s) => ({
    apiCalls: acc.apiCalls + s.apiCallCount,
    promptTokens: acc.promptTokens + s.promptTokens,
    completionTokens: acc.completionTokens + s.completionTokens,
    totalTokens: acc.totalTokens + s.totalTokens,
    toolCalls: acc.toolCalls + s.toolCalls.reduce((sum, t) => sum + t.count, 0),
  }), { apiCalls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, toolCalls: 0 })

  return {
    sessions,
    totalSessions: sessions.length,
    totals,
  }
}

/** Generate a human-readable operation description from tool name + args */
function describeOperation(toolName: string, args?: Record<string, unknown>): string {
  const fp = args ? String(args.file_path || args.path || '') : ''
  const keyword = args ? String(args.keyword || args.pattern || '') : ''

  switch (toolName) {
    case 'read_file': return fp ? `读取 ${shortPath(fp)}` : '读取文件'
    case 'create_file': return fp ? `创建 ${shortPath(fp)}` : '创建文件'
    case 'edit_file': return fp ? `编辑 ${shortPath(fp)}` : '编辑文件'
    case 'delete_file': return fp ? `删除 ${shortPath(fp)}` : '删除文件'
    case 'rename_file': return fp ? `重命名 ${shortPath(fp)}` : '重命名文件'
    case 'list_directory': return fp ? `列出 ${shortPath(fp)}` : '列出目录'
    case 'search_files': return keyword ? `搜索文件: ${keyword}` : '搜索文件'
    case 'search_content': return keyword ? `搜索内容: ${keyword}` : '搜索内容'
    case 'kb_list': return '列出知识库'
    case 'kb_create_file': return '创建知识库条目'
    case 'kb_index_file': return '索引知识库'
    case 'kb_append_file': return '追加知识库'
    case 'list_notes': return '列出笔记'
    case 'read_note': return '读取笔记'
    case 'write_note': return '写笔记'
    case 'append_note': return '追加笔记'
    case 'delete_note': return '删除笔记'
    case 'create_style_template': return '创建风格模板'
    case 'create_scene_template': return '创建场景模板'
    case 'shell_exec': return '执行命令'
    case 'browser_search': return '浏览器搜索'
    case 'http_get': return 'HTTP请求'
    default: return toolName
  }
}

function shortPath(fp: string): string {
  // Show just the last 2 segments
  const parts = fp.replace(/\\/g, '/').split('/')
  return parts.slice(-2).join('/')
}
