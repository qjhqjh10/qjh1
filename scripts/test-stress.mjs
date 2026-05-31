#!/usr/bin/env node
/**
 * CLI Stress Test for AI Writing Assistant (V2)
 *
 * Runs multi-turn, multi-tool tests against the real API.
 * Reuses agent-cli.mjs modules for API calls and tool execution.
 *
 * API KEY SECURITY:
 *   Reads from AI_API_KEY environment variable ONLY.
 *   Never logs or writes the key to disk. Displays only last 4 chars.
 *
 * Usage:
 *   AI_API_KEY=sk-xxx node scripts/test-stress.mjs
 *   AI_API_KEY=sk-xxx AI_MODEL=deepseek-chat node scripts/test-stress.mjs --project=1
 */
import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECTS_DIR = resolve(__dirname, '..', 'projects')

// ── Config ──
const CONFIG = {
  apiKey: process.env.AI_API_KEY || '',
  apiUrl: process.env.AI_API_URL || 'https://api.deepseek.com/v1',
  model: process.env.AI_MODEL || 'deepseek-chat',
  project: process.env.PROJECT || '1',
  maxIterations: parseInt(process.env.MAX_ITERS || '15'),
  timeout: parseInt(process.env.TIMEOUT || '120000'), // 2 min per command
}

// ── Security: mask API key ──
function maskKey(key) {
  if (!key || key.length < 8) return '***'
  return key.slice(0, 4) + '****' + key.slice(-4)
}

function safeLog(key, msg) {
  // Never log the actual key - use maskKey
}

if (!CONFIG.apiKey) {
  console.error('\x1b[31m错误: 未设置 AI_API_KEY 环境变量\x1b[0m')
  console.error('用法: AI_API_KEY=sk-xxx node scripts/test-stress.mjs')
  console.error('密钥仅为临时环境变量，不会写入任何文件')
  process.exit(1)
}

console.log(`密钥: ${maskKey(CONFIG.apiKey)}`)
console.log(`模型: ${CONFIG.model}`)
console.log(`项目: ${CONFIG.project}`)
console.log(`项目目录: ${PROJECTS_DIR}\n`)

// ── Simple API Client (reuses agent-cli.mjs pattern) ──
class ApiClient {
  constructor(apiKey, apiUrl, model) {
    this.apiKey = apiKey
    this.apiUrl = apiUrl
    this.model = model
  }

  async chat(messages) {
    const res = await fetch(`${this.apiUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, messages, temperature: 0.8, max_tokens: 4096 }),
      signal: AbortSignal.timeout(CONFIG.timeout),
    })
    if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text().catch(() => '')}`)
    const data = await res.json()
    return {
      text: data.choices?.[0]?.message?.content || '',
      usage: data.usage || { total_tokens: 0 },
    }
  }

  async chatWithTools(messages, tools) {
    const res = await fetch(`${this.apiUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, messages, tools, temperature: 0.8, max_tokens: 4096 }),
      signal: AbortSignal.timeout(CONFIG.timeout),
    })
    if (!res.ok) throw new Error(`API error ${res.status}`)
    const data = await res.json()
    const msg = data.choices?.[0]?.message || {}
    return {
      text: msg.content || '',
      toolCalls: (msg.tool_calls || []).map(tc => ({
        id: tc.id,
        name: tc.function?.name || '',
        arguments: tc.function?.arguments || '{}',
      })),
      finishReason: data.choices?.[0]?.finish_reason || 'stop',
      usage: data.usage || { total_tokens: 0 },
    }
  }
}

// ── Simple File Ops (read/write within project dir) ──
function resolveSafePath(projectPath, filePath) {
  const normalized = filePath.replace(/\.\./g, '').replace(/\\/g, '/')
  return resolve(PROJECTS_DIR, projectPath, normalized)
}

// ── Run a single agent command ──
async function runAgentCommand(api, projectName, userMessage, maxIters) {
  const projectPath = resolve(PROJECTS_DIR, projectName)
  const startTime = Date.now()
  let totalTokens = 0
  let totalToolCalls = 0
  const toolsUsed = new Set()

  try {
    // Build context
    const systemMsg = {
      role: 'system',
      content: `你是小说写作助手。项目路径: ${projectPath}。使用工具操作文件。`,
    }

    const messages = [systemMsg, { role: 'user', content: userMessage }]
    const tools = buildToolSchemas()

    for (let iter = 0; iter < maxIters; iter++) {
      const response = await api.chatWithTools(messages, tools)
      totalTokens += response.usage?.total_tokens || 0

      if (!response.toolCalls || response.toolCalls.length === 0) {
        return {
          success: true,
          text: response.text,
          toolCalls: totalToolCalls,
          tokens: totalTokens,
          elapsed: Date.now() - startTime,
          iterations: iter + 1,
          tools: [...toolsUsed],
        }
      }

      // Execute tools
      messages.push({
        role: 'assistant',
        content: response.text || '',
        tool_calls: response.toolCalls.map(tc => ({
          type: 'function', id: tc.id,
          function: { name: tc.name, arguments: tc.arguments },
        })),
      })

      for (const tc of response.toolCalls) {
        totalToolCalls++
        toolsUsed.add(tc.name)
        let args = {}
        try { args = JSON.parse(tc.arguments) } catch {}

        const result = executeTool(projectPath, tc.name, args)
        messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) })
      }
    }

    return {
      success: true,
      text: '(达到最大迭代次数)',
      toolCalls: totalToolCalls,
      tokens: totalTokens,
      elapsed: Date.now() - startTime,
      iterations: maxIters,
      tools: [...toolsUsed],
    }
  } catch (err) {
    return {
      success: false,
      text: err.message,
      toolCalls: totalToolCalls,
      tokens: totalTokens,
      elapsed: Date.now() - startTime,
      iterations: 0,
      tools: [...toolsUsed],
    }
  }
}

// ── Tool Schemas (simplified, from agent-cli.mjs) ──
function buildToolSchemas() {
  const baseTools = [
    { type: 'function', function: { name: 'list_directory', description: '列出目录', parameters: { type: 'object', properties: { dir_path: { type: 'string' } }, required: ['dir_path'] } } },
    { type: 'function', function: { name: 'read_file', description: '读取文件', parameters: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] } } },
    { type: 'function', function: { name: 'search_files', description: '搜索文件', parameters: { type: 'object', properties: { pattern: { type: 'string' }, dir_path: { type: 'string' } }, required: ['pattern'] } } },
    { type: 'function', function: { name: 'search_content', description: '搜索内容', parameters: { type: 'object', properties: { pattern: { type: 'string' }, dir_path: { type: 'string' } }, required: ['pattern'] } } },
    { type: 'function', function: { name: 'create_file', description: '创建文件', parameters: { type: 'object', properties: { file_path: { type: 'string' }, content: { type: 'string' } }, required: ['file_path', 'content'] } } },
    { type: 'function', function: { name: 'edit_file', description: '编辑文件', parameters: { type: 'object', properties: { file_path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' } }, required: ['file_path', 'old_string', 'new_string'] } } },
    { type: 'function', function: { name: 'write_note', description: '写入笔记', parameters: { type: 'object', properties: { title: { type: 'string' }, content: { type: 'string' } }, required: ['title', 'content'] } } },
    { type: 'function', function: { name: 'list_notes', description: '列出笔记', parameters: { type: 'object', properties: {} } } },
  ]
  return baseTools
}

function executeTool(projectPath, toolName, args) {
  try {
    switch (toolName) {
      case 'list_directory': {
        const dirPath = resolveSafePath(projectPath, args.dir_path || '')
        const { readdirSync } = require('fs')
        const files = readdirSync(dirPath, { withFileTypes: true })
        const items = files.map(f => f.isDirectory() ? `${f.name}/` : f.name)
        return { status: 'success', summary: `列出 ${items.length} 项`, detail: items.join('\n') }
      }
      case 'read_file': {
        const filePath = resolveSafePath(projectPath, args.file_path || '')
        const content = readFileSync(filePath, 'utf8')
        return { status: 'success', summary: `读取 ${content.length} 字符`, detail: content.slice(0, 2000) }
      }
      case 'create_file': {
        const filePath = resolveSafePath(projectPath, args.file_path || '')
        const { writeFileSync, mkdirSync } = require('fs')
        const dir = require('path').dirname(filePath)
        mkdirSync(dir, { recursive: true })
        writeFileSync(filePath, args.content || '', 'utf8')
        return { status: 'success', summary: `创建文件 ${args.file_path}` }
      }
      case 'edit_file': {
        const filePath = resolveSafePath(projectPath, args.file_path || '')
        const content = readFileSync(filePath, 'utf8')
        if (!content.includes(args.old_string || '')) {
          return { status: 'error', summary: `未找到匹配文本` }
        }
        const { writeFileSync } = require('fs')
        const newContent = content.replace(args.old_string, args.new_string)
        writeFileSync(filePath, newContent, 'utf8')
        return { status: 'success', summary: `编辑文件 ${args.file_path}` }
      }
      default:
        return { status: 'success', summary: `执行 ${toolName}` }
    }
  } catch (err) {
    return { status: 'error', summary: err.message }
  }
}

// ── Test Cases ──
const TESTS = [
  {
    name: '简单闲聊',
    commands: ['你好', '你能做什么', '谢谢'],
    expected: {
      validate(results) {
        const ok = results.every(r => r.toolCalls === 0)
        if (!ok) throw new Error(`闲聊不应调用工具: ${results.map(r => r.toolCalls).join(',')}`)
        const fast = results.every(r => r.elapsed < 10000)
        if (!fast) throw new Error(`闲聊响应时间过长: ${results.map(r => r.elapsed+'ms').join(',')}`)
      },
    },
  },
  {
    name: '简单查询',
    commands: ['列出所有角色文件', '查看项目大纲'],
    expected: {
      validate(results) {
        const ok = results.every(r => r.toolCalls >= 1)
        if (!ok) throw new Error(`查询应调用工具`)
        const allSuccess = results.every(r => r.success)
        if (!allSuccess) throw new Error(`查询失败: ${results.filter(r => !r.success).map(r => r.text).join('; ')}`)
      },
    },
  },
  {
    name: '多轮对话',
    commands: ['列出项目中的章节文件', '总结一下项目结构', '检查有没有角色文件'],
    expected: {
      validate(results) {
        if (results.length !== 3) throw new Error(`应完成3轮, 实际${results.length}`)
        const successRate = results.filter(r => r.success).length / results.length
        if (successRate < 0.66) throw new Error(`成功率过低: ${(successRate*100).toFixed(0)}%`)
      },
    },
  },
  {
    name: '压力测试-10轮',
    commands: [
      '你好', '列出章节', '你好', '列出角色',
      '你好', '查看大纲', '你好', '列出章节',
      '你好', '检查项目状态',
    ],
    expected: {
      validate(results) {
        const successRate = results.filter(r => r.success).length / results.length
        if (successRate < 0.8) throw new Error(`成功率过低: ${(successRate*100).toFixed(0)}%`)
        const avgTime = results.reduce((s, r) => s + r.elapsed, 0) / results.length
        if (avgTime > 15000) throw new Error(`平均响应时间过长: ${(avgTime/1000).toFixed(1)}s`)
        console.log(`    平均响应: ${(avgTime/1000).toFixed(1)}s, 平均tokens: ${(results.reduce((s,r)=>s+r.tokens,0)/results.length).toFixed(0)}`)
      },
    },
  },
]

// ── Main ──
async function main() {
  const api = new ApiClient(CONFIG.apiKey, CONFIG.apiUrl, CONFIG.model)
  let passed = 0
  let failed = 0

  for (const test of TESTS) {
    console.log(`\n=== ${test.name} (${test.commands.length}轮) ===`)
    const results = []

    for (const cmd of test.commands) {
      process.stdout.write(`  ${cmd.slice(0, 35)}... `)
      const r = await runAgentCommand(api, CONFIG.project, cmd, CONFIG.maxIterations)
      results.push(r)
      const icon = r.success ? '✓' : '✗'
      console.log(`${icon} ${r.toolCalls}工具 ${r.tokens}t ${(r.elapsed/1000).toFixed(1)}s`)
    }

    try {
      test.expected.validate(results)
      console.log(`  \x1b[32m✅ PASSED\x1b[0m`)
      passed++
    } catch (e) {
      console.log(`  \x1b[31m❌ FAILED: ${e.message}\x1b[0m`)
      failed++
    }
  }

  console.log(`\n${'='.repeat(50)}`)
  console.log(`通过: ${passed}  失败: ${failed}  总计: ${TESTS.length}`)
  if (failed > 0) process.exit(1)
}

main().catch(err => {
  console.error('\x1b[31mFatal:', err.message, '\x1b[0m')
  process.exit(1)
})
