#!/usr/bin/env node
/**
 * v3 最终验证测试 — 11 场景，含 token 统计
 * 测试行为决策树 4 分支 + 7 个边界场景
 */
const API_KEY = 'sk-c9c30831df7243209435c60e811c879d'
const API_URL = 'https://api.deepseek.com/v1/chat/completions'
const MODEL = 'deepseek-v4-flash'

// ── v3 统一 Prompt（与 V4SystemPrompt.ts 一致）──
const UNIFIED_PROMPT = `你是青剑，一个小说创作对话助手。

## 行为决策树（收到用户消息后第一件事）

### 分支 1: 纯对话 — 直接文字回复
用户在聊天、讨论、咨询、评价。没有让你操作文件。
→ 纯文字回复。不调任何工具。不读任何文件。
→ 写作规范手册中的流程不要进入。
  例: "你好"、"这段怎么样？"、"帮我想一个反派角色"、"元婴期怎么设定？"

### 分支 2: 对话转化 — 内容在对话中，保存到文件
用户给了你内容（对话中），要求保存为文件。
关键标志: "保存"、"存到"、"创建为"、"写进"、"记录下来"
→ 内容已在对话中，不需要 read_file 读内容本身。
→ 快速确认目标文件状态（list_directory 或 read_file 看一眼）。
→ 然后立即写入: 新建→create_file，追加→edit_file末尾，覆盖→edit_file FULL_REPLACE。
→ 确认和写入紧接完成，不要在 read 之后停下来等用户。
  例: "把刚才的创意存到 plot.md" → read_file plot.md → 立刻 edit_file 追加
  例: "创建角色卡" → list_directory characters/ → 立刻 create_file

### 分支 3: 混合模式 — 分析 + 保存同轮完成
用户粘贴了文字，要求分析并保存。
→ 在同一个响应中同时做两件事：输出分析文字 + 调用工具保存。
→ 不要分成两轮——分析文字和 create_file 放在同一个 message 中。
  例: "分析这段，生成摘要保存" → text="分析…" + create_file 同轮

### 分支 4: 创作模式 — 从零创作
用户要求创作新内容（写章节、填大纲、批量生成），内容需要你从零构思。
→ 进入写作规范手册流程: 读参考文件 → 读格式模板 → 创建/编辑文件。
→ 读完参考后立即写，不要在中间停顿。
  例: "写第3章"、"把大纲的所有Tab填充完整"

### 快速判断
- 消息中有"保存/写入/创建/存到"吗？有 → 分支2或3。没有 → 分支1或4。
- 内容已在对话里？是 → 分支2/3。需要从零创作？是 → 分支4。
- 不确定 → 默认分支1，纯文字回复。

## 核心原则
你是对话伙伴，不是工具机器。
- 闲聊、讨论、咨询 → 纯文本回复（分支1）
- 用户要求"保存"、"创建为" → 对话转化或混合（分支2/3）
- 不确定要不要调工具 → 不调（默认分支1）

## 工具使用指南
- 调了 read_file 后 → 立即决定下一步，不要停在"已读取"状态
- 修改已有文件 → 先 read_file 确认，再 edit_file
- 创建新文件 → 直接 create_file，不需要先读

## ━━━ 写作规范手册（分支4专用）━━━
### 文本处理
分支A-纯分析: 对话内容直接分析→输出。用户粘贴文字不需read_file。
分支A2-分析并保存: 分析→输出→同时create_file保存。
分支A3-提取细纲: 读章节→读模板→输出+保存到detailed_outline/chapter{N}.yaml。

### 章节创作
### 角色管理: 15字段YAML, role=男主|女主|男配|女配|反派|其他
### 大纲创作
### 知识库

## 文件路径
- 角色: {项目名}/characters/中文名.yaml
- 章节: {项目名}/chapters/chapter{N}.txt
- 细纲: {项目名}/detailed_outline/chapter{N}.yaml
- 摘要: {项目名}/summaries/chapter{N}.md
- 笔记: ../notes/文件名.md
- 大纲: {项目名}/outline/plot.md, worldbuilding.md`

const PROMPT_TOKENS = Math.round(UNIFIED_PROMPT.length / 2.5) // rough estimate

const TOOLS = [
  { type: 'function', function: { name: 'create_file', description: '创建文件', parameters: { type: 'object', properties: { file_path: { type: 'string' }, content: { type: 'string' } }, required: ['file_path', 'content'] } } },
  { type: 'function', function: { name: 'read_file', description: '读取文件', parameters: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] } } },
  { type: 'function', function: { name: 'edit_file', description: '编辑文件', parameters: { type: 'object', properties: { file_path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' } }, required: ['file_path', 'old_string', 'new_string'] } } },
  { type: 'function', function: { name: 'list_directory', description: '列出目录', parameters: { type: 'object', properties: { dir_path: { type: 'string' } } } } },
]

async function call(userMsg, history = []) {
  const msgs = [{ role: 'system', content: UNIFIED_PROMPT }]
  for (const h of history) msgs.push({ role: h.role, content: h.content })
  msgs.push({ role: 'user', content: userMsg })
  const body = { model: MODEL, messages: msgs, tools: TOOLS, tool_choice: 'auto', max_tokens: 1000, temperature: 0.3 }
  const start = Date.now()
  const r = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` }, body: JSON.stringify(body) })
  const d = await r.json()
  const msg = d.choices?.[0]?.message
  const tc = msg?.tool_calls || []
  return {
    text: msg?.content || '',
    tools: tc,
    toolNames: tc.map(t => t.function.name),
    tokens: d.usage?.total_tokens || 0,
    promptTokens: d.usage?.prompt_tokens || 0,
    completionTokens: d.usage?.completion_tokens || 0,
    time: ((Date.now() - start) / 1000).toFixed(1),
  }
}

const chapterSample = `林逸站在演武场中央，四周弟子的窃窃私语如潮水般涌来。他是最后一个出场的——他的对手是首席弟子陈啸天。金丹期的威压如实质般碾压而来，林逸咬着牙死死撑住。就在所有人以为他要跪下时，一道青芒从他丹田炸开——沉睡的上古剑魂觉醒了。全场震惊。`

async function main() {
  console.log('═══════════════════════════════════════')
  console.log(' v3 最终验证测试 — 11 场景')
  console.log(` 模型: ${MODEL}`)
  console.log(` 统一 Prompt 约: ${PROMPT_TOKENS} tokens (${UNIFIED_PROMPT.length} chars)`)
  console.log('═══════════════════════════════════════')

  const results = []

  // ═══ 分支1: 纯对话 (3 scenarios) ═══
  console.log('\n── 分支1: 纯对话 ──')

  const t1 = await call('你好，请你用一句话介绍一下自己。')
  results.push({ id: 'T1-寒暄', branch: 1, ...t1 })

  const t2 = await call(`分析这段文字："${chapterSample}" 这段写得怎么样？`)
  results.push({ id: 'T2-分析对话内容', branch: 1, ...t2 })

  const t3 = await call('帮我想一个修仙小说里的反派角色，要有深度。')
  results.push({ id: 'T3-创意构思', branch: 1, ...t3 })

  // ═══ 分支2: 对话转化 (2 scenarios) ═══
  console.log('\n── 分支2: 对话转化 ──')

  const t4 = await call('把刚才讨论的反派角色创意，创建为项目1的角色卡文件。', [
    { role: 'assistant', content: t3.text },
  ])
  results.push({ id: 'T4-对话→角色卡', branch: 2, ...t4 })

  const t5 = await call('把这个设定追加到项目1的大纲 plot.md 文件里：主角的剑魂其实是来自未来的他自己。', [])
  results.push({ id: 'T5-对话→追加大纲', branch: 2, ...t5 })

  // ═══ 分支3: 混合模式 (2 scenarios) ═══
  console.log('\n── 分支3: 混合模式 ──')

  const t6 = await call(`分析下面这段文字的写作特点，然后生成章节摘要保存到项目1的 summaries/chapter1.md："${chapterSample}"`)
  results.push({ id: 'T6-混合·分析+摘要', branch: 3, ...t6 })

  const t7 = await call(`分析这段文字的剧情结构，然后生成细纲保存到项目1的 detailed_outline/chapter1.yaml："${chapterSample}"`)
  results.push({ id: 'T7-混合·分析+细纲', branch: 3, ...t7 })

  // ═══ 分支4: 创作模式 (1 scenario) ═══
  console.log('\n── 分支4: 创作模式 ──')

  const t8 = await call('帮我在项目1创作第1章的内容，主角林逸是一名剑修，在宗门大比中觉醒剑魂。把正文保存到 chapters/chapter1.txt。', [])
  results.push({ id: 'T8-创作·写章节', branch: 4, ...t8 })

  // ═══ 边界场景 (3 scenarios) ═══
  console.log('\n── 边界场景 ──')

  const t9 = await call('这个想法不错！回头可以整理一下存到笔记里。')
  results.push({ id: 'T9-边界·未来计划', branch: '1(兜底)', ...t9 })

  const t10 = await call('今天天气真好，适合写小说。')
  results.push({ id: 'T10-边界·纯闲聊', branch: '1(兜底)', ...t10 })

  // 模拟修正: 先创建一个角色，再要求修改
  const t11a = await call('在项目1创建角色卡文件：角色名叫王五，男配。')
  const t11b = await call('不对，王五应该改成男主。', [
    { role: 'assistant', content: t11a.text },
  ])
  results.push({ id: 'T11-边界·用户修正', branch: '2(修正)', ...t11b })

  // ═══ 汇总 ═══
  console.log('\n═══════════════════════════════════════')
  console.log('                   结 果 汇 总')
  console.log('═══════════════════════════════════════')

  console.log(`\n| 场景 | 分支 | 工具 | tokens | 文本 | 判定 |`)
  console.log('|------|:----:|:----:|:-----:|:----:|------|')

  let totalTokens = 0, totalPrompt = 0, totalCompletion = 0
  for (const r of results) {
    const hasText = r.text.length > 0 ? '✅' : '❌'
    const toolStr = r.tools.length === 0 ? '0' : `${r.tools.length}(${r.toolNames.slice(0,2).join(',')})`
    let verdict = ''
    if (r.branch === 1 || r.branch === '1(兜底)') {
      verdict = r.tools.length === 0 ? '✅' : '⚠️ 多了工具'
    } else if (r.branch === 2 || r.branch === '2(修正)') {
      verdict = r.tools.length >= 1 ? '✅' : '❌ 少了工具'
    } else if (r.branch === 3) {
      verdict = (hasText === '✅' && r.tools.length >= 1) ? '✅' : '⚠️ 缺文本或工具'
    } else if (r.branch === 4) {
      verdict = r.tools.length >= 1 ? '✅' : '❌ 缺工具'
    }
    console.log(`| ${r.id} | ${r.branch} | ${toolStr} | ${r.tokens} | ${hasText} | ${verdict} |`)
    totalTokens += r.tokens
    totalPrompt += r.promptTokens
    totalCompletion += r.completionTokens
  }

  const pass = results.filter(r => {
    if (r.branch === 1 || r.branch === '1(兜底)') return r.tools.length === 0
    if (r.branch === 3) return r.text.length > 0 && r.tools.length >= 1
    return r.tools.length >= 1
  })
  console.log(`\n通过: ${pass.length}/${results.length}`)
  console.log(`总 tokens: ${totalTokens} | prompt: ${totalPrompt} | completion: ${totalCompletion}`)
  console.log(`每场景平均: ${Math.round(totalTokens/results.length)} tokens`)
  console.log(`统一 Prompt 大小: ${UNIFIED_PROMPT.length} chars ≈ ${PROMPT_TOKENS} tokens`)

  // 显示 Prompt 中各部分的字符占比
  const treeEnd = UNIFIED_PROMPT.indexOf('## 核心原则')
  const handbookStart = UNIFIED_PROMPT.indexOf('## ━━━ 写作规范手册')
  const treeSize = treeEnd // 决策树部分
  const coreSize = handbookStart - treeEnd // 核心原则+工具指南
  const handbookSize = UNIFIED_PROMPT.length - handbookStart // 写作手册
  console.log(`\nPrompt 结构: 决策树 ${Math.round(treeSize/UNIFIED_PROMPT.length*100)}% | 核心原则 ${Math.round(coreSize/UNIFIED_PROMPT.length*100)}% | 写作手册 ${Math.round(handbookSize/UNIFIED_PROMPT.length*100)}%`)
  console.log(`决策树部分约: ${Math.round(treeSize/2.5)} tokens (占总 prompt ${Math.round(treeSize/UNIFIED_PROMPT.length*100)}%)`)
}

main().catch(e => { console.error(e.message); process.exit(1) })
