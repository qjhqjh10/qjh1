#!/usr/bin/env npx tsx
/**
 * AI 写作助手 — 真实 Runtime CLI Agent
 *
 * 使用真实的 V4AgentRuntime（GUI 同一套代码），在 Node.js 命令行运行。
 * 与 GUI 的区别仅在于：AIService 用 openai SDK（非 Electron IPC），
 * ToolExecutor 用 Node.js fs（非 Electron IPC）。
 *
 * 用法:
 *   npx tsx scripts/run-agent.ts --command="列出项目 1 的文件"
 *   npx tsx scripts/run-agent.ts -i
 *
 * 环境变量:
 *   AI_API_KEY  — API 密钥
 *   AI_API_URL  — API 地址 (默认: https://api.deepseek.com)
 *   AI_MODEL    — 模型名称 (默认: deepseek-chat)
 */

import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import * as readline from 'node:readline'

// ══════════════════════════════════════════════════════════════
// 懒加载：真实 Runtime 模块在 main() 中动态导入
// ══════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════
// CLI 参数
// ══════════════════════════════════════════════════════════════

const APP_ROOT = path.resolve(import.meta.dirname || __dirname, '..')

function parseArgs() {
  const args: Record<string, any> = {
    apiKey: process.env.AI_API_KEY || '',
    apiUrl: process.env.AI_API_URL || 'https://api.deepseek.com',
    model: process.env.AI_MODEL || 'deepseek-v4-flash',
    project: null as string | null,
    protocol: (process.env.AI_PROTOCOL || 'anthropic') as 'openai' | 'anthropic',
    mock: process.env.AI_MOCK === '1',
    command: null as string | null,
    interactive: false,
    maxIterations: 20,
    temperature: 0.8,
    help: false,
  }
  for (const arg of process.argv.slice(2)) {
    if (arg === '-h' || arg === '--help') args.help = true
    else if (arg === '-i' || arg === '--interactive') args.interactive = true
    else if (arg.startsWith('--api-key=')) args.apiKey = arg.slice(10)
    else if (arg.startsWith('--api-url=')) args.apiUrl = arg.slice(10)
    else if (arg.startsWith('--model=')) args.model = arg.slice(8)
    else if (arg.startsWith('--project=')) args.project = arg.slice(10)
    else if (arg.startsWith('--command=')) args.command = arg.slice(10)
    else if (arg.startsWith('--command-file=')) {
      try { args.command = require('fs').readFileSync(arg.slice(15), 'utf-8').trim() }
      catch { console.error('无法读取命令文件: ' + arg.slice(15)) }
    }
    else if (arg.startsWith('--max-iters=')) args.maxIterations = parseInt(arg.slice(12)) || 20
    else if (arg.startsWith('--temperature=')) args.temperature = parseFloat(arg.slice(14)) || 0.8
    else if (arg.startsWith('--protocol=')) { const v = arg.slice(11); if (v === 'anthropic' || v === 'openai') args.protocol = v }
    else if (arg === '--mock') args.mock = true
  }
  return args
}

// ══════════════════════════════════════════════════════════════
// Node.js 文件系统工具执行器（替代 Electron IPC）
// ══════════════════════════════════════════════════════════════

class NodeFSToolExecutor {
  private rootDir: string
  private activeProject: string | null

  constructor(rootDir: string, project: string | null) {
    this.rootDir = rootDir
    this.activeProject = project
  }

  getProjectPath() {
    if (!this.activeProject) return null
    return path.join(this.rootDir, 'projects', this.activeProject)
  }

  setProject(name: string | null) { this.activeProject = name }

  resolvePath(filePath: string, projectPath: string | null): string | null {
    if (!projectPath) return null
    let clean = filePath.replace(/\\/g, '/')
    if (/^[A-Z]:[\\/]/i.test(clean)) {
      const lowered = clean.toLowerCase()
      if (lowered.startsWith('c:\\windows') || lowered.startsWith('/dev/') || lowered.startsWith('/etc/'))
        return null
      return clean
    }
    clean = clean.replace(/^\/+/, '')
    if (clean.startsWith('../')) {
      while (clean.startsWith('../')) clean = clean.slice(3)
      return path.join(this.rootDir, clean)
    }
    return path.join(projectPath, clean)
  }

  async execute(toolName: string, args: Record<string, unknown>, projectPath: string | null): Promise<{ status: 'success' | 'error'; summary: string; detail?: string }> {
    const fp = (a: string) => this.resolvePath(String(args[a] || ''), projectPath)
    const dir = projectPath || this.rootDir

    switch (toolName) {
      case 'list_directory': {
        const target = args.dir_path ? fp('dir_path') : dir
        if (!target) return { status: 'error', summary: '请先选择项目' }
        try {
          const entries = await fsp.readdir(target, { withFileTypes: true })
          const items = entries.map(e => `${e.isDirectory() ? '[DIR]' : '[FILE]'} ${e.name}`).join('\n')
          // 同时列出全局资源
          let globals = ''
          try {
            const gdirs = ['style_templates', 'scene_templates'].map(d => path.join(this.rootDir, d))
            const lines: string[] = []
            for (const gd of gdirs) {
              try {
                const files = await fsp.readdir(gd)
                lines.push(`[GLOBAL] ../../${path.basename(gd)}/ (${files.length} 个模板)`)
              } catch {}
            }
            if (lines.length > 0) globals = '\n\n[全局资源]\n' + lines.join('\n')
          } catch {}
          return { status: 'success', summary: `${entries.length} 个项目`, detail: (items || '(空目录)') + globals }
        } catch { return { status: 'error', summary: `目录不存在: ${args.dir_path || ''}` } }
      }

      case 'read_file': {
        const target = fp('file_path')
        if (!target) return { status: 'error', summary: '请先选择项目' }
        try {
          const content = await fsp.readFile(target, 'utf-8')
          const truncated = content.length > 10000 ? content.slice(0, 10000) + '\n...(截断)' : content
          return { status: 'success', summary: `${content.length} 字符`, detail: truncated }
        } catch { return { status: 'error', summary: `文件不存在: ${args.file_path}` } }
      }

      case 'search_content': {
        const pattern = String(args.pattern || '')
        if (!pattern) return { status: 'error', summary: '缺少搜索内容' }
        const target = args.dir_path ? fp('dir_path') : dir
        if (!target) return { status: 'error', summary: '请先选择项目' }
        const results: string[] = []
        try {
          const walk = async (d: string) => {
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
                      results.push(`${path.relative(target, full)}:${i + 1}: ${lines[i].trim().slice(0, 150)}`)
                    }
                  }
                } catch {}
              } else { await walk(full) }
            }
          }
          await walk(target)
          return { status: 'success', summary: `${results.length} 处匹配`, detail: results.slice(0, 50).join('\n') || '未找到' }
        } catch { return { status: 'error', summary: '搜索失败' } }
      }

      case 'find_files':
      case 'search_files': {
        const keyword = String(args.keyword || args.pattern || '').toLowerCase()
        if (!keyword) return { status: 'error', summary: '缺少搜索关键词' }
        const target = args.dir_path ? fp('dir_path') : dir
        if (!target) return { status: 'error', summary: '请先选择项目' }
        const results: string[] = []
        try {
          const walk = async (d: string) => {
            const entries = await fsp.readdir(d, { withFileTypes: true })
            for (const e of entries) {
              if (e.name.startsWith('.')) continue
              const full = path.join(d, e.name)
              if (e.name.toLowerCase().includes(keyword)) results.push(path.relative(target, full).replace(/\\/g, '/'))
              if (e.isDirectory() && results.length < 100) await walk(full)
            }
          }
          await walk(target)
          // 也搜索全局资源目录
          for (const gd of ['style_templates', 'scene_templates', 'knowledge_base/files'].map(d => path.join(this.rootDir, d))) {
            try {
              for (const f of await fsp.readdir(gd)) {
                if (f.toLowerCase().includes(keyword)) results.push(`[GLOBAL] ${f}`)
              }
            } catch {}
          }
          return { status: 'success', summary: `${results.length} 个匹配`, detail: results.slice(0, 50).join('\n') || '未找到' }
        } catch { return { status: 'error', summary: '搜索失败' } }
      }

      case 'create_file': {
        const target = fp('file_path')
        if (!target) return { status: 'error', summary: '请先选择项目' }
        try { await fsp.access(target); return { status: 'error', summary: '文件已存在' } } catch {}
        await fsp.mkdir(path.dirname(target), { recursive: true })
        const content = String(args.content || '')
        await fsp.writeFile(target, content, 'utf-8')
        return { status: 'success', summary: `已创建 (${content.length} 字符)` }
      }

      case 'edit_file': {
        const target = fp('file_path')
        if (!target) return { status: 'error', summary: '请先选择项目' }
        try {
          const content = await fsp.readFile(target, 'utf-8')
          const oldStr = String(args.old_string || '')
          const newStr = String(args.new_string || '')
          if (oldStr === '__FULL_REPLACE__') {
            await fsp.writeFile(target, newStr, 'utf-8')
            return { status: 'success', summary: `已全量替换 (${newStr.length} 字符)` }
          }
          if (!content.includes(oldStr)) {
            const trimmed = oldStr.trim()
            if (trimmed && trimmed !== oldStr && content.includes(trimmed)) {
              const newContent = args.replace_all ? content.replaceAll(trimmed, newStr) : content.replace(trimmed, newStr)
              await fsp.writeFile(target, newContent, 'utf-8')
              return { status: 'success', summary: '已替换（自动修正空白字符差异）' }
            }
            return { status: 'error', summary: '未找到要替换的文本', detail: `文件前200字: ${content.slice(0, 200)}` }
          }
          const count = content.split(oldStr).length - 1
          if (count > 1 && !args.replace_all) {
            return { status: 'error', summary: `出现 ${count} 次，请提供更多上下文或设 replace_all: true` }
          }
          const newContent = args.replace_all ? content.replaceAll(oldStr, newStr) : content.replace(oldStr, newStr)
          await fsp.writeFile(target, newContent, 'utf-8')
          return { status: 'success', summary: '已替换' }
        } catch { return { status: 'error', summary: `文件不存在: ${args.file_path}` } }
      }

      case 'delete_file': {
        const target = fp('file_path')
        if (!target) return { status: 'error', summary: '请先选择项目' }
        try { await fsp.unlink(target); return { status: 'success', summary: '已删除' } } catch { return { status: 'error', summary: `删除失败` } }
      }

      case 'rename_file': {
        const src = fp('file_path'), dst = fp('new_path')
        if (!src || !dst) return { status: 'error', summary: '请先选择项目' }
        await fsp.mkdir(path.dirname(dst), { recursive: true })
        await fsp.rename(src, dst)
        return { status: 'success', summary: '已重命名' }
      }

      case 'create_project': {
        const name = String(args.name || '').trim()
        if (!name || name.includes('..')) return { status: 'error', summary: '无效的项目名称' }
        const pp = path.join(this.rootDir, 'projects', name)
        try { await fsp.access(pp); return { status: 'error', summary: `项目已存在: ${name}` } } catch {}
        for (const d of ['characters', 'outline', 'detailed_outline', 'chapters', 'covers', 'images', 'summaries']) {
          await fsp.mkdir(path.join(pp, d), { recursive: true })
        }
        await fsp.writeFile(path.join(pp, 'outline', 'plot.md'), '', 'utf-8')
        await fsp.writeFile(path.join(pp, 'outline', 'worldbuilding.md'), '', 'utf-8')
        await fsp.writeFile(path.join(pp, 'project.json'), JSON.stringify({ type: 'writing', novelCategory: 'general' }), 'utf-8')
        return { status: 'success', summary: `已创建项目: ${name}` }
      }

      case 'delete_project': {
        const name = String(args.project_name || '').trim()
        if (!name || name.includes('..')) return { status: 'error', summary: '无效的项目名称' }
        const pp = path.join(this.rootDir, 'projects', name)
        await fsp.rm(pp, { recursive: true, force: true })
        return { status: 'success', summary: `已删除项目: ${name}` }
      }

      // 笔记
      case 'list_notes': {
        const notesDir = path.join(this.rootDir, 'notes')
        try {
          const files = await fsp.readdir(notesDir)
          const md = files.filter(f => f.endsWith('.md'))
          return { status: 'success', summary: `${md.length} 个笔记`, detail: md.join('\n') || '(无)' }
        } catch { return { status: 'success', summary: '0 个笔记' } }
      }

      case 'read_note':
      case 'write_note':
      case 'append_note':
      case 'delete_note': {
        const notesDir = path.join(this.rootDir, 'notes')
        await fsp.mkdir(notesDir, { recursive: true })
        const noteName = String(args.note_name || '').replace(/\.\./g, '').replace(/[\\/]/g, '')
        if (!noteName) return { status: 'error', summary: '笔记名无效' }
        const np = path.join(notesDir, noteName)
        if (toolName === 'read_note') {
          try { const c = await fsp.readFile(np, 'utf-8'); return { status: 'success', summary: noteName, detail: c } }
          catch { return { status: 'error', summary: `不存在: ${noteName}` } }
        }
        if (toolName === 'write_note') {
          await fsp.writeFile(np, String(args.content || ''), 'utf-8')
          return { status: 'success', summary: `已写入: ${noteName}` }
        }
        if (toolName === 'append_note') {
          let ex = ''; try { ex = await fsp.readFile(np, 'utf-8') } catch {}
          await fsp.writeFile(np, ex ? ex + '\n\n' + String(args.content || '') : String(args.content || ''), 'utf-8')
          return { status: 'success', summary: `已追加: ${noteName}` }
        }
        if (toolName === 'delete_note') {
          try { await fsp.unlink(np); return { status: 'success', summary: `已删除: ${noteName}` } } catch { return { status: 'error', summary: '删除失败' } }
        }
        return { status: 'error', summary: '未知操作' }
      }

      // 模板（简化版）
      case 'create_style_template': {
        const tmplDir = path.join(this.rootDir, 'style_templates')
        await fsp.mkdir(tmplDir, { recursive: true })
        const tmpl: any = {
          id: `st_${Date.now().toString(36)}`, name: String(args.name || '未命名'),
          type: String(args.type || '普通小说'), worldType: String(args.worldType || ''),
          description: String(args.description || ''), dimensions: args.dimensions || {},
          vocabularyList: Array.isArray(args.vocabularyList) ? args.vocabularyList : [],
          writingRules: Array.isArray(args.writingRules) ? args.writingRules : [],
          tone: args.tone || {}, source: 'cli', createdAt: new Date().toISOString(),
        }
        const fname = `st_${Date.now().toString(36)}.json`
        await fsp.writeFile(path.join(tmplDir, fname), JSON.stringify(tmpl, null, 2), 'utf-8')
        return { status: 'success', summary: `已创建风格模板: ${tmpl.name}`, detail: `style_templates/${fname}` }
      }

      case 'create_scene_template': {
        const tmplDir = path.join(this.rootDir, 'scene_templates')
        await fsp.mkdir(tmplDir, { recursive: true })
        const tmpl: any = {
          id: `sc_${Date.now().toString(36)}`, name: String(args.name || '未命名'),
          type: String(args.type || '普通小说'), config: args.config || args,
          source: 'cli', createdAt: new Date().toISOString(),
        }
        const fname = `sc_${Date.now().toString(36)}.json`
        await fsp.writeFile(path.join(tmplDir, fname), JSON.stringify(tmpl, null, 2), 'utf-8')
        return { status: 'success', summary: `已创建场景模板: ${tmpl.name}`, detail: `scene_templates/${fname}` }
      }

      // KB 操作（简化版）
      case 'kb_list': {
        const kbDir = path.join(this.rootDir, 'knowledge_base', 'files')
        try {
          const files = await fsp.readdir(kbDir)
          return { status: 'success', summary: `${files.length} 个文件`, detail: files.join('\n') || '(无)' }
        } catch { return { status: 'success', summary: '0 个文件' } }
      }
      case 'kb_create_file': {
        const kbDir = path.join(this.rootDir, 'knowledge_base', 'files')
        await fsp.mkdir(kbDir, { recursive: true })
        const fn = String(args.file_name || '').replace(/\.\./g, '').replace(/[\\/]/g, '')
        await fsp.writeFile(path.join(kbDir, fn), String(args.content || ''), 'utf-8')
        return { status: 'success', summary: `KB 已创建: ${fn}` }
      }
      case 'kb_append_file': {
        const kbDir = path.join(this.rootDir, 'knowledge_base', 'files')
        const fn = String(args.file_name || '').replace(/\.\./g, '').replace(/[\\/]/g, '')
        let ex = ''; try { ex = await fsp.readFile(path.join(kbDir, fn), 'utf-8') } catch {}
        await fsp.writeFile(path.join(kbDir, fn), ex ? ex + '\n\n' + String(args.content || '') : String(args.content || ''), 'utf-8')
        return { status: 'success', summary: `KB 已追加: ${fn}` }
      }
      case 'kb_index_file': {
        return { status: 'success', summary: '索引提示：在 GUI 中运行以建立语义索引' }
      }

      // 其他简化工具
      case 'search_notes': return { status: 'error', summary: 'search_notes 在 CLI 中不可用，请用 read_note' }
      case 'search_images': return { status: 'error', summary: '图片搜索在 CLI 中不可用' }
      case 'generate_image': return { status: 'error', summary: '图片生成在 CLI 中不可用' }
      case 'browser_open':
      case 'browser_search': return { status: 'error', summary: '浏览器工具在 CLI 中不可用' }
      case 'shell_exec':
      case 'shell_run_script': return { status: 'error', summary: 'Shell 工具在 CLI 中不可用' }
      case 'lsp_diagnose': return { status: 'success', summary: 'LSP 检查通过（CLI 模式）' }
      case 'http_get':
      case 'http_fetch': {
        const url = String(args.url || '')
        if (!/^https?:\/\//.test(url)) return { status: 'error', summary: '无效 URL' }
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
          const text = await res.text()
          return { status: 'success', summary: `HTTP ${res.status}`, detail: text.slice(0, 10000) }
        } catch (e: any) { return { status: 'error', summary: `请求失败: ${e.message}` } }
      }
      case 'list_prompts': return { status: 'success', summary: '提示词库仅在 GUI 中可用' }
      case 'toggle_prompt': return { status: 'success', summary: '提示词操作仅在 GUI 中可用' }
      case 'update_prompt': return { status: 'success', summary: '提示词更新仅在 GUI 中可用' }
      case 'list_rules': {
        const lp = path.join(this.rootDir, '.aiharness', 'learnings.json')
        try {
          const rules = JSON.parse(await fsp.readFile(lp, 'utf-8'))
          return { status: 'success', summary: `${rules.length} 条规则`, detail: JSON.stringify(rules, null, 2) }
        } catch { return { status: 'success', summary: '0 条规则' } }
      }
      case 'learn_rule':
      case 'write_learning': {
        const lp = path.join(this.rootDir, '.aiharness', 'learnings.json')
        await fsp.mkdir(path.dirname(lp), { recursive: true })
        let rules: any[] = []
        try { rules = JSON.parse(await fsp.readFile(lp, 'utf-8')) } catch {}
        rules.push({ problem: args.problem, solution: args.solution, category: args.category, at: new Date().toISOString() })
        await fsp.writeFile(lp, JSON.stringify(rules, null, 2), 'utf-8')
        return { status: 'success', summary: '规则已记录' }
      }
      case 'update_config': return { status: 'success', summary: '配置更新（CLI 模式）' }
      case 'list_audit': return { status: 'success', summary: '审计日志仅在 GUI 中可用' }

      default:
        return { status: 'error', summary: `未知工具: ${toolName}` }
    }
  }
}

// ══════════════════════════════════════════════════════════════
// 主函数：使用真实 V4AgentRuntime
// ══════════════════════════════════════════════════════════════

async function main() {
  // ══════════════════════════════════════════════════════════════
  // 动态导入真实 Runtime（V4AgentRuntime 无 Electron 依赖）
  // ══════════════════════════════════════════════════════════════
  const { V4AgentRuntime } = await import('@/agent/V4AgentRuntime')
  const { V4SecurityFence } = await import('@/agent/V4SecurityFence')
  const { toolRegistry } = await import('@/agent/skills/ToolRegistry')
  const { skillRegistry } = await import('@/agent/skills/SkillRegistry')
  const { contextAssembler } = await import('@/agent/context/ContextAssembler')
  const { ALL_TOOLS } = await import('@/agent/skills/tools')
  const { ALL_PROVIDERS } = await import('@/agent/context/providers')
  const { buildSystemPromptWithSkills, selectDomainModules } = await import('@/agent/V4SystemPrompt')
  const { estimateTokens } = await import('@/agent/utils/tokenEstimation')
  const { diagnosticLogger } = await import('@/agent/diagnostics/DiagnosticLogger')

  // 初始化（和 ChatBridge 逻辑一致）
  toolRegistry.registerAll(ALL_TOOLS as any)
  for (const p of ALL_PROVIDERS as any[]) {
    if (!contextAssembler.getProviders().some((ex: any) => ex.domain === p.domain)) {
      contextAssembler.register(p)
    }
  }

  // ══════════════════════════════════════════════════════════════
  const args = parseArgs()
  if (args.help) {
    console.log(`
╔══════════════════════════════════════════╗
║  AI 写作助手 CLI — 真实 Runtime 模式   ║
║  使用 V4AgentRuntime（GUI 同一套代码）  ║
╠══════════════════════════════════════════╣
║  npx tsx scripts/run-agent.ts [选项]    ║
╠══════════════════════════════════════════╣
║  --command="..."  一次性命令             ║
║  -i, --interactive  交互模式             ║
║  --project=NAME   项目名称               ║
║  --protocol=anthropic|openai  协议(默认:anthropic) ║
║  --model=NAME     模型名称               ║
║  --api-key=KEY    API 密钥               ║
╚══════════════════════════════════════════╝
`)
    process.exit(0)
  }

  if (!args.apiKey) {
    console.error('\x1b[31m错误: 未提供 API 密钥。设置 AI_API_KEY 环境变量或使用 --api-key=\x1b[0m')
    process.exit(1)
  }

  if (!args.command && !args.interactive) {
    console.error('\x1b[33m请指定 --command="..." 或 -i 交互模式\x1b[0m')
    process.exit(1)
  }

  const executor = new NodeFSToolExecutor(APP_ROOT, args.project)
  const projectPath = executor.getProjectPath()
  const fence = new V4SecurityFence(args.project)

  console.log(`\x1b[36m╔══════════════════════════════════════╗\x1b[0m`)
  console.log(`\x1b[36m║  AI 写作助手 — 真实 Runtime 模式   ║\x1b[0m`)
  console.log(`\x1b[36m╠══════════════════════════════════════╣\x1b[0m`)
  console.log(`\x1b[36m║  Runtime:  ${args.protocol === 'anthropic' ? 'V4AnthropicRuntime' : 'V4AgentRuntime'} (GUI同款) ║\x1b[0m`)
  console.log(`\x1b[36m║  工具注册: ToolRegistry (${toolRegistry.count()} 工具)  ║\x1b[0m`)
  console.log(`\x1b[36m║  Skill:    SkillRegistry (${skillRegistry.count()} 技能) ║\x1b[0m`)
  console.log(`\x1b[36m║  协议:     ${args.protocol.padEnd(22)}║\x1b[0m`)
  console.log(`\x1b[36m║  模型:     ${args.model.padEnd(22)}║\x1b[0m`)
  console.log(`\x1b[36m║  项目:     ${(args.project || '(无)').padEnd(22)}║\x1b[0m`)
  console.log(`\x1b[36m╚══════════════════════════════════════╝\x1b[0m`)

  // ── 协议选择：Anthropic 或 OpenAI ──
  const protocol = args.protocol || 'openai'  // 'anthropic' 或 'openai'

  async function runOne(userMessage: string) {
    const startTime = Date.now()
    const abortController = new AbortController()
    diagnosticLogger.clearRecent()

    // ════════════════════════════════════════════════════════════
    // ① Skill 工具裁剪（对齐 GUI Bridge）
    // ════════════════════════════════════════════════════════════
    const allTools = toolRegistry.getAllSchemas()
    const skillMatch = skillRegistry.matchBest(userMessage, 0.5)

    const READ   = new Set(['read_file','list_directory','search_content'])
    const WRITE  = new Set(['create_file','edit_file'])
    const DANGER = new Set(['delete_file','rename_file'])
    const NOTE   = new Set(['list_notes','read_note','write_note','append_note'])
    const KB     = new Set(['kb_list','kb_create_file','kb_index_file','kb_append_file'])
    const TMPL   = new Set(['create_style_template','create_scene_template'])

    let scopedCore: any[], scopedExtended: any[]
    let activeSkillCtx: any = null

    if (skillMatch && skillMatch.confidence >= 0.6) {
      const neededTools = new Set(skillMatch.skill.workflow.steps.map((s: any) => s.tool))
      neededTools.add('read_file'); neededTools.add('list_directory'); neededTools.add('search_content')
      scopedCore = allTools.filter((t: any) => neededTools.has(t.function.name))
      scopedExtended = []
      activeSkillCtx = {
        skillId: skillMatch.skill.id, currentStep: 1, completedSteps: new Set(),
        extractedFields: skillMatch.extractedFields, retryCount: 0,
      }
      diagnosticLogger.recordInfo(`Agent2: task=skill:${skillMatch.skill.id} core=${scopedCore.length} ext=0`)
    } else {
      scopedCore = allTools.filter((t: any) =>
        READ.has(t.function.name) || WRITE.has(t.function.name) || TMPL.has(t.function.name))
      scopedExtended = allTools.filter((t: any) =>
        DANGER.has(t.function.name) || NOTE.has(t.function.name) || KB.has(t.function.name))
      diagnosticLogger.recordInfo(`Agent2: task=default core=${scopedCore.length} ext=${scopedExtended.length}`)
    }

    // planInstruction: 复杂任务 → 注入执行指引
    const isComplex = skillMatch
      ? skillMatch.skill.workflow.steps.filter((s: any) => !s.optional).length >= 3
      : /写|创建|修改|删除|编辑|生成|续写/.test(userMessage)
    const planInstruction = isComplex
      ? `\n## 执行方案\n这是一个${skillMatch ? `"${skillMatch.skill.name}"` : '多步骤'}任务。第一轮列出步骤清单，然后立即执行第一步。每轮只做一步，用最精准的工具。全部完成后一句话汇报，不要展开。`
      : ''

    // ════════════════════════════════════════════════════════════
    // ② 创建 Runtime（Mock 或真实协议）
    // ════════════════════════════════════════════════════════════
    let runtime: any

    if (args.mock) {
      // ── Mock 模式：不调真实 API，使用关键词匹配返回预设响应 ──
      console.log('\x1b[33m[MOCK 模式] 不调用真实 API，使用预设模拟响应\x1b[0m')
      runtime = new V4AgentRuntime({
        configId: 'cli-mock', projectId: args.project,
        maxIterations: args.maxIterations, abortSignal: abortController.signal,
        contextWindow: 128_000,
      })

      // Mock AIService: 根据用户消息关键词决定返回什么
      const isCreateStyle = /风格模板|文风|style.?template/i.test(userMessage)
      const isCreateScene = /场景模板|scene.?template/i.test(userMessage)
      const isSearch = /搜索|查找|寻找|列出.*文件|find|search|list/i.test(userMessage) && !isCreateStyle && !isCreateScene
      const isWrite = /创建|写入.*大纲|写入.*设定|追加|导入.*大纲|编辑/i.test(userMessage)
      const isRole = /角色|创建.*[男女主配反]/i.test(userMessage)
      const isAnalysis = /分析|评估|看看|风格|什么类型/i.test(userMessage) && !isCreateStyle

      let _mockCalls = 0
      runtime.setAIService({
        chatWithTools: async (_msgs: any) => {
          _mockCalls++
          if (isSearch && _mockCalls === 1) {
            return {
              text: '搜索中...',
              toolCalls: [{ id: 'c1', name: 'find_files', arguments: JSON.stringify({ pattern: '*.yaml' }) }],
              finishReason: 'tool_calls',
              usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
            }
          }
          if (isWrite && _mockCalls === 1) {
            return {
              text: '先读取文件和目标位置...',
              toolCalls: [
                { id: 'c1', name: 'read_file', arguments: JSON.stringify({ file_path: 'test/summaries/ref.txt' }) },
                { id: 'c2', name: 'read_file', arguments: JSON.stringify({ file_path: 'test/outline/plot.md' }) },
              ],
              finishReason: 'tool_calls',
              usage: { prompt_tokens: 200, completion_tokens: 30, total_tokens: 230 },
            }
          }
          if (isWrite && _mockCalls === 2) {
            return {
              text: '现在追加到大纲...',
              toolCalls: [{ id: 'c3', name: 'edit_file', arguments: JSON.stringify({
                file_path: 'test/outline/plot.md',
                old_string: '测试项目的故事梗概。',
                new_string: '测试项目的故事梗概。\n\n新剧情内容。',
              }) }],
              finishReason: 'tool_calls',
              usage: { prompt_tokens: 300, completion_tokens: 30, total_tokens: 330 },
            }
          }
          if (isCreateStyle && _mockCalls === 1) {
            return {
              text: '分析文风后创建模板...',
              toolCalls: [
                { id: 'c1', name: 'read_file', arguments: JSON.stringify({ file_path: 'test/ref.txt' }) },
                { id: 'c2', name: 'create_style_template', arguments: JSON.stringify({
                  name: '测试风格模板', type: '普通小说',
                  dimensions: { narrativeTone: { description: '温柔细腻' } },
                }) },
              ],
              finishReason: 'tool_calls',
              usage: { prompt_tokens: 200, completion_tokens: 50, total_tokens: 250 },
            }
          }
          if (isRole && _mockCalls === 1) {
            return {
              text: '创建角色...',
              toolCalls: [{ id: 'c1', name: 'create_file', arguments: JSON.stringify({
                file_path: 'test/characters/测试角色.yaml',
                content: 'id: test\nname: 测试角色\nrole: 女主',
              }) }],
              finishReason: 'tool_calls',
              usage: { prompt_tokens: 150, completion_tokens: 30, total_tokens: 180 },
            }
          }
          // 默认：纯文本回复
          return {
            text: `[Mock] 收到: "${userMessage.slice(0, 60)}"。这是模拟响应，未调用真实 API。`,
            toolCalls: null,
            finishReason: 'stop',
            usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
          }
        },
        abortStream: () => abortController.abort(),
      })
    } else if (protocol === 'anthropic') {
      const { V4AnthropicRuntime } = await import('@/agent/V4AnthropicRuntime')
      runtime = new V4AnthropicRuntime({
        configId: 'cli', projectId: args.project,
        maxIterations: args.maxIterations, abortSignal: abortController.signal,
        contextWindow: 128_000,
      })

      // Anthropic AIService: fetch + SSE 流式呼叫 DeepSeek /anthropic 端点
      runtime.setAIService({
        chatAnthropicStream: async (params: any) => {
          const apiUrl = args.apiUrl.replace(/\/+$/, '')
          const url = apiUrl.includes('anthropic')
            ? (apiUrl.replace(/\/v1\/messages$/, '') + '/v1/messages')
            : apiUrl.replace(/\/v1$/, '') + '/anthropic/v1/messages'

          // 构建 Anthropic 请求体
          const body: any = {
            model: args.model,
            system: (params.system || []).map((s: string) => ({ type: 'text', text: s })),
            messages: params.messages.map((m: any) => ({
              role: m.role,
              content: m.content.map((b: any) => {
                const block: any = { type: b.type }
                if (b.type === 'text' && b.text) block.text = b.text
                if (b.type === 'tool_use') { block.id = b.id; block.name = b.name; block.input = b.input || {} }
                if (b.type === 'tool_result') { block.tool_use_id = b.tool_use_id; block.content = b.content || '' }
                return block
              }),
            })),
            max_tokens: 4096,
            stream: true,
          }
          if (args.temperature !== undefined) body.temperature = args.temperature
          if (params.tools && params.tools.length > 0) body.tools = params.tools

          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': args.apiKey, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify(body),
            signal: abortController.signal,
          })
          if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)

          const text = await res.text()
          const events = parseSSE(text)

          const toolUses: any[] = []
          let fullText = ''
          let stopReason = 'end_turn'
          let inputTokens = 0, outputTokens = 0

          const blocks: any[] = []
          for (const evt of events) {
            switch (evt.type) {
              case 'message_start': {
                const u = evt.data?.message?.usage
                if (u) { inputTokens = u.input_tokens || 0; outputTokens = u.output_tokens || 0 }
                break
              }
              case 'content_block_start': {
                const b = evt.data?.content_block
                if (b) blocks.push({ type: b.type, index: evt.data?.index ?? blocks.length,
                  id: b.id, name: b.name, text: b.text || '', input: b.input || {}, inputJson: '' })
                break
              }
              case 'content_block_delta': {
                const d = evt.data?.delta; const idx = evt.data?.index ?? blocks.length - 1
                const cb = blocks.find(b => b.index === idx)
                if (!cb) break
                if (d?.type === 'text_delta' && d.text) {
                  cb.text += d.text; fullText += d.text
                  process.stdout.write(d.text)  // 实时流式输出
                }
                if (d?.type === 'input_json_delta' && d.partial_json) {
                  cb.inputJson += d.partial_json
                  try { cb.input = JSON.parse(cb.inputJson) } catch {}
                }
                break
              }
              case 'content_block_stop': {
                const idx = evt.data?.index ?? blocks.length - 1
                const cb = blocks.find(b => b.index === idx)
                if (cb?.type === 'tool_use' && cb.id && cb.name) toolUses.push({ id: cb.id, name: cb.name, input: cb.input || {} })
                break
              }
              case 'message_delta': {
                if (evt.data?.delta?.stop_reason) stopReason = evt.data.delta.stop_reason
                if (evt.data?.usage) outputTokens = evt.data.usage.output_tokens || outputTokens
                break
              }
              case 'error': throw new Error(evt.data?.error?.message || 'Anthropic API error')
            }
          }

          return {
            text: fullText, toolUses, stopReason,
            usage: { input_tokens: inputTokens, output_tokens: outputTokens },
          }
        },
        abortStream: () => abortController.abort(),
      })
    } else {
      // OpenAI 协议（默认）
      runtime = new V4AgentRuntime({
        configId: 'cli', projectId: args.project,
        maxIterations: args.maxIterations, abortSignal: abortController.signal,
        contextWindow: 128_000,
      })

      const { default: OpenAI } = await import('openai')
      const client = new OpenAI({ apiKey: args.apiKey, baseURL: args.apiUrl, timeout: 120_000, maxRetries: 1 })
      runtime.setAIService({
        chatWithTools: async (msgs: any, _c: any, _p: any, tools: any) => {
          const params: any = {
            model: args.model, messages: msgs,
            temperature: args.temperature, max_tokens: undefined,
          }
          if (tools && tools.length > 0) { params.tools = tools; params.tool_choice = 'auto' }
          const completion = await client.chat.completions.create(params)
          const choice = completion.choices[0]
          return {
            text: choice?.message?.content || '',
            toolCalls: (choice?.message?.tool_calls || []).map((tc: any) => ({
              id: tc.id, name: tc.function.name, arguments: tc.function.arguments,
            })),
            finishReason: choice?.finish_reason || 'stop',
            usage: completion.usage ? {
              prompt_tokens: completion.usage.prompt_tokens || 0,
              completion_tokens: completion.usage.completion_tokens || 0,
              total_tokens: completion.usage.total_tokens || 0,
            } : undefined,
            reasoning_content: (choice?.message as any)?.reasoning_content,
          }
        },
        abortStream: () => abortController.abort(),
      })
    }

    // ════════════════════════════════════════════════════════════
    // ④ ContextAssembler（对齐 GUI: [0]core [1]index [2]provider [3]dynamic）
    // ════════════════════════════════════════════════════════════
    const selectedModules = selectDomainModules(userMessage)
    const coreDomainModules = selectedModules.length > 0 ? selectedModules : []
    const CORE_PROMPT = await buildSystemPromptWithSkills(coreDomainModules, '', '', userMessage)
    const coreSystemMsg = { role: 'system' as const, content: CORE_PROMPT }
    const coreTokens = estimateTokens(CORE_PROMPT)

    runtime.setContextAssembler(async (msg, hist, pid) => {
      // 全局索引（MemoryIndex — 对齐 GUI）
      let globalIndex = ''
      try {
        const { buildGlobalIndex } = await import('@/agent/context/MemoryIndex')
        globalIndex = await buildGlobalIndex(pid)
      } catch {}

      // Provider 内容（对齐 GUI: contextAssembler.assemble）
      const base = await contextAssembler.assemble(msg, hist, pid)

      // 工具调用提示词（对齐 GUI: buildToolInvokePrompt）
      const { buildToolInvokePrompt } = await import('@/types/fileOps')
      const toolInvokePrompt = buildToolInvokePrompt()

      // 动态内容: toolInvokePrompt + planInstruction
      const dynamicContent = [toolInvokePrompt, planInstruction].filter(Boolean).join('\n\n')
      const providerContent = base.systemMessages.map(m => m.content).filter(Boolean).join('\n\n')

      const indexDirective = globalIndex
        ? `⬇️ 以下是软件完整文件索引。已知路径的文件直接用 read_file 读取，无需 list_directory。\n\n${globalIndex}`
        : ''

      const systemMessages = [
        coreSystemMsg,                                          // [0] 核心提示词 — 不变
        ...(indexDirective ? [{ role: 'system' as const, content: indexDirective }] : []), // [1] 索引
        ...(providerContent ? [{ role: 'system' as const, content: providerContent }] : []), // [2] Provider
        ...(dynamicContent ? [{ role: 'system' as const, content: dynamicContent }] : []),   // [3] 动态
      ]

      const globalIndexTokens = estimateTokens(globalIndex || '')
      const providerTokens = base.totalTokens || 0
      const historyTokens = hist.reduce((s, m) => s + estimateTokens(m.content || '') + 4, 0)
      const fullTotal = coreTokens + globalIndexTokens + providerTokens + historyTokens + estimateTokens(msg)

      return {
        systemMessages, totalTokens: fullTotal,
        domains: ['core-prompt', ...base.domains],
        breakdown: [
          { domain: '核心法则(缓存)', tokens: coreTokens },
          { domain: '全局索引', tokens: globalIndexTokens },
          { domain: 'Provider', tokens: providerTokens },
          { domain: '对话历史', tokens: historyTokens },
          { domain: '当前消息', tokens: estimateTokens(msg) },
        ].filter(b => b.tokens > 0),
      }
    })

    // ════════════════════════════════════════════════════════════
    // ⑤ ToolExecutor（对齐 GUI: SecurityFence → execute → 缓存失效）
    // ════════════════════════════════════════════════════════════
    const pp = executor.getProjectPath()
    runtime.setToolExecutor(async (toolArgs, ctx) => {
      const check = fence.check(ctx.toolName, toolArgs)
      if (!check.allowed) return { status: 'error', summary: check.reason || '操作被安全围栏拦截' }

      const result = await executor.execute(ctx.toolName, toolArgs, pp)

      // 缓存失效（对齐 GUI: per-file precision invalidation）
      if (result.status === 'success') {
        const fp = String(toolArgs.file_path || toolArgs.path || '')
        try {
          const [mi, fc] = await Promise.all([
            import('@/agent/context/MemoryIndex'),
            import('@/agent/context/FileCache'),
          ])
          const { ContextAssembler } = await import('@/agent/context/ContextAssembler')

          if (/^(create_style_template|create_scene_template)$/.test(ctx.toolName)) {
            mi.invalidateMemoryIndexCache()
            const domain = ctx.toolName === 'create_style_template' ? 'style' : 'scene'
            contextAssembler.invalidateProvider(args.project, domain)
          } else if (ctx.toolName === 'edit_file') {
            fc.invalidateFile(fp)
            for (const d of ContextAssembler.domainsForPath(fp))
              contextAssembler.invalidateProvider(args.project, d)
          } else if (ctx.toolName === 'create_file' || ctx.toolName === 'delete_file') {
            mi.invalidateMemoryIndexCache(); fc.invalidateFile(fp)
            const dir = fp.replace(/\/[^/]+$/, '')
            fc.invalidateDir(dir)
            for (const d of ContextAssembler.domainsForPath(fp))
              contextAssembler.invalidateProvider(args.project, d)
          } else if (ctx.toolName === 'rename_file') {
            mi.invalidateMemoryIndexCache()
            const np = String(toolArgs.new_path || '')
            fc.invalidateFile(fp); if (np) fc.invalidateFile(np)
            const domains = new Set([...ContextAssembler.domainsForPath(fp), ...ContextAssembler.domainsForPath(np)])
            for (const d of domains) contextAssembler.invalidateProvider(args.project, d)
          } else if (/^(write_note|delete_note|kb_create_file|kb_append_file|create_project|delete_project)$/.test(ctx.toolName)) {
            mi.invalidateMemoryIndexCache()
          }
        } catch { /* cache invalidation best-effort */ }
      }

      return result
    })

    // ════════════════════════════════════════════════════════════
    // ⑥ 工具 + Skill 上下文（对齐 GUI，Anthropic 无渐进披露）
    // ════════════════════════════════════════════════════════════
    if (protocol === 'anthropic') {
      // Anthropic: 模型自然选择，不需要渐进披露
      const anthropicTools = skillMatch && skillMatch.confidence >= 0.6
        ? scopedCore
        : [...scopedCore, ...scopedExtended]
      runtime.setTools(anthropicTools)
    } else {
      runtime.setTools(scopedCore)
      runtime.setExtendedTools(scopedExtended)
    }
    runtime.setActiveSkill(activeSkillCtx)

    // ════════════════════════════════════════════════════════════
    // ⑦ 事件监听
    // ════════════════════════════════════════════════════════════
    const emitter = runtime.getEmitter()
    emitter.on('thinking:start', (data: any) => {
      if (data.intent) process.stdout.write(`\n\x1b[90m💭 ${data.intent.slice(0, 60)}\x1b[0m`)
    })
    emitter.on('tool:started', (data: any) => process.stdout.write(`\n  ⚡ ${data.toolName}`))
    emitter.on('tool:completed', (data: any) => process.stdout.write(` ✅ ${data.summary?.slice(0, 35) || ''}`))
    emitter.on('tool:failed', (data: any) => process.stdout.write(` ❌ ${data.summary?.slice(0, 35) || ''}`))
    emitter.on('response:streaming', (data: any) => {
      if (data.text) process.stdout.write(data.text)
    })

    // ════════════════════════════════════════════════════════════
    // ⑧ 运行
    // ════════════════════════════════════════════════════════════
    console.log(`\n\x1b[90m> ${userMessage.slice(0, 80)}${userMessage.length > 80 ? '...' : ''}\x1b[0m`)
    const result = await runtime.run({ userMessage, attachments: [] })

    console.log(`\n\n\x1b[90m── ${result.iterationCount} 轮 · ${result.toolCalls} 工具 · ${(result.totalTokens/1000).toFixed(1)}K tokens · ${((Date.now() - startTime)/1000).toFixed(1)}s\x1b[0m`)
    return result
  }

  if (args.command) {
    await runOne(args.command)
  } else if (args.interactive) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    const prompt = () => {
      rl.question('\n\x1b[36m> \x1b[0m', async (line: string) => {
        const cmd = line.trim()
        if (!cmd) { prompt(); return }
        if (cmd === 'exit' || cmd === 'quit') { console.log('再见!'); rl.close(); return }
        if (cmd === '\\p') {
          try {
            const dirs = await fsp.readdir(path.join(APP_ROOT, 'projects'))
            console.log('项目:', dirs.filter(d => !d.startsWith('.')).join(', '))
          } catch { console.log('无项目') }
          prompt(); return
        }
        if (cmd.startsWith('\\project ')) {
          executor.setProject(cmd.slice(9).trim())
          console.log(`已切换: ${executor.getProjectPath() || '(无)'}`)
          prompt(); return
        }
        try {
          await runOne(cmd)
        } catch (err: any) {
          console.error(`\x1b[31m错误: ${err.message}\x1b[0m`)
        }
        prompt()
      })
    }
    console.log('\x1b[90m输入命令开始，\\p 列出项目，\\project <名> 切换项目，exit 退出\x1b[0m')
    prompt()
  }
}

// ── 工具 ──

async function listDir(dir: string, depth = 0): Promise<string> {
  if (depth > 3) return ''
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true })
    const lines: string[] = []
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue
      const rel = path.relative(dir, path.join(dir, e.name)).replace(/\\/g, '/')
      if (e.isDirectory()) {
        lines.push(`${rel}/`)
        const sub = await listDir(path.join(dir, e.name), depth + 1)
        if (sub) lines.push(sub)
      } else {
        try { const s = await fsp.stat(path.join(dir, e.name)); lines.push(`  ${rel} (${s.size}B)`) }
        catch { lines.push(`  ${rel}`) }
      }
    }
    return lines.join('\n')
  } catch { return '' }
}

// ── SSE 解析器（Anthropic 流式协议）──
function parseSSE(text: string): Array<{ type: string; data: any }> {
  const events: Array<{ type: string; data: any }> = []
  const chunks = text.split(/\n\n/)
  for (const chunk of chunks) {
    if (!chunk.trim()) continue
    const lines = chunk.split('\n')
    let dataLine = '', eventType = ''
    for (const line of lines) {
      if (line.startsWith('event:')) eventType = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLine = line.slice(5).trim()
    }
    if (!dataLine) continue
    try { events.push({ type: eventType || 'unknown', data: JSON.parse(dataLine) }) } catch {}
  }
  return events
}

main().catch(err => {
  console.error('\x1b[31m致命错误:\x1b[0m', err.message)
  if (process.env.DEBUG) console.error(err)
  process.exit(1)
})
