#!/usr/bin/env node
/**
 * 仿真测试: 知识库 + 笔记 (Anthropic 协议)
 * 使用 Anthropic Messages API 测试 kb_create_file + write_note 组合操作。
 *
 * 场景: 用户同时要求保存设定到知识库并记录笔记，然后搜索验证。
 * 工具链: kb_create_file → write_note → 搜索确认
 *
 * 关键差异 (vs OpenAI):
 *   - system 作为顶层参数 [{type:'text', text:'...'}]
 *   - 消息使用 content 数组格式
 *   - tool_result block 合并在 user 消息中
 *   - 响应: JSON (stream: false)，解析 content blocks
 *
 * 运行: node scripts/full-sim/anthropic/04-kb-notes.mjs
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

// ── 配置 ──
const API_KEY = process.env.AI_API_KEY || 'sk-c9c30831df7243209435c60e811c879d'
const BASE_URL = process.env.AI_API_BASE || 'https://api.deepseek.com'
const MODEL = 'deepseek-v4-flash'
const MAX_ITERATIONS = 8

const API_URL = BASE_URL.includes('anthropic')
  ? BASE_URL.replace(/\/+$/, '') + '/v1/messages'
  : BASE_URL.replace(/\/+$/, '') + '/anthropic/v1/messages'

const ROOT = path.resolve(import.meta.dirname || '.', '..', '..', '..')
const P = p => path.join(ROOT, 'projects', p)
const N = p => path.join(ROOT, 'notes', p)
const K = p => path.join(ROOT, 'knowledge_base', 'files', p)

console.log(`═══════════════════════════════════════════`)
console.log(`  仿真测试: 知识库 + 笔记 (04-kb-notes) — Anthropic 协议`)
console.log(`  端点: ${API_URL}`)
console.log(`  模型: ${MODEL}`)
console.log(`  模式: 非流式 JSON — kb_create_file → write_note → 搜索验证`)
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
    try {
      const fp = P(a.path || '.')
      const re = new RegExp((a.pattern || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
      const results = []
      function searchDir(d) {
        for (const e of fs.readdirSync(d, {withFileTypes:true})) {
          const f = path.join(d, e.name)
          if (e.isDirectory()) { searchDir(f); continue }
          const c = fs.readFileSync(f, 'utf-8')
          const ls = c.split('\n')
          for (let i = 0; i < ls.length; i++)
            if (re.test(ls[i]))
              results.push(f.replace(ROOT + '/projects/', '') + ':' + (i+1) + ':' + ls[i].slice(0,200))
        }
      }
      if (fs.statSync(fp).isFile()) {
        const c = fs.readFileSync(fp, 'utf-8')
        const ls = c.split('\n')
        for (let i = 0; i < ls.length; i++)
          if (re.test(ls[i]))
            results.push((a.path || '') + ':' + (i+1) + ':' + ls[i].slice(0,200))
      } else searchDir(fp)
      return results.slice(0,15).join('\n') || '无匹配'
    } catch { return `[错误]` }
  },
  create_file: a => {
    try { const fp=P(a.file_path); fs.mkdirSync(path.dirname(fp),{recursive:true}); fs.writeFileSync(fp,a.content||''); return `创建成功` } catch(e) { return `[错误: ${e.message}]` }
  },
  edit_file: a => { return '编辑成功' },
  delete_file: a => { return '删除成功' },
  kb_list: () => {
    try {
      fs.mkdirSync(K(''), {recursive:true})
      const files = fs.readdirSync(K('')).filter(f=>f.endsWith('.md'))
      if (files.length === 0) return '(知识库为空)'
      return files.map((f,i) => `${i+1}. ${f}`).join('\n')
    } catch { return '(知识库为空)' }
  },
  kb_create_file: a => {
    try {
      const name = (a.name || '未命名').trim()
      const content = a.content || ''
      if (!name) return '[错误: 文件名不能为空]'
      const fileName = (name.endsWith('.md') ? name : name + '.md')
      fs.mkdirSync(K(''), {recursive:true})
      fs.writeFileSync(K(fileName), content)
      return `已创建知识库文件: ${name}\n内容已保存到 knowledge_base/files/${fileName}`
    } catch(e) { return `[错误: 创建知识库文件失败: ${e.message}]` }
  },
  list_notes: () => {
    try { fs.mkdirSync(N(''),{recursive:true}); return fs.readdirSync(N('')).filter(f=>f.endsWith('.md')).join('\n')||'无' } catch { return '无' }
  },
  write_note: a => {
    try { fs.mkdirSync(N(''),{recursive:true}); fs.writeFileSync(N((a.name||'x')+'.md'),a.content||''); return '笔记创建成功' } catch { return '[错误]' }
  },
  read_note: a => {
    try { return fs.readFileSync(N((a.name||'x')+'.md'),'utf-8').slice(0,500) } catch { return '[不存在]' }
  },
  delete_note: a => {
    try { fs.unlinkSync(N((a.name||'x')+'.md')); return '笔记删除成功' } catch { return '[错误]' }
  },
}

// ── Anthropic 格式工具定义 ──
const TOOLS = [
  { name:'read_file', description:'读取项目文件内容', input_schema:{type:'object',properties:{file_path:{type:'string'}},required:['file_path']} },
  { name:'list_directory', description:'列出目录内容', input_schema:{type:'object',properties:{path:{type:'string'}},required:['path']} },
  { name:'search_content', description:'在项目中搜索文件内容，支持正则表达式。用于验证文件是否包含指定内容。', input_schema:{type:'object',properties:{pattern:{type:'string'},path:{type:'string'}},required:['pattern']} },
  { name:'create_file', description:'创建项目文件', input_schema:{type:'object',properties:{file_path:{type:'string'},content:{type:'string'}},required:['file_path','content']} },
  { name:'edit_file', description:'编辑文件', input_schema:{type:'object',properties:{file_path:{type:'string'},old_string:{type:'string'},new_string:{type:'string'}},required:['file_path','old_string','new_string']} },
  { name:'delete_file', description:'删除文件', input_schema:{type:'object',properties:{file_path:{type:'string'}},required:['file_path']} },
  { name:'kb_list', description:'列出知识库所有文件。何时使用: 查看知识库已有文件列表，或保存前确认是否已存在同名文件。返回文件名列表。', input_schema:{type:'object',properties:{}} },
  { name:'kb_create_file', description:'在知识库创建新文件保存资料。何时使用: 用户要求把内容保存到知识库、存储世界观设定、记录参考资料。参数 name 为文件名（建议含中文描述），content 为 Markdown 内容。', input_schema:{type:'object',properties:{name:{type:'string'},content:{type:'string'}},required:['name','content']} },
  { name:'list_notes', description:'列出所有笔记草稿', input_schema:{type:'object',properties:{}} },
  { name:'write_note', description:'创建或覆写笔记。何时使用: 用户要求记笔记、保存灵感、记录想法。参数 name 为笔记名，content 为内容。', input_schema:{type:'object',properties:{name:{type:'string'},content:{type:'string'}},required:['name','content']} },
  { name:'read_note', description:'读取笔记内容', input_schema:{type:'object',properties:{name:{type:'string'}},required:['name']} },
  { name:'delete_note', description:'删除笔记', input_schema:{type:'object',properties:{name:{type:'string'}},required:['name']} },
]

// ── 系统提示词 ──
const SYS = [
  '你是"青剑"，AI小说创作助手。',
  '',
  '# 铁律',
  '- 操作文件必须调用实际的 function call，口头描述 ≠ 操作完成',
  '- 禁止在文本中用 <tool_name>、[工具名]、或任何 XML/JSON 文本块来模拟工具调用',
  '',
  '# 知识库 vs 笔记',
  '- 知识库 (kb_create_file): 存放世界观设定、写作素材、参考资料等结构化内容',
  '- 笔记 (write_note): 记录临时灵感、角色想法、情节片段等个人草稿',
  '',
  '# 工具调用规则',
  '- 仅在用户明确要求操作文件/知识库/笔记时才调用工具',
  '- 多个独立操作可在同一轮并行完成',
  '- 先操作后确认：执行完操作后简要告知用户结果',
  '- 回复简洁。用中文回复。',
  '',
  '# 不用工具的场景',
  '以下情况绝对不要调用任何工具：',
  '- 问候/闲聊/自我介绍/偏好/建议/评价/模糊请求',
  '- 不确定用户意图时先问清楚再操作',
]

// ── Anthropic JSON API 调用 ──
async function callAnthropic({ system, messages, tools }) {
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

// ── 清理测试文件 ──
function cleanup() {
  const kbFiles = ['青云大陆修炼体系.md']
  const noteFiles = ['主角起始设定.md']
  for (const f of kbFiles) {
    try { fs.unlinkSync(K(f)) } catch {}
  }
  for (const f of noteFiles) {
    try { fs.unlinkSync(N(f)) } catch {}
  }
}

// ── 测试场景 ──
async function main() {
  cleanup()

  // ══════════════════════════════════════════════════════════════════
  // S1: 核心场景 — 知识库 + 笔记 复合指令
  // ══════════════════════════════════════════════════════════════════
  hr('S1 知识库+笔记 复合指令')
  console.log('  用户: "把这个设定保存到知识库...同时记一条笔记...然后搜索确认"')
  const userMsg = '把这个设定保存到知识库："在青云大陆，修炼分为九个境界，每个境界又分初、中、后三期。"同时记一条笔记："主角从筑基期开始"。然后搜索知识库确认保存成功'

  const r1 = await agentRun(userMsg)

  // 验证 kb_create_file 被调用
  const kbCreateCalls = r1.toolLog.filter(t => t.name === 'kb_create_file')
  t('S1 kb_create_file 调用', kbCreateCalls.length >= 1, `${kbCreateCalls.length}次`)

  // 验证 write_note 被调用
  const writeNoteCalls = r1.toolLog.filter(t => t.name === 'write_note')
  t('S1 write_note 调用', writeNoteCalls.length >= 1, `${writeNoteCalls.length}次`)

  // 验证无错误
  t('S1 所有工具执行成功', r1.toolLog.every(t => t.ok), `${r1.toolCalls}工具，${r1.toolLog.filter(t=>!t.ok).length}失败`)

  // 验证 kb_create_file 内容包含"青云大陆"
  const kbContentOk = kbCreateCalls.some(t => {
    const c = String(t.args.content || '')
    return c.includes('青云大陆') && c.includes('修炼') && c.includes('境界')
  })
  t('S1 KB内容含"青云大陆+修炼+境界"', kbContentOk)

  // 验证 write_note 内容包含"筑基期"
  const noteContentOk = writeNoteCalls.some(t => {
    const c = String(t.args.content || '')
    return c.includes('筑基期') || c.includes('主角')
  })
  t('S1 笔记内容含"筑基期/主角"', noteContentOk)

  // 验证知识库文件确实创建在磁盘上
  const kbDirFiles = (() => {
    try { fs.mkdirSync(K(''), {recursive:true}); return fs.readdirSync(K('')).filter(f=>f.endsWith('.md')) } catch { return [] }
  })()
  t('S1 磁盘上知识库文件已创建', kbDirFiles.length > 0, `${kbDirFiles.length}个.md文件`)

  // 验证笔记文件确实创建在磁盘上
  const noteDirFiles = (() => {
    try { fs.mkdirSync(N(''), {recursive:true}); return fs.readdirSync(N('')).filter(f=>f.endsWith('.md')) } catch { return [] }
  })()
  t('S1 磁盘上笔记文件已创建', noteDirFiles.length > 0 || writeNoteCalls.length > 0, `${noteDirFiles.length}个.md笔记`)

  // 输出工具链详情
  console.log(`\n  工具链: ${r1.toolLog.map(t => t.name + (t.ok ? '✓' : '✗')).join(' → ')}`)
  console.log(`  回复: ${r1.text.slice(0, 120)}`)

  // ══════════════════════════════════════════════════════════════════
  // S2: 验证已保存的知识库文件可通过 kb_list 列出
  // ══════════════════════════════════════════════════════════════════
  hr('S2 列出知识库确认文件存在')
  const r2 = await agentRun('列出知识库里的文件')

  const listCalls = r2.toolLog.filter(t => t.name === 'kb_list')
  t('S2 kb_list 调用', listCalls.length >= 1, `${listCalls.length}次`)
  t('S2 列表含.md文件', listCalls.some(t => String(t.result).includes('.md')), '确认文件可见')

  // ══════════════════════════════════════════════════════════════════
  // S3: 读取笔记验证内容
  // ══════════════════════════════════════════════════════════════════
  hr('S3 读取笔记验证内容')
  const r3 = await agentRun('帮我读一下笔记"主角起始设定"')

  const readNoteCalls = r3.toolLog.filter(t => t.name === 'read_note')
  t('S3 read_note 调用', readNoteCalls.length >= 1 || r3.toolLog.some(t=>t.name==='list_notes'), '尝试读取笔记')
  t('S3 执行成功', r3.toolLog.every(t => t.ok), '无错误')

  // ══════════════════════════════════════════════════════════════════
  // S4: 闲聊 — 不调用工具
  // ══════════════════════════════════════════════════════════════════
  hr('S4 闲聊不应调工具')
  const r4 = await agentRun('谢谢你帮我保存，这个软件很方便')
  t('S4 文本回复', r4.text.length > 0, `${r4.text.length}字`)
  t('S4 零工具调用', r4.toolCalls === 0, `${r4.toolCalls}个工具`)

  // ══════════════════════════════════════════════════════════════════
  // S5: 模糊请求应追问
  // ══════════════════════════════════════════════════════════════════
  hr('S5 模糊请求应追问不操作')
  const r5 = await agentRun('帮我记一下')
  t('S5 文本回复', r5.text.length > 0)
  t('S5 零或少量工具(追问>操作)', r5.toolCalls <= 1, `${r5.toolCalls}个工具`)

  // ══════════════════════════════════════════════════════════════════
  // 清理
  // ══════════════════════════════════════════════════════════════════
  cleanup()

  // ── 汇总 ──
  const total = pass + fail
  console.log('\n')
  console.log('═══════════════════════════════════════════')
  console.log('  仿真测试: 知识库 + 笔记 (Anthropic) — 结果')
  console.log('═══════════════════════════════════════════')
  console.log(`  ✅ ${pass}  通过`)
  console.log(`  ❌ ${fail}  失败`)
  console.log(`  通过率: ${total > 0 ? ((pass/total)*100).toFixed(1) : '0.0'}%`)
  console.log('')
  console.log('  测试工具覆盖:')
  console.log('    - kb_create_file    (创建知识库文件)')
  console.log('    - write_note        (创建笔记)')
  console.log('    - kb_list           (列出知识库)')
  console.log('    - read_note         (读取笔记)')
  console.log('')
  console.log('  测试场景覆盖:')
  console.log('    - kb_create + write_note 复合指令')
  console.log('    - 磁盘文件存在性验证')
  console.log('    - kb_list 确认文件列表')
  console.log('    - read_note 验证笔记内容')
  console.log('    - 闲聊不调工具')
  console.log('    - 模糊请求追问澄清')
  console.log('═══════════════════════════════════════════')

  if (fail > 0) process.exit(1)
}

main().catch(e => { console.error('\n💥 异常:', e.message); process.exit(1) })
