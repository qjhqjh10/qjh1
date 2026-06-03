#!/usr/bin/env node
/**
 * 仿真测试: 提示词库 (19-prompts)
 * 模拟用户打开AI写作助手，对提示词模板进行查看/切换/修改操作。
 *
 * 场景: 用户管理提示词库 — 查看所有模板、启用/关闭特定模板、修改模板内容。
 * 验证: list_prompts / toggle_prompt / update_prompt 三个工具的正确性。
 *
 * 复杂度: 简单 — 1-2轮对话, 1-3个工具调用
 * 工具覆盖: list_prompts, toggle_prompt, update_prompt
 *
 * 运行: node scripts/full-sim/19-prompts.mjs
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

const API_KEY = process.env.AI_API_KEY || 'sk-c9c30831df7243209435c60e811c879d'
const API_URL = 'https://api.deepseek.com/v1/chat/completions'
const MODEL = 'deepseek-v4-flash'
const MAX_ITERATIONS = 10
const ROOT = process.cwd()

// ═══════════════════════════════════════════════════
//  模拟提示词库数据（与真实 DEFAULT_PROMPTS 一致）
// ═══════════════════════════════════════════════════
const DEFAULT_PROMPTS = [
  {
    id: 'default_chapter',
    title: '默认章节模板',
    type: '章节',
    content: '根据以上设定和细纲，写出一章完整的小说正文。注意人物性格一致性，对话符合角色身份，描写生动具体，情节推进自然。\n\n格式要求：每个自然段之间必须用空行分隔（两个换行），段落不宜过长（3-8行）。角色切换、场景转换时必须另起一段。禁止全文一堆到底。',
    enabled: true,
  },
  {
    id: 'default_chapter_erotic',
    title: '情色章节模板',
    type: '章节',
    content: '根据以上设定和细纲，写出一章包含完整情色场景的小说正文。要求：\n1. 权力关系在性爱互动中通过对话、动作、心理活动充分展现\n2. 角色身体状态随性爱进程逐步变化\n3. 性爱流程完整：挑逗→前戏→渐进→主戏→高潮→余韵\n4. 运用感官描写：体液、触感、声音、视觉\n5. 羞耻与兴奋的心理交替循环\n6. 剧情与情色有机融合\n7. 文笔保持原作水准，情色描写有文学性而非低俗\n8. 正文用空行分隔自然段',
    enabled: false,
  },
  {
    id: 'default_character',
    title: '默认角色模板',
    type: '角色',
    content: '请根据以下信息生成一个完整的角色设定。包括：姓名、性别、年龄、身份/职业、外貌描写、性格特征（至少3个）、特殊能力（如有）、背景故事、与其他角色的关系。',
    enabled: true,
  },
  {
    id: 'default_outline',
    title: '默认大纲模板',
    type: '大纲',
    content: '请根据以下设定生成一份小说大纲。包括：故事主线（起因-发展-转折-高潮-结局）、主要角色弧线、世界观核心设定、关键事件节点。',
    enabled: false,
  },
  {
    id: 'default_summary',
    title: '默认摘要模板',
    type: '摘要',
    content: '请用简洁的语言总结以下章节内容的核心情节、人物发展和关键转折点。',
    enabled: true,
  },
  {
    id: 'default_worldbuilding',
    title: '默认世界观模板',
    type: '世界观',
    content: '你是一位专业的世界观设定设计师，擅长构建小说中的世界观体系。请帮助作者完善世界背景设定，包括但不限于：地理环境、政治体制、社会结构、魔法/科技体系、历史背景、文化习俗等。设定应逻辑自洽、细节丰富，并能服务于故事主线。',
    enabled: true,
  },
  {
    id: 'default_detailed_outline',
    title: '默认细纲模板',
    type: '细纲',
    content: '你是一位专业的小说结构规划师，擅长设计章节级别的详细写作大纲。请帮助作者规划章节内容，包括：本章核心情节、场景设置、人物出场安排、关键对话节点、情感发展和节奏控制。细纲应具体可执行，每项内容应有明确的写作目标。',
    enabled: true,
  },
  {
    id: 'default_polish',
    title: '默认润色模板',
    type: '润色',
    content: '请润色以下文字，优化表达、修正语病、提升文采，但保持原意不变。',
    enabled: true,
  },
  {
    id: 'default_continue',
    title: '默认续写模板',
    type: '续写',
    content: '请根据以下内容自然续写，保持风格一致。注意保持人物性格、叙事节奏和语言风格的连贯性。',
    enabled: true,
  },
  {
    id: 'default_rewrite',
    title: '默认改写模板',
    type: '改写',
    content: '请改写以下文字，在保持原意和风格不变的前提下，优化表达、丰富细节、提升文采。改写后的内容应与原文风格一致但表达更出色。',
    enabled: true,
  },
  {
    id: 'default_review',
    title: '默认审稿模板',
    type: '审稿',
    content: '你是专业文学编辑，请对以下章节进行审稿。请从以下角度分析，并在评论结束后务必附上评分摘要：\n\n1. 节奏 — 情节推进是否合理，有无拖沓或仓促\n2. 对白 — 人物对话是否符合角色特点，是否自然\n3. 描写 — 场景、动作、心理描写是否生动\n4. 情节一致性 — 与前文设定是否存在矛盾\n\n请按以下格式输出评分摘要（放在审稿末尾）：\n\n--- 评分摘要 ---\n总分: X/10\n节奏: X/10 | <一句话评价>\n对白: X/10 | <一句话评价>\n描写: X/10 | <一句话评价>\n情节一致性: X/10 | <一句话评价>',
    enabled: true,
  },
]

// 可变的提示词存储（每次测试前重置）
let promptStore = structuredClone(DEFAULT_PROMPTS)

function resetPrompts() {
  promptStore = structuredClone(DEFAULT_PROMPTS)
}

// ═══════════════════════════════════════════════════
//  路径辅助函数
// ═══════════════════════════════════════════════════
const P = p => path.join(ROOT, 'projects', p)
const N = p => path.join(ROOT, 'notes', p)
const K = p => path.join(ROOT, 'knowledge_base', 'files', p)

// ═══════════════════════════════════════════════════
//  工具实现（完整工具集 + 提示词库专用工具）
// ═══════════════════════════════════════════════════
const tools = {
  read_file: a => {
    const fp = a.file_path || a.path || ''
    try {
      const c = fs.readFileSync(P(fp), 'utf-8')
      return c.length > 3000 ? c.slice(0, 3000) + '\n…(' + c.length + '字)' : c
    } catch (e) {
      return `[错误: 文件不存在: ${fp}]`
    }
  },

  list_directory: a => {
    try {
      const dir = a.path || a.dir_path || '.'
      const e = fs.readdirSync(P(dir), { withFileTypes: true })
      return e.map(x => (x.isDirectory() ? 'DIR ' : 'FILE ') + x.name).join('\n')
    } catch (e) {
      return `[错误: 目录不存在: ${dir}]`
    }
  },

  search_content: a => {
    try {
      const fp = P(a.path || '.')
      const re = new RegExp((a.pattern || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
      const results = []
      function searchDir(d) {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const f = path.join(d, e.name)
          if (e.isDirectory()) { searchDir(f); continue }
          const c = fs.readFileSync(f, 'utf-8')
          const ls = c.split('\n')
          for (let i = 0; i < ls.length; i++)
            if (re.test(ls[i])) results.push(f.replace(ROOT + '/projects/', '') + ':' + (i + 1) + ':' + ls[i].slice(0, 200))
        }
      }
      if (fs.statSync(fp).isFile()) {
        const c = fs.readFileSync(fp, 'utf-8')
        const ls = c.split('\n')
        for (let i = 0; i < ls.length; i++)
          if (re.test(ls[i])) results.push((a.path || '') + ':' + (i + 1) + ':' + ls[i].slice(0, 200))
      } else { searchDir(fp) }
      return results.slice(0, 15).join('\n') || '无匹配'
    } catch { return '[错误]' }
  },

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
      if (old === '__FULL_REPLACE__') { fs.writeFileSync(fp, nw); return '全量替换成功' }
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
    try { return fs.readdirSync(K('')).filter(f => f.endsWith('.md')).join('\n') || '无KB文件' } catch { return '无KB文件' }
  },

  kb_create_file: a => {
    try { fs.mkdirSync(K(''), { recursive: true }); fs.writeFileSync(K((a.name || 'x') + '.md'), a.content || ''); return 'KB创建成功' } catch { return '[错误]' }
  },

  list_notes: () => {
    try { fs.mkdirSync(N(''), { recursive: true }); return fs.readdirSync(N('')).filter(f => f.endsWith('.md')).join('\n') || '无笔记' } catch { return '无笔记' }
  },

  write_note: a => {
    try { fs.mkdirSync(N(''), { recursive: true }); fs.writeFileSync(N((a.name || 'x') + '.md'), a.content || ''); return '笔记创建成功' } catch { return '[错误]' }
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
      ;['characters', 'chapters', 'outline', 'detailed_outline', 'summaries'].forEach(s => fs.mkdirSync(path.join(d, s), { recursive: true }))
      return `项目${a.name}创建成功`
    } catch { return '[错误]' }
  },

  delete_project: a => {
    try { fs.rmSync(P(a.name), { recursive: true, force: true }); return '项目删除成功' } catch { return '[错误]' }
  },

  // ── 提示词库专用工具 ──

  list_prompts: () => {
    const prompts = promptStore
    if (prompts.length === 0) return '暂无提示词模板'
    const lines = prompts.map(p => `[${p.enabled ? '✓启用' : '  关闭'}] ${p.id} | ${p.title} | 类型:${p.type}`)
    return `${prompts.length} 个提示词模板\n` + lines.join('\n')
  },

  toggle_prompt: a => {
    const pid = String(a.prompt_id || '')
    const enable = a.enabled !== false
    const target = promptStore.find(p => p.id === pid)

    if (!target) return `[错误: 未找到提示词: ${pid}]`

    if (enable) {
      // 同类型启用新模板会自动关闭旧的
      const sameType = promptStore.filter(p => p.type === target.type && p.id !== pid && p.enabled)
      for (const p of sameType) p.enabled = false
      target.enabled = true
      const disabled = sameType.map(p => p.title).join('、')
      return `已启用「${target.title}」${disabled ? `（自动关闭: ${disabled}）` : ''}`
    }

    target.enabled = false
    return `已关闭「${target.title}」`
  },

  update_prompt: a => {
    const pid = String(a.prompt_id || '')
    const updates = {}
    if (a.title !== undefined && a.title !== null) updates.title = String(a.title)
    if (a.content !== undefined && a.content !== null) updates.content = String(a.content)
    if (a.type !== undefined && a.type !== null) updates.type = String(a.type)

    if (Object.keys(updates).length === 0) return '[错误: 没有提供要修改的字段（至少需要 title 或 content）]'

    const target = promptStore.find(p => p.id === pid)
    if (!target) return `[错误: 未找到提示词: ${pid}]`

    Object.assign(target, updates)
    const fields = Object.keys(updates).join('、')
    return `已更新提示词「${target.title}」的 ${fields}`
  },

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
  { type: 'function', function: { name: 'list_prompts', description: '列出提示词库中所有提示词模板，显示id/标题/类型/启用状态。', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'toggle_prompt', description: '启用或关闭某个提示词模板。同类型只能启用一个，启用新模板会自动关闭同类型的旧模板。', parameters: { type: 'object', properties: { prompt_id: { type: 'string', description: '提示词模板 ID' }, enabled: { type: 'boolean', description: 'true=启用, false=关闭' } }, required: ['prompt_id', 'enabled'] } } },
  { type: 'function', function: { name: 'update_prompt', description: '修改提示词模板的标题或内容。至少需要提供 title 或 content 之一。', parameters: { type: 'object', properties: { prompt_id: { type: 'string', description: '提示词模板 ID' }, title: { type: 'string', description: '新标题（可选）' }, content: { type: 'string', description: '新内容（可选）' }, type: { type: 'string', description: '新类型（可选）' } }, required: ['prompt_id'] } } },
  { type: 'function', function: { name: 'list_rules', description: '列出已学习规则', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'learn_rule', description: '学习新规则', parameters: { type: 'object', properties: { rule: { type: 'string' } }, required: ['rule'] } } },
  { type: 'function', function: { name: 'list_audit', description: '查看审计记录', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'write_learning', description: '记录学习经验', parameters: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] } } },
]

// ═══════════════════════════════════════════════════
//  系统提示词
// ═══════════════════════════════════════════════════
const SYS = [
  '你是青剑AI写作助手，一个专业的AI小说创作辅助工具。',
  '',
  '# 铁律：何时用工具，何时不用',
  '✅ 调工具（用户要求操作文件/模板/提示词）: 读取/列出/搜索/创建/编辑/删除/写/保存/修改/改/查看/启用/关闭/切换',
  '❌ 不调工具（纯对话）: 我是/我叫/我喜欢/我觉得/你好/嗨/谢谢/什么是/为什么/怎么/推荐/建议/告诉我/聊天/闲聊',
  '',
  '# 提示词库',
  '提示词模板按类型分组: 灵感/世界观/角色/大纲/细纲/章节/润色/续写/改写/摘要/审稿。',
  '每种类型同时只能启用一个模板。',
  '用户提到"打开/启用/开启/切换"某类提示词时，用 toggle_prompt(prompt_id, enabled: true)。',
  '用户提到"关闭/禁用"某提示词时，用 toggle_prompt(prompt_id, enabled: false)。',
  '用户要修改提示词标题或内容时，用 update_prompt。先看看当前的再用 list_prompts 确定 id。',
  '',
  '# 对话风格',
  '- 用中文回复，语气自然亲切，像朋友聊天。',
  '- 回复简洁有力，不要啰嗦。',
  '',
  '# 执行规则',
  '- 已知路径直接读文件，不列目录。修改前先读。只做用户要求的，不多做。',
  '- 多个独立操作可在同一轮并行完成。有依赖的操作分轮执行。',
  '- **关键**: 用户只是在聊天/问候/表达感受时，绝对不要调用任何工具。',
].join('\n')

// ═══════════════════════════════════════════════════
//  API 调用
// ═══════════════════════════════════════════════════
async function callOpenAI(messages) {
  const body = { model: MODEL, messages, max_tokens: 2048, tools: TOOLS, tool_choice: 'auto' }
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
//  Agent 运行循环 (与 openai-sim-test.mjs 一致)
// ═══════════════════════════════════════════════════
async function agentRun(userMsg) {
  const messages = [
    { role: 'system', content: SYS },
    { role: 'user', content: userMsg },
  ]
  let iterations = 0, totalTools = 0, fullText = ''
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

    const asstMsg = { role: 'assistant', content: r.text || null, tool_calls: r.toolCalls }
    messages.push(asstMsg)

    for (const tc of r.toolCalls) {
      const fn = tc.function
      const toolFn = tools[fn.name]
      let args = {}
      try { args = JSON.parse(fn.arguments) } catch { /* ignore parse errors */ }
      const result = toolFn ? await toolFn(args) : '[未知工具]'
      const ok = result.startsWith && !result.startsWith('[')
      const icon = ok ? '✓' : '✗'
      totalTools++
      process.stdout.write(`${fn.name}${icon} `)
      toolLog.push({ name: fn.name, ok, args, result: result.slice(0, 150) })
      messages.push({ role: 'tool', tool_call_id: tc.id, content: result })
    }
    process.stdout.write('\n')
  }
  return { text: fullText, iterations, toolCalls: totalTools, toolLog }
}

// ═══════════════════════════════════════════════════
//  多轮对话运行
// ═══════════════════════════════════════════════════
async function multiTurnRun(userMessages) {
  const messages = [{ role: 'system', content: SYS }]
  let totalIterations = 0, totalTools = 0, allTexts = [], allUsages = []
  let toolCallNames = []

  for (let turnIdx = 0; turnIdx < userMessages.length; turnIdx++) {
    const userMsg = userMessages[turnIdx]
    messages.push({ role: 'user', content: userMsg })
    process.stdout.write(`  [轮${turnIdx + 1}] "${userMsg.slice(0, 50)}${userMsg.length > 50 ? '...' : ''}" `)

    let turnIterations = 0
    while (turnIterations < MAX_ITERATIONS) {
      turnIterations++
      totalIterations++
      const r = await callOpenAI(messages)
      if (r.text) allTexts.push(r.text)
      if (r.usage) allUsages.push(r.usage)

      if (!r.toolCalls.length) {
        process.stdout.write(`→ ${r.text.slice(0, 60)}${r.text.length > 60 ? '...' : ''}\n`)
        break
      }

      const asstMsg = { role: 'assistant', content: r.text || null, tool_calls: r.toolCalls }
      messages.push(asstMsg)

      for (const tc of r.toolCalls) {
        const fn = tc.function
        const toolFn = tools[fn.name]
        let args = {}
        try { args = JSON.parse(fn.arguments) } catch { /* ignore */ }
        const result = toolFn ? await toolFn(args) : '[未知工具]'
        const ok = result.startsWith && !result.startsWith('[')
        totalTools++
        toolCallNames.push(fn.name)
        process.stdout.write(fn.name + (ok ? '✓' : '✗') + ' ')
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
let pass = 0, fail = 0

function t(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ': ' + detail : '')) }
  else { fail++; console.log('  ❌ ' + name + (detail ? ': ' + detail : '')) }
}

function hr(title) {
  console.log('\n' + '─'.repeat(60))
  console.log('  ' + title)
  console.log('─'.repeat(60))
}

// ═══════════════════════════════════════════════════
//  辅助验证函数
// ═══════════════════════════════════════════════════

/** 验证提示词是否存在 */
function promptExists(id) {
  return promptStore.some(p => p.id === id)
}

/** 获取提示词 */
function getPrompt(id) {
  return promptStore.find(p => p.id === id)
}

/** 获取某类型下启用的提示词 */
function getEnabledByType(type) {
  return promptStore.filter(p => p.type === type && p.enabled)
}

// ═══════════════════════════════════════════════════
//  主测试流程
// ═══════════════════════════════════════════════════
async function main() {
  console.log('═══════════════════════════════════════════════')
  console.log('  仿真测试: 提示词库 (19-prompts)')
  console.log('  端点: ' + API_URL + '  模型: ' + MODEL)
  console.log('  场景: list/toggle/update 提示词模板')
  console.log('═══════════════════════════════════════════════')

  // ═══════════════════════════════════════════════
  // S1: 查看提示词库 — 用户想了解有哪些模板可用
  // ═══════════════════════════════════════════════
  hr('S1 查看提示词库 (list_prompts)')
  resetPrompts()
  const r1 = await agentRun('帮我看看现在有哪些提示词模板可以用？')
  t('S1 调用了 list_prompts', r1.toolCalls >= 1 && r1.toolLog.some(l => l.name === 'list_prompts' && l.ok),
    r1.iterations + '轮 ' + r1.toolCalls + '工具 ' + r1.toolLog.map(l => l.name + (l.ok ? '✓' : '✗')).join(', '))
  t('S1 返回了文本回复', r1.text.length > 0, r1.text.length + '字')
  const s1ListCall = r1.toolLog.find(l => l.name === 'list_prompts')
  t('S1 列出了全部11个模板', s1ListCall && s1ListCall.result.includes('11 个提示词模板'),
    s1ListCall ? '包含' + (s1ListCall.result.match(/default_/g) || []).length + '个' : '未找到')
  console.log('    回复: ' + r1.text.slice(0, 120))

  // ═══════════════════════════════════════════════
  // S2: 启用大纲模板 — 同类型只启用一个
  // ═══════════════════════════════════════════════
  hr('S2 启用大纲模板 (toggle_prompt — 启用)')
  resetPrompts()
  // 先确认大纲模板当前是关闭状态
  const outline = getPrompt('default_outline')
  t('S2 前置: 大纲模板初始为关闭', outline && !outline.enabled, 'enabled=' + (outline ? outline.enabled : 'N/A'))

  const r2 = await agentRun('帮我把大纲提示词模板打开吧，我准备写大纲了')
  t('S2 调用了 toggle_prompt', r2.toolCalls >= 1 && r2.toolLog.some(l => l.name === 'toggle_prompt' && l.ok),
    r2.iterations + '轮 ' + r2.toolCalls + '工具 ' + r2.toolLog.map(l => l.name + (l.ok ? '✓' : '✗')).join(', '))
  const outlineAfter = getPrompt('default_outline')
  t('S2 大纲模板已启用', outlineAfter && outlineAfter.enabled, 'enabled=' + (outlineAfter ? outlineAfter.enabled : 'N/A'))
  console.log('    回复: ' + r2.text.slice(0, 120))

  // ═══════════════════════════════════════════════
  // S3: 关闭提示词
  // ═══════════════════════════════════════════════
  hr('S3 关闭提示词 (toggle_prompt — 禁用)')
  resetPrompts()
  // 审稿模板初始为启用
  const review = getPrompt('default_review')
  t('S3 前置: 审稿模板初始为启用', review && review.enabled, 'enabled=' + (review ? review.enabled : 'N/A'))

  const r3 = await agentRun('把审稿的提示词关掉吧，暂时不用审稿功能')
  t('S3 调用了 toggle_prompt', r3.toolCalls >= 1 && r3.toolLog.some(l => l.name === 'toggle_prompt' && l.ok),
    r3.iterations + '轮 ' + r3.toolCalls + '工具 ' + r3.toolLog.map(l => l.name + (l.ok ? '✓' : '✗')).join(', '))
  const reviewAfter = getPrompt('default_review')
  t('S3 审稿模板已关闭', reviewAfter && !reviewAfter.enabled, 'enabled=' + (reviewAfter ? reviewAfter.enabled : 'N/A'))
  console.log('    回复: ' + r3.text.slice(0, 120))

  // ═══════════════════════════════════════════════
  // S4: 修改提示词内容
  // ═══════════════════════════════════════════════
  hr('S4 修改提示词内容 (update_prompt)')
  resetPrompts()
  const origPolish = getPrompt('default_polish')
  t('S4 前置: 润色模板存在', !!origPolish, origPolish ? origPolish.content.slice(0, 50) + '...' : 'N/A')

  const r4 = await agentRun(
    '帮我把润色模板改一下，在内容最后加上一句"请保持原文的语气和风格，不要改变作者的个人特色"'
  )
  t('S4 调用了 update_prompt', r4.toolCalls >= 1 && r4.toolLog.some(l => l.name === 'update_prompt' && l.ok),
    r4.iterations + '轮 ' + r4.toolCalls + '工具 ' + r4.toolLog.map(l => l.name + (l.ok ? '✓' : '✗')).join(', '))
  const polishAfter = getPrompt('default_polish')
  t('S4 润色内容已更新', polishAfter && polishAfter.content.includes('保持原文的语气和风格'),
    '新内容长度: ' + (polishAfter ? polishAfter.content.length : 0) + '字')
  console.log('    回复: ' + r4.text.slice(0, 120))

  // ═══════════════════════════════════════════════
  // S5: 修改提示词标题
  // ═══════════════════════════════════════════════
  hr('S5 修改提示词标题 (update_prompt — 仅改标题)')
  resetPrompts()
  const r5 = await agentRun('把续写模板的标题改成"智能续写模板"，内容不用改')
  t('S5 调用了 update_prompt', r5.toolCalls >= 1 && r5.toolLog.some(l => l.name === 'update_prompt' && l.ok),
    r5.iterations + '轮 ' + r5.toolCalls + '工具 ' + r5.toolLog.map(l => l.name + (l.ok ? '✓' : '✗')).join(', '))
  const contAfter = getPrompt('default_continue')
  t('S5 续写标题已改为"智能续写模板"', contAfter && contAfter.title === '智能续写模板',
    'title=' + (contAfter ? contAfter.title : 'N/A'))
  console.log('    回复: ' + r5.text.slice(0, 120))

  // ═══════════════════════════════════════════════
  // S6: 错误恢复 — 操作不存在的提示词
  // ═══════════════════════════════════════════════
  hr('S6 错误恢复: 不存在的提示词')
  resetPrompts()
  const r6 = await agentRun('帮我启用"修仙专用模板"，我要写修仙小说')
  t('S6 调用了 toggle_prompt', r6.toolCalls >= 1 && r6.toolLog.some(l => l.name === 'toggle_prompt'),
    r6.iterations + '轮 ' + r6.toolCalls + '工具 ' + r6.toolLog.map(l => l.name + (l.ok ? '✓' : '✗')).join(', '))
  // 不存在的ID，工具应该返回错误
  const s6Toggle = r6.toolLog.find(l => l.name === 'toggle_prompt')
  t('S6 toggle_prompt 返回了错误', s6Toggle && !s6Toggle.ok,
    s6Toggle ? s6Toggle.result.slice(0, 80) : 'N/A')
  t('S6 最终有文本回复', r6.text.length > 0, r6.text.length + '字')
  console.log('    回复: ' + r6.text.slice(0, 120))

  // ═══════════════════════════════════════════════
  // S7: 同类型切换 — 启用新模板自动关闭旧模板
  // ═══════════════════════════════════════════════
  hr('S7 同类型切换 (toggle_prompt — 同类型互斥)')
  resetPrompts()
  // 章节类型: default_chapter (enabled=true), default_chapter_erotic (enabled=false)
  t('S7 前置: 默认章节启用', getPrompt('default_chapter').enabled, '✓')
  t('S7 前置: 情色章节关闭', !getPrompt('default_chapter_erotic').enabled,
    'enabled=' + getPrompt('default_chapter_erotic').enabled)

  const r7 = await agentRun('帮我把情色章节模板打开，我要写那种内容')
  t('S7 调用了 toggle_prompt', r7.toolCalls >= 1 && r7.toolLog.some(l => l.name === 'toggle_prompt' && l.ok),
    r7.iterations + '轮 ' + r7.toolCalls + '工具 ' + r7.toolLog.map(l => l.name + (l.ok ? '✓' : '✗')).join(', '))

  const chap1 = getPrompt('default_chapter')
  const chap2 = getPrompt('default_chapter_erotic')
  t('S7 情色章节已启用', chap2 && chap2.enabled, 'enabled=' + (chap2 ? chap2.enabled : 'N/A'))
  t('S7 默认章节自动关闭（同类型互斥）', chap1 && !chap1.enabled, 'enabled=' + (chap1 ? chap1.enabled : 'N/A'))
  // 验证同类型只有一个启用
  const chapterEnabled = getEnabledByType('章节')
  t('S7 章节类型仅一个启用', chapterEnabled.length === 1,
    '启用数=' + chapterEnabled.length + ' (' + chapterEnabled.map(p => p.title).join(', ') + ')')
  console.log('    回复: ' + r7.text.slice(0, 120))

  // ═══════════════════════════════════════════════
  // S8: 查看→切换→验证 多轮交互流程
  // ═══════════════════════════════════════════════
  hr('S8 多轮交互: 查看→启用→修改→验证 (完整流程)')
  resetPrompts()

  // 先恢复续写模板标题（S5 可能改过）
  const cont = getPrompt('default_continue')
  if (cont) cont.title = '默认续写模板'

  const flow = [
    '先帮我列一下所有提示词，我看看有哪些',
    '好的，帮我把世界观模板启用吧',
    '等等，世界观模板的内容我想改一下，在开头加上"你是一位资深奇幻文学作家，擅长构建宏大且逻辑自洽的世界观体系。"',
    '嗯，再帮我确认一下世界观模板现在是启用状态吧？',
  ]
  const r8 = await multiTurnRun(flow)
  t('S8 全部4轮有回复', r8.allTexts.length === 4,
    `${r8.allTexts.length}/4轮`)
  t('S8 调用了多个工具', r8.toolCalls >= 3,
    `${r8.toolCalls}个工具: ${r8.toolCallNames.join(', ')}`)
  t('S8 调用了 list_prompts', r8.toolCallNames.includes('list_prompts'),
    '✓')
  t('S8 调用了 toggle_prompt', r8.toolCallNames.includes('toggle_prompt'),
    '✓')
  t('S8 调用了 update_prompt', r8.toolCallNames.includes('update_prompt'),
    '✓')

  // 验证最终状态
  const wb = getPrompt('default_worldbuilding')
  t('S8 世界观模板已启用', wb && wb.enabled, 'enabled=' + (wb ? wb.enabled : 'N/A'))
  t('S8 世界观内容已更新', wb && wb.content.includes('资深奇幻文学作家'),
    wb ? '内容前60字: ' + wb.content.slice(0, 60) + '...' : 'N/A')

  for (let i = 0; i < r8.allTexts.length; i++) {
    console.log(`    轮${i + 1}: ${r8.allTexts[i].slice(0, 80)}`)
  }

  // ═══════════════════════════════════════════════
  // S9: 边界 — list_prompts 空库（无提示词时）
  // ═══════════════════════════════════════════════
  hr('S9 边界: 空提示词库')
  const savedPrompts = promptStore
  promptStore = []
  const r9 = await agentRun('帮我看看提示词库有哪些模板')
  t('S9 list_prompts 空库', r9.toolCalls >= 1 && r9.toolLog.some(l => l.name === 'list_prompts'),
    r9.toolLog.map(l => l.name + (l.ok ? '✓' : '✗')).join(', '))
  const s9List = r9.toolLog.find(l => l.name === 'list_prompts')
  t('S9 空库返回合理提示', s9List && s9List.result.includes('暂') || s9List.result.includes('无'),
    s9List ? s9List.result.slice(0, 60) : 'N/A')
  t('S9 空库仍返回0个模板', s9List && /0\s*个/.test(s9List.result.replace(/\n/g, ' ')),
    s9List ? s9List.result.slice(0, 60) : 'N/A')
  promptStore = savedPrompts
  console.log('    回复: ' + r9.text.slice(0, 120))

  // ═══════════════════════════════════════════════
  // S10: 边界 — update_prompt 不提供任何字段
  // ═══════════════════════════════════════════════
  hr('S10 边界: update_prompt 无修改字段')
  resetPrompts()
  // 模拟用户说"修改一下审稿模板"但不说具体改什么
  const r10 = await agentRun('帮我把审稿模板更新一下')
  // 如果AI没有具体字段可以更新，最好先 list_prompts 确认，或者给出回复
  t('S10 有工具调用或文本回复', r10.toolCalls >= 1 || r10.text.length > 0,
    r10.toolCalls + '工具 ' + r10.text.length + '字文本')
  console.log('    回复: ' + r10.text.slice(0, 120))
  if (r10.toolLog.length > 0) {
    console.log('    工具: ' + r10.toolLog.map(l => l.name + (l.ok ? '✓' : '✗')).join(', '))
  }

  // ═══════════════════════════════════════════════
  // S11: 闲聊 — 询问提示词相关问题但不操作
  // ═══════════════════════════════════════════════
  hr('S11 闲聊: 询问提示词建议（不操作）')
  resetPrompts()
  const r11 = await agentRun('你觉得写玄幻小说用哪个提示词模板比较好？角色模板够用吗？')
  t('S11 纯对话0工具', r11.toolCalls === 0, r11.iterations + '轮 文本' + r11.text.length + '字')
  t('S11 返回了建议', r11.text.length >= 20, '至少20字')
  console.log('    回复: ' + r11.text.slice(0, 150))

  // ═══════════════════════════════════════════════
  // S12: 带错别字的口语化操作
  // ═══════════════════════════════════════════════
  hr('S12 带错别字的口语化操作')
  resetPrompts()
  const r12 = await agentRun('帮我把纳钢模版打开把，不对，是那个大纲模板')
  t('S12 调用了工具', r12.toolCalls >= 1,
    r12.iterations + '轮 ' + r12.toolCalls + '工具 ' + r12.toolLog.map(l => l.name + (l.ok ? '✓' : '✗')).join(', '))
  const outline12 = getPrompt('default_outline')
  t('S12 大纲模板被启用', outline12 && outline12.enabled, 'enabled=' + (outline12 ? outline12.enabled : 'N/A'))
  console.log('    回复: ' + r12.text.slice(0, 120))

  // ═══════════════════════════════════════════════
  // S13: 极简指令 — 用户只说关键词
  // ═══════════════════════════════════════════════
  hr('S13 极简指令')
  resetPrompts()
  const r13 = await agentRun('列出提示词')
  t('S13 调用了 list_prompts', r13.toolCalls >= 1 && r13.toolLog.some(l => l.name === 'list_prompts' && l.ok),
    r13.iterations + '轮 ' + r13.toolCalls + '工具 ' + r13.toolLog.map(l => l.name + (l.ok ? '✓' : '✗')).join(', '))
  console.log('    回复: ' + r13.text.slice(0, 120))

  // ═══════════════════════════════════════════════
  // 汇总
  // ═══════════════════════════════════════════════
  const total = pass + fail
  console.log('\n')
  console.log('═══════════════════════════════════════════════')
  console.log('  仿真测试: 提示词库 (19-prompts) — 测试结果')
  console.log('═══════════════════════════════════════════════')
  console.log('  ✅ ' + String(pass).padStart(2) + '  通过')
  console.log('  ❌ ' + String(fail).padStart(2) + '  失败')
  console.log('  通过率: ' + (total > 0 ? ((pass / total) * 100).toFixed(1) : '0.0') + '%')
  console.log('═══════════════════════════════════════════════')
  console.log('')
  console.log('  场景覆盖:')
  console.log('    - list_prompts: 查看全部模板（含空库边界）')
  console.log('    - toggle_prompt: 启用/关闭模板')
  console.log('    - toggle_prompt: 同类型互斥自动关闭旧模板')
  console.log('    - update_prompt: 修改标题')
  console.log('    - update_prompt: 修改内容')
  console.log('    - 错误恢复: 操作不存在的提示词')
  console.log('    - 多轮交互: 查看→启用→修改→验证')
  console.log('    - 边界: 空库、无修改字段')
  console.log('    - 闲聊: 询问建议但不操作')
  console.log('    - 错别字/口语化指令识别')
  console.log('    - 极简指令识别')
  console.log('')

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
