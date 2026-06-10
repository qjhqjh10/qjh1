#!/usr/bin/env node
/**
 * v2.0 对话优化 — 直接 API 集成测试
 * 测试: 对话模式 / 混合模式 / 创作模式
 */
const API_KEY = 'sk-c9c30831df7243209435c60e811c879d'
const API_URL = 'https://api.deepseek.com/v1/chat/completions'
const MODEL = 'deepseek-v4-flash'

const CONVERSATION_PROMPT = `你是青剑，一个小说创作对话助手。

## 核心原则

你首先是对话伙伴。用户和你聊天、咨询、讨论创作问题时，直接用文字回复。

## 对话模式规则

- 分析/评价/建议 → 直接输出，不调任何工具
- 用户在对话中粘贴文字 → 直接分析对话内容，不读文件
- 不确定用户要不要操作文件 → 不操作，文字回复即可
- 用户明确说"保存"、"写入"、"创建文件" → 那是下一轮的事，本轮先用文字回答
- 混合请求: 用户既要求分析又要求保存 → 分析文本和工具调用在同一个响应中一起发出`

const CORE_PROMPT = `你是青剑，一个小说创作对话助手。

## 模式判断（收到用户消息后第一件事）

先判断用户意图，再决定行为：
- 纯对话/聊天/分析/评价 → 对话模式：纯文字回复，不调工具
- 明确要求操作文件 → 创作模式：进入写作规范手册
- 分析+操作: 用户既要求分析又要求保存 → 混合模式：先输出分析到对话，同时调用工具
- 不确定 → 默认对话模式

## 核心原则

你是对话伙伴，不是工具机器。只有在用户明确要求操作文件时，才调用工具。
- 对话模式 — 分析、总结、建议 → 直接输出
- 混合模式 — "分析并保存"、"看看然后存到..." → 文本分析和工具调用在同一个响应中一起发出

## 写作规范手册

### 6. 文本处理
分支A-0 混合模式: 用户在同一句话中既要求分析又要求保存 → 文本分析和工具调用在同一个响应中一起发出
分支A-纯分析: 直接分析→输出结果到对话
分支A2-分析并保存: 分析→输出结果→同时 create_file 保存文件
- 摘要: create_file("{项目名}/summaries/chapter{N}.md", 内容)
- 细纲: create_file("{项目名}/detailed_outline/chapter{N}.yaml", 内容)

## 文件操作
- 新建: create_file(file_path, content)
- 修改: 先 read_file 确认原文，再 edit_file`

async function test(name, prompt, userMessage, tools = undefined) {
  console.log(`\n━━━ ${name} ━━━`)
  console.log(`用户: ${userMessage.slice(0, 80)}...`)

  const messages = [
    { role: 'system', content: prompt },
    { role: 'user', content: userMessage },
  ]

  const body = { model: MODEL, messages, max_tokens: 1000, temperature: 0.3 }
  if (tools) body.tools = tools
  if (tools) body.tool_choice = 'auto'

  const start = Date.now()
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  const elapsed = ((Date.now() - start) / 1000).toFixed(1)

  const msg = data.choices?.[0]?.message
  const text = msg?.content || '(无文本)'
  const toolCalls = msg?.tool_calls || []
  const tokens = data.usage?.total_tokens || 0

  console.log(`⏱ ${elapsed}s | tokens: ${tokens} | tool_calls: ${toolCalls.length}`)
  console.log(`回复: ${text.slice(0, 200)}${text.length > 200 ? '...' : ''}`)
  if (toolCalls.length > 0) {
    console.log(`工具: ${toolCalls.map(t => t.function.name).join(', ')}`)
  }

  return { text, toolCalls, tokens }
}

async function main() {
  console.log('═══════════════════════════════════════')
  console.log(' v2.0 对话优化 — 集成测试')
  console.log(` 模型: ${MODEL}`)
  console.log('═══════════════════════════════════════')

  // Test 1: 纯对话 — 应该不调工具
  await test('T1: 纯对话分析',
    CONVERSATION_PROMPT,
    '你好，请你介绍一下自己叫什么名字，能做什么？')

  // Test 2: 对话中粘贴文字请求分析 — 应该不调工具
  await test('T2: 对话内容分析',
    CONVERSATION_PROMPT,
    `分析这段文字："青云宗演武场上，林逸面对首席弟子陈啸天的挑战。两人激战正酣时，林逸体内的剑魂突然觉醒，一道青芒冲天而起，震惊全场。" 这段写得怎么样？`)

  // Test 3: 创作模式 — 可能有工具调用
  await test('T3: 创作模式（含工具）',
    CORE_PROMPT,
    `在项目 1 中，分析下面这段文字的文风，然后创建风格模板保存到 style_templates 目录："夜幕降临，古城的青石板路泛着潮湿的光。林逸独自走在空荡的街巷中，脚步声在两侧高墙间回荡，如同某种古老的叩问。"`,
    [
      { type: 'function', function: { name: 'create_file', description: '创建文件', parameters: { type: 'object', properties: { file_path: { type: 'string' }, content: { type: 'string' } }, required: ['file_path', 'content'] } } },
    ])

  // Test 4: 混合模式 — 应该文本+工具同响应
  await test('T4: 混合模式（分析+保存）',
    CORE_PROMPT,
    `分析下面这段文字的写作特点，然后生成章节摘要保存到项目1的 summaries/chapter1.md："第1章·觉醒之日。林逸站在演武场中央，四周弟子的窃窃私语如潮水般涌来。他是最后一个出场的，因为所有人都知道，他的对手是首席弟子陈啸天。金丹期的威压如实质般碾压而来，林逸的膝盖微微弯曲，但他咬着牙，死死撑住。"`,
    [
      { type: 'function', function: { name: 'create_file', description: '创建文件', parameters: { type: 'object', properties: { file_path: { type: 'string' }, content: { type: 'string' } }, required: ['file_path', 'content'] } } },
    ])

  console.log('\n═══════════════════════════════════════')
  console.log(' 测试完成')
  console.log('═══════════════════════════════════════')
}

main().catch(e => { console.error('Error:', e.message); process.exit(1) })
