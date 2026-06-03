#!/usr/bin/env node
/**
 * Anthropic 协议 CLI 仿真测试
 *
 * 直接调用 DeepSeek /anthropic/v1/messages 端点，
 * 模拟 V4AnthropicRuntime 的完整 Agent 循环。
 *
 * 运行: node scripts/anthropic-sim-test.mjs
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_ROOT = path.resolve(__dirname, '..')
const PROJECTS_DIR = path.join(APP_ROOT, 'projects')

// ── 配置 ──
const API_KEY = process.env.AI_API_KEY || 'sk-your-key-here'
const API_BASE = 'https://api.deepseek.com'
const ANTHROPIC_URL = `${API_BASE}/anthropic/v1/messages`
const MODEL = 'deepseek-chat'  // deepseek-chat 支持 tool_use; deepseek-reasoner 不支持 tool_choice
const MAX_ITERATIONS = 8
const TOOL_TIMEOUT = 60_000

// ── 测试结果记录 ──
const results = []
let testCount = 0
let passCount = 0

function record(name, passed, detail = '') {
  testCount++
  if (passed) passCount++
  results.push({ name, passed, detail })
  const icon = passed ? '✅' : '❌'
  console.log(`  ${icon} ${name}${detail ? ': ' + detail : ''}`)
}

// ── 工具实现 ──
const tools = {
  read_file: async (args) => {
    let fp = args.file_path || args.path || ''
    // 安全：只允项目目录内的路径
    if (fp.includes('..')) return { status: 'error', summary: '路径遍历被拦截' }
    const fullPath = path.join(PROJECTS_DIR, fp)
    try {
      const content = fs.readFileSync(fullPath, 'utf-8')
      const preview = content.length > 2000 ? content.slice(0, 2000) + `\n…(共${content.length}字)` : content
      return { status: 'success', summary: `读取 ${fp} (${content.length}字)`, detail: preview }
    } catch (e) {
      return { status: 'error', summary: `文件不存在: ${fp}` }
    }
  },
  list_directory: async (args) => {
    let dir = args.path || args.dir_path || '.'
    if (dir.includes('..')) return { status: 'error', summary: '路径遍历被拦截' }
    const fullPath = path.join(PROJECTS_DIR, dir)
    try {
      const entries = fs.readdirSync(fullPath, { withFileTypes: true })
      const pattern = args.pattern
      let list = entries.map(e => `${e.isDirectory() ? '📁' : '📄'} ${e.name}`)
      if (pattern) {
        const re = new RegExp(pattern.replace(/\*/g, '.*').replace(/\?/g, '.'))
        list = list.filter(f => re.test(f))
      }
      return { status: 'success', summary: `${list.length}个条目`, detail: list.join('\n') }
    } catch (e) {
      return { status: 'error', summary: `目录不存在: ${dir}` }
    }
  },
  search_content: async (args) => {
    return { status: 'success', summary: '搜索完成（仿真简化）', detail: '(搜索功能在仿真中简化)' }
  },
  kb_list: async () => {
    try {
      const kbDir = path.join(APP_ROOT, 'knowledge_base', 'files')
      const files = fs.readdirSync(kbDir)
      return { status: 'success', summary: `${files.length}个KB文件`, detail: files.join('\n') }
    } catch {
      return { status: 'success', summary: 'KB目录为空', detail: '' }
    }
  },
}

const TOOL_SCHEMAS = [
  { name: 'read_file', description: '读取文件内容', input_schema: { type: 'object', properties: { file_path: { type: 'string', description: '文件路径' } }, required: ['file_path'] } },
  { name: 'list_directory', description: '列出目录内容', input_schema: { type: 'object', properties: { path: { type: 'string', description: '目录路径' }, pattern: { type: 'string', description: 'glob模式(可选)' } }, required: ['path'] } },
  { name: 'search_content', description: '搜索文件内容', input_schema: { type: 'object', properties: { pattern: { type: 'string', description: '搜索模式' }, path: { type: 'string', description: '搜索路径(可选)' } }, required: ['pattern'] } },
  { name: 'kb_list', description: '列出知识库文件', input_schema: { type: 'object', properties: {}, required: [] } },
]

const SYSTEM_PROMPT = `你是"青剑"，AI小说创作助手。你可以使用工具操作项目文件。

# 铁律
- 你必须使用 function calling 能力来调用工具
- 口头描述不等于操作完成
- 调用工具是唯一完成任务的方式

# 文件路径
- 角色: {项目}/characters/{中文名}.json   例: 1/characters/林雨晴.json
- 章节: {项目}/chapters/chapter{N}.txt    例: 1/chapters/chapter3.txt
- 大纲: {项目}/outline/plot.md            例: 1/outline/plot.md
- KB文件: ../../knowledge_base/files/{文件名}.md

# 可用工具
- list_directory: 列出目录
- read_file: 读取文件
- search_content: 搜索文件内容
- kb_list: 列出知识库文件

# 规则
- 回复简洁，只输出必要的摘要
- 已知文件路径直接读，不需要先列目录`

// ── Anthropic API 调用 ──
async function callAnthropic(system, messages, toolDefs) {
  const body = {
    model: MODEL,
    system: [{ type: 'text', text: system }],
    messages,
    max_tokens: 2048,
    stream: true,
  }
  if (toolDefs && toolDefs.length > 0) {
    body.tools = toolDefs
  }

  const response = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const err = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status}: ${err.slice(0, 200)}`)
  }

  const raw = await response.text()
  return parseSSE(raw)
}

function parseSSE(text) {
  let fullText = ''
  const toolUses = []
  let stopReason = 'end_turn'
  const contentBlocks = []

  const chunks = text.split(/\n\n/)
  for (const chunk of chunks) {
    if (!chunk.trim()) continue
    const lines = chunk.split('\n')
    let dataLine = ''
    let eventType = ''
    for (const line of lines) {
      if (line.startsWith('event:')) eventType = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLine = line.slice(5).trim()
    }
    if (!dataLine) continue
    try {
      const evt = JSON.parse(dataLine)
      const type = eventType || evt.type || ''

      if (type === 'content_block_start') {
        contentBlocks.push({ ...evt.content_block, index: evt.index, inputJson: '' })
      } else if (type === 'content_block_delta') {
        const idx = evt.index ?? (contentBlocks.length - 1)
        const cb = contentBlocks.find(b => b.index === idx)
        if (!cb) continue
        if (evt.delta?.type === 'text_delta') {
          cb.text = (cb.text || '') + evt.delta.text
          fullText += evt.delta.text
        }
        if (evt.delta?.type === 'input_json_delta') {
          cb.inputJson = (cb.inputJson || '') + evt.delta.partial_json
          try { cb.input = JSON.parse(cb.inputJson) } catch {}
        }
      } else if (type === 'content_block_stop') {
        const idx = evt.index ?? (contentBlocks.length - 1)
        const cb = contentBlocks.find(b => b.index === idx)
        if (cb?.type === 'tool_use') {
          toolUses.push({ id: cb.id, name: cb.name, input: cb.input || {} })
        }
      } else if (type === 'message_delta') {
        stopReason = evt.delta?.stop_reason || stopReason
      }
    } catch {}
  }

  return { text: fullText, toolUses, stopReason }
}

// ── Agent 循环 ──
async function runAgent(userMessage, systemPrompt, history = []) {
  const messages = [...history, { role: 'user', content: [{ type: 'text', text: userMessage }] }]
  let iterations = 0
  let totalToolCalls = 0
  let totalText = ''
  const toolSteps = []

  while (iterations < MAX_ITERATIONS) {
    iterations++
    console.log(`\n  ── 迭代 ${iterations}/${MAX_ITERATIONS} ──`)

    const result = await callAnthropic(systemPrompt, messages, TOOL_SCHEMAS)

    if (result.text) {
      totalText = result.text
      process.stdout.write(`  📝 AI: ${result.text.slice(0, 200)}${result.text.length > 200 ? '...' : ''}\n`)
    }

    if (result.toolUses.length === 0) {
      console.log(`  🛑 停止原因: ${result.stopReason}`)
      break
    }

    // 执行工具
    console.log(`  🔧 工具调用: ${result.toolUses.map(t => t.name).join(', ')}`)

    const assistantContent = []
    if (result.text) assistantContent.push({ type: 'text', text: result.text })
    for (const tu of result.toolUses) {
      assistantContent.push({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input })
      totalToolCalls++
    }
    messages.push({ role: 'assistant', content: assistantContent })

    // 执行所有工具
    const toolResults = []
    for (const tu of result.toolUses) {
      const toolFn = tools[tu.name]
      let execResult
      if (toolFn) {
        const t0 = Date.now()
        execResult = await toolFn(tu.input)
        const ms = Date.now() - t0
        toolSteps.push({ tool: tu.name, status: execResult.status, durationMs: ms })
        console.log(`    ${execResult.status === 'success' ? '✅' : '❌'} ${tu.name}: ${execResult.summary} (${ms}ms)`)
      } else {
        execResult = { status: 'error', summary: `未知工具: ${tu.name}` }
        console.log(`    ❌ ${tu.name}: 未知工具`)
      }
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: JSON.stringify(execResult),
      })
    }

    // Anthropic 要求：所有 tool_result 合并到一条 user 消息
    messages.push({ role: 'user', content: toolResults })
  }

  return { text: totalText, iterations, toolCalls: totalToolCalls, toolSteps }
}

// ── 测试用例 ──
async function runTests() {
  console.log('═══════════════════════════════════════════')
  console.log('  Anthropic 协议 CLI 仿真测试')
  console.log(`  端点: ${ANTHROPIC_URL}`)
  console.log(`  模型: ${MODEL}`)
  console.log('═══════════════════════════════════════════\n')

  // ── 测试 1: 简单对话（无工具） ──
  console.log('📋 测试 S0-1: 纯文本对话（无工具）')
  try {
    const r = await runAgent('你好，请用一句话介绍你自己', SYSTEM_PROMPT)
    record('纯文本对话 (0工具)', r.toolCalls === 0 && r.text.length > 10,
      `${r.iterations}轮 ${r.toolCalls}工具 "${r.text.slice(0, 60)}..."`)
  } catch (e) {
    record('纯文本对话', false, e.message)
  }

  // ── 测试 2: 文件读取 ──
  console.log('\n📋 测试 S1-1: 读取文件（已知路径）')
  try {
    const r = await runAgent('读取项目1的角色林雨晴，路径是 1/characters/林雨晴.json', SYSTEM_PROMPT)
    record('读取角色文件', r.toolCalls >= 1 && r.toolSteps.some(s => s.tool === 'read_file'),
      `${r.iterations}轮 ${r.toolCalls}工具 ${r.toolSteps.map(s => s.tool + (s.status !== 'success' ? '❌' : '')).join(', ')}`)
  } catch (e) {
    record('读取角色文件', false, e.message)
  }

  // ── 测试 3: 列出目录 ──
  console.log('\n📋 测试 S1-2: 列出目录')
  try {
    const r = await runAgent('列出项目1的characters目录下的所有文件', SYSTEM_PROMPT)
    record('列出目录', r.toolCalls >= 1 && r.toolSteps.some(s => s.tool === 'list_directory'),
      `${r.iterations}轮 ${r.toolCalls}工具`)
  } catch (e) {
    record('列出目录', false, e.message)
  }

  // ── 测试 4: KB操作 ──
  console.log('\n📋 测试 S5-1: 知识库列表')
  try {
    const r = await runAgent('列出知识库的所有文件', SYSTEM_PROMPT)
    record('KB列表', r.toolCalls >= 1,
      `${r.iterations}轮 ${r.toolCalls}工具`)
  } catch (e) {
    record('KB列表', false, e.message)
  }

  // ── 测试 5: 跨项目查询 ──
  console.log('\n📋 测试 S2-1: 跨项目列出角色')
  try {
    const r = await runAgent('列出项目1有哪些角色文件', SYSTEM_PROMPT)
    record('跨项目列角色', r.toolCalls >= 1,
      `${r.iterations}轮 ${r.toolCalls}工具`)
  } catch (e) {
    record('跨项目列角色', false, e.message)
  }

  // ── 测试 6: 多步骤任务 ──
  console.log('\n📋 测试 S3-1: 读大纲+列出目录（多工具）')
  try {
    const r = await runAgent('先读取项目1的大纲文件 1/outline/plot.md，然后列出项目1的characters目录', SYSTEM_PROMPT)
    record('多工具调用', r.toolCalls >= 2,
      `${r.iterations}轮 ${r.toolCalls}工具 ${r.toolSteps.map(s => s.tool).join(', ')}`)
  } catch (e) {
    record('多工具调用', false, e.message)
  }

  // ── 测试 7: 工具循环验证 ──
  console.log('\n📋 测试 S9-1: 读→分析→报告（多轮工具循环）')
  try {
    const r = await runAgent('请先列出项目1的characters目录，然后读取第一个角色文件，最后用一个摘要告诉我这个角色的基本信息', SYSTEM_PROMPT)
    record('多轮工具循环', r.toolCalls >= 2 && r.iterations >= 2,
      `${r.iterations}轮 ${r.toolCalls}工具`)
  } catch (e) {
    record('多轮工具循环', false, e.message)
  }

  // ── 汇总 ──
  console.log('\n═══════════════════════════════════════════')
  console.log('  测试汇总')
  console.log('═══════════════════════════════════════════')
  console.log(`  总计: ${testCount} | 通过: ${passCount} | 失败: ${testCount - passCount}`)
  console.log(`  通过率: ${((passCount / testCount) * 100).toFixed(0)}%\n`)

  for (const r of results) {
    console.log(`  ${r.passed ? '✅' : '❌'} ${r.name}${r.detail ? ': ' + r.detail : ''}`)
  }
}

runTests().catch(e => {
  console.error('测试异常:', e.message)
  process.exit(1)
})
