import { IpcMain, app } from 'electron'
import * as fs from 'fs/promises'
import * as path from 'path'

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
  } catch { /* non-critical */ }
}

interface GetUsageOptions {
  projectId?: string
  year?: number
  month?: number
  day?: number
  configId?: string
  model?: string
}

export function registerStatsHandlers(ipcMain: IpcMain) {
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
}

function emptyResult() {
  return { entries: [], totalCount: 0, totals: { input: 0, output: 0, cacheHit: 0, cost: 0, count: 0 }, byDay: [], byConfig: [], byModel: [] }
}
