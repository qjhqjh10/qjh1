#!/usr/bin/env npx tsx
/**
 * AI 写作助手 — 真实 Runtime CLI Agent
 *
 * 使用真实的 V4UnifiedRuntime（GUI 同一套代码），在 Node.js 命令行运行。
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
    maxIterations: 60,
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
    // v11.5.1: 全局目录名 → 始终解析到软件根目录
    const GLOBAL_PREFIXES = ['.aiharness/', 'uploads/', 'projects/', 'style_templates/', 'scene_templates/', 'knowledge_base/', 'notes/', 'agent-sessions/']
    const isGlobal = GLOBAL_PREFIXES.some(p => clean.startsWith(p))
    // 模型可能根据系统提示词拼接了项目名前缀（如 _test_dpc/outline/plot.md）
    // 剥掉这个前缀，避免 projectPath 与模型路径双重嵌套
    // 也处理项目名本身（如 "_cli_test" 不带子路径的情况）
    if (this.activeProject) {
      const prefix = this.activeProject + '/'
      if (clean.startsWith(prefix)) {
        clean = clean.slice(prefix.length)
      } else if (clean === this.activeProject) {
        clean = ''  // 整个路径就是项目名 → 解析到项目根目录
      }
    }
    return path.join(isGlobal ? this.rootDir : projectPath, clean)
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
          const stat = await fsp.stat(target)
          if (stat.isDirectory()) return { status: 'error', summary: `路径是目录，不是文件: ${args.file_path}。请用 list_directory 浏览目录。` }
          const content = await fsp.readFile(target, 'utf-8')
          return { status: 'success', summary: `${content.length} 字符`, detail: content }
        } catch { return { status: 'error', summary: `文件不存在: ${args.file_path}` } }
      }

      case 'search_content': {
        const pattern = String(args.pattern || '')
        if (!pattern) return { status: 'error', summary: '缺少搜索内容' }
        // v11.5.1: 始终从项目根目录搜索，忽略模型可能传入的无效 dir_path
        const target = dir
        if (!target) return { status: 'error', summary: '请先选择项目' }
        const results: string[] = []
        try {
          const walk = async (d: string) => {
            const entries = await fsp.readdir(d, { withFileTypes: true })
            for (const e of entries) {
              if (e.name.startsWith('.') || e.name === 'node_modules') continue
              const full = path.join(d, e.name)
              if (!e.isDirectory()) {
                try {
                  const content = await fsp.readFile(full, 'utf-8')
                  const lines = content.split('\n')
                  for (let i = 0; i < lines.length; i++) {
                    if (lines[i].includes(pattern)) {
                      results.push(`${path.relative(target, full)}:${i + 1}: ${lines[i].trim()}`)
                    }
                  }
                } catch {}
              } else { await walk(full) }
            }
          }
          await walk(target)
          return { status: 'success', summary: `${results.length} 处匹配`, detail: results.join('\n') || '未找到' }
        } catch (e: any) { return { status: 'error', summary: `搜索失败: ${e.message || '未知'}`, detail: `target=${target}` } }
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
              if (e.isDirectory()) await walk(full)
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
          return { status: 'success', summary: `${results.length} 个匹配`, detail: results.join('\n') || '未找到' }
        } catch { return { status: 'error', summary: '搜索失败' } }
      }

      case 'create_file': {
        const target = fp('file_path')
        if (!target) return { status: 'error', summary: '请先选择项目' }
        try { await fsp.access(target); return { status: 'error', summary: '文件已存在' } } catch {}
        const content = String(args.content || '')
        // v11.5.1: 大小限制（对齐后端 MAX_WRITE_CHARS）
        if (content.length > 500_000) {
          return { status: 'error', summary: `内容过大 (${content.length} 字符，上限 500000 字符)` }
        }
        await fsp.mkdir(path.dirname(target), { recursive: true })
        await fsp.writeFile(target, content, 'utf-8')
        const preview = content.length > 500 ? content.slice(0, 500) + '…' : content
        return { status: 'success', summary: `已创建 (${content.length} 字符)`, detail: preview }
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
            const preview = newStr.length > 500 ? newStr.slice(0, 500) + '…' : newStr
            return { status: 'success', summary: `已全量替换 (${newStr.length} 字符)`, detail: preview }
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

      case 'batch_replace': {
        const target = fp('file_path')
        if (!target) return { status: 'error', summary: '请先选择项目' }
        const replacements = args.replacements as Array<{ old_string: string; new_string: string }> | undefined
        if (!replacements || !Array.isArray(replacements) || replacements.length === 0) {
          return { status: 'error', summary: 'replacements 必须是非空数组' }
        }
        try {
          let content = await fsp.readFile(target, 'utf-8')
          if (content.length > 10_000_000) return { status: 'error', summary: '文件过大（>10MB）' }
          let modified = content; let applied = 0
          for (let i = 0; i < replacements.length; i++) {
            const { old_string, new_string } = replacements[i]
            if (old_string === '__FULL_REPLACE__') { modified = new_string; applied++; break }
            if (!modified.includes(old_string)) {
              return { status: 'error', summary: `第 ${i+1}/${replacements.length} 个替换失败: 未找到匹配文本` }
            }
            modified = modified.replace(old_string, new_string); applied++
          }
          await fsp.writeFile(target, modified, 'utf-8')
          return { status: 'success', summary: `批量替换成功 (${applied}/${replacements.length})` }
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
        // v11.4: 创建全部 8 个 Tab 文件 (对齐 projectHandlers.ts 修复)
        const outlineDir = path.join(pp, 'outline')
        await fsp.writeFile(path.join(outlineDir, 'plot.md'), '# 故事剧情\n\n> 梗概\n\n', 'utf-8')
        await fsp.writeFile(path.join(outlineDir, 'worldbuilding.md'), '# 世界观\n\n> 类型·基调\n\n', 'utf-8')
        await fsp.writeFile(path.join(outlineDir, 'items.yaml'), 'items:\n  # - id: example\n  #   name: 示例道具\n', 'utf-8')
        await fsp.writeFile(path.join(outlineDir, 'locations.yaml'), 'locations:\n  # - id: example\n  #   name: 示例地点\n', 'utf-8')
        await fsp.writeFile(path.join(outlineDir, 'factions.yaml'), 'factions:\n  # - id: example\n  #   name: 示例势力\n', 'utf-8')
        await fsp.writeFile(path.join(outlineDir, 'power_system.yaml'), 'name: 修炼体系\nlevels:\n  # - name: 示例境界\n', 'utf-8')
        await fsp.writeFile(path.join(outlineDir, 'outline_meta.yaml'), 'foreshadowing: []\nplotThreads: []\n', 'utf-8')
        await fsp.writeFile(path.join(outlineDir, 'emotion.yaml'), 'segments: []\n', 'utf-8')
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

      // v11.5: Note CRUD removed — use create_file("notes/xxx.md") / read_file / edit_file / delete_file

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

      // v11.5: kb_list/kb_create_file removed — use list_directory("knowledge_base/files") / create_file
      case 'kb_append_file': {
        const kbDir = path.join(this.rootDir, 'knowledge_base', 'files')
        const fn = String(args.file_id || '').replace(/\.\./g, '').replace(/[\\/]/g, '')
        if (!fn) return { status: 'error', summary: '缺少 file_id 参数' }
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
// 主函数：使用真实 V4UnifiedRuntime
// ══════════════════════════════════════════════════════════════

async function main() {
  // ══════════════════════════════════════════════════════════════
  // 动态导入真实 Runtime（V4AgentRuntime 无 Electron 依赖）
  // ══════════════════════════════════════════════════════════════
  const { V4UnifiedRuntime } = await import('@/agent/runtime/V4UnifiedRuntime')
  const { OpenAIAdapter } = await import('@/agent/runtime/adapters/OpenAIAdapter')
  const { AnthropicAdapter } = await import('@/agent/runtime/adapters/AnthropicAdapter')
  const { V4SecurityFence } = await import('@/agent/V4SecurityFence')
  const { toolRegistry } = await import('@/agent/skills/ToolRegistry')
  const { contextAssembler } = await import('@/agent/context/ContextAssembler')
  const { ALL_TOOLS } = await import('@/agent/skills/tools')
  const { buildSystemPrompt } = await import('@/agent/V4SystemPrompt')
  const { estimateTokens } = await import('@/agent/utils/tokenEstimation')
  const { isComplexTask } = await import('@/agent/utils/taskDetection')
  const { diagnosticLogger } = await import('@/agent/diagnostics/DiagnosticLogger')

  // 初始化工具注册
  toolRegistry.registerAll(ALL_TOOLS as any)
  // v11.5.1: ALL_PROVIDERS=[] — Provider system retired, skip registration

  // ══════════════════════════════════════════════════════════════
  const args = parseArgs()
  if (args.help) {
    console.log(`
╔══════════════════════════════════════════╗
║  AI 写作助手 CLI — 真实 Runtime 模式   ║
║  使用 V4UnifiedRuntime（GUI 同一套代码）  ║
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
  console.log(`\x1b[36m║  Runtime:  V4UnifiedRuntime (GUI同款) ║\x1b[0m`)
  console.log(`\x1b[36m║  工具注册: ToolRegistry (${toolRegistry.count()} 工具)  ║\x1b[0m`)
  // v11.3: Skill system removed
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
    // ① 工具裁剪（对齐 GUI ChatBridge v10.1.1）
    // ════════════════════════════════════════════════════════════
    const allTools = toolRegistry.getAllSchemas()
    const isMultiFile = isComplexTask(userMessage)
    const READ   = new Set(['read_file','list_directory','search_content','find_files'])
    const ALWAYS = new Set(['think'])
    const WRITE  = new Set(['create_file','edit_file','batch_replace'])
    const DANGER = new Set(['delete_file','rename_file','delete_project'])
    const NOTE   = new Set(['search_notes'])
    const KB     = new Set(['kb_append_file','kb_index_file'])
    const TMPL   = new Set(['create_style_template','create_scene_template'])
    const PROJ   = new Set(['create_project'])

    // v11.5.1: Skill system removed — model knows formats from system prompt
    const scopedCore = allTools.filter((t: any) =>
      READ.has(t.function.name) || WRITE.has(t.function.name) || TMPL.has(t.function.name) || PROJ.has(t.function.name) || ALWAYS.has(t.function.name))
    const scopedExtended = allTools.filter((t: any) =>
      DANGER.has(t.function.name) || NOTE.has(t.function.name) || KB.has(t.function.name))
    diagnosticLogger.recordInfo(`Agent2: task=default core=${scopedCore.length} ext=${scopedExtended.length}`)

    // planInstruction: 复杂任务 → 逐个完成（对齐 GUI: '逐个文件完成。'）
    const planInstruction = isMultiFile ? '逐个文件完成。' : ''

    // ════════════════════════════════════════════════════════════
    // ② 创建 Runtime（Mock 或真实协议）
    // ════════════════════════════════════════════════════════════
    let runtime: any

    if (args.mock) {
      // ── Mock 模式：不调真实 API，使用关键词匹配返回预设响应 ──
      console.log('\x1b[33m[MOCK 模式] 不调用真实 API，使用预设模拟响应\x1b[0m')

      // Mock AIService: 根据用户消息关键词决定返回什么
      const isCreateStyle = /风格模板|文风|style.?template/i.test(userMessage)
      const isCreateScene = /场景模板|scene.?template/i.test(userMessage)
      const isSearch = /搜索|查找|寻找|列出.*文件|find|search|list/i.test(userMessage) && !isCreateStyle && !isCreateScene
      const isWrite = /创建|写入.*大纲|写入.*设定|追加|导入.*大纲|编辑/i.test(userMessage)
      const isRole = /角色|创建.*[男女主配反]/i.test(userMessage)
      const isAnalysis = /分析|评估|看看|风格|什么类型/i.test(userMessage) && !isCreateStyle

      let _mockCalls = 0
      const mockAdapter = new OpenAIAdapter({
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
      runtime = new V4UnifiedRuntime({
        configId: 'cli-mock', projectId: args.project,
        maxIterations: args.maxIterations, abortSignal: abortController.signal,
        contextWindow: 128_000,
      }, mockAdapter)
    } else if (protocol === 'anthropic') {
      // v9.6.0: Anthropic adapter — wraps fetch+SSE, replaces V4AnthropicRuntime + setAIService
      const anthropicAdapter = new AnthropicAdapter({
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
            max_tokens: 16384,
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
      runtime = new V4UnifiedRuntime({
        configId: 'cli-anthropic', projectId: args.project,
        maxIterations: args.maxIterations, abortSignal: abortController.signal,
        contextWindow: 128_000,
      }, anthropicAdapter)
    } else {
      // OpenAI 协议（默认）— v9.6.0: OpenAIAdapter wraps openai SDK, replaces V4AgentRuntime + setAIService
      const { default: OpenAI } = await import('openai')
      const client = new OpenAI({ apiKey: args.apiKey, baseURL: args.apiUrl, timeout: 120_000, maxRetries: 1 })
      const openaiAdapter = new OpenAIAdapter({
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
      runtime = new V4UnifiedRuntime({
        configId: 'cli-openai', projectId: args.project,
        maxIterations: args.maxIterations, abortSignal: abortController.signal,
        contextWindow: 128_000,
      }, openaiAdapter)
    }

    // ════════════════════════════════════════════════════════════
    // ④ ContextAssembler（对齐 GUI: [0]core [1]index [2]provider [3]dynamic）
    // ════════════════════════════════════════════════════════════
    const CORE_PROMPT = buildSystemPrompt('', '')
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
        coreSystemMsg,                                          // [0] 核心提示词 — 不变 (含 Skill Catalog)
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
          } else if (/^(kb_append_file|create_project|delete_project|batch_replace)$/.test(ctx.toolName)) {
            mi.invalidateMemoryIndexCache()
          }
        } catch { /* cache invalidation best-effort */ }
      }

      return result
    })

    // ════════════════════════════════════════════════════════════
    // ⑥ 工具 + Skill 上下文（对齐 GUI: Anthropic 全工具，OpenAI 渐进披露）
    // ════════════════════════════════════════════════════════════
    if (protocol === 'anthropic') {
      // Anthropic: 全工具可用（对齐 V4AnthropicChatBridge:333）
      runtime.setTools(allTools)
    } else {
      runtime.setTools(scopedCore)
      runtime.setExtendedTools(scopedExtended)
    }
    // v11.5.1: setActiveSkill removed — no-op stub

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
