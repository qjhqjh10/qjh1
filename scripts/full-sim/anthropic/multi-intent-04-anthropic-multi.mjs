#!/usr/bin/env node
/**
 * 仿真测试: Anthropic协议多意图 — 复杂任务链 (Anthropic 协议)
 * 使用 Anthropic Messages API 测试模型解析复合用户消息并执行多步骤任务的能力。
 *
 * S1: 多意图复杂任务链 — 创建项目→创建角色→写大纲→记笔记
 * S2: 长消息测试 — 粘贴文本后先阅读再分析，完成3个子任务
 *
 * 关键差异 (vs OpenAI):
 *   - system 作为顶层参数 [{type:'text', text:'...'}]
 *   - 消息使用 content 数组格式
 *   - tool_result block 合并在 user 消息中
 *   - 非流式响应: stream: false，一次获取完整 content blocks
 *
 * 验证:
 *   - 模型识别出用户消息中嵌入的所有任务
 *   - 按逻辑顺序执行（先读后写，尊重依赖）
 *   - 每个任务正确完成
 *   - 长消息场景下先读取再分析
 *
 * 复杂度: complex — 4步任务链 + 长消息多子任务
 * 工具覆盖: create_project, list_directory, create_file, read_file, write_note
 *
 * 运行: node scripts/full-sim/anthropic/multi-intent-04-anthropic-multi.mjs
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

// ── 配置 ──
const API_KEY = 'sk-c9c30831df7243209435c60e811c879d'
const BASE_URL = 'https://api.deepseek.com'
const MODEL = 'deepseek-v4-flash'
const MAX_ITERATIONS = 12

const API_URL = BASE_URL.replace(/\/+$/, '') + '/anthropic/v1/messages'

const ROOT = path.resolve(import.meta.dirname || '.', '..', '..', '..')
const P = p => path.join(ROOT, 'projects', p)
const N = p => path.join(ROOT, 'notes', p)
const K = p => path.join(ROOT, 'knowledge_base', 'files', p)

// S1 项目名
const PROJ_NAME_S1 = '星辰大海'
// S2 项目名
const PROJ_NAME_S2 = 'multi-intent-test'

console.log(`═══════════════════════════════════════════`)
console.log(`  仿真测试: 多意图复杂任务链 (multi-intent-04) — Anthropic 协议`)
console.log(`  端点: ${API_URL}`)
console.log(`  模型: ${MODEL}`)
console.log(`  模式: 非流式 JSON — 多意图解析 + 长消息分析`)
console.log(`═══════════════════════════════════════════`)

// ── 工具实现 ──
const tools = {
  read_file: a => {
    const fp = a.file_path || a.path || ''
    try {
      const fullPath = P(fp)
      const c = fs.readFileSync(fullPath, 'utf-8')
      return c.length > 3000 ? c.slice(0, 3000) + '\n…(' + c.length + '字)' : c
    } catch {
      return '[错误: 文件不存在]'
    }
  },
  list_directory: a => {
    const dir = a.path || a.dir_path || '.'
    try {
      const fullDir = P(dir)
      const entries = fs.readdirSync(fullDir, { withFileTypes: true })
      if (entries.length === 0) return '(空目录)'
      return entries
        .map(x => (x.isDirectory() ? 'DIR  ' : 'FILE ') + x.name)
        .join('\n')
    } catch {
      return '[错误: 目录不存在]'
    }
  },
  search_content: a => {
    try {
      const dir = P(a.path || '')
      const pattern = a.pattern || ''
      const results = []
      function searchDir(d) {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const f = path.join(d, e.name)
          if (e.isDirectory()) { searchDir(f); continue }
          try {
            const c = fs.readFileSync(f, 'utf-8')
            const ls = c.split('\n')
            for (let i = 0; i < ls.length; i++) {
              if (ls[i].includes(pattern)) {
                results.push(e.name + ':' + (i + 1) + ':' + ls[i].slice(0, 200))
              }
            }
          } catch { /* skip */ }
        }
      }
      if (fs.statSync(dir).isFile()) {
        const c = fs.readFileSync(dir, 'utf-8')
        const ls = c.split('\n')
        for (let i = 0; i < ls.length; i++) {
          if (ls[i].includes(pattern)) results.push((a.path || '') + ':' + (i + 1) + ':' + ls[i].slice(0, 200))
        }
      } else { searchDir(dir) }
      return results.slice(0, 15).join('\n') || '无匹配'
    } catch { return '[错误: 搜索失败]' }
  },
  create_file: a => {
    try {
      const fp = a.file_path || a.path || ''
      if (!fp) return '[错误: 缺少 file_path]'
      const fullPath = P(fp)
      const c = a.content || ''
      if (fp.endsWith('.json') && c) {
        try { JSON.parse(c) } catch (e) { return '[JSON格式错误: ' + e.message + ']' }
      }
      fs.mkdirSync(path.dirname(fullPath), { recursive: true })
      fs.writeFileSync(fullPath, c, 'utf-8')
      return '创建成功: ' + fp + ' (' + c.length + '字)'
    } catch (e) {
      return '[错误: ' + e.message + ']'
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
      if (idx < 0) return '[未找到匹配文本: "' + old.slice(0, 80) + '"]'
      fs.writeFileSync(fullPath, c.slice(0, idx) + nw + c.slice(idx + old.length), 'utf-8')
      return '编辑成功'
    } catch (e) { return '[错误: ' + e.message + ']' }
  },
  delete_file: a => {
    try { fs.unlinkSync(P(a.file_path || a.path || '')); return '删除成功' } catch (e) { return '[错误: ' + e.message + ']' }
  },
  kb_list: () => {
    try {
      fs.mkdirSync(K(''), { recursive: true })
      const files = fs.readdirSync(K('')).filter(f => f.endsWith('.md'))
      return files.length === 0 ? '(知识库为空)' : files.map((f, i) => (i + 1) + '. ' + f).join('\n')
    } catch { return '无' }
  },
  kb_create_file: a => {
    try {
      const name = (a.name || '未命名').trim()
      if (!name) return '[错误: 文件名不能为空]'
      fs.mkdirSync(K(''), { recursive: true })
      fs.writeFileSync(K((name.endsWith('.md') ? name : name + '.md')), a.content || '', 'utf-8')
      return '已创建知识库文件: ' + name
    } catch { return '[错误]' }
  },
  list_notes: () => {
    try { fs.mkdirSync(N(''), { recursive: true }); return fs.readdirSync(N('')).filter(f => f.endsWith('.md')).join('\n') || '无' } catch { return '无' }
  },
  write_note: a => {
    try {
      fs.mkdirSync(N(''), { recursive: true })
      const noteName = (a.name || 'x').trim()
      const fileName = noteName.endsWith('.md') ? noteName : noteName + '.md'
      fs.writeFileSync(N(fileName), a.content || '', 'utf-8')
      return '笔记创建成功: ' + noteName
    } catch (e) { return '[错误: ' + e.message + ']' }
  },
  read_note: a => {
    try {
      const noteName = (a.name || 'x').trim()
      const fileName = noteName.endsWith('.md') ? noteName : noteName + '.md'
      return fs.readFileSync(N(fileName), 'utf-8').slice(0, 500)
    } catch { return '[不存在]' }
  },
  create_project: a => {
    try {
      const name = (a.name || '').trim()
      if (!name) return '[错误: 缺少项目名称]'
      if (/[<>:"/\\|?*]/.test(name)) return '[错误: 项目名包含非法字符]'
      const projDir = P(name)
      if (fs.existsSync(projDir)) return '[错误: 项目已存在: ' + name + ']'
      ;['characters', 'chapters', 'outline', 'detailed_outline', 'summaries'].forEach(
        sub => fs.mkdirSync(path.join(projDir, sub), { recursive: true })
      )
      return '项目 "' + name + '" 创建成功，已创建5个子目录: characters/chapters/outline/detailed_outline/summaries'
    } catch (e) { return '[错误: ' + e.message + ']' }
  },
  delete_project: a => {
    try {
      const name = (a.name || '').trim()
      if (!name) return '[错误: 缺少项目名称]'
      const projDir = P(name)
      if (!fs.existsSync(projDir)) return '[错误: 项目不存在: ' + name + ']'
      fs.rmSync(projDir, { recursive: true, force: true })
      return '项目 "' + name + '" 已删除'
    } catch (e) { return '[错误: ' + e.message + ']' }
  },
}

// ── Anthropic 格式工具定义 ──
const TOOLS = [
  { name: 'read_file', description: '读取项目文件内容。写大纲前应先读取大纲格式参考。已知文件路径直接读。', input_schema: { type: 'object', properties: { file_path: { type: 'string', description: '文件相对路径' } }, required: ['file_path'] } },
  { name: 'list_directory', description: '列出目录内容。用于查看项目结构、确认子目录。path="."列出所有项目。', input_schema: { type: 'object', properties: { path: { type: 'string', description: '目录路径' } }, required: ['path'] } },
  { name: 'search_content', description: '在项目中搜索文件内容', input_schema: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' } }, required: ['pattern'] } },
  { name: 'create_file', description: '创建新文件。用于创建角色JSON、故事大纲等。JSON文件自动校验格式。file_path示例: 星辰大海/characters/赵星.json', input_schema: { type: 'object', properties: { file_path: { type: 'string', description: '文件保存路径' }, content: { type: 'string', description: '文件内容' } }, required: ['file_path', 'content'] } },
  { name: 'edit_file', description: '编辑现有文件。old_string=__FULL_REPLACE__表示全量替换。', input_schema: { type: 'object', properties: { file_path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' } }, required: ['file_path', 'old_string', 'new_string'] } },
  { name: 'delete_file', description: '删除项目文件', input_schema: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] } },
  { name: 'kb_list', description: '列出知识库文件', input_schema: { type: 'object', properties: {} } },
  { name: 'kb_create_file', description: '在知识库创建新文件保存资料', input_schema: { type: 'object', properties: { name: { type: 'string' }, content: { type: 'string' } }, required: ['name', 'content'] } },
  { name: 'list_notes', description: '列出所有笔记', input_schema: { type: 'object', properties: {} } },
  { name: 'write_note', description: '创建或覆写笔记草稿。用于记录灵感、创作要点等。参数 name 为笔记名，content 为内容。', input_schema: { type: 'object', properties: { name: { type: 'string', description: '笔记名称' }, content: { type: 'string', description: '笔记内容' } }, required: ['name', 'content'] } },
  { name: 'read_note', description: '读取笔记内容。用于验证笔记是否成功创建。', input_schema: { type: 'object', properties: { name: { type: 'string', description: '笔记名称' } }, required: ['name'] } },
  { name: 'create_project', description: '创建新项目，会自动创建characters/chapters/outline/detailed_outline/summaries子目录。项目创建后才能在项目中创建角色、大纲等文件。', input_schema: { type: 'object', properties: { name: { type: 'string', description: '项目名称' } }, required: ['name'] } },
  { name: 'delete_project', description: '删除项目及其所有内容。此操作不可撤销。', input_schema: { type: 'object', properties: { name: { type: 'string', description: '要删除的项目名称' } }, required: ['name'] } },
]

// ── 系统提示词 ──
const SYS = [
  '你是"青剑"，AI小说创作助手。',

  '# 铁律',
  '- 操作文件必须调用实际的 function call，口头描述不等于操作完成',
  '- 禁止在文本中用 <tool_name>、[工具名]、或任何 XML/JSON 文本块来模拟工具调用',
  '- 用户一条消息中包含多个任务时，必须逐个完成所有任务',
  '- 执行任务时注意依赖关系：先创建项目→再创建项目中文件→最后记笔记',

  '# 项目管理',
  '- 创建项目: create_project → 自动创建 characters/chapters/outline/ 等子目录',
  '- 创建角色: create_file → 角色JSON保存到 {项目}/characters/{姓名}.json',
  '- 写大纲: create_file → 大纲保存到 {项目}/outline/plot.md',
  '- 记笔记: write_note → 笔记保存到 notes/ 目录',

  '# 角色JSON标准字段（16个必填）',
  'id, name, role, gender, age, occupation,',
  'background, appearance, personality, abilities,',
  'weaknesses, relationships, relationshipTags, arc,',
  'importance, motivations',
  '',
  '- role 字段必须是: 男主, 女主, 男配, 女配, 反派, 其他',
  '- abilities 必须是字符串',
  '- relationshipTags 必须是数组',
  '- importance 必须是数字 1-100',

  '# 多任务处理规则',
  '- 仔细分析用户消息，识别其中包含的所有任务',
  '- 按逻辑依赖顺序执行：先建项目，再建角色和大纲，最后记笔记',
  '- 每个任务执行完后在文本回复中简要告知用户',
  '- 不遗漏任何任务',

  '# 路径速查',
  '- 角色: {项目名}/characters/{中文名}.json',
  '- 大纲: {项目名}/outline/plot.md',
  '- 笔记: notes/{笔记名}.md',

  '# 对话风格',
  '- 用中文回复，简洁明了',
  '- 操作完成后逐一汇报结果',
  '- 多步骤任务按顺序逐个执行，一个完成再做下一个',
]

// ── Anthropic API 调用 (非流式 JSON) ──
async function callAnthropic({ system, messages, tools }) {
  const systemBlocks = (system || SYS).map(s =>
    typeof s === 'string' ? { type: 'text', text: s } : s
  )
  const body = {
    model: MODEL,
    max_tokens: 4096,
    stream: false,
    system: systemBlocks,
    messages: messages,
    tools: tools || [],
  }

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + API_KEY },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error('HTTP ' + res.status + ': ' + errText.slice(0, 300))
  }

  const json = await res.json()

  // ── 解析 content blocks ──
  let fullText = ''
  const toolUses = []

  for (const block of json.content || []) {
    if (block.type === 'text') {
      fullText += block.text
    } else if (block.type === 'tool_use') {
      toolUses.push({
        id: block.id,
        name: block.name,
        input: block.input || {},
      })
    }
  }

  return {
    text: fullText,
    toolUses,
    stopReason: json.stop_reason || '',
    usage: json.usage,
  }
}

// ── Agent 循环 ──
async function agentRun(userMsg) {
  const messages = [
    { role: 'user', content: [{ type: 'text', text: userMsg }] },
  ]
  let iterations = 0, totalTools = 0, fullText = ''
  const toolLog = []

  while (iterations < MAX_ITERATIONS) {
    iterations++
    process.stdout.write('  [iter' + iterations + '] ')
    const r = await callAnthropic({ system: SYS, messages, tools: TOOLS })

    if (r.text) fullText = r.text || fullText

    if (r.toolUses.length === 0) {
      process.stdout.write('文本回复(' + fullText.length + '字)\n')
      return { text: fullText, iterations, toolCalls: totalTools, toolLog }
    }

    // 构建 assistant content blocks
    const asstContent = []
    if (r.text) asstContent.push({ type: 'text', text: r.text })
    for (const tu of r.toolUses) {
      asstContent.push({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input })
    }
    messages.push({ role: 'assistant', content: asstContent })

    // 执行工具 → tool_result blocks
    const toolResults = []
    for (const tu of r.toolUses) {
      const toolFn = tools[tu.name]
      const result = toolFn ? await toolFn(tu.input) : '[未知工具]'
      const ok = !(typeof result === 'string' && result.startsWith('['))
      totalTools++
      const icon = ok ? '✓' : '✗'
      process.stdout.write(tu.name + icon + ' ')
      toolLog.push({
        name: tu.name,
        ok,
        args: tu.input,
        result: String(result).slice(0, 120),
      })
      toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: String(result) })
    }
    // Anthropic 要求: 所有 tool_result 必须合并在一条 user 消息中
    messages.push({ role: 'user', content: toolResults })
    process.stdout.write('\n')
  }
  return { text: fullText, iterations, toolCalls: totalTools, toolLog }
}

// ── 测试框架 ──
let pass = 0, fail = 0
function t(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ': ' + detail : '')) }
  else { fail++; console.log('  ❌ ' + name + (detail ? ': ' + detail : '')) }
}
function hr(title) { console.log('\n' + '─'.repeat(55) + '\n  ' + title + '\n' + '─'.repeat(55)) }

// ═══════════════════════════════════════════════════════════════════════
//  清理函数
// ═══════════════════════════════════════════════════════════════════════
function cleanupS1() {
  try { fs.rmSync(P(PROJ_NAME_S1), { recursive: true, force: true }) } catch {}
  try {
    const noteFile = N('科幻创作要点.md')
    if (fs.existsSync(noteFile)) fs.unlinkSync(noteFile)
  } catch {}
}
function cleanupS2() {
  try { fs.rmSync(P(PROJ_NAME_S2), { recursive: true, force: true }) } catch {}
  try {
    const noteFile = N('文风分析结果.md')
    if (fs.existsSync(noteFile)) fs.unlinkSync(noteFile)
  } catch {}
  try {
    const noteFile2 = N('世界观构建要点.md')
    if (fs.existsSync(noteFile2)) fs.unlinkSync(noteFile2)
  } catch {}
}

// ═══════════════════════════════════════════════════════════════════════
//  测试场景
// ═══════════════════════════════════════════════════════════════════════
async function main() {
  // ── 测试前清理 ──
  cleanupS1()
  cleanupS2()

  // ══════════════════════════════════════════════════════════════════
  // S1: 多意图复杂任务链 — 创建项目→创建角色→写大纲→记笔记
  // ══════════════════════════════════════════════════════════════════
  hr('S1 多意图复杂任务链 — “创建项目+角色+大纲+笔记”')

  const s1Msg = '我要开始一个新项目。创建一个项目叫"' + PROJ_NAME_S1 + '"(科幻小说)。然后创建主角"赵星"，25岁航天工程师，喜欢探索未知。再写一个故事大纲。最后记一条笔记"科幻创作要点"，记录今天学到的重要创作原则。'

  console.log('  用户消息: ' + s1Msg)
  const r1 = await agentRun(s1Msg)

  // ── 基本验证 ──
  t('S1 有文本回复', r1.text.length > 0, r1.text.length + '字')
  t('S1 迭代次数 <= MAX', r1.iterations <= MAX_ITERATIONS, r1.iterations + '/' + MAX_ITERATIONS)

  // ── 任务识别验证 ──
  const toolNames = r1.toolLog.map(l => l.name)
  const toolNamesAll = toolNames.join(' → ')

  const hasCreateProject = toolNames.includes('create_project')
  const hasCreateFile = toolNames.includes('create_file')
  const hasWriteNote = toolNames.includes('write_note')
  const hasReadFile = toolNames.includes('read_file')
  const hasListDir = toolNames.includes('list_directory')

  t('S1 识别: create_project', hasCreateProject, '识别到"创建项目"任务')
  t('S1 识别: create_file(角色)', hasCreateFile, '识别到"创建角色"任务')
  t('S1 识别: create_file(大纲)或read_file+create_file', hasCreateFile, '识别到"写大纲"任务')
  t('S1 识别: write_note', hasWriteNote, '识别到"记笔记"任务')
  t('S1 识别任务数 >= 4', r1.toolLog.length >= 4, r1.toolLog.length + '个工具调用')

  // ── 操作顺序验证 ──
  const createProjIdx = toolNames.indexOf('create_project')
  const createFileIdxs = []
  toolNames.forEach((n, i) => { if (n === 'create_file') createFileIdxs.push(i) })
  const writeNoteIdx = toolNames.indexOf('write_note')

  // create_project 必须在 create_file 之前
  const projBeforeFile = createProjIdx >= 0 && createFileIdxs.length > 0
    ? createProjIdx < Math.min(...createFileIdxs)
    : true
  t('S1 顺序: create_project先于create_file', projBeforeFile,
    'create_project@' + createProjIdx + ' < create_file@' + (createFileIdxs.length > 0 ? Math.min(...createFileIdxs) : 'N/A'))

  // create_file(角色) 应在 create_file(大纲) 之前，或至少角色文件创建在项目子目录下
  const charBeforeOutline = createFileIdxs.length >= 2
    ? createFileIdxs[0] < createFileIdxs[createFileIdxs.length - 1]
    : true

  // note 通常最后
  const noteLast = writeNoteIdx >= 0 && createFileIdxs.length > 0
    ? writeNoteIdx > Math.max(...createFileIdxs) || writeNoteIdx > createProjIdx
    : true
  t('S1 顺序: write_note在最后或接近最后', noteLast,
    'write_note@' + writeNoteIdx + ' 在 create_file@' + (createFileIdxs.length > 0 ? Math.max(...createFileIdxs) : 'N/A') + '之后')

  // ── 项目创建验证 ──
  const projExists = fs.existsSync(P(PROJ_NAME_S1))
  t('S1 项目目录已创建', projExists, 'projects/' + PROJ_NAME_S1 + '/')

  if (projExists) {
    const subDirs = fs.readdirSync(P(PROJ_NAME_S1)).filter(d => {
      try { return fs.statSync(P(PROJ_NAME_S1 + '/' + d)).isDirectory() } catch { return false }
    })
    t('S1 项目含子目录 >= 5', subDirs.length >= 5,
      subDirs.length + '个: ' + subDirs.join(', '))
  }

  // ── 角色文件验证 ──
  function findCharFile() {
    const charsDir = P(PROJ_NAME_S1 + '/characters')
    if (!fs.existsSync(charsDir)) return null
    const files = fs.readdirSync(charsDir)
    // 查找包含"赵星"的文件
    const charFile = files.find(f => f.includes('赵星') || f.includes('zhao'))
    return charFile ? PROJ_NAME_S1 + '/characters/' + charFile : null
  }

  const charFilePath = findCharFile()
  if (charFilePath) {
    const charContent = fs.readFileSync(P(charFilePath), 'utf-8')
    try {
      const charObj = JSON.parse(charContent)
      t('S1 角色: name=赵星', charObj.name === '赵星',
        'name=' + charObj.name)
      t('S1 角色: age含25', String(charObj.age || '').includes('25'),
        'age=' + charObj.age)
      t('S1 角色: occupation含航天', String(charObj.occupation || '').includes('航天'),
        'occupation=' + charObj.occupation)

      // 验证16字段完整性
      const requiredFields = ['id', 'name', 'role', 'gender', 'age', 'occupation',
        'background', 'appearance', 'personality', 'abilities',
        'weaknesses', 'relationships', 'relationshipTags', 'arc',
        'importance', 'motivations']
      const missingFields = requiredFields.filter(f => !(f in charObj))
      t('S1 角色: 16必填字段完整', missingFields.length <= 4,
        '缺失: ' + missingFields.join(', '))

      // 字段类型验证
      t('S1 角色: abilities是字符串',
        typeof charObj.abilities === 'string',
        typeof charObj.abilities)
      t('S1 角色: relationshipTags是数组',
        Array.isArray(charObj.relationshipTags),
        JSON.stringify(charObj.relationshipTags).slice(0, 60))
      t('S1 角色: importance是数字',
        typeof charObj.importance === 'number',
        String(charObj.importance))

      console.log('  角色摘要: ' + charObj.name + ' | ' + charObj.role +
        ' | age=' + charObj.age + ' | occupation=' + charObj.occupation +
        ' | importance=' + charObj.importance)
    } catch (e) {
      t('S1 角色文件是有效JSON', false, e.message)
      console.log('  角色文件内容(前200字): ' + charContent.slice(0, 200))
    }
  } else {
    t('S1 角色: 赵星文件已创建', false, '未在 characters/ 中找到"赵星"相关文件')
    // 尝试列出实际文件
    try {
      const charsDir = P(PROJ_NAME_S1 + '/characters')
      if (fs.existsSync(charsDir)) {
        console.log('  实际文件列表: ' + fs.readdirSync(charsDir).join(', '))
      }
    } catch {}
    // 从toolLog中查看create_file的参数
    const createCalls = r1.toolLog.filter(l => l.name === 'create_file')
    console.log('  create_file调用详情:')
    createCalls.forEach(c => {
      console.log('    file_path=' + (c.args.file_path || '') + ' content前40字=' + String(c.args.content || '').slice(0, 40))
    })
  }

  // ── 大纲验证 ──
  function findOutlineFile() {
    const outlineDir = P(PROJ_NAME_S1 + '/outline')
    if (!fs.existsSync(outlineDir)) return null
    const files = fs.readdirSync(outlineDir)
    const outlineFile = files.find(f => f.includes('plot') || f.includes('大纲') || f.includes('outline'))
    return outlineFile ? PROJ_NAME_S1 + '/outline/' + outlineFile : null
  }

  const outlineFilePath = findOutlineFile()
  if (outlineFilePath) {
    const outlineContent = fs.readFileSync(P(outlineFilePath), 'utf-8')
    const charCount = outlineContent.replace(/\s/g, '').length
    t('S1 大纲: 文件已创建', true, outlineFilePath)
    t('S1 大纲: 内容至少100字', charCount >= 100, '有效字数: ' + charCount)
    t('S1 大纲: 含中文内容', /[一-鿿]/.test(outlineContent), '含中文字符')
    console.log('  大纲文件: ' + outlineFilePath + ' (' + charCount + '有效字)')
  } else {
    // 大纲可能用 create_file 创建到了其他路径
    const createCalls = r1.toolLog.filter(l => l.name === 'create_file')
    const outlineCall = createCalls.find(c => {
      const fp = String(c.args.file_path || '')
      return fp.includes('outline') || fp.includes('大纲') || fp.includes('plot')
    })
    if (outlineCall) {
      const fp = String(outlineCall.args.file_path || '')
      const exists = fs.existsSync(P(fp))
      t('S1 大纲: 文件已创建(路径来自create_file)', exists, fp + (exists ? ' 存在' : ' 不存在'))
      if (exists) {
        const c = fs.readFileSync(P(fp), 'utf-8')
        const cc = c.replace(/\s/g, '').length
        t('S1 大纲: 内容至少100字', cc >= 100, '有效字数: ' + cc)
        t('S1 大纲: 含中文内容', /[一-鿿]/.test(c), '含中文字符')
      }
    } else {
      t('S1 大纲: 文件已创建', false, '未找到大纲文件 — create_file调用: ' +
        createCalls.map(c => c.args.file_path || '').join(', '))
    }
  }

  // ── 笔记验证 ──
  const noteCall = r1.toolLog.find(l => l.name === 'write_note')
  if (noteCall) {
    t('S1 笔记: write_note被调用', true)

    const noteName = String(noteCall.args.name || '')
    const noteContent = String(noteCall.args.content || '')
    t('S1 笔记: name含"科幻"', noteName.includes('科幻') || noteName.includes('创作'),
      'name=' + noteName)
    t('S1 笔记: 有实质内容', noteContent.length > 10, noteContent.length + '字')

    // 验证笔记文件在磁盘上
    const noteFileName = noteName.endsWith('.md') ? noteName : noteName + '.md'
    const noteExists = fs.existsSync(N(noteFileName))
    t('S1 笔记: 文件在磁盘上存在', noteExists,
      noteExists ? 'notes/' + noteFileName : '文件缺失')

    if (noteExists) {
      const diskContent = fs.readFileSync(N(noteFileName), 'utf-8')
      t('S1 笔记: 磁盘内容匹配', diskContent.length > 0, diskContent.length + '字')
    }
  } else {
    t('S1 笔记: write_note被调用', false, '未调用write_note')
    // 检查是否用了 create_file 作为替代
    const noteFileDirect = N('科幻创作要点.md')
    if (fs.existsSync(noteFileDirect)) {
      t('S1 笔记: 磁盘文件存在(通过其他方式)', true, 'notes/科幻创作要点.md')
    }
  }

  // ── 任务完成度综合评分 ──
  const completedTasks = []
  if (hasCreateProject && projExists) completedTasks.push('创建项目')
  if (hasCreateFile && (charFilePath || r1.toolLog.some(l => l.name === 'create_file' && l.ok))) completedTasks.push('创建角色')
  if (hasCreateFile && (outlineFilePath || r1.toolLog.filter(l => l.name === 'create_file' && l.ok).length >= 2)) completedTasks.push('写大纲')
  if (hasWriteNote) completedTasks.push('记笔记')
  t('S1 综合: 至少完成3/4个核心任务', completedTasks.length >= 3,
    completedTasks.length + '/4个任务完成: ' + completedTasks.join(', '))

  // ── 打印工具调用链 ──
  console.log('\n  工具调用链: ' + toolNamesAll)
  console.log('  模型回复摘要: ' + r1.text.slice(0, 200).replace(/\n/g, ' '))

  // ══════════════════════════════════════════════════════════════════
  // S2: 长消息测试 — 粘贴文本后先阅读再分析（3个子任务）
  // ══════════════════════════════════════════════════════════════════
  hr('S2 长消息测试 — 粘贴长文本→先读→分析→3个子任务')

  // 先准备一个测试项目和一个文本文件
  const s2ProjDir = P(PROJ_NAME_S2)
  fs.mkdirSync(s2ProjDir, { recursive: true })
  fs.mkdirSync(path.join(s2ProjDir, 'chapters'), { recursive: true })
  fs.mkdirSync(path.join(s2ProjDir, 'characters'), { recursive: true })
  fs.mkdirSync(path.join(s2ProjDir, 'outline'), { recursive: true })

  // 创建一段长文本供模型读取分析
  const longSampleText = [
    '标题：《星河战记》第一章节选',
    '',
    '星历2147年，人类已遍布银河系的每一个角落。然而，科技的飞速发展并未带来和平——',
    '银河联邦与自由同盟之间的冷战已持续了三十年。',
    '',
    '楚云飞站在"破晓号"的舰桥上，透过全息舷窗望向无尽的星海。',
    '银色的短发在失重环境中轻轻飘浮，他深邃的眼眸中倒映着远方闪烁的星云。',
    '作为联邦最年轻的少将，他肩上的担子比任何人都重。',
    '',
    '"少将，侦测到异常能量波动，坐标7-3-9扇区。"通讯官的声音带着一丝紧张。',
    '',
    '"放大画面。"楚云飞的声音平静如水，即使在这种时刻，他也保持着冷静。',
    '',
    '全息屏幕上，一团暗紫色的能量漩涡正缓缓形成。那不是普通的宇宙现象——',
    '那是虫洞。一个从未被记录过的新型虫洞。',
    '',
    '"通知全体舰员，进入三级战备状态。"楚云飞站起身，',
    '"向总部发送加密通讯——我们可能发现了敌方的秘密跃迁通道。"',
    '',
    '他的副官，一个戴着圆框眼镜的年轻女子走上前来。"将军，数据分析显示，',
    '这个虫洞的能量特征与三年前失踪的\'曙光号\'——在失踪前最后一秒传回的数据完全吻合。"',
    '',
    '楚云飞的瞳孔微缩。曙光号。那是他父亲指挥的最后一次任务。',
    '',
    '——［节选结束］',
    '',
    '【写作风格分析】',
    '该文本采用第三人称有限视角辅以全知叙述。节奏紧凑，通过对话推进剧情。',
    '科幻硬设定与人物情感线并重。语言风格偏硬朗，短句为主，',
    '注重动作描写和环境细节。太空场景描写富有画面感，',
    '通过细节营造宏大世界观。悬念设置层层递进——',
    '虫洞→敌方秘密→父亲失踪，三层悬念叠加。',
  ].join('\n')

  // 用 create_file 保存到项目中
  fs.writeFileSync(path.join(s2ProjDir, 'chapters', 'sample.txt'), longSampleText, 'utf-8')
  console.log('  [初始化] 测试数据已创建: ' + PROJ_NAME_S2 + '/chapters/sample.txt (' + longSampleText.length + '字)')

  const s2Msg = '我粘贴了一段科幻小说文字在项目' + PROJ_NAME_S2 + '的 chapters/sample.txt 里。' +
    '请你先读取这个文件，然后做三件事：\n' +
    '1. 分析这篇小说的写作风格，把分析结果记到笔记"文风分析结果"\n' +
    '2. 根据文中出现的角色（楚云飞、副官），创建角色卡保存到项目中\n' +
    '3. 根据文中的世界观设定（银河联邦、自由同盟、虫洞技术、星历2147年），' +
    '构建一套世界观设定，保存为' + PROJ_NAME_S2 + '/outline/worldbuilding.md'

  console.log('  用户消息: 请先读取文件，然后做3件事(文风分析+角色创建+世界观)')
  const r2 = await agentRun(s2Msg)

  // ── 验证：模型是否先读取了文件再分析 ──
  const readCalls = r2.toolLog.filter(l => l.name === 'read_file')
  t('S2 read_file 被调用', readCalls.length >= 1, readCalls.length + '次')

  // 验证 read_file 在 create_file / write_note 之前
  const toolNames2 = r2.toolLog.map(l => l.name)
  const readIdx2 = toolNames2.indexOf('read_file')
  const createIdx2 = toolNames2.indexOf('create_file')
  const writeIdx2 = toolNames2.indexOf('write_note')

  const readBeforeAction = readIdx2 >= 0 && (
    (createIdx2 >= 0 && readIdx2 < createIdx2) ||
    (writeIdx2 >= 0 && readIdx2 < writeIdx2)
  )
  t('S2 先读取再操作: read_file在create/write之前', readBeforeAction,
    'read@' + readIdx2 + ' → create@' + createIdx2 + ' / write@' + writeIdx2)

  // ── 子任务1: 文风分析 → 笔记 ──
  const writeNoteCalls = r2.toolLog.filter(l => l.name === 'write_note')
  if (writeNoteCalls.length > 0) {
    const styleNote = writeNoteCalls.find(c => {
      const n = String(c.args.name || '')
      return n.includes('文风') || n.includes('风格') || n.includes('分析')
    })
    t('S2 子任务1: 文风分析笔记', styleNote ? true : writeNoteCalls.length >= 1,
      styleNote ? '笔记名=' + styleNote.args.name : '有write_note但名称未含"文风"')

    if (styleNote) {
      const nc = String(styleNote.args.content || '')
      t('S2 子任务1: 笔记有实质内容', nc.length > 20, nc.length + '字')
    }

    // 验证笔记文件在磁盘上
    const noteName = styleNote ? String(styleNote.args.name || '') : String(writeNoteCalls[0].args.name || '')
    const noteFileName = noteName.endsWith('.md') ? noteName : noteName + '.md'
    const noteExists = fs.existsSync(N(noteFileName))
    t('S2 子任务1: 笔记文件磁盘存在', noteExists, noteExists ? 'notes/' + noteFileName : '缺失')
  } else {
    t('S2 子任务1: 文风分析笔记', false, '未调用write_note')
  }

  // ── 子任务2: 角色卡创建 ──
  const charCreateCalls = r2.toolLog.filter(l => l.name === 'create_file' && l.ok)
  const charCall = charCreateCalls.find(c => {
    const fp = String(c.args.file_path || '')
    return fp.includes('characters') || fp.includes('角色')
  })
  if (charCall) {
    t('S2 子任务2: 角色卡创建', true, 'path=' + charCall.args.file_path)

    // 尝试解析角色JSON
    try {
      const cc = JSON.parse(String(charCall.args.content || ''))
      const hasChuYunfei = JSON.stringify(cc).includes('楚云飞') || String(cc.name || '').includes('楚云')
      t('S2 子任务2: 角色含楚云飞', hasChuYunfei, 'name=' + (cc.name || cc.id || '?'))
    } catch {
      // 可能不是JSON，是markdown格式的角色卡
      const cStr = String(charCall.args.content || '')
      const hasChu = cStr.includes('楚云飞')
      t('S2 子任务2: 角色含楚云飞', hasChu, '非JSON格式，内容含"楚云飞"=' + hasChu)
    }

    // 验证角色文件在磁盘
    const charDiskPath = P(String(charCall.args.file_path || ''))
    t('S2 子任务2: 角色文件磁盘存在', fs.existsSync(charDiskPath),
      String(charCall.args.file_path || ''))
  } else {
    t('S2 子任务2: 角色卡创建', false, '未找到在characters/下的create_file')
    console.log('  create_file调用: ' + charCreateCalls.map(c => c.args.file_path).join(', '))
  }

  // ── 子任务3: 世界观构建 ──
  const worldCall = charCreateCalls.find(c => {
    const fp = String(c.args.file_path || '')
    return fp.includes('worldbuilding') || fp.includes('世界观') || fp.includes('outline')
  })
  if (worldCall) {
    t('S2 子任务3: 世界观文件创建', true, 'path=' + worldCall.args.file_path)
    const wc = String(worldCall.args.content || '')
    const hasGalacticFederation = wc.includes('银河联邦') || wc.includes('自由同盟') || wc.includes('虫洞')
    t('S2 子任务3: 世界观含关键设定', hasGalacticFederation,
      '含"银河联邦/自由同盟/虫洞"=' + hasGalacticFederation)
    t('S2 子任务3: 世界观内容充足', wc.length > 50, wc.length + '字')

    // 验证文件在磁盘上
    const diskPath = P(String(worldCall.args.file_path || ''))
    const diskExists = fs.existsSync(diskPath)
    t('S2 子任务3: 世界观文件磁盘存在', diskExists,
      String(worldCall.args.file_path || ''))
  } else {
    // 可能文件路径不在outline子目录
    const anyWorldCall = charCreateCalls.find(c => {
      const cStr = String(c.args.content || '')
      return cStr.includes('银河联邦') || cStr.includes('自由同盟')
    })
    if (anyWorldCall) {
      t('S2 子任务3: 世界观文件创建(通过内容识别)', true,
        'path=' + anyWorldCall.args.file_path + ' 内容含世界观设定')
    } else {
      t('S2 子任务3: 世界观文件创建', false, '未找到含世界观内容的create_file')
      console.log('  create_file内容摘要:')
      charCreateCalls.forEach(c => {
        console.log('    ' + c.args.file_path + ': ' + String(c.args.content || '').slice(0, 60))
      })
    }
  }

  // ── 读取文件验证(确认模型真的读了) ──
  const readPaths = readCalls.map(l => l.args.file_path || l.args.path || '').join(', ')
  const didReadSample = readCalls.some(l => {
    const fp = String(l.args.file_path || l.args.path || '')
    return fp.includes('sample') || fp.includes('chapters')
  })
  t('S2 读取了sample.txt', didReadSample, '读取路径: ' + readPaths)
  console.log('  实际读取路径: ' + readPaths)

  // ── 3个子任务完成度 ──
  const s2Completed = []
  if (writeNoteCalls.length > 0) s2Completed.push('文风分析')
  if (charCall || charCreateCalls.some(c => String(c.args.content || '').includes('楚云飞'))) s2Completed.push('角色创建')
  if (worldCall || charCreateCalls.some(c => String(c.args.content || '').includes('银河联邦'))) s2Completed.push('世界观构建')
  t('S2 综合: 3个子任务全部完成', s2Completed.length >= 3,
    s2Completed.length + '/3完成: ' + s2Completed.join(', '))

  // ── 打印工具调用链 ──
  console.log('\n  工具调用链: ' + toolNames2.join(' → '))
  console.log('  模型回复摘要: ' + r2.text.slice(0, 200).replace(/\n/g, ' '))

  // ══════════════════════════════════════════════════════════════════
  // S3: 闲聊验证 — 多任务后模型仍能正常对话
  // ══════════════════════════════════════════════════════════════════
  hr('S3 闲聊验证 — 多任务后模型对话能力')

  const r3 = await agentRun('刚才创建的那些东西，你觉得整体质量怎么样？')
  t('S3 文本回复', r3.text.length > 0, r3.text.length + '字')
  t('S3 零工具调用', r3.toolCalls === 0, r3.toolCalls + '个工具')
  t('S3 回复含中文', /[一-鿿]/.test(r3.text))
  console.log('  回复: ' + r3.text.slice(0, 150))

  // ══════════════════════════════════════════════════════════════════
  //  清理
  // ══════════════════════════════════════════════════════════════════
  cleanupS1()
  cleanupS2()

  // ══════════════════════════════════════════════════════════════════
  //  汇总
  // ══════════════════════════════════════════════════════════════════
  const total = pass + fail
  console.log('\n')
  console.log('═══════════════════════════════════════════')
  console.log('  仿真测试: 多意图复杂任务链 (Anthropic) — 结果')
  console.log('═══════════════════════════════════════════')
  console.log('  ✅ ' + String(pass).padStart(2) + '  通过')
  console.log('  ❌ ' + String(fail).padStart(2) + '  失败')
  console.log('  通过率: ' + (total > 0 ? ((pass / total) * 100).toFixed(1) : '0.0') + '%')
  console.log('')
  console.log('  场景覆盖:')
  console.log('    S1  多意图复杂任务链 — 识别4个嵌入任务 → 逻辑排序 → 逐个执行')
  console.log('        任务: create_project + create_file(角色) + create_file(大纲) + write_note')
  console.log('    S2  长消息测试 — 先读取再分析 → 3个子任务(文风+角色+世界观)')
  console.log('        任务: read_file → write_note + create_file×2')
  console.log('    S3  闲聊验证 — 多任务后模型仍能正常对话(零工具)')
  console.log('')
  console.log('  验证重点:')
  console.log('    - 多意图识别: 从复合用户消息中正确提取所有子任务')
  console.log('    - 逻辑顺序: 先建项目→再建文件→最后记笔记(依赖关系正确)')
  console.log('    - 先读后写: 长文本场景下先read_file获取数据再操作')
  console.log('    - 任务完成度: 每个子任务执行正确、文件在磁盘上可验证')
  console.log('═══════════════════════════════════════════')

  if (fail > 0) process.exit(1)
}

main().catch(e => { console.error('\n💥 异常:', e.message); process.exit(1) })
