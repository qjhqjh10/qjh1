#!/usr/bin/env node
/**
 * 仿真测试: 闲聊 (01-chat)
 * 模拟用户打开AI写作助手，进行纯对话交互 — CHAT模式，零工具调用。
 *
 * 场景: 用户与青剑AI助手闲聊，不涉及任何文件操作。
 * 验证: AI在纯对话场景下正确识别无需调用工具，给出自然中文回复。
 *
 * 复杂度: 简单 — 1-3轮对话, 0个工具调用
 * 工具覆盖: 无 (本场景验证零工具场景下的行为正确性)
 *
 * 运行: node scripts/full-sim/01-chat.mjs
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

// ── 路径辅助函数 ──
const P = p => path.join(ROOT, 'projects', p)
const N = p => path.join(ROOT, 'notes', p)
const K = p => path.join(ROOT, 'knowledge_base', 'files', p)

// ═══════════════════════════════════════════════════
//  工具实现 (CHAT模式只需最小实现，保证脚本可运行)
// ═══════════════════════════════════════════════════
const tools = {
  // ── 核心文件工具 (最小实现) ──
  read_file: a => {
    try {
      const fp = a.file_path || a.path || ''
      const c = fs.readFileSync(P(fp), 'utf-8')
      return c.length > 2000 ? c.slice(0, 2000) + '\n…(' + c.length + '字)' : c
    } catch (e) {
      return `[错误: 文件不存在]`
    }
  },

  list_directory: a => {
    try {
      const dir = a.path || a.dir_path || '.'
      const e = fs.readdirSync(P(dir), { withFileTypes: true })
      return e.map(x => (x.isDirectory() ? 'DIR ' : 'FILE ') + x.name).join('\n')
    } catch (e) {
      return `[错误: 目录不存在]`
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
      return '[错误]'
    }
  },

  // ── 其他Harness工具 (存根实现，保证TOOLS定义完整) ──
  create_file: a => {
    try {
      const fp = P(a.file_path || a.path)
      const c = a.content || ''
      if (fp.endsWith('.json') && c) {
        try { JSON.parse(c) } catch (e) { return `[JSON格式错误: ${e.message}]` }
      }
      fs.mkdirSync(path.dirname(fp), { recursive: true })
      fs.writeFileSync(fp, c)
      return `创建成功: ${a.file_path}`
    } catch (e) { return `[错误: ${e.message}]` }
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
      if (idx < 0) return `[未找到匹配文本]`
      fs.writeFileSync(fp, c.slice(0, idx) + nw + c.slice(idx + old.length))
      return '编辑成功'
    } catch (e) { return `[错误: ${e.message}]` }
  },

  delete_file: a => {
    try { fs.unlinkSync(P(a.file_path)); return '删除成功' } catch { return '[错误]' }
  },

  kb_list: () => {
    try {
      return fs.readdirSync(K('')).filter(f => f.endsWith('.md')).join('\n') || '无KB文件'
    } catch { return '无KB文件' }
  },

  kb_create_file: a => {
    try {
      fs.mkdirSync(K(''), { recursive: true })
      fs.writeFileSync(K((a.name || 'x') + '.md'), a.content || '')
      return 'KB创建成功'
    } catch { return '[错误]' }
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
      fs.writeFileSync(N((a.name || 'x') + '.md'), a.content || '')
      return '笔记创建成功'
    } catch { return '[错误]' }
  },

  read_note: a => {
    try { return fs.readFileSync(N((a.name || 'x') + '.md'), 'utf-8').slice(0, 500) } catch { return '[笔记不存在]' }
  },

  delete_note: a => {
    try { fs.unlinkSync(N((a.name || 'x') + '.md')); return '笔记删除成功' } catch { return '[错误]' }
  },

  create_style_template: a => {
    try {
      const fp = path.join(ROOT, 'style_templates', (a.name || 'x') + '.json')
      fs.mkdirSync(path.dirname(fp), { recursive: true })
      fs.writeFileSync(fp, JSON.stringify(a, null, 2))
      return '模板创建成功'
    } catch { return '[错误]' }
  },

  create_project: a => {
    try {
      const d = P(a.name)
      ;['characters', 'chapters', 'outline', 'detailed_outline', 'summaries'].forEach(
        s => fs.mkdirSync(path.join(d, s), { recursive: true })
      )
      return `项目${a.name}创建成功`
    } catch { return '[错误]' }
  },

  delete_project: a => {
    try {
      fs.rmSync(P(a.name), { recursive: true, force: true })
      return '项目删除成功'
    } catch { return '[错误]' }
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
  { type: 'function', function: { name: 'read_file', description: '读取项目文件', parameters: { type: 'object', properties: { file_path: { type: 'string', description: '文件相对路径' } }, required: ['file_path'] } } },
  { type: 'function', function: { name: 'list_directory', description: '列出目录内容', parameters: { type: 'object', properties: { path: { type: 'string', description: '目录路径' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'search_content', description: '搜索文件内容', parameters: { type: 'object', properties: { pattern: { type: 'string', description: '搜索关键词' }, path: { type: 'string', description: '搜索路径' } }, required: ['pattern'] } } },
  { type: 'function', function: { name: 'create_file', description: '创建新文件。JSON自动校验。', parameters: { type: 'object', properties: { file_path: { type: 'string' }, content: { type: 'string' } }, required: ['file_path', 'content'] } } },
  { type: 'function', function: { name: 'edit_file', description: '编辑文件。先read_file。', parameters: { type: 'object', properties: { file_path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' } }, required: ['file_path', 'old_string', 'new_string'] } } },
  { type: 'function', function: { name: 'delete_file', description: '删除文件', parameters: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] } } },
  { type: 'function', function: { name: 'kb_list', description: '列出知识库文件', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'kb_create_file', description: '创建KB文件', parameters: { type: 'object', properties: { name: { type: 'string' }, content: { type: 'string' } }, required: ['name', 'content'] } } },
  { type: 'function', function: { name: 'list_notes', description: '列出所有笔记', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'write_note', description: '创建笔记', parameters: { type: 'object', properties: { name: { type: 'string' }, content: { type: 'string' } }, required: ['name', 'content'] } } },
  { type: 'function', function: { name: 'read_note', description: '读取笔记', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } } },
  { type: 'function', function: { name: 'delete_note', description: '删除笔记', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } } },
  { type: 'function', function: { name: 'create_style_template', description: '创建风格模板', parameters: { type: 'object', properties: { name: { type: 'string' }, type: { type: 'string' } }, required: ['name', 'type'] } } },
  { type: 'function', function: { name: 'create_project', description: '创建项目', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } } },
  { type: 'function', function: { name: 'delete_project', description: '删除项目', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } } },
  { type: 'function', function: { name: 'list_prompts', description: '列出提示词', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'list_rules', description: '列出已学习规则', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'learn_rule', description: '学习新规则', parameters: { type: 'object', properties: { rule: { type: 'string' } }, required: ['rule'] } } },
  { type: 'function', function: { name: 'list_audit', description: '查看审计记录', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'write_learning', description: '记录学习经验', parameters: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] } } },
]

// ═══════════════════════════════════════════════════
//  系统提示词 (与真实Harness一致)
// ═══════════════════════════════════════════════════
const SYS = [
  '你是青剑AI写作助手，一个专业的AI小说创作辅助工具。',
  '',
  '# 铁律：何时用工具，何时不用',
  '✅ 调工具（用户要求操作文件）: 读取/列出/搜索/创建/编辑/删除/写/保存/修改/改/看(文件)/找(文件)',
  '❌ 不调工具（纯对话）: 我是/我叫/我喜欢/我觉得/你好/嗨/谢谢/什么是/为什么/怎么/推荐/建议/告诉我/聊天/闲聊/打招呼/问候/问问/请教',
  '',
  '# 对话风格',
  '- 用中文回复，语气自然亲切，像朋友聊天。',
  '- 用户提到写作问题时，给出具体、实用的建议。',
  '- 回复简洁有力，不要啰嗦。如果是闲聊，保持轻松愉快的语调。',
  '',
  '# 执行规则',
  '- 已知路径直接读文件，不列目录。修改前先读。只做用户要求的，不多做。',
  '- 多个独立操作可在同一轮并行完成。有依赖的操作分轮执行。',
  '- **关键**: 用户只是在聊天/问候/表达感受/询问建议时，绝对不要调用任何工具，直接用文字回复。',
  '',
  '# 路径',
  '角色: 1/characters/中文名.yaml  章节: 1/chapters/chapterN.txt',
  '细纲: 1/detailed_outline/chapterN.yaml  大纲: 1/outline/plot.md',
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
//  Agent 运行循环 (单轮对话)
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
      try { args = JSON.parse(fn.arguments) } catch {}

      const result = toolFn ? await toolFn(args) : '[未知工具]'
      const ok = result.startsWith && !result.startsWith('[')
      const icon = ok ? '✓' : '✗'
      totalTools++

      process.stdout.write(`${fn.name}${icon} `)
      toolLog.push({ name: fn.name, ok, args, result: result.slice(0, 100) })

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
//  多轮对话运行 (模拟真实用户的多轮交互)
// ═══════════════════════════════════════════════════
async function multiTurnRun(userMessages) {
  const messages = [{ role: 'system', content: SYS }]
  let totalIterations = 0
  let totalTools = 0
  const allTexts = []
  const allUsages = []
  const toolCallNames = []

  for (let turnIdx = 0; turnIdx < userMessages.length; turnIdx++) {
    const userMsg = userMessages[turnIdx]
    messages.push({ role: 'user', content: userMsg })
    process.stdout.write(
      `  [轮${turnIdx + 1}] "${userMsg.slice(0, 40)}${userMsg.length > 40 ? '...' : ''}" `
    )

    let turnIterations = 0
    while (turnIterations < MAX_ITERATIONS) {
      turnIterations++
      totalIterations++
      const r = await callOpenAI(messages)
      if (r.text) allTexts.push(r.text)
      if (r.usage) allUsages.push(r.usage)

      if (!r.toolCalls.length) {
        process.stdout.write(
          `→ ${r.text.slice(0, 60)}${r.text.length > 60 ? '...' : ''}\n`
        )
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
        toolCallNames.push(fn.name)
        process.stdout.write(
          fn.name + (result.startsWith && result.startsWith('[') ? '✗' : '✓') + ' '
        )
        messages.push({ role: 'tool', tool_call_id: tc.id, content: result })
      }
      process.stdout.write('\n')
    }
  }

  return {
    text: allTexts[allTexts.length - 1] || '',
    allTexts,
    iterations: totalIterations,
    toolCalls: totalTools,
    toolCallNames,
    totalTokens: allUsages.reduce((s, u) => s + (u.total_tokens || 0), 0),
  }
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

/**
 * 验证回复是否为有意义的中文文本
 * @param {string} text - AI回复文本
 * @param {number} minLen - 最低字符数
 * @returns {boolean}
 */
function isChinese(text) {
  return /[一-鿿]/.test(text)
}

/**
 * 打印分隔线
 */
function hr(title) {
  console.log('\n' + '─'.repeat(55))
  console.log('  ' + title)
  console.log('─'.repeat(55))
}

// ═══════════════════════════════════════════════════
//  主测试流程
// ═══════════════════════════════════════════════════
async function main() {
  console.log('═══════════════════════════════════════════')
  console.log('  仿真测试: 闲聊 (01-chat)')
  console.log('  端点: ' + API_URL + '  模型: ' + MODEL)
  console.log('  模式: 纯对话 CHAT — 预期零工具调用')
  console.log('═══════════════════════════════════════════')

  // ──────────────────────────────────────────────
  //  S1: 基本问候 — "你好"
  // ──────────────────────────────────────────────
  hr('S1 基本问候')
  const r1 = await agentRun('你好')
  t('S1 问候返回文本', r1.text.length > 0, r1.text.length + '字')
  t('S1 问候零工具调用', r1.toolCalls === 0, r1.toolCalls + '个工具')
  t('S1 问候1轮完成', r1.iterations === 1, r1.iterations + '轮')
  t('S1 回复含中文', isChinese(r1.text), '包含中文字符')
  console.log('    回复: ' + r1.text.slice(0, 120))

  // ──────────────────────────────────────────────
  //  S2: 自我介绍 — "我是写小说的..."
  // ──────────────────────────────────────────────
  hr('S2 自我介绍')
  const r2 = await agentRun('我是写小说的，今天刚开始用这个软件')
  t('S2 介绍返回文本', r2.text.length > 0, r2.text.length + '字')
  t('S2 介绍零工具调用', r2.toolCalls === 0, r2.toolCalls + '个工具')
  t('S2 介绍1轮完成', r2.iterations === 1, r2.iterations + '轮')
  t('S2 回复含中文', isChinese(r2.text), '包含中文字符')
  t('S2 回复有实质内容', r2.text.length >= 15, '至少15字有意义回复')
  console.log('    回复: ' + r2.text.slice(0, 150))

  // ──────────────────────────────────────────────
  //  S3: 询问观点 — "你觉得修仙小说还能火多久"
  // ──────────────────────────────────────────────
  hr('S3 询问观点')
  const r3 = await agentRun('你觉得修仙小说还能火多久')
  t('S3 观点返回文本', r3.text.length > 0, r3.text.length + '字')
  t('S3 观点零工具调用', r3.toolCalls === 0, r3.toolCalls + '个工具')
  t('S3 观点1轮完成', r3.iterations === 1, r3.iterations + '轮')
  t('S3 回复含中文', isChinese(r3.text), '包含中文字符')
  t('S3 回复内容相关', /修仙|小说|火|题材|趋势/.test(r3.text), '与修仙或小说话题相关')
  console.log('    回复: ' + r3.text.slice(0, 150))

  // ──────────────────────────────────────────────
  //  S4: 轻松闲聊 — "今天心情不错..."
  // ──────────────────────────────────────────────
  hr('S4 轻松闲聊')
  const r4 = await agentRun('今天心情不错，我想写点轻松的东西')
  t('S4 闲聊返回文本', r4.text.length > 0, r4.text.length + '字')
  t('S4 闲聊零工具调用', r4.toolCalls === 0, r4.toolCalls + '个工具')
  t('S4 闲聊1轮完成', r4.iterations === 1, r4.iterations + '轮')
  t('S4 回复含中文', isChinese(r4.text), '包含中文字符')
  console.log('    回复: ' + r4.text.slice(0, 150))

  // ──────────────────────────────────────────────
  //  S5: 寻求建议 — "古风言情和现代都市..."
  // ──────────────────────────────────────────────
  hr('S5 寻求写作建议')
  const r5 = await agentRun('古风言情和现代都市，哪个更适合新手')
  t('S5 建议返回文本', r5.text.length > 0, r5.text.length + '字')
  t('S5 建议零工具调用', r5.toolCalls === 0, r5.toolCalls + '个工具')
  t('S5 建议1轮完成', r5.iterations === 1, r5.iterations + '轮')
  t('S5 回复含中文', isChinese(r5.text), '包含中文字符')
  t('S5 回复有实质建议', r5.text.length >= 30, '至少30字有意义的建议')
  console.log('    回复: ' + r5.text.slice(0, 150))

  // ──────────────────────────────────────────────
  //  S6: 多轮对话 — 你好→我想写小说→有什么建议
  // ──────────────────────────────────────────────
  hr('S6 多轮对话 (3轮连续)')
  const chatFlow = [
    '你好',
    '我想写小说',
    '有什么建议吗',
  ]
  const r6 = await multiTurnRun(chatFlow)
  t('S6 多轮全部完成', r6.allTexts.length === chatFlow.length,
    `${r6.allTexts.length}/${chatFlow.length}轮有回复`)
  t('S6 多轮零工具调用', r6.toolCalls === 0,
    `全程${r6.toolCalls}个工具调用`)
  t('S6 每轮均有文本', r6.allTexts.every(tx => tx.length > 0),
    `最少${Math.min(...r6.allTexts.map(t => t.length))}字`)
  t('S6 每轮均含中文', r6.allTexts.every(tx => isChinese(tx)), '全部包含中文')
  t('S6 累计Token合理', r6.totalTokens > 0, `${r6.totalTokens} tokens`)
  console.log('    总轮数: ' + chatFlow.length)
  console.log('    总工具: ' + r6.toolCalls)
  console.log('    总Token: ' + r6.totalTokens)
  for (let i = 0; i < r6.allTexts.length; i++) {
    console.log(`    轮${i + 1}: ${r6.allTexts[i].slice(0, 80)}`)
  }

  // ──────────────────────────────────────────────
  //  S7: 模糊请求 — "帮我看看" (应追问澄清)
  // ──────────────────────────────────────────────
  hr('S7 模糊请求 (应追问澄清)')
  const r7 = await agentRun('帮我看看')
  t('S7 模糊请求返回文本', r7.text.length > 0, r7.text.length + '字')
  t('S7 模糊请求零工具调用', r7.toolCalls === 0, r7.toolCalls + '个工具')
  t('S7 模糊请求1轮完成', r7.iterations === 1, r7.iterations + '轮')
  t('S7 回复含中文', isChinese(r7.text), '包含中文字符')
  // 模糊请求应该追问/澄清，而不是直接调用工具
  t('S7 回复询问澄清', /什么|哪个|哪|怎么|看看|帮助|帮|可以|需要/.test(r7.text),
    '回复中包含询问/澄清/确认的语义')
  console.log('    回复: ' + r7.text.slice(0, 150))

  // ──────────────────────────────────────────────
  //  S8: 询问软件功能 — "这个软件有什么功能"
  // ──────────────────────────────────────────────
  hr('S8 询问软件功能 (本地回复)')
  const r8 = await agentRun('这个软件有什么功能')
  t('S8 功能返回文本', r8.text.length > 0, r8.text.length + '字')
  t('S8 功能零工具调用', r8.toolCalls === 0, r8.toolCalls + '个工具')
  t('S8 功能1轮完成', r8.iterations === 1, r8.iterations + '轮')
  t('S8 回复含中文', isChinese(r8.text), '包含中文字符')
  t('S8 回复提及软件功能', /小说|写作|创作|功能|帮助|可以|角色|章节|大纲|知识库|笔记/.test(r8.text),
    '回复涉及软件功能描述')
  console.log('    回复: ' + r8.text.slice(0, 150))

  // ──────────────────────────────────────────────
  //  S9: 询问AI能力 — "你能做什么"
  // ──────────────────────────────────────────────
  hr('S9 询问AI能力 (本地回复)')
  const r9 = await agentRun('你能做什么')
  t('S9 能力返回文本', r9.text.length > 0, r9.text.length + '字')
  t('S9 能力零工具调用', r9.toolCalls === 0, r9.toolCalls + '个工具')
  t('S9 能力1轮完成', r9.iterations === 1, r9.iterations + '轮')
  t('S9 回复含中文', isChinese(r9.text), '包含中文字符')
  t('S9 回复有实质内容', r9.text.length >= 15, '至少15字')
  console.log('    回复: ' + r9.text.slice(0, 150))

  // ──────────────────────────────────────────────
  //  额外验证: 全场景零工具一致性
  // ──────────────────────────────────────────────
  hr('汇总验证: 全场景零工具调用')
  const allResults = [r1, r2, r3, r4, r5, r7, r8, r9]
  const allZeroTools = allResults.every(r => r.toolCalls === 0)
  const allSingleRound = allResults.every(r => r.iterations === 1)
  t('全部8个单轮场景零工具', allZeroTools,
    allResults.map((r, i) => `S${i + 1}:${r.toolCalls}工具`).join(' '))
  t('全部8个单轮场景1轮完成', allSingleRound,
    allResults.map((r, i) => `S${i + 1}:${r.iterations}轮`).join(' '))

  // ──────────────────────────────────────────────
  //  汇总
  // ──────────────────────────────────────────────
  const total = pass + fail
  console.log('\n')
  console.log('═══════════════════════════════════════════')
  console.log('  仿真测试: 闲聊 (01-chat) — 测试结果')
  console.log('═══════════════════════════════════════════')
  console.log('  ✅ ' + String(pass).padStart(2) + '  通过')
  console.log('  ❌ ' + String(fail).padStart(2) + '  失败')
  console.log('  通过率: ' + (total > 0 ? ((pass / total) * 100).toFixed(1) : '0.0') + '%')
  console.log('')
  console.log('  场景覆盖:')
  console.log('    S1  基本问候          — "你好"')
  console.log('    S2  自我介绍          — "我是写小说的，今天刚开始用这个软件"')
  console.log('    S3  询问观点          — "你觉得修仙小说还能火多久"')
  console.log('    S4  轻松闲聊          — "今天心情不错，我想写点轻松的东西"')
  console.log('    S5  寻求建议          — "古风言情和现代都市，哪个更适合新手"')
  console.log('    S6  多轮对话          — 3轮连续对话 (你好→我想写小说→有什么建议)')
  console.log('    S7  模糊请求          — "帮我看看" (应追问澄清)')
  console.log('    S8  询问软件功能      — "这个软件有什么功能"')
  console.log('    S9  询问AI能力        — "你能做什么"')
  console.log('═══════════════════════════════════════════')

  if (fail > 0) {
    process.exitCode = 1
  }
}

// ═══════════════════════════════════════════════════
//  入口
// ═══════════════════════════════════════════════════
main().catch(e => {
  console.error('\n💥 测试异常:', e.message)
  console.error(e.stack)
  process.exit(1)
})
