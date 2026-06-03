#!/usr/bin/env node
/**
 * 仿真测试: 大纲创作 (05-outline)
 * 模拟用户对故事大纲进行读取和编辑操作。
 *
 * 场景: 读取大纲 → 编辑追加新章节
 * 验证: read_file 和 edit_file 工具被正确调用。
 *
 * 复杂度: 中等 — 2个大纲操作场景
 * 工具覆盖: read_file, edit_file, list_directory
 *
 * 运行: node scripts/full-sim/05-outline.mjs
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

// ═══════════════════════════════════════════════════
//  准备测试数据
// ═══════════════════════════════════════════════════
function seedTestData() {
  const outlineDir = P('1/outline')
  fs.mkdirSync(outlineDir, { recursive: true })

  const plotContent = [
    '# 故事大纲',
    '',
    '## 第1章·序章',
    '许倩在青云山脚下偶遇一只受伤的灵狐，她救下灵狐，意外获得一块古玉佩。',
    '',
    '## 第2章·入门',
    '许倩带着古玉佩来到青云宗，被宗主发现她身怀灵脉，破例收入门下。',
    '',
    '## 第3章·试炼',
    '许倩在新人试炼中大放异彩，引起了师姐沈清雪的注意。',
    '',
    '## 第4章·秘境',
    '许倩与师兄林逸组队探索秘境，发现了上古修士的洞府遗迹。',
    '',
    '## 第5章·突破',
    '许倩在秘境中获得灵丹，修为突破到筑基期。',
    '',
    '## 第6章·暗流',
    '宗门内有人觊觎许倩的玉佩，暗中设计陷害她。',
    '',
    '## 第7章·真相',
    '许倩发现玉佩中藏有一部残缺的上古功法。',
    '',
    '## 第8章·危机',
    '魔道修士入侵青云宗，许倩被迫卷入宗门大战。',
    '',
    '## 第9章·决战',
    '许倩凭借古玉佩的力量，在关键时刻救下了宗主。',
    '',
  ].join('\n')

  const worldbuildingContent = [
    '# 世界观设定',
    '',
    '## 修炼体系',
    '- 炼气期: 引气入体，打通经脉',
    '- 筑基期: 凝聚真元，铸造根基',
    '- 金丹期: 真元化丹，脱胎换骨',
    '- 元婴期: 丹破婴生，超凡入圣',
    '',
    '## 势力分布',
    '- 青云宗: 正道七宗之一，擅长剑法',
    '- 魔渊: 魔道势力，暗中觊觎青云宗',
    '- 散修联盟: 中立势力，在凡人界中活动',
    '',
    '## 重要地点',
    '- 青云山: 青云宗所在，灵气充沛',
    '- 古秘境: 上古修士遗迹，遍布危险与机缘',
    '- 铸剑城: 天下第一铸器之地',
  ].join('\n')

  fs.writeFileSync(path.join(outlineDir, 'plot.md'), plotContent)
  fs.writeFileSync(path.join(outlineDir, 'worldbuilding.md'), worldbuildingContent)
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
  { type: 'function', function: { name: 'read_file', description: '读取项目文件。修改前必须先读取。', parameters: { type: 'object', properties: { file_path: { type: 'string', description: '文件相对路径，如 1/outline/plot.md' } }, required: ['file_path'] } } },
  { type: 'function', function: { name: 'list_directory', description: '列出目录内容', parameters: { type: 'object', properties: { path: { type: 'string', description: '目录路径' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'search_content', description: '搜索文件内容', parameters: { type: 'object', properties: { pattern: { type: 'string', description: '搜索关键词' }, path: { type: 'string', description: '搜索路径' } }, required: ['pattern'] } } },
  { type: 'function', function: { name: 'create_file', description: '创建新文件', parameters: { type: 'object', properties: { file_path: { type: 'string' }, content: { type: 'string' } }, required: ['file_path', 'content'] } } },
  { type: 'function', function: { name: 'edit_file', description: '编辑文件。先read_file获取内容，再调用edit_file修改。支持在文件末尾追加内容。', parameters: { type: 'object', properties: { file_path: { type: 'string' }, old_string: { type: 'string', description: '要替换的原文本，用于定位' }, new_string: { type: 'string', description: '替换后的新文本' } }, required: ['file_path', 'old_string', 'new_string'] } } },
  { type: 'function', function: { name: 'delete_file', description: '删除文件', parameters: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] } } },
]

// ═══════════════════════════════════════════════════
//  系统提示词
// ═══════════════════════════════════════════════════
const SYS = [
  '你是青剑AI写作助手，一个专业的AI小说创作辅助工具。',
  '',
  '# 铁律：何时用工具',
  '用户说"读"/"看"时，使用 read_file 工具读取文件。',
  '用户说"添加"/"加"/"修改"/"编辑"/"追加"/"在末尾加"时，使用 edit_file 工具。',
  '编辑前必须先读取文件内容。路径已知时直接读取，不要列目录。',
  '',
  '# 对话风格',
  '- 用中文回复，简洁明了。',
  '- 操作完成后汇报结果。',
  '',
  '# 路径',
  '大纲: 1/outline/plot.md',
  '世界观: 1/outline/worldbuilding.md',
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
  console.log('  仿真测试: 大纲创作 (05-outline)')
  console.log('  端点: ' + API_URL + '  模型: ' + MODEL)
  console.log('  模式: 大纲读取与编辑 — 验证 read_file/edit_file')
  console.log('══════════════════════════════════════')

  // 准备测试数据
  seedTestData()
  console.log('\n  [初始化] 测试数据已创建 (projects/1/outline/)')

  // ──────────────────────────────────────────────
  //  S1: 读取故事大纲
  // ──────────────────────────────────────────────
  hr('S1 读取大纲 — “读一下故事大纲”')
  const r1 = await agentRun('读一下故事大纲')
  t('S1 返回文本', r1.text.length > 0, r1.text.length + '字')
  t('S1 read_file 被调用', r1.toolLog.some(l => l.name === 'read_file'),
    r1.toolLog.filter(l => l.name === 'read_file').length + '次')
  t('S1 读取的是plot.md', r1.toolLog.some(l => l.name === 'read_file' && l.args.file_path && String(l.args.file_path).includes('plot')),
    '文件包含plot')
  console.log('    工具调用: ' + r1.toolLog.map(l => l.name).join(', '))
  console.log('    回复: ' + r1.text.slice(0, 150))

  // ──────────────────────────────────────────────
  //  S2: 在大纲末尾追加新章节
  // ──────────────────────────────────────────────
  hr('S2 编辑大纲 — “在大纲末尾加一章：第10章·终局之战”')
  const r2 = await agentRun('在大纲末尾加一章：第10章·终局之战')
  t('S2 返回文本', r2.text.length > 0, r2.text.length + '字')
  t('S2 read_file 被调用', r2.toolLog.some(l => l.name === 'read_file'),
    r2.toolLog.filter(l => l.name === 'read_file').length + '次')
  t('S2 edit_file 被调用', r2.toolLog.some(l => l.name === 'edit_file'),
    r2.toolLog.filter(l => l.name === 'edit_file').length + '次')
  // 验证文件确实被修改了
  const plotAfter = fs.readFileSync(P('1/outline/plot.md'), 'utf-8')
  t('S2 大纲包含第10章', plotAfter.includes('第10章') || plotAfter.includes('终局之战'),
    '文件内容已更新')
  console.log('    工具调用: ' + r2.toolLog.map(l => l.name).join(', '))
  console.log('    回复: ' + r2.text.slice(0, 150))

  // 清理
  try { fs.rmSync(P('1/outline'), { recursive: true, force: true }) } catch {}

  // ──────────────────────────────────────────────
  //  汇总
  // ──────────────────────────────────────────────
  const total = pass + fail
  console.log('\n')
  console.log('══════════════════════════════════════')
  console.log('  仿真测试: 大纲创作 (05-outline) — 测试结果')
  console.log('══════════════════════════════════════')
  console.log('  ✅ ' + String(pass).padStart(2) + '  通过')
  console.log('  ❌ ' + String(fail).padStart(2) + '  失败')
  console.log('  通过率: ' + (total > 0 ? ((pass / total) * 100).toFixed(1) : '0.0') + '%')
  console.log('')
  console.log('  场景覆盖:')
  console.log('    S1  读取大纲    — “读一下故事大纲”')
  console.log('    S2  编辑大纲    — “在大纲末尾加一章：第10章·终局之战”')
  console.log('══════════════════════════════════════')

  if (fail > 0) process.exit(1)
}

main().catch(e => {
  console.error('\n测试异常:', e.message)
  console.error(e.stack)
  process.exit(1)
})
