#!/usr/bin/env node
// CLI test: sends one message to the AI agent and reports tool usage + tokens.
// Requires the Electron app to be running (connects via IPC).
// Usage: node scripts/test-chat.mjs "请你检查世界观和故事剧情"

import { createRequire } from 'module'
const require = createRequire(import.meta.url)

const { OpenAI } = await import('openai')

// Read encrypted config
const fs = await import('fs')
const config = JSON.parse(fs.readFileSync('C:/Users/qjh36/AppData/Roaming/ai-writing-qingjian/config.json', 'utf-8'))
const c = config.configs.find(x => x.id === config.activeConfigId) || config.configs[0]

if (!c) { console.error('No config found'); process.exit(1) }

// Try to decrypt with safeStorage if available
let apiKey = c.apiKey
try {
  const { safeStorage } = await import('electron')
  if (safeStorage.isEncryptionAvailable() && c.encrypted) {
    apiKey = safeStorage.decryptString(Buffer.from(c.apiKey, 'utf-8'))
  }
} catch {
  // Not in Electron — try reading decrypted key from env or file
  const envKey = process.env.DEEPSEEK_API_KEY
  if (envKey) { apiKey = envKey }
  else {
    console.error('Cannot decrypt API key outside Electron. Set DEEPSEEK_API_KEY env var.')
    process.exit(1)
  }
}

const userMessage = process.argv[2] || '你好'

// Read MemoryIndex output for this test
let projectIndex = ''
try {
  const { buildMemoryIndex } = await import('../src/agent/context/MemoryIndex.js')
  projectIndex = await buildMemoryIndex('1')  // project "1"
} catch { /* best effort */ }

const systemPrompt = `你是"青剑"，AI小说创作助手。直接操作项目文件。

## 核心规则
1. 项目索引已告诉你所有文件路径。需要读文件时直接用 read_file 读。
2. 上下文已有=不重读。创建成功=不验证。
3. 需要读多个文件时一次性全部 read_file。
4. 简洁报告。
5. 任务完成立即输出回复。

## 项目文件索引 — 直接 read_file 即可，无需探索
${projectIndex || '项目索引未加载'}`

console.log(`\n📤 发送: "${userMessage}"`)
console.log(`📏 系统提示词: ${systemPrompt.length} 字符 (~${Math.round(systemPrompt.length / 1.8)} tokens)\n`)

const client = new OpenAI({ apiKey, baseURL: c.apiUrl || 'https://api.deepseek.com/v1', timeout: 120000, maxRetries: 1 })

const start = Date.now()
const resp = await client.chat.completions.create({
  model: c.model,
  messages: [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ],
  temperature: c.temperature || 0.8,
  max_tokens: c.maxTokens || 4096,
})

const elapsed = ((Date.now() - start) / 1000).toFixed(1)
const usage = resp.usage
const content = resp.choices[0]?.message?.content || ''
const toolCalls = resp.choices[0]?.message?.tool_calls || []

console.log(`⏱  耗时: ${elapsed}s`)
console.log(`💰 Token: 入${usage?.prompt_tokens?.toLocaleString() || '?'} | 出${usage?.completion_tokens?.toLocaleString() || '?'} | 总${usage?.total_tokens?.toLocaleString() || '?'}`)
if (usage?.prompt_cache_hit_tokens) console.log(`💾 缓存命中: ${usage.prompt_cache_hit_tokens.toLocaleString()} tokens (90% discount)`)

if (toolCalls.length > 0) {
  console.log(`\n🔧 工具调用 (${toolCalls.length}):`)
  for (const tc of toolCalls) {
    try {
      const args = JSON.parse(tc.function?.arguments || '{}')
      console.log(`  - ${tc.function?.name}(${Object.entries(args).map(([k,v]) => `${k}=${String(v).slice(0,40)}`).join(', ')})`)
    } catch { console.log(`  - ${tc.function?.name}`) }
  }
} else {
  console.log(`🔧 工具调用: 0`)
}

console.log(`\n📥 回复 (${content.length} 字符):`)
console.log(content.slice(0, 500))
if (content.length > 500) console.log(`... 还有 ${content.length - 500} 字符`)
