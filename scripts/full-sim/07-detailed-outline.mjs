#!/usr/bin/env node
/**
 * 仿真测试: 细纲创作
 * 模拟用户打开AI写作助手，进行真实的细纲创建对话。
 *
 * 场景: 用户需要为小说项目创建 detailed_outline JSON 和 summaries MD
 * 复杂度: complex (4-8轮, 3-6个工具)
 * 涉及工具: read_file, create_file
 *
 * 运行: node scripts/full-sim/07-detailed-outline.mjs
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_ROOT = path.resolve(__dirname, '..', '..')
const PROJECTS_DIR = path.join(APP_ROOT, 'projects')

// ── 配置 ──
const API_KEY = process.env.AI_API_KEY || 'sk-c9c30831df7243209435c60e811c879d'
const API_URL = 'https://api.deepseek.com/v1/chat/completions'
const MODEL = 'deepseek-v4-flash'
const MAX_ITERATIONS = 10
const ROOT = APP_ROOT
const P = p => path.join(ROOT, 'projects', p)
const N = p => path.join(ROOT, 'notes', p)
const K = p => path.join(ROOT, 'knowledge_base/files', p)

// ── 工具实现（与 openai-sim-test.mjs 相同模式）──
const tools = {
  read_file: a => {
    try {
      const fp = a.file_path || a.path
      if (!fp) return `[错误: 缺少 file_path 参数]`
      const fullPath = P(fp)
      const c = fs.readFileSync(fullPath, 'utf-8')
      return c.length > 3000 ? c.slice(0, 3000) + '\n…(' + c.length + '字)' : c
    } catch (e) {
      return `[错误: 文件不存在 - ${a.file_path || a.path}]`
    }
  },
  list_directory: a => {
    try {
      const fp = a.path || '.'
      const fullPath = P(fp)
      const e = fs.readdirSync(fullPath, { withFileTypes: true })
      return e.map(x => (x.isDirectory() ? 'DIR  ' : 'FILE ') + x.name).join('\n')
    } catch (e) {
      return `[错误: 目录不存在]`
    }
  },
  search_content: a => {
    try {
      const fp = P(a.path || '.')
      const pattern = a.pattern || ''
      if (!pattern) return '[错误: 缺少搜索关键词]'
      const re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
      const results = []
      function searchDir(d) {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const f = path.join(d, e.name)
          if (e.isDirectory()) { searchDir(f); continue }
          try {
            const c = fs.readFileSync(f, 'utf-8')
            const ls = c.split('\n')
            for (let i = 0; i < ls.length; i++) if (re.test(ls[i])) results.push(f.replace(ROOT + '/projects/', '') + ':' + (i + 1) + ':' + ls[i].slice(0, 200))
          } catch {}
        }
      }
      if (fs.statSync(fp).isFile()) {
        const c = fs.readFileSync(fp, 'utf-8')
        const ls = c.split('\n')
        for (let i = 0; i < ls.length; i++) if (re.test(ls[i])) results.push((a.path || '') + ':' + (i + 1) + ':' + ls[i].slice(0, 200))
      } else searchDir(fp)
      return results.slice(0, 15).join('\n') || '无匹配'
    } catch (e) {
      return '[错误: 搜索失败]'
    }
  },
  create_file: a => {
    try {
      const fp = a.file_path || a.path
      if (!fp) return `[错误: 缺少 file_path 参数]`
      const c = a.content || ''
      // JSON 文件自动校验格式
      if (fp.endsWith('.json') && c) {
        try { JSON.parse(c) } catch (e) { return `[JSON格式错误: ${e.message}]` }
      }
      const fullPath = P(fp)
      fs.mkdirSync(path.dirname(fullPath), { recursive: true })
      fs.writeFileSync(fullPath, c, 'utf-8')
      return `创建成功: ${a.file_path}`
    } catch (e) {
      return `[错误: ${e.message}]`
    }
  },
  edit_file: a => {
    try {
      const fullPath = P(a.file_path)
      let c = fs.readFileSync(fullPath, 'utf-8')
      const old = a.old_string || ''
      const nw = a.new_string || ''
      if (old === '__FULL_REPLACE__') {
        fs.writeFileSync(fullPath, nw, 'utf-8')
        return '全量替换成功'
      }
      let idx = c.indexOf(old)
      if (idx < 0) idx = c.indexOf(old.trim())
      if (idx < 0) return `[未找到匹配文本]`
      fs.writeFileSync(fullPath, c.slice(0, idx) + nw + c.slice(idx + old.length), 'utf-8')
      return '编辑成功'
    } catch (e) {
      return `[错误: ${e.message}]`
    }
  },
  delete_file: a => {
    try { fs.unlinkSync(P(a.file_path)); return '删除成功' } catch (e) { return `[错误: ${e.message}]` }
  },
  create_project: a => {
    try {
      const d = P(a.name)
      ;['characters', 'chapters', 'outline', 'detailed_outline', 'summaries'].forEach(s =>
        fs.mkdirSync(path.join(d, s), { recursive: true }))
      return `项目${a.name}创建成功`
    } catch (e) { return `[错误: ${e.message}]` }
  },
  list_notes: () => { try { fs.mkdirSync(N(''), { recursive: true }); return fs.readdirSync(N('')).filter(f => f.endsWith('.md')).join('\n') || '无笔记' } catch { return '无笔记' } },
  write_note: a => { try { fs.mkdirSync(N(''), { recursive: true }); fs.writeFileSync(N((a.name || 'x') + '.md'), a.content || '', 'utf-8'); return '笔记创建成功' } catch (e) { return `[错误]` } },
  read_note: a => { try { return fs.readFileSync(N((a.name || 'x') + '.md'), 'utf-8').slice(0, 500) } catch { return '[笔记不存在]' } },
  list_prompts: () => '灵感/世界观/角色/大纲/细纲/章节/润色/续写/改写/摘要/审稿',
  list_rules: () => '暂无自定义规则',
  learn_rule: () => '规则已学习',
  kb_list: () => { try { return fs.readdirSync(K('')).filter(f => f.endsWith('.md')).join('\n') || '无KB文件' } catch { return '无KB文件' } },
}

// ── OpenAI 工具定义（与 openai-sim-test.mjs 相同）──
const TOOLS = [
  { type: 'function', function: { name: 'read_file', description: '读取项目文件内容。修改前必须先读。', parameters: { type: 'object', properties: { file_path: { type: 'string', description: '文件相对路径，如 1/detailed_outline/chapter1.yaml' } }, required: ['file_path'] } } },
  { type: 'function', function: { name: 'list_directory', description: '列出目录内容', parameters: { type: 'object', properties: { path: { type: 'string', description: '目录路径' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'search_content', description: '搜索文件内容。正则模式。', parameters: { type: 'object', properties: { pattern: { type: 'string', description: '搜索关键词或正则' }, path: { type: 'string', description: '搜索路径' } }, required: ['pattern'] } } },
  { type: 'function', function: { name: 'create_file', description: '创建新文件。JSON文件会自动校验格式——格式错误会返回 [JSON格式错误] 提示，需修正后重试。', parameters: { type: 'object', properties: { file_path: { type: 'string', description: '文件相对路径' }, content: { type: 'string', description: '文件完整内容。JSON文件必须为合法JSON。' } }, required: ['file_path', 'content'] } } },
  { type: 'function', function: { name: 'edit_file', description: '编辑文件。必须先 read_file 确认内容。old_string 必须精确匹配。', parameters: { type: 'object', properties: { file_path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' } }, required: ['file_path', 'old_string', 'new_string'] } } },
  { type: 'function', function: { name: 'delete_file', description: '删除文件', parameters: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] } } },
  { type: 'function', function: { name: 'list_notes', description: '列出所有笔记', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'write_note', description: '创建笔记', parameters: { type: 'object', properties: { name: { type: 'string' }, content: { type: 'string' } }, required: ['name', 'content'] } } },
  { type: 'function', function: { name: 'read_note', description: '读取笔记', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } } },
  { type: 'function', function: { name: 'create_project', description: '创建新项目目录结构', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } } },
  { type: 'function', function: { name: 'list_prompts', description: '列出可用提示词模板', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'list_rules', description: '列出已学习规则', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'learn_rule', description: '学习新规则', parameters: { type: 'object', properties: { rule: { type: 'string' } }, required: ['rule'] } } },
  { type: 'function', function: { name: 'kb_list', description: '列出知识库文件', parameters: { type: 'object', properties: {} } } },
]

// ── 系统提示词（中文，模拟真实系统提示词）──
const SYS = [
  '你是青剑AI写作助手，专注小说创作。',
  '',
  '# 铁律：何时用工具，何时不用',
  '✅ 调工具（用户要求操作文件）: 读取/列出/搜索/创建/编辑/删除/写/保存/修改/改/看(文件)/找(文件)/帮我写/帮我创建',
  '❌ 不调工具（纯对话）: 我是/我叫/我喜欢/我觉得/你好/嗨/谢谢/什么是/为什么/怎么/推荐/建议/聊天',
  '',
  '# 执行规则',
  '- 已知路径直接读文件，不列目录。修改前先读。只做用户要求的，不多做。回复简洁。',
  '- 多个独立操作可在同一轮并行完成。有依赖的操作分轮执行。',
  '- 创建JSON文件时内容必须是合法JSON，系统会自动校验。',
  '- 创建Markdown文件时内容自由，用标准MD格式。',
  '',
  '# 关键路径',
  '细纲JSON: 1/detailed_outline/chapter{N}.yaml',
  '摘要MD: 1/summaries/chapter{N}.md',
  '大纲: 1/outline/plot.md',
  '角色: 1/characters/{中文名}.yaml',
  '章节正稿: 1/chapters/chapter{N}.txt',
  '',
  '# 细纲JSON 标准格式',
  '```json',
  '{',
  '  "id": "chapter{N}",',
  '  "title": "第N章·章名",',
  '  "order": N-1,',
  '  "status": "incomplete",',
  '  "plotOverview": "本章剧情概述（一段话）",',
  '  "characters": "角色列表：姓名-身份（简要说明）",',
  '  "location": "场景地点",',
  '  "keyEvents": "关键事件列表",',
  '  "eroticContent": "情色内容说明（有则详述，无则写\\"无\\"）",',
  '  "emotionCurve": "情绪曲线描述",',
  '  "writingNotes": "写作建议"',
  '}',
  '```',
  '',
  '# 摘要MD 标准格式',
  '```markdown',
  '# 第N章·章名 — 摘要',
  '## 剧情概述',
  '一段话概述',
  '## 关键事件',
  '- 事件1',
  '- 事件2',
  '## 出场角色',
  '- 角色说明',
  '## 情色内容',
  '说明',
  '```',
].join('\n')

// ── 计数器 ──
let passCount = 0
let failCount = 0
const failures = []

function ok(name, detail = '') { passCount++; console.log(`  ✅ ${name}${detail ? ': ' + detail : ''}`) }
function fail(name, detail = '') { failCount++; failures.push({ name, detail }); console.log(`  ❌ ${name}${detail ? ': ' + detail : ''}`) }
function check(cond, name, detail) { cond ? ok(name, detail) : fail(name, detail) }

// ── OpenAI API 调用 ──
async function callOpenAI(messages) {
  const body = { model: MODEL, messages, max_tokens: 4096, tools: TOOLS, tool_choice: 'auto' }
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + API_KEY },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + (await res.text()).slice(0, 300))
  const json = await res.json()
  const choice = json.choices[0]
  return {
    text: choice.message?.content || '',
    toolCalls: choice.message?.tool_calls || [],
    finishReason: choice.finish_reason || 'stop',
    usage: json.usage,
  }
}

// ── Agent 运行循环 ──
async function agentRun(messages, label) {
  let iterations = 0
  let totalTools = 0
  let fullText = ''

  while (iterations < MAX_ITERATIONS) {
    iterations++
    process.stdout.write(`  [iter${iterations}] `)
    const r = await callOpenAI(messages)
    if (r.text) {
      fullText = r.text
      const preview = r.text.length > 120 ? r.text.slice(0, 120) + '...' : r.text
      process.stdout.write(`💬${preview.replace(/\n/g, ' ')} `)
    }

    if (!r.toolCalls.length) {
      process.stdout.write('🛑stop\n')
      return { text: fullText, iterations, toolCalls: totalTools, finishReason: r.finishReason }
    }

    // 构建 assistant 消息
    const asstMsg = { role: 'assistant', content: r.text || null, tool_calls: r.toolCalls }
    messages.push(asstMsg)

    // 执行工具
    for (const tc of r.toolCalls) {
      const fn = tc.function
      const toolFn = tools[fn.name]
      let args = {}
      try { args = JSON.parse(fn.arguments) } catch {}
      const result = toolFn ? await toolFn(args) : '[未知工具]'
      totalTools++
      const ok = result.startsWith && (result.startsWith('创建成功') || result.startsWith('读取') || result.startsWith('编辑成功') || result.startsWith('全量替换成功') || result.startsWith('删除成功') || result.startsWith('项目'))
      const icon = ok ? '✓' : result.startsWith && result.startsWith('[') ? '✗' : '✓'
      process.stdout.write(fn.name + icon + ' ')
      messages.push({ role: 'tool', tool_call_id: tc.id, content: result })
    }
    process.stdout.write('\n')
  }
  return { text: fullText, iterations, toolCalls: totalTools, finishReason: 'max_iterations' }
}

// ── 辅助: 构建消息列表 ──
function freshMessages(userContent) {
  return [
    { role: 'system', content: SYS },
    { role: 'user', content: userContent },
  ]
}

// ── 测试场景 ──
async function runScenarios() {
  // 确保测试目录干净
  const testDir = path.join(PROJECTS_DIR, '1', 'detailed_outline')
  const summaryDir = path.join(PROJECTS_DIR, '1', 'summaries')
  fs.mkdirSync(testDir, { recursive: true })
  fs.mkdirSync(summaryDir, { recursive: true })

  // 清理可能残留的测试文件
  const testFiles = ['chapter7.json', 'chapter7_v2.json', 'chapter8.json']
  for (const f of testFiles) {
    const fp = path.join(testDir, f)
    if (fs.existsSync(fp)) fs.unlinkSync(fp)
  }
  const summaryTest = path.join(summaryDir, 'chapter7.md')
  if (fs.existsSync(summaryTest)) fs.unlinkSync(summaryTest)

  // ══════════════════════════════════════════
  // S1: 纯对话 - 用户询问如何创建细纲（不应调工具）
  // ══════════════════════════════════════════
  console.log('\n▶ S1 纯对话: 询问细纲格式')

  const r1 = await agentRun(freshMessages(
    '你好，我想给小说写细纲，但是不太清楚格式要求，你能给我讲讲细纲应该包含哪些内容吗？'
  ), 'S1')
  check(r1.toolCalls === 0,
    'S1 纯对话零工具',
    `${r1.iterations}轮 ${r1.toolCalls}工具`)

  // ══════════════════════════════════════════
  // S2: 读取已有细纲作为参考
  // ══════════════════════════════════════════
  console.log('\n▶ S2 读取已有细纲: 查看格式参考')

  const r2 = await agentRun(freshMessages(
    '好的，我先看看已有的细纲长什么样。帮我读一下 1/detailed_outline/chapter1.yaml 和 1/detailed_outline/chapter3.yaml，我想对比看看完整版和简版的区别'
  ), 'S2')
  check(r2.toolCalls >= 2,
    'S2 并行读取两份细纲',
    `${r2.iterations}轮 ${r2.toolCalls}工具`)

  // ══════════════════════════════════════════
  // S3: 读大纲获取章节剧情 + 列目录确认现有文件
  // ══════════════════════════════════════════
  console.log('\n▶ S3 读大纲+列目录: 了解剧情上下文')

  const r3 = await agentRun(freshMessages(
    '我想创建第7章的细纲。先帮我看看大纲里第7章写的是什么，读一下 1/outline/plot.md。另外列一下 detailed_outline 目录里现在已经有哪些章的细纲了，免得我搞重复了'
  ), 'S3')
  check(r3.toolCalls >= 2,
    'S3 读大纲+列目录',
    `${r3.iterations}轮 ${r3.toolCalls}工具`)

  // ══════════════════════════════════════════
  // S4: 创建细纲 JSON（核心场景）
  // ══════════════════════════════════════════
  console.log('\n▶ S4 创建第7章细纲 JSON')

  const r4 = await agentRun(freshMessages(
    '好的，现在帮我创建第7章的细纲。第7章讲的是张明和林语晴在图书馆相遇后，一起探索迷雾边界，发现空气墙上有奇怪的符号。保存到 1/detailed_outline/chapter7.yaml。格式参考之前看到的 chapter1.yaml，要完整版的，包含 plotOverview、characters、location、keyEvents、eroticContent、emotionCurve、writingNotes 这些字段。章节id用 chapter7，标题叫"第7章·符号谜题"，order设为6，status写incomplete。'
  ), 'S4')
  check(r4.toolCalls >= 1 && r4.iterations <= 6,
    'S4 创建细纲JSON',
    `${r4.iterations}轮 ${r4.toolCalls}工具`)

  // 验证文件确实被创建
  const s4File = path.join(testDir, 'chapter7.json')
  const s4Exists = fs.existsSync(s4File)
  let s4ValidJson = false
  if (s4Exists) {
    try { JSON.parse(fs.readFileSync(s4File, 'utf-8')); s4ValidJson = true } catch {}
  }
  check(s4Exists && s4ValidJson,
    'S4 验证 chapter7.json 存在且为合法JSON',
    s4Exists ? (s4ValidJson ? 'JSON合法' : 'JSON格式错误') : '文件不存在')

  // ══════════════════════════════════════════
  // S5: 创建摘要 MD
  // ══════════════════════════════════════════
  console.log('\n▶ S5 创建第7章摘要 MD')

  const r5 = await agentRun(freshMessages(
    '不错，细纲创建好了。现在帮我根据这个细纲生成一份章节摘要，保存为MD文件。先读一下刚创建的 1/detailed_outline/chapter7.yaml 确认内容，然后生成摘要写到 1/summaries/chapter7.md。摘要要包含剧情概述、关键事件、出场角色、情色内容这几个部分，用markdown格式。'
  ), 'S5')
  check(r5.toolCalls >= 2,
    'S5 读细纲→创建摘要MD',
    `${r5.iterations}轮 ${r5.toolCalls}工具`)

  // 验证MD文件
  const s5File = path.join(summaryDir, 'chapter7.md')
  const s5Exists = fs.existsSync(s5File)
  let s5HasContent = false
  if (s5Exists) {
    const md = fs.readFileSync(s5File, 'utf-8')
    s5HasContent = md.length > 100
  }
  check(s5Exists && s5HasContent,
    'S5 验证 chapter7.md 存在且有内容',
    s5Exists ? `文件大小: ${fs.statSync(s5File).size}字` : '文件不存在')

  // ══════════════════════════════════════════
  // S6: 用户修正 - 模拟真实交互 "不对，改成..."
  // ══════════════════════════════════════════
  console.log('\n▶ S6 用户修正: 修改细纲内容')

  // 先读当前内容，然后要求修改
  const r6_msgs = freshMessages(
    '不对，我刚又想了下，第7章应该再加一个关键事件：\"张明触摸符号后短暂失去意识3秒，醒来后发现手掌上多了一个发光的印记\"。帮我改一下 1/detailed_outline/chapter7.yaml，把这条加进去。先读一下现在的文件，然后用edit_file改。'
  )
  const r6 = await agentRun(r6_msgs, 'S6')
  check(r6.toolCalls >= 1,
    'S6 读→编辑修正细纲',
    `${r6.iterations}轮 ${r6.toolCalls}工具`)

  // ══════════════════════════════════════════
  // S7: 读回验证 - 用户要求确认改对了
  // ══════════════════════════════════════════
  console.log('\n▶ S7 用户确认: 读回验证修改')

  const r7 = await agentRun(freshMessages(
    '改好了吗？帮我把细纲和摘要都读出来给我看看，确认一下内容没问题。读 1/detailed_outline/chapter7.yaml 和 1/summaries/chapter7.md'
  ), 'S7')
  check(r7.toolCalls >= 2,
    'S7 并行读取验证+摘要',
    `${r7.iterations}轮 ${r7.toolCalls}工具`)

  // ══════════════════════════════════════════
  // S8: 文件不存在→搜索→重试 (Edge Case)
  // ══════════════════════════════════════════
  console.log('\n▶ S8 错误恢复: 文件不存在→搜索找文件→重试')

  const r8 = await agentRun(freshMessages(
    '帮我读一下 1/detailed_outline/chapter99.yaml 看看第99章写了啥。如果不存在的话，搜一下 detailed_outline 目录里有啥文件'
  ), 'S8')
  check(r8.toolCalls >= 2,
    'S8 读失败→搜索/列目录恢复',
    `${r8.iterations}轮 ${r8.toolCalls}工具`)

  // ══════════════════════════════════════════
  // S9: 长内容 + 批量操作 (Edge Case)
  // ══════════════════════════════════════════
  console.log('\n▶ S9 长内容批量: 同时创建细纲+摘要(第8章)')

  const r9 = await agentRun(freshMessages(
    '第8章的剧情我也想好了：张明手上的发光印记在午夜会发出蓝光，他发现林语晴的锁骨上也有类似的印记，但是金色的。两人意识到印记可能和空气墙的符号有关，决定天亮后一起破解符号。风格参考chapter1.json的格式来。请一次帮我创建两个文件：1/detailed_outline/chapter8.yaml（细纲）和 1/summaries/chapter8.md（摘要）。'
  ), 'S9')
  check(r9.toolCalls >= 2,
    'S9 批量创建细纲+摘要',
    `${r9.iterations}轮 ${r9.toolCalls}工具`)

  // 验证文件
  const s9Json = path.join(testDir, 'chapter8.json')
  const s9Md = path.join(summaryDir, 'chapter8.md')
  const s9BothExist = fs.existsSync(s9Json) && fs.existsSync(s9Md)
  check(s9BothExist,
    'S9 验证 chapter8.json + chapter8.md 均被创建',
    `JSON:${fs.existsSync(s9Json) ? '✓' : '✗'} MD:${fs.existsSync(s9Md) ? '✓' : '✗'}`)

  // ══════════════════════════════════════════
  // S10: 空提示/用户说"继续"
  // ══════════════════════════════════════════
  console.log('\n▶ S10 模拟用户追加确认: "继续" "好的"')

  const r10 = await agentRun(freshMessages(
    '好的，第8章也搞定了。现在帮我列出 detailed_outline 目录里所有文件，我想看看一共有哪些章的细纲'
  ), 'S10')
  check(r10.toolCalls >= 1,
    'S10 列目录确认全貌',
    `${r10.iterations}轮 ${r10.toolCalls}工具`)

  // ══════════════════════════════════════════
  // S11: JSON格式验证 - 创建故意损坏的JSON测试检错
  // ══════════════════════════════════════════
  console.log('\n▶ S11 JSON格式校验: 创建前自动校验')

  const r11 = await agentRun(freshMessages(
    '帮我创建 1/detailed_outline/chapter7_v2.yaml，内容是 {"id": "chapter7_v2", 坏的JSON格式测试'
  ), 'S11')

  // 不应该创建损坏的JSON文件；即使尝试了，工具实现会拒绝
  const s11File = path.join(testDir, 'chapter7_v2.json')
  const s11NoDamage = !fs.existsSync(s11File) || (() => {
    try { JSON.parse(fs.readFileSync(s11File, 'utf-8')); return true } catch { return false }
  })() === true

  check(s11NoDamage || r11.toolCalls === 0,
    'S11 JSON格式校验拦截',
    `${r11.iterations}轮 ${r11.toolCalls}工具`)
}

// ── 主入口 ──
async function main() {
  console.log('═══════════════════════════════════════════')
  console.log('  仿真测试: 细纲创作 (detailed_outline)')
  console.log('  端点: ' + API_URL)
  console.log('  模型: ' + MODEL)
  console.log('  工具: read_file, create_file, edit_file')
  console.log('═══════════════════════════════════════════')

  try {
    await runScenarios()
  } catch (e) {
    console.error('\n💥 测试异常:', e.message)
    console.error(e.stack)
    fail('测试运行异常', e.message)
  }

  // ══════════════════════════════════════════
  // 清理测试文件
  // ══════════════════════════════════════════
  console.log('\n── 清理测试文件 ──')
  const testDir = path.join(PROJECTS_DIR, '1', 'detailed_outline')
  const summaryDir = path.join(PROJECTS_DIR, '1', 'summaries')
  const cleanupFiles = ['chapter7.json', 'chapter7_v2.json', 'chapter8.json']
  const cleanupSummaries = ['chapter7.md', 'chapter8.md']
  for (const f of cleanupFiles) {
    const fp = path.join(testDir, f)
    if (fs.existsSync(fp)) { fs.unlinkSync(fp); console.log('  已删除: detailed_outline/' + f) }
  }
  for (const f of cleanupSummaries) {
    const fp = path.join(summaryDir, f)
    if (fs.existsSync(fp)) { fs.unlinkSync(fp); console.log('  已删除: summaries/' + f) }
  }

  // ══════════════════════════════════════════
  // 汇总
  // ══════════════════════════════════════════
  const total = passCount + failCount
  const rate = total > 0 ? ((passCount / total) * 100).toFixed(1) : '0.0'
  console.log('\n\n═══════════════════════════════════════════')
  console.log('  细纲创作 仿真测试结果')
  console.log('═══════════════════════════════════════════')
  console.log('  ✅ ' + passCount + '  ❌ ' + failCount + '  通过率: ' + rate + '%')
  if (failures.length > 0) {
    console.log('\n  失败详情:')
    for (const f of failures) {
      console.log('    ❌ ' + f.name + (f.detail ? ': ' + f.detail : ''))
    }
  }
  console.log('═══════════════════════════════════════════\n')

  if (failCount > 0) process.exit(1)
}

main().catch(e => {
  console.error('\n💥 致命异常:', e.message)
  process.exit(1)
})
