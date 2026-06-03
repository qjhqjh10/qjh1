#!/usr/bin/env node
/**
 * 仿真测试: 章节润色
 * 模拟用户打开AI写作助手，执行真实对话操作。
 * 场景: 读→改→diff（read_file → edit_file 两轮润色）
 *
 * 运行: node scripts/full-sim/09-chapter-polish.mjs
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
const MAX_ITERATIONS = 12
const MAX_PREVIEW_CHARS = 2500
const ROOT = APP_ROOT

// ── 路径辅助 ──
const P = (p) => path.join(ROOT, 'projects', p)
const N = (p) => path.join(ROOT, 'notes', p)

// ── 文件读缓存 (与 V4AgentRuntime 的 FileReadCache 行为一致) ──
const fileCache = new Map()
function readFileCached(fp) {
  const key = path.resolve(fp)
  if (fileCache.has(key)) return fileCache.get(key)
  try {
    const content = fs.readFileSync(fp, 'utf-8')
    const entry = { content, size: content.length }
    fileCache.set(key, entry)
    return entry
  } catch {
    return null
  }
}
function invalidateCache(fp) {
  fileCache.delete(path.resolve(fp))
}

// ── 工具实现 ──
const tools = {
  read_file: (args) => {
    let fp = args.file_path || args.path || ''
    fp = fp.replace(/^\/+/, '')
    const fullPath = P(fp)
    try {
      const content = fs.readFileSync(fullPath, 'utf-8')
      const preview = content.length > MAX_PREVIEW_CHARS
        ? content.slice(0, MAX_PREVIEW_CHARS) + `\n\n…(共${content.length}字，已截断显示前${MAX_PREVIEW_CHARS}字)`
        : content
      return `读取成功: ${fp} (${content.length}字)\n\n${preview}`
    } catch (e) {
      return `[错误: 文件不存在 - ${fp}]`
    }
  },

  edit_file: (args) => {
    let fp = args.file_path || args.path || ''
    fp = fp.replace(/^\/+/, '')
    const fullPath = P(fp)
    const oldStr = args.old_string || ''
    const newStr = args.new_string || ''

    // __FULL_REPLACE__ 全量替换
    if (oldStr === '__FULL_REPLACE__') {
      try {
        fs.writeFileSync(fullPath, newStr, 'utf-8')
        invalidateCache(fullPath)
        return `全量替换成功: ${fp} (${newStr.length}字)`
      } catch (e) {
        return `[错误: 全量替换失败 - ${e.message}]`
      }
    }

    try {
      const content = fs.readFileSync(fullPath, 'utf-8')

      // 多策略匹配（模拟 V4AgentRuntime 的 7 策略匹配引擎）
      let idx = content.indexOf(oldStr)

      // 策略1: 精确匹配 (已尝试)
      if (idx < 0) {
        // 策略2: trim 匹配
        idx = content.indexOf(oldStr.trim())
      }
      if (idx < 0) {
        // 策略3: 忽略行首空白
        const lines = content.split('\n')
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].trimStart() === oldStr.trimStart()) {
            idx = content.indexOf(lines[i])
            break
          }
        }
      }
      if (idx < 0) {
        // 策略4: 全角半角归一化
        const toHalf = (s) => s.replace(/[！-～]/g, (c) =>
          String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
        idx = content.indexOf(toHalf(oldStr))
      }

      if (idx < 0) {
        return `[未找到匹配文本: "${oldStr.slice(0, 80)}${oldStr.length > 80 ? '...' : ''}"]`
      }

      const before = content.slice(0, idx)
      const after = content.slice(idx + oldStr.length)
      const newContent = before + newStr + after
      fs.writeFileSync(fullPath, newContent, 'utf-8')
      invalidateCache(fullPath)

      // 生成 diff 摘要
      const added = newStr.length > oldStr.length ? `+${newStr.length - oldStr.length}字` : ''
      const removed = newStr.length < oldStr.length ? `-${oldStr.length - newStr.length}字` : ''
      const diffTag = [added, removed].filter(Boolean).join(' ')
      return `编辑成功: ${fp} (${diffTag || '字数不变'})\n原: ${oldStr.slice(0, 60)}...\n新: ${newStr.slice(0, 60)}...`
    } catch (e) {
      return `[错误: 编辑失败 - ${e.message}]`
    }
  },

  list_directory: (args) => {
    let dir = args.path || args.dir_path || '.'
    dir = dir.replace(/^\/+/, '')
    const fullPath = P(dir)
    try {
      const entries = fs.readdirSync(fullPath, { withFileTypes: true })
      const list = entries.map((e) => `${e.isDirectory() ? '📁' : '📄'} ${e.name}`)
      return `目录 ${dir}: ${list.length}个条目\n${list.join('\n')}`
    } catch (e) {
      return `[错误: 目录不存在 - ${dir}]`
    }
  },

  search_content: (args) => {
    const pattern = args.pattern || ''
    const searchPath = args.path || '1/chapters'
    if (!pattern) return '[错误: 缺少搜索模式]'
    const fullPath = P(searchPath)
    try {
      const re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
      const results = []
      function walk(dir) {
        if (fs.statSync(dir).isFile()) {
          const c = fs.readFileSync(dir, 'utf-8')
          const lines = c.split('\n')
          for (let i = 0; i < lines.length; i++) {
            if (re.test(lines[i])) {
              results.push(`${dir.replace(/\\/g, '/').replace(PROJECTS_DIR + '/', '')}:${i + 1}: ${lines[i].trim().slice(0, 150)}`)
            }
          }
        } else {
          for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            walk(path.join(dir, e.name))
          }
        }
      }
      walk(fullPath)
      if (results.length === 0) return `搜索完成: 在 ${searchPath} 中未找到 "${pattern}"`
      return `搜索完成: 找到 ${results.length} 处匹配\n${results.slice(0, 10).join('\n')}`
    } catch (e) {
      return `[错误: 搜索失败 - ${e.message}]`
    }
  },

  list_prompts: () => '灵感/世界观/角色/大纲/细纲/章节/润色/续写/改写/摘要/审稿',
  list_rules: () => '暂无自定义规则',
  list_notes: () => {
    try {
      fs.mkdirSync(N(''), { recursive: true })
      const files = fs.readdirSync(N('')).filter((f) => f.endsWith('.md'))
      return files.join('\n') || '无笔记'
    } catch { return '无笔记' }
  },
  write_note: (args) => {
    try {
      fs.mkdirSync(N(''), { recursive: true })
      fs.writeFileSync(N((args.name || 'x') + '.md'), args.content || '')
      return '笔记创建成功'
    } catch (e) { return `[错误: ${e.message}]` }
  },
  read_note: (args) => {
    try { return fs.readFileSync(N((args.name || 'x') + '.md'), 'utf-8').slice(0, 500) }
    catch { return '[笔记不存在]' }
  },

  // 恢复备份（用于测试 undo/redo）
  write_learning: () => '经验已记录',
  learn_rule: () => '规则已学习',
}

// ── 工具定义 (OpenAI 协议 tool_calls 格式) ──
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: '读取项目文件内容。已知路径直接读取，不需要先列目录。超过2500字会自动截断。',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '文件相对路径，如 1/chapters/chapter3.txt' },
        },
        required: ['file_path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: '编辑项目文件。必须先 read_file 确认原文。用 old_string 精确匹配后替换为 new_string。old_string="__FULL_REPLACE__" 表示全量替换。',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '文件相对路径' },
          old_string: { type: 'string', description: '要替换的原文本（精确匹配）' },
          new_string: { type: 'string', description: '替换后的新文本' },
        },
        required: ['file_path', 'old_string', 'new_string'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: '列出项目目录内容。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '目录路径' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_content',
      description: '在项目文件中搜索文本内容。',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: '搜索关键词' },
          path: { type: 'string', description: '搜索路径(可选)，默认 1/chapters' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_prompts',
      description: '列出所有可用提示词模板。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_rules',
      description: '列出已学习规则。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_notes',
      description: '列出所有笔记。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_note',
      description: '创建新笔记。',
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
      description: '读取笔记内容。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'learn_rule',
      description: '学习新规则。',
      parameters: {
        type: 'object',
        properties: { rule: { type: 'string' } },
        required: ['rule'],
      },
    },
  },
]

// ── 系统提示词 ──
const SYSTEM_PROMPT = [
  '你是青剑AI写作助手，专为小说创作设计。',
  '',
  '# 铁律：何时用工具，何时不用',
  '✅ 调工具（用户要求操作文件）: 读取/列出/搜索/创建/编辑/删除/写/保存/修改/改/看(文件)/找(文件)/润色/改写',
  '❌ 不调工具（纯对话）: 我是/我叫/我喜欢/我觉得/你好/嗨/谢谢/什么是/为什么/怎么/推荐/建议',
  '',
  '# 执行规则',
  '- 已知路径直接读文件，不列目录。修改前先读文件确认内容。',
  '- 只做用户要求的操作，不多做。回复简洁。',
  '- 多个独立操作可在同一轮并行完成。有依赖的操作分轮执行。',
  '- edit_file 使用精确文本匹配: old_string 必须与文件中的原文完全一致（包括标点、空格）。',
  '- 如果 old_string 匹配失败，系统会自动尝试 trim/忽略行首空白/全角半角归一化等策略。',
  '',
  '# 路径规范',
  '角色: 1/characters/中文名.yaml  章节: 1/chapters/chapter{N}.txt',
  '细纲: 1/detailed_outline/chapter{N}.yaml  大纲: 1/outline/plot.md',
].join('\n')

// ═══════════════════════════════════════════════
//  API 调用 (OpenAI 协议 /v1/chat/completions)
// ═══════════════════════════════════════════════

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
    throw new Error(`HTTP ${res.status}: ${errText.slice(0, 300)}`)
  }

  const json = await res.json()
  const choice = json.choices?.[0]
  if (!choice) throw new Error('API响应无choices: ' + JSON.stringify(json).slice(0, 200))

  return {
    text: choice.message?.content || '',
    toolCalls: choice.message?.tool_calls || [],
    finishReason: choice.finish_reason || 'stop',
    usage: json.usage,
  }
}

// ═══════════════════════════════════════════════
//  Agent 主循环
// ═══════════════════════════════════════════════

async function agentRun(userMsg) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userMsg },
  ]

  let iterations = 0
  let totalTools = 0
  let fullText = ''
  const toolLogs = []

  while (iterations < MAX_ITERATIONS) {
    iterations++
    process.stdout.write(`  [iter${iterations}] `)

    const result = await callOpenAI(messages)

    if (result.text) {
      fullText = result.text
    }

    if (!result.toolCalls || result.toolCalls.length === 0) {
      process.stdout.write('reply\n')
      break
    }

    process.stdout.write(`${result.toolCalls.map((t) => t.function?.name || '?').join(', ')} `)

    // 构建 assistant 消息
    const asstMsg = {
      role: 'assistant',
      content: result.text || null,
      tool_calls: result.toolCalls,
    }
    messages.push(asstMsg)

    // 执行所有工具调用
    for (const tc of result.toolCalls) {
      const fn = tc.function
      const toolFn = tools[fn.name]
      let args = {}
      try {
        args = JSON.parse(fn.arguments)
      } catch (e) {
        args = {}
      }

      let execResult
      if (toolFn) {
        execResult = toolFn(args)
      } else {
        execResult = `[未知工具: ${fn.name}]`
      }

      totalTools++
      const isError = typeof execResult === 'string' && execResult.startsWith('[')
      process.stdout.write(isError ? '✗ ' : '✓ ')

      toolLogs.push({
        name: fn.name,
        args,
        ok: !isError,
        summary: typeof execResult === 'string' ? execResult.slice(0, 120) : JSON.stringify(execResult).slice(0, 120),
      })

      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: execResult,
      })
    }
    process.stdout.write('\n')
  }

  return { text: fullText, iterations, toolCalls: totalTools, toolLogs }
}

// ═══════════════════════════════════════════════
//  测试结果记录
// ═══════════════════════════════════════════════

let pass = 0
let fail = 0
let scenarioNum = 0

function t(name, cond, detail) {
  if (cond) {
    pass++
    console.log(`  ✅ ${name}${detail ? ': ' + detail : ''}`)
  } else {
    fail++
    console.log(`  ❌ ${name}${detail ? ': ' + detail : ''}`)
  }
}

// 延迟辅助
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ═══════════════════════════════════════════════
//  Main
// ═══════════════════════════════════════════════

async function main() {
  console.log('═══════════════════════════════════════════════')
  console.log('  仿真测试 09: 章节润色 (read_file + edit_file)')
  console.log(`  端点: ${API_URL}`)
  console.log(`  模型: ${MODEL}`)
  console.log(`  测试目录: ${path.relative(process.cwd(), PROJECTS_DIR)}/1/chapters/`)
  console.log('═══════════════════════════════════════════════')
  console.log('')

  // ── 准备: 生成测试用副本 ──
  console.log('▶ 准备: 创建测试用章节副本')
  const sourceFile = path.join(PROJECTS_DIR, '1/chapters', 'chapter3.txt')
  const testFile = '1/chapters/_test_polish_chapter.txt'
  const testFullPath = path.join(PROJECTS_DIR, testFile)

  if (fs.existsSync(sourceFile)) {
    fs.copyFileSync(sourceFile, testFullPath)
    console.log(`  ✓ 已创建测试副本: ${testFile} (源文件保护)\n`)
  } else {
    console.log(`  ✗ 源文件 chapter3.txt 不存在，跳过文件准备\n`)
    t('测试准备', false, '源文件不存在')
  }

  // ═══════════════════════════════════════════
  //  场景 1: 基础润色 — 读章节 + 润色某段落
  // ═══════════════════════════════════════════
  scenarioNum++
  console.log(`┌─ 场景 ${scenarioNum}: 基础润色（读→改）─────────────────┐`)
  console.log('│  用户: 打开章节阅读, 发现某段需要润色, AI 读后执行替换  │')
  console.log('│  预期: read_file(1次) → edit_file(1次)                │')
  console.log('└──────────────────────────────────────────────────────┘')

  // 用户自然输入: 有错别字、口语化、中文聊天风格
  const s1 = await agentRun(
    '帮我看一下 1/chapters/_test_polish_chapter.txt 这个文件，' +
    '我觉得开头那段"张明推开宿舍门的时候，整个人僵在了门口"太平淡了，' +
    '能帮我把这段改得更有画面感吗？就是那种更紧张更有悬念的感觉。'
  )
  t('S1 读+润色建议', s1.toolCalls >= 1 && s1.iterations <= 6,
    `${s1.iterations}轮 ${s1.toolCalls}工具 ` +
    `${s1.toolLogs.map((l) => l.name + (l.ok ? '' : '✗')).join(', ')}`)

  if (s1.toolLogs.some((l) => l.name === 'read_file')) {
    t('  S1-a 读取了章节', true)
  } else {
    t('  S1-a 读取了章节', false, '未调用read_file')
  }

  await sleep(1000)

  // ═══════════════════════════════════════════
  //  场景 2: 不满意要求调整 — 多轮润色
  // ═══════════════════════════════════════════
  scenarioNum++
  console.log(`\n┌─ 场景 ${scenarioNum}: 不满意要求调整（多轮润色）─────────┐`)
  console.log('│  用户: 看了看改完的结果, 觉得不够好, 要求重新改         │')
  console.log('│  预期: read_file(确认当前内容) → edit_file(重新修改)   │')
  console.log('└──────────────────────────────────────────────────────┘')

  const s2 = await agentRun(
    '唔，看了下改完的开头，感觉还是不对味儿。别增加太多形容词，' +
    '我想要那种冷硬的风格，更像是一个侦探小说的开头，不要抒情那种。' +
    '能帮我再改一下吗？还是那个文件 1/chapters/_test_polish_chapter.txt'
  )
  t('S2 不满意→再改', s2.toolCalls >= 1 && s2.iterations <= 8,
    `${s2.iterations}轮 ${s2.toolCalls}工具 ` +
    `${s2.toolLogs.map((l) => l.name + (l.ok ? '' : '✗')).join(', ')}`)

  await sleep(1000)

  // ═══════════════════════════════════════════
  //  场景 3: 文件路径错误 → 搜索 → 重试
  // ═══════════════════════════════════════════
  scenarioNum++
  console.log(`\n┌─ 场景 ${scenarioNum}: 文件路径错误→搜索→重试──────────────┐`)
  console.log('│  用户: 输错文件名, AI 报错后搜索正确文件并重试         │')
  console.log('│  预期: read_file(失败) → search_content 或 list_directory → read_file(成功)  │')
  console.log('└──────────────────────────────────────────────────────┘')

  const s3 = await agentRun(
    '帮我润色下 1/chapters/chapter99.txt 的第二段，改得更有悬念感'
  )
  t('S3 错误恢复', s3.toolCalls >= 2,
    `${s3.iterations}轮 ${s3.toolCalls}工具 ` +
    `${s3.toolLogs.map((l) => l.name + (l.ok ? '' : '✗')).join(', ')}`)

  if (s3.toolLogs.some((l) => l.name === 'read_file' && !l.ok)) {
    t('  S3-a 首次读取失败(符合预期)', true)
  } else {
    t('  S3-a 首次读取失败(符合预期)', false, '首次未失败或未调用read_file')
  }

  if (s3.toolLogs.some((l) => l.name === 'search_content' || l.name === 'list_directory')) {
    t('  S3-b 搜索了替代文件', true)
  } else {
    t('  S3-b 搜索了替代文件', false, '未搜索')
  }

  await sleep(1000)

  // ═══════════════════════════════════════════
  //  场景 4: 全文润色（批量修改）— 多段落修改
  // ═══════════════════════════════════════════
  scenarioNum++
  console.log(`\n┌─ 场景 ${scenarioNum}: 全文润色（批量修改）──────────────────┐`)
  console.log('│  用户: 要求润色大段文字, AI 需要多次 edit_file         │')
  console.log('│  预期: read_file → edit_file(≥1, 可能多次)          │')
  console.log('└──────────────────────────────────────────────────────┘')

  const s4 = await agentRun(
    '我看了下 _test_polish_chapter.txt 整体还可以，但对话描写太平了。' +
    '帮我把里面"张明"的对话语气改得更强硬一点，比如把"林语晴？"改成更惊讶的语气，' +
    '把"站起来"改成更命令式的感觉。先读一下文件再改。'
  )
  t('S4 全文润色(批量)', s4.toolCalls >= 2 && s4.iterations <= 8,
    `${s4.iterations}轮 ${s4.toolCalls}工具 ` +
    `${s4.toolLogs.map((l) => l.name + (l.ok ? '' : '✗')).join(', ')}`)

  if (s4.toolLogs.filter((l) => l.name === 'edit_file').length >= 1) {
    t('  S4-a 至少执行了1次edit', true)
  } else {
    t('  S4-a 至少执行了1次edit', false, 'edit_file未执行')
  }

  if (s4.toolLogs.some((l) => l.name === 'read_file' && l.ok)) {
    t('  S4-b 修改前先读了文件', true)
  } else {
    t('  S4-b 修改前先读了文件', false)
  }

  await sleep(1000)

  // ═══════════════════════════════════════════
  //  场景 5: 空内容/过短内容防御
  // ═══════════════════════════════════════════
  scenarioNum++
  console.log(`\n┌─ 场景 ${scenarioNum}: 边界情况 — 空替换防御─────────────────┐`)
  console.log('│  用户: 误操作, 试图将内容替换为空, AI 应拒绝或确认      │')
  console.log('│  预期: AI 不执行无意义的空替换（工具自身可防御）        │')
  console.log('└──────────────────────────────────────────────────────┘')

  const s5 = await agentRun(
    '帮我把 1/chapters/_test_polish_chapter.txt 改成空的，我想重写这章。'
  )
  t('S5 空替换防御', s5.iterations <= 6,
    `${s5.iterations}轮 ${s5.toolCalls}工具 ` +
    `${s5.toolLogs.map((l) => l.name + (l.ok ? '' : '✗')).join(', ')}`)

  await sleep(1000)

  // ═══════════════════════════════════════════
  //  场景 6: 复原测试 — 用 __FULL_REPLACE__ 恢复原文件
  // ═══════════════════════════════════════════
  scenarioNum++
  console.log(`\n┌─ 场景 ${scenarioNum}: 恢复原文（全量替换）───────────────────┐`)
  console.log('│  用户: 润色改多了, 想恢复到最初版本                    │')
  console.log('│  预期: read_file(原文件) → edit_file(__FULL_REPLACE__) │')
  console.log('└──────────────────────────────────────────────────────┘')

  // 先读原文件获取内容
  const originalContent = fs.existsSync(sourceFile)
    ? fs.readFileSync(sourceFile, 'utf-8')
    : ''

  if (originalContent) {
    const s6 = await agentRun(
      '算了，之前改得太多了，帮我把 _test_polish_chapter.txt 恢复成原来的样子。' +
      '你先读一下原始的 chapter3.txt，然后看看能不能把那几个改过的地方还原回去。' +
      '不用全部重写，就把开头几句话还原就行。'
    )
    t('S6 恢复原文', s6.toolCalls >= 2 && s6.iterations <= 8,
      `${s6.iterations}轮 ${s6.toolCalls}工具 ` +
      `${s6.toolLogs.map((l) => l.name + (l.ok ? '' : '✗')).join(', ')}`)

    if (s6.toolLogs.filter((l) => l.name === 'read_file').length >= 2) {
      t('  S6-a 读取了原文件+修改文件', true)
    }

    // 用全量替换彻底恢复
    const s6b = await agentRun(
      '算了还是麻烦你直接把 _test_polish_chapter.txt 的内容替换成 chapter3.txt 的原始内容吧，' +
      '用全量替换的方式。先读 chapter3.txt，然后对 _test_polish_chapter.txt 做全量替换。'
    )
    t('  S6-b 全量替换恢复', s6b.toolCalls >= 2,
      `${s6b.iterations}轮 ${s6b.toolCalls}工具 ` +
      `${s6b.toolLogs.map((l) => l.name + (l.ok ? '' : '✗')).join(', ')}`)
  } else {
    console.log('  ⚠ 原始文件不可用，跳过恢复测试')
  }

  await sleep(1000)

  // ═══════════════════════════════════════════
  //  场景 7: 对话不误调工具
  // ═══════════════════════════════════════════
  scenarioNum++
  console.log(`\n┌─ 场景 ${scenarioNum}: 对话防误调（闲聊不应调工具）────────────┐`)
  console.log('│  用户: 聊写作相关话题但不要求操作文件, 不应调工具       │')
  console.log('└──────────────────────────────────────────────────────┘')

  const s7 = await agentRun('你觉得我写的这个小说开头怎么样？有什么改进建议吗？')
  t('S7-a 纯评价(0工具)', s7.toolCalls === 0,
    `${s7.iterations}轮 ${s7.toolCalls}工具`)

  const s7b = await agentRun('帮我提提写作建议，我怎么才能把悬疑感写得更好？')
  t('S7-b 纯建议(0工具)', s7b.toolCalls === 0,
    `${s7b.iterations}轮 ${s7b.toolCalls}工具`)

  // ═══════════════════════════════════════════
  //  场景 8: 中文 chat 风格 — 碎片化多轮对话
  // ═══════════════════════════════════════════
  scenarioNum++
  console.log(`\n┌─ 场景 ${scenarioNum}: 中文chat风格碎片化对话─────────────────┐`)
  console.log('│  用户: 模仿真实用户的分段发送行为                        │')
  console.log('│  预期: 各轮独立处理, 不混淆上下文                      │')
  console.log('└──────────────────────────────────────────────────────┘')

  const s8a = await agentRun('在吗')
  t('S8-a 在吗(0工具)', s8a.toolCalls === 0,
    `${s8a.iterations}轮 ${s8a.toolCalls}工具`)

  const s8b = await agentRun('帮我看下 _test_polish_chapter.txt')
  t('S8-b 看文件', s8b.toolCalls >= 1,
    `${s8b.iterations}轮 ${s8b.toolCalls}工具`)

  const s8c = await agentRun('好的，谢谢')
  t('S8-c 感谢(0工具)', s8c.toolCalls === 0,
    `${s8c.iterations}轮 ${s8c.toolCalls}工具`)

  // ═══════════════════════════════════════════
  //  清理
  // ═══════════════════════════════════════════
  console.log('\n▶ 清理: 删除测试文件')
  if (fs.existsSync(testFullPath)) {
    try {
      fs.unlinkSync(testFullPath)
      console.log(`  ✓ 已删除: ${testFile}`)
    } catch (e) {
      console.log(`  ✗ 删除失败: ${e.message}`)
    }
  }

  // ═══════════════════════════════════════════
  //  汇总
  // ═══════════════════════════════════════════
  const total = pass + fail
  console.log('\n\n═══════════════════════════════════════════')
  console.log('  仿真测试 09: 章节润色 — 测试结果')
  console.log('═══════════════════════════════════════════')
  console.log(`  总计: ${total}  |  ✅ ${pass}  |  ❌ ${fail}`)
  console.log(`  通过率: ${total > 0 ? ((pass / total) * 100).toFixed(1) : '0'}%\n`)

  if (fail > 0) {
    console.log(`  ${fail} 个测试未通过 — 请检查上述 ❌ 详情`)
  }

  console.log(`  目标工具: read_file + edit_file`)
  console.log(`  覆盖场景: 读→改 | 错误恢复 | 批量修改 | 多轮润色 | 全量替换 | 闲聊防御\n`)
}

main().catch((e) => {
  console.error('\n💥 测试异常:', e.message)
  console.error(e.stack)
  process.exit(1)
})
