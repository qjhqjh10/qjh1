#!/usr/bin/env node
/**
 * 仿真测试: 内容搜索 (03-search)
 * 模拟用户使用搜索功能在项目文件中查找内容。
 *
 * 场景: 全文搜索 + 路径过滤搜索
 * 验证: search_content 工具被正确调用，返回匹配结果。
 *
 * 复杂度: 简单 — 2个搜索场景
 * 工具覆盖: search_content, read_file
 *
 * 运行: node scripts/full-sim/03-search.mjs
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

// ═══════════════════════════════════════════════════
//  配置
// ═══════════════════════════════════════════════════
const API_KEY = process.env.AI_API_KEY || 'sk-c9c30831df7243209435c60e811c879d'
const API_URL = 'https://api.deepseek.com/v1/chat/completions'
const MODEL = 'deepseek-v4-flash'
const MAX_ITERATIONS = 5
const ROOT = path.resolve(import.meta.dirname || '.', '..', '..')
const P = p => path.join(ROOT, 'projects', p)
const N = p => path.join(ROOT, 'notes', p)
const K = p => path.join(ROOT, 'knowledge_base', 'files', p)

// ═══════════════════════════════════════════════════
//  准备测试数据
// ═══════════════════════════════════════════════════
function seedTestData() {
  const projDir = P('1')
  fs.mkdirSync(projDir, { recursive: true })
  // 主大纲文件（含"许倩"）
  fs.mkdirSync(path.join(projDir, 'outline'), { recursive: true })
  fs.writeFileSync(path.join(projDir, 'outline', 'plot.md'),
    '# 故事大纲\n\n## 主线\n许倩是一个修仙门派的弟子，她在一次试炼中发现了上古秘境。\n\n## 支线\n许倩的师兄林逸暗中觊觎掌门之位。修仙之路充满荆棘。\n'
  )
  // 角色文件（含"许倩"）
  fs.mkdirSync(path.join(projDir, 'characters'), { recursive: true })
  fs.writeFileSync(path.join(projDir, 'characters', '许倩.json'),
    JSON.stringify({ name: '许倩', role: '主角', realm: '筑基期', desc: '修仙门派弟子' }, null, 2)
  )
  // 章节文件（含"许倩"）
  fs.mkdirSync(path.join(projDir, 'chapters'), { recursive: true })
  fs.writeFileSync(path.join(projDir, 'chapters', 'chapter1.txt'),
    '第1章 入门\n许倩站在山门前，望着云雾缭绕的青云峰，心中满是期待。她将在这里开始修仙之路。\n'
  )
  // 另一个目录也放一个含"许倩"的文件
  fs.mkdirSync(path.join(projDir, 'summaries'), { recursive: true })
  fs.writeFileSync(path.join(projDir, 'summaries', 'summary.md'),
    '章节摘要：许倩经过三年苦修，终于突破到筑基期。\n'
  )
}

// ═══════════════════════════════════════════════════
//  工具实现
// ═══════════════════════════════════════════════════
const tools = {
  read_file: a => {
    try {
      const fp = a.file_path || a.path || ''
      const c = fs.readFileSync(P(fp), 'utf-8')
      return c.length > 2000 ? c.slice(0, 2000) + '\n…(' + c.length + '字)' : c
    } catch (e) {
      return '[错误: 文件不存在]'
    }
  },

  list_directory: a => {
    try {
      const dir = a.path || a.dir_path || '.'
      const e = fs.readdirSync(P(dir), { withFileTypes: true })
      return e.map(x => (x.isDirectory() ? 'DIR ' : 'FILE ') + x.name).join('\n')
    } catch (e) {
      return '[错误: 目录不存在]'
    }
  },

  search_content: a => {
    try {
      const fp = P(a.path || '.')
      const keyword = a.pattern || ''
      if (!keyword) return '[错误: 缺少搜索关键词]'
      let re
      try {
        re = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
      } catch {
        return '[错误: 正则无效]'
      }
      const results = []
      function searchDir(d) {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const f = path.join(d, e.name)
          if (e.isDirectory()) { searchDir(f); continue }
          const c = fs.readFileSync(f, 'utf-8')
          const ls = c.split('\n')
          for (let i = 0; i < ls.length; i++) {
            if (re.test(ls[i]))
              results.push(f.replace(ROOT + '/projects/', '') + ':' + (i + 1) + ':' + ls[i].slice(0, 200))
          }
        }
      }
      if (fs.statSync(fp).isFile()) {
        const c = fs.readFileSync(fp, 'utf-8')
        const ls = c.split('\n')
        for (let i = 0; i < ls.length; i++)
          if (re.test(ls[i]))
            results.push((a.path || '') + ':' + (i + 1) + ':' + ls[i].slice(0, 200))
      } else {
        searchDir(fp)
      }
      return results.slice(0, 20).join('\n') || '无匹配'
    } catch (e) {
      return '[错误]'
    }
  },

  create_file: a => {
    try {
      const fp = P(a.file_path || a.path)
      const c = a.content || ''
      fs.mkdirSync(path.dirname(fp), { recursive: true })
      fs.writeFileSync(fp, c)
      return '创建成功: ' + a.file_path
    } catch (e) { return '[错误: ' + e.message + ']' }
  },

  edit_file: a => {
    try {
      const fp = P(a.file_path)
      let c = fs.readFileSync(fp, 'utf-8')
      const old = a.old_string || ''
      const nw = a.new_string || ''
      if (old === '__FULL_REPLACE__') {
        fs.writeFileSync(fp, nw)
        return '全量替换成功'
      }
      let idx = c.indexOf(old)
      if (idx < 0) idx = c.indexOf(old.trim())
      if (idx < 0) return '[未找到匹配文本]'
      fs.writeFileSync(fp, c.slice(0, idx) + nw + c.slice(idx + old.length))
      return '编辑成功'
    } catch (e) { return '[错误: ' + e.message + ']' }
  },

  delete_file: a => {
    try { fs.unlinkSync(P(a.file_path)); return '删除成功' } catch { return '[错误]' }
  },
}

// ═══════════════════════════════════════════════════
//  OpenAI-format 工具定义
// ═══════════════════════════════════════════════════
const TOOLS = [
  { type: 'function', function: { name: 'read_file', description: '读取项目文件', parameters: { type: 'object', properties: { file_path: { type: 'string', description: '文件相对路径' } }, required: ['file_path'] } } },
  { type: 'function', function: { name: 'list_directory', description: '列出目录内容', parameters: { type: 'object', properties: { path: { type: 'string', description: '目录路径' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'search_content', description: '在项目文件中搜索内容。支持全文搜索，可通过path限定搜索范围。', parameters: { type: 'object', properties: { pattern: { type: 'string', description: '搜索关键词或正则' }, path: { type: 'string', description: '搜索路径，可选。指定要搜索的文件或目录' } }, required: ['pattern'] } } },
  { type: 'function', function: { name: 'create_file', description: '创建新文件', parameters: { type: 'object', properties: { file_path: { type: 'string' }, content: { type: 'string' } }, required: ['file_path', 'content'] } } },
  { type: 'function', function: { name: 'edit_file', description: '编辑文件', parameters: { type: 'object', properties: { file_path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' } }, required: ['file_path', 'old_string', 'new_string'] } } },
  { type: 'function', function: { name: 'delete_file', description: '删除文件', parameters: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] } } },
]

// ═══════════════════════════════════════════════════
//  系统提示词
// ═══════════════════════════════════════════════════
const SYS = [
  '你是青剑AI写作助手，一个专业的AI小说创作辅助工具。',
  '',
  '# 铁律：何时用工具，何时不用',
  '用户说"搜索"/"查找"/"找"时，必须使用 search_content 工具。',
  '用户说"读"/"看"文件时，使用 read_file 工具。',
  '用户指定了搜索路径时，search_content 的 path 参数必须带上。',
  '',
  '# 对话风格',
  '- 用中文回复，简洁明了。',
  '- 搜索完成后用中文汇报结果。',
  '',
  '# 路径',
  '项目文件在: 1/outline/  1/characters/  1/chapters/  1/summaries/',
].join('\n')

// ═══════════════════════════════════════════════════
//  API 调用
// ═══════════════════════════════════════════════════
async function callOpenAI(messages) {
  const body = {
    model: MODEL,
    messages,
    max_tokens: 2048,
    tools: TOOLS,
    tool_choice: 'auto',
  }
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + API_KEY,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error('HTTP ' + res.status + ': ' + errText.slice(0, 200))
  }
  const json = await res.json()
  const choice = json.choices[0]
  return {
    text: choice.message?.content || '',
    toolCalls: choice.message?.tool_calls || [],
    finishReason: choice.finish_reason || 'stop',
    usage: json.usage,
  }
}

// ═══════════════════════════════════════════════════
//  Agent 运行循环
// ═══════════════════════════════════════════════════
async function agentRun(userMsg) {
  const messages = [
    { role: 'system', content: SYS },
    { role: 'user', content: userMsg },
  ]
  let iterations = 0
  let totalTools = 0
  let fullText = ''
  const toolLog = []

  while (iterations < MAX_ITERATIONS) {
    iterations++
    process.stdout.write('  [iter' + iterations + '] ')

    const r = await callOpenAI(messages)
    if (r.text) fullText = r.text

    if (!r.toolCalls.length) {
      process.stdout.write('文本回复(' + r.text.length + '字)\n')
      return { text: fullText, iterations, toolCalls: totalTools, toolLog }
    }

    const asstMsg = {
      role: 'assistant',
      content: r.text || null,
      tool_calls: r.toolCalls,
    }
    messages.push(asstMsg)

    for (const tc of r.toolCalls) {
      const fn = tc.function
      const toolFn = tools[fn.name]
      let args = {}
      try { args = JSON.parse(fn.arguments) } catch {}
      const result = toolFn ? await toolFn(args) : '[未知工具]'
      const ok = result.startsWith && !result.startsWith('[')
      totalTools++
      process.stdout.write(fn.name + (ok ? '✓' : '✗') + ' ')
      toolLog.push({ name: fn.name, ok, args, result: result.slice(0, 100) })
      messages.push({ role: 'tool', tool_call_id: tc.id, content: result })
    }
    process.stdout.write('\n')
  }
  return { text: fullText, iterations, toolCalls: totalTools, toolLog }
}

// ═══════════════════════════════════════════════════
//  测试框架
// ═══════════════════════════════════════════════════
let pass = 0
let fail = 0

function t(name, cond, detail) {
  if (cond) {
    pass++
    console.log('  ✅ ' + name + (detail ? ': ' + detail : ''))
  } else {
    fail++
    console.log('  ❌ ' + name + (detail ? ': ' + detail : ''))
  }
}

function hr(title) {
  console.log('\n' + '─'.repeat(55))
  console.log('  ' + title)
  console.log('─'.repeat(55))
}

// ═══════════════════════════════════════════════════
//  主测试流程
// ═══════════════════════════════════════════════════
async function main() {
  console.log('══════════════════════════════════════')
  console.log('  仿真测试: 内容搜索 (03-search)')
  console.log('  端点: ' + API_URL + '  模型: ' + MODEL)
  console.log('  模式: 全文搜索 — 验证 search_content 工具调用')
  console.log('══════════════════════════════════════')

  // 准备测试数据
  seedTestData()
  console.log('\n  [初始化] 测试数据已创建 (projects/1/)')

  // ──────────────────────────────────────────────
  //  S1: 全文搜索 "许倩"
  // ──────────────────────────────────────────────
  hr('S1 全文搜索 — “搜索所有文件中提到‘许倩’的地方”')
  const r1 = await agentRun('搜索所有文件中提到‘许倩’的地方')
  t('S1 返回文本', r1.text.length > 0, r1.text.length + '字')
  t('S1 search_content 被调用', r1.toolLog.some(l => l.name === 'search_content'),
    r1.toolLog.filter(l => l.name === 'search_content').length + '次')
  t('S1 搜索有结果', r1.toolLog.some(l => l.name === 'search_content' && l.ok && l.result !== '无匹配'),
    '找到匹配')
  console.log('    工具调用: ' + r1.toolLog.map(l => l.name).join(', '))
  console.log('    回复: ' + r1.text.slice(0, 120))

  // ──────────────────────────────────────────────
  //  S2: 路径过滤搜索 "修仙" 在 outline 目录
  // ──────────────────────────────────────────────
  hr('S2 路径过滤搜索 — “搜索outline目录下包含‘修仙’的文件”')
  const r2 = await agentRun('搜索outline目录下包含‘修仙’的文件')
  t('S2 返回文本', r2.text.length > 0, r2.text.length + '字')
  t('S2 search_content 被调用', r2.toolLog.some(l => l.name === 'search_content'),
    r2.toolLog.filter(l => l.name === 'search_content').length + '次')
  // 验证 path 参数包含 "outline"
  const s2sc = r2.toolLog.find(l => l.name === 'search_content')
  t('S2 搜索路径包含outline', s2sc && s2sc.args && s2sc.args.path && String(s2sc.args.path).includes('outline'),
    'path=' + (s2sc ? JSON.stringify(s2sc.args.path) : '无'))
  console.log('    工具调用: ' + r2.toolLog.map(l => l.name).join(', '))
  console.log('    回复: ' + r2.text.slice(0, 120))

  // ──────────────────────────────────────────────
  //  汇总
  // ──────────────────────────────────────────────
  const total = pass + fail
  console.log('\n')
  console.log('══════════════════════════════════════')
  console.log('  仿真测试: 内容搜索 (03-search) — 测试结果')
  console.log('══════════════════════════════════════')
  console.log('  ✅ ' + String(pass).padStart(2) + '  通过')
  console.log('  ❌ ' + String(fail).padStart(2) + '  失败')
  console.log('  通过率: ' + (total > 0 ? ((pass / total) * 100).toFixed(1) : '0.0') + '%')
  console.log('')
  console.log('  场景覆盖:')
  console.log('    S1  全文搜索          — “搜索所有文件中提到‘许倩’的地方”')
  console.log('    S2  路径过滤搜索      — “搜索outline目录下包含‘修仙’的文件”')
  console.log('══════════════════════════════════════')

  if (fail > 0) process.exit(1)
}

main().catch(e => {
  console.error('\n测试异常:', e.message)
  console.error(e.stack)
  process.exit(1)
})
