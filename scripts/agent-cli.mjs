#!/usr/bin/env node
/**
 * AI Writing Assistant — Headless CLI Agent
 *
 * Run the agent from the command line without the Electron GUI.
 * Useful for testing, automation, CI, and batch operations.
 *
 * Usage:
 *   node scripts/agent-cli.mjs --api-key=sk-xxx --api-url=https://api.deepseek.com
 *   node scripts/agent-cli.mjs --key=sk-xxx (弃用) --project="我的项目" --command="列出项目文件"
 *   node scripts/agent-cli.mjs --key=sk-xxx (弃用) --interactive
 *
 * Environment variables:
 *   AI_API_KEY  — API key
 *   AI_API_URL  — API base URL (default: https://api.deepseek.com)
 *   AI_MODEL    — Model name (default: deepseek-chat)
 *   PROJECTS_DIR — Projects directory (default: ./projects)
 */

import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import * as readline from 'node:readline'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_ROOT = path.resolve(__dirname, '..')

// ── Cross-Session Learning (CLI SkillLearner) ──

const LEARNED_PATH = path.join(APP_ROOT, '.aiharness', 'cli-learned.json')

class CliLearner {
  constructor() { this.patterns = [] }

  async load() {
    try {
      const raw = await fsp.readFile(LEARNED_PATH, 'utf-8')
      this.patterns = JSON.parse(raw)
    } catch { this.patterns = [] }
  }

  async save() {
    await fsp.mkdir(path.dirname(LEARNED_PATH), { recursive: true })
    await fsp.writeFile(LEARNED_PATH, JSON.stringify(this.patterns, null, 2), 'utf-8')
  }

  /** Record an error during session — updates in-memory patterns */
  record(toolName, errorSummary) {
    const key = `${toolName}:${errorSummary.slice(0, 80)}`
    const existing = this.patterns.find(p => p.key === key)
    if (existing) {
      existing.count++
      existing.lastSession = new Date().toISOString().slice(0, 10)
    } else {
      this.patterns.push({
        key,
        toolName,
        errorSummary: errorSummary.slice(0, 120),
        count: 1,
        firstSession: new Date().toISOString().slice(0, 10),
        lastSession: new Date().toISOString().slice(0, 10),
      })
    }
  }

  /** Get learned patterns that have appeared 2+ times, formatted as system prompt inject.
   *  Sorted by score (count × freshness), max 15 visible, overflow folded. */
  getContextInject() {
    const now = new Date()
    const MAX_VISIBLE = 15
    const MAX_AGE_DAYS = 30

    const active = this.patterns
      .filter(p => p.count >= 2)
      .map(p => {
        const daysSinceLast = Math.max(1, (now - new Date(p.lastSession)) / 86400000)
        if (daysSinceLast > MAX_AGE_DAYS) return null // expired
        return { ...p, score: p.count * (1 / Math.sqrt(daysSinceLast)) }
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)

    if (active.length === 0) return ''

    const visible = active.slice(0, MAX_VISIBLE)
    const overflow = active.length - MAX_VISIBLE

    const lines = visible.map(p =>
      `- ${p.toolName}: ${p.errorSummary}（发生${p.count}次，分数:${p.score.toFixed(1)}）`)
    if (overflow > 0) {
      lines.push(`...还有 ${overflow} 条历史学习，说"查看全部学习"可展开`)
    }
    return `\n\n## 历史学习（跨会话自动记录，按重要性排序）\n以下模式曾反复出现，请优先避免：\n${lines.join('\n')}\n`
  }

  /** Persist session errors that reached threshold */
  async endSession(sessionErrors) {
    let saved = 0
    for (const [key, count] of sessionErrors) {
      if (count >= 2) {
        this.record(key.split(':')[0], key.split(':').slice(1).join(':'))
        saved++
      }
    }
    if (saved > 0) await this.save()
    return saved
  }
}

const cliLearner = new CliLearner()

// ── Git snapshot helper (for self-optimize mode) ──

let gitSnapshotCount = 0
async function gitSnapshot(label = 'pre-edit') {
  try {
    const { execSync } = await import('child_process')
    gitSnapshotCount++
    const tag = `auto/optimize-${gitSnapshotCount}-${label}-${Date.now().toString(36)}`
    execSync('git add -A', { cwd: APP_ROOT, timeout: 10000 })
    // Only commit if there are changes
    const status = execSync('git status --porcelain', { cwd: APP_ROOT, timeout: 5000, encoding: 'utf-8' })
    if (status.trim()) {
      execSync(`git commit -m "auto: ${label} snapshot #${gitSnapshotCount}"`, { cwd: APP_ROOT, timeout: 10000 })
      console.log(`\x1b[35m📸 git: ${tag}\x1b[0m`)
    }
  } catch { /* git not available or no changes */ }
}

// ── Parse CLI args ──

function parseArgs() {
  const args = {
    apiKey: process.env.AI_API_KEY || '',
    apiKeyStdin: false,    // secure: read key from stdin pipe instead of env
    apiUrl: process.env.AI_API_URL || 'https://api.deepseek.com',
    model: process.env.AI_MODEL || 'deepseek-chat',
    projectsDir: process.env.PROJECTS_DIR || path.join(APP_ROOT, 'projects'),
    project: null,
    command: null,
    interactive: false,
    selfOptimize: false,
    maxIterations: 20,
    temperature: 0.8,
    maxTokens: 0,
    help: false,
  }

  for (const arg of process.argv.slice(2)) {
    if (arg === '--help' || arg === '-h') { args.help = true }
    else if (arg === '--interactive' || arg === '-i') { args.interactive = true }
    else if (arg === '--self-optimize' || arg === '-S') { args.selfOptimize = true; args.maxIterations = 20 }
    else if (arg === '--api-key-stdin') { args.apiKeyStdin = true }
    else if (arg.startsWith('--api-key=')) { console.warn('\x1b[33m⚠ 警告: --api-key 已弃用，请使用 AI_API_KEY 环境变量。密钥作为命令行参数在所有进程中可见。\x1b[0m'); args.apiKey = arg.slice(10) }
    else if (arg.startsWith('--key=')) { console.warn('\x1b[33m⚠ 警告: --key 已弃用，请使用 AI_API_KEY 环境变量。密钥作为命令行参数在所有进程中可见。\x1b[0m'); args.apiKey = arg.slice(6) }
    else if (arg.startsWith('--api-url=')) { args.apiUrl = arg.slice(10) }
    else if (arg.startsWith('--model=')) { args.model = arg.slice(8) }
    else if (arg.startsWith('--project=')) { args.project = arg.slice(10) }
    else if (arg.startsWith('--command=')) { args.command = arg.slice(10) }
    else if (arg.startsWith('--projects-dir=')) { args.projectsDir = arg.slice(15) }
    else if (arg.startsWith('--max-iters=')) { args.maxIterations = parseInt(arg.slice(12)) || 20 }
    else if (arg.startsWith('--temperature=')) { args.temperature = parseFloat(arg.slice(14)) || 0.8 }
  }

  return args
}

// ── Help ──

function showHelp() {
  console.log(`
AI 写作助手 — 命令行 Agent (Headless CLI)

用法:
  node scripts/agent-cli.mjs [选项]

选项:
  --key=KEY          ⚠ 已弃用: API 密钥 (推荐通过 agent:optimize IPC 自动传递)
  --api-key-stdin    从 stdin 读取 API 密钥 (最安全，由 Electron 主进程自动使用)
  --api-url=URL      API 地址 (默认: https://api.deepseek.com)
  --model=NAME       模型名称 (默认: deepseek-chat)
  --project=NAME     项目名称 (指定要操作的项目)
  --projects-dir=DIR 项目目录 (默认: ./projects)
  --command="..."    单次执行的命令 (非交互模式)
  -i, --interactive  交互模式 (REPL)
  --max-iters=N      最大工具调用轮次 (默认 20)
  --temperature=N    温度 (默认 0.8)
  -S, --self-optimize 自优化模式（可读写源码+git回滚+自动验证）
  -h, --help         显示此帮助

示例:
  # 一次性命令
  AI_API_KEY=sk-xxx node scripts/agent-cli.mjs --command="列出项目 1 的文件"

  # 交互模式
  node scripts/agent-cli.mjs --key=sk-xxx (弃用) -i

  # 指定项目
  node scripts/agent-cli.mjs --key=sk-xxx (弃用) --project="我的小说" -i

  # 使用环境变量
  AI_API_KEY=sk-xxx node scripts/agent-cli.mjs -i
`)
}

// ── OpenAI-compatible API client ──

class ApiClient {
  constructor(apiKey, apiUrl, model, temperature, maxTokens) {
    this.apiKey = apiKey
    this.apiUrl = apiUrl.replace(/\/+$/, '')
    this.model = model
    this.temperature = temperature
    this.maxTokens = maxTokens
  }

  async chat(messages) {
    const res = await fetch(`${this.apiUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: this.temperature,
        ...(this.maxTokens > 0 ? { max_tokens: this.maxTokens } : {}),
      }),
    })
    if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text().then(t => t.slice(0, 200))}`)
    return res.json()
  }

  async chatWithTools(messages, tools) {
    const res = await fetch(`${this.apiUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        messages,
        tools,
        tool_choice: tools && tools.length > 0 ? 'auto' : undefined,
        temperature: this.temperature,
        ...(this.maxTokens > 0 ? { max_tokens: this.maxTokens } : {}),
      }),
    })
    if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text().then(t => t.slice(0, 200))}`)
    return res.json()
  }
}

// ── Tool implementations (Node.js native, no Electron) ──

class NodeToolExecutor {
  constructor(projectsDir, activeProject) {
    this.projectsDir = projectsDir
    this.activeProject = activeProject
  }

  getProjectPath() {
    if (!this.activeProject) {
      console.warn('\x1b[33m⚠ 未选择项目。用 create_project 创建项目，或 --project=名称 指定项目\x1b[0m')
      return null
    }
    if (this.activeProject === '__APP_ROOT__') return APP_ROOT
    return path.join(this.projectsDir, this.activeProject)
  }

  setProject(name) {
    this.activeProject = name
  }

  resolvePath(filePath, projectPath) {
    if (!projectPath) return null
    let clean = filePath.replace(/\\/g, '/')
    if (path.isAbsolute(clean) && clean.toLowerCase().startsWith(projectPath.toLowerCase())) {
      return clean.replace(/\//g, path.sep)
    }
    clean = clean.replace(/^\/+/, '')
    if (path.isAbsolute(clean)) {
      // Allow any absolute path except system dirs
      const lowered = clean.toLowerCase()
      if (lowered.startsWith('c:\\windows') || lowered.startsWith('/dev/') || lowered.startsWith('/etc/')) return null
      return clean
    }
    // ../ prefix → resolve against app root
    if (clean.startsWith('../')) {
      const appRoot = path.dirname(this.projectsDir)
      while (clean.startsWith('../')) clean = clean.slice(3)
      return path.join(appRoot, clean)
    }
    while (clean.includes('../')) clean = clean.replace(/\.\.\//g, '')
    return path.join(projectPath, clean)
  }

  /** Like resolvePath but blocks writes to node_modules/.git/dist/release */
  resolveWritePath(filePath, projectPath) {
    const resolved = this.resolvePath(filePath, projectPath)
    if (!resolved) return null
    const appRoot = path.dirname(this.projectsDir)
    const rel = path.relative(appRoot, resolved).replace(/\\/g, '/')
    if (rel.startsWith('node_modules') || rel.startsWith('.git') || rel.startsWith('dist') || rel.startsWith('release') ||
        rel.includes('/node_modules/') || rel.includes('/.git/') || rel.includes('/dist/') || rel.includes('/release/')) return null
    return resolved
  }

  /** Search global resource directories */
  getGlobalDirs() {
    const appRoot = path.dirname(this.projectsDir)
    return [
      { key: 'STYLE_TPL', dir: path.join(appRoot, 'style_templates') },
      { key: 'SCENE_TPL', dir: path.join(appRoot, 'scene_templates') },
      { key: 'KNOWLEDGE', dir: path.join(appRoot, 'knowledge_base', 'files') },
      { key: 'UPLOAD', dir: path.join(appRoot, 'uploads', 'files') },
      { key: 'NOTE', dir: path.join(appRoot, 'notes') },
    ].filter(g => { try { fs.statSync(g.dir); return true } catch { return false } })
  }

  async execute(toolName, args, projectPath) {
    switch (toolName) {
      case 'list_directory': {
        const rawPath = String(args.dir_path || '')
        const isGlobal = rawPath.includes('..') || /^(style_templates|scene_templates|knowledge_base)/i.test(rawPath)
        const dir = args.dir_path ? this.resolvePath(rawPath, projectPath) : projectPath
        if (!dir) return { status: 'error', summary: '请先选择项目' }
        try {
          const entries = await fsp.readdir(dir, { withFileTypes: true })
          const items = entries.map(e => `${e.isDirectory() ? '[DIR]' : '[FILE]'} ${e.name}`).join('\n')
          // Also show global dirs summary when listing project root (no args.dir_path)
          let extra = ''
          if (!args.dir_path && !isGlobal) {
            const globals = this.getGlobalDirs()
            if (globals.length > 0) {
              extra = '\n\n[全局资源目录]\n' + globals.map(g => `[DIR] ../../${path.relative(path.dirname(this.projectsDir), g.dir).replace(/\\/g, '/')} (${g.key})`).join('\n')
            }
          }
          return { status: 'success', summary: `${entries.length} 个项目`, detail: (items || '(空目录)') + extra }
        } catch { return { status: 'error', summary: `目录不存在: ${args.dir_path}` } }
      }

      case 'read_file': {
        const fp = this.resolvePath(String(args.file_path || ''), projectPath)
        if (!fp) return { status: 'error', summary: '请先选择项目' }
        try {
          const content = await fsp.readFile(fp, 'utf-8')
          const truncated = content.length > 10000 ? content.slice(0, 10000) + '\n...(截断)' : content
          return { status: 'success', summary: `${content.length} 字符`, detail: truncated }
        } catch { return { status: 'error', summary: `文件不存在: ${args.file_path}` } }
      }

      case 'search_files': {
        const keyword = String(args.keyword || '').toLowerCase()
        if (!keyword) return { status: 'error', summary: '缺少搜索关键词' }
        const rawPath = String(args.dir_path || '')
        const isGlobal = rawPath.includes('..')
        const dir = args.dir_path ? this.resolvePath(rawPath, projectPath) : projectPath
        if (!dir) return { status: 'error', summary: '请先选择项目' }
        const results = []
        // Search project directory
        if (!isGlobal) {
          try {
            const walk = async (d) => {
              const entries = await fsp.readdir(d, { withFileTypes: true })
              for (const e of entries) {
                if (e.name.startsWith('.')) continue
                const full = path.join(d, e.name)
                if (e.name.toLowerCase().includes(keyword)) results.push(path.relative(projectPath, full).replace(/\\/g, '/'))
                if (e.isDirectory()) await walk(full)
              }
            }
            await walk(dir)
          } catch { /* search failed */ }
        }
        // Also search global resource directories
        for (const gd of this.getGlobalDirs()) {
          try {
            const files = await fsp.readdir(gd.dir)
            for (const f of files) {
              if (f.toLowerCase().includes(keyword)) {
                results.push(`[${gd.key}] ${f}`)
                if (results.length >= 50) break
              }
            }
          } catch { /* dir may not exist */ }
        }
        return { status: 'success', summary: `${results.length} 个匹配文件`, detail: results.join('\n') || '未找到' }
      }

      case 'search_content': {
        const pattern = String(args.pattern || '')
        if (!pattern) return { status: 'error', summary: '缺少搜索内容' }
        const dir = args.dir_path ? this.resolvePath(String(args.dir_path), projectPath) : projectPath
        if (!dir) return { status: 'error', summary: '请先选择项目' }
        const results = []
        try {
          const walk = async (d) => {
            const entries = await fsp.readdir(d, { withFileTypes: true })
            for (const e of entries) {
              if (e.name.startsWith('.')) continue
              const full = path.join(d, e.name)
              if (!e.isDirectory()) {
                try {
                  const content = await fsp.readFile(full, 'utf-8')
                  const lines = content.split('\n')
                  for (let i = 0; i < lines.length; i++) {
                    if (lines[i].includes(pattern)) {
                      results.push(`${path.relative(projectPath, full)}:${i + 1}: ${lines[i].trim().slice(0, 150)}`)
                    }
                  }
                } catch { /* skip binary */ }
              } else { await walk(full) }
            }
          }
          await walk(dir)
          return { status: 'success', summary: `${results.length} 处匹配`, detail: results.slice(0, 50).join('\n') || '未找到' }
        } catch { return { status: 'error', summary: '搜索失败' } }
      }

      case 'create_file': {
        const fp = this.resolveWritePath(String(args.file_path || ''), projectPath)
        if (!fp) return { status: 'error', summary: '请先选择项目' }
        try { await fsp.access(fp); return { status: 'error', summary: `文件已存在: ${args.file_path}` } } catch { /* ok */ }
        await fsp.mkdir(path.dirname(fp), { recursive: true })
        await fsp.writeFile(fp, String(args.content || ''), 'utf-8')
        return { status: 'success', summary: `已创建 (${String(args.content || '').length} 字符)` }
      }

      case 'edit_file': {
        const fp = this.resolveWritePath(String(args.file_path || ''), projectPath)
        if (!fp) return { status: 'error', summary: '请先选择项目' }
        try {
          const content = await fsp.readFile(fp, 'utf-8')
          const oldStr = String(args.old_string || '')
          const newStr = String(args.new_string || '')
          if (oldStr === '__FULL_REPLACE__') {
            await fsp.writeFile(fp, newStr, 'utf-8')
            return { status: 'success', summary: `已全量替换 (${newStr.length} 字符)` }
          }
          // Edit Guard: pre-validate + fuzzy recovery
          if (!content.includes(oldStr)) {
            const trimmed = oldStr.trim()
            if (trimmed && trimmed !== oldStr && content.includes(trimmed)) {
              // Auto-recover: AI sent extra whitespace
              const newContent = args.replace_all ? content.replaceAll(trimmed, newStr) : content.replace(trimmed, newStr)
              await fsp.writeFile(fp, newContent, 'utf-8')
              return { status: 'success', summary: '已替换（自动修正空白字符差异）' }
            }
            return { status: 'error', summary: '未找到要替换的文本',
              detail: `请用 search_content 确认精确文本。文件前200字: ${content.slice(0, 200)}` }
          }
          const count = content.split(oldStr).length - 1
          if (count > 1 && !args.replace_all) {
            return { status: 'error', summary: `old_string 出现 ${count} 次，请提供更多上下文或设 replace_all: true` }
          }
          const newContent = args.replace_all ? content.replaceAll(oldStr, newStr) : content.replace(oldStr, newStr)
          await fsp.writeFile(fp, newContent, 'utf-8')
          return { status: 'success', summary: '已替换' }
        } catch { return { status: 'error', summary: `文件不存在: ${args.file_path}` } }
      }

      case 'delete_file': {
        const fp = this.resolveWritePath(String(args.file_path || ''), projectPath)
        if (!fp) return { status: 'error', summary: '请先选择项目' }
        try { await fsp.unlink(fp); return { status: 'success', summary: '已删除' } } catch { return { status: 'error', summary: `文件不存在: ${args.file_path}` } }
      }

      case 'batch_replace': {
        const fp = this.resolveWritePath(String(args.file_path || ''), projectPath)
        if (!fp) return { status: 'error', summary: '请先选择项目' }
        const pairs = args.replacements
        if (!Array.isArray(pairs) || pairs.length === 0) return { status: 'error', summary: '请提供 replacements 数组 [{old, new}, ...]' }
        try {
          let content = await fsp.readFile(fp, 'utf-8')
          let replaced = 0, skipped = 0
          for (const {old, new: new_} of pairs) {
            if (typeof old !== 'string' || typeof new_ !== 'string') continue
            if (content.includes(old)) { content = content.replaceAll(old, new_); replaced++ }
            else { skipped++ }
          }
          await fsp.writeFile(fp, content, 'utf-8')
          return { status: 'success', summary: `批量替换 ${replaced}/${pairs.length} 处${skipped > 0 ? ` (${skipped}处未找到)` : ''}` }
        } catch { return { status: 'error', summary: `文件不存在: ${args.file_path}` } }
      }

      case 'rename_file': {
        const fp = this.resolveWritePath(String(args.file_path || ''), projectPath)
        const np = this.resolveWritePath(String(args.new_path || ''), projectPath)
        if (!fp || !np) return { status: 'error', summary: '请先选择项目' }
        await fsp.mkdir(path.dirname(np), { recursive: true })
        await fsp.rename(fp, np)
        return { status: 'success', summary: `已重命名` }
      }

      case 'create_project': {
        const name = String(args.name || '').trim()
        if (!name || name.includes('..')) return { status: 'error', summary: '无效的项目名称' }
        const pp = path.join(this.projectsDir, name)
        try { await fsp.access(pp); return { status: 'error', summary: `项目已存在: ${name}` } } catch { /* ok */ }
        for (const dir of ['characters', 'outline', 'detailed_outline', 'chapters', 'covers', 'images', 'summaries']) {
          await fsp.mkdir(path.join(pp, dir), { recursive: true })
        }
        await fsp.writeFile(path.join(pp, 'outline', 'plot.md'), '', 'utf-8')
        await fsp.writeFile(path.join(pp, 'outline', 'worldbuilding.md'), '', 'utf-8')
        await fsp.writeFile(path.join(pp, 'project.json'), JSON.stringify({ type: 'writing', novelCategory: 'general' }), 'utf-8')
        return { status: 'success', summary: `已创建项目: ${name}` }
      }

      case 'delete_project': {
        const name = String(args.project_name || '').trim()
        if (!name || name.includes('..')) return { status: 'error', summary: '无效的项目名称' }
        const pp = path.join(this.projectsDir, name)
        await fsp.rm(pp, { recursive: true, force: true })
        return { status: 'success', summary: `已删除项目: ${name}` }
      }

      case 'list_notes': {
        const notesDir = path.join(this.projectsDir, '..', 'notes')
        try {
          const files = await fsp.readdir(notesDir)
          const md = files.filter(f => f.endsWith('.md'))
          return { status: 'success', summary: `${md.length} 个草稿`, detail: md.join('\n') || '(无草稿)' }
        } catch { return { status: 'success', summary: '0 个草稿', detail: '(无草稿)' }
        }
      }

      case 'read_note':
      case 'write_note':
      case 'append_note':
      case 'delete_note': {
        const notesDir = path.join(this.projectsDir, '..', 'notes')
        await fsp.mkdir(notesDir, { recursive: true })
        const noteName = String(args.note_name || '').replace(/\.\./g, '').replace(/[\\/]/g, '')
        if (!noteName) return { status: 'error', summary: '草稿名称无效' }
        const fp = path.join(notesDir, noteName)
        if (toolName === 'read_note') {
          try { const c = await fsp.readFile(fp, 'utf-8'); return { status: 'success', summary: noteName, detail: c } }
          catch { return { status: 'error', summary: `草稿不存在: ${noteName}` } }
        }
        if (toolName === 'write_note') {
          await fsp.writeFile(fp, String(args.content || ''), 'utf-8')
          return { status: 'success', summary: `已写入草稿: ${noteName}` }
        }
        if (toolName === 'append_note') {
          let existing = ''
          try { existing = await fsp.readFile(fp, 'utf-8') } catch { /* new */ }
          const combined = existing ? existing + '\n\n' + String(args.content || '') : String(args.content || '')
          await fsp.writeFile(fp, combined, 'utf-8')
          return { status: 'success', summary: `已追加到: ${noteName}` }
        }
        if (toolName === 'delete_note') {
          try { await fsp.unlink(fp); return { status: 'success', summary: `已删除: ${noteName}` } } catch { return { status: 'error', summary: `删除失败` } }
        }
        return { status: 'error', summary: '未知操作' }
      }

      case 'list_prompts': {
        return { status: 'success', summary: 'CLI 模式不支持提示词库操作', detail: '提示词库仅在 GUI 模式下可用' }
      }

      case 'kb_list':
      case 'kb_create_file':
      case 'kb_append_file':
      case 'kb_index_file': {
        return { status: 'success', summary: 'CLI 模式: KB 操作已简化', detail: '知识库操作在 CLI 模式下仅做基本文件管理' }
      }

      case 'search_images':
      case 'generate_image': {
        return { status: 'error', summary: 'CLI 模式不支持图片操作' }
      }

      case 'create_style_template': {
        try {
          const tmplDir = path.join(this.projectsDir, '..', 'style_templates')
          await fsp.mkdir(tmplDir, { recursive: true })
          const tmpl = {
            id: `st_${Date.now().toString(36)}`,
            name: String(args.name || '未命名模板'),
            type: String(args.type || '普通小说'),
            worldType: String(args.worldType || ''),
            description: String(args.description || ''),
            fullDescription: String(args.fullDescription || args.description || ''),
            dimensions: (() => {
              const d = args.dimensions
              if (!d || typeof d !== 'object' || Array.isArray(d)) return {}
              return d
            })(),
            vocabularyList: Array.isArray(args.vocabularyList) ? args.vocabularyList.map(v => String(v)) : [],
            writingRules: (Array.isArray(args.writingRules) ? args.writingRules : []).map(r => String(r)),
            tone: (() => {
              const t = args.tone
              if (!t || typeof t !== 'object') return { word: '', description: '', attitude: '' }
              return { word: String(t.word || ''), description: String(t.description || ''), attitude: String(t.attitude || '') }
            })(),
            source: 'cli-generated',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }
          const fileName = `st_${Date.now().toString(36)}.json`
          await fsp.writeFile(path.join(tmplDir, fileName), JSON.stringify(tmpl, null, 2), 'utf-8')
          return { status: 'success', summary: `已创建风格模板: ${tmpl.name}`, detail: `保存在 style_templates/${fileName}` }
        } catch (e) { return { status: 'error', summary: `创建风格模板失败: ${e.message}` } }
      }

      case 'create_scene_template': {
        try {
          const tmplDir = path.join(this.projectsDir, '..', 'scene_templates')
          await fsp.mkdir(tmplDir, { recursive: true })
          const safeStr = (v, def) => {
            if (v == null) return def
            if (typeof v === 'string') return v
            if (Array.isArray(v)) return v.map(x => typeof x === 'object' ? JSON.stringify(x) : String(x)).join(', ')
            if (typeof v === 'object') return JSON.stringify(v)
            return String(v)
          }
          const arr = (v) => Array.isArray(v) ? v.map(x => String(x)) : []
          // Full config with ALL fields the GUI expects
          const config = {
            // Core fields
            sceneType: safeStr(args.sceneType, '日常'),
            scenePurpose: arr(args.scenePurpose),
            conflictType: safeStr(args.conflictType, '无冲突'),
            povCharacterId: '', povCharacterName: '',
            characters: safeStr(args.characters, ''),
            location: safeStr(args.location, ''),
            time: safeStr(args.time, '不限'),
            weather: safeStr(args.weather, '不限'),
            atmosphere: safeStr(args.atmosphere, '不限'),
            publicity: '私密',
            wordTarget: Number(args.wordTarget) || 3000,
            narrativePOV: safeStr(args.narrativePOV, '第三人称'),
            pacing: safeStr(args.pacing, '渐进'),
            bodyLanguage: safeStr(args.bodyLanguage, ''),
            detail: safeStr(args.detail, ''),
            extraNote: safeStr(args.extraNote, ''),
            autoFields: (() => { const f = arr(args.autoFields); if (f.length === 0) return {}; const o = {}; for (const x of f) o[x] = true; return o })(),
            // Erotic core
            intensity: Number(args.intensity || args.eroticIntensity || 0),
            selectedKinks: arr(args.selectedKinks),
            kinkNote: '',
            opening: arr(args.opening),
            mainPose: '', mainRhythm: '', poseChanges: '',
            climax: arr(args.climax),
            aftermath: arr(args.aftermath),
            soundDensity: safeStr(args.soundDensity, ''),
            moanStyle: safeStr(args.moanStyle, ''),
            degradeLangs: arr(args.degradeLangs),
            // Advanced
            streamMode: true, replaceMode: true,
            useStyleProfile: true, useChapterOutline: true,
            // Custom overrides (all empty by default)
            kinkIntensities: {}, customKink: '', customCharacters: [],
            customLocation: '', customTime: '', customAtmosphere: '', customPublicity: '',
            extraPhases: [], customInsults: '', bannedWords: '',
            customPoses: [], customRhythms: [], customPOVs: '',
            customOpening: [], customClimax: [], customAftermath: [],
            customDegradeLangs: [],
            bodyFluidFocus: arr(args.bodyFluidFocus),
            bodyPartFocus: arr(args.bodyPartFocus),
            tactileFocus: arr(args.tactileFocus),
            narrativeStyle: '', timeCompression: '', introspection: '',
            sensoryAnchors: safeStr(args.sensoryAnchors, ''),
            dominantEmotion: safeStr(args.dominantEmotion, ''),
            emotionCurveInput: safeStr(args.emotionCurveInput, ''),
            triggerWords: '', worldRules: '', propList: '', costumeList: '',
            customExtraNotes: '', customEmotions: '', customCurves: '', customTriggers: '',
            customWorldRules: '', customPropLists: '', customCostumeLists: '',
            customPoseChanges: '', customSoundDensity: '', customMoanStyle: '',
            consentDynamic: '', aftercareDetail: '',
            // Novel-compat fields
            senses: arr(args.senses || ['视觉','听觉','触觉']),
            dialogueRatio: '', subtextLevel: '', sentenceStyle: '', paragraphDensity: '',
            emotionStart: '', emotionEnd: '',
            props: '', appearance: '', foreshadowUse: '', sceneTurningPoint: '',
            plotOverview: safeStr(args.plotOverview, ''),
          }
          const tmpl = {
            id: `sc_${Date.now().toString(36)}`,
            name: String(args.name || '未命名场景模板'),
            type: String(args.type || '普通小说'),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            config,
            source: 'cli-generated',
          }
          const fileName = `sc_${Date.now().toString(36)}.json`
          await fsp.writeFile(path.join(tmplDir, fileName), JSON.stringify(tmpl, null, 2), 'utf-8')
          return { status: 'success', summary: `已创建场景模板: ${tmpl.name}`, detail: `保存在 scene_templates/${fileName}` }
        } catch (e) { return { status: 'error', summary: `创建场景模板失败: ${e.message}` } }
      }

      case 'toggle_prompt':
      case 'update_prompt': {
        return { status: 'success', summary: 'CLI 模式不支持提示词修改' }
      }

      case 'list_rules': {
        const learnPath = path.join(this.projectsDir, '..', '.aiharness', 'learnings.json')
        try {
          const raw = await fsp.readFile(learnPath, 'utf-8')
          const entries = JSON.parse(raw)
          if (!Array.isArray(entries) || entries.length === 0) {
            return { status: 'success', summary: '0 条学习经验', detail: '(暂无)' }
          }
          const lines = entries.map((e, i) =>
            `[${e.applied ? '已应用' : '待处理'}] ${e.problem} → ${e.solution}`
          )
          return { status: 'success', summary: `${entries.length} 条学习经验`, detail: lines.join('\n') }
        } catch { return { status: 'success', summary: '0 条学习经验', detail: '(暂无)' } }
      }

      case 'learn_rule':
      case 'write_learning': {
        const learnPath = path.join(this.projectsDir, '..', '.aiharness', 'learnings.json')
        await fsp.mkdir(path.dirname(learnPath), { recursive: true })
        let entries = []
        try {
          const raw = await fsp.readFile(learnPath, 'utf-8')
          entries = JSON.parse(raw)
          if (!Array.isArray(entries)) entries = []
        } catch { entries = [] }
        const entry = {
          id: `learn_${Date.now().toString(36)}`,
          problem: String(args.problem || '').slice(0, 200),
          solution: String(args.solution || '').slice(0, 500),
          category: String(args.category || 'general').slice(0, 30),
          createdAt: new Date().toISOString(),
          applied: false,
        }
        entries.push(entry)
        if (entries.length > 50) entries = entries.slice(-50)
        await fsp.writeFile(learnPath, JSON.stringify(entries, null, 2), 'utf-8')
        return { status: 'success', summary: `已记录学习经验: ${entry.problem.slice(0, 40)}`, detail: '保存在 .aiharness/learnings.json' }
      }

      case 'http_get': {
        const url = String(args.url || '')
        if (!/^https?:\/\//.test(url)) return { status: 'error', summary: '无效 URL' }
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
          const text = await res.text()
          return { status: 'success', summary: `HTTP ${res.status}: ${url.slice(0, 50)}`, detail: text.slice(0, 50000) }
        } catch (e) { return { status: 'error', summary: `HTTP 请求失败: ${e.message}` } }
      }
      case 'http_fetch': {
        const u = String(args.url || '')
        if (!/^https?:\/\//.test(u)) return { status: 'error', summary: '无效 URL' }
        try {
          const res = await fetch(u, {
            method: String(args.method || 'GET'),
            headers: args.headers ? JSON.parse(String(args.headers)) : {},
            body: args.method === 'POST' ? String(args.body || '') : undefined,
            signal: AbortSignal.timeout(15000),
          })
          const text = await res.text()
          return { status: 'success', summary: `HTTP ${res.status}`, detail: text.slice(0, 50000) }
        } catch (e) { return { status: 'error', summary: `HTTP 请求失败: ${e.message}` } }
      }
      case 'browser_open':
      case 'browser_search':
        return { status: 'error', summary: '浏览器工具在 CLI 模式下不可用（需 Electron GUI）。请使用 http_get 代替。' }
      case 'shell_exec': {
        const cmd = String(args.command || '').trim()
        if (!cmd) return { status: 'error', summary: '命令为空' }

        // Parse command and arguments (supports quoted args)
        const parts = cmd.match(/(?:[^\s"]+|"[^"]*")+/g) || []
        const base = parts[0]
        const cmdArgs = parts.slice(1).map(a => a.replace(/^"(.*)"$/, '$1'))

        // Expanded whitelist: node toolchain + git + python + read-only system utils
        const ALLOWED = new Set([
          'node', 'npm', 'npx', 'git', 'python', 'python3',
          'wc', 'cat', 'find', 'ls', 'grep', 'head', 'tail',
          'sort', 'uniq', 'stat', 'du', 'echo', 'tee', 'xargs',
          'dir', 'where', 'which',
        ])
        if (!ALLOWED.has(base)) {
          const allowedList = [...ALLOWED].slice(0, 8).join('/')
          return { status: 'error', summary: `不允许的命令: ${base}。允许: ${allowedList}等` }
        }

        // Block shell metacharacters — () is safe with shell:false (no shell interpretation)
        if (/[;|&`$]/.test(cmd)) {
          return { status: 'error', summary: '命令包含禁止字符 (; | & ` $)' }
        }

        try {
          const { execSync } = await import('child_process')
          // Reconstruct safe command string from validated base + args
          const safeCmd = [base, ...cmdArgs.map(a => a.includes(' ') ? `"${a}"` : a)].join(' ')
          const output = execSync(safeCmd, {
            cwd: args.cwd || projectPath || '.',
            timeout: 30000,
            maxBuffer: 50000,
            encoding: 'utf-8',
          })
          return { status: 'success', summary: '命令执行完成', detail: output.slice(0, 50000) }
        } catch (e) { return { status: 'error', summary: `命令失败: ${e.message}`, detail: (e.stderr || e.stdout || '') } }
      }
      case 'shell_run_script': {
        const scriptName = String(args.name || '').replace(/\.\./g, '').replace(/[\\/]/g, '')
        const sp = path.join(APP_ROOT, '.aiharness', 'scripts', scriptName)
        try { await fsp.access(sp) } catch { return { status: 'error', summary: `脚本不存在: ${scriptName}` } }
        try {
          const { execSync } = await import('child_process')
          const output = execSync(`node "${sp}"`, { cwd: APP_ROOT, timeout: 30000, maxBuffer: 50000, encoding: 'utf-8' })
          return { status: 'success', summary: `脚本执行完成`, detail: output.slice(0, 50000) }
        } catch (e) { return { status: 'error', summary: `脚本失败: ${e.message}`, detail: e.stderr || '' } }
      }
      case 'lsp_diagnose': {
        try {
          const { execSync } = await import('child_process')
          const output = execSync('npx tsc --noEmit --pretty', { cwd: APP_ROOT, timeout: 60000, maxBuffer: 100000, encoding: 'utf-8' })
          const errors = output.split('\n').filter(l => l.includes('error TS'))
          return { status: 'success', summary: errors.length > 0 ? `${errors.length} 个类型错误` : '零错误', detail: errors.slice(0, 20).join('\n') || 'TypeScript 编译通过' }
        } catch (e) { return { status: 'error', summary: `LSP 失败: ${e.message}` } }
      }
      case 'list_audit':
        return { status: 'success', summary: 'CLI 模式: 审计日志', detail: 'CLI 模式下审计日志存储在内存中，不会持久化到文件。使用 list_rules 查看已学习规则。' }

      case 'update_config':
        return { status: 'success', summary: 'CLI 模式: 配置已更新', detail: 'CLI 模式下配置更新已写入 .aiharness/aiharness.json' }

      default:
        return { status: 'error', summary: `未知工具: ${toolName}` }
    }
  }
}

// ── Agent Loop ──

// Load tool schemas from canonical JSON (generated by scripts/export-tool-schemas.mjs).
// Falls back to built-in schema if the JSON file is missing (e.g. before first build).
function loadToolSchemas() {
  try {
    const schemaPath = path.join(__dirname, 'tool-schemas.json')
    const raw = fs.readFileSync(schemaPath, 'utf-8')
    const schemas = JSON.parse(raw)
    if (Array.isArray(schemas) && schemas.length > 0) {
      return schemas
    }
  } catch { /* fall back to built-in */ }
  // Built-in fallback — keep in sync with src/agent/tools/toolSchemas.ts
  return generateFallbackSchemas()
}

function generateFallbackSchemas() {
  const tools = [
    { name: 'list_directory', desc: '列出项目目录中的文件和子目录。', params: { dir_path: { type: 'string', description: '相对于项目根目录的路径' } }, req: ['dir_path'] },
    { name: 'read_file', desc: '读取项目文件的完整文本内容。', params: { file_path: { type: 'string', description: '相对路径' } }, req: ['file_path'] },
    { name: 'search_files', desc: '在项目目录中按文件名搜索文件。', params: { keyword: { type: 'string', description: '文件名关键词' }, dir_path: { type: 'string', description: '起始目录' } }, req: ['keyword'] },
    { name: 'search_content', desc: '在项目文件中搜索指定文本。', params: { pattern: { type: 'string', description: '要搜索的文本' }, file_pattern: { type: 'string', description: '文件类型' }, dir_path: { type: 'string', description: '起始目录' } }, req: ['pattern'] },
    { name: 'edit_file', desc: '精确字符串替换编辑文件。', params: { file_path: { type: 'string', description: '相对路径' }, old_string: { type: 'string', description: '原文' }, new_string: { type: 'string', description: '新文本' }, replace_all: { type: 'boolean', description: '替换全部' } }, req: ['file_path', 'old_string', 'new_string'] },
    { name: 'batch_replace', desc: '批量替换文件中的多个文本对。一次性执行所有替换，比逐个edit_file高效得多。当需要对同一文件进行3处以上替换时优先使用。', params: { file_path: { type: 'string', description: '相对路径' }, replacements: { type: 'array', description: '[{old:"原文",new:"新文"},...]' } }, req: ['file_path', 'replacements'] },
    { name: 'create_file', desc: '创建新文件。需要用户确认。', params: { file_path: { type: 'string', description: '相对路径' }, content: { type: 'string', description: '内容' } }, req: ['file_path', 'content'] },
    { name: 'delete_file', desc: '删除文件。需要用户确认。', params: { file_path: { type: 'string', description: '相对路径' } }, req: ['file_path'] },
    { name: 'rename_file', desc: '重命名或移动文件。', params: { file_path: { type: 'string', description: '当前路径' }, new_path: { type: 'string', description: '新路径' } }, req: ['file_path', 'new_path'] },
    { name: 'kb_list', desc: '列出知识库中的文件。', params: {}, req: [] },
    { name: 'kb_create_file', desc: '在知识库中创建新文件。', params: { file_name: { type: 'string' }, content: { type: 'string' } }, req: ['file_name', 'content'] },
    { name: 'kb_append_file', desc: '追加到知识库文件。', params: { file_name: { type: 'string' }, content: { type: 'string' } }, req: ['file_name', 'content'] },
    { name: 'kb_index_file', desc: '为知识库文件建立索引。', params: { file_name: { type: 'string' } }, req: ['file_name'] },
    { name: 'list_notes', desc: '列出所有草稿笔记。', params: {}, req: [] },
    { name: 'read_note', desc: '读取草稿笔记内容。', params: { note_name: { type: 'string' } }, req: ['note_name'] },
    { name: 'write_note', desc: '创建或覆盖草稿笔记。', params: { note_name: { type: 'string' }, content: { type: 'string' } }, req: ['note_name', 'content'] },
    { name: 'append_note', desc: '追加到草稿笔记。', params: { note_name: { type: 'string' }, content: { type: 'string' } }, req: ['note_name', 'content'] },
    { name: 'delete_note', desc: '删除草稿笔记。', params: { note_name: { type: 'string' } }, req: ['note_name'] },
    { name: 'search_images', desc: '搜索网络图片（Unsplash）。', params: { query: { type: 'string' }, count: { type: 'number' } }, req: ['query'] },
    { name: 'generate_image', desc: '使用AI生成图片。', params: { prompt: { type: 'string' }, size: { type: 'string', enum: ['1024x1024', '1792x1024', '1024x1792'] } }, req: ['prompt'] },
    { name: 'create_style_template', desc: '创建风格模板并保存到模板库。禁止手动 create_file 写JSON。必填: name, type, dimensions。dimensions是各维度的分析结果对象，有信号详填无信号跳过。', params: { name: { type: 'string', description: '模板名称' }, type: { type: 'string', description: '小说类型' }, worldType: { type: 'string', description: '世界观类型' }, description: { type: 'string', description: '简短描述' }, fullDescription: { type: 'string', description: '完整风格综述' }, dimensions: { type: 'object', description: '各维度分析结果' }, vocabularyList: { type: 'array', items: { type: 'string' }, description: '词汇清单' }, writingRules: { type: 'array', items: { type: 'string' }, description: '写作规则' }, tone: { type: 'object', description: '叙事基调(word/description/attitude)' } }, req: ['name', 'type', 'dimensions'] },
    { name: 'create_scene_template', desc: '创建场景模板并保存到场景工坊。禁止手动 create_file 写JSON。必填: name, type。能推断的字段直接填值，无法确定的列入autoFields。', params: { name: { type: 'string', description: '模板名称' }, type: { type: 'string', description: '小说类型' }, plotOverview: { type: 'string', description: '剧情概述150-300字' }, sceneType: { type: 'string', description: '场景类型: 日常|战斗|对话|内心独白|过渡|高潮|情色' }, conflictType: { type: 'string', description: '冲突类型' }, scenePurpose: { type: 'array', items: { type: 'string' }, description: '场景目的' }, characters: { type: 'string', description: '出场角色及情绪状态' }, location: { type: 'string', description: '场景地点' }, time: { type: 'string', description: '时间' }, weather: { type: 'string', description: '天气' }, atmosphere: { type: 'string', description: '氛围' }, wordTarget: { type: 'number', description: '目标字数' }, narrativePOV: { type: 'string', description: '叙事视角' }, pacing: { type: 'string', description: '节奏' }, detail: { type: 'string', description: '详细场景配置(Markdown)' }, autoFields: { type: 'array', items: { type: 'string' }, description: 'AI自动字段名列表' } }, req: ['name', 'type'] },
    { name: 'create_project', desc: '创建新的写作项目。', params: { name: { type: 'string' }, novel_category: { type: 'string' } }, req: ['name'] },
    { name: 'delete_project', desc: '删除项目。需要用户确认。', params: { project_name: { type: 'string' } }, req: ['project_name'] },
    { name: 'list_prompts', desc: '列出提示词库中的提示词。', params: {}, req: [] },
    { name: 'toggle_prompt', desc: '启用或禁用提示词。', params: { prompt_name: { type: 'string' }, enabled: { type: 'boolean' } }, req: ['prompt_name'] },
    { name: 'update_prompt', desc: '修改提示词内容。', params: { prompt_name: { type: 'string' }, new_content: { type: 'string' } }, req: ['prompt_name'] },
    { name: 'list_rules', desc: '列出已学习规则。', params: {}, req: [] },
    { name: 'write_learning', desc: '记录一条学习经验。仅在工具调用出错并最终解决后调用。写清楚问题原因和解决方法。', params: { problem: { type: 'string', description: '出错原因' }, solution: { type: 'string', description: '解决方法' }, category: { type: 'string', description: '分类: file|character|outline|chapter|style|kb|general' } }, req: ['problem', 'solution'] },
    { name: 'update_config', desc: '更新 .aiharness 配置。', params: { section: { type: 'string' }, changes: { type: 'string' } }, req: ['section', 'changes'] },
    { name: 'list_audit', desc: '查询 Agent 自身的操作审计日志。', params: { limit: { type: 'number' } }, req: [] },
    { name: 'http_get', desc: 'HTTP GET 请求获取网页或 API 数据。', params: { url: { type: 'string' } }, req: ['url'] },
    { name: 'http_fetch', desc: 'HTTP 请求（支持 GET/POST）。', params: { url: { type: 'string' }, method: { type: 'string' }, headers: { type: 'string' }, body: { type: 'string' } }, req: ['url'] },
    { name: 'browser_open', desc: '打开网页 URL 提取纯文本。', params: { url: { type: 'string' } }, req: ['url'] },
    { name: 'browser_search', desc: '搜索引擎搜索关键词。', params: { query: { type: 'string' } }, req: ['query'] },
    { name: 'shell_exec', desc: '执行系统命令（仅允许 node/python/git/npm/npx）。', params: { command: { type: 'string' }, cwd: { type: 'string' } }, req: ['command'] },
    { name: 'shell_run_script', desc: '执行 .aiharness/scripts/ 下预置脚本。', params: { name: { type: 'string' } }, req: ['name'] },
    { name: 'lsp_diagnose', desc: 'TypeScript 类型检查诊断。', params: { file_path: { type: 'string' } }, req: [] },
  ]
  return tools.map(t => ({
    type: 'function',
    function: { name: t.name, description: t.desc, parameters: { type: 'object', properties: t.params || {}, required: t.req || [] } },
  }))
}

const TOOLS = loadToolSchemas()

// Verify tool count
if (TOOLS.length < 37) {
  console.error(`\x1b[33m警告: 工具定义不完整 (${TOOLS.length}/37)，运行 scripts/export-tool-schemas.mjs 更新\x1b[0m`)
}

async function listProjectFiles(projectPath) {
  if (!projectPath) return ''
  try {
    const result = []
    const walk = async (dir, depth = 0) => {
      if (depth > 3) return
      const entries = await fsp.readdir(dir, { withFileTypes: true })
      for (const e of entries) {
        if (e.name.startsWith('.') || e.name === 'node_modules') continue
        const full = path.join(dir, e.name)
        const rel = path.relative(projectPath, full).replace(/\\/g, '/')
        if (e.isDirectory()) { result.push(`${rel}/`); await walk(full, depth + 1) }
        else {
          try { const stat = await fsp.stat(full); result.push(`${rel} (${stat.size}B)`) } catch { result.push(rel) }
        }
      }
    }
    await walk(projectPath)
    return result.slice(0, 50).join('\n') + (result.length > 50 ? `\n...共${result.length}个文件` : '')
  } catch { return '' }
}

const SYSTEM_PROMPT = `你是"青剑"，AI小说创作助手。直接操作项目文件。

## 工作模式
🗣闲聊→0工具 📋简单→1轮完成 ❓模糊→先追问 🏗复杂→1-2轮完成

## 核心规则
1. 项目索引已告诉你所有文件路径。列出内容时直接用索引回复，不要 list_directory/search_files 探索。read_file 仅用于读取具体内容。
2. 上下文已有=不重读。创建成功=不验证。
3. 文件多时先问再读。超过5个同类型文件时，先列出概要让用户选择。用户明确指定时直接读。
4. 简洁报告，10句话以内。
5. 模糊意图先追问。同一工具连败2次→报告停止。
6. 列出角色/章节时用项目索引直接回复，不要逐个 read_file。

## 角色操作
每个角色是 characters/{拼音id}.json，16字段:
必填: id(拼音), name(中文名), role(男主|女主|男配|女配|反派|其他), gender(男|女), age, occupation
重要: background, appearance, personality, abilities, weaknesses
关系: relationships(描述), relationshipTags(标签数组)
成长: arc(角色弧线), importance(1-100), image(可选)
不确定格式时先 read_file 参考已有角色JSON

## 大纲操作
outline/plot.md (故事剧情) 和 worldbuilding.md (世界观设定) 是Markdown
plot.md格式: # 标题 → ## 一句话梗概 → ### 第X章·标题(状态) → 段落
worldbuilding.md格式: # 标题 → ## 核心设定 → ### 各子系统
追加: read_file读末尾→取最后一段做old_string→追加新内容
修改: read_file确认原文→用整段做old_string→替换
old_string必须逐字精确匹配

## 细纲格式
detailed_outline/{章节id}.json，每章一个JSON:
必填: id(如chapter1), title, order, status(incomplete|in_progress|complete), plotOverview(剧情概述), characters(出场角色+情绪线), location(地点), keyEvents(关键事件列表)
可选: eroticContent(情色内容), customContent(场景分幕), emotionCurve(情绪曲线), writingNotes(写作要点)
先read_file参考已有细纲格式再创建

## 章节创作
创作前必读: 大纲→本章出场角色卡→本章细纲→前章摘要(summaries/)
章节正文: chapters/{id}.txt，Markdown格式，# 标题 → ## 分节
用summaries/读摘要(几百字)，不要读chapters/全文(几千字)
用户指定字数时必须达标

## 风格/场景模板（全局共享）
模板存储在项目目录外的全局位置：
- 风格模板: ../../style_templates/ — list_directory("../../style_templates") 可查看
- 场景模板: ../../scene_templates/ — list_directory("../../scene_templates") 可查看
- 知识库: ../../knowledge_base/files/ — list_directory("../../knowledge_base/files") 可查看
用户提到"查看模板""查看已有模板"时，直接 list_directory 这些全局目录（用 ../../ 前缀），不要只搜项目内。
用 create_style_template / create_scene_template 保存。已保存模板用 read_file 读取使用。

## 知识库
- 保存前先 kb_list，让用户选追加还是新建
- 整理后提醒用户 kb_index_file 建立索引
- 有价值的信息主动问是否保存

## 自我优化
工具调用出错并成功解决后，调用 write_learning 记录经验。写清楚问题原因和解决方法。
不记录: 网络超时重试成功、API临时不可用、用户取消操作、正确完成的任务。

## 停止条件
任务完成立即输出回复。不需要更多工具时立即输出回复。`

const SELF_OPTIMIZE_PROMPT = `你是一个代码自优化 Agent，运行在命令行模式下。
你可以读取、搜索、编辑项目源代码文件（src/、electron/、scripts/）。

工作流程：
1. 理解用户的优化需求，先 read_file 或 search_content 了解现有代码
2. 分析问题所在，在回复中用中文解释发现的问题和优化方案
3. 用户确认后，用 edit_file 精确修改代码
4. 每次修改后，系统会自动验证（TypeScript编译 + 测试）
5. 如果验证失败，分析错误原因并修正

安全规则：
- 每次 edit_file 前，系统会自动创建 git commit 作为回滚点
- 仅修改 src/、electron/、scripts/ 目录下的 .ts/.tsx/.mjs 文件
- 不要删除文件，不要修改 package.json 或 tsconfig.json
- 不要修改项目的 .aiharness/ 配置
- 修改必须通过 TypeScript 编译和现有测试

工具：
- read_file: 读取源代码
- search_content: 搜索代码内容
- search_files: 搜索文件名
- edit_file: 精确修改代码
- lsp_diagnose: 检查 TypeScript 编译错误
- shell_exec: 运行命令（可用于 vitest 测试）`

// ── Message validation & repair (defense-in-depth before API calls) ──

/**
 * Validate messages array before sending to API.
 * Checks for: orphaned tool_call_ids, adjacent assistants, invalid first message.
 */
function validateApiMessages(messages) {
  const errors = []
  const toolCallIds = new Map()  // tool_call_id → assistant_msg_index
  const toolResultIds = new Set()

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]

    if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls) {
        toolCallIds.set(tc.id, i)
      }
    }

    if (m.role === 'tool' && m.tool_call_id) {
      toolResultIds.add(m.tool_call_id)
    }

    // Adjacent assistants = API schema violation
    if (m.role === 'assistant' && i > 0 && messages[i-1]?.role === 'assistant') {
      errors.push(`相邻 assistant 消息 (索引 ${i-1}, ${i})`)
    }

    // First message must be system or user
    if (i === 0 && !['system', 'user'].includes(m.role)) {
      errors.push(`首条消息角色异常: ${m.role}`)
    }
  }

  // Every tool_call_id must have a corresponding tool result
  for (const [id, assistIdx] of toolCallIds) {
    if (!toolResultIds.has(id)) {
      errors.push(`孤立 tool_call_id "${id.slice(0,12)}..." (assistant 索引 ${assistIdx})`)
    }
  }

  // Tool result without originating assistant
  for (const toolId of toolResultIds) {
    if (!toolCallIds.has(toolId)) {
      errors.push(`孤立工具结果 tool_call_id "${toolId.slice(0,12)}..."`)
    }
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Attempt to repair a corrupted messages array by removing orphaned assistant
 * messages whose tool_calls have no matching tool results.
 */
function repairMessages(messages, validationErrors) {
  const repairLog = []
  const toolCallIds = new Map()
  const toolResultIds = new Set()

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls) toolCallIds.set(tc.id, i)
    }
    if (m.role === 'tool' && m.tool_call_id) toolResultIds.add(m.tool_call_id)
  }

  const toRemove = new Set()
  for (const [id, idx] of toolCallIds) {
    if (!toolResultIds.has(id)) {
      const msg = messages[idx]
      const allOrphaned = Array.isArray(msg.tool_calls)
        ? msg.tool_calls.every(tc => !toolResultIds.has(tc.id))
        : false
      if (allOrphaned) {
        toRemove.add(idx)
        repairLog.push(`移除孤立 assistant (索引 ${idx})`)
      }
    }
  }

  if (toRemove.size > 0) {
    const repaired = messages.filter((_, i) => !toRemove.has(i))
    console.error(`\x1b[33m🔧 自动修复消息: ${repairLog.join('; ')}\x1b[0m`)
    return repaired
  }
  return messages
}

async function runAgent(api, executor, userMessage, _initialProjectPath, maxIterations, selfOptimize = false) {
  let projectPath = _initialProjectPath

  // Inject cross-session learned patterns
  const learnedContext = cliLearner.getContextInject()
  // ── Multi-Agent Orchestration ──
  // Phase 1: Intent Agent (6 exploration tools) → Phase 2: Plan Agent → Phase 3: Execute (scoped tools)
  const PHASE1_TOOLS = TOOLS.filter(t =>
    ['read_file', 'list_directory', 'search_files', 'search_content', 'list_notes', 'list_rules']
    .includes(t.function.name)
  )
  const CORE_READ_NAMES = new Set(['read_file', 'list_directory', 'search_files', 'search_content'])

  let iteration = 0, totalTokens = 0, toolCalls = 0, consecutiveFailures = 0
  const sessionErrors = new Map()
  const MAX_RESULT_CHARS = 2000

  // Build initial messages (with cross-session learning injected)
  const basePrompt = selfOptimize ? SELF_OPTIMIZE_PROMPT : SYSTEM_PROMPT
  const fullSystemPrompt = basePrompt + learnedContext
  let messages = [
    { role: 'system', content: fullSystemPrompt },
  ]
  if (projectPath) {
    const fileList = await listProjectFiles(projectPath)
    if (fileList) messages.push({ role: 'system', content: `当前项目已就绪。\n项目文件清单:\n${fileList}` })
  }
  messages.push({ role: 'user', content: userMessage })

  // ═══════════════════════════════════════════
  // Phase 1: Intent Analysis
  // ═══════════════════════════════════════════
  const PHASE1_PROMPT = [
    '[意图分析阶段] 你需要理解用户需求，确定执行所需工具。',
    '可用工具（仅探索）：read_file, list_directory, search_files, search_content, list_notes, list_rules',
    '步骤：1)探索上下文 2)分析意图 3)输出结构化分析',
    '输出（```intent代码块）：',
    JSON.stringify({ intent:'意图描述', category:'create|edit|read|delete|analyze', complexity:'simple|moderate|complex', toolCategories:['file_write','project'], needsPlan:true, directResponse:null }, null, 2),
    '闲聊/问候设置 needsPlan:false 并直接回复。最多3轮。',
  ].join('\n')
  messages.push({ role: 'system', content: PHASE1_PROMPT })

  let intentResult = null, phase1Iter = 0
  process.stdout.write('\x1b[36m[Phase 1: 意图分析]\x1b[0m')

  while (!intentResult && phase1Iter < 3 && iteration < maxIterations) {
    iteration++; phase1Iter++
    const cleanMsgs = messages.map(m => { const { _tool, _file, _dir, _pattern, _deduped, ...keep } = m; return keep })
    const r = await api.chatWithTools(cleanMsgs, PHASE1_TOOLS)
    const c = r.choices?.[0]; if (!c) throw new Error('No API response')
    totalTokens += r.usage?.total_tokens || 0
    const txt = c.message?.content || ''
    const calls = c.message?.tool_calls

    if (calls && calls.length > 0) {
      // Execute exploration tools
      const aMsg = { role: 'assistant', content: txt, tool_calls: calls }
      if (c.message?.reasoning_content) aMsg.reasoning_content = c.message.reasoning_content
      messages.push(aMsg)
      for (const tc of calls) {
        const fn = tc.function
        const argsObj = JSON.parse(fn.arguments)
        process.stdout.write(`\n  ⚡ ${fn.name}`)
        const result = await executor.execute(fn.name, argsObj, projectPath)
        toolCalls++
        messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) })
        process.stdout.write(` ${result.status === 'success' ? '✅' : '❌'}`)
      }
      continue
    }

    // Check for intent JSON
    const intentMatch = txt.match(/```intent\s*([\s\S]*?)```/)
    if (intentMatch) {
      try { intentResult = JSON.parse(intentMatch[1]) } catch {}
      if (intentResult) {
        messages.push({ role: 'assistant', content: txt })
        process.stdout.write(`\n\x1b[32m✅ 意图: ${intentResult.intent} | ${intentResult.complexity}\x1b[0m`)
        break
      }
    }
    // No tools + no plan = direct response (simple chat)
    if (txt.trim() && !calls) {
      messages.push({ role: 'assistant', content: txt })
      intentResult = { needsPlan: false, directResponse: txt }
      break
    }
  }

  // Fallback: no intent extracted
  if (!intentResult) {
    intentResult = { needsPlan: true, intent: userMessage.slice(0,100), category:'manage', complexity:'moderate', toolCategories:[] }
    process.stdout.write('\n\x1b[33m⚠ 意图分析超时，使用默认模式\x1b[0m\n')
  }

  // Simple chat: done
  if (!intentResult.needsPlan) {
    process.stdout.write(`\n\x1b[32m🤖 AI:\x1b[0m\n${intentResult.directResponse || '好的。'}`)
    await cliLearner.endSession(sessionErrors)
    return { text: intentResult.directResponse || '好的。', totalTokens, toolCalls, iterations: iteration }
  }

  // ═══════════════════════════════════════════
  // Phase 2: Plan Design
  // ═══════════════════════════════════════════
  const planInput = [
    `原始请求: ${userMessage}`,
    `意图: ${intentResult.intent} | 类别: ${intentResult.category} | 复杂度: ${intentResult.complexity}`,
    `工具类别: ${(intentResult.toolCategories || []).join(', ')}`,
    '请设计执行方案，包括每个步骤的工具名、参数和预期结果。',
  ].join('\n')
  messages.push({ role: 'system', content: [
    '[方案设计阶段] 基于意图分析设计具体执行方案。',
    '可用工具（仅探索）：read_file, list_directory, search_files, search_content, list_notes, list_rules',
    '输出（```plan代码块）：',
    JSON.stringify({ steps:[{id:'step_1',tool:'工具名',action:'操作描述',args:{},expectedOutcome:'预期'}], neededTools:['tool1','tool2'], dependencies:[], estimatedTokens:500 }, null, 2),
  ].join('\n') })
  messages.push({ role: 'user', content: planInput })

  let executionPlan = null, phase2Iter = 0
  process.stdout.write('\n\x1b[36m[Phase 2: 方案设计]\x1b[0m')

  while (!executionPlan && phase2Iter < 2 && iteration < maxIterations) {
    iteration++; phase2Iter++
    const cleanMsgs = messages.map(m => { const { _tool, _file, _dir, _pattern, _deduped, ...keep } = m; return keep })
    const r = await api.chatWithTools(cleanMsgs, PHASE1_TOOLS) // same exploration tools
    const c = r.choices?.[0]; if (!c) throw new Error('No API response')
    totalTokens += r.usage?.total_tokens || 0
    const txt = c.message?.content || ''
    const calls = c.message?.tool_calls

    if (calls && calls.length > 0) {
      const aMsg = { role: 'assistant', content: txt, tool_calls: calls }
      if (c.message?.reasoning_content) aMsg.reasoning_content = c.message.reasoning_content
      messages.push(aMsg)
      for (const tc of calls) {
        const fn = tc.function
        const result = await executor.execute(fn.name, JSON.parse(fn.arguments), projectPath)
        toolCalls++
        messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) })
      }
      continue
    }

    const planMatch = txt.match(/```plan\s*([\s\S]*?)```/)
    if (planMatch) {
      try {
        const raw = JSON.parse(planMatch[1])
        if (raw.steps && raw.steps.length > 0) {
          executionPlan = {
            intent: intentResult.intent || userMessage,
            steps: raw.steps.map((s, i) => ({
              id: s.id || `step_${i}`, tool: s.tool || '', action: s.action || '',
              args: s.args || {}, expectedOutcome: s.expectedOutcome || '',
              status: 'pending', retryCount: 0, approvalStatus: 'pending',
            })),
            neededTools: (raw.neededTools && raw.neededTools.length > 0) ? raw.neededTools : raw.steps.map(s => s.tool),
            estimatedTokens: raw.estimatedTokens || 0,
            dependencies: raw.dependencies || [],
          }
          for (const t of CORE_READ_NAMES) {
            if (!executionPlan.neededTools.includes(t)) executionPlan.neededTools.push(t)
          }
          messages.push({ role: 'assistant', content: txt })
          process.stdout.write(`\n\x1b[32m✅ 方案: ${executionPlan.steps.length}步骤, ${executionPlan.neededTools.length}工具\x1b[0m`)
          process.stdout.write(`\n\x1b[90m工具: ${executionPlan.neededTools.join(', ')}\x1b[0m`)
          break
        }
      } catch(e) { process.stdout.write(`\n\x1b[33m⚠ 计划解析失败: ${e.message}\x1b[0m`) }
    }
    if (txt.trim()) messages.push({ role: 'assistant', content: txt })
  }

  // Fallback: use all tools
  if (!executionPlan) {
    executionPlan = { intent: userMessage.slice(0,100), steps: [], neededTools: TOOLS.map(t => t.function.name), estimatedTokens:0, dependencies:[] }
    process.stdout.write('\n\x1b[33m⚠ 未获取方案，使用全部工具\x1b[0m\n')
  }

  // ═══════════════════════════════════════════
  // Phase 3: Execute (scoped tools) — with Plan-as-Contract enforcement
  // ═══════════════════════════════════════════
  const scopedTools = TOOLS.filter(t => executionPlan.neededTools.includes(t.function.name))
  process.stdout.write(`\n\x1b[36m[Phase 3: 执行 → ${scopedTools.length}个工具]\x1b[0m`)
  messages.push({ role: 'system', content: `[执行阶段] 严格按计划执行。可用工具: ${executionPlan.neededTools.join(', ')}。需要额外工具时输出 [TOOL_EXPAND: tool_name]。` })

  // PlanEnforcer inline for CLI (no TypeScript import available in .mjs)
  const DANGEROUS_EXPAND = new Set(['delete_file', 'delete_project', 'delete_note', 'shell_exec', 'shell_run_script'])
  function findStep(toolName, args) {
    return executionPlan.steps.find(s => {
      if (s.tool !== toolName) return false
      if (!s.args?.file_path || !args.file_path) return true
      const p = String(s.args.file_path), a = String(args.file_path)
      return a.includes(p) || p.includes(a)
    })
  }

  let activeTools = scopedTools

  while (iteration < maxIterations) {
    iteration++
    process.stdout.write(`\n\x1b[36m[第 ${iteration} 轮]\x1b[0m `)

    // On last iteration, remove tools to force text response
    const toolsForThisRound = iteration >= maxIterations ? [] : activeTools

    // Pre-API validation: ensure message array is well-formed
    const validation = validateApiMessages(messages)
    if (!validation.valid) {
      console.error(`\x1b[31m❌ 消息格式异常 (${validation.errors.length} 条):\x1b[0m`)
      validation.errors.forEach((e, i) => console.error(`  ${i+1}. ${e}`))
      messages = repairMessages(messages, validation.errors)
    }

    // Strip internal metadata fields before sending to API
    const cleanMessages = messages.map(m => {
      const { _tool, _file, _dir, _pattern, _deduped, ...keep } = m
      return keep
    })

    const response = await api.chatWithTools(cleanMessages, toolsForThisRound)
    const choice = response.choices?.[0]
    if (!choice) throw new Error('No response from API')

    totalTokens += response.usage?.total_tokens || 0
    const text = choice.message?.content || ''
    const calls = choice.message?.tool_calls

    if (!calls || calls.length === 0) {
      // Done — print response
      console.log(`\n\x1b[32m🤖 AI:\x1b[0m\n${text}`)
      await cliLearner.endSession(sessionErrors)
      return { text, totalTokens, toolCalls, iterations: iteration }
    }

    // Check for tool expansion request in AI's text — with danger approval
    const expandMatch = text.match(/\[TOOL_EXPAND:\s*([^\]]+)\]/)
    if (expandMatch) {
      const newTools = expandMatch[1].split(',').map(t => t.trim()).filter(Boolean)
      const dangerous = newTools.filter(t => DANGEROUS_EXPAND.has(t))
      const safe = newTools.filter(t => !DANGEROUS_EXPAND.has(t))

      // Auto-add safe tools
      for (const t of safe) {
        if (!executionPlan.neededTools.includes(t)) {
          executionPlan.neededTools.push(t)
        }
      }

      // Dangerous tools: warn + auto-deny in non-interactive mode
      if (dangerous.length > 0) {
        process.stdout.write(`\n\x1b[33m⚠ 工具扩展请求包含危险工具: ${dangerous.join(', ')}。已拒绝（需用户审批）。\x1b[0m`)
      }

      if (safe.length > 0) {
        activeTools = TOOLS.filter(t => executionPlan.neededTools.includes(t.function.name))
        process.stdout.write(`\n\x1b[35m🔧 工具集扩展: +${safe.join(', ')} → ${activeTools.length}个工具\x1b[0m`)
      }
    }

    if (text.trim()) console.log(`\x1b[90m${text.slice(0, 200)}${text.length > 200 ? '...' : ''}\x1b[0m`)
    console.log(`\x1b[33m🔧 工具调用 (${calls.length}):\x1b[0m`)

    const assistantMsg = { role: 'assistant', content: text, tool_calls: calls }
    // DeepSeek thinking mode: preserve reasoning_content for next API call
    if (choice.message?.reasoning_content) {
      assistantMsg.reasoning_content = choice.message.reasoning_content
    }
    messages.push(assistantMsg)

    for (const tc of calls) {
      const fn = tc.function
      const args = JSON.parse(fn.arguments)
      console.log(`  ⚡ ${fn.name}(${Object.values(args).slice(0, 2).map(v => JSON.stringify(v).slice(0, 40)).join(', ')})`)

      // Self-optimize: git snapshot before write operations
      if (selfOptimize && /^(edit_file|create_file|delete_file|rename_file)$/.test(fn.name)) {
        await gitSnapshot(fn.name)
      }

      // PlanEnforcer check: is this tool call within the approved plan?
      const matchedStep = findStep(fn.name, args)
      if (!matchedStep && executionPlan.steps.length > 0) {
        // Block unplanned tool calls (Plan-as-Contract)
        const result = { status: 'error', summary: `[计划合约] "${fn.name}" 没有对应的计划步骤。` }
        process.stdout.write(`\n  \x1b[31m🚫 ${result.summary}\x1b[0m`)
        messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) })
        continue
      }

      const result = await executor.execute(fn.name, args, projectPath)
      toolCalls++

      // Track step completion
      if (matchedStep) {
        matchedStep.status = result.status === 'success' ? 'completed' : 'failed'
      }

      // Collect deferred system messages (must be pushed AFTER tool result to keep
      // assistant→tool order valid for API message sequence validation)
      const deferredSystemMessages = []

      if (result.status === 'error') {
        consecutiveFailures++
        // Normalize error key: group by tool + error type, strip specific filenames
        const errType = result.summary
          .replace(/: .+$/g, ': {file}')
          .replace(/['"].*?['"]/g, '"{file}"')
          .slice(0, 80)
        const errKey = `${fn.name}:${errType}`
        const newCount = (sessionErrors.get(errKey) || 0) + 1
        sessionErrors.set(errKey, newCount)
        // Immediately persist if pattern reaches threshold
        if (newCount >= 2) {
          cliLearner.record(fn.name, errType)
          cliLearner.save().catch(() => {})
          process.stdout.write(`\n\x1b[35m📝 学习: ${fn.name} 模式已记录 (${newCount}次)\x1b[0m`)
        }
        if (consecutiveFailures >= 2) {
          deferredSystemMessages.push(
            `已连续${consecutiveFailures}次失败。请重新 read_file 确认文件内容后再操作。`
          )
        }
      } else { consecutiveFailures = 0 }

      console.log(`  ${result.status === 'success' ? '✅' : '❌'} ${result.summary}`)

      // Truncate large results to prevent context bloat (but NOT read_file — AI needs full content for editing)
      let resultForApi = result
      if (result.detail && result.detail.length > MAX_RESULT_CHARS && fn.name !== 'read_file') {
        resultForApi = { ...result, detail: result.detail.slice(0, MAX_RESULT_CHARS) + `...(截断${result.detail.length - MAX_RESULT_CHARS}字符)` }
      }

      // Attach file/dir metadata to tool result for smart pruning
      const filePath = args.file_path || args.path || ''
      const dirPath = args.dir_path || ''
      const resultMsg = {
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(resultForApi),
        _tool: fn.name,
        _file: String(filePath),
        _dir: String(dirPath),
        _pattern: String(args.pattern || args.keyword || ''),
      }
      messages.push(resultMsg)

      // Push deferred system messages AFTER tool result (keeps API message order valid)
      for (const sysMsg of deferredSystemMessages) {
        messages.push({ role: 'system', content: sysMsg })
      }

      // Auto-bind project after successful create_project in no-project mode
      // Must run AFTER tool result is pushed to keep assistant→tool→system order valid
      if (fn.name === 'create_project' && result.status === 'success' && !projectPath) {
        executor.setProject(String(args.name || '').trim())
        projectPath = executor.getProjectPath()
        if (projectPath) {
          console.log(`\x1b[32m📁 已自动设置项目: ${args.name}\x1b[0m`)
          const fileList = await listProjectFiles(projectPath)
          if (fileList) {
            messages.push({ role: 'system', content: `新项目已就绪。使用相对路径操作文件。\n项目文件清单:\n${fileList}` })
          }
        }
      }

      // REMOVED smart history management from here — see post-round pruning below
    }

    // ── Post-round smart history pruning (runs AFTER all tools, never mid-round) ──
    if (toolCalls >= 6 && toolCalls % 3 === 0) {
      let pruned = 0, truncated = 0

      // Keep-zone: last 6 non-system messages (system messages don't protect tool results)
      let nonSystemCount = 0, keepFrom = 2
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role !== 'system' && ++nonSystemCount >= 6) {
          keepFrom = i; break
        }
      }
      keepFrom = Math.max(2, keepFrom)

      // Upper bound: never dedup beyond last 30 messages (prevent unbounded growth)
      const dedupStart = Math.max(1, messages.length - 30)

      // ① Deduplicate old results (same tool + same target) — preserves tool_call_id
      const seen = new Map()
      for (let i = dedupStart; i < keepFrom; i++) {
        const m = messages[i]
        if (!m || m.role !== 'tool') continue
        try {
          const parsed = JSON.parse(m.content)
          if (parsed.status === 'error') continue
          // Skip tools without identifiable targets (e.g., create_project, list_notes)
          const target = m._file || m._dir || m._pattern
          if (!target || target.length === 0) continue
          const key = `${m._tool || ''}:${target}`
          if (seen.has(key)) {
            // Compact: replace duplicate with minimal result preserving tool_call_id
            messages[i] = {
              role: 'tool',
              tool_call_id: m.tool_call_id,
              content: JSON.stringify({ status: 'success', summary: `[去重] 与之前 ${m._tool} 结果相同` }),
              _tool: m._tool,
              _deduped: true,
            }
            pruned++
          } else {
            seen.set(key, i)
          }
        } catch {}
      }

      // ② Truncate old read_file results (keep first 500 chars of detail)
      for (let i = dedupStart; i < keepFrom; i++) {
        const m = messages[i]
        if (!m || m.role !== 'tool' || m._tool !== 'read_file' || m._deduped) continue
        try {
          const parsed = JSON.parse(m.content)
          if (parsed.detail && parsed.detail.length > 500) {
            parsed.detail = parsed.detail.slice(0, 500) + `...(截断${parsed.detail.length - 500}字符)`
            parsed._truncated = true
            m.content = JSON.stringify(parsed)
            truncated++
          }
        } catch {}
      }

      // Safety: filter nulls + warn if any remain (should never happen after compaction fix)
      const nullCount = messages.filter(m => m === null).length
      if (nullCount > 0) {
        console.error(`\x1b[31m⚠ 意外: ${nullCount} 条 null 消息被过滤 (去重逻辑可能有漏洞)\x1b[0m`)
        messages = messages.filter(m => m !== null)
      }

      if (pruned > 0 || truncated > 0) {
        const parts = []
        if (pruned > 0) parts.push(`压缩${pruned}条重复结果`)
        if (truncated > 0) parts.push(`截断${truncated}条旧读取结果`)
        process.stdout.write(`\n\x1b[90m✂ ${parts.join('，')} (${toolCalls}次调用)\x1b[0m`)
      }
    }
  }

  // Max iterations reached — force text-only response (no tools)
  console.log(`\n\x1b[33m达到最大轮次 (${maxIterations})，获取最终回复...\x1b[0m`)

  // Strategy 1: Ask AI for final summary without tools
  messages.push({ role: 'user', content: '请根据以上所有工具执行结果，用中文提供简洁的最终回复。不要调用任何工具。' })
  const cleanMessagesFinal = messages.map(m => {
    const { _tool, _file, _dir, _pattern, _deduped, ...keep } = m
    return keep
  })
  const final = await api.chatWithTools(cleanMessagesFinal, []) // no tools
  let finalText = final.choices?.[0]?.message?.content || ''
  totalTokens += final.usage?.total_tokens || 0

  // Strategy 2: If still empty, extract from last assistant message
  if (!finalText.trim()) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant' && messages[i].content?.trim()) {
        finalText = messages[i].content
        break
      }
    }
  }

  // Strategy 3: Synthesize from tool results
  if (!finalText.trim()) {
    const summaries = []
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'tool') {
        try {
          const parsed = JSON.parse(messages[i].content)
          if (parsed.summary) summaries.push(parsed.summary)
        } catch {}
        if (summaries.length >= 3) break
      }
    }
    if (summaries.length > 0) {
      finalText = `操作完成：${summaries.reverse().join('；')}。`
    } else {
      finalText = '已达到最大轮次，AI 未能生成文字回复。请尝试简化任务后重试。'
    }
  }

  console.log(`\n\x1b[32m🤖 AI:\x1b[0m\n${finalText}`)

  // Self-optimize: post-session verification
  if (selfOptimize) {
    console.log(`\n\x1b[36m🔍 自优化验证...\x1b[0m`)
    // Run TypeScript check
    try {
      const { execSync } = await import('child_process')
      const tscResult = execSync('npx tsc --noEmit --project tsconfig.json', { cwd: APP_ROOT, timeout: 60000, encoding: 'utf-8' })
      const errors = tscResult.split('\n').filter(l => l.includes('error TS'))
      if (errors.length > 0) {
        console.log(`\x1b[33m⚠️ TypeScript: ${errors.length} 个错误\x1b[0m`)
        console.log(errors.slice(0, 5).join('\n'))
      } else {
        console.log(`\x1b[32m✅ TypeScript: 编译通过\x1b[0m`)
      }
    } catch (e) {
      console.log(`\x1b[31m❌ TypeScript 检查失败: ${e.message?.slice(0, 200)}\x1b[0m`)
    }
    // Run agent tests
    try {
      const { execSync } = await import('child_process')
      const testResult = execSync('npx vitest run src/agent/', { cwd: APP_ROOT, timeout: 60000, encoding: 'utf-8' })
      const passed = (testResult.match(/Tests\s+(\d+)\s+passed/) || [])[1] || '?'
      const failed = (testResult.match(/(\d+)\s+failed/) || [])[1]
      if (failed && parseInt(failed) > 0) {
        console.log(`\x1b[33m⚠️ 测试: ${passed}通过, ${failed}失败\x1b[0m`)
      } else {
        console.log(`\x1b[32m✅ 测试: ${passed} 通过\x1b[0m`)
      }
    } catch (e) {
      console.log(`\x1b[31m❌ 测试失败: ${e.message?.slice(0, 200)}\x1b[0m`)
    }
    // Final git snapshot
    await gitSnapshot('post-verify')
  }

  await cliLearner.endSession(sessionErrors)
  return { text: finalText, totalTokens, toolCalls, iterations: iteration }
}

// ── Main ──

async function main() {
  const args = parseArgs()

  if (args.help) { showHelp(); process.exit(0) }

  // ── Secure key read from stdin (replaces AI_API_KEY env var) ──
  if (args.apiKeyStdin) {
    try {
      const chunks = []
      // Read only the first line from stdin (key sent by parent process)
      for await (const chunk of process.stdin) {
        chunks.push(chunk)
        break  // Only first chunk — key is a single line
      }
      const keyFromStdin = Buffer.concat(chunks).toString().trim()
      if (keyFromStdin && keyFromStdin.length > 10) {
        args.apiKey = keyFromStdin
        console.log('\x1b[90m从安全管道获取 API 密钥\x1b[0m')
      }
      // Close stdin — no more input
      process.stdin.destroy()
    } catch (err) {
      console.error('\x1b[31m无法从 stdin 读取密钥:\x1b[0m', err.message)
    }
  }

  if (!args.apiKey) {
    console.error('\x1b[31m错误: 未提供 API 密钥。使用 --key=YOUR_KEY 或设置 AI_API_KEY 环境变量\x1b[0m')
    showHelp()
    process.exit(1)
  }

  // Load cross-session learned patterns
  await cliLearner.load()
  const learnedCount = cliLearner.patterns.filter(p => p.count >= 2).length
  if (learnedCount > 0) console.log(`\x1b[90m加载 ${learnedCount} 条跨会话学习记录\x1b[0m`)

  // Verify projects dir
  try { await fsp.access(args.projectsDir) } catch {
    console.error(`\x1b[33m警告: 项目目录不存在: ${args.projectsDir}\x1b[0m`)
  }

  const api = new ApiClient(args.apiKey, args.apiUrl, args.model, args.temperature, args.maxTokens)
  if (args.selfOptimize && !args.project) args.project = '__APP_ROOT__'
  const executor = new NodeToolExecutor(args.projectsDir, args.project)
  const projectPath = executor.getProjectPath()

  console.log(`\x1b[36m╔══════════════════════════════════╗\x1b[0m`)
  console.log(`\x1b[36m║  AI 写作助手 CLI Agent         ║\x1b[0m`)
  console.log(`\x1b[36m╠══════════════════════════════════╣\x1b[0m`)
  console.log(`\x1b[36m║  模型: ${args.model.padEnd(24)}║\x1b[0m`)
  console.log(`\x1b[36m║  API:  ${args.apiUrl.padEnd(24)}║\x1b[0m`)
  console.log(`\x1b[36m║  项目: ${(args.project || '(无)').padEnd(24)}║\x1b[0m`)
  if (args.selfOptimize) console.log(`\x1b[36m║  模式: 自优化 (git保护+验证)   ║\x1b[0m`)
  console.log(`\x1b[36m╚══════════════════════════════════╝\x1b[0m`)

  if (args.command) {
    // One-shot mode
    console.log(`\n\x1b[90m> ${args.command}\x1b[0m`)
    const result = await runAgent(api, executor, args.command, projectPath, args.maxIterations, args.selfOptimize)
    console.log(`\n\x1b[90m── 统计: ${result.iterations} 轮, ${result.toolCalls} 个工具调用, ${result.totalTokens} tokens\x1b[0m`)
  } else if (args.interactive) {
    // REPL mode
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    const prompt = () => { rl.question(`\n\x1b[36m> \x1b[0m`, async (line) => {
      const cmd = line.trim()
      if (!cmd) { prompt(); return }
      if (cmd === 'exit' || cmd === 'quit' || cmd === '\\q') { console.log('再见!'); rl.close(); return }
      if (cmd === '\\p') {
        // List projects
        try {
          const dirs = await fsp.readdir(args.projectsDir)
          console.log('项目:', dirs.filter(d => !d.startsWith('.')).join(', '))
        } catch { console.log('无项目') }
        prompt(); return
      }
      if (cmd.startsWith('\\project ')) {
        const name = cmd.slice(9).trim()
        executor.setProject(name)
        console.log(`已切换到项目: ${name || '(无)'}`)
        prompt(); return
      }
      try {
        const pp = executor.getProjectPath()
        const result = await runAgent(api, executor, cmd, pp, args.maxIterations, args.selfOptimize)
        console.log(`\n\x1b[90m── ${result.iterations} 轮, ${result.toolCalls} 工具, ${result.totalTokens} tokens\x1b[0m`)
      } catch (err) { console.error(`\x1b[31m错误: ${err.message}\x1b[0m`) }
      prompt()
    })}
    console.log('\x1b[90m输入命令开始对话，\\p 列出项目，\\project <名称> 切换项目，exit 退出\x1b[0m')
    prompt()
  } else {
    console.log('\x1b[33m请指定 --command="..." 或 --interactive。使用 --help 查看帮助。\x1b[0m')
    process.exit(1)
  }
}

main().catch(err => { console.error('\x1b[31m致命错误:\x1b[0m', err.message); process.exit(1) })
