#!/usr/bin/env node
// ── AI 写作助手完整对话测试 (v3.0) ──
// 通过真实 Bridge → Runtime → Adapter 架构测试
// 用法: npx tsx scripts/test-ai-conversation.mjs [--scenario=S1,S2]
// 环境: AI_API_KEY=sk-xxx (DeepSeek API key)

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync, rmdirSync, statSync } from 'node:fs'
import { resolve, dirname, join, relative, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const PROJECTS_DIR = resolve(ROOT, 'projects')
const TEST_PROJECT_ID = 'test-project'
const TEST_PROJECT = '剑道长生'

const API_KEY = process.env.AI_API_KEY || ''
const BASE_URL = 'https://api.deepseek.com'
const MODEL = process.env.AI_MODEL || 'deepseek-v4-flash'

// ═══════════════════════════════════════════════════════════
// 0. Polyfills — 必须在所有 import 之前设置
// ═══════════════════════════════════════════════════════════

class MemStorage {
  _data = Object.create(null)
  getItem(k) { return this._data[k] ?? null }
  setItem(k, v) { this._data[k] = String(v) }
  removeItem(k) { delete this._data[k] }
  clear() { this._data = Object.create(null) }
  get length() { return Object.keys(this._data).length }
  key(i) { return Object.keys(this._data)[i] ?? null }
}

const _storage = new MemStorage()

// Zustand persist 直接引用了 bare identifier `localStorage`（非 window.localStorage）
// 在 Node.js ESM 中，需要同时暴露在 globalThis 上
globalThis.localStorage = _storage
globalThis.sessionStorage = _storage

// 测试配置
function getTestConfig() {
  return {
    id: 'test-config',
    name: 'DeepSeek Flash',
    model: MODEL,
    apiKey: API_KEY,
    apiUrl: BASE_URL,
    protocol: 'anthropic',
    temperature: 0.8,
    toolTemperature: 0.5,
    maxTokens: 16384,
    enableThinking: false,
    inputPricePerM: 0.28,
    outputPricePerM: 0.28,
    cacheHitPricePerM: 0.07,
  }
}

// ═══════════════════════════════════════════════════════════
// 0.5 Anthropic API 调用
// ═══════════════════════════════════════════════════════════

async function callDeepSeekAnthropic(params) {
  const messages = params.messages || []

  // 调试：打印消息结构（仅在 AI_DEBUG=1 时）
  if (process.env.AI_DEBUG) {
    console.error('\n🔍 [DEBUG] Sending to API:')
    console.error(`   system blocks: ${params.system?.length || 0}`)
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i]
      const contentTypes = (m.content || []).map(c => c.type).join(', ')
      const toolUseIds = (m.content || []).filter(c => c.type === 'tool_use').map(c => `${c.name}(${c.id?.slice(-8)})`).join(', ')
      const toolResultIds = (m.content || []).filter(c => c.type === 'tool_result').map(c => c.tool_use_id?.slice(-8)).join(', ')
      const extra = toolUseIds ? ` 🔧 ${toolUseIds}` : toolResultIds ? ` 📤 ${toolResultIds}` : ''
      const text = (m.content || []).filter(c => c.type === 'text').map(c => (c.text || '').slice(0, 40)).join(' | ')
      console.error(`   [${i}] ${m.role}: ${contentTypes}${extra} "${text}"`)
    }
  }

  const body = {
    model: MODEL,
    system: (params.system || []).map(s =>
      typeof s === 'string' ? { type: 'text', text: s } : s
    ),
    messages,
    max_tokens: 16384,
    stream: true,
  }
  if (params.tools?.length > 0) {
    body.tools = params.tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    }))
  }

  const res = await fetch(`${BASE_URL}/anthropic/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(`API ${res.status}: ${err.slice(0, 300)}`)
  }

  const text = await res.text()
  return parseAnthropicSSE(text)
}

function parseAnthropicSSE(text) {
  const events = []
  const lines = text.split('\n')
  let currentEvent = null
  for (const line of lines) {
    if (line.startsWith('event: ')) {
      currentEvent = line.slice(7).trim()
    } else if (line.startsWith('data: ')) {
      try {
        events.push({ type: currentEvent || 'unknown', data: JSON.parse(line.slice(6)) })
      } catch {
        events.push({ type: currentEvent || 'unknown', data: {} })
      }
    }
  }

  const toolUses = []
  let fullText = ''
  let stopReason = 'end_turn'
  let inputTokens = 0
  let outputTokens = 0
  let cacheCreationTokens = 0
  let cacheReadTokens = 0
  let thinking = ''
  const thinkingBlocks = []

  for (const evt of events) {
    switch (evt.type) {
      case 'message_start':
        inputTokens = evt.data?.message?.usage?.input_tokens || 0
        outputTokens = evt.data?.message?.usage?.output_tokens || 0
        cacheCreationTokens = evt.data?.message?.usage?.cache_creation_input_tokens || 0
        cacheReadTokens = evt.data?.message?.usage?.cache_read_input_tokens || 0
        break
      case 'content_block_start':
        if (evt.data?.content_block?.type === 'tool_use') {
          toolUses.push({ id: evt.data.content_block.id, name: evt.data.content_block.name, input: {}, inputJson: '' })
        } else if (evt.data?.content_block?.type === 'thinking') {
          thinkingBlocks.push({ thinking: '', signature: evt.data.content_block.signature || '' })
        }
        break
      case 'content_block_delta':
        if (evt.data?.delta?.type === 'text_delta') {
          fullText += evt.data.delta.text || ''
        } else if (evt.data?.delta?.type === 'input_json_delta' && toolUses.length > 0) {
          toolUses[toolUses.length - 1].inputJson += evt.data.delta.partial_json || ''
        } else if (evt.data?.delta?.type === 'thinking_delta' && thinkingBlocks.length > 0) {
          thinkingBlocks[thinkingBlocks.length - 1].thinking += evt.data.delta.thinking || ''
        } else if (evt.data?.delta?.type === 'signature_delta' && thinkingBlocks.length > 0) {
          thinkingBlocks[thinkingBlocks.length - 1].signature += evt.data.delta.signature || ''
        }
        break
      case 'message_delta':
        stopReason = evt.data?.delta?.stop_reason || 'end_turn'
        outputTokens = evt.data?.usage?.output_tokens || outputTokens
        break
    }
  }

  // Parse tool JSON inputs
  const parsedToolUses = toolUses.map(tu => {
    let input = {}
    try { input = JSON.parse(tu.inputJson) } catch {}
    return { id: tu.id, name: tu.name, input }
  })

  thinking = thinkingBlocks.map(b => b.thinking).join('\n')

  return JSON.stringify({
    text: fullText,
    toolUses: parsedToolUses,
    stopReason,
    thinking,
    thinkingBlocks: thinkingBlocks.length > 0 ? thinkingBlocks : undefined,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_creation_input_tokens: cacheCreationTokens,
      cache_read_input_tokens: cacheReadTokens,
    },
  })
}

// ═══════════════════════════════════════════════════════════
// 1. 文件工具执行（真实文件系统 + 项目隔离）
// ═══════════════════════════════════════════════════════════

function safeResolve(filePath, projectId) {
  let clean = String(filePath || '').replace(/\\/g, '/').replace(/^\/+/, '')
  // 拒绝绝对路径
  if (/^[A-Za-z]:[/\\]/.test(clean) || clean.startsWith('/')) return null
  // 去除路径穿越
  clean = clean.replace(/%2e%2e%2f/gi, '').replace(/%2e%2e/gi, '')

  if (clean.startsWith('../')) {
    // ../ 前缀：从 projects/ 目录向上导航
    let base = PROJECTS_DIR
    let c = clean
    while (c.startsWith('../')) { c = c.slice(3); base = dirname(base) }
    return resolve(base, c)
  }
  // 项目内路径
  return resolve(PROJECTS_DIR, clean)
}

function ensureInProject(fp) {
  // 检查路径是否在 projects/ 内
  const rel = relative(PROJECTS_DIR, fp)
  if (rel.startsWith('..')) return false
  return true
}

async function executeFileToolsOnDisk(calls) {
  if (process.env.AI_DEBUG) console.error(`\n🔧 [DEBUG] executeFileTools called: ${calls.map(c => `${c.toolName}(${c.callId?.slice(-8)})`).join(', ')}`)
  const results = []
  for (const call of calls) {
    try {
      const r = await executeSingleFileTool(call.callId, call.toolName, call.args)
      if (process.env.AI_DEBUG) console.error(`   → ${call.toolName}: ${r.status} ${r.summary}`)
      results.push(r)
    } catch (e) {
      if (process.env.AI_DEBUG) console.error(`   → ${call.toolName}: ERROR ${e.message}`)
      results.push({
        callId: call.callId,
        toolName: call.toolName,
        status: 'error',
        summary: `${call.toolName} 执行失败: ${e.message}`,
      })
    }
  }
  return results
}

async function executeSingleFileTool(callId, toolName, args) {
  const ok = (s, d) => ({ callId, toolName, status: 'success', summary: s, detail: d })
  const err = (s) => ({ callId, toolName, status: 'error', summary: s })

  switch (toolName) {
    // ── Read tools ──
    case 'read_file': {
      const fp = safeResolve(args.file_path, TEST_PROJECT)
      if (!fp || !existsSync(fp)) return err(`文件不存在: ${args.file_path}`)
      const content = readFileSync(fp, 'utf-8')
      return ok(`${content.length} 字符`, content.slice(0, 8000))
    }
    case 'list_directory': {
      let dp = args.dir_path ? safeResolve(args.dir_path, TEST_PROJECT) : PROJECTS_DIR
      if (!dp || !existsSync(dp)) return ok('0 个条目', '目录不存在或为空')
      const entries = readdirSync(dp).map(name => {
        const full = join(dp, name)
        return { name, isDirectory: statSync(full).isDirectory() }
      })
      // Glob filter
      let filtered = entries
      if (args.pattern) {
        const pat = String(args.pattern)
        filtered = entries.filter(e => {
          if (!pat.includes('*')) return e.name.includes(pat)
          const re = new RegExp(pat.replace(/\*/g, '.*').replace(/\?/g, '.'))
          return re.test(e.name)
        })
      }
      return ok(`${filtered.length} 个条目`, filtered.map(e => `${e.isDirectory ? '📁' : '📄'} ${e.name}`).join('\n'))
    }
    case 'search_content': {
      const dp = args.dir_path ? safeResolve(args.dir_path, TEST_PROJECT) : resolve(PROJECTS_DIR, TEST_PROJECT)
      if (!dp || !existsSync(dp)) return ok('0 个匹配', '')
      const pattern = String(args.pattern || '')
      const isRegex = args.regex === true
      const caseSensitive = args.case_sensitive === true
      const filePattern = args.file_pattern
      const contextAround = Number(args.context_around || 0)

      const results = []
      function walk(dir) {
        if (results.length >= 500) return
        for (const entry of readdirSync(dir)) {
          const full = join(dir, entry)
          if (statSync(full).isDirectory()) { walk(full); continue }
          if (filePattern) {
            const fpRe = new RegExp(filePattern.replace(/\*/g, '.*').replace(/\?/g, '.'))
            if (!fpRe.test(entry)) continue
          }
          try {
            const content = readFileSync(full, 'utf-8')
            const lines = content.split('\n')
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i]
              let match = false
              if (isRegex) {
                try { match = new RegExp(pattern, caseSensitive ? '' : 'i').test(line) } catch { match = line.includes(pattern) }
              } else {
                match = caseSensitive ? line.includes(pattern) : line.toLowerCase().includes(pattern.toLowerCase())
              }
              if (match) {
                if (contextAround > 0) {
                  const start = Math.max(0, i - contextAround)
                  const end = Math.min(lines.length, i + contextAround + 1)
                  results.push(`${relative(PROJECTS_DIR, full)}:${i + 1}: ${lines.slice(start, end).join('\n')}`)
                } else {
                  results.push(`${relative(PROJECTS_DIR, full)}:${i + 1}: ${line}`)
                }
              }
            }
          } catch {}
        }
      }
      walk(dp)
      return ok(`找到 ${results.length} 个匹配`, results.slice(0, 500).join('\n'))
    }
    case 'find_files': {
      const dp = args.dir_path ? safeResolve(args.dir_path, TEST_PROJECT) : resolve(PROJECTS_DIR, TEST_PROJECT)
      if (!dp || !existsSync(dp)) return ok('0 个匹配', '')
      const pattern = String(args.pattern || '*')
      const results = []
      function walk(dir) {
        for (const entry of readdirSync(dir)) {
          const full = join(dir, entry)
          const rel = relative(PROJECTS_DIR, full)
          if (statSync(full).isDirectory()) { walk(full); continue }
          // Simple glob matching
          const parts = pattern.split('*').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          const re = new RegExp(parts.join('.*'))
          if (re.test(entry) || re.test(rel)) results.push(rel)
        }
      }
      walk(dp)
      return ok(`找到 ${results.length} 个匹配`, results.join('\n'))
    }

    // ── Write tools ──
    case 'create_file': {
      const fp = safeResolve(args.file_path, TEST_PROJECT)
      if (!fp) return err(`路径无效: ${args.file_path}`)
      mkdirSync(dirname(fp), { recursive: true })
      const content = String(args.content || '')
      writeFileSync(fp, content, 'utf-8')
      return ok(`已创建 (${content.length} 字符)`, content.slice(0, 500))
    }
    case 'edit_file': {
      const fp = safeResolve(args.file_path, TEST_PROJECT)
      if (!fp) return err(`路径无效: ${args.file_path}`)
      if (!existsSync(fp)) return err(`文件不存在: ${args.file_path}`)
      const oldContent = readFileSync(fp, 'utf-8')
      const oldStr = String(args.old_string || '')
      const newStr = String(args.new_string || '')

      let newContent
      if (oldStr === '__FULL_REPLACE__') {
        newContent = newStr
      } else if (oldStr === '__PREPEND__') {
        newContent = newStr + oldContent
      } else if (oldStr === '__APPEND__') {
        newContent = oldContent + newStr
      } else {
        if (!oldContent.includes(oldStr)) return err(`未找到要替换的原文片段`)
        const count = oldContent.split(oldStr).length - 1
        if (count > 1) return err(`原文片段匹配到 ${count} 处（不唯一），请提供更完整的上下文`)
        newContent = oldContent.replace(oldStr, newStr)
      }
      writeFileSync(fp, newContent, 'utf-8')
      return ok(`已修改 (${oldContent.length}→${newContent.length} 字符)`)
    }
    case 'batch_replace': {
      const fp = safeResolve(args.file_path, TEST_PROJECT)
      if (!fp || !existsSync(fp)) return err(`文件不存在: ${args.file_path}`)
      const oldContent = readFileSync(fp, 'utf-8')
      const replacements = args.replacements
      if (!Array.isArray(replacements)) return err('replacements 必须是数组')
      let newContent = oldContent
      let count = 0
      for (const r of replacements) {
        const o = String(r.old_string || '')
        const n = String(r.new_string || '')
        if (o && newContent.includes(o)) { newContent = newContent.replace(new RegExp(o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), n); count++ }
      }
      writeFileSync(fp, newContent, 'utf-8')
      return ok(`批量替换完成 (${count} 项)`)
    }
    case 'rename_file': {
      const oldFp = safeResolve(args.old_path, TEST_PROJECT)
      const newFp = safeResolve(args.new_path, TEST_PROJECT)
      if (!oldFp || !existsSync(oldFp)) return err(`源文件不存在: ${args.old_path}`)
      if (!newFp) return err(`新路径无效: ${args.new_path}`)
      mkdirSync(dirname(newFp), { recursive: true })
      writeFileSync(newFp, readFileSync(oldFp, 'utf-8'), 'utf-8')
      unlinkSync(oldFp)
      return ok('已重命名')
    }
    case 'delete_file': {
      const fp = safeResolve(args.file_path, TEST_PROJECT)
      if (!fp || !existsSync(fp)) return err(`文件不存在: ${args.file_path}`)
      unlinkSync(fp)
      return ok('已删除')
    }

    // ── Project tools ──
    case 'create_project': {
      const name = String(args.name || '').trim()
      if (!name) return err('项目名不能为空')
      const pp = resolve(PROJECTS_DIR, name)
      if (existsSync(pp)) return ok(`项目已存在: ${name}`)
      const dirs = ['outline', 'characters', 'chapters', 'detailed_outline', 'summaries', 'covers', 'images', 'notes']
      dirs.forEach(d => mkdirSync(resolve(pp, d), { recursive: true }))
      // 创建模板文件
      writeFileSync(resolve(pp, 'project.json'), JSON.stringify({ type: 'writing', novelCategory: 'general' }, null, 2))
      writeFileSync(resolve(pp, 'outline', 'plot.md'), '# 故事剧情\n\n> 一句话梗概\n\n## 第1章\n\n（待填写）')
      writeFileSync(resolve(pp, 'outline', 'worldbuilding.md'), '# 世界观\n\n> 类型·基调\n\n## 一、核心规则\n\n（待填写）')
      writeFileSync(resolve(pp, 'outline', 'items.yaml'), 'items: []\n')
      writeFileSync(resolve(pp, 'outline', 'factions.yaml'), 'factions: []\n')
      writeFileSync(resolve(pp, 'outline', 'locations.yaml'), 'locations: []\n')
      writeFileSync(resolve(pp, 'outline', 'power_system.yaml'), "name: ''\ndescription: ''\nlevels: []\n")
      writeFileSync(resolve(pp, 'outline', 'emotion.yaml'), 'segments: []\n')
      writeFileSync(resolve(pp, 'outline', 'outline_meta.yaml'), 'foreshadowing: []\nplotThreads: []\n')
      return ok(`已创建项目: ${name}`)
    }
    case 'delete_project': {
      const name = String(args.name || '').trim()
      const pp = resolve(PROJECTS_DIR, name)
      if (!existsSync(pp)) return err(`项目不存在: ${name}`)
      function rmdir(d) {
        for (const e of readdirSync(d)) { const p = join(d, e); statSync(p).isDirectory() ? rmdir(p) : unlinkSync(p) }
        rmdirSync(d)
      }
      rmdir(pp)
      return ok(`已删除项目: ${name}`)
    }

    // ── KB tools ──
    case 'kb_search': return ok('KB 搜索完成 (0 结果)', '')
    case 'kb_append_file': return ok('已追加到知识库', '')

    // ── Note tools ──
    case 'search_notes': return ok('笔记搜索完成 (0 结果)', '')

    // ── Image tools ──
    case 'search_images': return ok('图片搜索完成 (0 结果)', '')
    case 'generate_image': return err('图片生成在测试环境中不可用')

    // ── Template tools ──
    // v14.5.1: create_style_template/create_scene_template 已从 31 工具清单移除——
    // mock 不再保留（原保留会造成"已删除工具在测试中假成功，真实环境报错"的假象）
    // analyze_text_style 走 ai.chat 路径（mock 返回空 → 无场景覆盖）

    // ── Prompt tools ──
    case 'list_prompts': return ok('', '[]')
    case 'toggle_prompt': return ok('已切换')
    case 'update_prompt': return ok('已更新')

    // ── Harness tools ──
    case 'list_rules': return ok('规则列表', 'golden-rules.md\nproject-structure.md\nnovel-constraints.md')
    // update_config, list_audit removed in v13.2.0

    default:
      return err(`未知工具: ${toolName}`)
  }
}

// ═══════════════════════════════════════════════════════════
// 2. 设置 window mock（必须在任何 app import 之前）
// ═══════════════════════════════════════════════════════════

let _chunkCallback = null
let _aborted = false

globalThis.window = {
  // Zustand persist middleware
  localStorage: _storage,
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => {},
  CustomEvent: class CustomEvent {},

  // React misc
  requestAnimationFrame: (cb) => setTimeout(cb, 16),
  cancelAnimationFrame: (id) => clearTimeout(id),
  matchMedia: () => ({ matches: false, addListener: () => {}, removeListener: () => {} }),
  navigator: { userAgent: 'Node.js', language: 'zh-CN' },

  // ── Electron bridge mock ──
  electron: {
    ai: {
      chatAnthropicStream: async (params) => {
        _aborted = false
        const result = await callDeepSeekAnthropic(params)
        return result // JSON string → anthropicService parses it
      },
      executeFileTools: async (calls) => {
        return executeFileToolsOnDisk(calls)
      },
      onAnthropicChunk: (callback) => {
        _chunkCallback = callback
        return () => { _chunkCallback = null }  // unsubscribe
      },
      abortAnthropicStream: () => {
        _aborted = true
      },
      chat: async () => JSON.stringify({ text: '' }),
    },
    store: {
      get: (key) => {
        if (key === 'ai-settings') return JSON.stringify({ configs: [getTestConfig()], activeConfigId: 'test-config' })
        if (key === 'app-settings') return JSON.stringify({ projectsBasePath: PROJECTS_DIR, theme: 'dark', language: 'zh' })
        return null
      },
      set: () => {},
    },
    files: {
      read: async (p) => {
        const fp = resolve(PROJECTS_DIR, String(p))
        if (!existsSync(fp)) throw new Error(`ENOENT: ${fp}`)
        return readFileSync(fp, 'utf-8')
      },
      write: async (p, content) => {
        const fp = resolve(PROJECTS_DIR, String(p))
        mkdirSync(dirname(fp), { recursive: true })
        writeFileSync(fp, String(content), 'utf-8')
        return true
      },
      listDir: async (p) => {
        const fp = resolve(PROJECTS_DIR, String(p))
        if (!existsSync(fp)) return []
        return readdirSync(fp).map(name => {
          const full = join(fp, name)
          return { name, isDirectory: statSync(full).isDirectory() }
        })
      },
      list: async (p) => {
        const fp = resolve(PROJECTS_DIR, String(p))
        if (!existsSync(fp)) return []
        return readdirSync(fp).map(name => {
          const full = join(fp, name)
          return { name, isDirectory: statSync(full).isDirectory() }
        })
      },
      ensureDir: async (p) => {
        const fp = resolve(PROJECTS_DIR, String(p))
        mkdirSync(fp, { recursive: true })
        return true
      },
      deleteFile: async (p) => {
        const fp = resolve(PROJECTS_DIR, String(p))
        if (existsSync(fp)) unlinkSync(fp)
        return true
      },
      delete: async (p) => {
        const fp = resolve(PROJECTS_DIR, String(p))
        if (existsSync(fp)) unlinkSync(fp)
        return true
      },
      deleteDir: async (p) => {
        const fp = resolve(PROJECTS_DIR, String(p))
        if (existsSync(fp)) {
          function rmdir(d) {
            for (const e of readdirSync(d)) { const p2 = join(d, e); statSync(p2).isDirectory() ? rmdir(p2) : unlinkSync(p2) }
            rmdirSync(d)
          }
          rmdir(fp)
        }
        return true
      },
      readBinary: async (p) => {
        const fp = resolve(PROJECTS_DIR, String(p))
        if (!existsSync(fp)) throw new Error(`ENOENT: ${fp}`)
        return readFileSync(fp).toString('base64')
      },
      writeBinary: async (p, base64) => {
        const fp = resolve(PROJECTS_DIR, String(p))
        mkdirSync(dirname(fp), { recursive: true })
        writeFileSync(fp, Buffer.from(String(base64), 'base64'))
        return true
      },
      saveImageUrl: async () => true,
      onExternalChange: () => () => {},  // returns unsubscribe
    },
    project: {
      create: (name, basePath, type) => {
        const pp = resolve(PROJECTS_DIR, name || type || 'untitled')
        const dirs = ['outline', 'characters', 'chapters', 'detailed_outline', 'summaries']
        dirs.forEach(d => mkdirSync(resolve(pp, d), { recursive: true }))
        writeFileSync(resolve(pp, 'project.json'), JSON.stringify({ type: 'writing', novelCategory: 'general' }, null, 2))
        return pp
      },
    },
    browser: {
      open: async () => ({ status: 'error', summary: '浏览器在测试中不可用' }),
      search: async (query) => {
        // 模拟搜索结果 — 返回与中国上古名剑相关的测试数据
        const q = String(query || '').toLowerCase()
        if (q.includes('剑') || q.includes('上古') || q.includes('名剑')) {
          return {
            status: 'success',
            summary: `找到 5 条关于"${String(query).slice(0, 30)}"的搜索结果`,
            detail: [
              '1. 承影剑 — 上古十大名剑之一，传为商天子三剑之一。剑身透明如水晶，挥动时只见剑影不见剑身，"承影"之名由此而来。铸造年代约公元前1600年。',
              '2. 湛卢剑 — 春秋时期欧冶子所铸，被誉为"天下第一剑"。剑身乌黑如墨，刻有北斗七星纹路。传说此剑有灵性，能自行择主，仁者得之则天下太平。',
              '3. 纯钧剑 — 亦为欧冶子所铸，与湛卢齐名。剑身青如碧玉，出鞘时有龙吟之声。据《越绝书》记载，此剑铸成时"赤堇之山破而出锡，若耶之溪涸而出铜"。',
              '4. 鱼肠剑 — 专诸刺王僚所用之剑。剑身极薄，可藏于鱼腹之中，故名"鱼肠"。虽为短剑，但锋锐无比，一击必杀。',
              '5. 干将莫邪 — 夫妻双剑，干将为雄、莫邪为雌。铸剑师干将耗时三年，以身投炉方铸成此剑。双剑共鸣时剑气冲天，是中国剑文化中最浪漫的传说。',
            ].join('\n'),
          }
        }
        return {
          status: 'success',
          summary: `找到 3 条关于"${String(query).slice(0, 30)}"的搜索结果`,
          detail: [
            '1. 相关结果一：该主题的核心信息摘要...',
            '2. 相关结果二：背景资料和历史沿革...',
            '3. 相关结果三：当前研究和讨论热点...',
          ].join('\n'),
        }
      },
    },
    shell: { exec: async () => ({ status: 'error', summary: 'Shell 在测试中不可用' }), runScript: async () => ({ status: 'error', summary: 'Shell 在测试中不可用' }) },
    http: { get: async () => ({ status: 'error', summary: 'HTTP 在测试中不可用' }), fetch: async () => ({ status: 'error', summary: 'HTTP 在测试中不可用' }) },
    kb: {
      list: async () => [],
      read: async () => '',
      selectFiles: async () => [],
      uploadFiles: async () => true,
      delete: async () => true,
      write: async (fileId, content, configId) => {
        // 知识库文件写入：存到 projects/../knowledge_base/files/
        const fp = resolve(ROOT, 'knowledge_base', 'files', String(fileId || 'untitled.md'))
        mkdirSync(dirname(fp), { recursive: true })
        writeFileSync(fp, String(content || ''), 'utf-8')
        return true
      },
      index: async () => ({ chunkCount: 0 }),
      append: async (fileId, content, configId) => {
        const fp = resolve(ROOT, 'knowledge_base', 'files', String(fileId || 'untitled.md'))
        mkdirSync(dirname(fp), { recursive: true })
        const existing = existsSync(fp) ? readFileSync(fp, 'utf-8') : ''
        writeFileSync(fp, existing + '\n' + String(content || ''), 'utf-8')
        return true
      },
    },
    mcp: { listServers: async () => [] },
    lsp: { diagnose: async () => ({ status: 'error', summary: 'LSP 在测试中不可用' }) },
  },
}

// ═══════════════════════════════════════════════════════════
// 3. 预填充 Zustand store
// ═══════════════════════════════════════════════════════════

async function initStores() {
  const { useSettingsStore } = await import('@/store')
  const state = useSettingsStore.getState()
  // 清空已有配置，添加测试配置
  state.setConfigs([getTestConfig()])
  state.setActiveConfig('test-config')
  return state
}

// ═══════════════════════════════════════════════════════════
// 4. 清理 + 工具函数
// ═══════════════════════════════════════════════════════════

function cleanup() {
  for (const name of ['test-project', '仙途', '剑道长生']) {
    const pp = resolve(PROJECTS_DIR, name)
    if (existsSync(pp)) {
      function rmdir(d) {
        for (const e of readdirSync(d)) {
          const p = join(d, e)
          statSync(p).isDirectory() ? rmdir(p) : unlinkSync(p)
        }
        rmdirSync(d)
      }
      try { rmdir(pp) } catch {}
    }
  }
}

function listTree(dir, indent = '') {
  const lines = []
  for (const e of readdirSync(dir).sort()) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) {
      lines.push(`${indent}📁 ${e}/`)
      lines.push(...listTree(p, indent + '  '))
    } else {
      lines.push(`${indent}📄 ${e} (${statSync(p).size} 字节)`)
    }
  }
  return lines
}

// ═══════════════════════════════════════════════════════════
// 5. 测试场景
// ═══════════════════════════════════════════════════════════
// 5.5 角色模板辅助函数
// ═══════════════════════════════════════════════════════════

/**
 * 设置角色模板到 Zustand store，模拟用户在 UI 中选择角色模板。
 * 会在 settingsStore 中创建模板并设为活跃，AI 会在 system prompt 中看到角色信息。
 */
async function setActiveRoleTemplate(activate = true) {
  const { useSettingsStore } = await import('../src/store/index.ts')
  const store = useSettingsStore.getState()

  if (!activate) {
    // 停用角色模板
    store.setActiveRoleTemplate('')
    return
  }

  // 创建测试角色模板：江月白（嘴毒但真心的师姐）
  const template = {
    id: 'rt_test_jianga',
    name: '江月白·剑宗师姐',
    characters: [
      {
        id: 'user_writer',
        name: '写作者',
        identity: '外门弟子',
        gender: '男',
        personality: '专注写作，喜欢探讨剧情',
        relationship: '江月白的师弟，正在被师姐督促修炼',
        isUser: true,
      },
      {
        id: 'ai_jianga',
        name: '江月白',
        identity: '剑宗大师姐',
        gender: '女',
        personality: '嘴硬心软，说话带刺但处处为师弟着想。评价作品会先毒舌再给真诚建议。口头禅"就这？"但会熬夜帮你改稿。',
        relationship: '写作者的师姐，既是严厉的前辈也是可靠的同伴',
        isUser: false,
        firstMessage: '又在憋文？拿来我看看——先说好，要是写得跟上次一样烂，今晚别想吃饭。',
      },
    ],
    worldSetting: '修仙世界·剑宗山门。灵气充沛的仙山上，有一座千年剑宗。山门规矩森严，但师姐弟之间情谊深厚。',
    scenarioSetting: '师姐江月白正在督促师弟写作。师弟想偷懒时会被师姐踢，但师姐其实最护着师弟。',
  }

  // 写入角色模板到 settingsStore
  const currentSettings = store.aiSettings || {}
  const templates = currentSettings.roleTemplates || []
  const existingIdx = templates.findIndex(t => t.id === template.id)
  if (existingIdx >= 0) {
    store.updateRoleTemplate(template.id, template)
  } else {
    store.addRoleTemplate(template)
  }
  store.setActiveRoleTemplate(template.id)
  console.log('   🎭 已激活角色模板: 江月白·剑宗师姐')
}

const SCENARIOS = [
  // ═══ 完整创作会话：跨轮记忆 + 多任务 + 文件操作深度测试 ═══
  // S1: 读取+分析(产生记忆) → S2: 基于记忆创建(不重读) → S3: 多任务同轮
  // S4: 闲聊 → S5: 精确编辑 → S6: 删除重建 → S7: 探索创建 → S8: 全面回顾

  {
    id: 'S1',
    name: '读取+分析：产生跨轮记忆',
    desc: '读两个文件并分析。助手回复应包含关键信息供后续场景引用。',
    userMessages: [
      '帮我看看剑道长生现在的项目状态——读一下outline/plot.md和outline/worldbuilding.md，然后分析一下：故事框架怎么样、世界观够不够细、哪些地方还缺内容。详细点说',
    ],
    checks: [
      { type: 'hasTool', name: 'read_file', minCount: 2, desc: '应读 plot.md 和 worldbuilding.md' },
      { type: 'hasText', minChars: 200, desc: '应给出详细分析（这些文本将作为跨轮记忆）' },
    ],
  },
  {
    id: 'S2',
    name: '跨轮记忆：基于S1分析直接创建，不重读',
    desc: '用户引用S1的分析结果要求创建角色。模型应使用历史中的信息而非重新读文件。',
    userMessages: [
      '你刚才分析说世界观只有剑修体系太单薄了，角色也缺失。对，先把角色补上——创建三个核心角色存到characters里：主角陆沉（沉默铁匠，灵根破碎但能通过修复古兵器获得力量）、剑灵苏念卿（被封印三千年的上古剑宗传人，记忆碎片化）、反派顾长渊（苏念卿的师兄，当年为救苍生含泪封印师妹，三千年来活在愧疚中成了偏执的秩序维护者）。直接用你的知识生成完整角色',
    ],
    checks: [
      { type: 'hasTool', name: 'create_file', minCount: 3, desc: '三个角色各一个文件' },
      { type: 'hasChars', desc: 'characters/ 应有角色文件' },
      { type: 'fileNotEmpty', path: '剑道长生/characters/陆沉.yaml', desc: '陆沉' },
      { type: 'fileNotEmpty', path: '剑道长生/characters/苏念卿.yaml', desc: '苏念卿' },
      { type: 'fileNotEmpty', path: '剑道长生/characters/顾长渊.yaml', desc: '顾长渊' },
    ],
  },
  {
    id: 'S3',
    name: '同轮多任务：读→写→写，中间不停顿',
    desc: '一条消息里三个子任务：填修炼体系、创建角色、检查并修改。应一次性读取后连续完成所有写入。',
    userMessages: [
      '接下来一口气做三件事，别停：1）把outline/power_system.yaml填完整——九境修炼体系，每境名称、特征、突破条件写清楚，和古剑封印的解开挂钩；2）在characters里创建"江月白"，陆沉的青梅竹马，外表甜美但嘴特别毒的医修，能用毒也能用针，口头禅是"废物就是废物"其实是在激励陆沉；3）看看陆沉的角色文件，如果灵根设定不对就改一下——他的灵根应该是被上古剑意震碎的，不是天生废材',
    ],
    checks: [
      { type: 'hasTool', name: 'edit_file', minCount: 1, desc: '应修改 power_system.yaml' },
      { type: 'hasTool', name: 'create_file', minCount: 1, desc: '应创建江月白角色文件' },
      { type: 'fileNotEmpty', path: '剑道长生/outline/power_system.yaml', desc: 'power_system.yaml 应有内容' },
      { type: 'fileNotEmpty', path: '剑道长生/characters/江月白.yaml', desc: '江月白角色文件' },
      // v14.1.0: 任务完整性断言 — 三个子任务的产物内容都必须真实存在（原断言只查工具调用+文件存在）
      { type: 'fileContains', path: '剑道长生/outline/power_system.yaml', needle: '九境', desc: '任务1产物: power_system 应包含九境修炼体系' },
      { type: 'fileContains', path: '剑道长生/characters/江月白.yaml', needle: '医修', desc: '任务2产物: 江月白应包含医修设定' },
      { type: 'fileContains', path: '剑道长生/characters/陆沉.yaml', needle: '剑意', desc: '任务3产物: 陆沉灵根应改为被剑意震碎' },
      { type: 'hasText', minChars: 30, desc: '应确认三件事完成' },
    ],
  },
  {
    id: 'S4',
    name: '纯闲聊：不触发任何工具',
    desc: '休息聊天。验证闲聊不会误触发文件操作。',
    userMessages: [
      '写了这么多有点累了，聊点别的转换一下心情。你觉得江月白这种"嘴毒但真心对你好"的角色为什么特别受欢迎？我感觉比那种单纯温柔的更有魅力。不过写不好的话容易变成讨人厌的刻薄角色，这个分寸感怎么把握？',
    ],
    checks: [
      { type: 'hasText', minChars: 150, desc: '应深入讨论角色塑造' },
    ],
  },

  // ═══ v13.2.0: 角色扮演测试 ═══
  // S_R1: 角色身份+纯聊天 | S_R2: 角色身份+工具操作（验证角色外壳不影响核心能力）

  {
    id: 'S_R1',
    name: '🎭 角色扮演：以角色身份纯聊天',
    desc: '激活角色模板"江月白·剑宗师姐"后纯聊天。AI应以师姐口吻回复，但不应触发任何工具。',
    setup: async () => { await setActiveRoleTemplate(true) },
    teardown: async () => { await setActiveRoleTemplate(false) },
    userMessages: [
      '师姐，我最近写的剑道长生卡住了。主角陆沉在矿坑里发现古剑那段，我总觉得太平淡了，你说怎么办？',
    ],
    checks: [
      // 用户提到项目内容→分支1B允许读取辅助讨论。核心验证：角色身份+纯聊天，不触发写操作
      { type: 'noToolCalls', desc: '纯聊天不应触发写工具' },
      { type: 'hasText', minChars: 100, desc: '应以师姐口吻给出有内容的建议' },
    ],
  },
  {
    id: 'S_R2',
    name: '🎭 角色扮演+工具：角色外壳不影响核心操作',
    desc: '以角色身份执行文件操作。即使以江月白口吻说话，仍应正确调用create_file/edit_file等工具。',
    setup: async () => { await setActiveRoleTemplate(true) },
    teardown: async () => { await setActiveRoleTemplate(false) },
    userMessages: [
      '师姐教训得对！帮我把刚才的想法记下来吧——在notes里创建一个"江月白的写作批注.md"，把你对我第一章的建议写进去。另外帮我把characters/陆沉.yaml里的personality字段改一下，加上"在矿坑里意外发现古剑后，开始对上古文字产生异常的感知能力"',
    ],
    checks: [
      { type: 'hasTool', name: 'create_file', minCount: 1, desc: '应创建笔记文件' },
      { type: 'hasAnyTool', names: ['edit_file', 'read_file'], minCount: 1, desc: '应编辑角色文件' },
      { type: 'hasText', minChars: 30, desc: '应以角色口吻确认完成' },
    ],
  },

  {
    id: 'S5',
    name: '精确编辑+追加：一个文件两处修改',
    desc: '读江月白角色文件，改personality字段，再追加行医研究的隐藏故事。测试精确替换和追加。',
    userMessages: [
      `刚才聊的给我启发很大！帮我把江月白的角色文件改两处：1）personality字段改成"用毒舌掩饰的极致温柔。认定的人和事从不放弃，但嘴上半句好话没有。陆沉曾问她为什么总是这么刻薄，她说'因为说真话的人都被我毒死了'——其实她只是怕被人看穿她的在乎"；2）在文件末尾追加一段"hiddenStory"字段：她暗地里花了三年研究如何修复破碎的灵根，因为陆沉的灵根就是碎的。她从不告诉他，只是每次替他诊脉后偷偷加一味药在他的茶里`,
    ],
    checks: [
      { type: 'hasTool', name: 'read_file', minCount: 1, desc: '应先读文件确认当前内容' },
      { type: 'hasAnyTool', names: ['edit_file', 'batch_replace'], minCount: 1, desc: '应修改文件（edit_file 或 batch_replace）' },
      { type: 'hasText', minChars: 20, desc: '应确认修改完成' },
    ],
    // v14.5.1: setup 确保目标文件存在——S5 原本依赖 32 场景运行顺序（早前场景创建江月白.yaml），
    // 单独跑 S5 时文件不存在，模型合理选择 create_file 新建，断言误报"未编辑"
    setup: () => {
      const dir = resolve(PROJECTS_DIR, TEST_PROJECT, 'characters')
      mkdirSync(dir, { recursive: true })
      const fp = resolve(dir, '江月白.yaml')
      if (!existsSync(fp)) {
        writeFileSync(fp, 'name: 江月白\npersonality: 毒舌大师姐，嘴硬心软\nhiddenStory: 暂缺\n', 'utf-8')
      }
    },
  },
  {
    id: 'S6',
    name: '删除+重建：果断操作',
    desc: '删掉旧的items.yaml，根据修炼体系重新设计炼器材料。测试删除是否果断、重建是否完整。',
    userMessages: [
      '我想了一下，outline/items.yaml里那些炼器材料的设定太随意了。帮我把items.yaml直接删了，然后重新写一版：材料要和九境修炼一一对应，每解开一层古剑封印就需要对应的材料来修复剑身。比如第一境对应"玄铁精"，第二境对应"青冥石"，以此类推。每种材料写出它的产地、特性、为什么能修复古剑',
    ],
    checks: [
      // v14.1.1: 放宽为等价完成方式 — 模型可能用 delete+create（用户明确意图）或 edit_file 覆盖（等价产物）。
      // 测试意图是"旧设定废弃 + 新设定完整写入"，不是特定工具序列。
      { type: 'hasAnyTool', names: ['delete_file', 'edit_file', 'create_file'], minCount: 1, desc: '应删除重建或用覆盖方式重写 items.yaml' },
      { type: 'fileNotEmpty', path: '剑道长生/outline/items.yaml', desc: '新 items.yaml 应有完整内容' },
      { type: 'fileContains', path: '剑道长生/outline/items.yaml', needle: '封印', desc: '新 items.yaml 应包含与封印对应的材料设定' },
    ],
  },
  {
    id: 'S7',
    name: '探索+创建：空目录处理',
    desc: '检查chapters目录后创建第一章。测试对空目录的处理和创建是否果断。',
    userMessages: [
      '角色和世界观差不多了，该动笔写正文了。帮我看看chapters目录现在有什么，然后在chapters里创建第一章初稿。第一章标题叫"古剑"，写陆沉在废弃矿坑深处发现一把断剑——剑身乌黑，刻着他看不懂的上古文字。他用手指触碰剑身时被割破，血滴进剑身的裂纹里，三千年的封印就此松动。剑里传出一个女子的声音："你……是谁？"写1000字左右，要有画面感',
    ],
    checks: [
      { type: 'hasTool', name: 'list_directory', minCount: 1, desc: '应检查 chapters 目录' },
      { type: 'hasTool', name: 'create_file', minCount: 1, desc: '应创建第一章' },
      { type: 'hasText', minChars: 20, desc: '应确认创建完成' },
    ],
  },
  {
    id: 'S8',
    name: '全面回顾：综合检查+规划',
    desc: '读所有已有内容的文件，给完整项目报告。测试综合分析和停止能力。',
    userMessages: [
      '今天效率真高！帮我做个全面的项目检查——characters里有哪些角色、outline里各个tab填了多少、chapters里有没有正文、还缺什么。把有内容的文件都过一遍，然后给我一个完整的项目状态报告和后续写作建议',
    ],
    checks: [
      { type: 'hasTool', name: 'list_directory', minCount: 1, desc: '应先了解目录结构' },
      { type: 'hasTool', name: 'read_file', minCount: 4, maxCount: 20, desc: '应读取有内容的文件' },
      { type: 'hasText', minChars: 300, desc: '应给出详细综合报告' },
    ],
  },

  // ═══ S9-S14: 原15场景测试中一直失败的6个场景 ═══
  // 失败原因: "只读不写"、"ENOENT"、"文件未创建"、"最多完成1/3"
  // 现在测试我们的修复是否解决了这些问题

  {
    id: 'S9',
    name: '[原T1/T2] 多Tab填充：一口气填3个YAML',
    desc: '原失败: 只读模板不写入。测试: 模型应在读取后连续写入多个文件。',
    userMessages: [
      'outline下面还有几个YAML tab基本是空的——locations.yaml、factions.yaml、emotion.yaml。帮我把这三个一次性填了。locations写这个世界的主要地点：废弃矿坑（古剑发现地）、青云宗（表面正派实际藏着秘密）、古剑宗遗址（三千年前的真相所在地）。factions写两个势力：青云宗和古剑宗残部。emotion写第一章的情绪曲线——从平淡到震撼到疑惑。直接用你的知识写，别一个一个读文件确认了，全部写好',
    ],
    checks: [
      // v13.2.0: 空占位文件用 create_file 覆盖是正确行为
      { type: 'hasAnyTool', names: ['create_file', 'edit_file'], minCount: 3, desc: '应填充3个YAML（空占位用create覆盖亦可）' },
      { type: 'fileNotEmpty', path: '剑道长生/outline/locations.yaml', desc: 'locations 应有内容' },
      { type: 'fileNotEmpty', path: '剑道长生/outline/factions.yaml', desc: 'factions 应有内容' },
      { type: 'fileNotEmpty', path: '剑道长生/outline/emotion.yaml', desc: 'emotion 应有内容' },
    ],
  },
  {
    id: 'S10',
    name: '[原T3] 批量创建：指定详细设定的角色',
    desc: '原失败: ENOENT目录空。测试: 批量create_file，指定角色名、身份、性格。',
    userMessages: [
      '还要补几个配角。帮我创建三个角色：1）"陈玄"，青云宗的外门长老，表面是个混日子的老油条，其实是古剑宗残部的卧底，一直在暗中保护陆沉；2）"林小雨"，废弃矿坑附近村庄的少女，第一个发现陆沉不对劲的人，后来成了他的第一个盟友；3）"古剑残魂"，不是完整的剑灵，是当年剑宗大战中阵亡的数千剑修残留意识的集合体，没有形体只有声音，偶尔在陆沉耳边低语。三个都写到characters里',
    ],
    checks: [
      { type: 'hasTool', name: 'create_file', minCount: 3, desc: '三个角色各一个文件' },
      { type: 'fileNotEmpty', path: '剑道长生/characters/陈玄.yaml', desc: '陈玄' },
      { type: 'fileNotEmpty', path: '剑道长生/characters/林小雨.yaml', desc: '林小雨' },
      { type: 'fileNotEmpty', path: '剑道长生/characters/古剑残魂.yaml', desc: '古剑残魂' },
    ],
  },
  {
    id: 'S11',
    name: '[原T7] 细纲创作：给第1章写章节细纲',
    desc: '原失败: 文件未创建。测试: 读plot→理解剧情→写detailed_outline/chapter1.yaml。',
    userMessages: [
      '第一章的正文已经有了，但细纲还没有。你帮我看一下plot.md里第一章的剧情概要，然后给第一章写一个detailed_outline/chapter1.yaml。细纲要有：章节标题"古剑"、剧情概述、出场角色（陆沉、苏念卿、古剑残魂）、关键事件（发现断剑→血滴封印→剑灵苏醒→第一次对话）、情绪曲线（好奇→紧张→震撼→温暖）',
    ],
    checks: [
      { type: 'hasTool', name: 'read_file', minCount: 1, desc: '应读 plot.md 了解剧情' },
      { type: 'hasAnyTool', names: ['create_file', 'edit_file'], minCount: 1, desc: '应创建或编辑细纲文件' },
      { type: 'fileNotEmpty', path: '剑道长生/detailed_outline/chapter1.yaml', desc: 'chapter1.yaml 应有内容' },
    ],
  },
  {
    id: 'S12',
    name: '[原T9] 内容导入：把讨论过的设定整理写入文件',
    desc: '原失败: 分析后未导入。测试: 从对话历史提取信息→整理→写入文件。',
    userMessages: [
      '我们这半天聊了这么多，好多设定散落在对话里——比如古剑的封印机制、九境修炼等级、灵根破碎的原因、师兄的两难选择、江月白的暗中研究。你帮我把这些零散的设定整理成一个完整的"世界观设定集"，写到outline/worldbuilding.md里。把现在worldbuilding里那几行占位内容替换掉，写成一个结构清晰、覆盖全面的版本',
    ],
    checks: [
      { type: 'hasAnyTool', names: ['edit_file', 'create_file'], minCount: 1, desc: '应写入 worldbuilding.md' },
      { type: 'fileNotEmpty', path: '剑道长生/outline/worldbuilding.md', desc: 'worldbuilding.md 应有完整内容' },
      { type: 'hasText', minChars: 30, desc: '应确认整理完成' },
    ],
  },
  {
    id: 'S13',
    name: '[原T14] 混合三合一：追加剧情+创建角色+存笔记',
    desc: '原失败: 最多完成1/3。测试: 一条消息里完成三个不同类型任务。',
    userMessages: [
      '最后再冲刺一下，做三件不相关的事：1）在plot.md里追加一段第二卷的剧情方向——陆沉带着苏念卿前往古剑宗遗址，路上遇到陈玄的真实身份暴露，三人被迫在荒野中逃亡；2）在characters里创建一个新角色"白鸦"——一个来历不明的流浪剑客，总是出现在关键地点，不说废话但每句话都有深意，可能是友可能是敌；3）把今天所有关于九境修炼的讨论整理一下，存到notes/修炼体系研究.md里，供以后参考。三件事都做',
    ],
    checks: [
      { type: 'hasTool', name: 'edit_file', minCount: 1, desc: '应追加 plot.md' },
      { type: 'hasTool', name: 'create_file', minCount: 1, desc: '应创建白鸦角色' },
      { type: 'hasAnyTool', names: ['create_file', 'edit_file'], minCount: 1, desc: '应创建或编辑笔记' },
      // v14.1.0: 任务完整性断言 — 第三任务的产物必须真实存在（原断言可被任务2的create满足而漏检任务3）
      // 注: 系统提示词约定 notes 在全局 ../notes/（非项目内），断言路径与其一致
      { type: 'fileNotEmpty', path: '../notes/修炼体系研究.md', desc: '任务3产物: 修炼体系研究笔记' },
      { type: 'hasText', minChars: 30, desc: '应确认三件事完成' },
    ],
  },
  {
    id: 'S14',
    name: '[压力测试] 全项目深度体检+3000字创作建议',
    desc: '综合压力测试: 读所有文件→分析质量→给出详细改进方案。',
    userMessages: [
      '好了，这次是真的收工了。帮我把剑道长生所有文件——outline的8个tab、characters里所有角色、chapters里的正文、detailed_outline、summaries——全部认真看一遍。然后给我一份"编辑审读报告"：每个文件的优点、不足、具体的改进建议。最后根据整个项目的现状，给我一个分阶段的写作计划——第一阶段做什么、第二阶段做什么、预计多少字。不要赶，慢慢看，详细写',
    ],
    checks: [
      { type: 'hasTool', name: 'read_file', minCount: 6, maxCount: 30, desc: '应大量读取但不无限循环' },
      { type: 'hasText', minChars: 500, desc: '应给出详细审读报告（500字以上）' },
    ],
  },

  // ═══ S15-S17: 高级能力测试 ═══
  // S15: 创意迭代(写→讨论→修改→再讨论) | S16: 内容转化 | S17: 联网搜索+保存

  {
    id: 'S15',
    name: '创意迭代：写→讨论→修改→再讨论→定稿',
    desc: '测试完整的迭代创作流程。用户提出创意→AI写入文件→继续讨论→AI基于新讨论修改文件→最终定稿。',
    userMessages: [
      '我有个新想法，不走修仙路线了——写一个"梦境建筑师"的故事。主角能进入别人的梦境，通过重建梦境来治愈心理创伤。但他逐渐发现有些人的梦境被人为篡改过，背后是一个利用梦境操控人心的神秘组织。你觉得这个设定有潜力吗？分析一下然后帮我把这个创意整理成一篇完整的设定稿，写到notes/梦境建筑师-创意初稿.md里',
    ],
    checks: [
      { type: 'hasAnyTool', names: ['create_file', 'edit_file'], minCount: 1, desc: '应创建或写入创意文件' },
      { type: 'hasText', minChars: 80, desc: '应分析梦境设定的潜力和建议' },
    ],
  },
  {
    id: 'S16',
    name: '继续迭代：追加新想法+修正细节',
    desc: '在S15创建的创意文件基础上，用户讨论后提出补充和修正。测试：读→追加→精确修改。',
    userMessages: [
      '刚才聊的给了我新灵感！你说的"梦境可以有多层结构"这个太妙了——主角要一层层深入才能找到被篡改的源头，每一层的物理法则都不一样。还有，给他配一个搭档——一个因为意外被困在梦境深层出不来的前梦境建筑师，只能在梦里和主角交流。她叫"林醒"，讽刺的是名字叫醒却醒不来。主角就叫"陈渡"吧，梦境的摆渡人。你把这三个新想法（多层梦境结构、搭档林醒、主角陈渡）追加到刚才的创意文件里，然后把文件里之前的占位称呼都替换成正式名字',
    ],
    checks: [
      { type: 'hasTool', name: 'read_file', minCount: 1, desc: '应先读文件确认当前内容' },
      { type: 'hasAnyTool', names: ['edit_file', 'batch_replace', 'create_file'], minCount: 1, desc: '应修改或重建文件' },
      { type: 'hasText', minChars: 30, desc: '应确认修改完成' },
    ],
  },
  {
    id: 'S17',
    name: '内容转化：大纲/世界观→细纲/角色/章节',
    desc: '测试从原始素材到创作成品的转化链：读plot+worldbuilding→生成detailed_outline+角色总览+章节开篇。',
    userMessages: [
      '剑道长生项目里outline/plot.md和outline/worldbuilding.md已经写得比较完整了，但还没转化成可以直接用来写作的素材。你帮我做三件事：1）把plot.md的剧情大纲提取出来，写成detailed_outline/chapter1.yaml的细纲格式（包含剧情概述、出场角色、关键事件、情绪曲线）；2）把worldbuilding.md里的核心设定（修炼体系、势力分布、古剑封印机制）提炼成一个角色总览文件存到notes/世界观要素速查.md；3）基于第一章的剧情概要，写一个chapters/第1章-开篇.txt的正式开篇段落，要有画面感',
    ],
    checks: [
      { type: 'hasTool', name: 'read_file', minCount: 2, desc: '应读 plot.md 和 worldbuilding.md' },
      { type: 'hasAnyTool', names: ['create_file', 'edit_file'], minCount: 2, desc: '应至少创建/编辑2个文件' },
      { type: 'hasText', minChars: 40, desc: '应汇报三件事完成情况' },
    ],
  },
  {
    id: 'S18',
    name: '联网搜索+保存：搜索→整理→写入知识库',
    desc: '测试联网搜索+信息整理+保存到知识库的完整流程。',
    userMessages: [
      '帮我搜一下中国古代关于剑的传说和名剑的资料，我想给剑道长生里的古剑设定找一些历史文化参考，比如十大名剑的传说、欧冶子铸剑的故事之类的',
    ],
    checks: [
      { type: 'hasAnyTool', names: ['browser_search', 'http_get', 'http_fetch'], minCount: 1, desc: '应使用搜索工具' },
      { type: 'hasText', minChars: 100, desc: '应整理并展示搜索结果' },
    ],
  },
  {
    id: 'S19',
    name: '搜索成果保存：整理搜索结果→写入知识库',
    desc: '测试将搜索结果整理保存到知识库的能力。',
    userMessages: [
      '搜索结果不错！把承影剑和湛卢剑的资料整理一下，尤其是承影剑"只见剑影不见剑身"的透明特性和湛卢剑"仁者得之"的灵性特质——这些太适合做古剑设定的参考了。整理好了存到知识库里，文件名就叫"上古名剑-创作参考.md"',
    ],
    checks: [
      { type: 'hasAnyTool', names: ['create_file', 'edit_file', 'kb_append_file'], minCount: 1, desc: '应保存到知识库或笔记' },
      { type: 'hasText', minChars: 30, desc: '应确认保存完成' },
    ],
  },

  // ═══ v14.1.0: 多任务压力测试 ═══
  // 验证运行时任务清单机制：5 个编号任务必须全部真实完成（部分完成即失败）。
  // 不断言模型措辞，只断言 5 个产物文件的内容。

  {
    id: 'S_MT2',
    name: '🧩 多任务压力：一口气 5 项任务全部完成',
    desc: '5个编号任务，验证运行时任务清单机制：全部产物文件必须真实存在且含关键内容（部分完成即失败）。',
    userMessages: [
      '最后冲刺，一口气做五件事，全部都要完成：1）在outline/power_system.yaml里补一条境界"剑心境"——第十境，突破条件是古剑完全解封，与主角灵魂共鸣；2）在characters里创建角色"阿九"——古剑剑灵的幼年形态，是个只有巴掌大的剑形光团，说话奶声奶气但偶尔冒出一句三千年前的古语；3）在plot.md末尾追加一段：陆沉在矿坑深处发现一扇青铜门，门上刻着九境修炼的图解，推开后是古剑宗的传承密室；4）创建summaries/chapter1.md的摘要文件，格式按模板（剧情概述/关键事件/出场角色）；5）在notes里创建一个"灵感碎片.md"，把这三条灵感记下来：青铜门上的剑纹会在月圆之夜发光、阿九其实记得自己陨落前的名字、密室里的壁画预言了陆沉的结局',
    ],
    checks: [
      { type: 'hasTool', name: 'edit_file', minCount: 1, desc: '应编辑 power_system.yaml' },
      { type: 'hasTool', name: 'create_file', minCount: 2, desc: '应至少创建 2 个文件' },
      { type: 'fileContains', path: '剑道长生/outline/power_system.yaml', needle: '剑心境', desc: '任务1产物: 剑心境境界' },
      { type: 'fileContains', path: '剑道长生/characters/阿九.yaml', needle: '剑灵', desc: '任务2产物: 阿九角色卡' },
      { type: 'fileContains', path: '剑道长生/outline/plot.md', needle: '青铜门', desc: '任务3产物: plot 追加青铜门' },
      { type: 'fileNotEmpty', path: '剑道长生/summaries/chapter1.md', desc: '任务4产物: 章节摘要' },
      // 注: 系统提示词约定 notes 在全局 ../notes/（非项目内），断言路径与其一致
      // v14.5.0: 用户未要求长度 → minChars 30（默认不限制；三条极简灵感也通过）。
      // 字数遵从由 S_LEN 场景单独验证（用户明确要求长度时必须达标）
      { type: 'fileNotEmpty', path: '../notes/灵感碎片.md', desc: '任务5产物: 灵感记录', minChars: 30 },
    ],
  },

  // ═══ v15: 子 agent 委托测试 ═══
  // S_SUB1: 大文件分析委托（子代理独立上下文）| S_SUB2: 长文件精确修改委托

  {
    id: 'S_SUB1',
    name: '📎 子代理：大文件分析委托',
    desc: '约3万字符大文件。验证主 agent 用 analyze_file 委托子代理分析（独立上下文，只返回摘要）。',
    setup: async () => {
      // 创建约 3 万字符的测试文件（重复段落拼接）
      const fp = resolve(PROJECTS_DIR, '剑道长生/chapters/大文件测试.txt')
      mkdirSync(dirname(fp), { recursive: true })
      const para = '陆沉在废弃矿坑深处发现了古剑，剑身乌黑，刻着上古文字。他伸手触碰时被割破手指，血滴进剑身的裂纹，三千年的封印就此松动。剑中传来女子的声音："你……是谁？"他不知这把剑将改变他的一生。\n\n'
      writeFileSync(fp, para.repeat(150), 'utf-8')  // 约 3 万字
    },
    userMessages: [
      '我上传了一个大文件 chapters/大文件测试.txt（约3万字），帮我分析一下它的内容结构和亮点，我懒得自己看。',
    ],
    checks: [
      { type: 'hasTool', name: 'analyze_file', minCount: 1, desc: '应使用 analyze_file 委托子代理分析大文件' },
      { type: 'hasText', minChars: 100, desc: '应返回结构化分析摘要' },
    ],
  },
  {
    id: 'S_SUB2',
    name: '✏️ 子代理：长文件精确修改委托',
    desc: '大文件多处修改。验证主 agent 用 edit_file_task 委托子代理定位并修改（返回前后摘要）。',
    userMessages: [
      'chapters/大文件测试.txt 这个文件里有几处"剑身乌黑"，全部改成"剑身漆黑如墨"。文件很大，直接改会占满我的上下文，用委托的方式处理',
    ],
    checks: [
      { type: 'hasTool', name: 'edit_file_task', minCount: 1, desc: '应使用 edit_file_task 委托子代理修改' },
      { type: 'fileContains', path: '剑道长生/chapters/大文件测试.txt', needle: '漆黑如墨', desc: '修改应真实生效（新词存在）' },
      { type: 'hasText', minChars: 30, desc: '应汇报修改结果' },
    ],
  },

  // ═══ v14.2.0: 跨 run 续跑测试 ═══
  // S_RESUME: 第一轮 maxIterations=4 模拟中断（5 任务不可能在 4 轮内完成 → taskProgress 中断快照），
  // autoResume 复刻 UI 层 maybeInjectResume 注入 [续跑] 提示 → 第二轮恢复完成剩余任务。
  // 断言: taskInterrupted（首轮中断）+ 全部 5 个产物文件真实存在。

  {
    id: 'S_RESUME',
    name: '🔁 跨 run 续跑：中断→[续跑]注入→剩余任务全部完成',
    desc: '第一轮受限迭代中断（taskProgress.interrupted=true），第二轮注入[续跑]提示后继续完成剩余任务，全部产物必须存在。',
    autoResume: true,
    roundMaxIterations: [1, 25],  // 第一轮受限 1 轮（模拟中断——模型效率提升后 3 轮内可完成 5 任务，中断不再必然触发；1 轮保证中断），第二轮恢复
    userMessages: [
      '帮我做这几件事，全部都要完成：1）创建 characters/燕轻尘.yaml 角色卡——古剑宗弟子，剑意凌厉性格孤傲，师承剑宗长老，与陆沉是宿敌；2）在 outline/plot.md 末尾追加一段：陆沉在传承密室得到剑宗老祖的剑意传承，剑鸣三日不止；3）在 outline/items.yaml 里新增一件物品"云纹玉佩"，品阶灵器，可凝神静气；4）创建 notes/跨run续跑测试.md，记录本次任务测试的笔记；5）创建 summaries/chapter_resume_test.md，按摘要模板格式填写第一章的摘要',
      '继续完成剩余任务',
    ],
    checks: [
      { type: 'taskInterrupted', desc: '第一轮应因迭代受限中断（taskProgress.interrupted=true, allDone=false）' },
      { type: 'hasAnyTool', names: ['create_file', 'edit_file'], minCount: 1, desc: '应执行文件写入' },
      { type: 'fileContains', path: '剑道长生/characters/燕轻尘.yaml', needle: '燕轻尘', desc: '产物1: 角色卡存在' },
      { type: 'fileContains', path: '剑道长生/outline/plot.md', needle: '剑意传承', desc: '产物2: plot 追加剑意传承' },
      { type: 'fileContains', path: '剑道长生/outline/items.yaml', needle: '云纹玉佩', desc: '产物3: items 添加云纹玉佩' },
      { type: 'fileNotEmpty', path: '../notes/跨run续跑测试.md', desc: '产物4: 续跑测试笔记存在' },
      { type: 'fileNotEmpty', path: '剑道长生/summaries/chapter_resume_test.md', desc: '产物5: 章节摘要存在' },
    ],
  },

  // ═══ v14.2.1: 批量并行分析 + 验收子代理 ═══
  // S_PAR: 一次分析多个文件 → 多个 analyze_file（runtime 分片 ≤3 并行，isolatedStore 并发安全）
  // S_VERIFY: 任务完成后用 verify_task 对照验收标准逐项核对产物

  {
    id: 'S_PAR',
    name: '⚡ 批量并行：一次分析多个文件',
    desc: '多文件分析应并行委托多个 analyze_file 子代理（isolatedStore 保证并发安全），全部返回摘要。',
    setup: async () => {
      const base = resolve(PROJECTS_DIR, TEST_PROJECT)
      const para = '陆沉修复古剑后修为大涨，与剑灵苏念卿的关系逐渐亲密。'
      writeFileSync(resolve(base, 'chapters/并行分析1.txt'), para.repeat(120), 'utf-8')  // ~1万字
      writeFileSync(resolve(base, 'chapters/并行分析2.txt'), para.repeat(100), 'utf-8')
      writeFileSync(resolve(base, 'chapters/并行分析3.txt'), para.repeat(80), 'utf-8')
    },
    userMessages: [
      '我这有三个大文件要分析：chapters/并行分析1.txt、chapters/并行分析2.txt、chapters/并行分析3.txt，每个都在一万字左右。帮我一次性都分析掉，分别告诉我它们的内容结构和写作亮点，我懒得自己看。',
    ],
    checks: [
      { type: 'hasTool', name: 'analyze_file', minCount: 2, desc: '应委托多个 analyze_file 子代理并行分析' },
      { type: 'hasText', minChars: 150, desc: '应返回多文件的结构化分析摘要' },
    ],
  },

  {
    id: 'S_VERIFY',
    name: '✅ 验收子代理：对照标准逐项核对产物',
    desc: '任务完成后应调用 verify_task（只读验收子代理）对照验收标准逐项检查产物文件并报告结果。',
    userMessages: [
      '帮我创建两个文件：1）创建 characters/验收测试角色.yaml，角色叫"林晚照"，内容包含姓名、性格、经历三个部分；2）创建 notes/验收测试笔记.md，记录三条要点：古剑出鞘、剑意传承、山门重建。创建完成后请用 verify_task 对照验收标准逐项检查这两个文件（标准：角色卡文件存在且含姓名、笔记文件存在且非空），把验收结果告诉我。',
    ],
    checks: [
      { type: 'hasTool', name: 'verify_task', minCount: 1, desc: '应调用 verify_task 验收子代理' },
      { type: 'hasAnyTool', names: ['create_file', 'edit_file'], minCount: 1, desc: '应先创建产物文件' },
      { type: 'hasText', minChars: 50, desc: '应汇报验收结果' },
    ],
  },

  // ═══ v13.2.0: 渐进披露压力测试 ═══
  // 验证 tool_search → 发现 → 调用的完整链路（非核心工具需动态加载 schema）

  {
    id: 'S_PD',
    name: '🔍 渐进披露：tool_search发现非核心工具→调用',
    desc: '要求搜索图片。search_images不在12核心工具中，需通过tool_search("图片")发现后动态加载schema。',
    userMessages: [
      '帮我在网上搜一下"上古仙剑概念图"的参考图片，我想给剑道长生的古剑找个视觉参考',
    ],
    checks: [
      { type: 'hasAnyTool', names: ['search_images', 'browser_search'], minCount: 1, desc: '应使用搜索/图片工具' },
      { type: 'hasText', minChars: 50, desc: '应展示或说明搜索结果' },
    ],
  },

  // ═══ v14.3: 子代理信息复用 + 验收督促闭环 ═══

  {
    id: 'S_SUB_MEM',
    name: '📸 子代理快照跨run复用（v14.3）',
    desc: '第一轮 analyze_file 分析大文件 → 快照注入 sharedMessages → 第二轮模型直接引用上轮分析结论（含角色名），不再重复委托分析。',
    userMessages: [
      '用 analyze_file 委托子代理分析 chapters/角色发展.md（两万字长文件），提取：三个主要角色的名字、各自的关键性格描写原文片段（每段 50 字以内）。',
      '基于你上一轮的分析结果（子代理快照），把陆沉的性格描写改一句话。直接告诉我改了什么，不用重新分析文件。',
    ],
    checks: [
      { type: 'hasTool', name: 'analyze_file', minCount: 1, maxCount: 1, desc: '第一轮委托子代理分析一次' },
      { type: 'hasText', minChars: 150, desc: '第一轮应输出分析结论' },
      { type: 'hasText', minChars: 50, desc: '第二轮应基于快照给出答复' },
      { type: 'hasTool', name: 'analyze_file', maxCount: 1, desc: '第二轮未重复委托（快照已注入）' },
    ],
    setup: () => {
      // 生成两万字角色发展文件（子代理委托触发条件）
      const dir = resolve(PROJECTS_DIR, TEST_PROJECT, 'chapters')
      mkdirSync(dir, { recursive: true })
      const parts = []
      for (let i = 0; i < 180; i++) {
        parts.push(`第${i}节 陆沉在山中修炼，性格坚韧不拔。苏念卿在旁指点，性格冷傲却护短。林晚照远眺云海，性格温婉寡言。`)
      }
      writeFileSync(resolve(dir, '角色发展.md'), parts.join('\n'))
    },
  },

  {
    id: 'S_ASK',
    name: '💬 子代理会话追问（v14.3）',
    desc: '第一轮 analyze_file 建立该文件的子代理会话 → 第二轮 subagent_ask 复用会话上下文追问细节（无需重新读取大文件）。',
    userMessages: [
      '用 analyze_file 委托子代理分析 chapters/主角成长线.md（两万字长文件），提取：主角在每个阶段的实力变化。',
      '用 subagent_ask 追问同一个文件：第三阶段的突破场景原文片段（50 字以内）。',
    ],
    checks: [
      { type: 'hasTool', name: 'analyze_file', minCount: 1, maxCount: 1, desc: '第一轮建立会话（仅一次）' },
      { type: 'hasTool', name: 'subagent_ask', minCount: 1, desc: '第二轮应调用 subagent_ask 追问' },
      { type: 'hasText', minChars: 50, desc: '追问应有实质回复' },
    ],
    setup: () => {
      const dir = resolve(PROJECTS_DIR, TEST_PROJECT, 'chapters')
      mkdirSync(dir, { recursive: true })
      const parts = []
      for (let i = 0; i < 180; i++) {
        parts.push(`第${i}段 第一阶段练气，陆沉剑气初成。第二阶段筑基，苏念卿传授剑诀。第三阶段金丹，古剑共鸣突破。第四阶段元婴，剑灵苏醒。`)
      }
      writeFileSync(resolve(dir, '主角成长线.md'), parts.join('\n'))
    },
  },

  {
    id: 'S_VERIFY_FIX',
    name: '🔁 验收失败修复闭环（v14.3）',
    desc: '两步式：先创建仅含姓名的简略角色卡 → verify_task 首验必失败（缺性格/经历）→ edit_file_task 补全 → 复验通过。验证 runtime 验收督促闸门 + 修复闭环。',
    userMessages: [
      '分两步完成：第一步，先创建 characters/验收角色.yaml，只包含姓名字段（name: 林晚照），不要写其他内容。第二步，调用 verify_task 对照标准验收：1) 文件存在 2) 含姓名"林晚照" 3) 含性格描写 4) 含经历描写。若验收未通过，就调用 edit_file_task 补全性格和经历，再重新 verify_task 验收，直到通过为止。',
    ],
    checks: [
      { type: 'hasTool', name: 'verify_task', minCount: 2, desc: '至少验收两次（首验失败 + 复验）' },
      { type: 'hasAnyTool', names: ['create_file', 'edit_file_task', 'edit_file'], minCount: 1, desc: '创建/修复了角色文件' },
      { type: 'lastVerifyPassed', desc: '最后一次验收判定通过（verify 子代理真实读文件逐条核对）' },
      { type: 'fileContains', path: `${TEST_PROJECT}/characters/验收角色.yaml`, needle: '林晚照', desc: '角色文件包含姓名' },
      { type: 'hasText', minChars: 50, desc: '应汇报最终结果' },
    ],
  },

  {
    id: 'S_LEN',
    name: '📏 字数遵从：用户要求 100 字 → 产物必须达标（v14.5.0）',
    desc: '用户明确要求"至少100字" → 断言产物 ≥100 字符。与 S_MT2 任务5（未要求长度，minChars 30）对照：默认不限制，用户有要求时必须满足。',
    userMessages: [
      '在 notes 里创建一个"字数遵从测试.md"，写一段关于剑道修炼的感悟，至少 100 字。',
    ],
    checks: [
      { type: 'hasAnyTool', names: ['create_file', 'edit_file'], minCount: 1, desc: '应写入文件' },
      // 用户明确要求了长度 → 默认严阈值 100 生效
      { type: 'fileNotEmpty', path: '../notes/字数遵从测试.md', desc: '产物应 ≥100 字符（用户明确要求）' },
    ],
  },
]

// ═══════════════════════════════════════════════════════════
// 6. 断言检查
// ═══════════════════════════════════════════════════════════

function checkResult(scenario, result, scenarioTools) {
  const failures = []
  for (const check of scenario.checks) {
    switch (check.type) {
      case 'hasTool': {
        const count = scenarioTools.filter(t => t === check.name).length
        if (count < (check.minCount || 1))
          failures.push(`❌ ${check.desc}: 期望≥${check.minCount || 1}次 ${check.name}, 实际${count}次`)
        if (check.maxCount && count > check.maxCount)
          failures.push(`❌ ${check.desc}: 期望≤${check.maxCount}次 ${check.name}, 实际${count}次（过度调用）`)
        break
      }
      case 'hasAnyTool': {
        const count = scenarioTools.filter(t => (check.names || []).includes(t)).length
        if (count < (check.minCount || 1))
          failures.push(`❌ ${check.desc}: 期望≥${check.minCount || 1}次 [${(check.names || []).join(', ')}], 实际${count}次`)
        break
      }
      case 'noTool': {
        if (scenarioTools.includes(check.name))
          failures.push(`❌ ${check.desc}: 不应调用 ${check.name}`)
        break
      }
      case 'noToolCalls': {
        const writeTools = ['create_file', 'edit_file', 'delete_file', 'create_project', 'delete_project']
        const writes = scenarioTools.filter(t => writeTools.includes(t))
        if (writes.length > 0)
          failures.push(`❌ ${check.desc}: 调用了写工具 ${writes.join(', ')}`)
        break
      }
      // v14.2.0: 跨 run 续跑 — 断言首轮 run 被中断（taskProgress.interrupted && !allDone）
      case 'taskInterrupted': {
        const tp = result._taskProgress
        if (!tp || !tp.interrupted || tp.allDone)
          failures.push(`❌ ${check.desc}: 期望 taskProgress 中断未完成, 实际 ${tp ? `{interrupted:${tp.interrupted}, allDone:${tp.allDone}}` : '无 taskProgress'}`)
        break
      }
      case 'hasNoTools': {
        if (scenarioTools.length > 0)
          failures.push(`❌ ${check.desc}: 不应调用任何工具，实际调用了 ${scenarioTools.join(', ')}`)
        break
      }
      case 'hasText': {
        const text = result.text || ''
        if (text.length < (check.minChars || 0))
          failures.push(`❌ ${check.desc}: 文本长度 ${text.length} < ${check.minChars}`)
        break
      }
      case 'hasChars': {
        let found = false
        for (const name of ['test-project', '仙途', '剑道长生']) {
          const cdir = resolve(PROJECTS_DIR, name, 'characters')
          if (!existsSync(cdir)) continue
          const files = readdirSync(cdir).filter(f => f.endsWith('.yaml') || f.endsWith('.md'))
          if (files.length > 0) { found = true; break }
        }
        if (!found) failures.push(`❌ ${check.desc}: characters/ 无角色文件`)
        break
      }
      case 'fileNotEmpty': {
        const fp = resolve(PROJECTS_DIR, check.path)
        if (!existsSync(fp)) {
          failures.push(`❌ ${check.desc}: ${check.path} 不存在`)
        } else {
          const content = readFileSync(fp, 'utf-8')
          // v14.5.0: 阈值参数化——默认 100（用户明确要求长度时用默认严阈值）；
          // 场景未要求长度时用 minChars 放宽（如灵感碎片 30），避免"默认不限制却被断言卡死"
          const minChars = check.minChars ?? 100
          if (content.length < minChars)
            failures.push(`❌ ${check.desc}: 文件内容过短 (${content.length} 字符, 需≥${minChars})`)
        }
        break
      }
      // v14.1.0: 文件内容断言 — 直接验证任务产物包含关键内容（比 fileNotEmpty 更强）
      case 'fileContains': {
        const fp = resolve(PROJECTS_DIR, check.path)
        if (!existsSync(fp)) {
          failures.push(`❌ ${check.desc}: ${check.path} 不存在`)
        } else {
          const content = readFileSync(fp, 'utf-8')
          if (!content.includes(check.needle))
            failures.push(`❌ ${check.desc}: ${check.path} 未包含 "${check.needle}"`)
        }
        break
      }
      // v14.3: 验收闭环 — 最后一次 verify_task 的 summary 以"验收通过"开头（修复→复验成功）
      case 'lastVerifyPassed': {
        const steps = result._toolCallSteps || []
        const verifySteps = steps.filter(s => s.tool === 'verify_task')
        const last = verifySteps[verifySteps.length - 1]
        if (!last)
          failures.push(`❌ ${check.desc}: 未调用 verify_task`)
        else if (!String(last.summary || '').startsWith('验收通过'))
          failures.push(`❌ ${check.desc}: 最后一次验收未通过 (${last.summary})`)
        break
      }
    }
  }
  return failures
}

// ═══════════════════════════════════════════════════════════
// 7. 主流程 — 通过真实 Bridge 运行对话
// ═══════════════════════════════════════════════════════════

async function runScenarioViaBridge(scenario, bridge, sharedMessages) {
  // 追踪该场景的工具调用
  const toolsCalled = []
  let lastEstimatedContextTokens = 0  // v13.2.0: 最终上下文估算
  let lastTaskProgress = null  // v14.2.0: 跨 run 续跑 — 最终一轮的 taskProgress 快照
  let lastToolCallSteps = null  // v14.3: 最终一轮的 toolCallSteps（lastVerifyPassed 断言用）
  // v14 批处理(④数据收集): 每轮 估算 vs 真实 input tokens（tokenEstimation 精度回归用）
  const usageRounds = []

  for (let mi = 0; mi < scenario.userMessages.length; mi++) {
    const userMsg = scenario.userMessages[mi]

    // v14.2.0: 按轮覆盖 maxIterations（S_RESUME: 第一轮受限模拟中断，第二轮恢复）
    if (scenario.roundMaxIterations?.[mi]) bridge.maxIterations = scenario.roundMaxIterations[mi]

    // 发送消息到 Bridge（像真实用户一样）
    let response
    try {
      response = await bridge.sendMessage(userMsg, {
        kbEnabled: false,
        webSearchEnabled: false,
        onApprovalRequired: async () => true,  // 自动批准所有操作
        onToolProgress: (data) => {
          if (data.phase === 'done') {
            toolsCalled.push(data.toolName)
          }
        },
      })
    } catch (e) {
      console.error(`   ⚠️ Bridge.sendMessage 异常: ${e.message}`)
      return { toolsCalled, text: `[ERROR] ${e.message}`, success: false }
    }

    // v14 批处理(④数据收集): 记录本轮 估算 vs 真实。
    // 口径警示: DeepSeek 兼容接口的 input_tokens 疑似只统计缓存未命中部分，
    // 且 estimatedContextTokens 是对"下一次请求"的估算（错位一轮）——
    // 估/真 仅作数量级参考，系数校准以 scripts/measure-token-density.mjs 直接测量为准。
    const _realInput = response.promptTokens || 0
    const _estTokens = response.estimatedContextTokens || 0
    usageRounds.push({
      round: mi + 1,
      estTokens: _estTokens,
      realInput: _realInput,
      ratio: _estTokens > 0 && _realInput > 0 ? _estTokens / _realInput : null,
    })

    // v14.2.0: 捕获 taskProgress（第一轮中断 → 第二轮恢复后仍保留首轮快照供断言）
    if (response.taskProgress) lastTaskProgress = response.taskProgress

    // v14.3: 捕获最终一轮 toolCallSteps（lastVerifyPassed 断言）
    lastToolCallSteps = response.toolCallSteps || null

    // 将响应加入共享消息历史（用于跨场景上下文传递）
    const lastText = response.text || ''
    if (lastText.trim()) {
      sharedMessages.push({ role: 'assistant', content: lastText })
    }

    // v14.2.0: 跨 run 续跑模拟 — 复刻 UI 层 AIChatWindow.maybeInjectResume 行为：
    // 本轮中断未完成（taskProgress.interrupted && !allDone）→ 注入 [续跑] 提示并更新历史，
    // 下一轮 sendMessage 的 runtime 会看到"上次中断于 X/Y，剩余任务"。
    const tp = response.taskProgress
    if (scenario.autoResume && tp && !tp.allDone && tp.interrupted) {
      sharedMessages.push({ role: 'user', content: userMsg })
      const doneCount = tp.tasks.filter(t => t.done).length
      const doneList = tp.tasks.filter(t => t.done).map(t => `${t.id})${t.desc}`).join('；')
      const remaining = tp.tasks.filter(t => !t.done).map(t => `${t.id})${t.desc}`).join('；')
      sharedMessages.push({ role: 'system', content: `[续跑] 上一轮运行中断于任务 ${doneCount}/${tp.tasks.length}，任务未全部完成。已完成: ${doneList || '无'}。剩余: ${remaining}。请直接继续完成剩余任务，不要重新开始或重复已完成的工作。全部完成后明确说"全部完成"。` })
      bridge.updateHistory([...sharedMessages])
      console.log(`   🔁 检测到中断（${doneCount}/${tp.tasks.length} 已完成）→ 已注入 [续跑] 提示`)
    }

    // v14.3: 子代理快照注入模拟 — 复刻 UI 层 maybeInjectSubagentSummaries：
    // 本轮委托了子代理 → 把结果快照注入 sharedMessages，下一轮/下一场景可直接引用（无需重新委托）。
    // 最多注入最近 3 条，每条 detail 截 800 字，标注"信息为当时快照"。
    if (response.subagentSummaries?.length) {
      const entries = response.subagentSummaries.slice(-3)
      const lines = entries.map((s, i) => {
        const detail = String(s.detail || '').slice(0, 800)
        const mark = s.status === 'error' ? '✗' : '✓'
        return `${i + 1}. [${s.tool}] ${s.filePath || '(无路径)'} — ${mark} ${s.summary || ''}${detail ? `\n   ${detail}` : ''}`
      })
      // v14.4.0 修复: 与 autoResume 分支对齐——先补本轮 user 消息再注入 system 快照，
      // 避免历史出现连续 assistant 消息（严格 OpenAI 交替校验会 400；UI 层作用于完整历史）
      sharedMessages.push({ role: 'user', content: userMsg })
      sharedMessages.push({ role: 'system', content: `[子代理快照] 上次委托子代理的结果（信息为当时快照，文件可能已修改；需要最新内容请重新委托分析）:\n${lines.join('\n')}` })
      bridge.updateHistory([...sharedMessages])
      console.log(`   📸 已注入子代理快照（${entries.length} 条）`)
    }

    // 从 toolCallSteps 收集工具调用
    if (response.toolCallSteps) {
      for (const step of response.toolCallSteps) {
        if (!toolsCalled.includes(step.tool)) {
          toolsCalled.push(step.tool)
        }
      }
    }

    // 输出本轮摘要
    const toolSummary = response.toolsUsed?.length
      ? `[${response.toolsUsed.join(', ')}]`
      : '[无工具]'
    // v13.2.0: 捕获上下文估算（最终一条消息的估算值）
    lastEstimatedContextTokens = response.estimatedContextTokens || 0
    console.log(`   工具: ${toolSummary} | 回复: ${lastText.slice(0, 100).replace(/\n/g, ' ')}...`)
  }

  // 获取该场景的最终响应文本
  let text = ''
  // 从 sharedMessages 的最后一条 assistant 消息获取
  for (let i = sharedMessages.length - 1; i >= 0; i--) {
    if (sharedMessages[i].role === 'assistant') {
      text = sharedMessages[i].content
      break
    }
  }

  return { toolsCalled, text, success: true, _estimatedContextTokens: lastEstimatedContextTokens, _taskProgress: lastTaskProgress, _toolCallSteps: lastToolCallSteps, _usageRounds: usageRounds }
}

async function main() {
  const args = process.argv.slice(2)
  const filter = args.find(a => a.startsWith('--scenario='))?.split('=')[1]?.split(',')
  const scenarios = filter ? SCENARIOS.filter(s => filter.includes(s.id)) : SCENARIOS

  console.log(`\n🧪 AI 写作助手完整对话测试 v3.0 — 真实 Bridge → Runtime → Adapter`)
  console.log(`   模型: ${MODEL} | 项目: ${TEST_PROJECT}`)
  console.log(`   场景: ${scenarios.map(s => s.id).join(' → ')} (共${scenarios.length}个)`)
  console.log(`   上下文: 1M tokens | 架构: Bridge → Runtime → Adapter`)
  console.log('─'.repeat(60))

  // 清理旧测试数据
  cleanup()
  // 创建"剑道长生"项目骨架（模拟用户已建好项目）
  const projPath = resolve(PROJECTS_DIR, TEST_PROJECT)
  if (!existsSync(projPath)) {
    const dirs = ['outline', 'characters', 'chapters', 'detailed_outline', 'summaries', 'notes']
    dirs.forEach(d => mkdirSync(resolve(projPath, d), { recursive: true }))
    writeFileSync(resolve(projPath, 'project.json'), JSON.stringify({ type: 'writing', novelCategory: '修仙小说' }, null, 2))
    // 初始文件
    writeFileSync(resolve(projPath, 'outline', 'plot.md'),
      '# 故事剧情\n\n> 铁匠少年陆沉，因修复一把古剑唤醒了被封印三千年的剑灵苏念卿，从此卷入跨越千年的修仙界阴谋。\n\n## 第1章·古剑\n\n待填充\n')
    writeFileSync(resolve(projPath, 'outline', 'worldbuilding.md'),
      '# 世界观\n\n> 修仙架空·剑修体系\n\n## 一、核心规则\n\n上古剑宗覆灭后，剑修传承断绝。唯有被封印的古剑中残存剑灵记忆。\n')
    writeFileSync(resolve(projPath, 'outline', 'items.yaml'), 'items: []\n')
    writeFileSync(resolve(projPath, 'outline', 'factions.yaml'), 'factions: []\n')
    writeFileSync(resolve(projPath, 'outline', 'locations.yaml'), 'locations: []\n')
    writeFileSync(resolve(projPath, 'outline', 'power_system.yaml'), "name: ''\ndescription: ''\nlevels: []\n")
    writeFileSync(resolve(projPath, 'outline', 'emotion.yaml'), 'segments: []\n')
    writeFileSync(resolve(projPath, 'outline', 'outline_meta.yaml'), 'foreshadowing: []\nplotThreads: []\n')
  }

  // 初始化 store
  console.log('\n📦 初始化 Zustand Store...')
  await initStores()
  console.log('   ✅ Store 已就绪')

  // 导入并初始化 Bridge
  console.log('🔌 初始化 V4AnthropicChatBridge...')
  const { V4AnthropicChatBridge } = await import('../src/agent/V4AnthropicChatBridge.ts')
  const bridge = new V4AnthropicChatBridge(TEST_PROJECT)
  bridge.init({
    configId: 'test-config',
    projectId: TEST_PROJECT,
    maxIterations: 25,
    contextWindow: 1_000_000, // deepseek-v4-flash 支持 1M 上下文
    historyMessages: [],
  })
  console.log('   ✅ Bridge 已就绪')

  // 共享的消息历史（跨场景上下文累积）
  const sharedMessages = []
  let passed = 0
  let failed = 0
  const scenarioResults = []

  for (const scenario of scenarios) {
    console.log(`\n📋 ${scenario.id}: ${scenario.name}`)
    console.log(`   用户: ${scenario.userMessages[0].slice(0, 80)}...`)

    // v14.2.0: 重置 maxIterations（S_RESUME 用 roundMaxIterations 按轮覆盖，其余场景用默认 25）
    bridge.maxIterations = 25

    // v13.2.0: 场景前置 setup（如激活角色模板）
    if (scenario.setup) {
      try { await scenario.setup() } catch (e) { console.log(`   ⚠️ setup 失败: ${e.message}`) }
    }

    // ── 跨轮记忆：将累积的对话历史传给 Bridge ──
    // 这样下一个场景的模型能看到之前所有对话（包括助手回复中提到的文件内容）
    bridge.updateHistory([...sharedMessages])

    const startTime = Date.now()
    const result = await runScenarioViaBridge(scenario, bridge, sharedMessages)
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)

    const failures = checkResult(scenario, result, result.toolsCalled)

    if (failures.length === 0) {
      // v13.2.0: 显示上下文用量（验证压缩/清理机制）
      const ctxPct = result._estimatedContextTokens
        ? ` | 上下文≈${(result._estimatedContextTokens / 1000).toFixed(0)}K`
        : ''
      console.log(`   ✅ 通过 (${elapsed}s${ctxPct})`)
      passed++
    } else {
      console.log(`   ❌ 失败 (${elapsed}s, ${failures.length}项)`)
      failures.forEach(f => console.log(`      ${f}`))
      failed++
    }

    scenarioResults.push({ scenario, result, failures })

    // 将本轮对话加入累积历史（用户消息 + AI 回复）
    for (const um of scenario.userMessages) {
      sharedMessages.push({ role: 'user', content: um })
    }
    if (result.text && result.text.trim()) {
      sharedMessages.push({ role: 'assistant', content: result.text })
    }

    // 重置 Bridge 的全量 prompt 状态（让下一个场景也用 CORE prompt）
    try { bridge.resetFullPromptState?.() } catch { /* v13.x: method removed */ }

    // v13.2.0: 场景后置 teardown（如停用角色模板）
    if (scenario.teardown) {
      try { await scenario.teardown() } catch (e) { console.log(`   ⚠️ teardown 失败: ${e.message}`) }
    }
  }

  // 汇总
  console.log('\n' + '═'.repeat(60))
  console.log(`📊 ${passed}/${scenarios.length} 通过`)

  // v14 批处理(④数据收集): token 估算 vs 真实 usage 对比（tokenEstimation 精度回归参考，
  // 系数已校准为 CJK 1.2 / Latin 4.5——校准依据 scripts/measure-token-density.mjs 直接测量）
  console.log('\n📈 token 估算 vs 真实 input（④ 数据收集）')
  for (const { scenario, result } of scenarioResults) {
    const rounds = result._usageRounds || []
    if (rounds.length === 0) continue
    const estTotal = rounds.reduce((s, r) => s + r.estTokens, 0)
    const realTotal = rounds.reduce((s, r) => s + r.realInput, 0)
    const ratios = rounds.filter(r => r.ratio).map(r => r.ratio)
    const avgRatio = ratios.length ? ratios.reduce((s, r) => s + r, 0) / ratios.length : 0
    const estReal = realTotal > 0 ? (estTotal / realTotal).toFixed(2) : '-'
    console.log(`   ${scenario.id}: ${rounds.length} 轮 | 估算Σ=${estTotal} | 真实Σ=${realTotal} | 估/真=${estReal} (avgRatio=${avgRatio.toFixed(2)})`)
  }
  console.log('   口径警示: DeepSeek input_tokens 疑似只计缓存未命中部分，且估算错位一轮 → 估/真仅为数量级参考')

  // 展示生成的文件
  for (const name of ['test-project', '仙途', '剑道长生']) {
    const pp = resolve(PROJECTS_DIR, name)
    if (existsSync(pp)) {
      console.log(`\n📂 ${name}:`)
      for (const line of listTree(pp)) console.log(`   ${line}`)
    }
  }

  // 输出详细场景结果
  if (failed > 0) {
    console.log('\n📋 场景详情:')
    for (const { scenario, result, failures } of scenarioResults) {
      const status = failures.length === 0 ? '✅' : '❌'
      console.log(`   ${status} ${scenario.id} ${scenario.name}`)
      console.log(`      工具: [${result.toolsCalled.join(', ') || '无'}]`)
      console.log(`      回复: ${(result.text || '').slice(0, 150).replace(/\n/g, ' ')}...`)
      if (failures.length > 0) {
        for (const f of failures) console.log(`      ${f}`)
      }
    }
  }

  // 清理
  cleanup()

  console.log('═'.repeat(60) + '\n')
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(e => {
  console.error('💥 测试异常:', e)
  process.exit(1)
})
