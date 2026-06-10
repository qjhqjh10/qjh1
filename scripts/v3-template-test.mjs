/**
 * 模板读取对比测试
 * 验证: AI 填 Tab 时是否还需要读模板，读 vs 不读的效率对比
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
const TEST_PROJ = '_v3_tmpl'
const TEST_DIR = path.join(PROJECTS, TEST_PROJ)
const API_KEY = 'sk-c9c30831df7243209435c60e811c879d'

function setup() {
  fs.rmSync(TEST_DIR, { recursive: true, force: true })
  fs.mkdirSync(TEST_DIR, { recursive: true })
  for (const d of ['outline', 'characters', 'chapters', 'detailed_outline', 'summaries'])
    fs.mkdirSync(path.join(TEST_DIR, d), { recursive: true })
  fs.writeFileSync(path.join(TEST_DIR, 'project.json'), JSON.stringify({ type: 'writing', novelCategory: 'xianxia' }))

  // Create empty tabs — model must use edit_file FULL_REPLACE to fill them
  fs.writeFileSync(path.join(TEST_DIR, 'outline', 'items.yaml'), 'items: []', 'utf-8')
  fs.writeFileSync(path.join(TEST_DIR, 'outline', 'factions.yaml'), 'factions: []', 'utf-8')
  fs.writeFileSync(path.join(TEST_DIR, 'outline', 'locations.yaml'), 'locations: []', 'utf-8')
  fs.writeFileSync(path.join(TEST_DIR, 'outline', 'power_system.yaml'), "name: ''\ndescription: ''\nlevels: []", 'utf-8')
  fs.writeFileSync(path.join(TEST_DIR, 'outline', 'emotion.yaml'), 'segments: []\nintensityCurve: []', 'utf-8')
  fs.writeFileSync(path.join(TEST_DIR, 'outline', 'outline_meta.yaml'), 'foreshadowing: []\nplotThreads: []', 'utf-8')
  fs.writeFileSync(path.join(TEST_DIR, 'outline', 'plot.md'), '# 故事剧情\n\n> 梗概\n\n## 第1章\n\n待填充\n', 'utf-8')
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
  if (clean.startsWith('../')) { let b = TEST_DIR, c = clean; while (c.startsWith('../')) { c = c.slice(3); b = path.dirname(b) }; return path.join(b, c) }
  for (const pfx of [TEST_PROJ + '/', '项目' + TEST_PROJ + '/']) { if (clean.startsWith(pfx)) return path.join(TEST_DIR, clean.slice(pfx.length)) }
  return path.join(TEST_DIR, clean)
}

async function run(userMessage, history = []) {
  const abort = new AbortController()
  const runtime = new V4UnifiedRuntime({ configId: 'test', projectId: TEST_PROJ, maxIterations: 10, abortSignal: abort.signal, contextWindow: 128000 }, adapter)
  const CORE_PROMPT = buildSystemPrompt()
  const contextBuilder = new BridgeContextBuilder({ projectId: TEST_PROJ, kbEnabled: false, webSearchEnabled: false })
  runtime.setContextAssembler(async (msg, hist, pid) => await contextBuilder.buildContext(msg, hist, pid, CORE_PROMPT, true))
  runtime.setToolExecutor(async (args, ctx) => {
    const tn = ctx.toolName
    const id = ctx.callId
    if (tn === 'create_file') { const fp = rp(args.file_path); try { fs.accessSync(fp); return { callId: id, toolName: tn, status: 'error', summary: '文件已存在' } } catch {}; fs.mkdirSync(path.dirname(fp), { recursive: true }); fs.writeFileSync(fp, String(args.content||''), 'utf-8'); return { callId: id, toolName: tn, status: 'success', summary: `已创建(${String(args.content||'').length}字)` } }
    if (tn === 'read_file') { try { const c = fs.readFileSync(rp(args.file_path), 'utf-8'); return { callId: id, toolName: tn, status: 'success', summary: `${c.length}字`, detail: c.slice(0, 500) } } catch { return { callId: id, toolName: tn, status: 'error', summary: '文件不存在' } } }
    if (tn === 'edit_file') { try { const c = fs.readFileSync(rp(args.file_path), 'utf-8'); const o = String(args.old_string||''); const n = String(args.new_string||''); if (o === '__FULL_REPLACE__') { fs.writeFileSync(rp(args.file_path), n, 'utf-8'); return { callId: id, toolName: tn, status: 'success', summary: '已替换' } }; if (!c.includes(o)) return { callId: id, toolName: tn, status: 'error', summary: '未找到匹配文本' }; fs.writeFileSync(rp(args.file_path), c.replace(o, n), 'utf-8'); return { callId: id, toolName: tn, status: 'success', summary: '已修改' } } catch { return { callId: id, toolName: tn, status: 'error', summary: '编辑失败' } } }
    if (tn === 'list_directory') { try { fs.readdirSync(rp(args.dir_path||'.'), { withFileTypes: true }); return { callId: id, toolName: tn, status: 'success', summary: 'ok' } } catch { return { callId: id, toolName: tn, status: 'error', summary: '目录不存在' } } }
    return { callId: id, toolName: tn, status: 'error', summary: `未知:${tn}` }
  })
  const core = new Set(['read_file','create_file','edit_file','delete_file','list_directory','search_content','tool_search'])
  runtime.setTools(toolRegistry.getAllSchemas().filter(s => core.has(s.function.name)))
  runtime.setHistory(history.map(h => ({ role: h.role, content: h.content })))
  const start = Date.now()
  const result = await runtime.run({ userMessage: `[当前项目: ${TEST_PROJ}] ${userMessage}`, attachments: [] })
  abort.abort()
  const tools = result.toolCallSteps?.map(s => ({ tool: s.tool, summary: s.summary })) || []
  const readTemplate = tools.some(t => t.tool === 'read_file' && t.summary.includes('templates'))
  return { text: result.text, tools, readTemplate, rounds: result.iterationCount, tokens: result.totalTokens, time: ((Date.now()-start)/1000).toFixed(1) }
}

async function main() {
  console.log('═══════════════════════════════════════')
  console.log(' 模板读取对比测试')
  console.log(' 问题: AI 填 Tab 时会读模板吗？读 vs 不读效率如何？')
  console.log('═══════════════════════════════════════')

  setup()
  const results = []

  // ═══ 测试1: 填 items.yaml (道具Tab) ═══
  console.log('\n── 测试1: 填 items.yaml（道具Tab）──')
  let r = await run('给我在项目道具列表里加三件东西：青冥古剑（仙品武器，林逸的佩剑）、回春丹（凡品丹药，疗伤用）、九幽瘴烟弹（灵品暗器，投掷爆发毒烟）')
  let content = ''
  try { content = fs.readFileSync(path.join(TEST_DIR, 'outline', 'items.yaml'), 'utf-8') } catch {}
  const hasItems = content.includes('青冥') && content.includes('回春') && content.includes('九幽')
  console.log(`  读模板: ${r.readTemplate ? '是' : '否'} | 轮:${r.rounds} | tok:${r.tokens} | ${r.time}s`)
  console.log(`  格式: ${content.includes('id:') ? '✅含id' : '❌缺id'} ${content.includes('name:') ? '✅含name' : '❌缺name'} ${content.includes('type:') ? '✅含type' : '❌缺type'} ${content.includes('grade:') ? '✅含grade' : '❌缺grade'} | 内容:${hasItems?'✅完整':'❌不全'}`)
  if (content) console.log(`  文件内容:\n${content.slice(0, 250)}`)
  results.push({ name: 'items.yaml', ...r, content, hasItems, fields: { id: content.includes('id:'), name: content.includes('name:'), type: content.includes('type:'), grade: content.includes('grade:') } })

  // ═══ 测试2: 填 factions.yaml (势力Tab) ═══
  console.log('\n── 测试2: 填 factions.yaml（势力Tab）──')
  r = await run('在势力列表里加上正道联盟和血煞教两个势力。正道联盟是七大正道的松散联盟，血煞教是三大魔道之首，以血炼之法修炼。')
  let content2 = ''
  try { content2 = fs.readFileSync(path.join(TEST_DIR, 'outline', 'factions.yaml'), 'utf-8') } catch {}
  const hasFac = content2.includes('正道联盟') && content2.includes('血煞教')
  console.log(`  读模板: ${r.readTemplate ? '是' : '否'} | 轮:${r.rounds} | tok:${r.tokens} | ${r.time}s`)
  console.log(`  格式: ${content2.includes('id:') ? '✅含id' : '❌缺id'} ${content2.includes('name:') ? '✅含name' : '❌缺name'} ${content2.includes('type:') ? '✅含type' : '❌缺type'} | 内容:${hasFac?'✅完整':'❌不全'}`)
  if (content2) console.log(`  文件内容:\n${content2.slice(0, 250)}`)
  results.push({ name: 'factions.yaml', ...r, hasFac })

  // ═══ 测试3: 填 emotion.yaml (情绪Tab) ═══
  console.log('\n── 测试3: 填 emotion.yaml（情绪Tab）──')
  r = await run('帮我设置一下情绪曲线：第1-3章紧张期待（开篇建立世界），第4-6章压抑愤怒（主角被打压），第7-9章热血激昂（主角反击）')
  let content3 = ''
  try { content3 = fs.readFileSync(path.join(TEST_DIR, 'outline', 'emotion.yaml'), 'utf-8') } catch {}
  const hasEmo = content3.includes('chapterStart')
  console.log(`  读模板: ${r.readTemplate ? '是' : '否'} | 轮:${r.rounds} | tok:${r.tokens} | ${r.time}s`)
  console.log(`  格式: ${hasEmo?'✅含chapterStart':'❌缺'} ${content3.includes('dominantEmotion')?'✅含dominantEmotion':'❌缺'} | 内容:${hasEmo?'✅':'❌'}`)
  if (content3) console.log(`  文件内容:\n${content3.slice(0, 250)}`)
  results.push({ name: 'emotion.yaml', ...r, hasEmo })

  // ═══ 测试4: 创建角色（作为对照——角色15字段在Prompt中） ═══
  console.log('\n── 测试4: 创建角色（对照——15字段已Prompt内置）──')
  r = await run('帮我创建一个角色，叫萧寒，男配，剑修长老，性格冷峻但内心重情义。')
  let chars = []
  try { chars = fs.readdirSync(path.join(TEST_DIR, 'characters')) } catch {}
  const charFile = chars.find(c => c.includes('萧'))
  let charOk = false
  if (charFile) {
    try {
      const cc = fs.readFileSync(path.join(TEST_DIR, 'characters', charFile), 'utf-8')
      charOk = cc.includes('name:') && cc.includes('萧寒') && cc.includes('role:')
    } catch {}
  }
  console.log(`  读模板: ${r.readTemplate ? '是' : '否'} | 轮:${r.rounds} | tok:${r.tokens} | ${r.time}s`)
  console.log(`  文件: ${charFile || '无'} | 格式:${charOk?'✅':'❌'}`)
  results.push({ name: '角色卡', ...r, charOk })

  // ═══ 汇总 ═══
  console.log('\n═══════════════════════════════════════')
  console.log('                   对 比 汇 总')
  console.log('═══════════════════════════════════════')
  console.log(`\n| 场景 | 读模板 | 轮数 | tokens | 格式 | 内容 |`)
  console.log('|------|:--:|:--:|:-----:|:--:|:--:|')
  for (const r of results) {
    const readLabel = r.readTemplate ? '📖读了' : '⚡未读'
    const fmtOk = r.fields ? Object.values(r.fields).every(v=>v) : (r.hasEmo || r.charOk || r.hasFac)
    console.log(`| ${r.name} | ${readLabel} | ${r.rounds} | ${r.tokens} | ${fmtOk?'✅':'❌'} | ${(r.hasItems||r.hasFac||r.hasEmo||r.charOk)?'✅':'❌'} |`)
  }
  const readT = results.filter(r => r.readTemplate)
  const noRead = results.filter(r => !r.readTemplate)
  if (readT.length > 0) console.log(`\n读模板: 平均 ${Math.round(readT.reduce((s,r)=>s+r.tokens,0)/readT.length)} tokens, ${Math.round(readT.reduce((s,r)=>s+parseInt(r.rounds),0)/readT.length)} 轮`)
  if (noRead.length > 0) console.log(`不读模板: 平均 ${Math.round(noRead.reduce((s,r)=>s+r.tokens,0)/noRead.length)} tokens, ${Math.round(noRead.reduce((s,r)=>s+parseInt(r.rounds),0)/noRead.length)} 轮`)
}

main().catch(e => { console.error(e.message); process.exit(1) })
