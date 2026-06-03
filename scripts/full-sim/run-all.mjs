#!/usr/bin/env node
/**
 * 仿真测试编排器
 * 按序运行所有场景测试脚本，汇总结果
 *
 * Usage:
 *   node scripts/full-sim/run-all.mjs                    # 运行全部
 *   node scripts/full-sim/run-all.mjs --scenario=04      # 运行单个
 *   node scripts/full-sim/run-all.mjs --complexity=extreme # 按难度筛选
 *   node scripts/full-sim/run-all.mjs --dry-run            # 列出不运行
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const SCENARIOS = [
  { id:'01-chat',           domain:'闲聊',          complexity:'simple',  desc:'纯对话零工具' },
  { id:'02-file-browse',    domain:'文件浏览',       complexity:'simple',  desc:'列目录+读文件' },
  { id:'03-search',         domain:'内容搜索',       complexity:'simple',  desc:'全文搜索' },
  { id:'04-character',      domain:'角色管理',       complexity:'complex', desc:'创建完整角色卡' },
  { id:'05-outline',        domain:'大纲创作',       complexity:'complex', desc:'读写plot+worldbuilding' },
  { id:'06-outline-tabs',   domain:'大纲Tab',        complexity:'medium',  desc:'items/locations/factions JSON' },
  { id:'07-detailed-outline', domain:'细纲创作',     complexity:'complex', desc:'创建细纲JSON+摘要MD' },
  { id:'08-chapter-writing', domain:'章节创作',      complexity:'complex', desc:'读上下文→生成章节' },
  { id:'09-chapter-polish', domain:'章节润色',       complexity:'medium',  desc:'读→改→diff' },
  { id:'10-style-template',  domain:'风格模板',      complexity:'complex', desc:'26维度文风分析' },
  { id:'11-scene-template',  domain:'场景模板',      complexity:'complex', desc:'场景结构分析' },
  { id:'12-knowledge-base',  domain:'知识库',        complexity:'medium',  desc:'kb CRUD+索引' },
  { id:'13-notes',           domain:'笔记',          complexity:'medium',  desc:'6个笔记工具全覆盖' },
  { id:'14-images',          domain:'图片',          complexity:'medium',  desc:'搜索+生成图片' },
  { id:'15-project',         domain:'项目管理',      complexity:'medium',  desc:'创建+删除项目' },
  { id:'16-batch',           domain:'批量操作',      complexity:'extreme', desc:'多文件批处理' },
  { id:'17-stress',          domain:'极限压测',      complexity:'extreme', desc:'5000字输入+全工具' },
  { id:'18-harness',         domain:'自管理',        complexity:'medium',  desc:'5个harness工具' },
  { id:'19-prompts',         domain:'提示词库',      complexity:'simple',  desc:'list/toggle/update' },
  { id:'20-rename-delete',   domain:'文件操作',      complexity:'medium',  desc:'重命名/删除+恢复' },
]

function usage() {
  console.log(`
仿真测试编排器 — 覆盖全部 38 个 AI 写作助手工具

Usage:
  node scripts/full-sim/run-all.mjs [options]

Options:
  --scenario=<id>      只运行指定场景 (如 --scenario=04-character)
  --complexity=<level> 按难度筛选 (simple/medium/complex/extreme)
  --dry-run            列出所有场景，不实际运行
  --timeout=<ms>       每个脚本超时(ms)，默认 300000 (5分钟)
  --help               显示此帮助

场景列表 (${SCENARIOS.length} 个):
`)
  for (const s of SCENARIOS) {
    const icon = {simple:'🟢', medium:'🟡', complex:'🟠', extreme:'🔴'}[s.complexity]
    const exists = fs.existsSync(path.join(__dirname, `${s.id}.mjs`))
    console.log(`  ${icon} ${s.id}  ${s.domain.padEnd(10)} ${s.complexity.padEnd(8)} ${s.desc} ${exists ? '' : '(缺失)'}`)
  }
  process.exit(0)
}

// ── Parse args ──
const args = process.argv.slice(2)
let filterId = null
let filterComplexity = null
let dryRun = false
let timeout = 300_000

for (const arg of args) {
  if (arg === '--help') usage()
  if (arg === '--dry-run') dryRun = true
  if (arg.startsWith('--scenario=')) filterId = arg.split('=')[1]
  if (arg.startsWith('--complexity=')) filterComplexity = arg.split('=')[1]
  if (arg.startsWith('--timeout=')) timeout = parseInt(arg.split('=')[1]) || 300_000
}

// ── Filter scenarios ──
let toRun = [...SCENARIOS]
if (filterId) {
  toRun = toRun.filter(s => s.id === filterId || s.id.startsWith(filterId) || s.domain.includes(filterId))
  if (toRun.length === 0) { console.error(`未找到场景: ${filterId}`); process.exit(1) }
}
if (filterComplexity) {
  toRun = toRun.filter(s => s.complexity === filterComplexity)
  if (toRun.length === 0) { console.error(`未找到难度: ${filterComplexity}`); process.exit(1) }
}

if (dryRun) {
  console.log(`将运行 ${toRun.length} 个场景 (dry-run):`)
  for (const s of toRun) console.log(`  ${s.id} — ${s.desc}`)
  process.exit(0)
}

// ── Run ──
console.log(`\n═══════════════════════════════════════════════════════════`)
console.log(`  仿真测试编排器 — ${toRun.length} 个场景`)
console.log(`  开始时间: ${new Date().toISOString().replace('T',' ').slice(0,19)}`)
console.log(`═══════════════════════════════════════════════════════════\n`)

const results = []
const startAll = Date.now()

for (const scenario of toRun) {
  const scriptPath = path.join(__dirname, `${scenario.id}.mjs`)
  if (!fs.existsSync(scriptPath)) {
    console.log(`⏭️  跳过 ${scenario.id}: 脚本文件不存在`)
    results.push({ ...scenario, status: 'SKIP', duration: 0, output: 'Script not found' })
    continue
  }

  const icon = {simple:'🟢', medium:'🟡', complex:'🟠', extreme:'🔴'}[scenario.complexity]
  process.stdout.write(`${icon} ${scenario.id} ${scenario.desc.padEnd(30)} `)

  const t0 = Date.now()
  let output = ''

  try {
    await new Promise((resolve, reject) => {
      const child = spawn('node', [scriptPath], {
        cwd: path.resolve(__dirname, '..', '..'),
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout,
      })

      let settled = false
      child.stdout.on('data', chunk => { output += chunk.toString() })
      child.stderr.on('data', chunk => { output += chunk.toString() })

      child.on('close', code => {
        if (settled) return
        settled = true
        const duration = Date.now() - t0
        const status = code === 0 ? 'PASS' : 'FAIL'
        results.push({ ...scenario, status, duration, output: output.slice(-2000) })
        const mark = status === 'PASS' ? '✅' : '❌'
        console.log(`${mark} ${(duration/1000).toFixed(1)}s`)
        resolve()
      })

      child.on('error', err => {
        if (settled) return
        settled = true
        const duration = Date.now() - t0
        results.push({ ...scenario, status: 'ERROR', duration, output: err.message })
        console.log(`💥 ${err.message}`)
        resolve()
      })
    })
  } catch (err) {
    results.push({ ...scenario, status: 'ERROR', duration: Date.now() - t0, output: err.message })
    console.log(`💥 ${err.message}`)
  }
}

// ── Summary ──
const total = results.length
const passed = results.filter(r => r.status === 'PASS').length
const failed = results.filter(r => r.status === 'FAIL').length
const errors = results.filter(r => r.status === 'ERROR').length
const skipped = results.filter(r => r.status === 'SKIP').length
const totalDuration = Date.now() - startAll

console.log(`\n═══════════════════════════════════════════════════════════`)
console.log(`  结果汇总`)
console.log(`═══════════════════════════════════════════════════════════`)
console.log(`  总计: ${total}  通过: ${passed} ✅  失败: ${failed} ❌  错误: ${errors} 💥  跳过: ${skipped} ⏭️`)
console.log(`  总耗时: ${(totalDuration/1000).toFixed(1)}s`)
console.log(`  结束时间: ${new Date().toISOString().replace('T',' ').slice(0,19)}`)
console.log(`═══════════════════════════════════════════════════════════\n`)

// Detail table
console.log('详细结果:')
console.log('─'.repeat(80))
for (const r of results) {
  const icon = r.status === 'PASS' ? '✅' : r.status === 'FAIL' ? '❌' : r.status === 'SKIP' ? '⏭️' : '💥'
  const dur = r.duration > 0 ? `${(r.duration/1000).toFixed(1)}s` : 'N/A'
  console.log(`${icon} ${r.id.padEnd(22)} ${r.domain.padEnd(10)} ${r.complexity.padEnd(8)} ${dur.padEnd(8)} ${r.desc}`)
}

// Show failures
const failures = results.filter(r => r.status === 'FAIL' || r.status === 'ERROR')
if (failures.length > 0) {
  console.log(`\n失败详情:`)
  for (const f of failures) {
    console.log(`\n── ${f.id} ${f.desc} ──`)
    console.log(f.output.slice(-1500))
  }
}

process.exit(failed + errors > 0 ? 1 : 0)
