#!/usr/bin/env node
/**
 * 仿真测试: 项目+自管理 (Anthropic 协议)
 * 使用 Anthropic Messages API 替代 OpenAI chat/completions。
 *
 * 关键差异:
 *   - system 作为顶层参数传递（非 message）
 *   - 消息使用 content 数组格式 [{type:'text',text:...}, {type:'tool_use',...}]
 *   - 工具响应作为 tool_result block 放在 user 消息中
 *   - 非流式响应: stream: false，一次获取完整 content blocks
 *
 * 场景: create_project → learn_rule → delete_project
 * 验证: 模型在 Anthropic 协议下正确执行多步骤项目操作并学习规则
 * 复杂度: medium — 3个工具链式调用 + 规则学习
 *
 * 运行: node scripts/full-sim/anthropic/06-project-harness.mjs
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

// ── 配置 ──
const API_KEY = 'sk-c9c30831df7243209435c60e811c879d'
const BASE_URL = 'https://api.deepseek.com'
const MODEL = 'deepseek-v4-flash'
const MAX_ITERATIONS = 8

const API_URL = BASE_URL + '/anthropic/v1/messages'

const ROOT = path.resolve(import.meta.dirname || '.', '..', '..', '..')
const P = p => path.join(ROOT, 'projects', p)
const N = p => path.join(ROOT, 'notes', p)
const K = p => path.join(ROOT, 'knowledge_base', 'files', p)

// ── 规则存储（模拟 learn_rule 持久化） ──
const RULES_FILE = path.join(ROOT, '.rules.json')
function loadRules() {
  try { return JSON.parse(fs.readFileSync(RULES_FILE, 'utf-8')) } catch { return {} }
}
function saveRules(rules) {
  fs.mkdirSync(path.dirname(RULES_FILE), { recursive: true })
  fs.writeFileSync(RULES_FILE, JSON.stringify(rules, null, 2))
}

console.log(`═══════════════════════════════════════════`)
console.log(`  仿真测试: 项目+自管理 (06-project-harness) — Anthropic 协议`)
console.log(`  端点: ${API_URL}`)
console.log(`  模型: ${MODEL}`)
console.log(`  模式: 非流式 — create_project → learn_rule → delete_project`)
console.log(`═══════════════════════════════════════════`)

// ── 工具实现 ──
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
    try { const fp=P(a.file_path || a.path); fs.mkdirSync(path.dirname(fp),{recursive:true}); fs.writeFileSync(fp,a.content||''); return `创建成功` } catch(e) { return `[错误: ${e.message}]` }
  },
  edit_file: a => { return '编辑成功' },
  delete_file: a => { return '删除成功' },
  kb_list: () => { try { return fs.readdirSync(K('')).filter(f=>f.endsWith('.md')).join('\n')||'无' } catch { return '无' } },
  kb_create_file: a => { try { fs.mkdirSync(K(''),{recursive:true}); fs.writeFileSync(K((a.name||'x')+'.md'),a.content||''); return '创建成功' } catch { return '[错误]' } },
  list_notes: () => { try { fs.mkdirSync(N(''),{recursive:true}); return fs.readdirSync(N('')).filter(f=>f.endsWith('.md')).join('\n')||'无' } catch { return '无' } },
  write_note: a => { try { fs.mkdirSync(N(''),{recursive:true}); fs.writeFileSync(N((a.name||'x')+'.md'),a.content||''); return '创建成功' } catch { return '[错误]' } },
  read_note: a => { try { return fs.readFileSync(N((a.name||'x')+'.md'),'utf-8').slice(0,500) } catch { return '[不存在]' } },

  // ── 项目管理工具 ──
  create_project: a => {
    try {
      const name = a.name || ''
      if (!name) return '[错误: 缺少项目名称]'
      if (/[<>:"/\\|?*]/.test(name)) return '[错误: 项目名包含非法字符]'
      const projDir = P(name)
      if (fs.existsSync(projDir)) return '[错误: 项目已存在: ' + name + ']'
      ;['characters', 'chapters', 'outline', 'detailed_outline', 'summaries'].forEach(
        sub => fs.mkdirSync(path.join(projDir, sub), { recursive: true })
      )
      return '项目 "' + name + '" 创建成功，已创建5个子目录'
    } catch (e) { return '[错误: ' + e.message + ']' }
  },

  delete_project: a => {
    try {
      const name = a.name || ''
      if (!name) return '[错误: 缺少项目名称]'
      const projDir = P(name)
      if (!fs.existsSync(projDir)) return '[错误: 项目不存在: ' + name + ']'
      fs.rmSync(projDir, { recursive: true, force: true })
      return '项目 "' + name + '" 已删除'
    } catch (e) { return '[错误: ' + e.message + ']' }
  },

  // ── 规则学习工具 ──
  learn_rule: a => {
    try {
      const rule = a.rule || a.content || ''
      if (!rule) return '[错误: 缺少规则内容]'
      const rules = loadRules()
      const key = 'rule_' + (Object.keys(rules).length + 1)
      rules[key] = { rule, timestamp: new Date().toISOString() }
      saveRules(rules)
      return '规则已学习: ' + rule.slice(0, 60) + (rule.length > 60 ? '…' : '')
    } catch (e) { return '[错误: ' + e.message + ']' }
  },
}

// ── Anthropic 格式工具定义 ──
const TOOLS = [
  { name:'read_file', description:'读取项目文件内容', input_schema:{type:'object',properties:{file_path:{type:'string'}},required:['file_path']} },
  { name:'list_directory', description:'列出目录内容。列出所有项目时path参数为"."', input_schema:{type:'object',properties:{path:{type:'string'}},required:['path']} },
  { name:'search_content', description:'搜索文件内容', input_schema:{type:'object',properties:{pattern:{type:'string'},path:{type:'string'}},required:['pattern']} },
  { name:'create_file', description:'创建文件', input_schema:{type:'object',properties:{file_path:{type:'string'},content:{type:'string'}},required:['file_path','content']} },
  { name:'edit_file', description:'编辑文件', input_schema:{type:'object',properties:{file_path:{type:'string'},old_string:{type:'string'},new_string:{type:'string'}},required:['file_path','old_string','new_string']} },
  { name:'delete_file', description:'删除文件', input_schema:{type:'object',properties:{file_path:{type:'string'}},required:['file_path']} },
  { name:'kb_list', description:'列出知识库文件', input_schema:{type:'object',properties:{}} },
  { name:'kb_create_file', description:'创建KB文件', input_schema:{type:'object',properties:{name:{type:'string'},content:{type:'string'}},required:['name','content']} },
  { name:'list_notes', description:'列出笔记', input_schema:{type:'object',properties:{}} },
  { name:'write_note', description:'创建笔记', input_schema:{type:'object',properties:{name:{type:'string'},content:{type:'string'}},required:['name','content']} },
  { name:'read_note', description:'读取笔记', input_schema:{type:'object',properties:{name:{type:'string'}},required:['name']} },
  { name:'create_project', description:'创建新项目。会自动创建characters/chapters/outline/detailed_outline/summaries子目录。', input_schema:{type:'object',properties:{name:{type:'string',description:'项目名称'}},required:['name']} },
  { name:'delete_project', description:'删除项目及其所有内容。此操作不可撤销。', input_schema:{type:'object',properties:{name:{type:'string',description:'要删除的项目名称'}},required:['name']} },
  { name:'learn_rule', description:'学习并保存一个新规则。当用户说"学习规则"/"记住"/"以后要"/"记下来"时使用。', input_schema:{type:'object',properties:{rule:{type:'string',description:'要学习的规则内容'}},required:['rule']} },
]

// ── 系统提示词 ──
const SYS = [
  '你是"青剑"，AI小说创作助手。',
  '',
  '# 铁律',
  '- 操作文件必须调用实际的 function call，口头描述 ≠ 操作完成',
  '- 禁止在文本中用 <tool_name>、[工具名]、或任何 XML/JSON 文本块来模拟工具调用',
  '- 用户要求"学习规则"时，必须调用 learn_rule 工具',
  '',
  '# 项目管理',
  '- 创建项目: create_project',
  '- 删除项目: delete_project',
  '- 列出项目: list_directory path="."',
  '',
  '# 对话风格',
  '- 用中文回复，简洁明了',
  '- 操作完成后汇报结果',
  '- 多步骤任务按顺序逐个执行',
]

// ── Anthropic API 调用（非流式） ──
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
  const PROJ_NAME = '青云纪'

  // 确保测试前清理
  try { fs.rmSync(P(PROJ_NAME), { recursive: true, force: true }) } catch {}
  try { fs.rmSync(RULES_FILE, { force: true }) } catch {}

  // ──────────────────────────────────────────────
  //  S1: 创建项目 + 学习规则 + 删除项目 (单轮复合指令)
  // ──────────────────────────────────────────────
  hr(`S1 项目+自管理 — 创建→学规则→删除 "${PROJ_NAME}"`)
  const userMsg = `创建一个新项目叫"${PROJ_NAME}"。学习一个新规则：创建项目后必须先初始化角色和大纲。然后删除"${PROJ_NAME}"项目`
  console.log(`  用户指令: ${userMsg}`)
  const r1 = await agentRun(userMsg)

  t('S1 返回文本', r1.text.length > 0, `${r1.text.length}字`)
  t('S1 工具调用总数 >= 3', r1.toolCalls >= 3, `${r1.toolCalls}次工具调用`)
  t('S1 迭代次数 <= MAX', r1.iterations <= MAX_ITERATIONS, `${r1.iterations}/${MAX_ITERATIONS}`)

  // 验证 create_project
  const createCalls = r1.toolLog.filter(l => l.name === 'create_project')
  t('S1 create_project 被调用', createCalls.length >= 1, `${createCalls.length}次`)
  const projCreated = fs.existsSync(P(PROJ_NAME))
  t('S1 项目目录已创建', projCreated, `projects/${PROJ_NAME}/`)
  if (projCreated) {
    const subs = fs.readdirSync(P(PROJ_NAME)).filter(x => {
      try { return fs.statSync(P(PROJ_NAME + '/' + x)).isDirectory() } catch { return false }
    })
    t('S1 项目包含子目录', subs.length >= 5, `${subs.length}个子目录: ${subs.join(', ')}`)
  }

  // 验证 learn_rule
  const learnCalls = r1.toolLog.filter(l => l.name === 'learn_rule')
  t('S1 learn_rule 被调用', learnCalls.length >= 1, `${learnCalls.length}次`)
  const rulesAfter = loadRules()
  const hasCreateRule = Object.values(rulesAfter).some(
    r => r.rule && r.rule.includes('角色') && r.rule.includes('大纲')
  )
  t('S1 规则内容含"角色"和"大纲"', hasCreateRule,
    Object.values(rulesAfter).map(r => r.rule).join(' | ').slice(0, 100))

  // 验证 delete_project
  const deleteCalls = r1.toolLog.filter(l => l.name === 'delete_project')
  t('S1 delete_project 被调用', deleteCalls.length >= 1, `${deleteCalls.length}次`)
  const projDeleted = !fs.existsSync(P(PROJ_NAME))
  t('S1 项目已删除', projDeleted, `projects/${PROJ_NAME}/ 不存在`)

  // 验证调用顺序: create_project 在 learn_rule 之前，learn_rule 在 delete_project 之前
  const toolNames = r1.toolLog.map(l => l.name)
  const createIdx = toolNames.indexOf('create_project')
  const learnIdx = toolNames.indexOf('learn_rule')
  const deleteIdx = toolNames.indexOf('delete_project')
  const orderOk = createIdx >= 0 && learnIdx >= 0 && deleteIdx >= 0 &&
    createIdx < learnIdx && learnIdx < deleteIdx
  t('S1 工具调用顺序: create → learn → delete', orderOk,
    toolNames.join(' → '))

  // 打印工具调用摘要
  console.log(`  工具调用链: ${toolNames.join(' → ')}`)
  console.log(`  模型回复: ${r1.text.slice(0, 150)}`)

  // ──────────────────────────────────────────────
  //  确保清理
  // ──────────────────────────────────────────────
  try { fs.rmSync(P(PROJ_NAME), { recursive: true, force: true }) } catch {}
  try { fs.rmSync(RULES_FILE, { force: true }) } catch {}

  // ──────────────────────────────────────────────
  //  汇总
  // ──────────────────────────────────────────────
  const total = pass + fail
  console.log('\n')
  console.log('═══════════════════════════════════════════')
  console.log('  仿真测试: 项目+自管理 (Anthropic 协议) — 结果')
  console.log('═══════════════════════════════════════════')
  console.log(`  ✅ ${String(pass).padStart(2)}  通过`)
  console.log(`  ❌ ${String(fail).padStart(2)}  失败`)
  console.log(`  通过率: ${total > 0 ? ((pass/total)*100).toFixed(1) : '0.0'}%`)
  console.log('')
  console.log('  场景覆盖:')
  console.log('    S1  项目+自管理  — 创建→学规则→删除 (单轮复合指令)')
  console.log('    工具: create_project + learn_rule + delete_project')
  console.log('═══════════════════════════════════════════')

  if (fail > 0) process.exit(1)
}

main().catch(e => { console.error('\n💥 异常:', e.message); process.exit(1) })
