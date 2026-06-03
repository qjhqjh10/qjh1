#!/usr/bin/env node
/**
 * 仿真测试: 项目管理 (15-project)
 * 模拟用户进行项目创建、列出和删除操作。
 *
 * 场景: 创建项目 → 列出所有项目 → 删除项目
 * 验证: create_project, list_directory, delete_project 工具被正确调用。
 *
 * 复杂度: 简单 — 3个CRUD操作场景
 * 工具覆盖: create_project, list_directory, delete_project
 *
 * 运行: node scripts/full-sim/15-project.mjs
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
      const fullDir = P(dir)
      if (!fs.existsSync(fullDir)) return '[错误: 目录不存在]'
      const entries = fs.readdirSync(fullDir, { withFileTypes: true })
      return entries.length === 0 ? '(空目录)'
        : entries.map(x => (x.isDirectory() ? 'DIR ' : 'FILE ') + x.name).join('\n')
    } catch (e) {
      return '[错误: 目录不存在]'
    }
  },

  search_content: a => {
    try {
      const fp = P(a.path || '.')
      const keyword = a.pattern || ''
      if (!keyword) return '[错误]'
      let re
      try { re = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi') } catch { return '[错误]' }
      const results = []
      function searchDir(d) {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const f = path.join(d, e.name)
          if (e.isDirectory()) { searchDir(f); continue }
          const c = fs.readFileSync(f, 'utf-8')
          const ls = c.split('\n')
          for (let i = 0; i < ls.length; i++)
            if (re.test(ls[i]))
              results.push(f.replace(ROOT + '/projects/', '') + ':' + (i + 1) + ':' + ls[i].slice(0, 200))
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
      return results.slice(0, 15).join('\n') || '无匹配'
    } catch (e) { return '[错误]' }
  },

  create_file: a => {
    try {
      const fp = P(a.file_path || a.path)
      fs.mkdirSync(path.dirname(fp), { recursive: true })
      fs.writeFileSync(fp, a.content || '')
      return '创建成功: ' + a.file_path
    } catch (e) { return '[错误: ' + e.message + ']' }
  },

  edit_file: a => {
    try {
      const fp = P(a.file_path)
      let c = fs.readFileSync(fp, 'utf-8')
      const old = a.old_string || ''
      const nw = a.new_string || ''
      if (old === '__FULL_REPLACE__') { fs.writeFileSync(fp, nw); return '全量替换成功' }
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
}

// ═══════════════════════════════════════════════════
//  OpenAI-format 工具定义
// ═══════════════════════════════════════════════════
const TOOLS = [
  { type: 'function', function: { name: 'read_file', description: '读取项目文件', parameters: { type: 'object', properties: { file_path: { type: 'string', description: '文件相对路径' } }, required: ['file_path'] } } },
  { type: 'function', function: { name: 'list_directory', description: '列出目录内容。列出项目时，path参数为"."即可列出projects下所有项目。', parameters: { type: 'object', properties: { path: { type: 'string', description: '目录路径，如"."列出projects下的项目' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'search_content', description: '搜索文件内容', parameters: { type: 'object', properties: { pattern: { type: 'string', description: '搜索关键词' }, path: { type: 'string', description: '搜索路径' } }, required: ['pattern'] } } },
  { type: 'function', function: { name: 'create_file', description: '创建新文件', parameters: { type: 'object', properties: { file_path: { type: 'string' }, content: { type: 'string' } }, required: ['file_path', 'content'] } } },
  { type: 'function', function: { name: 'edit_file', description: '编辑文件', parameters: { type: 'object', properties: { file_path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' } }, required: ['file_path', 'old_string', 'new_string'] } } },
  { type: 'function', function: { name: 'delete_file', description: '删除文件', parameters: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] } } },
  { type: 'function', function: { name: 'create_project', description: '创建新项目。会自动创建characters/chapters/outline/detailed_outline/summaries子目录。', parameters: { type: 'object', properties: { name: { type: 'string', description: '项目名称' } }, required: ['name'] } } },
  { type: 'function', function: { name: 'delete_project', description: '删除项目及其所有内容。此操作不可撤销。', parameters: { type: 'object', properties: { name: { type: 'string', description: '要删除的项目名称' } }, required: ['name'] } } },
]

// ═══════════════════════════════════════════════════
//  系统提示词
// ═══════════════════════════════════════════════════
const SYS = [
  '你是青剑AI写作助手，一个专业的AI小说创作辅助工具。',
  '',
  '# 项目管理',
  '用户说"创建项目"/"新建项目" → 使用 create_project',
  '用户说"列出项目"/"所有项目"/"有哪些项目" → 使用 list_directory path="."',
  '用户说"删除项目"/"删除" + 项目名 → 使用 delete_project',
  '',
  '# 对话风格',
  '- 用中文回复，简洁明了。',
  '- 操作完成后汇报结果。',
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
  console.log('  仿真测试: 项目管理 (15-project)')
  console.log('  端点: ' + API_URL + '  模型: ' + MODEL)
  console.log('  模式: 项目 CRUD — create / list / delete')
  console.log('══════════════════════════════════════')

  // 确保测试前清理
  try { fs.rmSync(P('test-proj'), { recursive: true, force: true }) } catch {}

  // ──────────────────────────────────────────────
  //  S1: 创建项目
  // ──────────────────────────────────────────────
  hr('S1 创建项目 — “创建一个新项目叫test-proj”')
  const r1 = await agentRun('创建一个新项目叫test-proj')
  t('S1 返回文本', r1.text.length > 0, r1.text.length + '字')
  t('S1 create_project 被调用', r1.toolLog.some(l => l.name === 'create_project'),
    r1.toolLog.filter(l => l.name === 'create_project').length + '次')
  const projExists = fs.existsSync(P('test-proj'))
  t('S1 项目目录已创建', projExists, 'projects/test-proj/')
  // 验证子目录
  if (projExists) {
    const subs = fs.readdirSync(P('test-proj')).filter(x => {
      try { return fs.statSync(P('test-proj/' + x)).isDirectory() } catch { return false }
    })
    t('S1 包含5个子目录', subs.length >= 5, subs.length + '个子目录: ' + subs.join(', '))
  }
  console.log('    工具调用: ' + r1.toolLog.map(l => l.name).join(', '))
  console.log('    回复: ' + r1.text.slice(0, 120))

  // ──────────────────────────────────────────────
  //  S2: 列出所有项目
  // ──────────────────────────────────────────────
  hr('S2 列出项目 — “列出所有项目”')
  const r2 = await agentRun('列出所有项目')
  t('S2 返回文本', r2.text.length > 0, r2.text.length + '字')
  t('S2 list_directory 被调用', r2.toolLog.some(l => l.name === 'list_directory'),
    r2.toolLog.filter(l => l.name === 'list_directory').length + '次')
  console.log('    工具调用: ' + r2.toolLog.map(l => l.name).join(', '))
  console.log('    回复: ' + r2.text.slice(0, 120))

  // ──────────────────────────────────────────────
  //  S3: 删除项目
  // ──────────────────────────────────────────────
  hr('S3 删除项目 — “删除test-proj项目”')
  const r3 = await agentRun('删除test-proj项目')
  t('S3 返回文本', r3.text.length > 0, r3.text.length + '字')
  t('S3 delete_project 被调用', r3.toolLog.some(l => l.name === 'delete_project'),
    r3.toolLog.filter(l => l.name === 'delete_project').length + '次')
  const projDeleted = !fs.existsSync(P('test-proj'))
  t('S3 项目已删除', projDeleted, 'projects/test-proj/ 不存在')
  console.log('    工具调用: ' + r3.toolLog.map(l => l.name).join(', '))
  console.log('    回复: ' + r3.text.slice(0, 120))

  // 确保清理
  try { fs.rmSync(P('test-proj'), { recursive: true, force: true }) } catch {}

  // ──────────────────────────────────────────────
  //  汇总
  // ──────────────────────────────────────────────
  const total = pass + fail
  console.log('\n')
  console.log('══════════════════════════════════════')
  console.log('  仿真测试: 项目管理 (15-project) — 测试结果')
  console.log('══════════════════════════════════════')
  console.log('  ✅ ' + String(pass).padStart(2) + '  通过')
  console.log('  ❌ ' + String(fail).padStart(2) + '  失败')
  console.log('  通过率: ' + (total > 0 ? ((pass / total) * 100).toFixed(1) : '0.0') + '%')
  console.log('')
  console.log('  场景覆盖:')
  console.log('    S1  创建项目  — “创建一个新项目叫test-proj”')
  console.log('    S2  列出项目  — “列出所有项目”')
  console.log('    S3  删除项目  — “删除test-proj项目”')
  console.log('══════════════════════════════════════')

  if (fail > 0) process.exit(1)
}

main().catch(e => {
  console.error('\n测试异常:', e.message)
  console.error(e.stack)
  process.exit(1)
})
