#!/usr/bin/env tsx
/**
 * Export tool schemas to JSON for CLI agent consumption.
 *
 * v14.8: 重写 — 从真实注册表 src/agent/skills/tools/index.ts 的 ALL_TOOLS 导入生成，
 * 替代原 .mjs 的静态 36 工具表（含已删除工具、缺新工具，内容长期漂移）。
 * 前置条件：subagentTools.ts 已惰性化（顶层不再 import SubagentService → @/store 链，
 * 否则 Node 环境 zustand persist 无 localStorage 会挂起）。
 *
 * Usage:
 *   npx tsx scripts/export-tool-schemas.ts           (write scripts/tool-schemas.json)
 *   npx tsx scripts/export-tool-schemas.ts --check   (verify sync — 名称集合 + 排序深比较，只读)
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ALL_TOOLS } from '../src/agent/skills/tools/index'

const APP_ROOT = join(__dirname, '..')
const OUT_PATH = join(APP_ROOT, 'scripts', 'tool-schemas.json')

interface ToolEntry {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
  }
}

/** 从真实注册表生成最终形态 */
function generateSchemas(): ToolEntry[] {
  return ALL_TOOLS.map(t => ({
    type: 'function',
    function: {
      name: t.schema.name,
      description: t.schema.description,
      parameters: t.schema.parameters,
    },
  }))
}

/** 递归排序对象键（--check 时容忍键序差异，只比较内容） */
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(value as Record<string, unknown>).sort()) out[k] = normalize((value as Record<string, unknown>)[k])
    return out
  }
  return value
}

function sortedByName(entries: ToolEntry[]): ToolEntry[] {
  return [...entries].sort((a, b) => a.function.name.localeCompare(b.function.name))
}

// ── Main ──

async function main() {
  const args = process.argv.slice(2)
  const canonical = generateSchemas()

  if (args.includes('--check')) {
    try {
      const existing = JSON.parse(await readFile(OUT_PATH, 'utf-8')) as ToolEntry[]
      const existingNames = new Set(existing.map(t => t.function.name))
      const canonicalNames = new Set(canonical.map(t => t.function.name))
      // 1) 名称集合比对（缺失/多余/顺序都报出来）
      // v16.3.1(审计 S9): Set.difference 需 ES2024 lib——用兼容写法（tsconfig.cli.json lib 保持 ES2022）
      const missing = new Set([...canonicalNames].filter(n => !existingNames.has(n)))
      const extra = new Set([...existingNames].filter(n => !canonicalNames.has(n)))
      if (missing.size > 0 || extra.size > 0) {
        console.error(`MISMATCH names: 缺失 ${[...missing].join(',') || '无'} | 多余 ${[...extra].join(',') || '无'}`)
        process.exit(1)
      }
      // 2) 内容深比较（排序后 + 键序归一化）
      const a = JSON.stringify(sortedByName(canonical).map(normalize))
      const b = JSON.stringify(sortedByName(existing).map(normalize))
      if (a !== b) {
        console.error('MISMATCH content: 工具描述/参数与注册表不一致。运行: npx tsx scripts/export-tool-schemas.ts')
        process.exit(1)
      }
      console.log(`OK: ${canonical.length} tools in sync (names + content)`)
      process.exit(0)
    } catch (err) {
      console.error('Check failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  }

  // Write schemas to file
  await writeFile(OUT_PATH, JSON.stringify(canonical, null, 2), 'utf-8')
  console.error(`Wrote ${canonical.length} tool schemas to ${OUT_PATH}`)
  console.log(JSON.stringify(canonical, null, 2))
}

main()
  .then(() => {
    // v14.8: 显式退出 — 防 Node 句柄（如 netFetch 的 Chromium 依赖）残留导致挂起
    process.exit(0)
  })
  .catch(err => { console.error(err.message); process.exit(1) })
