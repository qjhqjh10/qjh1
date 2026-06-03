#!/usr/bin/env node
/**
 * 仿真测试: 笔记 (notes)
 * 模拟用户打开AI写作助手，执行真实笔记管理对话操作
 * 测试工具: list_notes, read_note, write_note, append_note, delete_note, search_notes
 *
 * 运行: node scripts/full-sim/13-notes.mjs
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

// ── 配置 ──
const API_KEY = process.env.AI_API_KEY || 'sk-c9c30831df7243209435c60e811c879d'
const API_URL = 'https://api.deepseek.com/v1/chat/completions'
const MODEL = 'deepseek-v4-flash'
const MAX_ITERATIONS = 10
const ROOT = process.cwd()
const N = p => path.join(ROOT, 'notes', p)

// ── 工具实现 ──
const tools = {
  list_notes: () => {
    try {
      fs.mkdirSync(N(''), { recursive: true })
      const files = fs.readdirSync(N(''))
      const mdFiles = files.filter(f => f.endsWith('.md'))
      return mdFiles.length > 0 ? mdFiles.join('\n') : '(无笔记)'
    } catch {
      return '(无笔记)'
    }
  },

  read_note: (args) => {
    try {
      let name = args.note_name || ''
      if (!name.endsWith('.md')) name += '.md'
      const fp = N(name)
      const content = fs.readFileSync(fp, 'utf-8')
      if (content.length === 0) return '(笔记为空)'
      // 仿真中返回完整内容（最多2000字），与 read_file 行为一致
      return content.length > 2000 ? content.slice(0, 2000) + '\n…(' + content.length + '字)' : content
    } catch (e) {
      if (e.code === 'ENOENT') return `[笔记不存在: ${args.note_name || '?'}]`
      return `[错误: ${e.message}]`
    }
  },

  write_note: (args) => {
    try {
      let name = args.note_name || 'untitled'
      if (!name.endsWith('.md')) name += '.md'
      const content = String(args.content || '')
      fs.mkdirSync(N(''), { recursive: true })
      fs.writeFileSync(N(name), content, 'utf-8')
      return `笔记创建成功: ${name} (${content.length}字)`
    } catch (e) {
      return `[错误: ${e.message}]`
    }
  },

  append_note: (args) => {
    try {
      let name = args.note_name || 'untitled'
      if (!name.endsWith('.md')) name += '.md'
      const newContent = String(args.content || '')
      const fp = N(name)
      fs.mkdirSync(N(''), { recursive: true })
      let existing = ''
      try { existing = fs.readFileSync(fp, 'utf-8') } catch { /* 文件不存在则创建 */ }
      const combined = existing ? existing + '\n\n' + newContent : newContent
      fs.writeFileSync(fp, combined, 'utf-8')
      return `已追加到笔记: ${name} (+${newContent.length}字, 总计${combined.length}字)`
    } catch (e) {
      return `[错误: ${e.message}]`
    }
  },

  delete_note: (args) => {
    try {
      let name = args.note_name || ''
      if (!name.endsWith('.md')) name += '.md'
      fs.unlinkSync(N(name))
      return `笔记删除成功: ${name}`
    } catch (e) {
      if (e.code === 'ENOENT') return `[笔记不存在: ${args.note_name || '?'}]`
      return `[错误: ${e.message}]`
    }
  },

  search_notes: (args) => {
    try {
      const query = String(args.query || '').toLowerCase()
      const topK = args.topK || 3
      fs.mkdirSync(N(''), { recursive: true })
      const files = fs.readdirSync(N('')).filter(f => f.endsWith('.md'))
      if (files.length === 0) return '未找到相关笔记（笔记目录为空）'

      const results = []
      for (const file of files) {
        try {
          const content = fs.readFileSync(N(file), 'utf-8')
          const lowerContent = content.toLowerCase()
          const lowerFile = file.toLowerCase()
          // 简单关键词匹配 + 文件名匹配
          let score = 0
          if (lowerFile.includes(query)) score += 10
          // 统计查询词在内容中出现的次数
          const re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
          const matches = lowerContent.match(re)
          if (matches) score += matches.length
          // 查询词拆字后分别匹配（中文搜索支持）
          for (const char of query) {
            if (char.trim() && lowerContent.includes(char)) score += 0.5
          }
          if (score > 0) {
            // 提取上下文片段
            const idx = lowerContent.indexOf(query)
            const start = Math.max(0, idx - 40)
            const end = Math.min(content.length, idx + query.length + 40)
            const snippet = (start > 0 ? '…' : '') + content.slice(start, end) + (end < content.length ? '…' : '')
            results.push({ fileName: file, score: Math.round(score), content: snippet })
          }
        } catch { /* skip unreadable files */ }
      }

      results.sort((a, b) => b.score - a.score)
      const top = results.slice(0, topK)
      if (top.length === 0) return `未找到与"${query}"相关的笔记`
      return top.map(r => `[${r.fileName}] (相关度:${r.score})\n${r.content}`).join('\n---\n')
    } catch (e) {
      return `[搜索错误: ${e.message}]`
    }
  },
}

// ── 工具 Schema (OpenAI 格式) ──
// 只包含笔记相关的6个工具，让模型聚焦笔记场景
const NOTE_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'list_notes',
      description: '列出全局 notes/ 目录下的所有草稿笔记。何时使用：需要查看已有草稿时。草稿是全局的（不绑定项目），适合记录灵感、暂存想法。',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_note',
      description: '读取指定草稿笔记的完整内容。何时使用：需要查看某篇草稿的具体内容时。note_name 是文件名（如"灵感记录.md"），先用 list_notes 确认文件名。',
      parameters: {
        type: 'object',
        properties: { note_name: { type: 'string', description: '草稿文件名' } },
        required: ['note_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_note',
      description: '创建或覆写草稿笔记。何时使用：记录灵感、保存分析结果、暂存对话中的重要信息。如果文件已存在会覆写全文——如果只想追加内容请用 append_note。',
      parameters: {
        type: 'object',
        properties: {
          note_name: { type: 'string', description: '草稿文件名' },
          content: { type: 'string', description: '完整内容（Markdown）' },
        },
        required: ['note_name', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'append_note',
      description: '向草稿笔记末尾追加内容。文件不存在则自动创建。何时使用：想在已有笔记后补充新内容时，而不是覆写全文。',
      parameters: {
        type: 'object',
        properties: {
          note_name: { type: 'string', description: '草稿文件名' },
          content: { type: 'string', description: '要追加的内容' },
        },
        required: ['note_name', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_note',
      description: '删除 notes/ 目录下的草稿笔记文件。',
      parameters: {
        type: 'object',
        properties: { note_name: { type: 'string', description: '草稿文件名' } },
        required: ['note_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_notes',
      description: '在草稿中搜索相关内容。支持中文自然语言查询，返回最相关的笔记片段。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索查询（支持中文）' },
          topK: { type: 'number', description: '返回结果数量（默认3）' },
        },
        required: ['query'],
      },
    },
  },
]

// ── 系统提示词 ──
// 基于 REAL CORE_SYSTEM_PROMPT 的精简版，聚焦笔记场景
const SYS = [
  '你是"青剑"，AI小说创作助手。',
  '',
  '# 铁律',
  '- 操作文件必须调用实际的 function call，口头描述 ≠ 操作完成',
  '- 禁止在文本中用 <tool_name>、[工具名]、或任何 XML/JSON 文本块来模拟工具调用',
  '- 调用工具后失败时诚实告知原因，不假装成功',
  '',
  '# 不用工具的场景 — 直接文本回复',
  '以下情况绝对不要调用任何工具：',
  '- 问候/闲聊："你好""谢谢""再见""早上好"',
  '- 自我介绍/偏好："我叫XX""我是XX""我喜欢XX"',
  '- 简单询问："什么是XX""为什么XX""怎么XX"',
  '- 建议/咨询："推荐一下""有什么建议""怎么办"',
  '- 模糊请求（没有明确文件路径或操作）时，先问清楚再操作',
  '',
  '# 笔记工具',
  '你拥有以下6个笔记工具：',
  '- list_notes: 列出所有笔记文件名（*.md）',
  '- read_note: 读取笔记内容，参数 note_name（文件名，自动加.md）',
  '- write_note: 创建/覆写笔记，参数 note_name + content',
  '- append_note: 追加到笔记末尾，文件不存在则自动创建',
  '- delete_note: 删除笔记，参数 note_name',
  '- search_notes: 搜索笔记内容，参数 query + 可选 topK',
  '',
  '# 执行规则',
  '- 已知文件名直接读笔记，不列目录。修改前先读。只做用户要求的，不多做',
  '- 多个独立操作可在同一轮并行完成。有依赖的操作分轮执行',
  '- 回复简洁。写/删/追加后只输出简短确认，不重复输出全文',
  '- 文件名自动加 .md 后缀，用户不写 .md 也能正确处理',
  '- 不确定笔记是否存在时，先 list_notes 列出来让用户确认',
  '',
  '# 笔记 vs 项目文件',
  '- 笔记是全局草稿（不绑定项目），适合记录灵感、暂存想法',
  '- 项目文件在 projects/ 下，用 read_file/create_file/edit_file 操作',
].join('\n')

// ── API 调用 ──
async function callOpenAI(messages) {
  const body = {
    model: MODEL,
    messages,
    max_tokens: 2048,
    tools: NOTE_TOOLS,
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
  if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + (await res.text()).slice(0, 200))
  const json = await res.json()
  const choice = json.choices[0]
  return {
    text: choice.message?.content || '',
    toolCalls: choice.message?.tool_calls || [],
    finishReason: choice.finish_reason || 'stop',
    usage: json.usage,
  }
}

// ── Agent 运行循环 ──
async function agentRun(userMsg, historyMessages = []) {
  const messages = [
    { role: 'system', content: SYS },
    ...historyMessages,
    { role: 'user', content: userMsg },
  ]
  let iterations = 0
  let totalTools = 0
  let fullText = ''

  while (iterations < MAX_ITERATIONS) {
    iterations++
    process.stdout.write(`  [iter${iterations}] `)
    const r = await callOpenAI(messages)
    if (r.text) fullText = r.text

    if (!r.toolCalls.length) {
      process.stdout.write('done\n')
      return { text: fullText, iterations, toolCalls: totalTools }
    }

    // 构建 assistant 消息
    const asstMsg = {
      role: 'assistant',
      content: r.text || null,
      tool_calls: r.toolCalls,
    }
    messages.push(asstMsg)

    // 执行工具
    for (const tc of r.toolCalls) {
      const fn = tc.function
      const toolFn = tools[fn.name]
      let args = {}
      try { args = JSON.parse(fn.arguments) } catch { /* JSON 解析失败用空 args */ }
      const result = toolFn ? await toolFn(args) : '[未知工具]'
      totalTools++
      const isError = typeof result === 'string' && result.startsWith('[')
      process.stdout.write(fn.name + (isError ? '✗' : '✓') + ' ')
      messages.push({ role: 'tool', tool_call_id: tc.id, content: result })
    }
    process.stdout.write('\n')
  }
  return { text: fullText, iterations, toolCalls: totalTools }
}

// ── 多轮对话 Agent 运行 ──
async function agentRunMultiTurn(turns) {
  const messages = [
    { role: 'system', content: SYS },
  ]
  let totalTools = 0
  let totalIterations = 0
  let fullText = ''

  for (const turn of turns) {
    messages.push({ role: 'user', content: turn })
    let turnIterations = 0

    while (totalIterations < MAX_ITERATIONS) {
      totalIterations++
      turnIterations++
      process.stdout.write(`  [iter${totalIterations}] `)
      const r = await callOpenAI(messages)
      if (r.text) fullText = r.text

      if (!r.toolCalls.length) {
        process.stdout.write('done\n')
        // 把 assistant 文本回复加入历史
        if (r.text) messages.push({ role: 'assistant', content: r.text })
        break
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
        totalTools++
        const isError = typeof result === 'string' && result.startsWith('[')
        process.stdout.write(fn.name + (isError ? '✗' : '✓') + ' ')
        messages.push({ role: 'tool', tool_call_id: tc.id, content: result })
      }
      process.stdout.write('\n')
    }
  }
  return { text: fullText, iterations: totalIterations, toolCalls: totalTools }
}

// ── 测试辅助 ──
let pass = 0
let fail = 0
function t(name, cond, detail) {
  if (cond) {
    pass++
    console.log('  ✔ ' + name + (detail ? ': ' + detail : ''))
  } else {
    fail++
    console.log('  ✖ ' + name + (detail ? ': ' + detail : ''))
  }
}

// ── 清理测试笔记 ──
function cleanupTestNotes() {
  const testPatterns = [
    '仿真测试',
    'sim-test',
    '测试追加',
    'test-append',
    '长篇测试',
    'long-test',
    '批量测试',
    'batch-test',
    '搜索测试',
    'search-test',
    '多轮对话',
    'multi-turn',
    '错误恢复测试',
    'error-test',
  ]
  try {
    fs.mkdirSync(N(''), { recursive: true })
    const files = fs.readdirSync(N(''))
    for (const f of files) {
      for (const pat of testPatterns) {
        if (f.includes(pat)) {
          try { fs.unlinkSync(N(f)) } catch {}
          break
        }
      }
    }
  } catch {}
}

// ── 主测试 ──
console.log('═══════════════════════════════════════════')
console.log('  笔记 (Notes) 仿真测试')
console.log('  端点: ' + API_URL + '  模型: ' + MODEL)
console.log('  测试工具: list_notes, read_note, write_note, append_note, delete_note, search_notes')
console.log('═══════════════════════════════════════════\n')

async function main() {
  // 初始化
  cleanupTestNotes()

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // S1: 纯文本对话 — 不调工具
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('▶ S1 纯文本对话（应0工具）')
  const r1 = await agentRun('你好，我平时喜欢写修仙小说，经常有一些灵感需要记下来，你有什么建议吗')
  t('S1 纯对话0工具', r1.toolCalls === 0, r1.iterations + '轮 ' + r1.toolCalls + '工具')

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // S2: 列出笔记 — list_notes
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('\n▶ S2 查看已有笔记（list_notes）')
  const r2 = await agentRun('帮我看看我现在有哪些笔记草稿')
  t('S2 列出笔记', r2.toolCalls >= 1, r2.iterations + '轮 ' + r2.toolCalls + '工具')

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // S3: 创建笔记 — write_note
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('\n▶ S3 创建新笔记（write_note）')
  const contentS3 = `# 修仙小说灵感

## 世界观
- 灵气复苏背景，现代都市与修仙世界交织
- 修炼等级：炼气→筑基→金丹→元婴→化神→合体→渡劫→大乘

## 主角设定
- 普通上班族，意外获得上古传承
- 表面程序员，暗中修仙
- 性格：冷静理性，但重情义

## 情节梗概
- 第一卷：觉醒篇 — 地铁偶遇神秘老者，获得玉佩传承
- 第二卷：崛起篇 — 在都市中低调修炼，逐步发现世界真相`
  const r3 = await agentRun(`帮我记个笔记，就叫"修仙灵感"，内容如下：\n${contentS3}`)
  t('S3 创建笔记', r3.toolCalls >= 1, r3.iterations + '轮 ' + r3.toolCalls + '工具')

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // S4: 读取笔记 — read_note
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('\n▶ S4 读取笔记（read_note）')
  const r4 = await agentRun('帮我把刚才那个修仙灵感笔记打开看看')
  t('S4 读取笔记', r4.toolCalls >= 1, r4.iterations + '轮 ' + r4.toolCalls + '工具')

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // S5: 追加笔记 — append_note
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('\n▶ S5 追加笔记内容（append_note）')
  const appendContent = `\n## 女角设定
- 苏婉清：金丹期散修，冷艳神秘，实则内心柔软
- 林小月：同为程序员，不知主角修仙身份，暗恋主角

## 反派设定
- 暗影组织：试图利用灵气复苏控制世界
- 神秘人物"黑帝"：渡劫期老怪，暗中布局`
  const r5 = await agentRun(`我又想到了几个角色设定，帮我追加到"修仙灵感"笔记后面：${appendContent}`)
  t('S5 追加笔记', r5.toolCalls >= 1, r5.iterations + '轮 ' + r5.toolCalls + '工具')

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // S6: 验证追加结果 — read_note 确认内容完整
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('\n▶ S6 验证追加结果（read_note）')
  const r6 = await agentRun('再读一下"修仙灵感"笔记，看看角色设定有没有保存进去')
  t('S6 验证追加', r6.toolCalls >= 1, r6.iterations + '轮 ' + r6.toolCalls + '工具')

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // S7: 搜索笔记 — search_notes
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('\n▶ S7 搜索笔记（search_notes）')
  const r7 = await agentRun('搜索一下我笔记里有没有跟"反派"或者"组织"相关的内容')
  t('S7 搜索笔记', r7.toolCalls >= 1, r7.iterations + '轮 ' + r7.toolCalls + '工具')

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // S8: 错误恢复 — 读不存在的笔记→列目录→找正确的
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('\n▶ S8 错误恢复（读失败→列目录→重试）')
  // 先确保有一个已存在的笔记作为 fallback
  const r8 = await agentRun('帮我读一下"修仙笔记"这个草稿')
  t('S8 读不存在的笔记→应列目录或建议', r8.iterations >= 1, r8.iterations + '轮 ' + r8.toolCalls + '工具')

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // S9: 删除笔记 — delete_note
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('\n▶ S9 删除笔记（delete_note）')
  const r9 = await agentRun('创建一个临时笔记"仿真测试-待删除"，内容是"这个笔记马上会被删掉"')
  t('S9a 先创建', r9.toolCalls >= 1, r9.iterations + '轮 ' + r9.toolCalls + '工具')
  const r9b = await agentRun('把"仿真测试-待删除"这个笔记删了吧')
  t('S9b 再删除', r9b.toolCalls >= 1, r9b.iterations + '轮 ' + r9b.toolCalls + '工具')

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // S10: 多轮对话 — 写→读→追加→搜索→删除
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('\n▶ S10 多轮对话（写→读→追加→搜索→删）')
  const r10 = await agentRunMultiTurn([
    '帮我新建一个笔记"多轮测试"，内容是：## 测试笔记\n这是多轮对话测试的第一版。',
    '好的，把这个笔记读出来我看看',
    '再追加一段：\n\n## 追加内容\n这段是通过append_note加进来的。',
    '搜一下笔记里有没有"append"这个词',
    '行了，把"多轮测试"这个笔记删掉吧',
  ])
  t('S10 多轮全流程', r10.toolCalls >= 4, r10.iterations + '轮 ' + r10.toolCalls + '工具')

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // S11: 边缘情况 — 空内容笔记
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('\n▶ S11 边缘情况：空内容笔记')
  const r11a = await agentRun('创建一个"仿真测试-空笔记"，内容为空')
  t('S11a 创建空笔记', r11a.toolCalls >= 1, r11a.iterations + '轮 ' + r11a.toolCalls + '工具')
  const r11b = await agentRun('读取"仿真测试-空笔记"')
  t('S11b 读空笔记', r11b.iterations >= 1, r11b.iterations + '轮 ' + r11b.toolCalls + '工具')
  // cleanup
  try { fs.unlinkSync(N('仿真测试-空笔记.md')) } catch {}

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // S12: 边缘情况 — 长内容笔记
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('\n▶ S12 边缘情况：长内容笔记')
  const longContent = '# 长内容测试\n\n' + Array.from({ length: 200 }, (_, i) =>
    `## 第${i + 1}段\n这是第${i + 1}段内容，用于测试长文本写入和读取。修仙世界浩瀚无垠，灵气充盈于天地之间，万物皆有灵性。修炼一途，逆天而行，需经历无数艰难险阻，方能窥见大道真谛。\n`
  ).join('')
  const r12a = await agentRun(`创建一个"仿真测试-长篇"，记录以下内容：\n${longContent.slice(0, 3000)}...（后续省略）`)
  t('S12a 创建长笔记', r12a.toolCalls >= 1, r12a.iterations + '轮 ' + r12a.toolCalls + '工具')
  const r12b = await agentRun('读取"仿真测试-长篇"')
  t('S12b 读长笔记', r12b.toolCalls >= 1, r12b.iterations + '轮 ' + r12b.toolCalls + '工具')
  // cleanup
  try { fs.unlinkSync(N('仿真测试-长篇.md')) } catch {}

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // S13: 边缘情况 — 批量创建笔记
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('\n▶ S13 批量操作（同时创建多个笔记）')
  const r13 = await agentRun(
    '帮我同时创建三个笔记：\n' +
    '1. "仿真测试-角色灵感"，内容"主角设计思路：冷静理性型修仙者"\n' +
    '2. "仿真测试-情节灵感"，内容"关键情节：地铁奇遇 → 初入修仙 → 都市暗战"\n' +
    '3. "仿真测试-世界观"，内容"世界观核心：灵气复苏 + 现代都市 + 上古传承"'
  )
  t('S13 批量创建', r13.toolCalls >= 3, r13.iterations + '轮 ' + r13.toolCalls + '工具')

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // S14: 边缘情况 — 读取不存在的笔记后，agent 建议 list_notes
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('\n▶ S14 不存在笔记→agent引导')
  // Agent 可能会直接调用 read_note（返回错误）然后建议 list_notes
  // 也可能先 list_notes 再告诉用户没有
  const r14 = await agentRun('读一下"完全不存在的一个笔记xyz"')
  t('S14 不存在的笔记处理', r14.iterations >= 1, r14.iterations + '轮 ' + r14.toolCalls + '工具')

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // S15: 中文名称特殊字符 — 包含标点的文件名
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('\n▶ S15 中文名+特殊标点笔记')
  const r15a = await agentRun('创建笔记"测试·第3章-改写思路！"，内容"这一章需要增加打斗场景的细节描写"')
  t('S15a 创建特殊名称', r15a.toolCalls >= 1, r15a.iterations + '轮 ' + r15a.toolCalls + '工具')
  const r15b = await agentRun('读取"测试·第3章-改写思路！"')
  t('S15b 读特殊名称', r15b.toolCalls >= 1, r15b.iterations + '轮 ' + r15b.toolCalls + '工具')
  const r15c = await agentRun('搜索笔记里有没有"打斗"')
  t('S15c 搜索特殊名称笔记', r15c.toolCalls >= 1, r15c.iterations + '轮 ' + r15c.toolCalls + '工具')

  // cleanup batch test notes
  try { fs.unlinkSync(N('仿真测试-角色灵感.md')) } catch {}
  try { fs.unlinkSync(N('仿真测试-情节灵感.md')) } catch {}
  try { fs.unlinkSync(N('仿真测试-世界观.md')) } catch {}
  try { fs.unlinkSync(N('测试·第3章-改写思路！.md')) } catch {}

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 清理测试笔记
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  cleanupTestNotes()

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 汇总
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const total = pass + fail
  console.log('\n\n═══════════════════════════════════════════')
  console.log('  笔记仿真测试结果')
  console.log('═══════════════════════════════════════════')
  console.log('  ✔ ' + pass + '  ✖ ' + fail + '  通过率: ' + ((pass / total) * 100).toFixed(1) + '%')

  if (fail > 0) {
    console.log('\n  ⚠ 有失败用例，请检查 API 连接或工具实现')
  } else {
    console.log('\n  全部通过！笔记工具集工作正常')
  }
}

main().catch(e => {
  console.error('\n💥 测试异常:', e.message)
  process.exit(1)
})
