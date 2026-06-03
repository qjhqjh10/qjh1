#!/usr/bin/env node
/**
 * 仿真测试: 大纲Tab
 * 模拟用户打开AI写作助手，对大纲Tab结构化数据（items/locations/factions）进行真实对话操作。
 *
 * 测试场景覆盖:
 *   - 查看道具/地点/势力列表（read_file）
 *   - 添加新道具到JSON数组（read_file → edit_file）
 *   - 修改地点描述（read_file → edit_file）
 *   - 文件路径错误→搜索→重试（错误恢复）
 *   - 组合查询（多文件读取）
 *
 * 运行: node scripts/full-sim/06-outline-tabs.mjs
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

// ── 配置 ──
const API_KEY = process.env.AI_API_KEY || 'sk-c9c30831df7243209435c60e811c879d'
const API_URL = 'https://api.deepseek.com/v1/chat/completions'
const MODEL = 'deepseek-v4-flash'
const MAX_ITERATIONS = 10
const ROOT = process.cwd()

const P = p => path.join(ROOT, 'projects', p)
const N = p => path.join(ROOT, 'notes', p)
const K = p => path.join(ROOT, 'knowledge_base/files', p)

// ── 工具实现 ──
const tools = {
  read_file: a => {
    try {
      let fp = a.file_path || a.path || ''
      const fullPath = P(fp)
      const c = fs.readFileSync(fullPath, 'utf-8')
      // JSON 文件：返回完整内容以便后续编辑
      if (fp.endsWith('.json')) {
        return c.length > 4000
          ? c.slice(0, 4000) + '\n…(共' + c.length + '字，已截断)'
          : c
      }
      return c.length > 2000
        ? c.slice(0, 2000) + '\n…(共' + c.length + '字)'
        : c
    } catch (e) {
      return `[错误: 文件不存在或无法读取 — ${(a.file_path || a.path)}]`
    }
  },

  list_directory: a => {
    try {
      const dir = a.path || '.'
      const fp = P(dir)
      const e = fs.readdirSync(fp, { withFileTypes: true })
      const pattern = a.pattern
      let list = e.map(x => (x.isDirectory() ? 'DIR ' : 'FILE ') + x.name)
      if (pattern) {
        const re = new RegExp(pattern.replace(/\*/g, '.*').replace(/\?/g, '.'))
        list = list.filter(f => re.test(f))
      }
      return list.join('\n') || '空目录'
    } catch (e) {
      return `[错误: 目录不存在 — ${a.path || '.'}]`
    }
  },

  search_content: a => {
    try {
      const fp = P(a.path || '.')
      const re = new RegExp(
        (a.pattern || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        'gi'
      )
      const results = []
      function searchDir(d) {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const f = path.join(d, e.name)
          if (e.isDirectory()) {
            searchDir(f)
            continue
          }
          const c = fs.readFileSync(f, 'utf-8')
          const ls = c.split('\n')
          for (let i = 0; i < ls.length; i++)
            if (re.test(ls[i]))
              results.push(
                f.replace(ROOT + '/projects/', '') +
                  ':' +
                  (i + 1) +
                  ':' +
                  ls[i].slice(0, 200)
              )
        }
      }
      if (fs.statSync(fp).isFile()) {
        const c = fs.readFileSync(fp, 'utf-8')
        const ls = c.split('\n')
        for (let i = 0; i < ls.length; i++)
          if (re.test(ls[i]))
            results.push(
              (a.path || '') + ':' + (i + 1) + ':' + ls[i].slice(0, 200)
            )
      } else searchDir(fp)
      return (
        results.slice(0, 15).join('\n') ||
        '无匹配 — 请确认文件路径和搜索关键词是否正确'
      )
    } catch (e) {
      return '[错误: 搜索失败 — ' + e.message + ']'
    }
  },

  edit_file: a => {
    try {
      const fp = P(a.file_path)
      let c = fs.readFileSync(fp, 'utf-8')
      const old = a.old_string || ''
      const nw = a.new_string || ''
      if (old === '__FULL_REPLACE__') {
        fs.writeFileSync(fp, nw, 'utf-8')
        return '全量替换成功'
      }
      let idx = c.indexOf(old)
      if (idx < 0) idx = c.indexOf(old.trim())
      if (idx < 0)
        return `[未找到匹配文本] 提示: 请用 read_file 确认原文后精确匹配。可尝试 __FULL_REPLACE__ 做全量替换`
      const result = c.slice(0, idx) + nw + c.slice(idx + old.length)
      fs.writeFileSync(fp, result, 'utf-8')
      return '编辑成功'
    } catch (e) {
      return `[错误: ${e.message}]`
    }
  },

  create_file: a => {
    try {
      const fp = P(a.file_path || a.path)
      const c = a.content || ''
      if (fp.endsWith('.json') && c)
        try {
          JSON.parse(c)
        } catch (e) {
          return `[JSON格式错误: ${e.message}]`
        }
      fs.mkdirSync(path.dirname(fp), { recursive: true })
      fs.writeFileSync(fp, c, 'utf-8')
      return `创建成功: ${a.file_path}`
    } catch (e) {
      return `[错误: ${e.message}]`
    }
  },

  delete_file: a => {
    try {
      fs.unlinkSync(P(a.file_path))
      return '删除成功'
    } catch (e) {
      return `[错误: ${e.message}]`
    }
  },

  kb_list: () => {
    try {
      return (
        fs
          .readdirSync(K(''))
          .filter(f => f.endsWith('.md'))
          .join('\n') || '无KB文件'
      )
    } catch {
      return '无KB文件'
    }
  },

  kb_create_file: a => {
    try {
      fs.mkdirSync(K(''), { recursive: true })
      fs.writeFileSync(K((a.name || 'x') + '.md'), a.content || '', 'utf-8')
      return 'KB创建成功'
    } catch (e) {
      return `[错误: ${e.message}]`
    }
  },

  list_notes: () => {
    try {
      fs.mkdirSync(N(''), { recursive: true })
      return (
        fs
          .readdirSync(N(''))
          .filter(f => f.endsWith('.md'))
          .join('\n') || '无笔记'
      )
    } catch {
      return '无笔记'
    }
  },

  write_note: a => {
    try {
      fs.mkdirSync(N(''), { recursive: true })
      fs.writeFileSync(N((a.name || 'x') + '.md'), a.content || '', 'utf-8')
      return '笔记创建成功'
    } catch (e) {
      return `[错误: ${e.message}]`
    }
  },

  read_note: a => {
    try {
      return fs.readFileSync(N((a.name || 'x') + '.md'), 'utf-8').slice(0, 500)
    } catch {
      return '[笔记不存在]'
    }
  },

  delete_note: a => {
    try {
      fs.unlinkSync(N((a.name || 'x') + '.md'))
      return '笔记删除成功'
    } catch {
      return '[错误]'
    }
  },

  create_style_template: a => {
    try {
      const fp = path.join(
        ROOT,
        'style_templates',
        (a.name || 'x') + '.json'
      )
      fs.mkdirSync(path.dirname(fp), { recursive: true })
      fs.writeFileSync(fp, JSON.stringify(a, null, 2), 'utf-8')
      return '模板创建成功'
    } catch (e) {
      return `[错误: ${e.message}]`
    }
  },

  create_project: a => {
    try {
      const d = P(a.name)
      ;[
        'characters',
        'chapters',
        'outline',
        'detailed_outline',
        'summaries',
      ].forEach(s => fs.mkdirSync(path.join(d, s), { recursive: true }))
      return `项目${a.name}创建成功`
    } catch (e) {
      return `[错误: ${e.message}]`
    }
  },

  delete_project: a => {
    try {
      fs.rmSync(P(a.name), { recursive: true, force: true })
      return '项目删除成功'
    } catch (e) {
      return `[错误: ${e.message}]`
    }
  },

  list_prompts: () => '灵感/世界观/角色/大纲/细纲/章节/润色/续写/改写/摘要/审稿',
  list_rules: () => '暂无自定义规则',
  learn_rule: () => '规则已学习',
  list_audit: () => '暂无审计记录',
  write_learning: () => '经验已记录',
}

// ── 工具定义（OpenAI function calling 格式） ──
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: '读取项目文件内容。JSON文件返回完整内容供后续编辑。',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '文件相对路径，如 1/outline/items.yaml' },
        },
        required: ['file_path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: '列出目录内容，支持 pattern 过滤',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '目录路径' },
          pattern: { type: 'string', description: 'glob 过滤模式，如 *.json' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_content',
      description: '在项目中搜索文件内容。当文件路径不确定时，先用此工具查找。',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: '搜索关键词或模式' },
          path: { type: 'string', description: '搜索路径，如 1/outline' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: '编辑文件。先用 read_file 读取确认原文，再用 old_string 精确匹配后替换。追加JSON数组时: old_string 取末尾 "]" 前的内容，new_string 为原文+新条目。失败可尝试 __FULL_REPLACE__。',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '文件相对路径' },
          old_string: { type: 'string', description: '要替换的原文，必须逐字精确匹配' },
          new_string: { type: 'string', description: '替换后的新文本' },
        },
        required: ['file_path', 'old_string', 'new_string'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_file',
      description: '创建新文件。JSON 文件会自动校验格式。',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '文件路径' },
          content: { type: 'string', description: '文件内容' },
        },
        required: ['file_path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: '删除文件',
      parameters: {
        type: 'object',
        properties: { file_path: { type: 'string' } },
        required: ['file_path'],
      },
    },
  },
  {
    type: 'function', function: { name: 'kb_list', description: '列出知识库文件', parameters: { type: 'object', properties: {} } },
  },
  {
    type: 'function', function: { name: 'kb_create_file', description: '创建KB文件', parameters: { type: 'object', properties: { name: { type: 'string' }, content: { type: 'string' } }, required: ['name', 'content'] } },
  },
  {
    type: 'function', function: { name: 'list_notes', description: '列出所有笔记', parameters: { type: 'object', properties: {} } },
  },
  {
    type: 'function', function: { name: 'write_note', description: '创建笔记', parameters: { type: 'object', properties: { name: { type: 'string' }, content: { type: 'string' } }, required: ['name', 'content'] } },
  },
  {
    type: 'function', function: { name: 'read_note', description: '读取笔记', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  },
  {
    type: 'function', function: { name: 'delete_note', description: '删除笔记', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  },
  {
    type: 'function', function: { name: 'create_style_template', description: '创建风格模板', parameters: { type: 'object', properties: { name: { type: 'string' }, type: { type: 'string' } }, required: ['name', 'type'] } },
  },
  {
    type: 'function', function: { name: 'create_project', description: '创建项目', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  },
  {
    type: 'function', function: { name: 'delete_project', description: '删除项目', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  },
  {
    type: 'function', function: { name: 'list_prompts', description: '列出提示词', parameters: { type: 'object', properties: {} } },
  },
  {
    type: 'function', function: { name: 'list_rules', description: '列出已学习规则', parameters: { type: 'object', properties: {} } },
  },
  {
    type: 'function', function: { name: 'learn_rule', description: '学习新规则', parameters: { type: 'object', properties: { rule: { type: 'string' } }, required: ['rule'] } },
  },
  {
    type: 'function', function: { name: 'list_audit', description: '查看审计记录', parameters: { type: 'object', properties: {} } },
  },
  {
    type: 'function', function: { name: 'write_learning', description: '记录学习经验', parameters: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] } },
  },
]

// ── 系统提示词（中文，聚焦大纲Tab场景） ──
const SYS_PROMPT = [
  '你是青剑AI写作助手。你正在帮助用户管理小说项目的大纲Tab结构化数据。',
  '',
  '# 铁律：何时用工具，何时不用',
  '✅ 调工具（用户要求操作文件）: 读取/列出/搜索/创建/编辑/删除/写/保存/修改/改/看(文件)/找(文件)/添加/追加/加一个/帮我看看/查一下',
  '❌ 不调工具（纯对话）: 我是/我叫/我喜欢/我觉得/你好/嗨/谢谢/什么是/为什么/怎么/推荐/建议',
  '',
  '# 大纲Tab JSON 格式规范',
  '',
  '## items.json — 道具/物品',
  '{"items":[{"id":"item-N","name":"道具名","type":"武器|法宝|丹药|功法|道具|其他","grade":"","ability":"能力描述","owner":"归属者","description":"描述"}]}',
  '',
  '## locations.json — 地点/场景',
  '{"locations":[{"id":"loc-N","name":"地点名","type":"门派|城池|秘境|自然|公共建筑|私人空间|户外场所|世界边界|科研设施|创作空间","description":"地点描述"}]}',
  '',
  '## factions.json — 势力/组织',
  '{"factions":[{"id":"faction-N","name":"势力名","type":"正道|邪道|中立|皇朝|学生组织|体育社团|兴趣社团|学术单位|科研团队|其他","description":"势力描述"}]}',
  '',
  '## power_system.json — 能力等级体系',
  '{"name":"体系名","levels":[{"name":"阶段名","description":"描述"}],"description":"体系总述"}',
  '',
  '## outline_meta.json — 伏笔与故事线',
  '{"foreshadowing":[{"id":"fs-N","description":"","plantChapterId":"","payoffChapterId":"","status":"planted|resolved"}],"plotThreads":[{"id":"thread-N","name":"","type":"main|sub|hidden","color":"#hex","chapterIds":[]}]}',
  '',
  '## emotion.json — 情绪曲线',
  '{"segments":[{"chapterStart":1,"chapterEnd":1,"dominantEmotion":"情绪名"}]}',
  '',
  '# 执行规则',
  '- 已知路径直接读文件，不列目录。修改前先读。只做用户要求的，不多做。回复简洁。',
  '- 多个独立操作可在同一轮并行完成。有依赖的操作分轮执行。',
  '- 读取JSON文件后，只输出关键摘要（如道具列表：名字+类型），不输出完整JSON原文。',
  '',
  '# JSON数组追加方法',
  '在已有的JSON数组末尾追加新条目:',
  '1. read_file 读取整个JSON文件',
  '2. edit_file: old_string = 最后一个条目的 "}" 到 "]" 之间的内容（含 "]"）',
  '   new_string = 最后一个条目 + 逗号 + 新条目 + "] "',
  '   或者: old_string = "]" (数组结束符), new_string = ",{新条目}" + "]"',
  '3. 如果 edit_file 匹配失败（返回"[未找到匹配文本]"），可以用 __FULL_REPLACE__ 模式做全量替换',
  '',
  '# 文件路径速查',
  '- 道具: 1/outline/items.yaml',
  '- 地点: 1/outline/locations.yaml',
  '- 势力: 1/outline/factions.yaml',
  '- 等级: 1/outline/power_system.yaml',
  '- 伏笔: 1/outline/outline_meta.yaml',
  '- 情绪: 1/outline/emotion.yaml',
  '- 大纲: 1/outline/plot.md, 1/outline/worldbuilding.md',
  '- 角色: 1/characters/{中文名}.yaml',
  '- 章节: 1/chapters/chapter{N}.txt',
].join('\n')

// ── OpenAI API 调用 ──
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
      Authorization: 'Bearer ' + API_KEY,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok)
    throw new Error(
      'HTTP ' + res.status + ': ' + (await res.text()).slice(0, 200)
    )
  const json = await res.json()
  const choice = json.choices[0]
  return {
    text: choice.message?.content || '',
    toolCalls: choice.message?.tool_calls || [],
    finishReason: choice.finish_reason || 'stop',
    usage: json.usage,
  }
}

// ── Agent 主循环 ──
async function agentRun(userMsg) {
  const messages = [
    { role: 'system', content: SYS_PROMPT },
    { role: 'user', content: userMsg },
  ]
  let iterations = 0,
    totalTools = 0,
    fullText = ''
  const toolTrace = []

  while (iterations < MAX_ITERATIONS) {
    iterations++
    process.stdout.write(`[iter${iterations}] `)
    const r = await callOpenAI(messages)
    if (r.text) fullText = r.text

    if (!r.toolCalls.length) {
      // 输出AI文本回复的前150字
      if (r.text) {
        const preview =
          r.text.length > 150 ? r.text.slice(0, 150) + '...' : r.text
        process.stdout.write('💬' + preview.replace(/\n/g, ' ') + '\n')
      }
      return { text: fullText, iterations, toolCalls: totalTools, toolTrace }
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
      try {
        args = JSON.parse(fn.arguments)
      } catch {
        args = {}
      }
      const result = toolFn ? await toolFn(args) : '[未知工具]'
      totalTools++
      const isError =
        typeof result === 'string' &&
        (result.startsWith('[') || result === '[未知工具]')
      const marker = isError ? '✗' : '✓'
      process.stdout.write(fn.name + marker + ' ')
      toolTrace.push({
        iteration: iterations,
        tool: fn.name,
        file: args.file_path || args.path || '',
        success: !isError,
        resultPreview: (result || '').slice(0, 80),
      })
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: result,
      })
    }
    process.stdout.write('\n')
  }
  return { text: fullText, iterations, toolCalls: totalTools, toolTrace }
}

// ── 测试辅助 ──
let pass = 0,
  fail = 0
function t(name, cond, detail) {
  if (cond) {
    pass++
    console.log('  ✅ ' + name + (detail ? ': ' + detail : ''))
  } else {
    fail++
    console.log('  ❌ ' + name + (detail ? ': ' + detail : ''))
  }
}

// ── 面包屑（便捷的路径确认） ──
function ensureFiles() {
  const required = [
    '1/outline/items.yaml',
    '1/outline/locations.yaml',
    '1/outline/factions.yaml',
  ]
  const missing = []
  for (const f of required) {
    if (!fs.existsSync(P(f))) missing.push(f)
  }
  if (missing.length) {
    console.log(
      '⚠️  以下文件不存在，测试可能失败: ' + missing.join(', ')
    )
    console.log('   请确保在项目根目录运行：cd novel-writing-app && node scripts/full-sim/06-outline-tabs.mjs\n')
  }
}

// ── 打印结果摘要 ──
function printTrace(label, trace) {
  if (!trace || !trace.length) return
  console.log(`  📋 ${label}调用记录:`)
  for (const t of trace) {
    const icon = t.success ? '✓' : '✗'
    const file = t.file ? ` → ${t.file}` : ''
    console.log(`    轮${t.iteration} ${icon} ${t.tool}${file}`)
  }
}

// ── 主测试流程 ──
async function main() {
  console.log('═══════════════════════════════════════════')
  console.log('  大纲Tab 仿真测试')
  console.log('  端点: ' + API_URL + '  模型: ' + MODEL)
  console.log('  场景: items.json / locations.json / factions.json')
  console.log('═══════════════════════════════════════════\n')

  ensureFiles()

  // ══════════════════════════════════════════
  // S1: 查看道具列表（单工具: read_file）
  // ══════════════════════════════════════════
  console.log('▶ S1 查看道具列表')
  const r1 = await agentRun('帮我看看现在都有哪些道具和物品')
  t(
    'S1 调用了 read_file',
    r1.toolTrace.some(x => x.tool === 'read_file' && x.file.includes('items')),
    r1.iterations + '轮 ' + r1.toolCalls + '工具'
  )
  t(
    'S1 返回了文本摘要',
    r1.text.length > 10,
    '回复长度: ' + r1.text.length + '字'
  )

  // ══════════════════════════════════════════
  // S2: 添加新道具（2工具: read_file + edit_file，至少1轮）
  // ══════════════════════════════════════════
  console.log('\n▶ S2 添加新道具')
  const r2 = await agentRun(
    '加个新道具呗，叫「灵力探测镜」，类型是法宝，等级地阶，能力是可以探测周围500米内的灵力波动和异常能量源，归属张明，描述是"一副古铜色的单片眼镜，镜片上偶尔闪过淡蓝色的符文流光"'
  )
  t(
    'S2 调用了 read_file',
    r2.toolTrace.some(x => x.tool === 'read_file' && x.file.includes('items')),
    r2.iterations + '轮'
  )
  t(
    'S2 调用了 edit_file 或 create_file',
    r2.toolTrace.some(
      x => x.tool === 'edit_file' || x.tool === 'create_file'
    ),
    r2.toolCalls + '工具'
  )
  t(
    'S2 有持续对话（≥2轮或≥2工具）',
    r2.toolCalls >= 2 || r2.iterations >= 2,
    r2.iterations + '轮 ' + r2.toolCalls + '工具'
  )
  printTrace('S2', r2.toolTrace)

  // ══════════════════════════════════════════
  // S3: 查看地点列表（单工具: read_file）
  // ══════════════════════════════════════════
  console.log('\n▶ S3 查看地点列表')
  const r3 = await agentRun('那再看看都有哪些地点场景？简单列一下就行')
  t(
    'S3 调用了 read_file (locations.json)',
    r3.toolTrace.some(
      x => x.tool === 'read_file' && x.file.includes('locations')
    ),
    r3.iterations + '轮 ' + r3.toolCalls + '工具'
  )
  t(
    'S3 返回了文本摘要',
    r3.text.length > 10,
    '回复: ' + r3.text.slice(0, 80).replace(/\n/g, ' ')
  )

  // ══════════════════════════════════════════
  // S4: 修改势力描述（read_file + edit_file）
  // ══════════════════════════════════════════
  console.log('\n▶ S4 查看并修改势力')
  const r4 = await agentRun(
    '看下势力列表，然后把学生会的描述改一下，在后面加上一句："近期学生会换届后，新任会长推行了一系列改革，在学生群体中的话语权显著增强。"'
  )
  t(
    'S4 调用了 read_file (factions.json)',
    r4.toolTrace.some(
      x => x.tool === 'read_file' && x.file.includes('factions')
    ),
    r4.iterations + '轮'
  )
  t(
    'S4-改 调用了 edit_file',
    r4.toolTrace.some(x => x.tool === 'edit_file'),
    r4.toolCalls + '工具'
  )
  printTrace('S4', r4.toolTrace)

  // ══════════════════════════════════════════
  // S5: 文件路径错误 → 搜索 → 重试
  // ══════════════════════════════════════════
  console.log('\n▶ S5 错误恢复：文件路径不存在 → 搜索纠正')
  const r5 = await agentRun(
    '帮我看一下 1/outline/item.json 有哪些东西'
  )
  t(
    'S5 至少尝试了读文件或搜索',
    r5.toolCalls >= 1,
    r5.iterations + '轮 ' + r5.toolCalls + '工具'
  )
  // 检查是否有多步（先失败→再尝试正确路径）
  const hasSearchOrRetry =
    r5.toolTrace.some(x => x.tool === 'search_content') ||
    r5.toolTrace.some(
      x => x.tool === 'read_file' && x.file.includes('items.json')
    ) ||
    r5.toolTrace.some(
      x => x.tool === 'list_directory'
    )
  t(
    'S5 有纠错行为（搜索/列目录/重试正确路径）',
    hasSearchOrRetry || r5.toolCalls >= 2,
    '工具: ' + r5.toolTrace.map(x => x.tool).join(', ')
  )
  t(
    'S5 最终返回了有意义的回复',
    r5.text.length > 20,
    '回复: ' + r5.text.slice(0, 80).replace(/\n/g, ' ')
  )
  printTrace('S5', r5.toolTrace)

  // ══════════════════════════════════════════
  // S6: 组合查询 — 同时看两个文件
  // ══════════════════════════════════════════
  console.log('\n▶ S6 组合查询：道具 + 势力')
  const r6 = await agentRun(
    '帮我把道具列表和势力列表都看一下，然后给我做个简要对比——道具多还是势力多？'
  )
  t(
    'S6 至少调用了2次 read_file',
    r6.toolTrace.filter(x => x.tool === 'read_file').length >= 2,
    r6.iterations + '轮 ' + r6.toolCalls + '工具'
  )
  t(
    'S6 返回了对比分析',
    r6.text.length > 20,
    '回复: ' + r6.text.slice(0, 100).replace(/\n/g, ' ')
  )
  printTrace('S6', r6.toolTrace)

  // ══════════════════════════════════════════
  // S7: 多轮对话 — 用户纠正/追加
  // ══════════════════════════════════════════
  console.log('\n▶ S7 连续对话: 追加 → 纠正')
  // 第七轮是同一个 conversation 中的两段用户输入
  // 为简单起见，这里用两个独立的 agentRun 模拟"好的，继续"模式
  // 第一个请求: 添加一个地点
  const r7a = await agentRun(
    '加一个新地点，叫「废弃钟楼」，类型是公共建筑，描述是"校园西北角一座被藤蔓覆盖的老旧钟楼，钟面早已停摆，定格在11:15。钟楼内部堆积着几十年的灰尘和旧试卷。"'
  )
  t(
    'S7a 添加地点（read+edit）',
    r7a.toolCalls >= 2,
    '工具: ' + r7a.toolTrace.map(x => x.tool).join(', ')
  )

  // 第二个请求: 纠正上一个操作（把"废弃钟楼"改成"古钟楼"）
  const r7b = await agentRun(
    '等等不对，把刚才加的废弃钟楼的名字改成「古钟楼」，等级加个"史诗级"标签'
  )
  t(
    'S7b 纠正操作（read+edit）',
    r7b.toolCalls >= 2 || r7b.toolTrace.some(x => x.tool === 'edit_file'),
    '工具: ' + r7b.toolTrace.map(x => x.tool).join(', ')
  )

  // ══════════════════════════════════════════
  // 汇总
  // ══════════════════════════════════════════
  const total = pass + fail
  const rate = total > 0 ? ((pass / total) * 100).toFixed(1) : 'N/A'
  console.log('\n\n═══════════════════════════════════════════')
  console.log('  大纲Tab 仿真测试结果')
  console.log('═══════════════════════════════════════════')
  console.log('  ✅ ' + pass + '  ❌ ' + fail + '  通过率: ' + rate + '%')
  console.log('  测试场景: 7 个（查看/添加/修改/纠错/组合/多轮）')
  console.log('  核心工具: read_file, edit_file')
  console.log('═══════════════════════════════════════════\n')

  // 详细通过/失败列表
  console.log('详细结果:')
  for (const r of [r1, r2, r3, r4, r5, r6, r7a, r7b]) {
    // 这些结果已在上方通过 t() 输出
  }
  console.log('')

  if (fail > 0) process.exitCode = 1
}

main().catch(e => {
  console.error('\n💥 测试异常: ' + e.message)
  if (e.stack) console.error(e.stack.split('\n').slice(0, 5).join('\n'))
  process.exit(1)
})
