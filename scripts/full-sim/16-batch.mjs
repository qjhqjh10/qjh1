#!/usr/bin/env node
/**
 * 仿真测试: 批量文件操作 (16-batch)
 * 模拟用户进行跨多文件的批量搜索替换和批量创建。
 *
 * 场景: 全文搜索人物名 → 批量替换名字 → 批量创建角色文件
 * 验证: search_content 多结果, edit_file 多处调用, create_file 多次调用
 *
 * 复杂度: 中等 — 3个批量操作场景
 * 工具覆盖: search_content, read_file, edit_file, create_file
 *
 * 运行: node scripts/full-sim/16-batch.mjs
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

// ═══════════════════════════════════════════════════
//  配置
// ═══════════════════════════════════════════════════
const API_KEY = process.env.AI_API_KEY || 'sk-c9c30831df7243209435c60e811c879d'
const API_URL = 'https://api.deepseek.com/v1/chat/completions'
const MODEL = 'deepseek-v4-flash'
const MAX_ITERATIONS = 8
const ROOT = path.resolve(import.meta.dirname || '.', '..', '..')
const P = p => path.join(ROOT, 'projects', p)
const N = p => path.join(ROOT, 'notes', p)
const K = p => path.join(ROOT, 'knowledge_base', 'files', p)

const TEST_PROJ = 'batch-test'

// ═══════════════════════════════════════════════════
//  准备测试数据
// ═══════════════════════════════════════════════════
function seedTestData() {
  const projDir = P(TEST_PROJ)
  fs.mkdirSync(path.join(projDir, 'chapters'), { recursive: true })
  fs.mkdirSync(path.join(projDir, 'characters'), { recursive: true })
  fs.mkdirSync(path.join(projDir, 'outline'), { recursive: true })

  // 创建3个章节文件，内容中都提到"许倩"
  fs.writeFileSync(path.join(projDir, 'chapters', 'chapter1.txt'), [
    '第1章 山门',
    '',
    '许倩站在青云山山门前，晨风拂过她的发梢。',
    '她紧了紧背上的包袱，深吸一口气迈入山门。',
    '守门弟子拦住了她："来者何人？"',
    '"许倩，奉玉佩之命前来拜师。"',
    '许倩的声音虽轻，却不失坚定。',
  ].join('\n'))

  fs.writeFileSync(path.join(projDir, 'chapters', 'chapter2.txt'), [
    '第2章 入门',
    '',
    '宗主大殿上，许倩跪在青石地面上。',
    '周围的长老们交头接耳，对这个拿着古玉佩的少女充满疑虑。',
    '"许倩，你可知道这块玉佩的来历？"宗主的声音在大殿中回荡。',
    '许倩抬起头，目光清澈："我不知道。但它指引我来到这里。"',
    '许倩的回答让在场的长老们更加惊讶。',
  ].join('\n'))

  fs.writeFileSync(path.join(projDir, 'chapters', 'chapter3.txt'), [
    '第3章 试炼',
    '',
    '新人试炼场上，许倩手持木剑稳稳站立。',
    '对面的师兄轻蔑一笑："新人许倩，你可准备好了？"',
    '许倩没有回答，只是握紧了剑柄。',
    '战斗开始，许倩的身影如飞燕般掠过试炼场。',
    '"许倩的潜力不可小觑啊。"台上的长老低声赞叹。',
  ].join('\n'))

  // 大纲中也提到许倩
  fs.writeFileSync(path.join(projDir, 'outline', 'plot.md'), [
    '# 大纲',
    '许倩是故事的主角，她从山村走向修仙世界。',
    '许倩的成长贯穿整个故事。',
  ].join('\n'))
}

function cleanupTestData() {
  try { fs.rmSync(P(TEST_PROJ), { recursive: true, force: true }) } catch {}
}

// ═══════════════════════════════════════════════════
//  工具实现
// ═══════════════════════════════════════════════════
const tools = {
  read_file: a => {
    try {
      const fp = a.file_path || a.path || ''
      const c = fs.readFileSync(P(fp), 'utf-8')
      return c.length > 3000 ? c.slice(0, 3000) + '\n…(' + c.length + '字)' : c
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
              results.push(f.replace(P(''), '').replace(/\\/g, '/') + ':' + (i + 1) + ':' + ls[i].slice(0, 200))
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
      return results.slice(0, 30).join('\n') || '无匹配'
    } catch (e) { return '[错误]' }
  },

  create_file: a => {
    try {
      const fp = P(a.file_path || a.path)
      const c = a.content || ''
      fs.mkdirSync(path.dirname(fp), { recursive: true })
      fs.writeFileSync(fp, c)
      return '创建成功: ' + a.file_path + ' (' + c.length + '字)'
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
  { type: 'function', function: { name: 'read_file', description: '读取项目文件。修改前必先读取文件内容。', parameters: { type: 'object', properties: { file_path: { type: 'string', description: '文件相对路径' } }, required: ['file_path'] } } },
  { type: 'function', function: { name: 'list_directory', description: '列出目录内容', parameters: { type: 'object', properties: { path: { type: 'string', description: '目录路径' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'search_content', description: '全文搜索项目文件内容。返回所有匹配行。', parameters: { type: 'object', properties: { pattern: { type: 'string', description: '搜索关键词' }, path: { type: 'string', description: '限定搜索路径(可选)' } }, required: ['pattern'] } } },
  { type: 'function', function: { name: 'create_file', description: '创建新文件。可多次调用来批量创建。', parameters: { type: 'object', properties: { file_path: { type: 'string' }, content: { type: 'string' } }, required: ['file_path', 'content'] } } },
  { type: 'function', function: { name: 'edit_file', description: '编辑文件。replace_all参数设为true可替换所有匹配。先读文件→获取原文本→构造old_string/new_string。', parameters: { type: 'object', properties: { file_path: { type: 'string' }, old_string: { type: 'string', description: '原文本' }, new_string: { type: 'string', description: '新文本' }, replace_all: { type: 'boolean', description: '是否替换所有匹配' } }, required: ['file_path', 'old_string', 'new_string'] } } },
  { type: 'function', function: { name: 'delete_file', description: '删除文件', parameters: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] } } },
]

// ═══════════════════════════════════════════════════
//  系统提示词
// ═══════════════════════════════════════════════════
const SYS = [
  '你是青剑AI写作助手，一个专业的AI小说创作辅助工具。',
  '',
  '# 批量操作',
  '搜索 → 使用 search_content 工具',
  '替换 → 每个文件: 先 read_file → 再 edit_file',
  '批量创建 → 对每个文件调用 create_file',
  '',
  '# 关键规则',
  '- 修改文件前必须先读文件',
  '- 替换全部时应逐个文件处理',
  '- 搜索时不要限制path，搜索全部文件',
  '',
  '# 对话风格',
  '- 用中文回复，简洁明了，汇报操作结果和数量',
  '',
  '# 路径',
  '项目在: batch-test/chapters/  batch-test/characters/  batch-test/outline/',
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
  console.log('  仿真测试: 批量操作 (16-batch)')
  console.log('  端点: ' + API_URL + '  模型: ' + MODEL)
  console.log('  模式: 搜索→替换→批量创建')
  console.log('══════════════════════════════════════')

  // 准备测试数据
  seedTestData()
  console.log('\n  [初始化] 测试数据已创建 (projects/' + TEST_PROJ + '/)')

  // ──────────────────────────────────────────────
  //  S1: 全文搜索 "许倩"
  // ──────────────────────────────────────────────
  hr('S1 全文搜索 — “搜索所有文件中提到‘许倩’的地方”')
  const r1 = await agentRun('搜索所有文件中提到\'许倩\'的地方')
  t('S1 返回文本', r1.text.length > 0, r1.text.length + '字')
  t('S1 search_content 被调用', r1.toolLog.some(l => l.name === 'search_content'),
    r1.toolLog.filter(l => l.name === 'search_content').length + '次')
  // 检查搜索结果中有多条匹配（多个文件）
  const s1sc = r1.toolLog.find(l => l.name === 'search_content')
  const hasMultiple = s1sc && s1sc.result && (s1sc.result.includes('chapter') || s1sc.result.includes('outline'))
  t('S1 搜索返回多条结果', hasMultiple,
    s1sc ? '结果数: ' + (s1sc.result.match(/\n/g) || []).length + '行' : '无')
  console.log('    工具调用: ' + r1.toolLog.map(l => l.name).join(', '))
  console.log('    回复: ' + r1.text.slice(0, 150))

  // ──────────────────────────────────────────────
  //  S2: 批量替换 "许倩" → "林语晴"
  // ──────────────────────────────────────────────
  hr('S2 批量替换 — “把1-3章中所有‘许倩’改成‘林语晴’”')
  const r2 = await agentRun('把1-3章中所有\'许倩\'改成\'林语晴\'')
  t('S2 返回文本', r2.text.length > 0, r2.text.length + '字')
  const editCount = r2.toolLog.filter(l => l.name === 'edit_file').length
  t('S2 edit_file 至少调用1次', editCount >= 1, editCount + '次')
  // 验证章节文件内容已被替换
  let replacedInChapters = 0
  for (let i = 1; i <= 3; i++) {
    const chapPath = P(TEST_PROJ + '/chapters/chapter' + i + '.txt')
    if (fs.existsSync(chapPath)) {
      const content = fs.readFileSync(chapPath, 'utf-8')
      if (content.includes('林语晴')) replacedInChapters++
    }
  }
  t('S2 章节中许倩已替换为林语晴', replacedInChapters >= 1,
    replacedInChapters + '/3章已替换')
  console.log('    工具调用: ' + r2.toolLog.map(l => l.name).join(', '))
  console.log('    回复: ' + r2.text.slice(0, 150))

  // ──────────────────────────────────────────────
  //  S3: 批量创建3个角色
  // ──────────────────────────────────────────────
  hr('S3 批量创建角色 — “批量创建3个角色：Alice, Bob, Charlie”')
  const r3 = await agentRun('批量创建3个角色：Alice, Bob, Charlie。为每个角色创建一个JSON文件，包含姓名和角色类型。')
  t('S3 返回文本', r3.text.length > 0, r3.text.length + '字')
  const createCount = r3.toolLog.filter(l => l.name === 'create_file').length
  t('S3 create_file 至少调用3次', createCount >= 3, createCount + '次')
  // 检查文件是否创建
  const names = ['Alice', 'Bob', 'Charlie']
  let created = 0
  for (const nm of names) {
    const fp = P(TEST_PROJ + '/characters/' + nm + '.yaml')
    if (fs.existsSync(fp)) created++
  }
  t('S3 3个角色文件已创建', created === 3, created + '/3个文件')
  console.log('    工具调用: ' + r3.toolLog.map(l => l.name).join(', '))
  console.log('    回复: ' + r3.text.slice(0, 150))

  // 清理
  cleanupTestData()

  // ──────────────────────────────────────────────
  //  汇总
  // ──────────────────────────────────────────────
  const total = pass + fail
  console.log('\n')
  console.log('══════════════════════════════════════')
  console.log('  仿真测试: 批量操作 (16-batch) — 测试结果')
  console.log('══════════════════════════════════════')
  console.log('  ✅ ' + String(pass).padStart(2) + '  通过')
  console.log('  ❌ ' + String(fail).padStart(2) + '  失败')
  console.log('  通过率: ' + (total > 0 ? ((pass / total) * 100).toFixed(1) : '0.0') + '%')
  console.log('')
  console.log('  场景覆盖:')
  console.log('    S1  全文搜索      — “搜索所有文件中提到‘许倩’的地方”')
  console.log('    S2  批量替换      — “把1-3章中所有‘许倩’改成‘林语晴’”')
  console.log('    S3  批量创建      — “批量创建3个角色：Alice, Bob, Charlie”')
  console.log('══════════════════════════════════════')

  if (fail > 0) process.exit(1)
}

main().catch(e => {
  console.error('\n测试异常:', e.message)
  console.error(e.stack)
  process.exit(1)
})
