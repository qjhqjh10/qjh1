#!/usr/bin/env node
/**
 * 仿真测试: 章节创作 (08-chapter-writing)
 * 模拟用户进行章节创作——先读上下文，再生成正文并保存。
 *
 * 场景: 读取大纲/角色/细纲/前章摘要 → 创作第1章正文
 * 验证: create_file 被调用，章节文件创建成功，内容足够长。
 *
 * 复杂度: 中等 — 多步依赖操作
 * 工具覆盖: read_file, create_file, list_directory
 *
 * 运行: node scripts/full-sim/08-chapter-writing.mjs
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

// ═══════════════════════════════════════════════════
//  配置
// ═══════════════════════════════════════════════════
const API_KEY = process.env.AI_API_KEY || 'sk-c9c30831df7243209435c60e811c879d'
const API_URL = 'https://api.deepseek.com/v1/chat/completions'
const MODEL = 'deepseek-v4-flash'
const MAX_ITERATIONS = 10
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

  // 大纲
  const outlineDir = path.join(projDir, 'outline')
  fs.mkdirSync(outlineDir, { recursive: true })
  fs.writeFileSync(path.join(outlineDir, 'plot.md'), [
    '# 故事大纲',
    '',
    '## 第1章·青云入门',
    '许倩来到青云宗，凭借古玉佩被破格收入门下。她遇到了师兄林逸和师姐沈清雪。',
    '',
    '## 第2章·初识修仙',
    '许倩开始修炼基础功法，天赋惊人，引起了宗门内部的关注。',
    '',
    '## 第3章·试炼危机',
    '新人试炼中，许倩遭遇魔道暗算，但凭借玉佩之力化险为夷。',
  ].join('\n'))

  // 角色
  const charsDir = path.join(projDir, 'characters')
  fs.mkdirSync(charsDir, { recursive: true })
  fs.writeFileSync(path.join(charsDir, '许倩.json'), JSON.stringify({
    name: '许倩',
    role: '主角',
    age: 16,
    realm: '炼气期',
    personality: '坚韧不拔，心地善良，有时候会犯倔',
    appearance: '一头乌黑长发，明眸皓齿，身着青色道袍',
    background: '青云山脚下的小村庄出身，意外救下灵狐获得了古玉佩，从此踏上修仙之路',
    abilities: ['基础剑法', '灵脉感知', '古玉佩(未完全激活)'],
  }, null, 2))

  // 细纲
  const detDir = path.join(projDir, 'detailed_outline')
  fs.mkdirSync(detDir, { recursive: true })
  fs.writeFileSync(path.join(detDir, 'chapter1.json'), JSON.stringify({
    chapter: 1,
    title: '青云入门',
    scenes: [
      { id: 1, summary: '许倩站在青云山脚下，仰望云雾缭绕的山峰，心中忐忑。', pov: '许倩' },
      { id: 2, summary: '许倩遇到守门弟子阻拦，出示古玉佩后被引入山门。', pov: '许倩' },
      { id: 3, summary: '宗主大殿上，许倩被检测出身怀灵脉，众长老议论纷纷。', pov: '许倩' },
      { id: 4, summary: '许倩被破格收入门下，分到新人弟子院。', pov: '许倩' },
      { id: 5, summary: '傍晚，许倩在院中遇见师姐沈清雪和师兄林逸，初次交谈。', pov: '许倩' },
    ],
    word_count_target: 3000,
    key_plot_points: ['古玉佩初次展示', '灵脉检测', '破格入门', '结识师兄师姐'],
  }, null, 2))

  // 前章摘要
  const summDir = path.join(projDir, 'summaries')
  fs.mkdirSync(summDir, { recursive: true })
  fs.writeFileSync(path.join(summDir, 'chapter0.md'), [
    '# 第0章摘要（引子）',
    '',
    '许倩在青云山脚下的小村庄长大。一日她在溪边救下一只受伤的白色灵狐，',
    '灵狐临走前留下一块温润的古玉佩。许倩每晚梦见玉佩中传来低语，',
    '引导她前往青云宗。她带着玉佩离开村庄，踏上求仙之路。',
  ].join('\n'))

  // 确保chapters目录存在
  fs.mkdirSync(path.join(projDir, 'chapters'), { recursive: true })
}

// ═══════════════════════════════════════════════════
//  工具实现
// ═══════════════════════════════════════════════════
const tools = {
  read_file: a => {
    try {
      const fp = a.file_path || a.path || ''
      const c = fs.readFileSync(P(fp), 'utf-8')
      return c.length > 2500 ? c.slice(0, 2500) + '\n…(' + c.length + '字)' : c
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
      if (fp.endsWith('.json') && c) {
        try { JSON.parse(c) } catch (e) { return '[JSON格式错误: ' + e.message + ']' }
      }
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
  { type: 'function', function: { name: 'read_file', description: '读取项目文件。写章节前必须先读大纲/细纲/角色/摘要了解上下文。', parameters: { type: 'object', properties: { file_path: { type: 'string', description: '文件相对路径' } }, required: ['file_path'] } } },
  { type: 'function', function: { name: 'list_directory', description: '列出目录内容', parameters: { type: 'object', properties: { path: { type: 'string', description: '目录路径' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'search_content', description: '搜索文件内容', parameters: { type: 'object', properties: { pattern: { type: 'string', description: '搜索关键词' }, path: { type: 'string', description: '搜索路径' } }, required: ['pattern'] } } },
  { type: 'function', function: { name: 'create_file', description: '创建新文件。写章节正文时用此工具，content为章节全文。file_path示例: 1/chapters/chapter1.txt', parameters: { type: 'object', properties: { file_path: { type: 'string' }, content: { type: 'string' } }, required: ['file_path', 'content'] } } },
  { type: 'function', function: { name: 'edit_file', description: '编辑文件', parameters: { type: 'object', properties: { file_path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' } }, required: ['file_path', 'old_string', 'new_string'] } } },
  { type: 'function', function: { name: 'delete_file', description: '删除文件', parameters: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] } } },
]

// ═══════════════════════════════════════════════════
//  系统提示词
// ═══════════════════════════════════════════════════
const SYS = [
  '你是青剑AI写作助手，一个专业的AI小说创作辅助工具。',
  '',
  '# 章节创作流程',
  '1. 先读取大纲(1/outline/plot.md)了解整体剧情',
  '2. 读取细纲(1/detailed_outline/chapter1.yaml)获取该章场景安排',
  '3. 读取角色(1/characters/许倩.yaml)了解人物设定',
  '4. 读取前章摘要(1/summaries/chapter0.md)了解前情',
  '5. 基于以上信息创作章节正文，字数要达标',
  '6. 用 create_file 保存到 1/chapters/chapter1.txt',
  '',
  '# 写作要求',
  '- 中文写作，文笔流畅',
  '- 严格按照细纲的场景顺序展开',
  '- 字数达到要求',
  '',
  '# 路径',
  '大纲: 1/outline/plot.md',
  '角色: 1/characters/许倩.yaml',
  '细纲: 1/detailed_outline/chapter1.yaml',
  '摘要: 1/summaries/chapter0.md',
  '章节: 1/chapters/chapter1.txt',
].join('\n')

// ═══════════════════════════════════════════════════
//  API 调用
// ═══════════════════════════════════════════════════
async function callOpenAI(messages) {
  const body = {
    model: MODEL,
    messages,
    max_tokens: 4096,
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
  console.log('  仿真测试: 章节创作 (08-chapter-writing)')
  console.log('  端点: ' + API_URL + '  模型: ' + MODEL)
  console.log('  模式: 读上下文 → 写章节 → 保存文件')
  console.log('══════════════════════════════════════')

  // 准备测试数据
  seedTestData()
  console.log('\n  [初始化] 测试数据已创建 (projects/1/)')

  // ──────────────────────────────────────────────
  //  S1: 写第1章正文
  // ──────────────────────────────────────────────
  hr('S1 章节创作 — “写第1章正文，1000字”')
  const r1 = await agentRun('写第1章正文，1000字')

  t('S1 返回文本', r1.text.length > 0, r1.text.length + '字')
  t('S1 read_file 被调用', r1.toolLog.some(l => l.name === 'read_file'),
    r1.toolLog.filter(l => l.name === 'read_file').length + '次')
  t('S1 create_file 被调用', r1.toolLog.some(l => l.name === 'create_file'),
    r1.toolLog.filter(l => l.name === 'create_file').length + '次')

  // 检查章节文件是否创建
  const chapterPath = P('1/chapters/chapter1.txt')
  const chapterExists = fs.existsSync(chapterPath)
  t('S1 章节文件已创建', chapterExists, chapterPath)

  let chapterContent = ''
  if (chapterExists) {
    chapterContent = fs.readFileSync(chapterPath, 'utf-8')
    const charCount = chapterContent.replace(/\s/g, '').length
    t('S1 章节内容至少500字', charCount >= 500, charCount + '字')
    console.log('    章节文件大小: ' + chapterContent.length + ' 字节, 有效字数: ' + charCount)
  }

  console.log('    工具调用: ' + r1.toolLog.map(l => l.name).join(', '))
  console.log('    回复: ' + r1.text.slice(0, 150))

  // 清理测试数据
  try { fs.rmSync(P('1'), { recursive: true, force: true }) } catch {}

  // ──────────────────────────────────────────────
  //  汇总
  // ──────────────────────────────────────────────
  const total = pass + fail
  console.log('\n')
  console.log('══════════════════════════════════════')
  console.log('  仿真测试: 章节创作 (08-chapter-writing) — 测试结果')
  console.log('══════════════════════════════════════')
  console.log('  ✅ ' + String(pass).padStart(2) + '  通过')
  console.log('  ❌ ' + String(fail).padStart(2) + '  失败')
  console.log('  通过率: ' + (total > 0 ? ((pass / total) * 100).toFixed(1) : '0.0') + '%')
  console.log('')
  console.log('  场景覆盖:')
  console.log('    S1  写第1章正文  — 读上下文 → 创作 → 保存')
  console.log('══════════════════════════════════════')

  if (fail > 0) process.exit(1)
}

main().catch(e => {
  console.error('\n测试异常:', e.message)
  console.error(e.stack)
  process.exit(1)
})
