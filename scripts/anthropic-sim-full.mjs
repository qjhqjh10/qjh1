#!/usr/bin/env node
/**
 * Anthropic 协议全面仿真测试 — 测试方案2.md 全部 10 个场景
 *
 * 实际调用 DeepSeek /anthropic/v1/messages 端点，
 * 模拟完整 Agent 循环，实现全部工具。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_ROOT = path.resolve(__dirname, '..')
const PROJECTS_DIR = path.join(APP_ROOT, 'projects')
const KB_DIR = path.join(APP_ROOT, 'knowledge_base', 'files')
const NOTES_DIR = path.join(APP_ROOT, 'notes')
const STYLE_TEMPLATES_DIR = path.join(APP_ROOT, 'style_templates')
const SCENE_TEMPLATES_DIR = path.join(APP_ROOT, 'scene_templates')

// ── 配置 ──
const API_KEY = process.env.AI_API_KEY || 'sk-your-key-here'
const API_BASE = 'https://api.deepseek.com'
const ANTHROPIC_URL = `${API_BASE}/anthropic/v1/messages`
const MODEL = 'deepseek-chat'
const MAX_ITERATIONS = 10

// ── 计数器 ──
let passCount = 0
let failCount = 0
let scenarioNum = 0
const failures = []

function ok(name, detail = '') { passCount++; console.log(`  ✅ ${name}${detail ? ': ' + detail : ''}`) }
function fail(name, detail = '') { failCount++; failures.push({ name, detail }); console.log(`  ❌ ${name}${detail ? ': ' + detail : ''}`) }
function check(cond, name, detail) { cond ? ok(name, detail) : fail(name, detail) }

// ── 文件读缓存 ──
const fileCache = new Map()
function readFileCached(fp) {
  const fullPath = path.join(PROJECTS_DIR, fp)
  if (fileCache.has(fullPath)) return { ...fileCache.get(fullPath), cached: true }
  try {
    const content = fs.readFileSync(fullPath, 'utf-8')
    const entry = { content, size: content.length }
    fileCache.set(fullPath, entry)
    return { ...entry, cached: false }
  } catch { return null }
}
function invalidateCache(fp) { fileCache.delete(path.join(PROJECTS_DIR, fp)) }

// ── 文件操作 ──
function safePath(fp) {
  const cleaned = fp.replace(/\\/g, '/').replace(/\.\./g, '')
  return cleaned.replace(/^\/+/, '')
}

function listDirectory(args) {
  const dir = safePath(args.path || args.dir_path || '.')
  const fp = path.join(PROJECTS_DIR, dir)
  try {
    const entries = fs.readdirSync(fp, { withFileTypes: true })
    let list = entries.map(e => `${e.isDirectory() ? 'DIR' : 'FILE'} ${e.name}`)
    if (args.pattern) {
      try {
        const re = new RegExp('^' + args.pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i')
        list = list.filter(f => re.test(f.replace(/^(DIR|FILE) /, '')))
      } catch { /* 无效正则，显示全部 */ }
    }
    const summary = `${list.length}个条目`
    return { status: 'success', summary, detail: list.join('\n') }
  } catch {
    return { status: 'error', summary: `目录不存在: ${dir}` }
  }
}

function readFile(args) {
  const fp = safePath(args.file_path || args.path || '')
  const entry = readFileCached(fp)
  if (!entry) return { status: 'error', summary: `文件不存在: ${fp}` }
  const preview = entry.content.length > 3000
    ? entry.content.slice(0, 3000) + `\n…(共${entry.size}字)`
    : entry.content
  const cacheTag = entry.cached ? ' (缓存)' : ''
  return { status: 'success', summary: `读取 ${fp} (${entry.size}字)${cacheTag}`, detail: preview }
}

function searchContent(args) {
  const searchPath = safePath(args.path || args.file_path || '.')
  const pattern = args.pattern || ''
  if (!pattern) return { status: 'error', summary: '缺少搜索模式' }
  const contextLines = args.context_around || args.contextAround || 0
  const filePattern = args.file_pattern || args.filePattern || '*'
  const useRegex = args.regex === true

  try {
    const fullPath = path.join(PROJECTS_DIR, searchPath)
    const results = []
    const re = new RegExp(useRegex ? pattern : pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')

    function searchDir(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const e of entries) {
        const fp = path.join(dir, e.name)
        if (e.isDirectory()) { searchDir(fp); continue }
        // file_pattern 过滤
        if (filePattern !== '*') {
          const re2 = new RegExp('^' + filePattern.replace(/\*/g, '.*') + '$', 'i')
          if (!re2.test(e.name)) continue
        }
        try {
          const content = fs.readFileSync(fp, 'utf-8')
          const lines = content.split('\n')
          for (let i = 0; i < lines.length; i++) {
            const match = lines[i].match(re)
            if (match) {
              let ctx = lines[i]
              if (contextLines > 0) {
                const start = Math.max(0, i - contextLines)
                const end = Math.min(lines.length, i + contextLines + 1)
                ctx = lines.slice(start, end).map((l, j) =>
                  `${start + j + 1}: ${l}`).join('\n')
              }
              results.push(`${fp.replace(/\\/g, '/')}:${i+1}: ${ctx}`)
            }
          }
        } catch {}
      }
    }

    if (fs.statSync(fullPath).isFile()) {
      // 单个文件
      const content = fs.readFileSync(fullPath, 'utf-8')
      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) results.push(`${searchPath}:${i+1}: ${lines[i].slice(0, 200)}`)
      }
    } else {
      searchDir(fullPath)
    }

    const detail = results.slice(0, 20).join('\n')
    return { status: 'success', summary: `找到 ${results.length} 个匹配`, detail }
  } catch (e) {
    return { status: 'error', summary: `搜索失败: ${e.message}` }
  }
}

function editFile(args) {
  const fp = safePath(args.file_path || args.path || '')
  const fullPath = path.join(PROJECTS_DIR, fp)
  try {
    const content = fs.readFileSync(fullPath, 'utf-8')
    let oldStr = args.old_string || args.old_str || ''
    let newStr = args.new_string || args.new_str || ''

    // __FULL_REPLACE__ magic value
    if (oldStr === '__FULL_REPLACE__') {
      fs.writeFileSync(fullPath, newStr, 'utf-8')
      invalidateCache(fp)
      return { status: 'success', summary: `全量替换 ${fp}` }
    }

    // 7 策略匹配
    const strategies = [
      // 1. 精确匹配
      () => [content.indexOf(oldStr)],
      // 2. trim 匹配
      () => [content.indexOf(oldStr.trim())],
      // 3. 全角半角归一
      () => {
        const norm = s => s.replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
        const idx = content.indexOf(norm(oldStr))
        return idx >= 0 ? [idx] : []
      },
      // 4. 中英文标点归一
      () => {
        const norm = s => s.replace(/，/g, ',').replace(/。/g, '.').replace(/"/g, '"').replace(/'/g, "'")
        const idx = content.indexOf(norm(oldStr))
        return idx >= 0 ? [idx] : []
      },
      // 5. 忽略行首空白
      () => {
        const lines = content.split('\n')
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].trimStart() === oldStr.trimStart()) return [content.indexOf(lines[i])]
        }
        return []
      },
    ]

    let matchPositions = []
    for (const strat of strategies) {
      matchPositions = strat()
      if (matchPositions.length > 0 && matchPositions[0] >= 0) break
    }

    if (matchPositions.length === 0 || matchPositions[0] < 0) {
      return { status: 'error', summary: `未找到匹配文本: "${oldStr.slice(0, 80)}"` }
    }

    const before = content.slice(0, matchPositions[0])
    const after = content.slice(matchPositions[0] + oldStr.length)
    fs.writeFileSync(fullPath, before + newStr + after, 'utf-8')
    invalidateCache(fp)
    return { status: 'success', summary: `编辑 ${fp} 成功` }
  } catch (e) {
    return { status: 'error', summary: `编辑失败: ${e.message}` }
  }
}

function createFile(args) {
  const fp = safePath(args.file_path || args.path || '')
  const fullPath = path.join(PROJECTS_DIR, fp)
  const content = args.content || ''

  // JSON 校验
  if (fp.endsWith('.json') && content) {
    try { JSON.parse(content) } catch (e) {
      return { status: 'error', summary: `JSON 格式错误: ${e.message}. 请修正后重试。` }
    }
  }

  try {
    fs.mkdirSync(path.dirname(fullPath), { recursive: true })
    fs.writeFileSync(fullPath, content, 'utf-8')
    invalidateCache(fp)
    return { status: 'success', summary: `创建 ${fp} (${content.length}字)` }
  } catch (e) {
    return { status: 'error', summary: `创建失败: ${e.message}` }
  }
}

function deleteFile(args) {
  const fp = safePath(args.file_path || args.path || '')
  const fullPath = path.join(PROJECTS_DIR, fp)
  try {
    fs.unlinkSync(fullPath)
    invalidateCache(fp)
    return { status: 'success', summary: `删除 ${fp}` }
  } catch {
    return { status: 'error', summary: `删除失败: ${fp}` }
  }
}

// ── KB 操作 ──
function kbList() {
  try {
    const files = fs.readdirSync(KB_DIR).filter(f => f.endsWith('.md'))
    const detail = files.map(f => `FILE ${f}`).join('\n')
    return { status: 'success', summary: `${files.length}个KB文件`, detail }
  } catch {
    return { status: 'success', summary: 'KB目录为空', detail: '' }
  }
}

function kbCreateFile(args) {
  const name = args.name || args.file_name || 'untitled.md'
  const content = args.content || ''
  const fp = path.join(KB_DIR, name.endsWith('.md') ? name : name + '.md')
  try {
    fs.mkdirSync(KB_DIR, { recursive: true })
    fs.writeFileSync(fp, content, 'utf-8')
    return { status: 'success', summary: `KB文件已创建: ${name}` }
  } catch (e) {
    return { status: 'error', summary: `KB创建失败: ${e.message}` }
  }
}

function kbAppendFile(args) {
  const name = args.name || args.file_name || ''
  const content = args.content || ''
  const fp = path.join(KB_DIR, name.endsWith('.md') ? name : name + '.md')
  try {
    if (!fs.existsSync(fp)) return { status: 'error', summary: `KB文件不存在: ${name}` }
    fs.appendFileSync(fp, '\n' + content, 'utf-8')
    return { status: 'success', summary: `KB文件已追加: ${name}` }
  } catch (e) {
    return { status: 'error', summary: `KB追加失败: ${e.message}` }
  }
}

// ── 笔记操作 ──
function listNotes() {
  try {
    fs.mkdirSync(NOTES_DIR, { recursive: true })
    const files = fs.readdirSync(NOTES_DIR).filter(f => f.endsWith('.md'))
    return { status: 'success', summary: `${files.length}条笔记`, detail: files.join('\n') }
  } catch {
    return { status: 'success', summary: '0条笔记', detail: '' }
  }
}

function readNote(args) {
  const name = args.name || args.file_name || ''
  const fp = path.join(NOTES_DIR, name.endsWith('.md') ? name : name + '.md')
  try {
    const content = fs.readFileSync(fp, 'utf-8')
    return { status: 'success', summary: `读取笔记: ${name}`, detail: content.slice(0, 2000) }
  } catch {
    return { status: 'error', summary: `笔记不存在: ${name}` }
  }
}

function writeNote(args) {
  const name = args.name || args.file_name || ''
  const content = args.content || ''
  const fp = path.join(NOTES_DIR, name.endsWith('.md') ? name : name + '.md')
  try {
    fs.mkdirSync(NOTES_DIR, { recursive: true })
    fs.writeFileSync(fp, content, 'utf-8')
    return { status: 'success', summary: `笔记已创建: ${name}` }
  } catch (e) {
    return { status: 'error', summary: `笔记创建失败: ${e.message}` }
  }
}

function appendNote(args) {
  const name = args.name || args.file_name || ''
  const content = args.content || ''
  const fp = path.join(NOTES_DIR, name.endsWith('.md') ? name : name + '.md')
  try {
    if (!fs.existsSync(fp)) return { status: 'error', summary: `笔记不存在: ${name}` }
    fs.appendFileSync(fp, '\n' + content, 'utf-8')
    return { status: 'success', summary: `笔记已追加: ${name}` }
  } catch (e) {
    return { status: 'error', summary: `笔记追加失败: ${e.message}` }
  }
}

function deleteNote(args) {
  const name = args.name || args.file_name || ''
  const fp = path.join(NOTES_DIR, name.endsWith('.md') ? name : name + '.md')
  try { fs.unlinkSync(fp); return { status: 'success', summary: `笔记已删除: ${name}` }
  } catch { return { status: 'error', summary: `笔记删除失败: ${name}` } }
}

function searchNotes(args) {
  const query = args.query || args.pattern || ''
  try {
    fs.mkdirSync(NOTES_DIR, { recursive: true })
    const files = fs.readdirSync(NOTES_DIR).filter(f => f.endsWith('.md'))
    const matches = []
    for (const f of files) {
      const content = fs.readFileSync(path.join(NOTES_DIR, f), 'utf-8')
      if (content.includes(query)) matches.push(f)
    }
    return { status: 'success', summary: `${matches.length}条匹配`, detail: matches.join('\n') }
  } catch { return { status: 'success', summary: '搜索完成', detail: '' } }
}

// ── 模板操作 ──
function createStyleTemplate(args) {
  const name = args.name || '未命名模板'
  const fp = path.join(STYLE_TEMPLATES_DIR, `${name}.json`)
  try {
    fs.mkdirSync(STYLE_TEMPLATES_DIR, { recursive: true })
    fs.writeFileSync(fp, JSON.stringify(args, null, 2), 'utf-8')
    return { status: 'success', summary: `风格模板已创建: ${name}` }
  } catch (e) {
    return { status: 'error', summary: `模板创建失败: ${e.message}` }
  }
}

function createSceneTemplate(args) {
  const name = args.name || '未命名场景'
  const fp = path.join(SCENE_TEMPLATES_DIR, `${name}.json`)
  try {
    fs.mkdirSync(SCENE_TEMPLATES_DIR, { recursive: true })
    fs.writeFileSync(fp, JSON.stringify(args, null, 2), 'utf-8')
    return { status: 'success', summary: `场景模板已创建: ${name}` }
  } catch (e) {
    return { status: 'error', summary: `场景创建失败: ${e.message}` }
  }
}

// ── 项目操作 ──
function createProject(args) {
  const name = args.name || 'new-project'
  const dir = path.join(PROJECTS_DIR, name)
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.mkdirSync(path.join(dir, 'characters'))
    fs.mkdirSync(path.join(dir, 'chapters'))
    fs.mkdirSync(path.join(dir, 'outline'))
    fs.mkdirSync(path.join(dir, 'detailed_outline'))
    fs.mkdirSync(path.join(dir, 'summaries'))
    return { status: 'success', summary: `项目已创建: ${name}` }
  } catch (e) {
    return { status: 'error', summary: `项目创建失败: ${e.message}` }
  }
}

function deleteProject(args) {
  const name = args.name || ''
  const dir = path.join(PROJECTS_DIR, name)
  try {
    fs.rmSync(dir, { recursive: true, force: true })
    return { status: 'success', summary: `项目已删除: ${name}` }
  } catch (e) {
    return { status: 'error', summary: `项目删除失败: ${e.message}` }
  }
}

// ── Harness 工具 ──
function listRules() {
  return { status: 'success', summary: '已学习规则列表', detail: '当前无自定义规则' }
}
function learnRule(args) {
  return { status: 'success', summary: `规则已学习: ${(args.rule || '').slice(0, 60)}` }
}
function listAudit() {
  return { status: 'success', summary: '审计记录', detail: '当前无审计记录' }
}
function listPrompts() {
  return { status: 'success', summary: '提示词列表', detail: '灵感/世界观/角色/大纲/细纲/章节/润色/续写/改写/摘要/审稿' }
}

// ── 全部工具注册 ──
const ALL_TOOLS = [
  { name: 'read_file',       fn: readFile },
  { name: 'list_directory',  fn: listDirectory },
  { name: 'search_content',  fn: searchContent },
  { name: 'edit_file',       fn: editFile },
  { name: 'create_file',     fn: createFile },
  { name: 'delete_file',     fn: deleteFile },
  { name: 'kb_list',         fn: kbList },
  { name: 'kb_create_file',  fn: kbCreateFile },
  { name: 'kb_append_file',  fn: kbAppendFile },
  { name: 'list_notes',      fn: listNotes },
  { name: 'read_note',       fn: readNote },
  { name: 'write_note',      fn: writeNote },
  { name: 'append_note',     fn: appendNote },
  { name: 'delete_note',     fn: deleteNote },
  { name: 'search_notes',    fn: searchNotes },
  { name: 'create_style_template', fn: createStyleTemplate },
  { name: 'create_scene_template', fn: createSceneTemplate },
  { name: 'create_project',  fn: createProject },
  { name: 'delete_project',  fn: deleteProject },
  { name: 'list_rules',      fn: listRules },
  { name: 'learn_rule',      fn: learnRule },
  { name: 'list_audit',      fn: listAudit },
  { name: 'list_prompts',    fn: listPrompts },
]

const TOOL_SCHEMAS = [
  { name: 'list_directory', description: '列出项目目录下的文件和子目录。用于探索项目结构。查看知识库文件请用kb_list，查看笔记请用list_notes，查看模板请用对应目录。', input_schema: { type: 'object', properties: { path: { type: 'string', description: '目录路径（相对于项目根目录）' }, pattern: { type: 'string', description: 'glob文件名过滤(可选)，如*.json' } }, required: ['path'] } },
  { name: 'read_file', description: '读取项目文件内容。读取前不需要先list_directory。', input_schema: { type: 'object', properties: { file_path: { type: 'string', description: '文件相对路径' } }, required: ['file_path'] } },
  { name: 'search_content', description: '在项目文件中搜索文本内容（支持正则和上下文行）。', input_schema: { type: 'object', properties: { pattern: { type: 'string', description: '搜索关键词或正则表达式' }, path: { type: 'string', description: '搜索目录或文件路径(可选)' }, context_around: { type: 'number', description: '显示前后N行上下文(可选)' }, file_pattern: { type: 'string', description: '限定文件名glob(可选)，如chapter3*' } }, required: ['pattern'] } },
  { name: 'edit_file', description: '编辑项目文件。必须先read_file确认原文，然后用old_string/new_string精确替换。old_string=__FULL_REPLACE__ 表示全量替换。', input_schema: { type: 'object', properties: { file_path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' } }, required: ['file_path', 'old_string', 'new_string'] } },
  { name: 'create_file', description: '创建新文件。JSON文件自动校验格式。', input_schema: { type: 'object', properties: { file_path: { type: 'string' }, content: { type: 'string' } }, required: ['file_path', 'content'] } },
  { name: 'delete_file', description: '删除项目文件（不可恢复！）。', input_schema: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] } },
  { name: 'kb_list', description: '列出知识库(KB)所有文件。KB是全局参考资料，不属项目目录。', input_schema: { type: 'object', properties: {}, required: [] } },
  { name: 'kb_create_file', description: '在知识库中创建新文件。路径: knowledge_base/files/文件名.md。', input_schema: { type: 'object', properties: { name: { type: 'string', description: '文件名(自动加.md)' }, content: { type: 'string' } }, required: ['name', 'content'] } },
  { name: 'kb_append_file', description: '追加内容到已存在的知识库文件（文件必须已存在，创建新文件用kb_create_file）。', input_schema: { type: 'object', properties: { name: { type: 'string' }, content: { type: 'string' } }, required: ['name', 'content'] } },
  { name: 'list_notes', description: '列出全局笔记目录所有笔记。笔记独立于项目。', input_schema: { type: 'object', properties: {}, required: [] } },
  { name: 'read_note', description: '读取指定笔记内容。', input_schema: { type: 'object', properties: { name: { type: 'string', description: '笔记文件名' } }, required: ['name'] } },
  { name: 'write_note', description: '创建新的笔记文件。如需追加内容到已有笔记，使用append_note。', input_schema: { type: 'object', properties: { name: { type: 'string', description: '笔记文件名(自动加.md)' }, content: { type: 'string' } }, required: ['name', 'content'] } },
  { name: 'append_note', description: '追加内容到已存在的笔记（笔记必须已存在，新笔记用write_note）。', input_schema: { type: 'object', properties: { name: { type: 'string' }, content: { type: 'string' } }, required: ['name', 'content'] } },
  { name: 'delete_note', description: '删除指定笔记。', input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'search_notes', description: '搜索笔记内容。', input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'create_style_template', description: '创建风格模板到 style_templates/ 目录。不需要先list_directory。', input_schema: { type: 'object', properties: { name: { type: 'string' }, type: { type: 'string', description: '小说类型' } }, required: ['name', 'type'] } },
  { name: 'create_scene_template', description: '创建场景模板到 scene_templates/ 目录。不需要先list_directory。', input_schema: { type: 'object', properties: { name: { type: 'string' }, type: { type: 'string', description: '小说类型' } }, required: ['name', 'type'] } },
  { name: 'create_project', description: '创建新项目（含标准子目录）。', input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'delete_project', description: '删除指定项目（不可恢复！）。', input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'list_rules', description: '列出所有已学习的自动规则。', input_schema: { type: 'object', properties: {}, required: [] } },
  { name: 'learn_rule', description: '学习并记录一条新的自动规则。', input_schema: { type: 'object', properties: { rule: { type: 'string', description: '规则内容' } }, required: ['rule'] } },
  { name: 'list_audit', description: '查看操作审计记录。', input_schema: { type: 'object', properties: {}, required: [] } },
  { name: 'list_prompts', description: '列出所有可用的提示词模板。', input_schema: { type: 'object', properties: {}, required: [] } },
]

const SYSTEM_PROMPT = `你是"青剑"，AI小说创作助手。

# 铁律 — 优先级最高
- 用户要求"修改/创建/删除/编辑"→ 必须实际调用工具完成。只读不加修改 = 任务未完成。
- "先读XX再做YY" → 读是手段，YY是目的。读了不执行YY = 失败。
- 口头描述≠操作完成，只有工具返回 status: success 才算完成。

# 工具选择指南
| 任务 | 正确工具 | 错误用法 |
|------|---------|---------|
| 查看项目文件/目录 | list_directory / read_file | — |
| 查找知识库文件 | kb_list | ❌不要用 list_directory |
| 查找笔记 | list_notes | ❌不要用 list_directory |
| 查看模板 | list_directory ../../style_templates | — |
| 搜索文件内容 | search_content | — |
| 创建新笔记 | write_note | ❌不要用 append_note |
| 追加已有笔记 | append_note | ❌不要用 write_note |
| 创建KB文件 | kb_create_file | — |
| 追加KB文件 | kb_append_file（文件须已存在） | — |
| 创建模板 | create_style_template / create_scene_template | —

# 文件路径速查
- 角色: {项目}/characters/{中文名}.json      例: 1/characters/林语晴.json
- 章节: {项目}/chapters/chapter{N}.txt       例: 1/chapters/chapter3.txt
- 细纲: {项目}/detailed_outline/chapter{N}.json
- 大纲: {项目}/outline/plot.md
- 摘要: {项目}/summaries/chapter{N}.md
- 风格模板: ../../style_templates/
- 场景模板: ../../scene_templates/

# 任务执行
- 简单任务(1个操作): 直接调工具，不做多余的事
- 复杂任务(读→分析→修改): 先读→根据读到的内容执行后续操作→完成
- 只做用户要求的操作，不多做也不少做
- 读取文件后只输出关键摘要（200字内），不输出全文

# 可用工具
${ALL_TOOLS.map(t => `- ${t.name}`).join('\n')}`

// ── API 调用 ──
async function callAnthropic(system, messages, toolDefs) {
  const body = {
    model: MODEL,
    system: [{ type: 'text', text: system }],
    messages,
    max_tokens: 4096,
    stream: true,
  }
  if (toolDefs?.length) body.tools = toolDefs.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }))

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}: ${err.slice(0, 300)}`)
  }

  return parseSSE(await res.text())
}

function parseSSE(text) {
  let fullText = ''
  const toolUses = []
  const blocks = []

  for (const chunk of text.split(/\n\n/)) {
    if (!chunk.trim()) continue
    const lines = chunk.split('\n')
    let data = '', evtType = ''
    for (const l of lines) {
      if (l.startsWith('event:')) evtType = l.slice(6).trim()
      else if (l.startsWith('data:')) data = l.slice(5).trim()
    }
    if (!data) continue
    try {
      const evt = JSON.parse(data)
      const type = evtType || evt.type || ''
      if (type === 'content_block_start') blocks.push({ ...evt.content_block, index: evt.index, inputJson: '' })
      else if (type === 'content_block_delta') {
        const idx = evt.index ?? blocks.length - 1
        const b = blocks.find(b => b.index === idx)
        if (!b) continue
        if (evt.delta?.type === 'text_delta') { b.text = (b.text||'') + evt.delta.text; fullText += evt.delta.text }
        if (evt.delta?.type === 'input_json_delta') { b.inputJson = (b.inputJson||'') + evt.delta.partial_json; try { b.input = JSON.parse(b.inputJson) } catch {} }
      } else if (type === 'content_block_stop') {
        const b = blocks.find(b => b.index === (evt.index ?? blocks.length-1))
        if (b?.type === 'tool_use') toolUses.push({ id: b.id, name: b.name, input: b.input || {} })
      }
    } catch {}
  }
  return { text: fullText, toolUses }
}

// ── Agent 循环 ──
async function agentRun(userMsg, history = []) {
  const msgs = [...history, { role: 'user', content: [{ type: 'text', text: userMsg }] }]
  let iterations = 0, totalTools = 0, fullText = ''
  const steps = []

  while (iterations < MAX_ITERATIONS) {
    iterations++
    process.stdout.write(`  [iter${iterations}] `)
    const result = await callAnthropic(SYSTEM_PROMPT, msgs, TOOL_SCHEMAS)
    if (result.text) fullText = result.text

    if (!result.toolUses.length) break

    process.stdout.write(`${result.toolUses.map(t=>t.name).join(', ')} `)

    // 构建 assistant 内容
    const asstContent = []
    if (result.text) asstContent.push({ type: 'text', text: result.text })
    for (const tu of result.toolUses) asstContent.push({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input })
    msgs.push({ role: 'assistant', content: asstContent })

    // 执行工具
    const toolResults = []
    for (const tu of result.toolUses) {
      const t = ALL_TOOLS.find(t => t.name === tu.name)
      const t0 = Date.now()
      const r = t ? await t.fn(tu.input) : { status: 'error', summary: `未知工具: ${tu.name}` }
      const ms = Date.now() - t0
      const icon = r.status === 'success' ? '✓' : '✗'
      process.stdout.write(`${icon} `)
      steps.push({ tool: tu.name, status: r.status, ms })
      totalTools++
      toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(r) })
    }
    // 合并到一条 user 消息（Anthropic 要求）
    msgs.push({ role: 'user', content: toolResults })
    process.stdout.write('\n')
  }

  return { text: fullText, iterations, toolCalls: totalTools, steps }
}

// ═══════════════════════════════════════════════
//  测试场景
// ═══════════════════════════════════════════════

async function testScenario(name, tests) {
  scenarioNum++
  console.log(`\n┌─ 场景 ${scenarioNum}: ${name} ─┐`)
  for (const t of tests) {
    console.log(`│ ${t.label} `)
    try {
      const r = await agentRun(t.prompt)
      const detail = `${r.iterations}轮 ${r.toolCalls}工具 ${r.steps.map(s=>s.tool+(s.status!=='success'?`❌(${s.status})`:''))}`
      process.stdout.write(`│ `)
      if (t.check) {
        const passed = t.check(r)
        passed ? ok(t.label, detail) : fail(t.label, detail)
      } else {
        ok(t.label, detail)
      }
    } catch (e) {
      fail(t.label, e.message)
    }
  }
  console.log(`└──────────────────────┘`)
}

// ── Main ──
async function main() {
  console.log('═══════════════════════════════════════════════')
  console.log('  Anthropic 全面仿真测试 — 测试方案2.md')
  console.log('═══════════════════════════════════════════════')

  // 场景 1：列出+读取
  await testScenario('列出+读取 (Glob + 缓存)', [
    { label: 'S1-1 列出所有角色', prompt: '列出项目1的characters目录下所有.json文件', check: r => r.toolCalls >= 1 && r.steps.some(s => s.tool === 'list_directory') },
    { label: 'S1-2 读取林语晴', prompt: '读取项目1的角色林语晴，路径 1/characters/林语晴.json', check: r => r.toolCalls >= 1 && r.steps.some(s => s.tool === 'read_file') },
    { label: 'S1-3 再次读取林语晴(缓存)', prompt: '再次读取 1/characters/林语晴.json', check: r => r.steps.some(s => s.tool === 'read_file') },
    { label: 'S1-4 列出所有章节txt', prompt: '列出项目1的chapters目录下所有txt文件', check: r => r.toolCalls >= 1 },
  ])

  // 场景 2：搜索
  await testScenario('内容搜索 (regex + 上下文)', [
    { label: 'S2-1 搜索"林语晴"', prompt: '在项目1的chapters目录搜索"林语晴"，显示前后2行上下文', check: r => r.toolCalls >= 1 },
    { label: 'S2-2 搜索"张明"不区分大小写', prompt: '在项目1搜索"张明"，只要第3章的文件', check: r => r.toolCalls >= 1 },
  ])

  // 场景 3：精准编辑
  await testScenario('精准编辑 (edit_file)', [
    { label: 'S3-1 读取测试角色', prompt: '读取项目1的角色测试角色: 1/characters/测试角色.json', check: r => r.toolCalls >= 1 },
    { label: 'S3-2 修改测试角色描述', prompt: '把项目1的角色测试角色(1/characters/测试角色.json)的background字段改成"这是一个测试角色的背景故事，用于验证编辑功能。"', check: r => r.toolCalls >= 2 },
  ])

  // 场景 4：文件创建
  await testScenario('文件创建 (create_file + JSON校验)', [
    { label: 'S4-1 创建角色赵云', prompt: '参考项目1已有的角色格式(read_file 1/characters/林语晴.json)，创建一个新角色赵云。角色信息：id=zhaoyun, name=赵云, role=男配, gender=男, age=28, occupation=将军, background=常山赵子龙, appearance=身高八尺面貌英俊, personality=忠勇双全, abilities=枪法如神, weaknesses=过于刚直, relationships=与张明是好友, relationshipTags=["好友"], arc=从默默无闻到名震天下, importance=85。写入 1/characters/赵云.json', check: r => r.toolCalls >= 2 },
  ])

  // 场景 5：知识库
  await testScenario('知识库操作 (kb)', [
    { label: 'S5-1 KB列表', prompt: '列出知识库的所有文件', check: r => r.toolCalls >= 1 },
    { label: 'S5-2 创建KB文件', prompt: '创建一个知识库文件记录林语晴的角色要点，内容包括姓名、角色定位(女主)、性格特点和关键剧情', check: r => r.toolCalls >= 1 },
  ])

  // 场景 6：笔记
  await testScenario('笔记操作 (notes)', [
    { label: 'S6-1 列出笔记', prompt: '列出所有笔记', check: r => r.toolCalls >= 1 },
    { label: 'S6-2 写笔记', prompt: '写一条笔记：第3章改写思路：增加林语晴和张明的冲突戏份', check: r => r.toolCalls >= 1 },
    { label: 'S6-3 读笔记', prompt: '读取笔记"第3章改写思路"', check: r => r.toolCalls >= 1 },
    { label: 'S6-4 追加笔记', prompt: '追加内容到笔记"第3章改写思路"：另外考虑增加世界观设定的细节描写', check: r => r.toolCalls >= 1 },
    { label: 'S6-5 搜索笔记', prompt: '搜索笔记中包含"改写"的笔记', check: r => r.toolCalls >= 1 },
    { label: 'S6-6 删除笔记', prompt: '删除笔记"第3章改写思路"', check: r => r.toolCalls >= 1 },
  ])

  // 场景 7：模板
  await testScenario('风格/场景模板', [
    { label: 'S7-1 创建风格模板', prompt: '创建一个简洁风格模板，name=测试风格模板, type=普通小说', check: r => r.toolCalls >= 1 },
    { label: 'S7-2 创建场景模板', prompt: '创建一个战斗场景模板，name=测试战斗场景, type=武侠小说', check: r => r.toolCalls >= 1 },
  ])

  // 场景 8：项目管理
  await testScenario('项目管理', [
    { label: 'S8-1 创建项目', prompt: '创建一个新项目叫test-anthropic-demo', check: r => r.toolCalls >= 1 },
    { label: 'S8-2 删除项目', prompt: '删除项目test-anthropic-demo', check: r => r.toolCalls >= 1 },
  ])

  // 场景 9：读写混合
  await testScenario('读写混合 (复杂编排)', [
    { label: 'S9-1 读+写摘要', prompt: '读取项目1的第3章(1/chapters/chapter3.txt)，然后写一个200字摘要保存到 1/summaries/chapter3.md', check: r => r.toolCalls >= 2 },
    { label: 'S9-2 读细纲+改状态', prompt: '读取项目1第3章的细纲(1/detailed_outline/chapter3.json)，把status改成completed', check: r => r.toolCalls >= 2 },
  ])

  // 场景 10：Harness 工具
  await testScenario('Harness 工具', [
    { label: 'S10-1 列出规则', prompt: '列出已学习的规则', check: r => r.toolCalls >= 1 },
    { label: 'S10-2 学习规则', prompt: '学习一条新规则：角色JSON的importance字段范围是0-100', check: r => r.toolCalls >= 1 },
    { label: 'S10-3 审计记录', prompt: '查看审计记录', check: r => r.toolCalls >= 1 },
    { label: 'S10-4 列出提示词', prompt: '列出可用的提示词', check: r => r.toolCalls >= 1 },
  ])

  // 汇总
  const total = passCount + failCount
  console.log(`\n\n═══════════════════════════════════════════════`)
  console.log(`  测试结果汇总`)
  console.log(`═══════════════════════════════════════════════`)
  console.log(`  总计: ${total} | ✅ ${passCount} | ❌ ${failCount}`)
  console.log(`  通过率: ${total > 0 ? ((passCount/total)*100).toFixed(1) : '0'}%\n`)

  if (failures.length) {
    console.log('  失败详情:')
    for (const f of failures) console.log(`    ❌ ${f.name}: ${f.detail}`)
  }
}

main().catch(e => { console.error('\n💥 测试异常:', e.message); process.exit(1) })
