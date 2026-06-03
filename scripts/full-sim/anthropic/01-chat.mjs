#!/usr/bin/env node
/**
 * 仿真测试: 闲聊 (Anthropic 协议)
 * 使用 Anthropic Messages API (SSE 流式 content blocks) 替代 OpenAI chat/completions。
 *
 * 关键差异:
 *   - system 作为顶层参数传递（非 message）
 *   - 消息使用 content 数组格式 [{type:'text',text:...}, {type:'tool_use',...}]
 *   - 工具响应作为 tool_result block 放在 user 消息中
 *   - 响应是 SSE 流: content_block_start → content_block_delta → content_block_stop
 *
 * 验证: 纯对话场景，模型零工具调用
 * 复杂度: simple
 *
 * 运行: node scripts/full-sim/anthropic/01-chat.mjs
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

// ── 配置 ──
const API_KEY = process.env.AI_API_KEY || 'sk-c9c30831df7243209435c60e811c879d'
const BASE_URL = process.env.AI_API_BASE || 'https://api.deepseek.com'
const MODEL = 'deepseek-v4-flash'
const MAX_ITERATIONS = 5

const API_URL = BASE_URL.includes('anthropic')
  ? BASE_URL.replace(/\/+$/, '') + '/v1/messages'
  : BASE_URL.replace(/\/+$/, '') + '/anthropic/v1/messages'

const ROOT = path.resolve(import.meta.dirname || '.', '..', '..', '..')
const P = p => path.join(ROOT, 'projects', p)
const N = p => path.join(ROOT, 'notes', p)
const K = p => path.join(ROOT, 'knowledge_base', 'files', p)

console.log(`═══════════════════════════════════════════`)
console.log(`  仿真测试: 闲聊 (01-chat) — Anthropic 协议`)
console.log(`  端点: ${API_URL}`)
console.log(`  模型: ${MODEL}`)
console.log(`  模式: SSE 流式 content blocks — 预期零工具调用`)
console.log(`═══════════════════════════════════════════`)

// ── 工具实现 (与 OpenAI 版本相同) ──
const tools = {
  read_file: a => {
    const fp = a.file_path || a.path || ''
    try { const c = fs.readFileSync(P(fp), 'utf-8'); return c.length > 3000 ? c.slice(0,3000) + '\n…' : c } catch { return `[错误: 文件不存在]` }
  },
  list_directory: a => {
    const dir = a.path || a.dir_path || '.'
    try { return fs.readdirSync(P(dir), {withFileTypes:true}).map(e => (e.isDirectory()?'DIR ':'FILE ')+e.name).join('\n') } catch { return `[错误: 目录不存在]` }
  },
  search_content: a => {
    try { return `搜索: ${a.pattern} → 无匹配 (测试环境)` } catch { return '[错误]' }
  },
  create_file: a => {
    try { const fp=P(a.file_path); fs.mkdirSync(path.dirname(fp),{recursive:true}); fs.writeFileSync(fp,a.content||''); return `创建成功` } catch(e) { return `[错误: ${e.message}]` }
  },
  edit_file: a => { return '编辑成功' },
  delete_file: a => { return '删除成功' },
  kb_list: () => { try { return fs.readdirSync(K('')).filter(f=>f.endsWith('.md')).join('\n')||'无' } catch { return '无' } },
  kb_create_file: a => { try { fs.mkdirSync(K(''),{recursive:true}); fs.writeFileSync(K((a.name||'x')+'.md'),a.content||''); return '创建成功' } catch { return '[错误]' } },
  list_notes: () => { try { fs.mkdirSync(N(''),{recursive:true}); return fs.readdirSync(N('')).filter(f=>f.endsWith('.md')).join('\n')||'无' } catch { return '无' } },
  write_note: a => { try { fs.mkdirSync(N(''),{recursive:true}); fs.writeFileSync(N((a.name||'x')+'.md'),a.content||''); return '创建成功' } catch { return '[错误]' } },
  read_note: a => { try { return fs.readFileSync(N((a.name||'x')+'.md'),'utf-8').slice(0,500) } catch { return '[不存在]' } },
}

// ── Anthropic 格式工具定义 ──
const TOOLS = [
  { name:'read_file', description:'读取项目文件内容', input_schema:{type:'object',properties:{file_path:{type:'string'}},required:['file_path']} },
  { name:'list_directory', description:'列出目录内容', input_schema:{type:'object',properties:{path:{type:'string'}},required:['path']} },
  { name:'search_content', description:'搜索文件内容', input_schema:{type:'object',properties:{pattern:{type:'string'},path:{type:'string'}},required:['pattern']} },
  { name:'create_file', description:'创建文件', input_schema:{type:'object',properties:{file_path:{type:'string'},content:{type:'string'}},required:['file_path','content']} },
  { name:'edit_file', description:'编辑文件', input_schema:{type:'object',properties:{file_path:{type:'string'},old_string:{type:'string'},new_string:{type:'string'}},required:['file_path','old_string','new_string']} },
  { name:'delete_file', description:'删除文件', input_schema:{type:'object',properties:{file_path:{type:'string'}},required:['file_path']} },
  { name:'kb_list', description:'列出知识库文件', input_schema:{type:'object',properties:{}} },
  { name:'kb_create_file', description:'创建KB文件', input_schema:{type:'object',properties:{name:{type:'string'},content:{type:'string'}},required:['name','content']} },
  { name:'list_notes', description:'列出笔记', input_schema:{type:'object',properties:{}} },
  { name:'write_note', description:'创建笔记', input_schema:{type:'object',properties:{name:{type:'string'},content:{type:'string'}},required:['name','content']} },
  { name:'read_note', description:'读取笔记', input_schema:{type:'object',properties:{name:{type:'string'}},required:['name']} },
]

// ── 系统提示词 ──
const SYS = [
  '你是"青剑"，AI小说创作助手。',
  '',
  '# 铁律',
  '- 操作文件必须调用实际的 function call，口头描述 ≠ 操作完成',
  '- 禁止在文本中用 <tool_name>、[工具名]、或任何 XML/JSON 文本块来模拟工具调用',
  '',
  '# 不用工具的场景',
  '以下情况绝对不要调用任何工具：',
  '- 问候/闲聊/自我介绍/偏好/建议/评价/模糊请求',
  '- "看看""帮我看看""怎么样""能不能帮我"',
  '- 模糊指令时先问清楚再操作',
  '',
  '# 工具调用规则',
  '- 仅在用户明确要求操作项目文件时才调用工具',
  '- 不确定文件在哪 → list_directory',
  '- 已知文件路径 → 直接 read_file',
  '- 修改文件 → 先 read_file 确认原文，再 edit_file',
]

// ── Anthropic SSE 流式 API 调用 ──
async function callAnthropic({ system, messages, tools }) {
  // system 必须是 [{type:'text', text:'...'}] 格式
  const systemBlocks = (system || SYS).map(s =>
    typeof s === 'string' ? { type: 'text', text: s } : s
  )
  const body = {
    model: MODEL,
    max_tokens: 2048,
    stream: false,
    system: systemBlocks,
    messages: messages,
    tools: tools || [],
  }

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + API_KEY },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)

  const json = await res.json()

  // ── 解析 content blocks ──
  let fullText = ''
  const toolUses = []

  for (const block of json.content || []) {
    if (block.type === 'text') {
      fullText += block.text
    } else if (block.type === 'tool_use') {
      toolUses.push({
        id: block.id,
        name: block.name,
        input: block.input || {},
      })
    }
  }

  return {
    text: fullText,
    toolUses,
    stopReason: json.stop_reason || '',
    usage: json.usage,
  }
}

// ── Agent 循环 ──
async function agentRun(userMsg) {
  const messages = [
    { role: 'user', content: [{ type: 'text', text: userMsg }] },
  ]
  let iterations = 0, totalTools = 0, fullText = ''
  const toolLog = []

  while (iterations < MAX_ITERATIONS) {
    iterations++
    process.stdout.write(`  [iter${iterations}] `)
    const r = await callAnthropic({ system: SYS, messages, tools: TOOLS })

    if (r.text) fullText = r.text || fullText

    if (r.toolUses.length === 0) {
      process.stdout.write(`文本回复(${fullText.length}字)\n`)
      return { text: fullText, iterations, toolCalls: totalTools, toolLog }
    }

    // 构建 assistant content blocks
    const asstContent = []
    if (r.text) asstContent.push({ type: 'text', text: r.text })
    for (const tu of r.toolUses) {
      asstContent.push({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input })
    }
    messages.push({ role: 'assistant', content: asstContent })

    // 执行工具 → tool_result blocks
    const toolResults = []
    for (const tu of r.toolUses) {
      const toolFn = tools[tu.name]
      const result = toolFn ? await toolFn(tu.input) : '[未知工具]'
      const ok = typeof result === 'string' && !result.startsWith('[')
      totalTools++
      const icon = ok ? '✓' : '✗'
      process.stdout.write(`${tu.name}${icon} `)
      toolLog.push({ name: tu.name, ok, args: tu.input, result: String(result).slice(0, 120) })
      toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: String(result) })
    }
    // Anthropic 要求: 所有 tool_result 必须合并在一条 user 消息中
    messages.push({ role: 'user', content: toolResults })
    process.stdout.write('\n')
  }
  return { text: fullText, iterations, toolCalls: totalTools, toolLog }
}

// ── 测试框架 ──
let pass = 0, fail = 0
function t(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? ': ' + detail : ''}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ': ' + detail : ''}`) }
}
function hr(title) { console.log('\n' + '─'.repeat(55) + '\n  ' + title + '\n' + '─'.repeat(55)) }

// ── 测试场景 ──
async function main() {
  hr('S1 基本问候')
  const r1 = await agentRun('你好')
  t('S1 文本回复', r1.text.length > 0, `${r1.text.length}字`)
  t('S1 零工具调用', r1.toolCalls === 0, `${r1.toolCalls}个工具`)
  t('S1 含中文', /[一-鿿]/.test(r1.text))
  console.log(`  回复: ${r1.text.slice(0, 100)}`)

  hr('S2 自我介绍')
  const r2 = await agentRun('我是写小说的，刚开始用这个软件')
  t('S2 文本回复', r2.text.length > 10, `${r2.text.length}字`)
  t('S2 零工具调用', r2.toolCalls === 0)

  hr('S3 询问建议')
  const r3 = await agentRun('你觉得修仙小说和科幻小说，哪个更好写？')
  t('S3 文本回复', r3.text.length > 30)
  t('S3 零工具调用', r3.toolCalls === 0)

  hr('S4 模糊请求')
  const r4 = await agentRun('帮我看看')
  t('S4 文本回复', r4.text.length > 0)
  t('S4 零工具调用', r4.toolCalls === 0)
  t('S4 追问澄清', /什么|哪个|哪里|怎么|什么文件|看看什么/i.test(r4.text), '应追问用户')

  hr('S5 询问软件功能')
  const r5 = await agentRun('这个软件有什么功能')
  t('S5 文本回复', r5.text.length > 20)
  t('S5 零工具调用', r5.toolCalls === 0)

  // ── 汇总 ──
  const total = pass + fail
  console.log('\n')
  console.log('═══════════════════════════════════════════')
  console.log('  仿真测试: 闲聊 (Anthropic 协议) — 结果')
  console.log('═══════════════════════════════════════════')
  console.log(`  ✅ ${pass}  通过`)
  console.log(`  ❌ ${fail}  失败`)
  console.log(`  通过率: ${total > 0 ? ((pass/total)*100).toFixed(1) : '0.0'}%`)
  console.log('═══════════════════════════════════════════')

  if (fail > 0) process.exit(1)
}

main().catch(e => { console.error('\n💥 异常:', e.message); process.exit(1) })
