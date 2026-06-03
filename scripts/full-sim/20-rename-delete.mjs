#!/usr/bin/env node
/**
 * 仿真测试: 文件重命名/删除 (20-rename-delete)
 *
 * 模拟真实用户打开AI写作助手，进行文件重命名/删除操作及错误恢复。
 *
 * 场景: 用户管理项目文件，包含重命名、删除、文件不存在时的搜索重试、用户修正等。
 *
 * 复杂度: medium — 2-4轮对话, 2-3个工具调用
 * 测试工具: rename_file, delete_file
 *
 * 运行: node scripts/full-sim/20-rename-delete.mjs
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
const ROOT = process.cwd()

const TEST_PROJECT = 'test_rename_delete'

// 路径快捷方式
const P  = p => path.join(ROOT, 'projects', p)
const N  = p => path.join(ROOT, 'notes', p)
const K  = p => path.join(ROOT, 'knowledge_base', 'files', p)

// ═══════════════════════════════════════════════════
//  工具实现（与 openai-sim-test.mjs 一致的完整工具集 + rename_file）
// ═══════════════════════════════════════════════════
const tools = {
  read_file: a => {
    try {
      const fp = a.file_path || a.path || ''
      const c = fs.readFileSync(P(fp), 'utf-8')
      return c.length > 3000 ? c.slice(0, 3000) + '\n…(' + c.length + '字)' : c
    } catch (e) {
      return `[错误: 文件不存在或无法读取: ${fp}]`
    }
  },

  list_directory: a => {
    const dir = a.path || a.dir_path || '.'
    try {
      const e = fs.readdirSync(P(dir), { withFileTypes: true })
      return e.map(x => (x.isDirectory() ? 'DIR ' : 'FILE ') + x.name).join('\n')
    } catch (e) {
      return `[错误: 目录不存在: ${dir}]`
    }
  },

  search_content: a => {
    try {
      const fp = P(a.path || '.')
      const re = new RegExp(
        (a.pattern || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'
      )
      const results = []
      function searchDir(d) {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const f = path.join(d, e.name)
          if (e.isDirectory()) { searchDir(f); continue }
          const c = fs.readFileSync(f, 'utf-8')
          const ls = c.split('\n')
          for (let i = 0; i < ls.length; i++)
            if (re.test(ls[i]))
              results.push(
                f.replace(ROOT + '/projects/', '') +
                  ':' + (i + 1) + ':' + ls[i].slice(0, 200)
              )
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
    } catch (e) {
      return '[错误: 搜索失败]'
    }
  },

  create_file: a => {
    try {
      const fp = P(a.file_path || a.path || '')
      const c = a.content || ''
      if (fp.endsWith('.json') && c) {
        try { JSON.parse(c) } catch (e) {
          return `[JSON格式错误: ${e.message}]`
        }
      }
      fs.mkdirSync(path.dirname(fp), { recursive: true })
      fs.writeFileSync(fp, c, 'utf-8')
      return `创建成功: ${a.file_path || a.path}`
    } catch (e) {
      return `[错误: ${e.message}]`
    }
  },

  edit_file: a => {
    try {
      const fp = P(a.file_path || a.path || '')
      let c = fs.readFileSync(fp, 'utf-8')
      const old = a.old_string || ''
      const nw = a.new_string || ''
      if (old === '__FULL_REPLACE__') {
        fs.writeFileSync(fp, nw, 'utf-8')
        return '全量替换成功'
      }
      let idx = c.indexOf(old)
      if (idx < 0) idx = c.indexOf(old.trim())
      if (idx < 0) return `[未找到匹配文本: "${old.slice(0, 80)}"]`
      fs.writeFileSync(fp, c.slice(0, idx) + nw + c.slice(idx + old.length), 'utf-8')
      return '编辑成功'
    } catch (e) {
      return `[错误: ${e.message}]`
    }
  },

  // ── 核心工具: rename_file ──
  rename_file: a => {
    try {
      const oldPath = P(a.file_path || a.old_path || a.path || '')
      const newPath = P(a.new_path || a.new_name || '')
      if (!oldPath || !newPath) return '[错误: 缺少源路径或目标路径]'
      if (!fs.existsSync(oldPath)) return `[错误: 源文件不存在: ${a.file_path || a.old_path}]`
      if (fs.existsSync(newPath)) return `[错误: 目标文件已存在: ${a.new_path || a.new_name}]`
      fs.mkdirSync(path.dirname(newPath), { recursive: true })
      fs.renameSync(oldPath, newPath)
      return `重命名成功: ${a.file_path || a.old_path} → ${a.new_path || a.new_name}`
    } catch (e) {
      return `[错误: 重命名失败: ${e.message}]`
    }
  },

  // ── 核心工具: delete_file ──
  delete_file: a => {
    try {
      const fp = P(a.file_path || a.path || '')
      if (!fp) return '[错误: 未指定文件路径]'
      if (!fs.existsSync(fp)) return `[错误: 文件不存在: ${a.file_path || a.path}]`
      const stat = fs.statSync(fp)
      if (stat.isDirectory()) {
        fs.rmSync(fp, { recursive: true, force: true })
        return `删除成功（目录）: ${a.file_path || a.path}`
      }
      fs.unlinkSync(fp)
      return `删除成功: ${a.file_path || a.path}`
    } catch (e) {
      return `[错误: 删除失败: ${e.message}]`
    }
  },

  // 其他Harness工具（简化实现）
  kb_list: () => {
    try {
      const files = fs.readdirSync(K('')).filter(f => f.endsWith('.md'))
      return files.join('\n') || '无KB文件'
    } catch { return '无KB文件' }
  },

  kb_create_file: a => {
    try {
      fs.mkdirSync(K(''), { recursive: true })
      fs.writeFileSync(K((a.name || 'x') + '.md'), a.content || '', 'utf-8')
      return 'KB创建成功'
    } catch (e) { return `[错误: ${e.message}]` }
  },

  list_notes: () => {
    try {
      fs.mkdirSync(N(''), { recursive: true })
      return fs.readdirSync(N('')).filter(f => f.endsWith('.md')).join('\n') || '无笔记'
    } catch { return '无笔记' }
  },

  write_note: a => {
    try {
      fs.mkdirSync(N(''), { recursive: true })
      fs.writeFileSync(N((a.name || 'x') + '.md'), a.content || '', 'utf-8')
      return '笔记创建成功'
    } catch (e) { return `[错误: ${e.message}]` }
  },

  read_note: a => {
    try {
      return fs.readFileSync(N((a.name || 'x') + '.md'), 'utf-8').slice(0, 500)
    } catch { return '[笔记不存在]' }
  },

  delete_note: a => {
    try {
      fs.unlinkSync(N((a.name || 'x') + '.md'))
      return '笔记删除成功'
    } catch { return '[错误]' }
  },

  create_style_template: a => {
    try {
      const fp = path.join(ROOT, 'style_templates', (a.name || 'x') + '.json')
      fs.mkdirSync(path.dirname(fp), { recursive: true })
      fs.writeFileSync(fp, JSON.stringify(a, null, 2), 'utf-8')
      return '模板创建成功'
    } catch (e) { return `[错误: ${e.message}]` }
  },

  create_project: a => {
    try {
      const d = P(a.name || 'new-project')
      ;['characters', 'chapters', 'outline', 'detailed_outline', 'summaries'].forEach(
        s => fs.mkdirSync(path.join(d, s), { recursive: true })
      )
      return `项目${a.name}创建成功`
    } catch (e) { return `[错误: ${e.message}]` }
  },

  delete_project: a => {
    try {
      fs.rmSync(P(a.name || ''), { recursive: true, force: true })
      return '项目删除成功'
    } catch (e) { return `[错误: ${e.message}]` }
  },

  list_prompts: () => '灵感/世界观/角色/大纲/细纲/章节/润色/续写/改写/摘要/审稿',

  list_rules: () => '暂无自定义规则',

  learn_rule: a => {
    return `规则已学习: ${(a.rule || '').slice(0, 60)}`
  },

  list_audit: () => '暂无审计记录',

  write_learning: a => {
    return `经验已记录: ${(a.summary || '').slice(0, 60)}`
  },
}

// ═══════════════════════════════════════════════════
//  OpenAI-format 工具定义
// ═══════════════════════════════════════════════════
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: '读取项目文件内容。不需要先list_directory。',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '文件相对路径，如 1/characters/林语晴.yaml' },
        },
        required: ['file_path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: '列出项目目录内容',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '目录路径，如 1/characters' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_content',
      description: '搜索项目文件内容',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: '搜索关键词或正则' },
          path: { type: 'string', description: '搜索路径(可选)' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_file',
      description: '创建新文件。JSON文件自动校验格式。',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '文件相对路径' },
          content: { type: 'string', description: '文件内容' },
        },
        required: ['file_path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: '编辑文件内容。先read_file确认原文。old_string=__FULL_REPLACE__表示全量替换。',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string' },
          old_string: { type: 'string' },
          new_string: { type: 'string' },
        },
        required: ['file_path', 'old_string', 'new_string'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: '删除项目文件或目录',
      parameters: {
        type: 'object',
        properties: { file_path: { type: 'string', description: '要删除的文件路径' } },
        required: ['file_path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rename_file',
      description: '重命名或移动项目文件',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '源文件路径（当前路径）' },
          new_path: { type: 'string', description: '目标文件路径（新路径/新名称）' },
        },
        required: ['file_path', 'new_path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'kb_list',
      description: '列出知识库文件',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'kb_create_file',
      description: '创建KB文件',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['name', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_notes',
      description: '列出所有笔记',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_note',
      description: '创建笔记',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['name', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_note',
      description: '读取笔记',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_note',
      description: '删除笔记',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_style_template',
      description: '创建风格模板',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          type: { type: 'string' },
        },
        required: ['name', 'type'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_project',
      description: '创建项目',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_project',
      description: '删除项目',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_prompts',
      description: '列出提示词模板',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_rules',
      description: '列出已学习规则',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'learn_rule',
      description: '学习新规则',
      parameters: {
        type: 'object',
        properties: { rule: { type: 'string' } },
        required: ['rule'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_audit',
      description: '查看审计记录',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_learning',
      description: '记录学习经验',
      parameters: {
        type: 'object',
        properties: { summary: { type: 'string' } },
        required: ['summary'],
      },
    },
  },
]

// ═══════════════════════════════════════════════════
//  系统提示词（CORE_SYSTEM_PROMPT 概念）
// ═══════════════════════════════════════════════════
const SYS = [
  '你是青剑AI写作助手，一个专业的AI小说创作辅助工具。',
  '',
  '# 铁律：何时用工具，何时不用',
  '✅ 调工具（用户要求操作文件）：读取/列出/搜索/创建/编辑/删除/重命名/移动/写/保存/修改/改/看(文件)/找(文件)',
  '❌ 不调工具（纯对话）：问候/闲聊/我是/我叫/我喜欢/我觉得/谢谢/什么是/为什么/怎么/推荐/建议/告诉我/聊天',
  '',
  '# 对话风格',
  '- 用中文回复，语气自然亲切，像朋友聊天。',
  '- 用户提到写作问题时，给出具体、实用的建议。',
  '- 回复简洁有力，不要啰嗦。',
  '',
  '# 执行规则',
  '- 已知文件路径直接操作，不需要先列目录。',
  '- 文件操作前如果路径不确定，先搜索或列出目录确认。',
  '- 重命名或删除文件时要精确确认路径，避免误操作。',
  '- 多个独立操作可在同一轮并行完成。有依赖的操作分轮执行。',
  '- 只做用户要求的，不多做。',
  '- **关键**: 用户只是在聊天/问候/表达感受/询问建议时，绝对不要调用任何工具，直接用文字回复。',
  '',
  '# 路径速查',
  '角色: {项目}/characters/{中文名}.yaml  例: 1/characters/林语晴.yaml',
  '章节: {项目}/chapters/chapter{N}.txt   例: 1/chapters/chapter3.txt',
  '细纲: {项目}/detailed_outline/chapter{N}.yaml',
  '大纲: {项目}/outline/plot.md',
  '摘要: {项目}/summaries/summary.md',
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
//  Agent 单轮循环
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
    process.stdout.write(`  [iter${iterations}] `)

    const r = await callOpenAI(messages)
    if (r.text) fullText = r.text

    if (!r.toolCalls.length) {
      process.stdout.write(`文本回复(${r.text.length}字)\n`)
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
      const icon = ok ? '✓' : '✗'
      totalTools++

      process.stdout.write(`${fn.name}${icon} `)
      toolLog.push({ name: fn.name, ok, args, result: result.slice(0, 120) })

      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: result,
      })
    }
    process.stdout.write('\n')
  }

  return { text: fullText, iterations, toolCalls: totalTools, toolLog }
}

// ═══════════════════════════════════════════════════
//  多轮对话运行（模拟真实用户的多轮交互）
// ═══════════════════════════════════════════════════
async function multiTurnRun(userMessages) {
  const messages = [{ role: 'system', content: SYS }]
  let totalIterations = 0, totalTools = 0, allTexts = [], allUsages = []
  const allToolLogs = []
  let toolCallNames = []

  for (let turnIdx = 0; turnIdx < userMessages.length; turnIdx++) {
    const userMsg = userMessages[turnIdx]
    messages.push({ role: 'user', content: userMsg })
    const preview = userMsg.length > 50 ? userMsg.slice(0, 47) + '...' : userMsg
    process.stdout.write(`  [轮${turnIdx + 1}] "${preview}" `)

    let turnIterations = 0
    const turnToolLog = []
    while (turnIterations < MAX_ITERATIONS) {
      turnIterations++
      totalIterations++
      const r = await callOpenAI(messages)
      if (r.text) allTexts.push(r.text)
      if (r.usage) allUsages.push(r.usage)

      if (!r.toolCalls.length) {
        const tpreview = r.text.length > 80 ? r.text.slice(0, 77) + '...' : r.text
        process.stdout.write(`→ ${tpreview}\n`)
        break
      }

      const asstMsg = { role: 'assistant', content: r.text || null, tool_calls: r.toolCalls }
      messages.push(asstMsg)

      for (const tc of r.toolCalls) {
        const fn = tc.function
        const toolFn = tools[fn.name]
        let args = {}
        try { args = JSON.parse(fn.arguments) } catch {}
        const result = toolFn ? await toolFn(args) : '[未知工具]'
        const ok = result.startsWith && !result.startsWith('[')
        const icon = ok ? '✓' : '✗'
        totalTools++
        toolCallNames.push(fn.name)
        turnToolLog.push({ name: fn.name, ok, args, result: result.slice(0, 120) })
        process.stdout.write(`${fn.name}${icon} `)
        messages.push({ role: 'tool', tool_call_id: tc.id, content: result })
      }
      process.stdout.write('\n')
    }
    allToolLogs.push(turnToolLog)
  }

  return {
    text: allTexts[allTexts.length - 1] || '',
    allTexts,
    iterations: totalIterations,
    toolCalls: totalTools,
    toolCallNames,
    allToolLogs,
    totalTokens: allUsages.reduce((s, u) => s + (u.total_tokens || 0), 0),
  }
}

// ═══════════════════════════════════════════════════
//  测试辅助
// ═══════════════════════════════════════════════════
let pass = 0
let fail = 0

function t(name, cond, detail) {
  if (cond) {
    pass++
    console.log('  ✅ ' + name + (detail !== undefined ? ': ' + detail : ''))
  } else {
    fail++
    console.log('  ❌ ' + name + (detail !== undefined ? ': ' + detail : ''))
  }
}

function hr(title) {
  console.log('\n' + '─'.repeat(58))
  console.log('  ' + title)
  console.log('─'.repeat(58))
}

/**
 * 检查文件是否存在
 */
function fileExists(relPath) {
  return fs.existsSync(P(relPath))
}

/**
 * 读取文件内容
 */
function readFile(relPath) {
  try { return fs.readFileSync(P(relPath), 'utf-8') } catch { return null }
}

// ═══════════════════════════════════════════════════
//  测试环境准备
// ═══════════════════════════════════════════════════
function setupTestFiles() {
  const base = P(TEST_PROJECT)
  const dirs = ['characters', 'chapters', 'outline', 'summaries']
  for (const d of dirs) {
    fs.mkdirSync(path.join(base, d), { recursive: true })
  }

  // chapter1.txt — 用于重命名测试
  fs.writeFileSync(
    path.join(base, 'chapters', 'chapter1.txt'),
    [
      '第一章 天降异象',
      '',
      '夜幕降临，天剑宗后山的禁地深处突然闪过一道金光。',
      '那道光芒刺破了层层云雾，直冲云霄，方圆百里的修士都能感受到那股"',
      '磅礴的灵气波动。',
      '',
      '林语晴从打坐中猛然睁开双眼。她已经在后山修炼了整整七天七夜，',
      '为的就是突破筑基后期的瓶颈。此刻她感觉到体内的灵力正在疯狂涌动，',
      '像是被那道金光牵引着，不受控制地朝禁地方向汇聚。',
      '',
      '"这是什么力量……"她低声自语，手指不自觉地握紧了腰间的佩剑。',
    ].join('\n'),
    'utf-8'
  )

  // chapter2.txt — 保留，用于验证不会误操作
  fs.writeFileSync(
    path.join(base, 'chapters', 'chapter2.txt'),
    [
      '第二章 剑意初显',
      '',
      '林语晴深吸一口气，压下心中的不安，朝着金光的方向御剑飞去。',
      '越靠近禁地，空气中的灵气就越发浓郁，几乎凝成了实质的白雾。',
    ].join('\n'),
    'utf-8'
  )

  // temp_角色.json — 用于删除测试
  fs.writeFileSync(
    path.join(base, 'characters', 'temp_角色.json'),
    JSON.stringify(
      {
        id: 'temp_role',
        name: '临时角色',
        role: '配角',
        gender: '男',
        age: 30,
        occupation: '散修',
        background: '这是一个临时创建的角色，用于测试删除功能',
        appearance: '普通容貌',
        personality: '随和',
        abilities: '基础法术',
        weaknesses: '修为低微',
        relationships: '无',
        relationshipTags: [],
        arc: '无',
        importance: 10,
        motivations: '生存',
      },
      null,
      2
    ),
    'utf-8'
  )

  // notes.md — 用于重命名修正测试
  fs.writeFileSync(
    path.join(base, 'outline', 'notes.md'),
    [
      '# 大纲笔记',
      '',
      '- 第一幕：主角入世',
      '- 第二幕：宗门大比',
      '- 第三幕：魔族入侵',
      '- 第四幕：最终决战',
    ].join('\n'),
    'utf-8'
  )

  // summary.md — 用于错误恢复测试（存在但路径需要搜索确认）
  fs.writeFileSync(
    path.join(base, 'summaries', 'summary.md'),
    [
      '# 故事概要',
      '',
      '《天剑录》讲述了一个平凡少年偶然获得上古剑诀，',
      '踏上修仙之路的传奇故事。',
    ].join('\n'),
    'utf-8'
  )

  console.log('  📁 测试文件已创建于 projects/' + TEST_PROJECT)
}

/**
 * 清理测试文件
 */
function cleanupTestFiles() {
  try {
    const base = P(TEST_PROJECT)
    if (fs.existsSync(base)) {
      fs.rmSync(base, { recursive: true, force: true })
      console.log('  🧹 已清理测试目录: projects/' + TEST_PROJECT)
    }
  } catch (e) {
    console.log('  ⚠ 清理失败: ' + e.message)
  }
}

// ═══════════════════════════════════════════════════
//  主测试流程
// ═══════════════════════════════════════════════════
async function main() {
  console.log('═══════════════════════════════════════════════')
  console.log('  仿真测试: 文件重命名/删除 (20-rename-delete)')
  console.log('  端点: ' + API_URL + '  模型: ' + MODEL)
  console.log('  场景: rename + delete + 错误恢复 + 用户修正')
  console.log('═══════════════════════════════════════════════\n')

  // ── 准备测试环境 ──
  setupTestFiles()

  // ═════════════════════════════════════════════════
  //  S1: 基本重命名 — 单文件重命名
  // ═════════════════════════════════════════════════
  hr('S1 基本重命名: chapter1.txt → ch01-开篇.txt')
  const s1PreExists = fileExists(TEST_PROJECT + '/chapters/chapter1.txt')
  t('S1 前置: 源文件存在', s1PreExists)

  const r1 = await agentRun(
    '帮我把' + TEST_PROJECT + '/chapters/chapter1.txt 重命名成 ch01-开篇.txt，我想统一一下章节文件的命名风格'
  )
  t('S1 调用了rename_file', r1.toolLog.some(l => l.name === 'rename_file'),
    r1.toolLog.map(l => l.name + (l.ok ? '✓' : '✗')).join(', '))
  t('S1 rename_file执行成功', r1.toolLog.some(l => l.name === 'rename_file' && l.ok))
  const s1NewExists = fileExists(TEST_PROJECT + '/chapters/ch01-开篇.txt')
  const s1OldGone = !fileExists(TEST_PROJECT + '/chapters/chapter1.txt')
  t('S1 新文件已创建', s1NewExists, TEST_PROJECT + '/chapters/ch01-开篇.txt')
  t('S1 旧文件已移除', s1OldGone)
  t('S1 返回了文本回复', r1.text.length > 0, r1.text.length + '字')
  console.log('    回复: ' + r1.text.slice(0, 150))

  // ═════════════════════════════════════════════════
  //  S2: 基本删除 — 删除临时JSON文件
  // ═════════════════════════════════════════════════
  hr('S2 基本删除: 删除 temp_角色.json')
  const s2PreExists = fileExists(TEST_PROJECT + '/characters/temp_角色.yaml')
  t('S2 前置: 待删文件存在', s2PreExists)

    const r2 = await agentRun(
    '那个' + TEST_PROJECT + '/characters/temp_角色.yaml 是个临时测试文件，帮我删掉它吧'
  )
  t('S2 调用了delete_file', r2.toolLog.some(l => l.name === 'delete_file'),
    r2.toolLog.map(l => l.name + (l.ok ? '✓' : '✗')).join(', '))
  t('S2 delete_file执行成功', r2.toolLog.some(l => l.name === 'delete_file' && l.ok))
  const s2FileGone = !fileExists(TEST_PROJECT + '/characters/temp_角色.yaml')
  t('S2 文件已被删除', s2FileGone)
  console.log('    回复: ' + r2.text.slice(0, 150))

  // ═════════════════════════════════════════════════
  //  S3: 文件不存在 → 搜索 → 重试（错误恢复）
  // ═════════════════════════════════════════════════
  hr('S3 错误恢复: 路径错误 → 搜索 → 找到后重命名')
  // 用户输入一个不精确的路径，AI应该能搜索找到后操作
  const r3a = await agentRun(
    '帮我把那个summary.md文件重命名为summary-v2.md，我找不到了，好像在summaries目录里，你帮我查查'
  )
  const s3HasSearch = r3a.toolLog.some(l => l.name === 'search_content' || l.name === 'list_directory')
  const s3HasRename = r3a.toolLog.some(l => l.name === 'rename_file')
  t('S3 搜索或列出目录定位文件', s3HasSearch,
    r3a.toolLog.map(l => l.name).join(', '))
  t('S3 定位后执行重命名', s3HasRename)
  const s3NewExists = fileExists(TEST_PROJECT + '/summaries/summary-v2.md')
  const s3OldGone = !fileExists(TEST_PROJECT + '/summaries/summary.md')
  t('S3 重命名后新文件存在', s3NewExists, TEST_PROJECT + '/summaries/summary-v2.md')
  t('S3 重命名后旧文件移除', s3OldGone)
  console.log('    回复: ' + r3a.text.slice(0, 150))

  // ═════════════════════════════════════════════════
  //  S4: 用户修正 — "不对，改成..."
  // ═════════════════════════════════════════════════
  hr('S4 用户修正: "不对，改成..." 修正重命名目标')
  const s4a = await agentRun(
    '帮我把' + TEST_PROJECT + '/outline/notes.md 重命名为 outline-notes.md'
  )
  t('S4 首次重命名执行', s4a.toolLog.some(l => l.name === 'rename_file' && l.ok))
  const s4FirstExists = fileExists(TEST_PROJECT + '/outline/outline-notes.md')
  t('S4 首次重命名结果确认', s4FirstExists)

  // 用户修正：改个名字
  const r4b = await agentRun(
    '不对不对，刚才说错了。还是改成 outline-大纲笔记.md 吧，不要叫 outline-notes.md 了，帮我把名字改过来'
  )
  t('S4 修正调用了rename_file', r4b.toolLog.some(l => l.name === 'rename_file'),
    r4b.toolLog.map(l => l.name + (l.ok ? '✓' : '✗')).join(', '))
  const s4FinalExists = fileExists(TEST_PROJECT + '/outline/outline-大纲笔记.md')
  const s4MidGone = !fileExists(TEST_PROJECT + '/outline/outline-notes.md')
  t('S4 修正后新文件名存在', s4FinalExists, TEST_PROJECT + '/outline/outline-大纲笔记.md')
  t('S4 旧名称已不存在', s4MidGone)
  console.log('    回复: ' + r4b.text.slice(0, 150))

  // ═════════════════════════════════════════════════
  //  S5: 边界测试 — 删除不存在的文件
  // ═════════════════════════════════════════════════
  hr('S5 边界: 删除不存在的文件（错误处理）')
  const r5 = await agentRun(
    '帮我删掉' + TEST_PROJECT + '/chapters/ghost-chapter.txt，这个文件好像不存在，你看看'
  )
  t('S5 尝试删除不存在的文件', r5.toolLog.some(l => l.name === 'delete_file'),
    r5.toolLog.map(l => l.name + (l.ok ? '✓' : '✗')).join(', '))
  // delete_file 对不存在的文件返回错误，这是正确的行为
  const s5HasError = r5.toolLog.some(l => l.name === 'delete_file' && !l.ok)
  t('S5 工具正确返回错误', s5HasError, '不存在文件应返回错误')
  t('S5 AI有文本回复说明情况', r5.text.length > 0, r5.text.length + '字')
  console.log('    回复: ' + r5.text.slice(0, 150))

  // ═════════════════════════════════════════════════
  //  S6: 边界测试 — 重命名为已存在的文件名
  // ═════════════════════════════════════════════════
  hr('S6 边界: 重命名为已存在的文件名（冲突检测）')
  const r6 = await agentRun(
    '帮我把' + TEST_PROJECT + '/chapters/chapter2.txt 重命名为 ch01-开篇.txt，看看会怎样'
  )
  t('S6 尝试重命名为已存在文件', r6.toolLog.some(l => l.name === 'rename_file'),
    r6.toolLog.map(l => l.name + (l.ok ? '✓' : '✗')).join(', '))
  // chapter2.txt 应该还在（没有被覆盖）
  const s6Chap2StillThere = fileExists(TEST_PROJECT + '/chapters/chapter2.txt')
  t('S6 原文件未被破坏', s6Chap2StillThere, 'chapter2.txt仍然存在')
  console.log('    回复: ' + r6.text.slice(0, 150))

  // ═════════════════════════════════════════════════
  //  S7: 多轮对话 — 自然流畅的重命名+删除组合
  // ═════════════════════════════════════════════════
  hr('S7 多轮对话: 自然rename+delete组合')

  // 先创建几个临时文件用于此场景
  const tmpFiles = [
    {
      fp: TEST_PROJECT + '/chapters/draft_v1.txt',
      content: '版本1的草稿内容，这是第一次写的版本。\n有些地方还不太满意。\n',
    },
    {
      fp: TEST_PROJECT + '/chapters/draft_v2.txt',
      content: '版本2的草稿内容，修改了一些用词和段落。\n比第一版流畅了一些。\n',
    },
    {
      fp: TEST_PROJECT + '/chapters/draft_v3.txt',
      content: '版本3的草稿内容，这一版整体结构更清晰了。\n可以用于正式章节。\n',
    },
  ]
  for (const f of tmpFiles) {
    fs.mkdirSync(path.dirname(P(f.fp)), { recursive: true })
    fs.writeFileSync(P(f.fp), f.content, 'utf-8')
  }

  const chatFlow = [
    '我项目里chapters下面有几个draft文件，draft_v1和draft_v2都不需要了，帮我删掉它们',
    '好的，然后再把draft_v3重命名为chapter-final.txt，这就是最终版本了',
    '不对，我想了想，还是要保留v1作为历史记录吧。你刚才是不是已经删了draft_v1？算了算了，那v3改成chapter-final-v3.txt吧',
  ]

  const r7 = await multiTurnRun(chatFlow)
  t('S7 多轮对话全部有回复', r7.allTexts.length === chatFlow.length,
    `${r7.allTexts.length}/${chatFlow.length}轮`)
  t('S7 涉及delete_file操作', r7.toolCallNames.includes('delete_file'),
    '工具: ' + r7.toolCallNames.join(', '))
  t('S7 涉及rename_file操作', r7.toolCallNames.includes('rename_file'),
    '工具: ' + r7.toolCallNames.join(', '))

  for (let i = 0; i < r7.allTexts.length; i++) {
    const ap = r7.allTexts[i].length > 80 ? r7.allTexts[i].slice(0, 77) + '...' : r7.allTexts[i]
    console.log(`    轮${i + 1}: ${ap}`)
  }

  // ═════════════════════════════════════════════════
  //  S8: 纯对话 — 闲聊中提及文件名但不触发工具
  // ═════════════════════════════════════════════════
  hr('S8 闲聊中提及文件(不应触发工具)')
  const r8 = await agentRun(
    '我刚刚把chapter-final-v3.txt整理好了，你觉得章节命名应该用英文还是中文比较好？'
  )
  t('S8 闲聊零工具调用', r8.toolCalls === 0, r8.toolCalls + '个工具')
  t('S8 回复是建议而非操作', r8.text.length > 20, r8.text.length + '字')
  console.log('    回复: ' + r8.text.slice(0, 150))

  // ═════════════════════════════════════════════════
  //  S9: 边界 — 重命名验证文件内容完整性
  // ═════════════════════════════════════════════════
  hr('S9 重命名后内容完整性验证')
  // 先创建一个有明确内容的文件
  const s9Content = '这是测试文件内容，用于验证重命名后内容是否完整保留。\n第二行内容。\n第三行。'
  const s9Src = TEST_PROJECT + '/chapters/integrity-test.txt'
  fs.writeFileSync(P(s9Src), s9Content, 'utf-8')

  const r9 = await agentRun(
    '帮我把' + TEST_PROJECT + '/chapters/integrity-test.txt 重命名为 integrity-renamed.txt'
  )
  t('S9 重命名执行成功', r9.toolLog.some(l => l.name === 'rename_file' && l.ok))

  const s9RenamedContent = readFile(TEST_PROJECT + '/chapters/integrity-renamed.txt')
  t('S9 重命名后内容完整', s9RenamedContent === s9Content,
    `原始${s9Content.length}字 → 重命名后${s9RenamedContent ? s9RenamedContent.length : 0}字`)

  // ═════════════════════════════════════════════════
  //  S10: 长对话 — 用户长篇描述后执行重命名
  // ═════════════════════════════════════════════════
  hr('S10 长篇上下文中的重命名操作')
  const longMsg = [
    '你好，我最近在整理项目文件结构。我发现' + TEST_PROJECT + '/chapters/chapter2.txt 这个文件，',
    '它的内容其实是第二章"剑意初显"，但是文件名叫chapter2没有体现出章节主题。',
    '我之前看其他项目里有人用"ch02-章节名"这种命名方式，我觉得挺好的。',
    '这样一看文件名就知道这章讲什么内容了。你觉得这种命名方式好吗？',
    '如果可以的话，帮我把它重命名为 ch02-剑意初显.txt 吧。',
    '对了，重命名完帮我确认一下文件还在不在。',
  ].join('')
  t('S10 长消息超过200字', longMsg.length >= 200, longMsg.length + '字')

  const r10 = await agentRun(longMsg)
  const s10HasRename = r10.toolLog.some(l => l.name === 'rename_file')
  t('S10 长篇上下文后执行rename', s10HasRename,
    r10.toolLog.map(l => l.name + (l.ok ? '✓' : '✗')).join(', '))
  t('S10 返回了文本回复', r10.text.length > 0, r10.text.length + '字')
  console.log('    回复: ' + r10.text.slice(0, 200))

  // ═════════════════════════════════════════════════
  //  S11: 带错别字的用户消息
  // ═════════════════════════════════════════════════
  hr('S11 带错别字的文件操作消息')
  // 先确保有这个文件
  fs.writeFileSync(P(TEST_PROJECT + '/chapters/typo-test.txt'), '错别字测试文件内容', 'utf-8')

  const r11 = await agentRun(
    '帮我把' + TEST_PROJECT + '/chapters/typo-test.txt 丛命名成 corrected-name.txt，快点儿'
  )
  t('S11 错字消息仍正确执行rename', r11.toolLog.some(l => l.name === 'rename_file' && l.ok),
    r11.toolLog.map(l => l.name + (l.ok ? '✓' : '✗')).join(', '))
  console.log('    回复: ' + r11.text.slice(0, 150))

  // ═════════════════════════════════════════════════
  //  S12: 极简确认类消息 — 继续/好的
  // ═════════════════════════════════════════════════
  hr('S12 极简确认消息')
  const r12a = await agentRun('好的')
  t('S12 "好的"零工具调用', r12a.toolCalls === 0)
  const r12b = await agentRun('继续')
  t('S12 "继续"零工具调用', r12b.toolCalls === 0)
  const r12c = await agentRun('嗯嗯，就这样')
  t('S12 "嗯嗯"零工具调用', r12c.toolCalls === 0)
  console.log('    好的   → ' + (r12a.text || '(空)').slice(0, 60))
  console.log('    继续   → ' + (r12b.text || '(空)').slice(0, 60))
  console.log('    嗯嗯   → ' + (r12c.text || '(空)').slice(0, 60))

  // ═════════════════════════════════════════════════
  //  清理
  // ═════════════════════════════════════════════════
  cleanupTestFiles()

  // ═════════════════════════════════════════════════
  //  汇总
  // ═════════════════════════════════════════════════
  const total = pass + fail
  console.log('\n')
  console.log('═══════════════════════════════════════════════')
  console.log('  仿真测试: 文件重命名/删除 (20-rename-delete) — 结果')
  console.log('═══════════════════════════════════════════════')
  console.log('  ✅ ' + String(pass).padStart(2) + '  通过')
  console.log('  ❌ ' + String(fail).padStart(2) + '  失败')
  console.log('  总计: ' + total + '  通过率: ' + (total > 0 ? ((pass / total) * 100).toFixed(1) : '0.0') + '%')
  console.log('')
  console.log('  场景覆盖:')
  console.log('    - S1  基本重命名 (rename_file)')
  console.log('    - S2  基本删除 (delete_file)')
  console.log('    - S3  文件不存在 → 搜索 → 重试（错误恢复）')
  console.log('    - S4  用户修正 "不对，改成..."')
  console.log('    - S5  删除不存在的文件（错误处理）')
  console.log('    - S6  重命名冲突检测（目标已存在）')
  console.log('    - S7  多轮对话: 自然rename+delete组合')
  console.log('    - S8  闲聊中提及文件（不触发工具）')
  console.log('    - S9  重命名后内容完整性验证')
  console.log('    - S10 长篇上下文中的重命名操作')
  console.log('    - S11 带错别字的文件操作消息')
  console.log('    - S12 极简确认消息（好的/继续/嗯嗯）')
  console.log('═══════════════════════════════════════════════')

  if (fail > 0) process.exit(1)
}

// ═══════════════════════════════════════════════════
//  入口
// ═══════════════════════════════════════════════════
main().catch(e => {
  console.error('\n💥 测试异常:', e.message)
  console.error(e.stack)
  process.exit(1)
})
