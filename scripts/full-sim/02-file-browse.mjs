#!/usr/bin/env node
/**
 * 仿真测试: 文件浏览
 * 模拟用户打开AI写作助手，执行真实对话操作。
 * 测试目标: list_directory / read_file 两个核心文件浏览工具。
 *
 * 测试场景:
 *   S1 闲聊防误调 — 纯文本对话不应调用工具
 *   S2 基本列目录 — 列出项目1的characters目录
 *   S3 直接读文件 — 读取已知路径角色文件
 *   S4 文件不存在→重试 — 错误恢复（先读错路径，纠错后重读）
 *   S5 列+读组合 — 先列目录再看具体文件
 *   S6 连续多轮操作 — 用户跟进"好的""继续""再看看别的"
 *   S7 读大文件 — 读取长篇章节文件
 *   S8 读+检查JSON — 读文件并验证JSON合法性
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

// ── 路径配置 ──
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_ROOT = path.resolve(__dirname, '..', '..')
const PROJECTS_DIR = path.join(APP_ROOT, 'projects')
const KB_DIR = path.join(APP_ROOT, 'knowledge_base', 'files')
const NOTES_DIR = path.join(APP_ROOT, 'notes')
const STYLE_DIR = path.join(APP_ROOT, 'style_templates')
const SCENE_DIR = path.join(APP_ROOT, 'scene_templates')

const API_KEY = process.env.AI_API_KEY || 'sk-c9c30831df7243209435c60e811c879d'
const API_URL = 'https://api.deepseek.com/v1/chat/completions'
const MODEL = 'deepseek-v4-flash'
const MAX_ITERATIONS = 12

// ── 路径辅助 ──
const P = p => path.join(PROJECTS_DIR, p)
const N = p => path.join(NOTES_DIR, p)
const K = p => path.join(KB_DIR, p)

// ══════════════════════════════════════════════════════════════
//  工具实现 — 与 openai-sim-test.mjs 保持一致的模式
// ══════════════════════════════════════════════════════════════

function list_directory(args) {
  const dir = args.path || args.dir_path || '.'
  try {
    const fullPath = P(dir)
    const stat = fs.statSync(fullPath)

    // 如果路径是文件，返回文件信息
    if (stat.isFile()) {
      const size = stat.size
      const szLabel = size >= 1048576 ? `${(size/1048576).toFixed(1)}MB`
        : size >= 1024 ? `${(size/1024).toFixed(1)}KB` : `${size}B`
      return [
        `路径 "${dir}" 是一个文件`,
        `名称: ${path.basename(dir)}`,
        `大小: ${szLabel} (${size} 字节)`,
        `修改时间: ${stat.mtime.toISOString().replace('T',' ').slice(0,19)}`,
      ].join('\n')
    }

    const entries = fs.readdirSync(fullPath, { withFileTypes: true })
    if (entries.length === 0) return `目录 "${dir}" 是空的，没有任何文件或子目录。`

    const dirs = entries.filter(e => e.isDirectory())
    const files = entries.filter(e => e.isFile())

    // 显示文件大小
    const fileLines = files.map(e => {
      let sz = ''
      try {
        const s = fs.statSync(path.join(fullPath, e.name)).size
        if (s >= 1048576) sz = ` (${(s/1048576).toFixed(1)}MB)`
        else if (s >= 1024) sz = ` (${(s/1024).toFixed(1)}KB)`
        else sz = ` (${s}B)`
      } catch { /* ignore */ }
      return `  FILE  ${e.name}${sz}`
    })

    let result = `目录 "${dir}" 含 ${dirs.length} 个子目录 + ${files.length} 个文件:\n`
    for (const d of dirs) result += `  DIR   ${d.name}/\n`
    for (const l of fileLines) result += l + '\n'
    result += `\n共 ${entries.length} 个条目`
    return result.trimEnd()
  } catch (e) {
    if (e.code === 'ENOENT') return `[错误: 目录不存在] "${dir}"——该路径下没有找到目录或文件，请确认路径是否正确。`
    if (e.code === 'ENOTDIR') return `[错误: 不是目录] "${dir}" 是一个文件而非目录。请使用 read_file 读取它。`
    return `[错误: ${e.message}]`
  }
}

function read_file(args) {
  const fp = args.file_path || args.path || ''
  if (!fp) return `[错误: 缺少 file_path 参数] 必须提供要读取的文件路径。`
  try {
    const fullPath = P(fp)
    const stat = fs.statSync(fullPath)
    if (stat.isDirectory()) return `[错误: 是目录] "${fp}" 是一个目录而非文件。请使用 list_directory 查看它。`

    const content = fs.readFileSync(fullPath, 'utf-8')
    const size = content.length
    const lines = content.split('\n').length

    // 超长文件截断显示 + 统计信息
    if (size > 4000) {
      const preview = content.slice(0, 4000)
      return [
        `[文件: ${fp}]`,
        `大小: ${size} 字符, ${lines} 行`,
        `以下是前 4000 字符预览:`,
        preview,
        `\n…(后面还有 ${size - 4000} 字符未显示，共 ${lines} 行)…`,
        `[提示] 文件较大(${size}字符)，如需查看特定内容建议使用 search_content 搜索。`,
      ].join('\n')
    }
    return [`[文件: ${fp}]`, `大小: ${size} 字符, ${lines} 行`, content].join('\n')
  } catch (e) {
    if (e.code === 'ENOENT') {
      // 尝试搜索相似文件名
      const dir = path.dirname(fp)
      const base = path.basename(fp)
      let suggestions = ''
      try {
        const parentDir = P(dir)
        const entries = fs.readdirSync(parentDir, { withFileTypes: true })
        const files = entries.filter(e => e.isFile()).map(e => e.name)
        if (files.length > 0) {
          suggestions = `\n提示: "${dir}" 目录下的可用文件: ${files.slice(0, 8).join(', ')}${files.length > 8 ? ' 等...' : ''}`
        }
      } catch { /* dir may also not exist */ }
      return `[错误: 文件不存在] "${fp}"${suggestions}`
    }
    return `[错误: ${e.message}]`
  }
}

function search_content(args) {
  try {
    const searchPath = args.path || '.'
    const fullPath = P(searchPath)
    const pattern = args.pattern || ''
    if (!pattern) return `[错误: 缺少搜索关键词]`

    const re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
    const results = []

    function searchDir(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const fp = path.join(dir, e.name)
        if (e.isDirectory()) { searchDir(fp); continue }
        try {
          const c = fs.readFileSync(fp, 'utf-8')
          const ls = c.split('\n')
          for (let i = 0; i < ls.length; i++) if (re.test(ls[i])) {
            results.push(`${fp.replace(APP_ROOT+'/projects/', '')}:${i+1}: ${ls[i].slice(0, 200)}`)
          }
        } catch { /* binary or locked file */ }
      }
    }

    if (fs.statSync(fullPath).isFile()) {
      const c = fs.readFileSync(fullPath, 'utf-8')
      const ls = c.split('\n')
      for (let i = 0; i < ls.length; i++) if (re.test(ls[i])) {
        results.push(`${searchPath}:${i+1}: ${ls[i].slice(0, 200)}`)
      }
    } else {
      searchDir(fullPath)
    }
    return results.length > 0
      ? `找到 ${results.length} 处匹配:\n${results.slice(0, 15).join('\n')}${results.length > 15 ? `\n…还有 ${results.length - 15} 处` : ''}`
      : `在 "${searchPath}" 中未找到 "${pattern}"`
  } catch (e) {
    return `[错误: 搜索失败] ${e.message}`
  }
}

function create_file(args) {
  try {
    const fp = args.file_path || args.path || ''
    if (!fp) return `[错误: 缺少文件路径]`
    const content = args.content || ''
    if (fp.endsWith('.json') && content) {
      try { JSON.parse(content) } catch (e) { return `[JSON格式错误: ${e.message}] 请修正JSON格式后重试。` }
    }
    fs.mkdirSync(path.dirname(P(fp)), { recursive: true })
    fs.writeFileSync(P(fp), content, 'utf-8')
    return `创建成功: ${fp} (${content.length} 字符)`
  } catch (e) { return `[错误: ${e.message}]` }
}

function edit_file(args) {
  try {
    const fp = P(args.file_path || args.path)
    const content = fs.readFileSync(fp, 'utf-8')
    const oldStr = args.old_string || ''
    const newStr = args.new_string || ''
    if (oldStr === '__FULL_REPLACE__') { fs.writeFileSync(fp, newStr, 'utf-8'); return '全量替换成功' }
    let idx = content.indexOf(oldStr)
    if (idx < 0) idx = content.indexOf(oldStr.trim())
    if (idx < 0) return `[未找到匹配文本] "${oldStr.slice(0, 80)}"`
    fs.writeFileSync(fp, content.slice(0, idx) + newStr + content.slice(idx + oldStr.length), 'utf-8')
    return '编辑成功'
  } catch (e) { return `[错误: ${e.message}]` }
}

function delete_file(args) {
  try { fs.unlinkSync(P(args.file_path || args.path)); return '删除成功' } catch { return '[错误: 删除失败]' }
}

function kb_list() {
  try {
    const files = fs.readdirSync(K('')).filter(f => f.endsWith('.md'))
    return files.length > 0 ? `知识库共 ${files.length} 个文件:\n${files.map(f => '  - ' + f).join('\n')}` : '知识库暂无文件'
  } catch { return '知识库暂无文件' }
}

function kb_create_file(args) {
  try {
    fs.mkdirSync(K(''), { recursive: true })
    const name = (args.name || 'untitled').replace(/\.md$/, '') + '.md'
    fs.writeFileSync(K(name), args.content || '', 'utf-8')
    return `KB文件创建成功: ${name}`
  } catch (e) { return `[错误: ${e.message}]` }
}

function list_notes() {
  try {
    fs.mkdirSync(N(''), { recursive: true })
    const files = fs.readdirSync(N('')).filter(f => f.endsWith('.md'))
    return files.length > 0 ? `共 ${files.length} 条笔记:\n${files.join('\n')}` : '暂无笔记'
  } catch { return '暂无笔记' }
}

function write_note(args) {
  try {
    fs.mkdirSync(N(''), { recursive: true })
    fs.writeFileSync(N((args.name || 'note') + '.md'), args.content || '', 'utf-8')
    return `笔记创建成功: ${args.name}`
  } catch (e) { return `[错误: ${e.message}]` }
}

function read_note(args) {
  try { return fs.readFileSync(N((args.name || 'x') + '.md'), 'utf-8').slice(0, 500) } catch { return '[笔记不存在]' }
}

function delete_note(args) {
  try { fs.unlinkSync(N((args.name || 'x') + '.md')); return '笔记删除成功' } catch { return '[错误]' }
}

function create_project(args) {
  try {
    const d = P(args.name || 'new-project')
    ;['characters', 'chapters', 'outline', 'detailed_outline', 'summaries'].forEach(s =>
      fs.mkdirSync(path.join(d, s), { recursive: true }))
    return `项目 "${args.name}" 创建成功`
  } catch (e) { return `[错误: ${e.message}]` }
}

function delete_project(args) {
  try { fs.rmSync(P(args.name || ''), { recursive: true, force: true }); return `项目 "${args.name}" 删除成功` } catch (e) { return `[错误: ${e.message}]` }
}

function list_prompts() { return '灵感/世界观/角色/大纲/细纲/章节/润色/续写/改写/摘要/审稿' }
function list_rules() { return '暂无自定义规则' }
function learn_rule() { return '规则已学习' }
function list_audit() { return '暂无审计记录' }
function write_learning() { return '经验已记录' }

const allTools = {
  list_directory, read_file, search_content, create_file, edit_file, delete_file,
  kb_list, kb_create_file,
  list_notes, write_note, read_note, delete_note,
  create_project, delete_project,
  list_prompts, list_rules, learn_rule, list_audit, write_learning,
}

// ══════════════════════════════════════════════════════════════
//  工具 Schema — OpenAI 格式
// ══════════════════════════════════════════════════════════════

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: '列出项目目录下的文件和子目录。用于探索/查看目录结构。路径相对于项目根目录 projects/。',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: '要列出的目录路径，例如 1/characters 或 1/chapters' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: '读取项目中的文件内容。已知文件路径时直接使用，不需要先列目录。支持文本文件和JSON文件。',
      parameters: {
        type: 'object',
        properties: { file_path: { type: 'string', description: '文件相对路径，例如 1/characters/林语晴.yaml' } },
        required: ['file_path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_content',
      description: '在项目文件中搜索文本内容。支持关键词和正则表达式。',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: '搜索关键词或正则表达式' },
          path: { type: 'string', description: '搜索范围路径(可选，默认搜索整个项目)' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_file',
      description: '在项目中创建新文件。JSON文件会自动校验格式。',
      parameters: {
        type: 'object',
        properties: { file_path: { type: 'string' }, content: { type: 'string' } },
        required: ['file_path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: '编辑修改已有文件。使用 old_string/new_string 精确替换。old_string="__FULL_REPLACE__" 表示全量替换。',
      parameters: {
        type: 'object',
        properties: { file_path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' } },
        required: ['file_path', 'old_string', 'new_string'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: '删除项目中的文件。不可恢复，慎用。',
      parameters: {
        type: 'object',
        properties: { file_path: { type: 'string' } },
        required: ['file_path'],
      },
    },
  },
  {
    type: 'function',
    function: { name: 'kb_list', description: '列出知识库中的所有文件', parameters: { type: 'object', properties: {} } },
  },
  {
    type: 'function',
    function: {
      name: 'kb_create_file',
      description: '在知识库中创建新文件',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string' }, content: { type: 'string' } },
        required: ['name', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: { name: 'list_notes', description: '列出所有笔记', parameters: { type: 'object', properties: {} } },
  },
  {
    type: 'function',
    function: {
      name: 'write_note',
      description: '创建新笔记',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string' }, content: { type: 'string' } },
        required: ['name', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_note',
      description: '读取指定笔记内容',
      parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_note',
      description: '删除指定笔记',
      parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_project',
      description: '创建新项目',
      parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_project',
      description: '删除指定项目',
      parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    },
  },
  {
    type: 'function',
    function: { name: 'list_prompts', description: '列出所有可用的提示词模板', parameters: { type: 'object', properties: {} } },
  },
  {
    type: 'function',
    function: { name: 'list_rules', description: '列出所有已学习的规则', parameters: { type: 'object', properties: {} } },
  },
  {
    type: 'function',
    function: {
      name: 'learn_rule',
      description: '学习并记录一条新规则',
      parameters: { type: 'object', properties: { rule: { type: 'string' } }, required: ['rule'] },
    },
  },
  {
    type: 'function',
    function: { name: 'list_audit', description: '查看操作审计记录', parameters: { type: 'object', properties: {} } },
  },
  {
    type: 'function',
    function: {
      name: 'write_learning',
      description: '记录学习经验',
      parameters: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
    },
  },
]

// ══════════════════════════════════════════════════════════════
//  系统提示词 — 中文，与真实Agent一致
// ══════════════════════════════════════════════════════════════

const SYS = [
  '你是青剑AI写作助手。',

  '# 铁律 — 优先级最高',
  '- 操作文件必须调用实际的 function call，口头描述不等于操作完成',
  '- 禁止在文本中用 XML/JSON 文本块来模拟工具调用',
  '- 调用工具后如果失败，诚实告知原因，不假装成功',

  '# 什么时候用工具',
  '以下操作必须调用对应的 function：',
  '- 读/看/查看文件 → read_file（已知路径直接用，不列目录）',
  '- 列出/看目录 → list_directory',
  '- 搜索/找内容 → search_content',
  '- 编辑/修改 → edit_file（先 read_file 确认内容再改）',
  '- 创建/新建 → create_file（先 read_file 参考格式）',
  '- 删除 → delete_file',
  '- KB → kb_list / kb_create_file',
  '- 笔记 → list_notes / write_note / read_note / delete_note',
  '- 项目 → create_project / delete_project',

  '# 什么时候不用工具（直接文本回复）',
  '以下情况绝对不要调用任何工具：',
  '- 问候/闲聊："你好""嗨""谢谢""再见"',
  '- 自我介绍/偏好："我叫XX""我是XX""我喜欢XX"',
  '- 简单询问："什么是XX""为什么XX""怎么XX"',
  '- 建议/咨询："推荐一下""有什么建议""怎么办"',
  '- 评价/反馈："你觉得XX怎么样"',
  '- 模糊请求（没有明确文件路径或操作）→ 先问清楚再操作',

  '# 文件路径速查',
  '角色文件: 1/characters/{中文名}.yaml  章节: 1/chapters/chapter{N}.txt',
  '细纲: 1/detailed_outline/chapter{N}.yaml  大纲: 1/outline/plot.md',

  '# 执行规则',
  '- 已知文件路径直接 read_file，不要先 list_directory',
  '- 修改前 read_file，创建前 read_file 参考格式',
  '- 读取后只输出关键信息摘要，不输出全文',
  '- 只做用户要求的操作，不多做不少做',
  '- 多个独立的操作可以在同一轮并行调用工具',
  '- 有依赖的操作（如先读再写）分轮执行',
  '- 回复简洁，中文优先',
].join('\n')

// ══════════════════════════════════════════════════════════════
//  API 调用 — OpenAI 协议
// ══════════════════════════════════════════════════════════════

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
    throw new Error(`HTTP ${res.status}: ${errText.slice(0, 300)}`)
  }
  const json = await res.json()
  const choice = json.choices?.[0] || {}
  return {
    text: choice.message?.content || '',
    toolCalls: choice.message?.tool_calls || [],
    finishReason: choice.finish_reason || 'stop',
    usage: json.usage,
  }
}

// ══════════════════════════════════════════════════════════════
//  Agent 循环 — 支持携带历史消息（多轮对话）
// ══════════════════════════════════════════════════════════════

/**
 * 执行一次 Agent 循环。支持携带历史消息。
 *
 * @param {string} userMsg - 当前轮用户消息
 * @param {Array} history - 可选，之前轮次积累的完整消息历史
 * @returns {{text,iterations,toolCalls,steps,messages}} - 返回结果和更新后的消息列表
 */
async function agentRun(userMsg, history = []) {
  const messages = [
    { role: 'system', content: SYS },
    ...history,
    { role: 'user', content: userMsg },
  ]
  let iterations = 0
  let totalTools = 0
  let fullText = ''
  const steps = []

  while (iterations < MAX_ITERATIONS) {
    iterations++
    process.stdout.write(`  [iter${iterations}] `)

    const r = await callOpenAI(messages)
    if (r.text) fullText = r.text

    // 没有工具调用 → 结束
    if (!r.toolCalls.length) {
      if (r.text) process.stdout.write('→ 文本回复')
      process.stdout.write('\n')
      // 更新 history（不包含 system）
      return {
        text: fullText,
        iterations,
        toolCalls: totalTools,
        steps,
        messages: messages.slice(1), // 去掉 system，返回可复用的历史
      }
    }

    // 构建 assistant 消息（OpenAI 格式）
    const asstMsg = {
      role: 'assistant',
      content: r.text || null,
      tool_calls: r.toolCalls,
    }
    messages.push(asstMsg)

    // 逐个执行工具
    for (const tc of r.toolCalls) {
      const fn = tc.function
      const toolFn = allTools[fn.name]
      let args = {}
      try { args = JSON.parse(fn.arguments || '{}') } catch { /* keep empty args */ }

      const result = toolFn
        ? await toolFn(args)
        : `[未知工具: ${fn.name}]`

      const isError = typeof result === 'string' &&
        (result.startsWith('[错误') || result.startsWith('[未知'))

      totalTools++
      process.stdout.write(`${fn.name}${isError ? '✗' : '✓'} `)
      steps.push({ tool: fn.name, isError, args: JSON.stringify(args).slice(0, 100) })

      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: result,
      })
    }
    process.stdout.write('\n')
  }

  // 超过最大迭代次数
  return {
    text: fullText,
    iterations,
    toolCalls: totalTools,
    steps,
    messages: messages.slice(1),
    timedOut: true,
  }
}

// ══════════════════════════════════════════════════════════════
//  多轮对话辅助 — 连续多轮用户输入，共享上下文
// ══════════════════════════════════════════════════════════════

/**
 * 执行多轮对话。每一轮的上下文都会累积传递给下一轮。
 *
 * @param {Array<{label: string, prompt: string}>} turns - 每轮的用户消息
 * @returns 最后一轮的结果
 */
async function multiTurnRun(turns) {
  let history = []
  let lastResult = null
  let totalTools = 0
  let totalIterations = 0

  for (const turn of turns) {
    process.stdout.write(`  [轮] "${turn.label || turn.prompt.slice(0, 40)}..."`)
    const r = await agentRun(turn.prompt, history)
    history = r.messages // 累计历史
    totalTools += r.toolCalls
    totalIterations += r.iterations
    lastResult = { ...r, toolCalls: totalTools, iterations: totalIterations, history }
  }

  return lastResult
}

// ══════════════════════════════════════════════════════════════
//  测试框架
// ══════════════════════════════════════════════════════════════

let pass = 0
let fail = 0

function t(name, cond, detail) {
  if (cond) {
    pass++
    console.log(`  ✅ ${name}${detail ? ': ' + detail : ''}`)
  } else {
    fail++
    console.log(`  ❌ ${name}${detail ? ': ' + detail : ''}`)
  }
}

// ══════════════════════════════════════════════════════════════
//  主测试入口
// ══════════════════════════════════════════════════════════════

console.log('═══════════════════════════════════════════════')
console.log('  仿真测试: 文件浏览 (list_directory + read_file)')
console.log(`  API: ${API_URL}`)
console.log(`  模型: ${MODEL}`)
console.log(`  项目根: ${APP_ROOT}`)
console.log('═══════════════════════════════════════════════')

async function main() {
  // ─────────────────────────────────────────────────────
  //  S1: 闲聊防误调 — 纯文本对话，不应触发任何工具
  // ─────────────────────────────────────────────────────
  console.log('\n▶ S1 闲聊防误调（0工具期望）')
  const r1a = await agentRun('嗨你好呀，请问你是做什么的？能帮我干嘛？')
  const r1b = await agentRun('我叫小明，是个刚开始写小说的新手')
  const r1c = await agentRun('那帮我看看吧') // 模糊请求，也应不调工具
  t('S1-1 问候无害调用工具', r1a.toolCalls === 0, `工具:${r1a.toolCalls} 轮:${r1a.iterations}`)
  t('S1-2 自我介绍不调工具', r1b.toolCalls === 0, `工具:${r1b.toolCalls} 轮:${r1b.iterations}`)
  t('S1-3 模糊请求不调工具', r1c.toolCalls === 0, `工具:${r1c.toolCalls} 轮:${r1c.iterations}`)

  // ─────────────────────────────────────────────────────
  //  S2: 基本列目录 — 列出项目1的characters目录
  // ─────────────────────────────────────────────────────
  console.log('\n▶ S2 基本列目录（list_directory）')
  const r2 = await agentRun('帮我看看项目1的characters目录里都有哪些角色文件呀？')
  t('S2 列出characters目录', r2.toolCalls >= 1 && r2.steps.some(s => s.tool === 'list_directory'),
    `${r2.iterations}轮 ${r2.toolCalls}工具 ${r2.steps.map(s => s.tool).join(',')}`)
  t('S2 未调用read_file', r2.steps.every(s => s.tool !== 'read_file'),
    '列目录时不读文件')

  // ─────────────────────────────────────────────────────
  //  S3: 直接读文件 — 已知路径直接读取
  // ─────────────────────────────────────────────────────
  console.log('\n▶ S3 直接读文件（read_file）')
  const r3 = await agentRun('读一下 1/characters/林语晴.yaml，帮我看看这个角色')
  t('S3 读取林语晴角色', r3.toolCalls >= 1 && r3.steps.some(s => s.tool === 'read_file'),
    `${r3.iterations}轮 ${r3.toolCalls}工具`)
  t('S3 未先列目录', r3.steps.every(s => s.tool !== 'list_directory'),
    '已知路径直接读文件')

  // ─────────────────────────────────────────────────────
  //  S4: 文件不存在→重试 — 错误恢复能力（多轮对话）
  // ─────────────────────────────────────────────────────
  console.log('\n▶ S4 文件不存在→纠错重试（多轮对话）')
  const r4 = await multiTurnRun([
    { label: '询问不存在角色', prompt: '读一下 1/characters/王大锤.yaml，我想看看这个角色' },
    { label: '纠错后重试', prompt: '啊不对不对，记错名字了，应该是林语晴。帮我读 1/characters/林语晴.yaml' },
  ])
  t('S4 至少2次工具调用', r4.toolCalls >= 2,
    `${r4.iterations}轮 ${r4.toolCalls}工具`)
  t('S4 第一次是read_file', r4.steps && r4.steps.length >= 1 && r4.steps[0]?.tool === 'read_file',
    '即使路径错误也尝试读取')

  // ─────────────────────────────────────────────────────
  //  S5: 列目录+读文件组合 — 先探索再深入看
  // ─────────────────────────────────────────────────────
  console.log('\n▶ S5 列目录+读文件组合（list_directory → read_file）')
  const r5 = await agentRun(
    '先帮我看看项目1的outline目录里都有些什么文件，然后把大纲文件 plot.md 读出来看看',
  )
  t('S5 同时用到了list_directory和read_file',
    r5.steps.some(s => s.tool === 'list_directory') && r5.steps.some(s => s.tool === 'read_file'),
    `${r5.iterations}轮 ${r5.toolCalls}工具 ${r5.steps.map(s => s.tool).join(',')}`)
  t('S5 至少2个工具调用', r5.toolCalls >= 2, `共${r5.toolCalls}个工具调用`)

  // ─────────────────────────────────────────────────────
  //  S6: 连续多轮操作 — 用户自然跟进
  // ─────────────────────────────────────────────────────
  console.log('\n▶ S6 连续多轮跟进操作（用户自然对话）')
  const r6 = await multiTurnRun([
    { label: '列出characters', prompt: '列一下项目1的characters目录吧，看看都有谁' },
    { label: '读第一个', prompt: '好的，读第一个角色文件看看' },
    { label: '再看看张明', prompt: '哦，再读一下张明.json呗，要看 1/characters/张明.yaml' },
  ])
  t('S6 3轮对话至少3个工具调用', r6.toolCalls >= 3,
    `${r6.iterations}轮 ${r6.toolCalls}工具 ${r6.steps?.map(s => s.tool).join(',') || ''}`)

  // ─────────────────────────────────────────────────────
  //  S7: 读大文件 — 长篇章节文件（chapter1.txt ~20KB）
  // ─────────────────────────────────────────────────────
  console.log('\n▶ S7 读大文件（长章节）')
  const r7 = await agentRun('读取 1/chapters/chapter1.txt，看看内容')
  t('S7 成功读取章节文件', r7.toolCalls >= 1 && r7.steps.some(s => s.tool === 'read_file'),
    `${r7.iterations}轮 ${r7.toolCalls}工具`)
  t('S7 读大文件无超时', !r7.timedOut, `完成于${r7.iterations}轮`)

  // ─────────────────────────────────────────────────────
  //  S8: 读文件+检查JSON格式 — 验证JSON合法性
  // ─────────────────────────────────────────────────────
  console.log('\n▶ S8 读JSON文件+格式检查')
  const r8 = await agentRun('读取 1/characters/唐果果.yaml，帮我看下这个JSON格式正不正确')
  t('S8 读取JSON文件', r8.toolCalls >= 1 && r8.steps.some(s => s.tool === 'read_file'),
    `${r8.iterations}轮 ${r8.toolCalls}工具`)

  // ─────────────────────────────────────────────────────
  //  S9: 列chapters目录（混合类型内容）
  // ─────────────────────────────────────────────────────
  console.log('\n▶ S9 列混合内容目录（chapters）')
  const r9 = await agentRun('列出 1/chapters 目录看看都有哪些章节写完le')
  t('S9 列chapters目录', r9.toolCalls >= 1 && r9.steps.some(s => s.tool === 'list_directory'),
    `${r9.iterations}轮 ${r9.toolCalls}工具`)

  // ─────────────────────────────────────────────────────
  //  S10: 回退纠正 — 列错目录后重试
  // ─────────────────────────────────────────────────────
  console.log('\n▶ S10 列错目录→回退纠正')
  const r10 = await multiTurnRun([
    { label: '列出错误目录', prompt: '帮我列出 1/roles 目录' },
    { label: '纠正为characters', prompt: '哦 说错了 应该是 1/characters 目录才对' },
  ])
  t('S10 两次list_directory', r10.toolCalls >= 2,
    `${r10.iterations}轮 ${r10.toolCalls}工具`)

  // ─────────────────────────────────────────────────────
  //  汇总
  // ─────────────────────────────────────────────────────
  const total = pass + fail
  console.log('\n\n═══════════════════════════════════════════════')
  console.log('  仿真测试结果: 文件浏览')
  console.log('═══════════════════════════════════════════════')
  console.log(`  通过: ${pass} / ${total}`)
  console.log(`  失败: ${fail}`)
  console.log(`  通过率: ${total > 0 ? ((pass / total) * 100).toFixed(1) : '0'}%`)
  console.log('═══════════════════════════════════════════════')
}

main().catch(e => {
  console.error('\n💥 测试异常:', e.message)
  console.error(e.stack)
  process.exit(1)
})
