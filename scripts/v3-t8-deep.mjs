/**
 * T8 深度诊断 — 逐轮追踪每个工具调用
 */
import { V4UnifiedRuntime } from '../src/agent/runtime/V4UnifiedRuntime.js'
import { OpenAIAdapter } from '../src/agent/runtime/adapters/OpenAIAdapter.js'
import { toolRegistry } from '../src/agent/skills/ToolRegistry.js'
import { ALL_TOOLS } from '../src/agent/skills/tools/index.js'
import { buildSystemPrompt } from '../src/agent/V4SystemPrompt.js'
import { BridgeContextBuilder } from '../src/agent/context/BridgeContextBuilder.js'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dir, '..')
const PROJECTS = path.join(ROOT, 'projects')
const TEST_PROJ = '_v3_t8'
const TEST_DIR = path.join(PROJECTS, TEST_PROJ)
const API_KEY = 'sk-c9c30831df7243209435c60e811c879d'

function setup() {
  fs.rmSync(TEST_DIR, { recursive: true, force: true })
  fs.mkdirSync(TEST_DIR, { recursive: true })
  for (const d of ['outline', 'characters', 'chapters', 'detailed_outline', 'summaries'])
    fs.mkdirSync(path.join(TEST_DIR, d), { recursive: true })
  fs.writeFileSync(path.join(TEST_DIR, 'project.json'), JSON.stringify({ type: 'writing', novelCategory: 'xianxia' }))
  fs.writeFileSync(path.join(TEST_DIR, 'outline', 'plot.md'), '# 故事剧情\n\n> 少年剑修林逸，在宗门大比中意外觉醒上古剑魂，从此命运改变。\n\n## 第1章·觉醒\n\n待填充\n', 'utf-8')
  fs.writeFileSync(path.join(TEST_DIR, 'outline', 'worldbuilding.md'), '# 世界观\n\n> 修仙架空·九境修炼体系\n\n## 一、核心规则\n\n灵力体系，九境等级\n', 'utf-8')
}

toolRegistry.registerAll(ALL_TOOLS)

const adapter = new OpenAIAdapter({
  chatWithTools: async (messages, configId, projectId, tools) => {
    const body = { model: 'deepseek-v4-flash', messages, tools: tools?.length > 0 ? tools : undefined, tool_choice: 'auto', max_tokens: 1500, temperature: 0.3 }
    const r = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
      body: JSON.stringify(body),
    })
    const d = await r.json()
    const msg = d.choices?.[0]?.message
    return { text: msg?.content || '', toolCalls: (msg?.tool_calls || []).map(tc => ({ id: tc.id, name: tc.function.name, arguments: tc.function.arguments })), finishReason: d.choices?.[0]?.finish_reason || 'stop', usage: { prompt_tokens: d.usage?.prompt_tokens || 0, completion_tokens: d.usage?.completion_tokens || 0, total_tokens: d.usage?.total_tokens || 0 } }
  },
  abortStream: () => {},
})

function rp(fp) {
  const clean = String(fp).replace(/\\/g, '/').replace(/^\/+/, '')
  if (clean.startsWith('../')) {
    // ../ from project dir goes to projects/, ../ again goes to app root
    // Simulate real app: projectPath = projects/, and model uses {project}/ prefix
    let base = path.dirname(TEST_DIR) // → projects/
    let c = clean
    while (c.startsWith('../')) { c = c.slice(3); base = path.dirname(base) }
    return path.join(base, c)
  }
  for (const pfx of [TEST_PROJ + '/', '项目' + TEST_PROJ + '/']) { if (clean.startsWith(pfx)) return path.join(TEST_DIR, clean.slice(pfx.length)) }
  return path.join(TEST_DIR, clean)
}

let roundNum = 0

async function run(msg) {
  const abort = new AbortController()
  const runtime = new V4UnifiedRuntime({ configId: 'test', projectId: TEST_PROJ, maxIterations: 12, abortSignal: abort.signal, contextWindow: 128000 }, adapter)
  const CORE_PROMPT = buildSystemPrompt()
  const contextBuilder = new BridgeContextBuilder({ projectId: TEST_PROJ, kbEnabled: false, webSearchEnabled: false })
  runtime.setContextAssembler(async (m, hist, pid) => await contextBuilder.buildContext(m, hist, pid, CORE_PROMPT, true))

  let toolLog = []

  runtime.setToolExecutor(async (args, ctx) => {
    const tn = ctx.toolName; const id = ctx.callId
    roundNum++
    const raw = args.file_path || args.dir_path || ''
    const resolved = rp(raw)

    let result
    if (tn === 'read_file') {
      try { const c = fs.readFileSync(resolved, 'utf-8'); result = { callId: id, toolName: tn, status: 'success', summary: `${c.length}字` } }
      catch { result = { callId: id, toolName: tn, status: 'error', summary: '不存在' } }
    } else if (tn === 'create_file') {
      try { fs.accessSync(resolved); result = { callId: id, toolName: tn, status: 'error', summary: '已存在' } } catch {}
      if (!result) { fs.mkdirSync(path.dirname(resolved), { recursive: true }); fs.writeFileSync(resolved, String(args.content||''), 'utf-8'); result = { callId: id, toolName: tn, status: 'success', summary: `已创建(${String(args.content||'').length}字)` } }
    } else if (tn === 'edit_file') {
      try {
        const c = fs.readFileSync(resolved, 'utf-8'); const o = String(args.old_string||''); const n = String(args.new_string||'')
        if (o === '__FULL_REPLACE__') { fs.writeFileSync(resolved, n, 'utf-8'); result = { callId: id, toolName: tn, status: 'success', summary: 'FULL_REPLACE' } }
        else if (!c.includes(o)) result = { callId: id, toolName: tn, status: 'error', summary: '不匹配' }
        else { fs.writeFileSync(resolved, c.replace(o, n), 'utf-8'); result = { callId: id, toolName: tn, status: 'success', summary: '已修改' } }
      } catch { result = { callId: id, toolName: tn, status: 'error', summary: '失败' } }
    } else if (tn === 'list_directory') {
      try { const e = fs.readdirSync(resolved, { withFileTypes: true }); result = { callId: id, toolName: tn, status: 'success', summary: `${e.length}项` } }
      catch { result = { callId: id, toolName: tn, status: 'error', summary: '不存在' } }
    } else {
      result = { callId: id, toolName: tn, status: 'error', summary: `未知:${tn}` }
    }

    console.log(`  [轮${roundNum}] ${tn} "${raw}" → ${result.status==='success'?result.summary:'❌'+result.summary} (${resolved.slice(-40)})`)
    toolLog.push({ round: roundNum, tool: tn, path: raw, resolved, status: result.status, summary: result.summary })
    return result
  })

  const core = new Set(['read_file','create_file','edit_file','delete_file','list_directory','search_content','tool_search'])
  runtime.setTools(toolRegistry.getAllSchemas().filter(s => core.has(s.function.name)))

  const start = Date.now()
  const result = await runtime.run({ userMessage: `[当前项目: ${TEST_PROJ}] ${msg}`, attachments: [] })
  abort.abort()

  const allTools = result.toolCallSteps?.map(s => s.tool) || []
  const writes = toolLog.filter(t => t.tool === 'create_file' || t.tool === 'edit_file')
  const reads = toolLog.filter(t => t.tool === 'read_file')
  const lists = toolLog.filter(t => t.tool === 'list_directory')

  // Check output
  let fileCreated = false, wordCount = 0
  try {
    const files = fs.readdirSync(path.join(TEST_DIR, 'chapters'))
    if (files.length > 0) {
      const c = fs.readFileSync(path.join(TEST_DIR, 'chapters', files[0]), 'utf-8')
      wordCount = c.length; fileCreated = true
    }
  } catch {}

  console.log(`\n  📊 总轮:${result.iterationCount} | 总读:${reads.length} | 列目录:${lists.length} | 写:${writes.length} | tok:${result.totalTokens}`)
  console.log(`  📁 文件: ${fileCreated ? `✅ ${wordCount}字` : '❌ 未创建'}`)

  return { fileCreated, wordCount, reads: reads.length, lists: lists.length, writes: writes.length, rounds: result.iterationCount, tokens: result.totalTokens }
}

async function main() {
  console.log('═══════════════════════════════════════')
  console.log(' T8 深度诊断')
  console.log('═══════════════════════════════════════')

  // Run T8 three times to compare
  for (let i = 1; i <= 3; i++) {
    roundNum = 0
    setup()
    console.log(`\n━━━ 第${i}次运行 T8 ━━━`)
    const r = await run('帮我在项目中写第1章正文。主角林逸是剑修，在宗门大比中觉醒剑魂。200字左右。保存到 chapters/chapter1.txt。')
    console.log(`  结果: ${r.fileCreated?'✅':'❌'} | 读:${r.reads} 列:${r.lists} 写:${r.writes} | ${r.rounds}轮 ${r.tokens}tok`)
  }
}

main().catch(e => { console.error(e.message); process.exit(1) })
