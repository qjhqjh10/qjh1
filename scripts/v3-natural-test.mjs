/**
 * v3 自然对话测试 — 模拟真实用户的口语化表达
 * 不使用命令式语言，而是日常聊天的方式
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
const TEST_PROJ = '_v3_natural'
const TEST_DIR = path.join(PROJECTS, TEST_PROJ)
const API_KEY = 'sk-c9c30831df7243209435c60e811c879d'

function setup() {
  fs.rmSync(TEST_DIR, { recursive: true, force: true })
  fs.mkdirSync(TEST_DIR, { recursive: true })
  for (const d of ['outline', 'characters', 'chapters', 'detailed_outline', 'summaries', 'notes']) {
    fs.mkdirSync(path.join(TEST_DIR, d), { recursive: true })
  }
  fs.writeFileSync(path.join(TEST_DIR, 'project.json'), JSON.stringify({ type: 'writing', novelCategory: 'xianxia' }))
  fs.writeFileSync(path.join(TEST_DIR, 'outline', 'plot.md'), '# 故事剧情\n\n> 梗概\n\n## 第1章·觉醒\n\n待填充\n', 'utf-8')
  fs.writeFileSync(path.join(TEST_DIR, 'outline', 'worldbuilding.md'), '# 世界观\n\n> 修仙架空\n\n## 一、核心规则\n\n待填充\n', 'utf-8')
}

toolRegistry.registerAll(ALL_TOOLS)

const adapter = new OpenAIAdapter({
  chatWithTools: async (messages, configId, projectId, tools) => {
    const body = { model: 'deepseek-v4-flash', messages, tools: tools?.length > 0 ? tools : undefined, tool_choice: 'auto', max_tokens: 1200, temperature: 0.3 }
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
  const runtime = new V4UnifiedRuntime({ configId: 'test', projectId: TEST_PROJ, maxIterations: 15, abortSignal: abort.signal, contextWindow: 128000 }, adapter)
  const CORE_PROMPT = buildSystemPrompt()
  const contextBuilder = new BridgeContextBuilder({ projectId: TEST_PROJ, kbEnabled: false, webSearchEnabled: false })
  runtime.setContextAssembler(async (msg, hist, pid) => await contextBuilder.buildContext(msg, hist, pid, CORE_PROMPT, true))
  runtime.setToolExecutor(async (args, ctx) => {
    const tn = ctx.toolName
    const id = ctx.callId
    if (tn === 'create_file') { const fp = rp(args.file_path); try { fs.accessSync(fp); return { callId: id, toolName: tn, status: 'error', summary: '文件已存在' } } catch {}; fs.mkdirSync(path.dirname(fp), { recursive: true }); fs.writeFileSync(fp, String(args.content || ''), 'utf-8'); return { callId: id, toolName: tn, status: 'success', summary: `已创建 (${String(args.content||'').length} 字符)` } }
    if (tn === 'read_file') { try { const c = fs.readFileSync(rp(args.file_path), 'utf-8'); return { callId: id, toolName: tn, status: 'success', summary: `${c.length} 字符`, detail: c.slice(0, 500) } } catch { return { callId: id, toolName: tn, status: 'error', summary: '文件不存在' } } }
    if (tn === 'edit_file') { try { const c = fs.readFileSync(rp(args.file_path), 'utf-8'); const o = String(args.old_string||''); const n = String(args.new_string||''); if (o === '__FULL_REPLACE__') { fs.writeFileSync(rp(args.file_path), n, 'utf-8'); return { callId: id, toolName: tn, status: 'success', summary: '已替换' } }; if (!c.includes(o)) return { callId: id, toolName: tn, status: 'error', summary: '未找到匹配文本' }; fs.writeFileSync(rp(args.file_path), c.replace(o, n), 'utf-8'); return { callId: id, toolName: tn, status: 'success', summary: '已修改' } } catch { return { callId: id, toolName: tn, status: 'error', summary: '编辑失败' } } }
    if (tn === 'list_directory') { try { const e = fs.readdirSync(rp(args.dir_path||'.'), { withFileTypes: true }); return { callId: id, toolName: tn, status: 'success', summary: `${e.length} 项` } } catch { return { callId: id, toolName: tn, status: 'error', summary: '目录不存在' } } }
    if (tn === 'search_content') { try { const p = String(args.pattern||''); const r = []; ((d) => { try { for (const e of fs.readdirSync(d,{withFileTypes:true})) { const f = path.join(d,e.name); if (e.isDirectory()) arguments.callee(f); else { try { const c = fs.readFileSync(f,'utf-8'); if (c.includes(p)) r.push(f) } catch {} } } } catch {} })(rp(args.dir_path||'.')); return { callId: id, toolName: tn, status: 'success', summary: `${r.length} 处` } } catch { return { callId: id, toolName: tn, status: 'error', summary: '搜索失败' } } }
    return { callId: id, toolName: tn, status: 'error', summary: `未知工具: ${tn}` }
  })
  const schemas = toolRegistry.getAllSchemas()
  const core = new Set(['read_file','create_file','edit_file','delete_file','list_directory','search_content','tool_search'])
  runtime.setTools(schemas.filter(s => core.has(s.function.name)))
  runtime.setHistory(history.map(h => ({ role: h.role, content: h.content })))
  const start = Date.now()
  const result = await runtime.run({ userMessage: `[当前项目: ${TEST_PROJ}] ${userMessage}`, attachments: [] })
  abort.abort()
  const tools = result.toolCallSteps?.map(s => s.tool) || []
  return { text: result.text, tools, rounds: result.iterationCount, tokens: result.totalTokens, time: ((Date.now()-start)/1000).toFixed(1) }
}

function check(path, contains) { try { return fs.readFileSync(path, 'utf-8').includes(contains) } catch { return false } }
function list(dir) { try { return fs.readdirSync(dir) } catch { return [] } }

async function main() {
  console.log('═══════════════════════════════════════')
  console.log(' v3 自然对话测试')
  console.log('═══════════════════════════════════════')
  setup()

  // ═══════════════════════════════════════
  // 场景1: 闲聊式创意讨论
  // ═══════════════════════════════════════
  console.log('\n── 场景1: 闲聊讨论（不应该调工具）──')
  let r = await run('我最近想写个修仙小说，你觉得元婴期这个设定还能怎么玩出花样来？别整那些老套的，给我点新鲜的想法呗。')
  console.log(`  工具:${r.tools.length} 轮:${r.rounds} tok:${r.tokens} → ${r.tools.length===0?'✅ 纯聊天':'⚠️ 不该调工具'}`)
  console.log(`  回复: ${r.text.slice(0, 120)}...`)

  // ═══════════════════════════════════════
  // 场景2: 分享草稿求反馈
  // ═══════════════════════════════════════
  console.log('\n── 场景2: 分享草稿求反馈（不应该调工具）──')
  r = await run('我写了段开篇，你帮我瞅瞅，感觉有点平，但又说不上来哪里不对："林逸醒来的时候，发现自己躺在一片废墟里。他记不起来自己是怎么到这里的，只记得昨天还在宗门练剑。远处有火光，还有打斗的声音。"')
  console.log(`  工具:${r.tools.length} 轮:${r.rounds} tok:${r.tokens} → ${r.tools.length===0?'✅ 纯分析':'⚠️'}`)
  console.log(`  回复: ${r.text.slice(0, 120)}...`)

  // ═══════════════════════════════════════
  // 场景3: 聊着聊着觉得好，想保存
  // ═══════════════════════════════════════
  console.log('\n── 场景3: 聊到好创意 → 想存下来 ──')
  r = await run('诶你刚才说的那个"倒着修炼"的设定太有意思了，帮我记一下呗，存到世界观里，免得我回头忘了。')
  console.log(`  工具:${r.tools.length}(${r.tools.join(',')}) 轮:${r.rounds} tok:${r.tokens}`)
  const hasWb = check(path.join(TEST_DIR,'outline','worldbuilding.md'), '修炼') || check(path.join(TEST_DIR,'outline','worldbuilding.md'), '倒着')
  console.log(`  → ${hasWb?'✅ 已写入worldbuilding.md':'⚠️ 可能没写入'}`)

  // ═══════════════════════════════════════
  // 场景4: 模糊请求 + 自然修正
  // ═══════════════════════════════════════
  console.log('\n── 场景4: 模糊请求，然后修正 ──')
  r = await run('你帮我弄个角色呗，就叫苏晚晴，是个女剑修。不用太详细，大概写写就行。')
  console.log(`  工具:${r.tools.length}(${r.tools.join(',')}) 轮:${r.rounds} tok:${r.tokens}`)
  const chars = list(path.join(TEST_DIR, 'characters'))
  console.log(`  characters/: ${chars.join(', ')} → ${chars.some(c=>c.includes('苏')||c.includes('晚')||c.includes('晴'))?'✅ 角色已创建':'⚠️'}`)

  // ═══════════════════════════════════════
  // 场景5: 觉得不够好，要求补充
  // ═══════════════════════════════════════
  console.log('\n── 场景5: 看了觉得不够 → 要求补充 ──')
  r = await run('嗯…感觉刚才那个角色还是太单薄了，你能再给她加点背景故事吗？她是怎么变成剑修的，有没有什么心结之类的。然后更新一下角色文件。')
  console.log(`  工具:${r.tools.length}(${r.tools.join(',')}) 轮:${r.rounds} tok:${r.tokens}`)
  const charFile = list(path.join(TEST_DIR, 'characters')).find(c => c.includes('苏')||c.includes('晚')||c.includes('晴'))
  const hasUpdated = charFile && check(path.join(TEST_DIR, 'characters', charFile), '背景') || check(path.join(TEST_DIR, 'characters', charFile), '心结') || check(path.join(TEST_DIR, 'characters', charFile), 'arc')
  console.log(`  → ${hasUpdated?'✅ 已更新角色文件':'⚠️'}`)

  // ═══════════════════════════════════════
  // 场景6: 贴一段字，想整理成细纲
  // ═══════════════════════════════════════
  console.log('\n── 场景6: 贴了段正文 → 想整理成细纲 ──')
  r = await run('我写了第一章，感觉节奏还行但不知道结构好不好。你帮我看看，顺便理个细纲出来，存到细纲那边：' +
    '"林逸站在演武场中央，四周弟子的窃窃私语如潮水般涌来。他的对手是首席弟子陈啸天。金丹期的威压碾压而来，林逸咬牙死死撑住。就在所有人以为他要跪下时，一道青芒从他丹田炸开——上古剑魂觉醒了。陈啸天脸色铁青，台下陈长老眼神闪过一丝阴毒。当天夜里，陈长老密召心腹，一个针对林逸的计划悄然展开。"')
  console.log(`  工具:${r.tools.length}(${r.tools.join(',')}) 轮:${r.rounds} tok:${r.tokens}`)
  const dl = list(path.join(TEST_DIR, 'detailed_outline'))
  const dlFile = dl[0]
  const hasDL = dlFile && (check(path.join(TEST_DIR,'detailed_outline',dlFile), 'plotOverview') || check(path.join(TEST_DIR,'detailed_outline',dlFile), 'keyEvents'))
  console.log(`  detailed_outline/: ${dl.join(',')} → ${hasDL?'✅ 细纲已创建':'⚠️'}`)

  // ═══════════════════════════════════════
  // 场景7: 随便聊聊，突然想记笔记
  // ═══════════════════════════════════════
  console.log('\n── 场景7: 聊天中产生灵感 → 记个笔记 ──')
  r = await run('我突然想到一个反转——主角的剑魂其实不是上古传承，是来自未来的他自己。这个脑洞怎么样？要是你觉得还行，帮我记到笔记里去。')
  console.log(`  工具:${r.tools.length}(${r.tools.join(',')}) 轮:${r.rounds} tok:${r.tokens}`)
  const noteFiles = list(path.join(ROOT, 'notes'))
  console.log(`  notes/: ${noteFiles.length}个文件 → ${noteFiles.length>0?'✅ 有笔记':'⚠️'}`)

  // ═══════════════════════════════════════
  // 场景8: 多轮对话，逐步推进
  // ═══════════════════════════════════════
  console.log('\n── 场景8: 多轮对话 → 逐步推进 ──')
  let hist = []
  // 第1轮：纯聊天
  r = await run('我想写个不一样的修仙世界观，就是那种…修仙其实是外星人留下的技术遗产，你觉得这个设定有搞头吗？')
  console.log(`  [轮1·聊天] 工具:${r.tools.length} 轮:${r.rounds} → ${r.tools.length===0?'✅ 纯聊天':'⚠️'}`)
  hist.push({ role: 'assistant', content: r.text })

  // 第2轮：延续讨论
  r = await run('有意思！那你觉得这个世界观的核心冲突应该是啥？我想听听你的想法。', hist)
  console.log(`  [轮2·讨论] 工具:${r.tools.length} 轮:${r.rounds} → ${r.tools.length===0?'✅ 纯聊天':'⚠️'}`)
  hist.push({ role: 'assistant', content: r.text })

  // 第3轮：觉得好，想存
  r = await run('嗯嗯，就这么定了！帮我把刚才聊的这些设定整理一下，存到世界观文件里去。写详细点哈。', hist)
  console.log(`  [轮3·保存] 工具:${r.tools.length}(${r.tools.join(',')}) 轮:${r.rounds}`)
  const wbUpdated = check(path.join(TEST_DIR,'outline','worldbuilding.md'), '外星') || check(path.join(TEST_DIR,'outline','worldbuilding.md'), '技术')
  console.log(`  → ${wbUpdated?'✅ 设定已写入worldbuilding.md':'⚠️'}`)

  // ═══════════════════════════════════════
  console.log('\n═══════════════════════════════════════')
  console.log(' 测试完成')
  console.log(` 项目保留在: ${TEST_DIR}`)
}

main().catch(e => { console.error(e.message); process.exit(1) })
