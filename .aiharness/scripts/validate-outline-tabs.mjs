#!/usr/bin/env node
/**
 * 验证大纲 Tab 文件 — 检查存在性 + JSON 有效性 + 非空
 * 用法: node validate-outline-tabs.mjs <projectRoot>
 * 输出: JSON { status: "pass"|"fail", checks: [...], failedCount: N }
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const projectRoot = resolve(process.argv[2] || process.cwd())
const outlineDir = join(projectRoot, 'outline')

const EXPECTED_TABS = [
  { file: 'items.yaml', label: '道具列表' },
  { file: 'locations.yaml', label: '地点列表' },
  { file: 'factions.yaml', label: '势力列表' },
  { file: 'power_system.yaml', label: '等级体系' },
  { file: 'outline_meta.yaml', label: '伏笔+故事线' },
  { file: 'emotion.yaml', label: '情绪曲线' },
]
const PLOT_MD = 'plot.md'

const checks = []

try {
  for (const tab of EXPECTED_TABS) {
    const fp = join(outlineDir, tab.file)
    if (!existsSync(fp)) {
      checks.push({ file: `outline/${tab.file}`, check: 'exists', passed: false, reason: '文件不存在' })
      continue
    }
    try {
      const raw = readFileSync(fp, 'utf-8').trim()
      if (!raw || raw === '{}') {
        checks.push({ file: `outline/${tab.file}`, check: 'non_empty', passed: false, reason: '文件为空' })
        continue
      }
      JSON.parse(raw)
      checks.push({ file: `outline/${tab.file}`, check: 'valid_json_and_non_empty', passed: true })
    } catch (e) {
      checks.push({ file: `outline/${tab.file}`, check: 'valid_json', passed: false, reason: e.message })
    }
  }

  // Check plot.md
  const plotPath = join(outlineDir, PLOT_MD)
  if (existsSync(plotPath)) {
    const plotContent = readFileSync(plotPath, 'utf-8').trim()
    checks.push({
      file: `outline/${PLOT_MD}`,
      check: 'has_content',
      passed: plotContent.length > 50,
      reason: plotContent.length > 50 ? undefined : `内容仅${plotContent.length}字`,
    })
  } else {
    checks.push({ file: `outline/${PLOT_MD}`, check: 'exists', passed: false, reason: '文件不存在' })
  }
} catch (e) {
  checks.push({ file: 'outline/', check: 'directory_accessible', passed: false, reason: e.message })
}

const failedCount = checks.filter(c => !c.passed).length
console.log(JSON.stringify({ status: failedCount === 0 ? 'pass' : 'fail', checks, failedCount }))
