/**
 * 硬数据对比：读模板 vs 不读模板
 * 同一场景，分别用两套 Prompt 测试
 */
import { V4UnifiedRuntime } from '../src/agent/runtime/V4UnifiedRuntime.js'
import { OpenAIAdapter } from '../src/agent/runtime/adapters/OpenAIAdapter.js'
import { toolRegistry } from '../src/agent/skills/ToolRegistry.js'
import { ALL_TOOLS } from '../src/agent/skills/tools/index.js'
import { BridgeContextBuilder } from '../src/agent/context/BridgeContextBuilder.js'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dir, '..')
const PROJECTS = path.join(ROOT, 'projects')
const API_KEY = 'sk-c9c30831df7243209435c60e811c879d'

// ── 带字段的 Prompt（当前 v3）──
const WITH_FIELDS = `你是青剑，小说创作助手。

## 路径速查
outline/items.yaml  — 道具（YAML，items[].id/name/type/grade/ability/owner/description）
outline/factions.yaml — 势力（YAML，factions[].id/name/description/type）
characters/ — 角色卡（YAML，id/name/role/gender/age/occupation/background/appearance/personality/abilities/weaknesses/relationships/relationshipTags/arc/importance）

## 文件操作指南
创建新文件 → 直接 create_file
修改已有文件(YAML) → edit_file(old_string="__FULL_REPLACE__", new_string=全文)

## 核心原则
用户说"填充/添加/设置"→直接操作文件。不要犹豫。`

// ── 不带字段的 Prompt（旧版，需要读模板）──
const WITHOUT_FIELDS = `你是青剑，小说创作助手。

## 路径速查
outline/items.yaml  — 道具列表
outline/factions.yaml — 势力列表
characters/ — 角色卡片

## 文件操作指南
创建新文件 → 直接 create_file
修改已有文件 → 先 read_file 确认，再 edit_file
**操作前必须先 read_file 对应的格式模板查看字段结构**。模板在 ../.aiharness/templates/ 下。
- items.yaml → 先读 outline-items.yaml 模板
- factions.yaml → 先读 outline-factions.yaml 模板
- 角色卡 → 先读 character.yaml 模板

## 核心原则
用户说"填充/添加/设置"→先读模板看格式→再操作文件。`

async function test(prompt, label, userMsg) {
  const PROJ = '_cmp_' + label.replace(/\s/g,'_')
  const DIR = path.join(PROJECTS, PROJ)
  fs.rmSync(DIR, { recursive: true, force: true })
  fs.mkdirSync(path.join(DIR, 'outline'), { recursive: true })
  fs.mkdirSync(path.join(DIR, 'characters'), { recursive: true })
  fs.writeFileSync(path.join(DIR, 'outline', 'items.yaml'), 'items: []', 'utf-8')
  fs.writeFileSync(path.join(DIR, 'outline', 'factions.yaml'), 'factions: []', 'utf-8')
  fs.writeFileSync(path.join(DIR, 'project.json'), JSON.stringify({ type: 'writing' }))

  // Also create templates so the model CAN read them
  const tplDir = path.join(ROOT, '.aiharness', 'templates')
  // templates already exist in real app, just reference them

  function rp(fp) {
    const clean = String(fp).replace(/\\/g, '/').replace(/^\/+/, '')
    if (clean.startsWith('../')) { let b = path.join(ROOT, 'projects', PROJ); let c = clean; while (c.startsWith('../')) { c = c.slice(3); b = path.dirname(b) }; return path.join(b, c) }
    for (const pfx of [PROJ + '/', '项目' + PROJ + '/']) { if (clean.startsWith(pfx)) return path.join(DIR, clean.slice(pfx.length)) }
    return path.join(DIR, clean)
  }

  const adapter = new OpenAIAdapter({
    chatWithTools: async (messages, configId, projectId, tools) => {
      const body = { model: 'deepseek-v4-flash', messages, tools: tools?.length > 0 ? tools : undefined, tool_choice: 'auto', max_tokens: 1500, temperature: 0.3 }
      const r = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
        body: JSON.stringify(body),
      })
      const d = await r.json()
      const msg = d.choices?.[0]?.message
      return { text: msg?.content || '', toolCalls: (msg?.tool_calls || []).map(tc => ({ id: tc.id, name: tc.function.name, arguments: tc.function.arguments })), finishReason: d.choices?.[0]?.finish_reason || 'stop', usage: { total_tokens: d.usage?.total_tokens || 0 } }
    },
    abortStream: () => {},
  })

  const abort = new AbortController()
  const runtime = new V4UnifiedRuntime({ configId: 'test', projectId: PROJ, maxIterations: 10, abortSignal: abort.signal, contextWindow: 128000 }, adapter)
  const contextBuilder = new BridgeContextBuilder({ projectId: PROJ, kbEnabled: false, webSearchEnabled: false })
  runtime.setContextAssembler(async (msg, hist, pid) => await contextBuilder.buildContext(msg, hist, pid, prompt, true))
  runtime.setToolExecutor(async (args, ctx) => {
    const tn = ctx.toolName; const id = ctx.callId
    if (tn === 'read_file') { try { const c = fs.readFileSync(rp(args.file_path), 'utf-8'); return { callId: id, toolName: tn, status: 'success', summary: `${c.length}字` } } catch { return { callId: id, toolName: tn, status: 'error', summary: '不存在' } } }
    if (tn === 'edit_file') { try { const c = fs.readFileSync(rp(args.file_path), 'utf-8'); const o = String(args.old_string||''); const n = String(args.new_string||''); if (o === '__FULL_REPLACE__') { fs.writeFileSync(rp(args.file_path), n, 'utf-8'); return { callId: id, toolName: tn, status: 'success', summary: '已替换' } }; if (!c.includes(o)) return { callId: id, toolName: tn, status: 'error', summary: '不匹配' }; fs.writeFileSync(rp(args.file_path), c.replace(o, n), 'utf-8'); return { callId: id, toolName: tn, status: 'success', summary: '已修改' } } catch { return { callId: id, toolName: tn, status: 'error', summary: '失败' } } }
    if (tn === 'list_directory') { try { fs.readdirSync(rp(args.dir_path||'.')); return { callId: id, toolName: tn, status: 'success', summary: 'ok' } } catch { return { callId: id, toolName: tn, status: 'error', summary: '不存在' } } }
    return { callId: id, toolName: tn, status: 'error', summary: '未知' }
  })
  const core = new Set(['read_file','create_file','edit_file','list_directory'])
  runtime.setTools(toolRegistry.getAllSchemas().filter(s => core.has(s.function.name)))
  const start = Date.now()
  const result = await runtime.run({ userMessage: userMsg, attachments: [] })
  abort.abort()
  const tools = result.toolCallSteps?.map(s => ({ tool: s.tool, summary: s.summary })) || []
  const readTpl = tools.filter(t => t.tool === 'read_file' && t.summary.includes('.aiharness'))
  const readTarget = tools.filter(t => t.tool === 'read_file' && !t.summary.includes('.aiharness'))
  const writes = tools.filter(t => t.tool === 'edit_file')

  // Check content
  try {
    const c = fs.readFileSync(path.join(DIR, 'outline', 'items.yaml'), 'utf-8')
    const fieldsOk = c.includes('id:') && c.includes('name:') && c.includes('type:')
    const contentOk = c.length > 50
    return { label, readTpl: readTpl.length, readTarget: readTpl.length + readTarget.length, writes: writes.length, rounds: result.iterationCount, tokens: result.totalTokens, time: ((Date.now()-start)/1000).toFixed(1), fieldsOk, contentOk, allTools: tools.map(t=>t.tool).join(',') }
  } catch {
    return { label, readTpl: readTpl.length, readTarget: readTpl.length + readTarget.length, writes: writes.length, rounds: result.iterationCount, tokens: result.totalTokens, time: ((Date.now()-start)/1000).toFixed(1), fieldsOk: false, contentOk: false, allTools: tools.map(t=>t.tool).join(',') }
  }
}

async function main() {
  console.log('════════════════════════════════════════')
  console.log(' 硬数据对比：读模板 vs 不读模板')
  console.log('════════════════════════════════════════')

  const msg1 = '在道具列表里加两件道具：破魔剑（灵品武器，可破魔道护盾，主角的备用武器）和聚灵丹（凡品丹药，加速灵气吸收）'

  // 测试A：带字段信息
  console.log('\n▶ 测试A: Prompt带字段（不读模板）')
  const a = await test(WITH_FIELDS, 'with_fields', msg1)
  console.log(`  读模板:${a.readTpl}次 | 总读:${a.readTarget}次 | 写:${a.writes}次 | ${a.rounds}轮 | ${a.tokens}tok | ${a.time}s`)
  console.log(`  工具: ${a.allTools} | 格式:${a.fieldsOk?'✅':'❌'} 内容:${a.contentOk?'✅':'❌'}`)

  // 测试B：不带字段，要求先读模板
  console.log('\n▶ 测试B: Prompt不带字段（要求先读模板）')
  const b = await test(WITHOUT_FIELDS, 'without_fields', msg1)
  console.log(`  读模板:${b.readTpl}次 | 总读:${b.readTarget}次 | 写:${b.writes}次 | ${b.rounds}轮 | ${b.tokens}tok | ${b.time}s`)
  console.log(`  工具: ${b.allTools} | 格式:${b.fieldsOk?'✅':'❌'} 内容:${b.contentOk?'✅':'❌'}`)

  // ═══ 对比 ═══
  console.log('\n════════════════════════════════════════')
  console.log('              对 比')
  console.log('════════════════════════════════════════')
  console.log(`\n              | 读模板 | 总读取 | 写 | 轮数 | tokens | 时间`)
  console.log(`  Prompt含字段 |   ${a.readTpl}    |   ${a.readTarget}    | ${a.writes} |  ${a.rounds}  | ${a.tokens} | ${a.time}s`)
  console.log(`  Prompt无字段 |   ${b.readTpl}    |   ${b.readTarget}    | ${b.writes} |  ${b.rounds}  | ${b.tokens} | ${b.time}s`)

  if (b.readTpl > a.readTpl) {
    const saved = b.tokens - a.tokens
    const savedRounds = b.rounds - a.rounds
    console.log(`\n  📊 读模板多花: +${b.readTpl-a.readTpl}次读, +${b.rounds-a.rounds}轮, +${saved}tokens (${(saved/a.tokens*100).toFixed(0)}%)`)
  }
  console.log(`  📊 结论: ${b.tokens > a.tokens ? '不读模板更快更省' : '差异不明显'}`)
}

main().catch(e => { console.error(e.message); process.exit(1) })
