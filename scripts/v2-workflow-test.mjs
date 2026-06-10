#!/usr/bin/env node
/**
 * 对话→创作转化工作流测试
 * 模拟: 用户和AI聊天 → 创意转化为结构化文件
 */
const API_KEY = 'sk-c9c30831df7243209435c60e811c879d'
const API_URL = 'https://api.deepseek.com/v1/chat/completions'
const MODEL = 'deepseek-v4-flash'
const TOOLS = [
  { type: 'function', function: { name: 'create_file', description: '创建文件并写入内容', parameters: { type: 'object', properties: { file_path: { type: 'string' }, content: { type: 'string' } }, required: ['file_path', 'content'] } } },
  { type: 'function', function: { name: 'read_file', description: '读取文件', parameters: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] } } },
  { type: 'function', function: { name: 'edit_file', description: '编辑文件', parameters: { type: 'object', properties: { file_path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' } }, required: ['file_path', 'old_string', 'new_string'] } } },
]

const SYSTEM = `你是青剑，小说创作对话助手。

## 模式判断
- 纯对话/分析/评价 → 纯文字回复
- 分析+操作 → 混合模式：文本和工具调用同一个响应
- 纯文件操作 → 创作模式

## 文件路径
- 大纲剧情: {项目名}/outline/plot.md (# 故事剧情 → > 梗概 → ## 第X章)
- 世界观: {项目名}/outline/worldbuilding.md (# 世界观 → > 类型 → ## 一、核心规则)
- 角色卡: {项目名}/characters/中文名.yaml (15字段YAML: id/name/role/gender/age/occupation/background/appearance/personality/abilities/weaknesses/relationships/relationshipTags/arc/importance)
- 细纲: {项目名}/detailed_outline/chapter{N}.yaml (plotOverview/characters/location/keyEvents/emotionCurve)
- 摘要: {项目名}/summaries/chapter{N}.md
- 笔记: ../notes/文件名.md`

function safeArgs(toolCall) {
  try { const a = JSON.parse(toolCall.function.arguments || '{}'); return a.file_path || a.old_string ? `${a.file_path || 'edit:' + (a.old_string||'').slice(0,30)}` : '(args ok)'; } catch { return '(JSON解析失败)'; }
}

async function call(prompt, userMsg, history = []) {
  const messages = [{ role: 'system', content: prompt }]
  for (const h of history) messages.push({ role: h.role, content: h.content })
  messages.push({ role: 'user', content: userMsg })
  const body = { model: MODEL, messages, tools: TOOLS, tool_choice: 'auto', max_tokens: 1500, temperature: 0.3 }
  const r = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` }, body: JSON.stringify(body) })
  const d = await r.json()
  const msg = d.choices?.[0]?.message
  return { text: msg?.content || '', tools: msg?.tool_calls || [], tokens: d.usage?.total_tokens || 0 }
}

async function main() {
  console.log('═══════════════════════════════════════')
  console.log(' 对话→创作转化工作流测试')
  console.log(` 模型: ${MODEL}`)
  console.log('═══════════════════════════════════════')

  // ═══ 场景1: 对话创意→大纲剧情 ═══
  console.log(`\n━━━ 场景1: 对话创意→大纲剧情 ━━━`)
  const r1 = await call(SYSTEM, '我想写修仙小说，主角经脉尽断却能通过"吞噬"别人的失败变强。帮我构思开篇剧情。')
  console.log(`[对话] 文本: ${r1.text.slice(0, 90)}... | 工具: ${r1.tools.length}`)
  const r1b = await call(SYSTEM, '这个创意不错！帮我把刚才讨论的开篇剧情写入项目1的大纲 plot.md。', [{ role: 'assistant', content: r1.text }])
  console.log(`[转化→plot] 工具: ${r1b.tools.length}(${r1b.tools.map(t=>t.function.name).join(',')}) ${r1b.tools.length>0 ? '路径: '+safeArgs(r1b.tools[0]) : '⚠️ 未调工具'}`)

  // ═══ 场景2: 对话创意→角色卡 ═══
  console.log(`\n━━━ 场景2: 对话创意→角色卡 ━━━`)
  const r2 = await call(SYSTEM, '帮我想一个女性反派：魔道卧底在正道宗门，表面温柔体贴，实际心狠手辣。')
  console.log(`[对话] 文本: ${r2.text.slice(0, 90)}... | 工具: ${r2.tools.length}`)
  const r2b = await call(SYSTEM, '很好！把这个角色创建为项目1的角色卡文件。', [{ role: 'assistant', content: r2.text }])
  console.log(`[转化→角色卡] 工具: ${r2b.tools.length}(${r2b.tools.map(t=>t.function.name).join(',')}) ${r2b.tools.length>0 ? '路径: '+safeArgs(r2b.tools[0]) : '⚠️ 未调工具'}`)

  // ═══ 场景3: 对话创意→世界观 ═══
  console.log(`\n━━━ 场景3: 对话创意→世界观设定 ━━━`)
  const r3 = await call(SYSTEM, '我的修仙世界观有九境：炼气→筑基→金丹→元婴→化神→炼虚→合体→大乘→真仙。帮我完善每个境界的特点。')
  console.log(`[对话] 文本: ${r3.text.slice(0, 90)}... | 工具: ${r3.tools.length}`)
  const r3b = await call(SYSTEM, '把这些世界观设定保存到项目1的 worldbuilding.md。', [{ role: 'assistant', content: r3.text }])
  console.log(`[转化→世界观] 工具: ${r3b.tools.length}(${r3b.tools.map(t=>t.function.name).join(',')}) ${r3b.tools.length>0 ? '路径: '+safeArgs(r3b.tools[0]) : '⚠️ 未调工具'}`)

  // ═══ 场景4: 章节→细纲提取 ═══
  console.log(`\n━━━ 场景4: 章节内容→细纲提取 ━━━`)
  const ch = `林逸站在演武场中央，四周弟子的窃窃私语如潮水般涌来。他的对手是首席弟子陈啸天。金丹期的威压碾压而来，林逸咬牙死死撑住。突然一道青芒从他丹田炸开——上古剑魂觉醒了。全场震惊。陈啸天脸色铁青，台下陈长老眼神闪过一丝阴毒。`
  const r4 = await call(SYSTEM, `分析这段并生成细纲YAML保存到项目1的 detailed_outline/chapter1.yaml："${ch}"`)
  console.log(`[混合·提取细纲] 工具: ${r4.tools.length}(${r4.tools.map(t=>t.function.name).join(',')}) 文本: ${r4.text ? '✅ ' + r4.text.slice(0, 60)+'...' : '❌'} 路径: ${r4.tools.length>0 ? safeArgs(r4.tools[0]) : 'N/A'}`)

  // ═══ 场景5: 碎片灵感→草稿笔记 ═══
  console.log(`\n━━━ 场景5: 碎片灵感→草稿笔记 ━━━`)
  const r5 = await call(SYSTEM, '我突然有个想法：主角的剑魂其实不是上古传承，而是来自未来的他自己——未来的他在陨落前把剑魂送了回来。这个反转怎么样？')
  console.log(`[对话] 文本: ${r5.text.slice(0, 90)}... | 工具: ${r5.tools.length}`)
  const r5b = await call(SYSTEM, '这个反转有意思！先帮我存到笔记里免得忘了。', [{ role: 'assistant', content: r5.text }])
  console.log(`[转化→笔记] 工具: ${r5b.tools.length}(${r5b.tools.map(t=>t.function.name).join(',')}) ${r5b.tools.length>0 ? '路径: '+safeArgs(r5b.tools[0]) : '⚠️ 未调工具'}`)

  console.log(`\n═══════════════════════════════════════\n 测试完成`)
}
main().catch(e => { console.error(e.message); process.exit(1) })
