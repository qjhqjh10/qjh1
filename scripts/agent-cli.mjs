#!/usr/bin/env node
/**
 * AI Writing Assistant — Headless CLI Agent
 *
 * Run the agent from the command line without the Electron GUI.
 * Useful for testing, automation, CI, and batch operations.
 *
 * Usage:
 *   node scripts/agent-cli.mjs --api-key=sk-xxx --api-url=https://api.deepseek.com
 *   node scripts/agent-cli.mjs --key=sk-xxx --project="我的项目" --command="列出项目文件"
 *   node scripts/agent-cli.mjs --key=sk-xxx --interactive
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

// ── Parse CLI args ──

function parseArgs() {
  const args = {
    apiKey: process.env.AI_API_KEY || '',
    apiUrl: process.env.AI_API_URL || 'https://api.deepseek.com',
    model: process.env.AI_MODEL || 'deepseek-chat',
    projectsDir: process.env.PROJECTS_DIR || path.join(APP_ROOT, 'projects'),
    project: null,
    command: null,
    interactive: false,
    maxIterations: 8,
    temperature: 0.8,
    maxTokens: 0,
    help: false,
  }

  for (const arg of process.argv.slice(2)) {
    if (arg === '--help' || arg === '-h') { args.help = true }
    else if (arg === '--interactive' || arg === '-i') { args.interactive = true }
    else if (arg.startsWith('--api-key=')) { args.apiKey = arg.slice(10) }
    else if (arg.startsWith('--key=')) { args.apiKey = arg.slice(6) }
    else if (arg.startsWith('--api-url=')) { args.apiUrl = arg.slice(10) }
    else if (arg.startsWith('--model=')) { args.model = arg.slice(8) }
    else if (arg.startsWith('--project=')) { args.project = arg.slice(10) }
    else if (arg.startsWith('--command=')) { args.command = arg.slice(10) }
    else if (arg.startsWith('--projects-dir=')) { args.projectsDir = arg.slice(15) }
    else if (arg.startsWith('--max-iters=')) { args.maxIterations = parseInt(arg.slice(12)) || 8 }
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
  --key=KEY          API 密钥 (或设置 AI_API_KEY 环境变量)
  --api-url=URL      API 地址 (默认: https://api.deepseek.com)
  --model=NAME       模型名称 (默认: deepseek-chat)
  --project=NAME     项目名称 (指定要操作的项目)
  --projects-dir=DIR 项目目录 (默认: ./projects)
  --command="..."    单次执行的命令 (非交互模式)
  -i, --interactive  交互模式 (REPL)
  --max-iters=N      最大工具调用轮次 (默认 8)
  --temperature=N    温度 (默认 0.8)
  -h, --help         显示此帮助

示例:
  # 一次性命令
  node scripts/agent-cli.mjs --key=sk-xxx --command="列出项目 1 的文件"

  # 交互模式
  node scripts/agent-cli.mjs --key=sk-xxx -i

  # 指定项目
  node scripts/agent-cli.mjs --key=sk-xxx --project="我的小说" -i

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
    if (!this.activeProject) return null
    return path.join(this.projectsDir, this.activeProject)
  }

  setProject(name) {
    this.activeProject = name
  }

  resolvePath(filePath, projectPath) {
    if (!projectPath) return null
    let clean = filePath.replace(/\\/g, '/')
    // If it's already an absolute path within projectPath, return as-is
    if (path.isAbsolute(clean) && clean.toLowerCase().startsWith(projectPath.toLowerCase())) {
      return clean.replace(/\//g, path.sep)
    }
    clean = clean.replace(/^\/+/, '')
    // For absolute paths outside project, just use basename
    if (path.isAbsolute(clean)) {
      clean = path.basename(clean)
    }
    // Strip ../ for safety
    while (clean.includes('../')) clean = clean.replace(/\.\.\//g, '')
    return path.join(projectPath, clean)
  }

  async execute(toolName, args, projectPath) {
    switch (toolName) {
      case 'list_directory': {
        const dir = args.dir_path ? this.resolvePath(String(args.dir_path), projectPath) : projectPath
        if (!dir) return { status: 'error', summary: '请先选择项目' }
        try {
          const entries = await fsp.readdir(dir, { withFileTypes: true })
          const items = entries.map(e => `${e.isDirectory() ? '[DIR]' : '[FILE]'} ${e.name}`).join('\n')
          return { status: 'success', summary: `${entries.length} 个项目`, detail: items || '(空目录)' }
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
        const dir = args.dir_path ? this.resolvePath(String(args.dir_path), projectPath) : projectPath
        if (!dir) return { status: 'error', summary: '请先选择项目' }
        const results = []
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
          return { status: 'success', summary: `${results.length} 个匹配文件`, detail: results.join('\n') || '未找到' }
        } catch { return { status: 'error', summary: '搜索失败' } }
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
        const fp = this.resolvePath(String(args.file_path || ''), projectPath)
        if (!fp) return { status: 'error', summary: '请先选择项目' }
        try { await fsp.access(fp); return { status: 'error', summary: `文件已存在: ${args.file_path}` } } catch { /* ok */ }
        await fsp.mkdir(path.dirname(fp), { recursive: true })
        await fsp.writeFile(fp, String(args.content || ''), 'utf-8')
        return { status: 'success', summary: `已创建 (${String(args.content || '').length} 字符)` }
      }

      case 'edit_file': {
        const fp = this.resolvePath(String(args.file_path || ''), projectPath)
        if (!fp) return { status: 'error', summary: '请先选择项目' }
        try {
          const content = await fsp.readFile(fp, 'utf-8')
          const oldStr = String(args.old_string || '')
          const newStr = String(args.new_string || '')
          if (oldStr === '__FULL_REPLACE__') {
            await fsp.writeFile(fp, newStr, 'utf-8')
            return { status: 'success', summary: `已全量替换 (${newStr.length} 字符)` }
          }
          if (!content.includes(oldStr)) {
            return { status: 'error', summary: '未找到要替换的文本', detail: '用 __FULL_REPLACE__ 进行全量替换' }
          }
          const count = content.split(oldStr).length - 1
          if (count > 1 && !args.replace_all) {
            return { status: 'error', summary: `old_string 出现 ${count} 次，请提供更多上下文或设 replace_all: true` }
          }
          const newContent = args.replace_all ? content.replaceAll(oldStr, newStr) : content.replace(oldStr, newStr)
          await fsp.writeFile(fp, newContent, 'utf-8')
          return { status: 'success', summary: `已替换` }
        } catch { return { status: 'error', summary: `文件不存在: ${args.file_path}` } }
      }

      case 'delete_file': {
        const fp = this.resolvePath(String(args.file_path || ''), projectPath)
        if (!fp) return { status: 'error', summary: '请先选择项目' }
        try { await fsp.unlink(fp); return { status: 'success', summary: '已删除' } } catch { return { status: 'error', summary: `文件不存在: ${args.file_path}` } }
      }

      case 'rename_file': {
        const fp = this.resolvePath(String(args.file_path || ''), projectPath)
        const np = this.resolvePath(String(args.new_path || ''), projectPath)
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

      case 'create_style_template':
      case 'create_scene_template': {
        return { status: 'success', summary: 'CLI 模式: 模板已创建', detail: '模板内容需在 GUI 中查看' }
      }

      case 'toggle_prompt':
      case 'update_prompt': {
        return { status: 'success', summary: 'CLI 模式不支持提示词修改' }
      }

      case 'list_rules': {
        const rulesDir = path.join(this.projectsDir, '..', '.aiharness', 'rules', 'auto-learned')
        try {
          const files = await fsp.readdir(rulesDir)
          const rules = []
          for (const f of files) {
            if (f.endsWith('.json')) {
              try {
                const raw = await fsp.readFile(path.join(rulesDir, f), 'utf-8')
                const rule = JSON.parse(raw)
                rules.push(`[${rule.status || 'auto'}] ${rule.title || f}: ${(rule.problem || '').slice(0, 80)}`)
              } catch { rules.push(f) }
            }
          }
          return { status: 'success', summary: `${rules.length} 条已学习规则`, detail: rules.join('\n') || '(暂无)' }
        } catch { return { status: 'success', summary: '0 条规则', detail: '(暂无已学习规则)' } }
      }

      case 'learn_rule': {
        const rulesDir2 = path.join(this.projectsDir, '..', '.aiharness', 'rules', 'auto-learned')
        await fsp.mkdir(rulesDir2, { recursive: true })
        const rule = {
          title: `[自动学习] ${args.trigger || ''}`,
          trigger: String(args.trigger || ''), problem: String(args.problem || ''),
          solution: String(args.solution || ''), category: String(args.category || 'general'),
          createdAt: new Date().toISOString(), status: 'auto-draft',
        }
        const id = `rule_${Date.now().toString(36)}`
        await fsp.writeFile(path.join(rulesDir2, `${id}.json`), JSON.stringify(rule, null, 2), 'utf-8')
        return { status: 'success', summary: `已记录规则: ${id}`, detail: '规则已保存到 .aiharness/rules/auto-learned/，下次会话自动生效' }
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
        const cmd = String(args.command || '')
        if (!/^(node|npm|npx|git|python|python3)\b/.test(cmd)) return { status: 'error', summary: '仅允许 node/npm/npx/git/python 命令' }
        if (/[;|&`$()]/.test(cmd)) return { status: 'error', summary: '命令包含禁止字符' }
        try {
          const { execSync } = await import('child_process')
          const output = execSync(cmd, { cwd: args.cwd || projectPath || '.', timeout: 30000, maxBuffer: 50000, encoding: 'utf-8' })
          return { status: 'success', summary: '命令执行完成', detail: output.slice(0, 50000) }
        } catch (e) { return { status: 'error', summary: `命令失败: ${e.message}`, detail: e.stderr || '' } }
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
    { name: 'create_style_template', desc: '创建风格模板。', params: { name: { type: 'string' }, dimensions: { type: 'object' } }, req: ['name'] },
    { name: 'create_scene_template', desc: '创建场景模板。', params: { name: { type: 'string' }, scene_type: { type: 'string' }, config: { type: 'object' } }, req: ['name'] },
    { name: 'create_project', desc: '创建新的写作项目。', params: { name: { type: 'string' }, novel_category: { type: 'string' } }, req: ['name'] },
    { name: 'delete_project', desc: '删除项目。需要用户确认。', params: { project_name: { type: 'string' } }, req: ['project_name'] },
    { name: 'list_prompts', desc: '列出提示词库中的提示词。', params: {}, req: [] },
    { name: 'toggle_prompt', desc: '启用或禁用提示词。', params: { prompt_name: { type: 'string' }, enabled: { type: 'boolean' } }, req: ['prompt_name'] },
    { name: 'update_prompt', desc: '修改提示词内容。', params: { prompt_name: { type: 'string' }, new_content: { type: 'string' } }, req: ['prompt_name'] },
    { name: 'list_rules', desc: '列出已学习规则。', params: {}, req: [] },
    { name: 'learn_rule', desc: '记录规则防再犯。', params: { trigger: { type: 'string' }, problem: { type: 'string' }, solution: { type: 'string' }, category: { type: 'string' } }, req: ['trigger', 'problem', 'solution'] },
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

const SYSTEM_PROMPT = `你是一个 AI 小说写作助手 Agent，在命令行模式下运行。
你可以通过工具调用来操作项目文件。每个工具调用必须实际执行，口头说"已完成"没有意义。

项目结构:
- outline/plot.md — 故事剧情 (Markdown)
- outline/worldbuilding.md — 世界观 (Markdown)
- characters/{拼音id}.json — 角色文件 (JSON)
- detailed_outline/{id}.json — 细纲 (JSON)
- chapters/{id}.txt — 章节正文
- summaries/{id}.md — 章节摘要

规则:
1. 创建/修改文件前，先 read_file 查看现有内容
2. 编辑时用 edit_file 精确替换
3. 匹配失败时用 old_string="__FULL_REPLACE__" 全量替换
4. 简洁高效，用最少的工具完成用户的任务`

async function runAgent(api, executor, userMessage, projectPath, maxIterations) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
  ]

  if (projectPath) {
    messages.push({ role: 'system', content: '当前项目已就绪。使用相对路径操作文件（如 "outline/plot.md"、"characters/" 等）。' })
    // List project structure to help AI understand what's available
    try {
      const entries = await fsp.readdir(projectPath)
      const structure = entries.filter(e => !e.startsWith('.')).join(', ')
      messages.push({ role: 'system', content: `项目顶级目录: ${structure}` })
    } catch { /* */ }
  }

  messages.push({ role: 'user', content: userMessage })

  let iteration = 0
  let totalTokens = 0
  let toolCalls = 0

  while (iteration < maxIterations) {
    iteration++
    process.stdout.write(`\n\x1b[36m[第 ${iteration} 轮]\x1b[0m `)

    const response = await api.chatWithTools(messages, TOOLS)
    const choice = response.choices?.[0]
    if (!choice) throw new Error('No response from API')

    totalTokens += response.usage?.total_tokens || 0
    const text = choice.message?.content || ''
    const calls = choice.message?.tool_calls

    if (!calls || calls.length === 0) {
      // Done — print response
      console.log(`\n\x1b[32m🤖 AI:\x1b[0m\n${text}`)
      return { text, totalTokens, toolCalls, iterations: iteration }
    }

    // Print text and tool calls
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

      const result = await executor.execute(fn.name, args, projectPath)
      toolCalls++

      const icon = result.status === 'success' ? '✅' : '❌'
      console.log(`  ${icon} ${result.summary}`)

      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(result),
      })
    }
  }

  // Max iterations reached — get final response
  console.log(`\n\x1b[33m达到最大轮次 (${maxIterations})，获取最终回复...\x1b[0m`)
  messages.push({ role: 'user', content: '请根据以上所有工具执行结果，提供最终回复。' })
  const final = await api.chatWithTools(messages, [])
  const finalText = final.choices?.[0]?.message?.content || ''
  totalTokens += final.usage?.total_tokens || 0
  console.log(`\n\x1b[32m🤖 AI:\x1b[0m\n${finalText}`)
  return { text: finalText, totalTokens, toolCalls, iterations: iteration }
}

// ── Main ──

async function main() {
  const args = parseArgs()

  if (args.help) { showHelp(); process.exit(0) }

  if (!args.apiKey) {
    console.error('\x1b[31m错误: 未提供 API 密钥。使用 --key=YOUR_KEY 或设置 AI_API_KEY 环境变量\x1b[0m')
    showHelp()
    process.exit(1)
  }

  // Verify projects dir
  try { await fsp.access(args.projectsDir) } catch {
    console.error(`\x1b[33m警告: 项目目录不存在: ${args.projectsDir}\x1b[0m`)
  }

  const api = new ApiClient(args.apiKey, args.apiUrl, args.model, args.temperature, args.maxTokens)
  const executor = new NodeToolExecutor(args.projectsDir, args.project)
  const projectPath = executor.getProjectPath()

  console.log(`\x1b[36m╔══════════════════════════════════╗\x1b[0m`)
  console.log(`\x1b[36m║  AI 写作助手 CLI Agent         ║\x1b[0m`)
  console.log(`\x1b[36m╠══════════════════════════════════╣\x1b[0m`)
  console.log(`\x1b[36m║  模型: ${args.model.padEnd(24)}║\x1b[0m`)
  console.log(`\x1b[36m║  API:  ${args.apiUrl.padEnd(24)}║\x1b[0m`)
  console.log(`\x1b[36m║  项目: ${(args.project || '(无)').padEnd(24)}║\x1b[0m`)
  console.log(`\x1b[36m╚══════════════════════════════════╝\x1b[0m`)

  if (args.command) {
    // One-shot mode
    console.log(`\n\x1b[90m> ${args.command}\x1b[0m`)
    const result = await runAgent(api, executor, args.command, projectPath, args.maxIterations)
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
        const result = await runAgent(api, executor, cmd, pp, args.maxIterations)
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
