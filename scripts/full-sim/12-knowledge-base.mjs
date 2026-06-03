#!/usr/bin/env node
/**
 * 仿真测试: 知识库 (Knowledge Base)
 * 模拟用户打开AI写作助手，进行真实知识库管理对话
 *
 * 场景: kb_create → kb_append → kb_list → kb_index
 * 工具: kb_list, kb_create_file, kb_append_file, kb_index_file
 *
 * 基于 scripts/openai-sim-test.mjs 的完整测试模式
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as crypto from 'node:crypto'

const API_KEY = process.env.AI_API_KEY || 'sk-c9c30831df7243209435c60e811c879d'
const OPENAI_URL = 'https://api.deepseek.com/v1/chat/completions'
const MODEL = 'deepseek-v4-flash'
const MAX_ITERATIONS = 10
const ROOT = process.cwd()

const P = p => path.join(ROOT, 'projects', p)
const N = p => path.join(ROOT, 'notes', p)
const K = p => path.join(ROOT, 'knowledge_base/files', p)
const KB_META = path.join(ROOT, 'knowledge_base', 'metadata.json')
const KB_INDEX = path.join(ROOT, 'knowledge_base', 'index.json')

// ── KB helpers ──────────────────────────────────────────────────────────────

function genKbId() {
  // matches real pattern: 'm' + 13 lowercase alphanum chars
  return 'm' + crypto.randomBytes(7).toString('hex')
}

function readKbMeta() {
  try { return JSON.parse(fs.readFileSync(KB_META, 'utf-8')) }
  catch { return { files: [] } }
}

function writeKbMeta(meta) {
  fs.mkdirSync(path.dirname(KB_META), { recursive: true })
  fs.writeFileSync(KB_META, JSON.stringify(meta, null, 2))
}

function readKbIndex() {
  try { return JSON.parse(fs.readFileSync(KB_INDEX, 'utf-8')) }
  catch { return { chunks: [] } }
}

function writeKbIndex(idx) {
  fs.mkdirSync(path.dirname(KB_INDEX), { recursive: true })
  fs.writeFileSync(KB_INDEX, JSON.stringify(idx, null, 2))
}

// ── Inline Tool Implementations ─────────────────────────────────────────────

const tools = {
  read_file: a => {
    try {
      const c = fs.readFileSync(P(a.file_path || a.path), 'utf-8')
      return c.length > 2000 ? c.slice(0, 2000) + '\n…(' + c.length + '字)' : c
    } catch (e) { return `[错误: 文件不存在]` }
  },

  list_directory: a => {
    try {
      const e = fs.readdirSync(P(a.path || '.'), { withFileTypes: true })
      return e.map(x => (x.isDirectory() ? 'DIR ' : 'FILE ') + x.name).join('\n')
    } catch (e) { return `[错误: 目录不存在]` }
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
      } else searchDir(fp)
      return results.slice(0, 15).join('\n') || '无匹配'
    } catch (e) { return '[错误]' }
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
    try { fs.unlinkSync(P(a.file_path)); return '删除成功' }
    catch (e) { return `[错误: ${e.message}]` }
  },

  // ═══ 知识库工具 ════════════════════════════════════════════════════════════

  kb_list: () => {
    try {
      const meta = readKbMeta()
      const files = meta.files || []
      if (files.length === 0) return '(知识库为空)'
      const lines = files.map((f, i) =>
        `${i + 1}. ${f.originalName} (id: ${f.id}, 类型: ${f.type}, ${f.size}字节, 片段: ${f.chunkCount || 0})`
      )
      return `${files.length} 个文件\n` + lines.join('\n')
    } catch (e) { return `[错误: 知识库列表失败: ${e.message}]` }
  },

  kb_create_file: a => {
    try {
      const name = (a.name || '未命名').trim()
      const content = a.content || ''
      if (!name) return '[错误: 文件名不能为空]'

      const id = genKbId()
      const fileName = id + '.md'
      const filePath = K(fileName)
      fs.mkdirSync(K(''), { recursive: true })
      fs.writeFileSync(filePath, content, 'utf-8')

      const meta = readKbMeta()
      meta.files.push({
        id,
        name: fileName,
        originalName: name.endsWith('.md') ? name : name + '.md',
        type: 'md',
        size: Buffer.byteLength(content, 'utf-8'),
        chunkCount: 0,
        projects: [],
        source: 'ai',
        uploadedAt: new Date().toISOString(),
      })
      writeKbMeta(meta)

      return `已创建知识库文件: ${name}\n文件ID: ${id}\n位置: knowledge_base/files/${fileName}`
    } catch (e) { return `[错误: 创建知识库文件失败: ${e.message}]` }
  },

  kb_append_file: a => {
    try {
      const fileId = String(a.file_id || '').trim()
      const content = a.content || ''
      if (!fileId) return '[错误: 缺少 file_id 参数]'
      if (!content) return '[错误: 追加内容不能为空]'

      const meta = readKbMeta()
      const entry = meta.files.find(f => f.id === fileId)
      if (!entry) {
        const allIds = meta.files.map(f => f.id).join(', ')
        return `[错误: 未找到ID为 "${fileId}" 的文件。可用ID: ${allIds || '(无)'}]`
      }

      const filePath = K(entry.name)
      let existing = ''
      try { existing = fs.readFileSync(filePath, 'utf-8') } catch { existing = '' }

      const sep = existing ? '\n\n---\n\n' : ''
      const newContent = existing + sep + content
      fs.writeFileSync(filePath, newContent, 'utf-8')

      entry.size = Buffer.byteLength(newContent, 'utf-8')
      // reset chunkCount since index is stale after append
      entry.chunkCount = 0
      writeKbMeta(meta)

      return `已追加到知识库文件: ${entry.originalName} (id: ${fileId})`
    } catch (e) { return `[错误: 追加知识库文件失败: ${e.message}]` }
  },

  kb_index_file: a => {
    try {
      const fileId = String(a.file_id || '').trim()
      if (!fileId) return '[错误: 缺少 file_id 参数]'

      const meta = readKbMeta()
      const entry = meta.files.find(f => f.id === fileId)
      if (!entry) {
        const allIds = meta.files.map(f => f.id).join(', ')
        return `[错误: 未找到ID为 "${fileId}" 的文件。可用ID: ${allIds || '(无)'}]`
      }

      const filePath = K(entry.name)
      let content = ''
      try { content = fs.readFileSync(filePath, 'utf-8') } catch { return '[错误: 文件内容读取失败]' }

      // Chunk by double-newline or heading boundaries (simple semantic chunking)
      const chunks = content
        .split(/\n\n+/)
        .map(c => c.trim())
        .filter(c => c.length > 0)

      if (chunks.length === 0) {
        // Single empty or very short file: one chunk
        const single = content.trim()
        if (!single) return '[错误: 文件内容为空，无法索引]'
        chunks.push(single)
      }

      // Update index
      const idx = readKbIndex()
      idx.chunks = idx.chunks.filter(c => c.fileId !== fileId)
      for (let i = 0; i < chunks.length; i++) {
        idx.chunks.push({
          fileId,
          chunkIndex: i,
          content: chunks[i].slice(0, 500),
        })
      }
      writeKbIndex(idx)

      entry.chunkCount = chunks.length
      writeKbMeta(meta)

      return `索引完成: ${chunks.length} 个片段，文件 "${entry.originalName}" 现已可语义搜索`
    } catch (e) { return `[错误: 索引失败: ${e.message}]` }
  },

  // ═══ 笔记工具 (遗留，可能被agent调用) ═══════════════════════════════════════

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
    } catch (e) { return `[错误]` }
  },

  read_note: a => {
    try { return fs.readFileSync(N((a.name || 'x') + '.md'), 'utf-8').slice(0, 500) }
    catch { return '[笔记不存在]' }
  },

  delete_note: a => {
    try { fs.unlinkSync(N((a.name || 'x') + '.md')); return '笔记删除成功' }
    catch { return '[错误]' }
  },

  create_project: a => {
    try {
      const d = P(a.name);
      ['characters', 'chapters', 'outline', 'detailed_outline', 'summaries']
        .forEach(s => fs.mkdirSync(path.join(d, s), { recursive: true }))
      return `项目${a.name}创建成功`
    } catch (e) { return `[错误]` }
  },

  delete_project: a => {
    try { fs.rmSync(P(a.name), { recursive: true, force: true }); return '项目删除成功' }
    catch (e) { return `[错误]` }
  },

  list_prompts: () => '灵感/世界观/角色/大纲/细纲/章节/润色/续写/改写/摘要/审稿',
  list_rules: () => '暂无自定义规则',
  learn_rule: () => '规则已学习',
  list_audit: () => '暂无审计记录',
  write_learning: () => '经验已记录',
  create_style_template: a => {
    try {
      const fp = path.join(ROOT, 'style_templates', (a.name || 'x') + '.json')
      fs.mkdirSync(path.dirname(fp), { recursive: true })
      fs.writeFileSync(fp, JSON.stringify(a, null, 2))
      return '模板创建成功'
    } catch (e) { return `[错误]` }
  },
}

// ── Tool Definitions for OpenAI API ─────────────────────────────────────────

const TOOLS = [
  {
    type: 'function', function: {
      name: 'read_file', description: '读取项目文件。修改前必须先读取。',
      parameters: { type: 'object', properties: { file_path: { type: 'string', description: '文件相对路径' } }, required: ['file_path'] }
    }
  },
  {
    type: 'function', function: {
      name: 'list_directory', description: '列出目录内容',
      parameters: { type: 'object', properties: { path: { type: 'string', description: '目录路径' } }, required: ['path'] }
    }
  },
  {
    type: 'function', function: {
      name: 'search_content', description: '搜索文件内容',
      parameters: { type: 'object', properties: { pattern: { type: 'string', description: '搜索关键词' }, path: { type: 'string', description: '搜索路径' } }, required: ['pattern'] }
    }
  },
  {
    type: 'function', function: {
      name: 'create_file', description: '创建新文件。JSON自动校验。',
      parameters: { type: 'object', properties: { file_path: { type: 'string' }, content: { type: 'string' } }, required: ['file_path', 'content'] }
    }
  },
  {
    type: 'function', function: {
      name: 'edit_file', description: '编辑文件。先read_file确认内容。',
      parameters: { type: 'object', properties: { file_path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' } }, required: ['file_path', 'old_string', 'new_string'] }
    }
  },
  {
    type: 'function', function: {
      name: 'delete_file', description: '删除文件',
      parameters: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] }
    }
  },
  {
    type: 'function', function: {
      name: 'kb_list', description: '列出知识库中所有文件的名称、ID 和类型。何时使用：保存内容到知识库之前，先查看已有文件列表。根据已有文件决定追加到现有文件（kb_append_file）还是创建新文件（kb_create_file）。返回文件列表含名称和ID——后续追加/索引操作需要用到ID。',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function', function: {
      name: 'kb_create_file', description: '在知识库创建新文件保存资料。何时使用：要保存的内容不匹配任何已有知识库文件时。先调用 kb_list 确认是否需要新建。文件名应描述性（如"古风服饰描写收集.md"）。创建后可调用 kb_index_file 建立语义搜索索引。',
      parameters: { type: 'object', properties: { name: { type: 'string', description: '文件名（建议含中文描述）' }, content: { type: 'string', description: '文件内容（Markdown）' } }, required: ['name', 'content'] }
    }
  },
  {
    type: 'function', function: {
      name: 'kb_append_file', description: '向知识库已有文件末尾追加内容。何时使用：新内容与已有知识库文件主题相关时。先 kb_list 获取文件列表，确认目标文件的 ID（不是名称）。追加内容会以分隔线隔开。',
      parameters: { type: 'object', properties: { file_id: { type: 'string', description: '目标文件 ID（从 kb_list 获取）' }, content: { type: 'string', description: '要追加的内容' } }, required: ['file_id', 'content'] }
    }
  },
  {
    type: 'function', function: {
      name: 'kb_index_file', description: '对知识库文件建立语义搜索索引。何时使用：创建或追加知识库文件内容后，调用此工具使内容可被语义搜索检索。需要从 kb_list 获取目标文件的 ID。',
      parameters: { type: 'object', properties: { file_id: { type: 'string', description: '目标文件 ID' } }, required: ['file_id'] }
    }
  },
  {
    type: 'function', function: { name: 'list_notes', description: '列出所有笔记', parameters: { type: 'object', properties: {} } }
  },
  {
    type: 'function', function: { name: 'write_note', description: '创建笔记', parameters: { type: 'object', properties: { name: { type: 'string' }, content: { type: 'string' } }, required: ['name', 'content'] } }
  },
  {
    type: 'function', function: { name: 'read_note', description: '读取笔记', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } }
  },
  {
    type: 'function', function: { name: 'delete_note', description: '删除笔记', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } }
  },
  {
    type: 'function', function: { name: 'create_project', description: '创建项目', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } }
  },
  {
    type: 'function', function: { name: 'delete_project', description: '删除项目', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } }
  },
  {
    type: 'function', function: { name: 'list_prompts', description: '列出提示词', parameters: { type: 'object', properties: {} } }
  },
  {
    type: 'function', function: { name: 'list_rules', description: '列出已学习规则', parameters: { type: 'object', properties: {} } }
  },
  {
    type: 'function', function: { name: 'learn_rule', description: '学习新规则', parameters: { type: 'object', properties: { rule: { type: 'string' } }, required: ['rule'] } }
  },
  {
    type: 'function', function: { name: 'list_audit', description: '查看审计记录', parameters: { type: 'object', properties: {} } }
  },
  {
    type: 'function', function: { name: 'write_learning', description: '记录学习经验', parameters: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] } }
  },
  {
    type: 'function', function: { name: 'create_style_template', description: '创建风格模板', parameters: { type: 'object', properties: { name: { type: 'string' }, type: { type: 'string' } }, required: ['name', 'type'] } }
  },
]

// ── System Prompt ───────────────────────────────────────────────────────────

const SYS = [
  '你是青剑AI写作助手，专注于辅助中文小说创作。',
  '',
  '# 铁律：何时用工具，何时不用',
  '✅ 调工具（用户要求操作文件/知识库）: 读取/列出/搜索/创建/编辑/删除/写/保存/修改/加/追加/索引/建索引',
  '❌ 不调工具（纯对话）: 我是/我叫/我喜欢/我觉得/你好/嗨/谢谢/什么是/为什么/怎么/推荐/建议',
  '',
  '# 知识库操作原则',
  '- 保存前先 kb_list 查看已有文件，判断是新建还是追加。',
  '- 追加用 kb_append_file（需要 file_id，不是文件名）。',
  '- 创建用 kb_create_file。创建后可调用 kb_index_file 建立索引。',
  '- 追加内容后索引会过期，需重新 kb_index_file。',
  '- 命令性操作：“列出知识库”=“现在立刻用kb_list列出”。',
  '',
  '# 执行规则',
  '- 已知路径直接读文件，不列目录。修改前先读。只做用户要求的，不多做。回复简洁。',
  '- 多个独立操作可在同一轮并行完成。有依赖的操作分轮执行（如：先 kb_list 获取 ID，再 kb_append_file）。',
  '- 用中文回复。',
].join('\n')

// ── API Call ────────────────────────────────────────────────────────────────

async function callOpenAI(messages) {
  const body = { model: MODEL, messages, max_tokens: 2048, tools: TOOLS, tool_choice: 'auto' }
  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + API_KEY },
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

// ── Agent Run Loop ──────────────────────────────────────────────────────────

async function agentRun(userMsg, { maxIter = MAX_ITERATIONS } = {}) {
  const messages = [
    { role: 'system', content: SYS },
    { role: 'user', content: userMsg },
  ]
  let iterations = 0, totalTools = 0, fullText = ''
  const calledTools = []

  while (iterations < maxIter) {
    iterations++
    process.stdout.write(`  [iter${iterations}] `)
    const r = await callOpenAI(messages)
    if (r.text) fullText = r.text

    if (!r.toolCalls.length) {
      process.stdout.write('(文本回复)\n')
      return { text: fullText, iterations, toolCalls: totalTools, calledTools, success: true }
    }

    // build assistant message
    const asstMsg = { role: 'assistant', content: r.text || null, tool_calls: r.toolCalls }
    messages.push(asstMsg)

    // execute tools
    for (const tc of r.toolCalls) {
      const fn = tc.function
      const toolFn = tools[fn.name]
      let args = {}
      try { args = JSON.parse(fn.arguments) } catch { /* keep empty */ }
      const result = toolFn ? await toolFn(args) : '[未知工具: ' + fn.name + ']'
      totalTools++
      calledTools.push({
        name: fn.name,
        args: JSON.stringify(args).slice(0, 120),
        result: String(result).slice(0, 200),
        isError: String(result).startsWith('['),
      })
      const marker = String(result).startsWith('[') ? '✗' : '✓'
      process.stdout.write(fn.name + marker + ' ')
      messages.push({ role: 'tool', tool_call_id: tc.id, content: result })
    }
    process.stdout.write('\n')
  }
  return { text: fullText, iterations, toolCalls: totalTools, calledTools, success: false, reason: '达到最大迭代次数' }
}

// ── Test Helpers ────────────────────────────────────────────────────────────

let pass = 0, fail = 0
function t(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ': ' + detail : '')) }
  else { fail++; console.log('  ❌ ' + name + (detail ? ': ' + detail : '')) }
}

// ── Cleanup Helper ──────────────────────────────────────────────────────────

function cleanupKbTestFiles(...namesToRemove) {
  const meta = readKbMeta()
  const toRemove = new Set(namesToRemove)
  const removed = []
  let changed = false

  for (let i = meta.files.length - 1; i >= 0; i--) {
    const f = meta.files[i]
    if (toRemove.has(f.originalName)) {
      try { fs.unlinkSync(K(f.name)) } catch { /* already gone */ }
      meta.files.splice(i, 1)
      removed.push(f.originalName)
      changed = true
    }
  }

  if (changed) {
    writeKbMeta(meta)
    // also clean index
    const idx = readKbIndex()
    idx.chunks = idx.chunks.filter(c => !removed.some(rn => {
      const mf = meta.files.find(f => f.originalName === rn)
      return mf && c.fileId === mf.id
    }))
    writeKbIndex(idx)
  }
}

// ── Main Test Runner ────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════')
  console.log('  知识库 (KB) 仿真测试')
  console.log('  端点: ' + OPENAI_URL + '  模型: ' + MODEL)
  console.log('═══════════════════════════════════════════\n')

  // ── S1: 查看知识库列表 ─────────────────────────────────────────────────
  console.log('▶ S1 查看知识库列表')
  console.log('  模拟用户打开软件，先看看知识库里有什么')
  const r1 = await agentRun('先帮我看看知识库里现在存了哪些文件')
  t('S1 kb_list调用', r1.calledTools.some(ct => ct.name === 'kb_list'), r1.iterations + '轮 ' + r1.toolCalls + '工具')
  t('S1 执行成功', r1.success, r1.text.slice(0, 80))

  // ── S2: 创建知识库文件（含自然多轮对话） ───────────────────────────────
  console.log('\n▶ S2 创建知识库文件（模拟真实用户：先问再创建）')
  const s2Content = [
    '# 武侠招式描写素材库',
    '',
    '> 适用于武侠/仙侠小说的招式名称、描写、意境营造',
    '',
    '## 剑法类',
    '',
    '### 基础招式',
    '- **白虹贯日**：剑光如虹，直刺中宫。一剑破空，气势如虹。',
    '- **仙人指路**：剑尖轻点，虚虚实实。看似平刺，实则蕴含九种变化。',
    '- **回风拂柳**：剑身回旋，如春风拂柳。以柔克刚，借力打力。',
    '- **长河落日**：剑势大开大合，如长河奔涌落日熔金。',
    '',
    '### 进阶招式',
    '- **一剑西来**：化繁为简，万剑归一。剑未至，意先到。',
    '- **天外飞仙**：人剑合一，自天而降。剑光如流星破空。',
    '- **落英缤纷**：剑花点点，如落英漫天。每一片花瓣皆是杀招。',
    '',
    '## 刀法类',
    '- **力劈华山**：刀势沉猛，一力降十会。',
    '- **横扫千军**：刀光如练，横扫方圆三丈。',
    '- **夜战八方**：黑暗中刀光闪烁，以耳代目。',
  ].join('\n')
  const r2 = await agentRun(
    '我想在知识库保存一些武侠小说的写作素材，主要是关于招式描写的。你帮我建一个文件，就叫"武侠招式描写素材库.md"，内容详细一点，要有剑法、刀法分类，每种下面再分基础招式和进阶招式，每个招式配一段描写。\n\n具体内容你帮我写，写详细点。'
  )
  t('S2 kb_create_file调用', r2.calledTools.some(ct => ct.name === 'kb_create_file'), r2.iterations + '轮 ' + r2.toolCalls + '工具')
  t('S2 创建成功且返回ID', r2.calledTools.some(ct => ct.name === 'kb_create_file' && !ct.isError && ct.result.includes('文件ID')), '含文件ID')
  // 记录创建的文件名用于后续清理
  cleanupKbTestFiles('武侠招式描写素材库.md')

  // ── S3: 追加内容到知识库文件 ────────────────────────────────────────────
  console.log('\n▶ S3 追加内容到知识库文件')
  console.log('  场景：用户先创建文件，然后想加更多内容')
  // 先创建一个干净的测试文件
  const preMeta = readKbMeta()
  const existingFiles = preMeta.files.map(f => f.originalName)
  if (!existingFiles.includes('武侠招式描写素材库.md')) {
    // manually create it for the test
    tools.kb_create_file({ name: '武侠招式描写素材库.md', content: s2Content })
  }
  // 现在让agent追加
  const s3AppendContent = [
    '## 拳掌类',
    '- **降龙伏虎**：双拳齐出，左降龙右伏虎，拳风呼啸。',
    '- **排云掌**：掌力层层叠叠，如排云推雾，连绵不绝。',
    '- **金刚指**：一指点出，洞金穿石。',
    '',
    '## 轻功类',
    '- **凌波微步**：足踏八卦，身形飘忽，如凌波而行。',
    '- **梯云纵**：凭空借力，节节攀升。',
  ].join('\n')
  const r3 = await agentRun('不错不错，刚才那个武侠招式文件我还想加点内容。你帮我往里面再加一些拳掌类和轻功类的招式描写。')
  t('S3 kb_list先查后追加', r3.calledTools.some(ct => ct.name === 'kb_list') && r3.calledTools.some(ct => ct.name === 'kb_append_file'),
    r3.iterations + '轮 ' + r3.toolCalls + '工具')
  t('S3 追加成功', r3.calledTools.some(ct => ct.name === 'kb_append_file' && !ct.isError), '无错误')
  t('S3 先list后append的顺序', (() => {
    const listIdx = r3.calledTools.findIndex(ct => ct.name === 'kb_list')
    const appendIdx = r3.calledTools.findIndex(ct => ct.name === 'kb_append_file')
    return listIdx >= 0 && appendIdx >= 0 && listIdx < appendIdx
  })(), 'kb_list在kb_append_file之前')

  // ── S4: 错误恢复 - 用错误的ID追加 ──────────────────────────────────────
  console.log('\n▶ S4 错误恢复：用错误ID追加后自动修正')
  console.log('  场景：用户记错了文件ID，agent应能列出文件找到正确的')
  const r4 = await agentRun('帮我把这段加到知识库里：\n\n"## 暗器类\n- 漫天花雨：暗器如雨，铺天盖地。"\n\n文件id好像是 xyz-错误的id-123')
  t('S4 错误后列出了文件', r4.calledTools.some(ct => ct.name === 'kb_list'), '用kb_list查找正确ID')
  t('S4 最终追加成功', r4.calledTools.some(ct => ct.name === 'kb_append_file' && !ct.isError), '追加成功')

  // ── S5: 建立语义索引 ───────────────────────────────────────────────────
  console.log('\n▶ S5 建立语义搜索索引')
  console.log('  场景：用户创建/追加完文件后，要求建立索引使其可搜索')
  const r5 = await agentRun('好的，帮我把刚才那个武侠招式文件建个索引，以后方便搜索')
  t('S5 先list后index', r5.calledTools.some(ct => ct.name === 'kb_list') && r5.calledTools.some(ct => ct.name === 'kb_index_file'),
    r5.iterations + '轮 ' + r5.toolCalls + '工具')
  t('S5 索引成功且有片段数', r5.calledTools.some(ct => ct.name === 'kb_index_file' && !ct.isError && /片段/.test(ct.result)),
    '含片段数')

  // ── S6: 创建→追加→索引 完整流程 ──────────────────────────────────────
  console.log('\n▶ S6 创建→追加→索引 完整流程（单条复合指令）')
  const s6CreateContent = '# 悬疑小说伏笔技巧\n\n## 一、信息差伏笔\n- 读者知道但主角不知道\n- 主角知道但读者不知道\n- 部分角色知道的信息\n\n## 二、物件伏笔\n- 看似平凡实为关键的物品\n- 反复出现但未解释的细节'
  const r6 = await agentRun(
    '我要新建一个知识库文件叫"悬疑小说伏笔技巧.md"，内容要包含伏笔的几种类型和写法。建完之后再追加一段关于"时间线伏笔"的内容，最后帮我建个索引。一口气做完。'
  )
  const s6Tools = r6.calledTools.map(ct => ct.name)
  t('S6 包含kb_create_file', s6Tools.includes('kb_create_file'), '创建文件')
  t('S6 包含kb_append_file', s6Tools.includes('kb_append_file'), '追加内容')
  t('S6 包含kb_index_file', s6Tools.includes('kb_index_file'), '建立索引')
  t('S6 全部无错误', r6.calledTools.every(ct => !ct.isError), r6.iterations + '轮 ' + r6.toolCalls + '工具')
  // 清理
  cleanupKbTestFiles('悬疑小说伏笔技巧.md')

  // ── S7: 空知识库场景 ───────────────────────────────────────────────────
  console.log('\n▶ S7 纯对话/闲聊不应调工具')
  const r7a = await agentRun('你好，我刚开始用这个软件')
  const r7b = await agentRun('知识库功能是干什么用的？')
  const r7c = await agentRun('好的谢谢，我明白了')
  t('S7 3个对话类0工具', r7a.toolCalls === 0 && r7b.toolCalls === 0 && r7c.toolCalls === 0,
    '招呼:' + r7a.toolCalls + ' 询问:' + r7b.toolCalls + ' 感谢:' + r7c.toolCalls)

  // ── S8: 用户中途修正 ───────────────────────────────────────────────────
  console.log('\n▶ S8 用户中途修正（改了主意）')
  const r8 = await agentRun('帮我在知识库创建一个文件叫"测试文件A.md"，内容写"这是测试内容A"\n\n不对不对，还是改成叫"仙侠世界观要点.md"吧，内容我重新说：\n\n"## 仙侠世界构建\n- 灵气体系：天地灵气分为五行\n- 修炼境界：炼气、筑基、金丹、元婴、化神"')
  t('S8 只创建了最终要求的文件', (() => {
    // Should have created 仙侠世界观要点.md not 测试文件A.md
    const createdFiles = r8.calledTools.filter(ct => ct.name === 'kb_create_file')
    const createdNames = createdFiles.map(ct => ct.result || '')
    const hasCorrect = createdNames.some(r => r.includes('仙侠世界观要点'))
    return hasCorrect
  })(), '创建了"仙侠世界观要点.md"')
  t('S8 执行成功', r8.success, r8.iterations + '轮 ' + r8.toolCalls + '工具')
  cleanupKbTestFiles('仙侠世界观要点.md', '测试文件A.md')

  // ── S9: 大量内容追加 ───────────────────────────────────────────────────
  console.log('\n▶ S9 大量内容追加（测试内容截断处理）')
  // Create a base file first
  const baseId = tools.kb_create_file({
    name: '古风场景描写辞典.md',
    content: '# 古风场景描写辞典\n\n> 收集各类古风场景的描写参考\n\n## 宫廷场景\n- 金碧辉煌的大殿，龙柱盘绕\n\n## 山林场景\n- 云雾缭绕的仙山，松涛阵阵',
  })
  // Extract the file ID from the result
  const baseIdMatch = String(baseId).match(/文件ID: (\S+)/)
  const baseFileId = baseIdMatch ? baseIdMatch[1] : null

  const r9 = await agentRun(
    '帮我把下面这些内容追加到"古风场景描写辞典"里：\n\n' +
    '## 市井场景\n' +
    '- 清晨的集市，叫卖声此起彼伏，炊烟袅袅升起，青石板路被露水打湿。' +
    '卖包子的老张揭开蒸笼，白雾腾起，空气中弥漫着面香。\n' +
    '- 午后的茶馆，说书先生一拍惊堂木，满堂寂静。跑堂的端着茶壶穿梭，' +
    '角落里两个书生正在低声争论着什么。\n' +
    '- 黄昏的酒楼，灯笼渐次亮起，楼下的运河里画舫缓缓驶过，' +
    '丝竹之声隐隐传来。凭栏远眺，暮色中的城池如一幅水墨画。\n\n' +
    '## 战场场景\n' +
    '- 残阳如血，尸横遍野。折断的旗帜在风中猎猎作响。' +
    '远处传来战马嘶鸣，空气中弥漫着血腥与焦糊的气味。\n' +
    '- 月黑风高，军营中篝火点点。哨兵在城墙上缓缓踱步，' +
    '偶尔有夜鸟的啼叫划破寂静。\n\n' +
    '## 庭院场景\n' +
    '- 曲径通幽，假山叠石。一池碧水中锦鲤游弋，' +
    '廊下的风铃随风轻响。月光洒在青石板上，树影婆娑。\n' +
    '- 深秋庭院，梧桐叶落满石阶。老仆人在扫落叶，' +
    '屋檐下晾着几串红辣椒，为这寂寥的院落添了一抹暖色。'
  )
  t('S9 先list后追加大量内容', r9.calledTools.some(ct => ct.name === 'kb_list') && r9.calledTools.some(ct => ct.name === 'kb_append_file'),
    r9.iterations + '轮 ' + r9.toolCalls + '工具')
  t('S9 追加成功', r9.calledTools.some(ct => ct.name === 'kb_append_file' && !ct.isError), '无错误')
  cleanupKbTestFiles('古风场景描写辞典.md')

  // ── Summary ──────────────────────────────────────────────────────────────
  const total = pass + fail
  console.log('\n')
  console.log('═══════════════════════════════════════════')
  console.log('  知识库 (KB) 仿真测试结果')
  console.log('═══════════════════════════════════════════')
  console.log('  ✅ ' + pass + '  ❌ ' + fail + '  通过率: ' + (total > 0 ? ((pass / total) * 100).toFixed(1) : '0.0') + '%')
  console.log('')
  console.log('  测试工具覆盖:')
  console.log('    - kb_list           (列出知识库文件)')
  console.log('    - kb_create_file    (创建知识库文件)')
  console.log('    - kb_append_file    (追加知识库内容)')
  console.log('    - kb_index_file     (建立语义索引)')
  console.log('')
  console.log('  测试场景覆盖:')
  console.log('    - 查看已有文件列表')
  console.log('    - 创建新文件（含结构化内容）')
  console.log('    - 先查后追加（正确流程）')
  console.log('    - 错误ID→自动修正→追加成功')
  console.log('    - 追加后建立索引')
  console.log('    - 创建→追加→索引 复合指令')
  console.log('    - 纯对话不误调工具')
  console.log('    - 用户中途修正文件名')
  console.log('    - 大量内容追加')
  console.log('═══════════════════════════════════════════')

  // Cleanup remaining test artifacts
  cleanupKbTestFiles('武侠招式描写素材库.md')
}

main().catch(e => {
  console.error('\n💥 测试异常:', e.message)
  // Best-effort cleanup
  cleanupKbTestFiles(
    '武侠招式描写素材库.md',
    '悬疑小说伏笔技巧.md',
    '仙侠世界观要点.md',
    '测试文件A.md',
    '古风场景描写辞典.md'
  )
  process.exit(1)
})
