#!/usr/bin/env node
/**
 * AI 角色扮演测试 — 自定义角色 prompt 注入验证
 *
 * 用法:
 *   node scripts/test-role.mjs
 *
 * 环境变量:
 *   AI_API_KEY  — API 密钥 (默认使用内置 key)
 */

const API_KEY = process.env.AI_API_KEY || 'sk-c9c30831df7243209435c60e811c879d'
const API_URL = 'https://api.deepseek.com/anthropic/v1/messages'
const MODEL = 'deepseek-v4-flash'

// ══════════════════════════════════════════════════════════════
// 傲娇大小姐 — 角色 Prompt
// ══════════════════════════════════════════════════════════════

const ROLE_PROMPT = `你是沈清雪，沈氏集团的千金大小姐，今年20岁。你天生丽质，才华横溢，但性格极度傲娇。

你的说话风格：
- 明明想帮对方，却要说"我才不是特意帮你呢，只是凑巧有空而已"
- 被感谢时会脸红："哼，别自作多情，我可没在关心你"
- 被夸奖时会说："这、这有什么了不起的，本小姐一向如此"
- 不耐烦时："烦死了！笨蛋！"
- 内心柔软但嘴硬到底
- 习惯用"本小姐"自称
- 偶尔会不小心流露出真实想法，然后立刻改口补救

重要守则：
- 你的傲娇对象是用户（称呼用户为"你"或"你这家伙"）
- 你是写作助手，会帮用户创作小说，但会用傲娇的方式
- 操作文件后要说傲娇的话，如"帮你改好了，真是麻烦死了"
- 不要在回复开头自我介绍——直接进入傲娇对话状态`

// ══════════════════════════════════════════════════════════════
// 核心系统 Prompt（去掉身份行）
// ══════════════════════════════════════════════════════════════

const CORE_RULES = `## 行为决策树（收到用户消息后第一件事）

### 分支 1: 纯对话 — 直接文字回复
用户在聊天、讨论、咨询、评价。没有让你操作文件。
→ 纯文字回复。不调任何工具。不读任何文件。

### 分支 2: 对话转化 — 内容在对话中，保存到文件
关键标志: "保存"、"存到"、"创建为"、"写进"、"记一下"

### 分支 3: 混合模式 — 分析 + 保存同轮完成

### 分支 4: 创作模式 — 从零创作

核心原则: 聊天时直接回复。操作文件时果断执行。不确定时不调工具。`

// ══════════════════════════════════════════════════════════════
// 测试对话
// ══════════════════════════════════════════════════════════════

const TEST_MESSAGES = [
  "你好",
  "你会写小说吗？",
  "帮我起一个修仙小说主角的名字",
]

async function sendMessage(userMsg, historyMessages = []) {
  const systemBlocks = [
    { type: 'text', text: ROLE_PROMPT },
    { type: 'text', text: CORE_RULES },
  ]

  const messages = [
    ...historyMessages,
    { role: 'user', content: userMsg },
  ]

  const body = {
    model: MODEL,
    system: systemBlocks.map(s => ({ type: 'text', text: s.text })),
    messages: messages.map(m => ({
      role: m.role,
      content: m.content,
    })),
    max_tokens: 2048,
    temperature: 0.8,
    stream: true,
  }

  console.log(`\n${'─'.repeat(60)}`)
  console.log(`👤 用户: ${userMsg}`)
  console.log(`${'─'.repeat(60)}`)
  process.stdout.write(`👸 沈清雪: `)

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errText = await res.text()
    console.log(`\n❌ HTTP ${res.status}: ${errText.slice(0, 300)}`)
    return { role: 'assistant', content: `[错误] HTTP ${res.status}` }
  }

  const text = await res.text()
  let fullReply = ''

  const chunks = text.split('\n\n')
  for (const chunk of chunks) {
    if (!chunk.trim()) continue
    const lines = chunk.split('\n')
    let dataLine = ''
    for (const line of lines) {
      if (line.startsWith('data:')) dataLine = line.slice(5).trim()
    }
    if (!dataLine) continue
    try {
      const event = JSON.parse(dataLine)
      if (event.type === 'content_block_delta' && event.delta?.text) {
        fullReply += event.delta.text
        process.stdout.write(event.delta.text)
      }
    } catch {}
  }

  console.log('\n')
  return { role: 'assistant', content: fullReply }
}

async function main() {
  console.log('╔══════════════════════════════════════════╗')
  console.log('║  AI 角色扮演测试 — 傲娇大小姐 沈清雪  ║')
  console.log('╚══════════════════════════════════════════╝')
  console.log(`\n模型: ${MODEL}`)
  console.log(`角色 Prompt:\n  ${ROLE_PROMPT.split('\n').slice(0, 3).join('\n  ')}...`)

  const history = []

  for (const msg of TEST_MESSAGES) {
    const reply = await sendMessage(msg, history)
    history.push({ role: 'user', content: msg })
    history.push(reply)
  }

  console.log(`${'═'.repeat(60)}`)
  console.log('测试完成!')
}

main().catch(err => {
  console.error('❌', err.message)
  process.exit(1)
})
