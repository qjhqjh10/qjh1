#!/usr/bin/env node
/**
 * v2.0 混合模式专项测试 — 验证「分析文本 + 工具调用」在同一响应中
 */
const API_KEY = 'sk-c9c30831df7243209435c60e811c879d'
const API_URL = 'https://api.deepseek.com/v1/chat/completions'
const MODEL = 'deepseek-v4-flash'

const TOOLS = [
  { type: 'function', function: { name: 'create_file', description: '创建文件并写入内容', parameters: { type: 'object', properties: { file_path: { type: 'string', description: '相对路径，如 项目名/summaries/chapter1.md' }, content: { type: 'string', description: '文件内容' } }, required: ['file_path', 'content'] } } },
]

const CORE_PROMPT = `你是青剑，小说创作对话助手。

## 模式判断
- 纯分析/评价 → 对话模式：纯文字回复，不调工具
- 分析+操作 → 混合模式：文本分析和工具调用在同一个响应中一起发出
- 纯文件操作 → 创作模式：按写作规范手册执行

## 混合模式规则
用户说"分析并保存"、"看看然后存到..."时：
① 先在 content 字段输出分析文本
② 同时在 tool_calls 字段调用 create_file
③ content 和 tool_calls 在同一个响应中一起返回

## 文件路径速查
- 摘要: {项目名}/summaries/chapter{N}.md
- 细纲: {项目名}/detailed_outline/chapter{N}.yaml
- 风格模板: ../style_templates/模板名.yaml`

async function call(prompt, userMsg, expectHybrid = false) {
  const body = { model: MODEL, messages: [{ role: 'system', content: prompt }, { role: 'user', content: userMsg }], tools: TOOLS, tool_choice: 'auto', max_tokens: 1200, temperature: 0.3 }
  const r = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` }, body: JSON.stringify(body) })
  const d = await r.json()
  const msg = d.choices?.[0]?.message
  const hasText = !!(msg?.content?.trim())
  const hasTools = !!(msg?.tool_calls?.length)
  const isHybrid = hasText && hasTools  // 混合模式：同时有文本和工具

  return { text: msg?.content || '', tools: msg?.tool_calls || [], isHybrid, tokens: d.usage?.total_tokens }
}

async function main() {
  console.log('═══════════════════════════════════════')
  console.log(' 混合模式专项测试')
  console.log(` 模型: ${MODEL}`)
  console.log('═══════════════════════════════════════')

  const chapterText = `"第1章·觉醒之日。林逸站在演武场中央，四周弟子的窃窃私语如潮水般涌来。他是最后一个出场的，因为所有人都知道，他的对手是首席弟子陈啸天。金丹期的威压如实质般碾压而来，林逸的膝盖微微弯曲，但他咬着牙，死死撑住。就在所有人以为他要跪下时，一道青芒从他丹田炸开——沉睡的上古剑魂，觉醒了。"`

  // ═══ 对比测试 ═══

  // 对比A: 纯分析（应无工具调用）
  const a = await call(CORE_PROMPT, `分析这段文字："${chapterText}" 的写作手法，怎么样？`)
  console.log(`\n[A] 纯分析`)
  console.log(`   文本: ${a.text ? '✅ ' + a.text.slice(0, 60) + '...' : '❌ 空'}`)
  console.log(`   工具: ${a.tools.length} 个${a.tools.length ? ' (' + a.tools.map(t => t.function.name).join(',') + ')' : ''}`)
  console.log(`   混合: ${a.isHybrid ? '✅ 文本+工具同响应' : (a.text ? '纯文本' : '纯工具')}`)

  // 对比B: 纯创作（应只有工具，可能无文本）
  const b = await call(CORE_PROMPT, `在项目1创建文件 summaries/chapter1.md，内容是"测试摘要"`)
  console.log(`\n[B] 纯创作（不要求分析）`)
  console.log(`   文本: ${b.text ? '✅ ' + b.text.slice(0, 60) + '...' : '❌ 空'}`)
  console.log(`   工具: ${b.tools.length} 个${b.tools.length ? ' (' + b.tools.map(t => t.function.name).join(',') + ')' : ''}`)
  console.log(`   混合: ${b.isHybrid ? '✅ 文本+工具同响应' : (b.text ? '纯文本' : '纯工具')}`)

  // ═══ 混合模式专项 ═══

  // 混合C: 分析+保存摘要 — 应同时有文本和工具
  console.log(`\n[C] 混合: 分析并保存摘要`)
  console.log(`   请求: "分析这段文字，然后生成章节摘要保存到项目1的 summaries/chapter1.md"`)
  const c = await call(CORE_PROMPT, `分析下面这段文字的写作特点，然后生成章节摘要保存到项目1的 summaries/chapter1.md："${chapterText}"`)
  console.log(`   文本: ${c.text ? '✅ ' + c.text.slice(0, 80) + '...' : '❌ 空'}`)
  console.log(`   工具: ${c.tools.length} 个${c.tools.length ? ' (' + c.tools.map(t => t.function.name).join(',') + ')' : ''}`)
  console.log(`   混合: ${c.isHybrid ? '✅ 文本+工具同响应' : (c.text ? '❌ 纯文本（缺少工具调用）' : '❌ 纯工具（缺少分析文本）')}`)
  if (c.tools.length > 0) {
    const args = JSON.parse(c.tools[0].function.arguments || '{}')
    console.log(`   保存路径: ${args.file_path || '(未指定)'}`)
  }

  // 混合D: 分析+生成细纲
  console.log(`\n[D] 混合: 分析并生成细纲`)
  console.log(`   请求: "分析这章的节奏和结构，生成细纲保存到 detailed_outline"`)
  const d2 = await call(CORE_PROMPT, `分析下面这章的节奏和情节结构，然后生成细纲YAML保存到项目1的 detailed_outline/chapter1.yaml："${chapterText}"`)
  console.log(`   文本: ${d2.text ? '✅ ' + d2.text.slice(0, 80) + '...' : '❌ 空'}`)
  console.log(`   工具: ${d2.tools.length} 个${d2.tools.length ? ' (' + d2.tools.map(t => t.function.name).join(',') + ')' : ''}`)
  console.log(`   混合: ${d2.isHybrid ? '✅ 文本+工具同响应' : (d2.text ? '❌ 纯文本（缺少工具调用）' : '❌ 纯工具（缺少分析文本）')}`)
  if (d2.tools.length > 0) {
    const args = JSON.parse(d2.tools[0].function.arguments || '{}')
    console.log(`   保存路径: ${args.file_path || '(未指定)'}`)
  }

  // 混合E: 对话模式下收到混合请求（兜底）
  console.log(`\n[E] 混合: 对话模式下收到"分析并保存"请求`)
  const CONV_PROMPT = `你是青剑，小说创作对话助手。你首先是对话伙伴。分析/评价→直接输出。混合请求: 用户既要求分析又要求保存 → 分析文本和工具调用在同一个响应中一起发出。`
  const e = await call(CONV_PROMPT, `分析下面这段文字，然后保存到项目1的 summaries/chapter1.md："${chapterText}"`)
  console.log(`   文本: ${e.text ? '✅ ' + e.text.slice(0, 80) + '...' : '❌ 空'}`)
  console.log(`   工具: ${e.tools.length} 个${e.tools.length ? ' (' + e.tools.map(t => t.function.name).join(',') + ')' : ''}`)
  console.log(`   混合: ${e.isHybrid ? '✅ 文本+工具同响应' : (e.text ? '纯文本（可能遗漏工具）' : '纯工具（无分析）')}`)

  // ─── 汇总 ───
  console.log(`\n═══════════════════════════════════════`)
  const all = [a, b, c, d2, e]
  const hybrid = all.filter(x => x.isHybrid)
  const pureText = all.filter(x => x.text && !x.tools.length)
  const pureTool = all.filter(x => !x.text && x.tools.length)
  console.log(` 混合模式: ${hybrid.length}/5 (应≥2: C,D)`)
  console.log(` 纯文本:   ${pureText.length}/5 (应=1: A)`)
  console.log(` 纯工具:   ${pureTool.length}/5`)
  console.log(` 判定: ${hybrid.length >= 2 && pureText.length >= 1 ? '✅ 通过' : '⚠️ 异常'}`)
  console.log(`═══════════════════════════════════════`)
}

main().catch(e => { console.error(e.message); process.exit(1) })
