/**
 * v3 真实 Runtime 直接调用测试
 * 不通过 tsx 进程，直接 import Runtime 模块
 * 使用 tsx 作为 loader 运行: node --import tsx/esm scripts/v3-direct-test.mjs
 */
import { V4UnifiedRuntime } from '../src/agent/runtime/V4UnifiedRuntime.js'
import { OpenAIAdapter } from '../src/agent/runtime/adapters/OpenAIAdapter.js'
import { V4SecurityFence } from '../src/agent/V4SecurityFence.js'
import { toolRegistry } from '../src/agent/skills/ToolRegistry.js'
import { ALL_TOOLS } from '../src/agent/skills/tools/index.js'
import { buildSystemPrompt } from '../src/agent/V4SystemPrompt.js'
import { BridgeContextBuilder } from '../src/agent/context/BridgeContextBuilder.js'
import { createToolExecutor } from '../src/agent/bridge/toolExecutorFactory.js'
import { AuditTrail } from '../src/agent/audit/AuditTrail.js'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dir, '..')
const PROJECTS = path.join(ROOT, 'projects')
const TEST_PROJ = '_v3_direct'
const TEST_DIR = path.join(PROJECTS, TEST_PROJ)
const API_KEY = 'sk-c9c30831df7243209435c60e811c879d'
const MODEL = 'deepseek-v4-flash'

// ── Setup test project ──
fs.rmSync(TEST_DIR, { recursive: true, force: true })
fs.mkdirSync(TEST_DIR, { recursive: true })
for (const d of ['outline', 'characters', 'chapters', 'detailed_outline', 'summaries']) {
  fs.mkdirSync(path.join(TEST_DIR, d), { recursive: true })
}
fs.writeFileSync(path.join(TEST_DIR, 'project.json'), JSON.stringify({ type: 'writing', novelCategory: 'general' }))
fs.writeFileSync(path.join(TEST_DIR, 'outline', 'plot.md'), '# 故事剧情\n\n> 梗概\n\n', 'utf-8')
console.log(`✅ 测试项目: ${TEST_DIR}`)

// ── Init ──
toolRegistry.registerAll(ALL_TOOLS)
const fence = new V4SecurityFence(TEST_PROJ)
const audit = new AuditTrail()

// ── Create adapter that actually calls DeepSeek ──
const adapter = new OpenAIAdapter({
  chatWithTools: async (messages, configId, projectId, tools) => {
    const body = { model: MODEL, messages, tools: tools?.length > 0 ? tools : undefined, tool_choice: 'auto', max_tokens: 1500, temperature: 0.3 }
    const r = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
      body: JSON.stringify(body),
    })
    const d = await r.json()
    const msg = d.choices?.[0]?.message
    return {
      text: msg?.content || '',
      toolCalls: (msg?.tool_calls || []).map(tc => ({
        id: tc.id, name: tc.function.name, arguments: tc.function.arguments,
      })),
      finishReason: d.choices?.[0]?.finish_reason || 'stop',
      usage: { prompt_tokens: d.usage?.prompt_tokens || 0, completion_tokens: d.usage?.completion_tokens || 0, total_tokens: d.usage?.total_tokens || 0 },
    }
  },
  abortStream: () => {},
})

// ── Create tool executor that actually writes to disk ──
function resolvePath(filePath) {
  const clean = String(filePath).replace(/\\/g, '/').replace(/^\/+/, '')
  if (clean.startsWith('../')) {
    let base = path.dirname(TEST_DIR) // projects/ — matches real app's projectPath
    let c = clean
    while (c.startsWith('../')) { c = c.slice(3); base = path.dirname(base) }
    return { resolved: path.join(base, c), dir: base }
  }
  // Strip any project name prefix (both directory name and "项目"+name variants)
  const prefixes = [TEST_PROJ + '/', '项目' + TEST_PROJ + '/', '项目_' + TEST_PROJ + '/']
  let stripped = clean
  for (const pfx of prefixes) {
    if (stripped.startsWith(pfx)) { stripped = stripped.slice(pfx.length); break }
  }
  return { resolved: path.join(TEST_DIR, stripped), dir: TEST_DIR }
}

const toolExecutor = {
  execute: async (toolName, args, ctx) => {
    // Debug: log paths for T7/T8
    const raw = args.file_path || args.dir_path || ''
    const rp = resolvePath(raw)
    if (toolName === 'list_directory' && raw) {
      console.log(`    [DEBUG] list_directory raw="${raw}" → resolved="${rp.resolved}" dir="${rp.dir}"`)
    }
    switch (toolName) {
      case 'read_file': {
        const fp = rp.resolved
        try { const c = fs.readFileSync(fp, 'utf-8'); return { callId: ctx.callId || '1', toolName, status: 'success', summary: `${c.length} 字符`, detail: c.slice(0, 500) } }
        catch { console.log(`    [DEBUG] read_file MISS: "${args.file_path}" → "${fp}"`); return { callId: ctx.callId || '1', toolName, status: 'error', summary: '文件不存在' } }
      }
      case 'create_file': {
        const fp = resolvePath(args.file_path).resolved
        try { fs.accessSync(fp); return { callId: ctx.callId || '1', toolName, status: 'error', summary: '文件已存在' } } catch {}
        const content = String(args.content || '')
        fs.mkdirSync(path.dirname(fp), { recursive: true })
        fs.writeFileSync(fp, content, 'utf-8')
        return { callId: ctx.callId || '1', toolName, status: 'success', summary: `已创建 (${content.length} 字符)` }
      }
      case 'edit_file': {
        const fp = resolvePath(args.file_path).resolved
        try {
          const content = fs.readFileSync(fp, 'utf-8')
          const oldStr = String(args.old_string || '')
          const newStr = String(args.new_string || '')
          if (oldStr === '__FULL_REPLACE__') { fs.writeFileSync(fp, newStr, 'utf-8'); return { callId: ctx.callId || '1', toolName, status: 'success', summary: `已替换` } }
          if (!content.includes(oldStr)) return { callId: ctx.callId || '1', toolName, status: 'error', summary: '未找到匹配文本' }
          const newContent = args.replace_all ? content.replaceAll(oldStr, newStr) : content.replace(oldStr, newStr)
          fs.writeFileSync(fp, newContent, 'utf-8')
          return { callId: ctx.callId || '1', toolName, status: 'success', summary: '已修改' }
        } catch { return { callId: ctx.callId || '1', toolName, status: 'error', summary: '编辑失败' } }
      }
      case 'search_content': {
        const sp = resolvePath(args.dir_path || '.').resolved
        try {
          const pattern = String(args.pattern || '')
          const results = []
          const walk = (d) => { try { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const full = path.join(d, e.name); if (e.isDirectory()) walk(full); else { try { const c = fs.readFileSync(full, 'utf-8'); if (c.includes(pattern)) results.push(`${path.relative(sp, full)}: ${c.split('\n').find(l => l.includes(pattern))?.trim()}`) } catch {} } } } catch {} }
          walk(sp)
          return { callId: ctx.callId || '1', toolName, status: 'success', summary: `${results.length} 处` }
        } catch { return { callId: ctx.callId || '1', toolName, status: 'error', summary: '搜索失败' } }
      }
      case 'list_directory': {
        const raw = args.dir_path || '.'
        const { resolved, dir } = resolvePath(raw)
        // Debug: log what path the model tried
        try {
          const entries = fs.readdirSync(resolved, { withFileTypes: true })
          return { callId: ctx.callId || '1', toolName, status: 'success', summary: `${entries.length} 项`, detail: entries.map(e => `${e.isDirectory()?'[DIR]':'[FILE]'} ${e.name}`).join('\n') }
        } catch { return { callId: ctx.callId || '1', toolName, status: 'error', summary: '目录不存在' } }
      }
      default: return { callId: ctx.callId || '1', toolName, status: 'error', summary: `未知工具: ${toolName}` }
    }
  },
}

// ── Test runner ──
async function test(name, userMessage, verify) {
  // Inject project context so model knows the exact directory name
  const fullMessage = `[当前项目目录名: ${TEST_PROJ}] ${userMessage}`
  console.log(`\n── ${name} ──`)
  console.log(`  命令: ${userMessage.slice(0, 80)}...`)

  const abort = new AbortController()
  const runtime = new V4UnifiedRuntime({
    configId: 'test',
    projectId: TEST_PROJ,
    maxIterations: 15,
    abortSignal: abort.signal,
    contextWindow: 128000,
  }, adapter)

  // Wire up context
  const CORE_PROMPT = buildSystemPrompt()
  const contextBuilder = new BridgeContextBuilder({ projectId: TEST_PROJ, kbEnabled: false, webSearchEnabled: false })
  runtime.setContextAssembler(async (msg, hist, pid) => {
    return await contextBuilder.buildContext(msg, hist, pid, CORE_PROMPT, true)
  })
  runtime.setToolExecutor(async (args, context) => {
    const result = await toolExecutor.execute(context.toolName, args, { callId: context.callId, configId: 'test', projectId: TEST_PROJ })
    return result
  })

  // Get tools
  const schemas = toolRegistry.getAllSchemas()
  const coreNames = new Set(['read_file', 'create_file', 'edit_file', 'delete_file', 'list_directory', 'search_content', 'tool_search'])
  const tools = schemas.filter(s => coreNames.has(s.function.name))
  runtime.setTools(tools)
  runtime.setHistory([])

  const start = Date.now()
  const result = await runtime.run({ userMessage: fullMessage, attachments: [] })
  const elapsed = ((Date.now() - start) / 1000).toFixed(1)
  abort.abort()

  const toolNames = result.toolCallSteps?.map(s => s.tool) || []
  const verdict = verify(result, toolNames, elapsed)

  console.log(`  ${verdict.pass ? '✅' : '❌'} ${verdict.reason} | ${elapsed}s | ${result.iterationCount}轮 | 工具:[${toolNames.join(',')}] | tokens:${result.totalTokens}`)
  // Show tool detail if failed
  if (!verdict.pass && result.toolCallSteps) {
    for (const s of result.toolCallSteps.slice(-3)) {
      console.log(`    🔧 ${s.tool}: ${s.summary}${s.status === 'error' ? ' ❌' : ''}`)
    }
  }
  return { ...result, toolNames, verdict: verdict.pass, name, elapsed }
}

async function main() {
  console.log('═══════════════════════════════════════')
  console.log(' v3 真实 Runtime 直接调用测试')
  console.log(` 模型: ${MODEL}`)
  console.log(` Prompt: ${buildSystemPrompt().length} chars`)
  console.log('═══════════════════════════════════════')

  const results = []

  // ═══ 分支1: 纯对话 (3 tests) ═══
  console.log('\n━━━ 分支1: 纯对话 ━━━')

  let r = await test('T1-寒暄', '你好，请你用一句话介绍一下自己。', (r, tools) => ({
    pass: tools.length === 0 && r.iterationCount <= 2,
    reason: tools.length === 0 ? `纯文字(${r.iterationCount}轮,0工具,${r.totalTokens}tok)` : `调了工具:${tools.join(',')}`
  }))
  results.push(r)

  r = await test('T2-对话分析', '帮我想一个修仙小说里的反派角色，要有深度和反转。只需要文字描述，不要创建文件。', (r, tools) => ({
    pass: tools.length === 0,
    reason: tools.length === 0 ? `纯文字(${r.iterationCount}轮,${r.totalTokens}tok)` : `调了工具:${tools.join(',')}`
  }))
  results.push(r)

  r = await test('T3-对话分析2', '这个修仙世界观里，元婴期修士能活多久？给我一些设定建议。', (r, tools) => ({
    pass: tools.length === 0 && r.iterationCount <= 2,
    reason: tools.length === 0 ? `纯文字(${r.iterationCount}轮,${r.totalTokens}tok)` : `调了工具:${tools.join(',')}`
  }))
  results.push(r)

  // ═══ 分支2: 对话转化 (2 tests) ═══
  console.log('\n━━━ 分支2: 对话转化 ━━━')

  r = await test('T4-对话→创建角色卡', `在项目${TEST_PROJ}中创建角色卡文件。角色名柳如烟，女性，反派，魔道卧底在正道宗门，表面温柔实则心狠手辣。`, (r, tools) => {
    let fileCreated = false
    try {
      const files = fs.readdirSync(path.join(TEST_DIR, 'characters'))
      fileCreated = files.some(f => f.includes('柳') || f.includes('如烟'))
    } catch {}
    return {
      pass: fileCreated || tools.some(t => t === 'create_file'),
      reason: fileCreated ? '角色卡已写入磁盘' : `未创建文件 (轮:${r.iterationCount}, 工具:${tools.join(',')})`
    }
  })
  results.push(r)

  r = await test('T5-对话→追加世界观', `把我下面这个设定追加到项目${TEST_PROJ}的大纲 worldbuilding.md 文件中：这个世界叫"灵脉大陆"，修炼者通过打通体内灵脉来提升境界，共有九转灵脉。`, (r, tools) => {
    let hasAppend = false
    try {
      const c = fs.readFileSync(path.join(TEST_DIR, 'outline', 'worldbuilding.md'), 'utf-8')
      hasAppend = c.includes('灵脉')
    } catch {}
    return {
      pass: hasAppend || tools.some(t => t === 'edit_file' || t === 'create_file'),
      reason: hasAppend ? '设定已写入worldbuilding.md' : `未写入 (工具:${tools.join(',')}, tok:${r.totalTokens})`
    }
  })
  results.push(r)

  // ═══ 分支3: 混合模式 (2 tests) ═══
  console.log('\n━━━ 分支3: 混合模式 ━━━')

  const chapterText = '林逸站在演武场中央，四周弟子的窃窃私语如潮水般涌来。他的对手是首席弟子陈啸天。金丹期的威压碾压而来，林逸咬牙死死撑住。突然一道青芒从他丹田炸开——上古剑魂觉醒了。全场震惊。'

  r = await test('T6-混合·分析+摘要', `分析下面这段文字，然后生成章节摘要保存到项目${TEST_PROJ}的 summaries/chapter1.md："${chapterText}"`, (r, tools) => {
    let fileCreated = false, fileContent = ''
    try {
      const files = fs.readdirSync(path.join(TEST_DIR, 'summaries'))
      if (files.length > 0) {
        fileContent = fs.readFileSync(path.join(TEST_DIR, 'summaries', files[0]), 'utf-8')
        fileCreated = fileContent.length > 50
      }
    } catch {}
    return {
      pass: fileCreated,
      reason: fileCreated ? `摘要已写入(${fileContent.length}字)` : `未创建 (工具:${tools.join(',')}, 轮:${r.iterationCount})`
    }
  })
  results.push(r)

  r = await test('T7-混合·分析+细纲', `分析这段文字并生成细纲YAML保存到项目${TEST_PROJ}的 detailed_outline/chapter1.yaml："${chapterText}"`, (r, tools) => {
    let fileCreated = false, fileContent = ''
    try {
      const files = fs.readdirSync(path.join(TEST_DIR, 'detailed_outline'))
      if (files.length > 0) {
        fileContent = fs.readFileSync(path.join(TEST_DIR, 'detailed_outline', files[0]), 'utf-8')
        fileCreated = fileContent.includes('plotOverview') || fileContent.includes('keyEvents')
      }
    } catch {}
    return {
      pass: fileCreated,
      reason: fileCreated ? '细纲YAML已写入磁盘' : `未创建 (工具:${tools.join(',')})`
    }
  })
  results.push(r)

  // ═══ 分支4: 创作模式 (1 test) ═══
  console.log('\n━━━ 分支4: 创作模式 ━━━')

  r = await test('T8-创作·写章节', `帮我在项目${TEST_PROJ}写第1章正文。主角林逸是剑修，在宗门大比中觉醒剑魂。200字左右。保存到 chapters/chapter1.txt。`, (r, tools) => {
    let fileCreated = false, wordCount = 0
    try {
      const files = fs.readdirSync(path.join(TEST_DIR, 'chapters'))
      if (files.length > 0) {
        const c = fs.readFileSync(path.join(TEST_DIR, 'chapters', files[0]), 'utf-8')
        wordCount = c.length
        fileCreated = wordCount > 50
      }
    } catch {}
    return {
      pass: fileCreated,
      reason: fileCreated ? `章节已写入(${wordCount}字)` : `未创建 (工具:${tools.join(',')})`
    }
  })
  results.push(r)

  // ═══ 汇总 ═══
  console.log('\n═══════════════════════════════════════')
  console.log('                   结 果 汇 总')
  console.log('═══════════════════════════════════════')

  let totalTokens = 0
  console.log(`\n| 场景 | 轮数 | 工具 | tokens | 判定 |`)
  console.log('|------|:--:|------|:-----:|:--:|')
  for (const r of results) {
    console.log(`| ${r.name} | ${r.iterationCount} | [${r.toolNames.slice(0,2).join(',')}] | ${r.totalTokens} | ${r.verdict ? '✅' : '❌'} |`)
    totalTokens += r.totalTokens
  }

  const pass = results.filter(r => r.verdict).length
  console.log(`\n通过: ${pass}/${results.length}`)
  console.log(`总tokens: ${totalTokens} | 平均: ${Math.round(totalTokens/results.length)}`)
}

main().then(() => {
  console.log('\n✅ 测试完成')
  process.exit(0)
}).catch(e => {
  console.error('❌', e.message)
  process.exit(1)
})
