#!/usr/bin/env node
/**
 * 仿真测试: 角色管理 (04-character)
 * 模拟用户创建和管理角色的完整工作流。
 *
 * 场景覆盖:
 *   S1 — 创建女主(16字段完整JSON, list→read→create→验证)
 *   S2 — 最少信息创建(默认值填充, 用户确认)
 *   S3 — 读取已有角色卡
 *   S4 — 创建反派角色
 *   S5 — 批量创建3个配角
 *   S6 — 非法角色类型自动标准化
 *
 * 复杂度: complex — 6个场景, ~12-18个工具调用
 * 工具覆盖: list_directory, read_file, create_file, search_content
 *
 * 运行: node scripts/full-sim/04-character.mjs
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

// ═══════════════════════════════════════════════════
//  配置常量
// ═══════════════════════════════════════════════════
const API_KEY = process.env.AI_API_KEY || 'sk-c9c30831df7243209435c60e811c879d'
const API_URL = 'https://api.deepseek.com/v1/chat/completions'
const MODEL = 'deepseek-v4-flash'
const MAX_ITERATIONS = 15
const ROOT = process.cwd()

// ── 路径辅助函数 ──
const P = p => path.join(ROOT, 'projects', p)
const N = p => path.join(ROOT, 'notes', p)
const K = p => path.join(ROOT, 'knowledge_base/files', p)

// ── 角色JSON必需的16个字段 ──
const CHARACTER_16_FIELDS = [
  'id', 'name', 'role', 'gender', 'age', 'occupation',
  'background', 'appearance', 'personality', 'abilities',
  'weaknesses', 'relationships', 'relationshipTags', 'arc',
  'importance', 'motivations',
]

// ── 合法角色类型 ──
const VALID_ROLES = ['男主', '女主', '男配', '女配', '反派', '其他']

// ═══════════════════════════════════════════════════
//  工具实现 (真实文件系统操作)
// ═══════════════════════════════════════════════════
const tools = {
  read_file: a => {
    try {
      const fp = a.file_path || a.path || ''
      const fullPath = P(fp)
      const c = fs.readFileSync(fullPath, 'utf-8')
      return c.length > 3000 ? c.slice(0, 3000) + '\n…(' + c.length + '字)' : c
    } catch (e) {
      const fp = a.file_path || a.path || ''
      return `[错误: 文件不存在或无法读取: ${fp}]`
    }
  },

  list_directory: a => {
    try {
      const dir = a.path || a.dir_path || '.'
      const fullDir = P(dir)
      const entries = fs.readdirSync(fullDir, { withFileTypes: true })
      if (entries.length === 0) return '(空目录)'
      return entries
        .map(x => (x.isDirectory() ? 'DIR  ' : 'FILE ') + x.name)
        .join('\n')
    } catch (e) {
      const dir = a.path || a.dir_path || '.'
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
          if (e.isDirectory()) {
            searchDir(f)
            continue
          }
          try {
            const c = fs.readFileSync(f, 'utf-8')
            const ls = c.split('\n')
            for (let i = 0; i < ls.length; i++) {
              if (re.test(ls[i])) {
                results.push(
                  f.replace(ROOT + '/projects/', '') +
                    ':' + (i + 1) + ':' + ls[i].slice(0, 200)
                )
              }
            }
          } catch { /* skip unreadable files */ }
        }
      }

      if (fs.statSync(fp).isFile()) {
        const c = fs.readFileSync(fp, 'utf-8')
        const ls = c.split('\n')
        for (let i = 0; i < ls.length; i++) {
          if (re.test(ls[i])) {
            results.push((a.path || '') + ':' + (i + 1) + ':' + ls[i].slice(0, 200))
          }
        }
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
      const fp = a.file_path || a.path || ''
      const fullPath = P(fp)
      const c = a.content || ''

      // JSON 文件自动校验格式
      if (fp.endsWith('.json') && c) {
        try {
          JSON.parse(c)
        } catch (e) {
          return `[JSON格式错误: ${e.message}]`
        }
      }

      fs.mkdirSync(path.dirname(fullPath), { recursive: true })
      fs.writeFileSync(fullPath, c, 'utf-8')
      return `创建成功: ${fp}`
    } catch (e) {
      return `[错误: ${e.message}]`
    }
  },

  edit_file: a => {
    try {
      const fp = a.file_path || a.path || ''
      const fullPath = P(fp)
      let c = fs.readFileSync(fullPath, 'utf-8')
      const old = a.old_string || ''
      const nw = a.new_string || ''

      if (old === '__FULL_REPLACE__') {
        fs.writeFileSync(fullPath, nw, 'utf-8')
        return '全量替换成功'
      }

      let idx = c.indexOf(old)
      if (idx < 0) idx = c.indexOf(old.trim())
      if (idx < 0) return `[未找到匹配文本: "${old.slice(0, 80)}"]`

      fs.writeFileSync(fullPath, c.slice(0, idx) + nw + c.slice(idx + old.length), 'utf-8')
      return '编辑成功'
    } catch (e) {
      return `[错误: ${e.message}]`
    }
  },

  delete_file: a => {
    try {
      fs.unlinkSync(P(a.file_path || a.path || ''))
      return '删除成功'
    } catch (e) {
      return `[错误: ${e.message}]`
    }
  },

  // ── 其余 Harness 工具 (简化实现) ──
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
      description: '读取项目文件内容。已知路径直接读。',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '文件相对路径，如 1/characters/林雨晴.yaml' },
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
      description: '在项目文件中搜索文本内容',
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
          content: { type: 'string', description: '文件内容(JSON需为字符串)' },
        },
        required: ['file_path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: '编辑现有文件。先read_file确认原文。old_string=__FULL_REPLACE__表示全量替换。',
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
      description: '删除项目文件',
      parameters: {
        type: 'object',
        properties: { file_path: { type: 'string' } },
        required: ['file_path'],
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
      description: '创建知识库文件',
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
//  系统提示词 (与真实 Harness 一致)
// ═══════════════════════════════════════════════════
const SYS = [
  '你是青剑AI写作助手，帮助用户进行小说创作。',
  '',
  '# 铁律：何时用工具，何时不用',
  '✅ 调工具（用户要求操作文件）: 读取/列出/搜索/创建/编辑/删除/写/保存/修改/改/看(文件)/找(文件)/查看/确认',
  '❌ 不调工具（纯对话）: 问候/闲聊/我是/我叫/我喜欢/我觉得/谢谢/什么是/为什么/怎么/推荐',
  '',
  '# 执行规则',
  '- 已知文件路径直接读文件，不需要先列目录。创建角色前先参考已有角色格式。',
  '- 修改文件前必须先读取原文件内容（read_file），再edit_file或create_file覆盖。',
  '- 创建JSON文件时会自动校验格式。',
  '- 只做用户要求的操作，不多做也不少做。',
  '- 多个独立操作可在同一轮并行完成。有依赖的操作分轮执行。',
  '- 回复简洁，300字以内。',
  '',
  '# 路径速查',
  '角色: {项目}/characters/{中文名}.yaml  例: 1/characters/林雨晴.yaml',
  '章节: {项目}/chapters/chapter{N}.txt   例: 1/chapters/chapter3.txt',
  '细纲: {项目}/detailed_outline/chapter{N}.yaml',
  '大纲: {项目}/outline/plot.md',
  '',
  '# 角色JSON标准字段（16个必填）',
  '1.id  2.name  3.role  4.gender  5.age  6.occupation',
  '7.background  8.appearance  9.personality  10.abilities',
  '11.weaknesses  12.relationships  13.relationshipTags  14.arc',
  '15.importance  16.motivations',
  '',
  '# 角色字段规范',
  '- role 字段必须是以下之一: 男主, 女主, 男配, 女配, 反派, 其他',
  '  * 如果用户说"男主角"请自动标准化为"男主"',
  '  * 如果用户说"女主角"请自动标准化为"女主"',
  '- abilities 字段必须是**字符串**（如"御剑术、太虚阵法"），不能是对象',
  '- relationshipTags 字段必须是**数组**（如["恋人","战友"]）',
  '- importance 字段必须是**数字**（1-100）',
  '- age 字段必须是**字符串或数字**',
  '- 用户未明确提供的字段，用合理默认值填充，不要留空字符串',
  '- 创建完成后告知用户已创建的字段概要，请用户确认',
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
    process.stdout.write(`  [iter${iterations}] `)

    const r = await callOpenAI(messages)
    if (r.text) fullText = r.text

    if (!r.toolCalls.length) {
      process.stdout.write(`文本回复(${r.text.length}字)\n`)
      return { text: fullText, iterations, toolCalls: totalTools, toolLog }
    }

    // 构建 assistant 消息
    const asstMsg = {
      role: 'assistant',
      content: r.text || null,
      tool_calls: r.toolCalls,
    }
    messages.push(asstMsg)

    // 执行每个工具调用
    for (const tc of r.toolCalls) {
      const fn = tc.function
      const toolFn = tools[fn.name]
      let args = {}
      try {
        args = JSON.parse(fn.arguments)
      } catch {
        /* ignore parse errors */
      }

      const result = toolFn ? await toolFn(args) : '[未知工具]'
      const ok = typeof result === 'string' && !result.startsWith('[')
      const icon = ok ? '✓' : '✗'
      totalTools++

      process.stdout.write(`${fn.name}${icon} `)
      toolLog.push({
        name: fn.name,
        ok,
        args,
        result: typeof result === 'string' ? result.slice(0, 120) : String(result).slice(0, 120),
      })

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
  console.log('\n' + '─'.repeat(60))
  console.log('  ' + title)
  console.log('─'.repeat(60))
}

// ═══════════════════════════════════════════════════
//  角色JSON验证工具
// ═══════════════════════════════════════════════════

/**
 * 检查角色JSON是否包含全部16个字段，以及各项规范性检查。
 * 返回 { valid, missing, extra, warnings, obj }
 */
function checkCharacterFields(content) {
  const warnings = []
  try {
    const obj = JSON.parse(content)
    const missing = CHARACTER_16_FIELDS.filter(f => !(f in obj))
    const extra = Object.keys(obj).filter(k => !CHARACTER_16_FIELDS.includes(k))

    // 检查 abilities 是否为字符串
    if ('abilities' in obj && typeof obj.abilities !== 'string') {
      warnings.push('abilities字段不是字符串，是' + typeof obj.abilities)
    }

    // 检查 role 是否为合法值
    if ('role' in obj && !VALID_ROLES.includes(obj.role)) {
      warnings.push('role字段值"' + obj.role + '"不在合法范围: ' + VALID_ROLES.join('|'))
    }

    // 检查 relationshipTags 是否为数组
    if ('relationshipTags' in obj && !Array.isArray(obj.relationshipTags)) {
      warnings.push('relationshipTags字段不是数组')
    }

    // 检查 importance 是否为数字
    if ('importance' in obj && typeof obj.importance !== 'number') {
      warnings.push('importance字段不是数字，是' + typeof obj.importance)
    }

    // 检查是否有空值字段（除了合理留空的字段）
    const emptyFields = []
    for (const f of CHARACTER_16_FIELDS) {
      if (f in obj) {
        const v = obj[f]
        if (v === '' || v === null || v === undefined) {
          emptyFields.push(f)
        }
      }
    }
    if (emptyFields.length > 0) {
      warnings.push('以下字段值为空: ' + emptyFields.join(', '))
    }

    return {
      valid: missing.length === 0,
      missing,
      extra,
      warnings,
      obj,
    }
  } catch (e) {
    return { valid: false, missing: [], extra: [], warnings: [e.message], error: e.message }
  }
}

/**
 * 从磁盘读取并验证角色文件
 */
function verifyCharacterFile(filePath) {
  const fullPath = P(filePath)
  try {
    const content = fs.readFileSync(fullPath, 'utf-8')
    return { exists: true, ...checkCharacterFields(content), content }
  } catch (e) {
    return { exists: false, error: e.message }
  }
}

/**
 * 列出目录中的所有文件
 */
function listDirFiles(dirPath) {
  try {
    return fs.readdirSync(P(dirPath), { withFileTypes: true })
      .filter(e => e.isFile())
      .map(e => e.name)
  } catch {
    return []
  }
}

// ═══════════════════════════════════════════════════
//  测试环境初始化
// ═══════════════════════════════════════════════════
function setupTestEnvironment() {
  // 确保项目目录存在
  const charDir = P('1/characters')
  fs.mkdirSync(charDir, { recursive: true })

  // 创建参考角色 (让AI有模板可参考)
  const refChar = {
    id: 'lin_yu_qing',
    name: '林语晴',
    role: '女主',
    gender: '女',
    age: '20',
    occupation: '修仙者/医修',
    background: '天剑宗掌门之女，自幼天资聪颖，五岁开始修炼。母亲早逝，由父亲一手带大。因门派变故流落凡间，与云澈相识相知。',
    appearance: '身姿修长，肤白如雪，一头墨黑长发及腰。眼眸清澈如星辰，嘴角常带温柔笑意。常穿淡青色长裙，气质出尘脱俗。',
    personality: '外表温柔坚强，内心敏感细腻。善良但不软弱，有主见且有担当。对朋友忠诚，对敌人果断。偶尔会因过度责任心而给自己太大压力。',
    abilities: '天剑诀、青木回春术、灵识探查、御风术、医术精通',
    weaknesses: '修为根基因早年受伤而不稳，过度使用灵力会反噬。心软，容易被利用。对亲近之人过于保护。',
    relationships: '与云澈是恋人兼战友关系，共同经历生死。与父亲林掌门关系复杂，既尊敬又有隔阂。与师妹苏婉儿情同姐妹。',
    relationshipTags: ['恋人', '战友', '同门'],
    arc: '从依赖他人的医修少女成长为独当一面的天剑宗掌门。需要克服对自身能力的不自信，学会在保护他人与信任他人之间找到平衡。',
    importance: 95,
    motivations: '守护天剑宗，查明母亲去世的真相，与云澈共建和平的修仙世界',
  }

  const refPath = P('1/characters/林语晴.yaml')
  fs.writeFileSync(refPath, JSON.stringify(refChar, null, 2), 'utf-8')
  console.log('  📁 测试环境已初始化: 创建参考角色 林语晴.json')
}

// ═══════════════════════════════════════════════════
//  清理函数
// ═══════════════════════════════════════════════════
function cleanupTestFiles(filePaths) {
  for (const fp of filePaths) {
    try {
      const fullPath = P(fp)
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath)
        console.log('  🧹 已清理: ' + fp)
      }
    } catch {
      /* ignore */
    }
  }
}

// ═══════════════════════════════════════════════════
//  主测试流程
// ═══════════════════════════════════════════════════
async function main() {
  console.log('═══════════════════════════════════════════════')
  console.log('  仿真测试: 角色管理 (04-character)')
  console.log('  端点: ' + API_URL + '  模型: ' + MODEL)
  console.log('  场景: S1-S6 角色创建/读取/批量/类型验证')
  console.log('═══════════════════════════════════════════════')

  // 初始化测试环境
  setupTestEnvironment()

  // 记录所有需要清理的文件
  const testFiles = ['1/characters/林语晴.yaml'] // 参考角色也会被清理

  // ═══════════════════════════════════════════════
  //  S1: 创建女主 — 完整16字段角色JSON
  // ═══════════════════════════════════════════════
  hr('S1 创建女主 — 林雨晴 (list→read参考→create→验证)')

  const s1Msg =
    '帮我创建一个新角色：女主，叫林雨晴，22岁，画家。' +
    '她温柔善良，出身艺术世家，与男主是青梅竹马。' +
    '先看看项目1里已有角色的格式，照着创建一份完整的角色JSON，' +
    '保存到 1/characters/林雨晴.yaml'

  console.log('  用户: ' + s1Msg.slice(0, 80) + '...')
  const s1 = await agentRun(s1Msg)

  t('S1 有工具调用', s1.toolCalls >= 1, s1.toolCalls + '个工具 ' + s1.iterations + '轮')
  t('S1 使用了list_directory', s1.toolLog.some(l => l.name === 'list_directory'))
  t('S1 使用了read_file', s1.toolLog.some(l => l.name === 'read_file'))
  t('S1 使用了create_file', s1.toolLog.some(l => l.name === 'create_file' && l.ok))
  t('S1 AI有文本回复', s1.text.length > 0, s1.text.length + '字')

  // 验证磁盘上的文件
  testFiles.push('1/characters/林雨晴.yaml')
  const s1Verify = verifyCharacterFile('1/characters/林雨晴.yaml')
  t('S1 文件创建成功', s1Verify.exists)
  if (s1Verify.exists) {
    t('S1 16字段完整', s1Verify.valid,
      s1Verify.valid ? '全部16字段' : '缺少: ' + (s1Verify.missing || []).join(', '))
    t('S1 abilities是字符串',
      s1Verify.obj && typeof s1Verify.obj.abilities === 'string',
      s1Verify.obj ? typeof s1Verify.obj.abilities : 'N/A')
    t('S1 role合法',
      s1Verify.obj && VALID_ROLES.includes(s1Verify.obj.role),
      s1Verify.obj ? s1Verify.obj.role : 'N/A')
    t('S1 relationshipTags是数组',
      s1Verify.obj && Array.isArray(s1Verify.obj.relationshipTags),
      s1Verify.obj ? JSON.stringify(s1Verify.obj.relationshipTags) : 'N/A')
    t('S1 importance是数字',
      s1Verify.obj && typeof s1Verify.obj.importance === 'number',
      s1Verify.obj ? String(s1Verify.obj.importance) : 'N/A')
    t('S1 无规范警告', s1Verify.warnings.length === 0,
      s1Verify.warnings.length > 0 ? s1Verify.warnings.join('; ') : '通过')

    if (s1Verify.obj) {
      console.log('    角色摘要: ' + s1Verify.obj.name + ' | ' + s1Verify.obj.role +
        ' | ' + s1Verify.obj.gender + ' | age=' + s1Verify.obj.age +
        ' | importance=' + s1Verify.obj.importance)
    }
  }

  // ═══════════════════════════════════════════════
  //  S2: 最少信息创建 — 默认值填充
  // ═══════════════════════════════════════════════
  hr('S2 最少信息创建 — 张伟 (默认值填充, 用户确认)')

  const s2Msg =
    '创建角色张伟，男主。就是基本信息，其他你帮我补齐。' +
    '保存到 1/characters/张伟.yaml'

  console.log('  用户: ' + s2Msg)
  const s2 = await agentRun(s2Msg)

  t('S2 有工具调用', s2.toolCalls >= 1, s2.toolCalls + '个工具 ' + s2.iterations + '轮')
  t('S2 使用了create_file', s2.toolLog.some(l => l.name === 'create_file' && l.ok))
  t('S2 AI回复含确认信息', s2.text.length > 0, s2.text.length + '字')
  // AI应该提醒用户核对/补充信息
  t('S2 AI提示核对', /核对|确认|检查|补充|修改|完善|需要.*补充/.test(s2.text),
    s2.text.slice(0, 80))

  // 验证磁盘文件
  testFiles.push('1/characters/张伟.yaml')
  const s2Verify = verifyCharacterFile('1/characters/张伟.yaml')
  t('S2 文件创建成功', s2Verify.exists)
  if (s2Verify.exists) {
    t('S2 16字段完整(含默认值)', s2Verify.valid,
      s2Verify.valid ? '全部16字段' : '缺少: ' + (s2Verify.missing || []).join(', '))
    t('S2 role="男主"', s2Verify.obj && s2Verify.obj.role === '男主',
      s2Verify.obj ? s2Verify.obj.role : 'N/A')
    t('S2 name="张伟"', s2Verify.obj && s2Verify.obj.name === '张伟',
      s2Verify.obj ? s2Verify.obj.name : 'N/A')
    t('S2 非空字段数≥5',
      s2Verify.obj && Object.values(s2Verify.obj).filter(v => v !== '' && v !== null && v !== undefined).length >= 5,
      s2Verify.obj ? Object.values(s2Verify.obj).filter(v => v !== '' && v !== null).length + '个非空字段' : 'N/A')

    if (s2Verify.obj) {
      console.log('    角色摘要: ' + s2Verify.obj.name + ' | ' + s2Verify.obj.role +
        ' | age=' + s2Verify.obj.age + ' | occupation=' + s2Verify.obj.occupation)
    }
  }

  // ═══════════════════════════════════════════════
  //  S3: 读取已有角色卡
  // ═══════════════════════════════════════════════
  hr('S3 读取角色卡 — 查看林雨晴')

  const s3Msg = '查看林雨晴的角色卡'

  console.log('  用户: ' + s3Msg)
  const s3 = await agentRun(s3Msg)

  t('S3 有工具调用', s3.toolCalls >= 1, s3.toolCalls + '个工具 ' + s3.iterations + '轮')
  t('S3 使用了read_file', s3.toolLog.some(l => l.name === 'read_file'))
  t('S3 AI文本回复含角色信息', s3.text.length > 10, s3.text.length + '字')
  // AI回复中应提及林雨晴的基本信息
  t('S3 AI回复提及林雨晴', /林雨晴|画家|女主/.test(s3.text),
    s3.text.slice(0, 100))

  console.log('    AI回复: ' + s3.text.slice(0, 120))

  // ═══════════════════════════════════════════════
  //  S4: 创建反派角色
  // ═══════════════════════════════════════════════
  hr('S4 创建反派 — 王振国')

  const s4Msg =
    '创建一个反派角色，叫王振国，45岁，修仙界执法者。' +
    '为人冷酷严厉，但背后有自己坚守的正义。' +
    '先看看项目1里已有的角色格式，再创建完整的角色JSON，' +
    '保存到 1/characters/王振国.yaml'

  console.log('  用户: ' + s4Msg.slice(0, 80) + '...')
  const s4 = await agentRun(s4Msg)

  t('S4 有工具调用', s4.toolCalls >= 1, s4.toolCalls + '个工具 ' + s4.iterations + '轮')
  t('S4 使用了read_file或list_directory',
    s4.toolLog.some(l => l.name === 'read_file' || l.name === 'list_directory'))
  t('S4 使用了create_file', s4.toolLog.some(l => l.name === 'create_file' && l.ok))

  // 验证磁盘文件
  testFiles.push('1/characters/王振国.yaml')
  const s4Verify = verifyCharacterFile('1/characters/王振国.yaml')
  t('S4 文件创建成功', s4Verify.exists)
  if (s4Verify.exists) {
    t('S4 16字段完整', s4Verify.valid,
      s4Verify.valid ? '全部16字段' : '缺少: ' + (s4Verify.missing || []).join(', '))
    t('S4 role="反派"', s4Verify.obj && s4Verify.obj.role === '反派',
      s4Verify.obj ? s4Verify.obj.role : 'N/A')
    t('S4 name="王振国"', s4Verify.obj && s4Verify.obj.name === '王振国',
      s4Verify.obj ? s4Verify.obj.name : 'N/A')
    t('S4 age=45',
      s4Verify.obj && String(s4Verify.obj.age) === '45',
      s4Verify.obj ? String(s4Verify.obj.age) : 'N/A')
    t('S4 abilities是字符串',
      s4Verify.obj && typeof s4Verify.obj.abilities === 'string',
      s4Verify.obj ? typeof s4Verify.obj.abilities : 'N/A')
    t('S4 无规范警告', s4Verify.warnings.length === 0,
      s4Verify.warnings.length > 0 ? s4Verify.warnings.join('; ') : '通过')

    if (s4Verify.obj) {
      console.log('    角色摘要: ' + s4Verify.obj.name + ' | ' + s4Verify.obj.role +
        ' | gender=' + s4Verify.obj.gender + ' | age=' + s4Verify.obj.age +
        ' | importance=' + s4Verify.obj.importance)
    }
  }

  // ═══════════════════════════════════════════════
  //  S5: 批量创建3个配角
  // ═══════════════════════════════════════════════
  hr('S5 批量创建 — 林雨晴的师父/闺蜜/竞争对手')

  // 记录批量创建前的文件列表
  const beforeFiles = listDirFiles('1/characters')
  console.log('  批量前已有文件: ' + beforeFiles.join(', '))

  const s5Msg =
    '再创建三个配角：林雨晴的师父、她的闺蜜、她的竞争对手。' +
    '师父是一位德高望重的老画家，闺蜜是林雨晴从小到大的好朋友，' +
    '竞争对手是另一位才华横溢的年轻画家。' +
    '每个角色都要完整的16字段JSON，放在项目1的characters目录下。'

  console.log('  用户: ' + s5Msg.slice(0, 80) + '...')
  const s5 = await agentRun(s5Msg)

  t('S5 有工具调用', s5.toolCalls >= 1, s5.toolCalls + '个工具 ' + s5.iterations + '轮')
  t('S5 至少3次create_file', s5.toolLog.filter(l => l.name === 'create_file' && l.ok).length >= 3,
    s5.toolLog.filter(l => l.name === 'create_file' && l.ok).length + '次成功创建')
  t('S5 AI文本回复', s5.text.length > 0, s5.text.length + '字')

  // 验证批量创建结果
  const afterFiles = listDirFiles('1/characters')
  const newFiles = afterFiles.filter(f => !beforeFiles.includes(f) && f.endsWith('.json'))
  console.log('  批量后新增文件: ' + newFiles.join(', '))

  t('S5 至少新增3个JSON文件', newFiles.length >= 3, newFiles.length + '个新文件')

  let s5AllValid = true
  let s5All16Fields = true
  let s5AllAbilitiesString = true
  const s5Summaries = []

  for (const nf of newFiles) {
    testFiles.push('1/characters/' + nf)
    const v = verifyCharacterFile('1/characters/' + nf)
    if (!v.exists) { s5AllValid = false; continue }
    if (!v.valid) s5All16Fields = false
    if (v.obj && typeof v.obj.abilities !== 'string') s5AllAbilitiesString = false
    if (v.obj) {
      s5Summaries.push(v.obj.name + '(' + v.obj.role + ')')
    }
  }

  t('S5 所有新文件16字段完整', s5All16Fields)
  t('S5 所有新文件abilities是字符串', s5AllAbilitiesString)
  t('S5 所有新文件创建成功', s5AllValid)
  console.log('    新增角色: ' + s5Summaries.join(', '))

  // 验证新增文件角色类型合法
  let s5RolesValid = true
  for (const nf of newFiles) {
    const v = verifyCharacterFile('1/characters/' + nf)
    if (v.obj && !VALID_ROLES.includes(v.obj.role)) {
      s5RolesValid = false
      console.log('    ⚠ ' + nf + ' role="' + v.obj.role + '" 不合法')
    }
  }
  t('S5 所有新文件role合法', s5RolesValid)

  // ═══════════════════════════════════════════════
  //  S6: 非法角色类型自动标准化
  // ═══════════════════════════════════════════════
  hr('S6 角色类型标准化 — "男主角"→"男主"')

  const s6Msg =
    '创建角色test，角色类型写"男主角"。就用这个类型，' +
    '保存到 1/characters/test.yaml'

  console.log('  用户: ' + s6Msg)
  const s6 = await agentRun(s6Msg)

  t('S6 有工具调用', s6.toolCalls >= 1, s6.toolCalls + '个工具 ' + s6.iterations + '轮')
  t('S6 使用了create_file', s6.toolLog.some(l => l.name === 'create_file' && l.ok))

  // 验证磁盘文件 — role必须是"男主"而非"男主角"
  testFiles.push('1/characters/test.yaml')
  const s6Verify = verifyCharacterFile('1/characters/test.yaml')
  t('S6 文件创建成功', s6Verify.exists)
  if (s6Verify.exists) {
    t('S6 16字段完整', s6Verify.valid,
      s6Verify.valid ? '全部16字段' : '缺少: ' + (s6Verify.missing || []).join(', '))
    // 关键检查: role应该是"男主"而不是"男主角"
    const s6Role = s6Verify.obj ? s6Verify.obj.role : ''
    t('S6 role="男主"(已标准化)', s6Role === '男主',
      '实际值: "' + s6Role + '"')
    t('S6 role在合法范围内', VALID_ROLES.includes(s6Role),
      'role="' + s6Role + '" ' + (VALID_ROLES.includes(s6Role) ? '合法' : '不合法'))
    t('S6 abilities是字符串',
      s6Verify.obj && typeof s6Verify.obj.abilities === 'string',
      s6Verify.obj ? typeof s6Verify.obj.abilities : 'N/A')

    if (s6Verify.obj) {
      console.log('    角色摘要: name=' + s6Verify.obj.name + ' | role=' + s6Verify.obj.role +
        ' | gender=' + s6Verify.obj.gender + ' | age=' + s6Verify.obj.age)
    }
  }

  // ═══════════════════════════════════════════════
  //  汇总
  // ═══════════════════════════════════════════════
  const total = pass + fail
  console.log('\n\n═══════════════════════════════════════════════')
  console.log('  角色管理仿真测试结果')
  console.log('═══════════════════════════════════════════════')
  console.log('  总计: ' + total + '  ✅ ' + pass + '  ❌ ' + fail)
  console.log('  通过率: ' + (total > 0 ? ((pass / total) * 100).toFixed(1) : '0.0') + '%')
  console.log('')
  console.log('  场景覆盖:')
  console.log('    S1 — 创建女主: list→read参考→create→16字段验证')
  console.log('    S2 — 最少信息创建: 默认值填充 + 用户确认')
  console.log('    S3 — 读取角色卡: read_file + 内容验证')
  console.log('    S4 — 创建反派: 反派字段 + abilities字符串验证')
  console.log('    S5 — 批量创建3配角: 并行create×3 + 完整性验证')
  console.log('    S6 — 角色类型标准化: "男主角"→"男主"')
  console.log('')

  // ═══════════════════════════════════════════════
  //  清理测试文件
  // ═══════════════════════════════════════════════
  console.log('  ── 清理测试文件 ──')
  cleanupTestFiles(testFiles)

  // 也清理项目目录（如果只剩空目录）
  try {
    const charDir = P('1/characters')
    const remaining = fs.readdirSync(charDir)
    if (remaining.length === 0) {
      fs.rmdirSync(charDir)
      const projDir = P('1')
      const projRemaining = fs.readdirSync(projDir)
      if (projRemaining.length === 0) {
        fs.rmdirSync(projDir)
        const projectsDir = P('')
        try {
          const pRemaining = fs.readdirSync(projectsDir)
          if (pRemaining.length === 0) {
            fs.rmdirSync(projectsDir)
          }
        } catch { /* projects dir might not be empty */ }
      }
    }
  } catch { /* cleanup best-effort */ }

  console.log('')

  return pass === total
}

// ═══════════════════════════════════════════════════
//  入口
// ═══════════════════════════════════════════════════
main()
  .then(allPassed => {
    if (!allPassed) process.exitCode = 1
  })
  .catch(e => {
    console.error('\n💥 测试异常:', e.message)
    console.error(e.stack)
    process.exit(1)
  })
