#!/usr/bin/env node
/**
 * 仿真测试: 风格模板 (10-style-template)
 * 模拟用户上传文本，分析文风后创建风格模板。
 *
 * 场景: 读取测试文本 → 分析文风 → 创建风格模板
 * 验证: create_style_template 工具被调用，模板文件创建成功。
 *
 * 复杂度: 简单 — 1个风格分析场景
 * 工具覆盖: read_file, create_style_template
 *
 * 运行: node scripts/full-sim/10-style-template.mjs
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
const ST = p => path.join(ROOT, 'style_templates', p)

// ═══════════════════════════════════════════════════
//  准备测试数据
// ═══════════════════════════════════════════════════
function seedTestData() {
  const projDir = P('1')
  fs.mkdirSync(projDir, { recursive: true })

  const sampleProse = [
    '夜已深，窗外的梧桐叶在秋风中簌簌作响。',
    '',
    '沈清雪独坐灯前，手中握着一卷泛黄的古籍。烛火摇曳，在她清冷的侧脸上投下忽明忽暗的光影。她微微蹙眉，指尖在书页上轻轻划过，似乎在寻找什么。',
    '',
    '"师姐。"门外传来一声轻唤。',
    '',
    '沈清雪抬起头，目光淡淡地扫过房门。"进来。"',
    '',
    '门被推开，进来的是一个身着青色道袍的少女。她眉目清秀，眼中带着几分不安。',
    '',
    '"许倩，这么晚了还不歇息？"沈清雪的声音平静如水，听不出情绪。',
    '',
    '许倩低下头，手指不自觉地绞着衣角。"我......我睡不着。"',
    '',
    '沈清雪凝视她片刻，忽然轻轻叹了一口气。"过来坐吧。"',
    '',
    '许倩依言在旁边的蒲团上坐下。烛光映照在她年轻的脸上，映出一种青涩的坚定。',
    '',
    '"师姐，你说修仙之人，到底修的是什么？"',
    '',
    '沈清雪沉默良久，将手中的古籍合上。',
    '',
    '"修的是心。"她的声音很轻，却像落在水面的石子，在寂静的夜里荡开涟漪。',
    '',
    '窗外，一片梧桐叶悄然落下。',
    '',
    '【文风特征】',
    '- 节奏: 舒缓沉静，句子长短交替',
    '- 意象: 古风意象丰富（梧桐、烛火、古籍、道袍、蒲团）',
    '- 对话: 简洁含蓄，言有尽而意无穷',
    '- 描写: 侧重环境和神态，内心活动通过外部动作暗示',
    '- 视角: 第三人称有限视角，偏重清冷氛围',
    '- 语体: 文白夹杂，古韵典雅',
  ].join('\n')

  fs.writeFileSync(path.join(projDir, 'test_text.txt'), sampleProse)
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
      fs.mkdirSync(path.dirname(fp), { recursive: true })
      fs.writeFileSync(fp, a.content || '')
      return '创建成功: ' + a.file_path
    } catch (e) { return '[错误: ' + e.message + ']' }
  },

  create_style_template: a => {
    try {
      const name = a.name || ''
      const type = a.type || ''
      if (!name) return '[错误: name 是必填字段]'
      if (!type) return '[错误: type 是必填字段]'
      const fp = path.join(ROOT, 'style_templates', name + '.json')
      fs.mkdirSync(path.dirname(fp), { recursive: true })
      const template = {
        name,
        type,
        description: a.description || '',
        dimensions: a.dimensions || {},
        created_at: new Date().toISOString(),
      }
      fs.writeFileSync(fp, JSON.stringify(template, null, 2))
      return '风格模板创建成功: ' + name + ' (类型: ' + type + ') 已保存到 style_templates/' + name + '.json'
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
}

// ═══════════════════════════════════════════════════
//  OpenAI-format 工具定义
// ═══════════════════════════════════════════════════
const TOOLS = [
  { type: 'function', function: { name: 'read_file', description: '读取项目文件', parameters: { type: 'object', properties: { file_path: { type: 'string', description: '文件相对路径' } }, required: ['file_path'] } } },
  { type: 'function', function: { name: 'list_directory', description: '列出目录内容', parameters: { type: 'object', properties: { path: { type: 'string', description: '目录路径' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'search_content', description: '搜索文件内容', parameters: { type: 'object', properties: { pattern: { type: 'string', description: '搜索关键词' }, path: { type: 'string', description: '搜索路径' } }, required: ['pattern'] } } },
  { type: 'function', function: { name: 'create_file', description: '创建新文件', parameters: { type: 'object', properties: { file_path: { type: 'string' }, content: { type: 'string' } }, required: ['file_path', 'content'] } } },
  { type: 'function', function: { name: 'create_style_template', description: '创建风格模板。分析文本后，提取其文风特征，创建可复用的写作风格模板。必填: name, type。type建议: prose/narrative/dialogue/description。dimensions为文风维度JSON。', parameters: { type: 'object', properties: { name: { type: 'string', description: '模板名称' }, type: { type: 'string', description: '模板类型，如 prose, narrative, dialogue' }, description: { type: 'string', description: '模板描述' }, dimensions: { type: 'object', description: '文风维度，如 {sentence_rhythm:"舒缓", imagery_density:"高", dialogue_style:"含蓄", perspective:"第三人称有限"}' } }, required: ['name', 'type'] } } },
  { type: 'function', function: { name: 'edit_file', description: '编辑文件', parameters: { type: 'object', properties: { file_path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' } }, required: ['file_path', 'old_string', 'new_string'] } } },
  { type: 'function', function: { name: 'delete_file', description: '删除文件', parameters: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] } } },
]

// ═══════════════════════════════════════════════════
//  系统提示词
// ═══════════════════════════════════════════════════
const SYS = [
  '你是青剑AI写作助手，一个专业的AI小说创作辅助工具。',
  '',
  '# 风格模板创建流程',
  '1. 用户要求分析文风时，先读取指定文件',
  '2. 分析文本的文风特征：节奏、意象、对话风格、描写方式、语体等维度',
  '3. 使用 create_style_template 创建模板，提供 name、type、dimensions',
  '',
  '# 对话风格',
  '- 用中文回复，简洁明了。',
  '- 分析完成后汇报风格模板创建结果。',
  '',
  '# 路径',
  '用户文件: 1/test_text.txt',
  '风格模板保存在: style_templates/ 目录',
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
  console.log('  仿真测试: 风格模板 (10-style-template)')
  console.log('  端点: ' + API_URL + '  模型: ' + MODEL)
  console.log('  模式: 读取文本 → 分析文风 → 创建模板')
  console.log('══════════════════════════════════════')

  // 准备测试数据
  seedTestData()
  console.log('\n  [初始化] 测试文本已创建 (projects/1/test_text.txt)')

  // ──────────────────────────────────────────────
  //  S1: 分析文风并创建模板
  // ──────────────────────────────────────────────
  hr('S1 风格分析 — “分析 projects/1/test_text.txt 的文风，创建一个风格模板”')
  const r1 = await agentRun('分析 projects/1/test_text.txt 的文风，创建一个风格模板')

  t('S1 返回文本', r1.text.length > 0, r1.text.length + '字')
  t('S1 read_file 被调用', r1.toolLog.some(l => l.name === 'read_file'),
    r1.toolLog.filter(l => l.name === 'read_file').length + '次')
  t('S1 create_style_template 被调用', r1.toolLog.some(l => l.name === 'create_style_template'),
    r1.toolLog.filter(l => l.name === 'create_style_template').length + '次')

  // 检查模板文件是否创建
  const templateFiles = (() => {
    try { return fs.readdirSync(ST('')) } catch { return [] }
  })()
  const templateCreated = templateFiles.length > 0
  t('S1 模板文件已创建', templateCreated,
    templateCreated ? templateFiles.join(', ') : '无模板文件')

  console.log('    工具调用: ' + r1.toolLog.map(l => l.name).join(', '))
  console.log('    回复: ' + r1.text.slice(0, 150))

  // 清理
  try { fs.rmSync(P('1'), { recursive: true, force: true }) } catch {}
  try { fs.rmSync(ST(''), { recursive: true, force: true }) } catch {}

  // ──────────────────────────────────────────────
  //  汇总
  // ──────────────────────────────────────────────
  const total = pass + fail
  console.log('\n')
  console.log('══════════════════════════════════════')
  console.log('  仿真测试: 风格模板 (10-style-template) — 测试结果')
  console.log('══════════════════════════════════════')
  console.log('  ✅ ' + String(pass).padStart(2) + '  通过')
  console.log('  ❌ ' + String(fail).padStart(2) + '  失败')
  console.log('  通过率: ' + (total > 0 ? ((pass / total) * 100).toFixed(1) : '0.0') + '%')
  console.log('')
  console.log('  场景覆盖:')
  console.log('    S1  风格分析  — 读取文本 → 分析文风 → 创建模板')
  console.log('══════════════════════════════════════')

  if (fail > 0) process.exit(1)
}

main().catch(e => {
  console.error('\n测试异常:', e.message)
  console.error(e.stack)
  process.exit(1)
})
