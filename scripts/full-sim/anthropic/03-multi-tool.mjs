#!/usr/bin/env node
/**
 * 仿真测试: 多工具协作 (Anthropic 协议)
 * 模拟用户进行章节创作——先读大纲/角色/细纲/前章摘要，再生成正文并保存。
 *
 * 场景: 写第3章正文，3000字。读大纲+角色+细纲+摘要后创作
 * 验证: read_file×4 → create_file×1，章节文件有500+字内容
 *
 * 复杂度: 中等 — 多步依赖操作
 * 工具覆盖: read_file, create_file, list_directory
 *
 * 运行: node scripts/full-sim/anthropic/03-multi-tool.mjs
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

// ── 配置 ──
const API_KEY = 'sk-c9c30831df7243209435c60e811c879d'
const BASE_URL = 'https://api.deepseek.com'
const MODEL = 'deepseek-v4-flash'
const MAX_ITERATIONS = 10

const API_URL = BASE_URL.replace(/\/+$/, '') + '/anthropic/v1/messages'

const ROOT = path.resolve(import.meta.dirname || '.', '..', '..', '..')
const P = p => path.join(ROOT, 'projects', p)
const N = p => path.join(ROOT, 'notes', p)
const K = p => path.join(ROOT, 'knowledge_base', 'files', p)

// 使用 stress-test-proj 项目数据
const PROJ = 'stress-test-proj'

console.log(`═══════════════════════════════════════════`)
console.log(`  仿真测试: 多工具协作 (03-multi-tool) — Anthropic 协议`)
console.log(`  端点: ${API_URL}`)
console.log(`  模型: ${MODEL}`)
console.log(`  项目: ${PROJ}`)
console.log(`  模式: 读上下文 → 写章节 → 保存文件`)
console.log(`═══════════════════════════════════════════`)

// ── 确保测试数据存在 ──
function ensureTestData() {
  const projDir = P(PROJ)

  // 大纲
  const outlineDir = path.join(projDir, 'outline')
  fs.mkdirSync(outlineDir, { recursive: true })
  fs.writeFileSync(path.join(outlineDir, 'plot.md'), [
    '# 《暗夜追踪》大纲',
    '',
    '## 一句话梗概',
    '前跑酷冠军林深夜间送外卖时意外撞见一宗走私交易，被卷入警方内部腐败的巨大阴谋，',
    '凭借跑酷技能在城市的黑夜中周旋求生，最终揭露真相。',
    '',
    '## 三幕结构',
    '',
    '### 第一幕：坠落（1-5章）',
    '- 林深的现状：从跑酷冠军沦为外卖员',
    '- 雨夜撞见交易，被追杀',
    '- 发现前女友父亲周正明涉案',
    '- 前记者陈浩失踪案的关联浮出水面',
    '',
    '### 第二幕：逃亡（6-12章）',
    '- 林深寻找证据，躲避追杀',
    '- 与老跑酷伙伴重聚，组建临时团队',
    '- 发现走私网络的规模远超想象',
    '- 周正明的真实身份逐渐揭开',
    '',
    '### 第三幕：决战（13-16章）',
    '- 林深收集的完整证据链浮出水面',
    '- 最终在废弃仓库的对决',
    '- 真相大白于天下',
    '- 林深的选择：回归平凡还是继续战斗',
  ].join('\n'))

  // 角色
  const charsDir = path.join(projDir, 'characters')
  fs.mkdirSync(charsDir, { recursive: true })
  fs.writeFileSync(path.join(charsDir, '林深.json'), JSON.stringify({
    id: 'lin_shen',
    name: '林深',
    role: '男主',
    gender: '男',
    age: 28,
    occupation: '外卖员/前跑酷运动员',
    background: '亚洲跑酷冠军，三年前因车祸退役。性格坚韧不服输，在逆境中仍保持希望。',
    appearance: '身高178cm，身材精瘦但肌肉线条分明，短发，眼神锐利，右手臂有车祸留下的疤痕。',
    personality: '表面冷漠内心炽热，极度重情义，做事果断但偶尔冲动，有很强的正义感。',
    abilities: '跑酷大师级能力(城市穿越/高空跳跃/障碍翻越)，野外生存技能，车辆驾驶。',
    weaknesses: '右膝旧伤影响爆发力，过于信任他人容易被利用，不擅长团队协作。',
    relationships: '周小雅：前女友，周正明的女儿\n陈浩：已故跑酷伙伴\n老王：外卖站站长',
    arc: '从逃避过去的失意运动员到主动面对危险的正义守护者',
    importance: 95,
    motivations: '寻求真相，保护无辜的人，找回自我价值',
  }, null, 2))

  // 细纲
  const detDir = path.join(projDir, 'detailed_outline')
  fs.mkdirSync(detDir, { recursive: true })
  fs.writeFileSync(path.join(detDir, 'chapter3.json'), JSON.stringify({
    id: 'chapter3',
    title: '第三章：地铁追逐',
    order: 2,
    status: 'planned',
    plotOverview: '林深利用废弃地铁网络甩掉追兵。在地铁隧道中，他意外发现了一个走私仓库，里面有大量证据。但在撤离时被警卫发现，展开隧道内的追逐战。',
    characters: '林深（主角，被追逐）\n黑西装保安×3（追兵）\n周正明（幕后，未直接出场）',
    location: '城市废弃地铁站/地下隧道/隐藏仓库',
    keyEvents: [
      '林深逃入废弃地铁站',
      '在地铁隧道深处发现走私仓库',
      '用手机拍下证据照片',
      '被巡逻警卫发现',
      '隧道内的跑酷追逐战',
      '利用地铁通风井逃脱',
    ],
    customContent: '第三章核心是"发现与逃脱"。林深在躲避追杀的过程中意外发现了更大的秘密——走私网络的规模和运作方式。这一章要建立紧张感，让读者感受到林深陷入了一个远比想象中更危险的局面。',
    emotionCurve: '恐惧→惊讶→决心→紧张→释然→新的不安',
    writingNotes: '视角：第三人称有限视角跟林深。节奏：前缓后急，发现仓库后加速。侧重：身体感受（膝盖疼痛/呼吸/疲劳）和空间感知（黑暗中的方向感）。',
  }, null, 2))

  // 第2章摘要
  const summDir = path.join(projDir, 'summaries')
  fs.mkdirSync(summDir, { recursive: true })
  fs.writeFileSync(path.join(summDir, 'chapter2.md'), [
    '# 第2章：码头的秘密 — 摘要',
    '',
    '## 剧情概述',
    '林深在码头撞见交易后成功逃脱。他躲在一个废弃的集装箱中整理思路，',
    '回忆起三年前的车祸——那次车祸并非意外，而是有人在他的车子上动了手脚。',
    '他意识到这场阴谋可能早在三年前就开始了。',
    '',
    '林深回到自己的出租屋取走了藏好的应急背包——里面有现金、假身份证和一些工具。',
    '在离开时发现出租屋已经被不明人员搜查过。',
    '',
    '他联系了前跑酷搭档阿杰，约在老地方见面。',
    '但在到达约定地点时，发现那里已经被监视。林深意识到自己的通讯可能被追踪了。',
    '',
    '## 出场角色',
    '- 林深：主角，发现阴谋的规模远超预想',
    '- 阿杰（提及）：前跑酷搭档，尚未出场但已被牵连',
    '- 周小雅（电话出场）：前女友，提供了一些关键信息片段',
    '',
    '## 关键事件',
    '1. 林深在集装箱中回忆车祸真相',
    '2. 发现出租屋被搜查',
    '3. 取出应急背包',
    '4. 与阿杰约定见面',
    '5. 发现约定地点被监视',
    '6. 决定单独行动',
    '',
    '## 钩子',
    '林深在废弃集装箱的角落里发现了一个染血的U盘——这是谁留下的？里面有什么？',
    '他决定在找到安全地点后查看其中的内容。',
  ].join('\n'))

  // 确保 chapters 目录存在
  fs.mkdirSync(path.join(projDir, 'chapters'), { recursive: true })

  console.log(`  [初始化] 测试数据就绪 (projects/${PROJ}/)`)
}

// ── 工具实现 ──
const tools = {
  read_file: a => {
    const fp = a.file_path || a.path || ''
    try {
      const c = fs.readFileSync(P(fp), 'utf-8')
      return c.length > 3000 ? c.slice(0, 3000) + '\n…(' + c.length + '字)' : c
    } catch {
      return '[错误: 文件不存在]'
    }
  },
  list_directory: a => {
    const dir = a.path || a.dir_path || '.'
    try {
      return fs.readdirSync(P(dir), { withFileTypes: true })
        .map(e => (e.isDirectory() ? 'DIR ' : 'FILE ') + e.name).join('\n')
    } catch {
      return '[错误: 目录不存在]'
    }
  },
  search_content: a => {
    try {
      return '搜索: ' + (a.pattern || '') + ' → 无匹配 (测试环境)'
    } catch {
      return '[错误]'
    }
  },
  create_file: a => {
    try {
      const fp = P(a.file_path || a.path)
      const c = a.content || ''
      fs.mkdirSync(path.dirname(fp), { recursive: true })
      fs.writeFileSync(fp, c)
      return '创建成功: ' + (a.file_path || a.path) + ' (' + c.length + '字)'
    } catch (e) {
      return '[错误: ' + e.message + ']'
    }
  },
  edit_file: a => {
    return '编辑成功'
  },
  delete_file: a => {
    return '删除成功'
  },
  kb_list: () => {
    try {
      return fs.readdirSync(K('')).filter(f => f.endsWith('.md')).join('\n') || '无'
    } catch {
      return '无'
    }
  },
  kb_create_file: a => {
    try {
      fs.mkdirSync(K(''), { recursive: true })
      fs.writeFileSync(K((a.name || 'x') + '.md'), a.content || '')
      return '创建成功'
    } catch {
      return '[错误]'
    }
  },
  list_notes: () => {
    try {
      fs.mkdirSync(N(''), { recursive: true })
      return fs.readdirSync(N('')).filter(f => f.endsWith('.md')).join('\n') || '无'
    } catch {
      return '无'
    }
  },
  write_note: a => {
    try {
      fs.mkdirSync(N(''), { recursive: true })
      fs.writeFileSync(N((a.name || 'x') + '.md'), a.content || '')
      return '创建成功'
    } catch {
      return '[错误]'
    }
  },
  read_note: a => {
    try {
      return fs.readFileSync(N((a.name || 'x') + '.md'), 'utf-8').slice(0, 500)
    } catch {
      return '[不存在]'
    }
  },
}

// ── Anthropic 格式工具定义 ──
const TOOLS = [
  { name: 'read_file', description: '读取项目文件内容。写章节前必须先读大纲/角色/细纲/摘要了解上下文。', input_schema: { type: 'object', properties: { file_path: { type: 'string', description: '文件相对路径' } }, required: ['file_path'] } },
  { name: 'list_directory', description: '列出目录内容', input_schema: { type: 'object', properties: { path: { type: 'string', description: '目录路径' } }, required: ['path'] } },
  { name: 'search_content', description: '搜索文件内容', input_schema: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' } }, required: ['pattern'] } },
  { name: 'create_file', description: '创建新文件。写章节正文时用此工具，content为章节全文。file_path示例: stress-test-proj/chapters/chapter3.txt', input_schema: { type: 'object', properties: { file_path: { type: 'string' }, content: { type: 'string' } }, required: ['file_path', 'content'] } },
  { name: 'edit_file', description: '编辑文件', input_schema: { type: 'object', properties: { file_path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' } }, required: ['file_path', 'old_string', 'new_string'] } },
  { name: 'delete_file', description: '删除文件', input_schema: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] } },
  { name: 'kb_list', description: '列出知识库文件', input_schema: { type: 'object', properties: {} } },
  { name: 'kb_create_file', description: '创建KB文件', input_schema: { type: 'object', properties: { name: { type: 'string' }, content: { type: 'string' } }, required: ['name', 'content'] } },
  { name: 'list_notes', description: '列出笔记', input_schema: { type: 'object', properties: {} } },
  { name: 'write_note', description: '创建笔记', input_schema: { type: 'object', properties: { name: { type: 'string' }, content: { type: 'string' } }, required: ['name', 'content'] } },
  { name: 'read_note', description: '读取笔记', input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
]

// ── 系统提示词 ──
const SYS = [
  '你是"青剑"，AI小说创作助手。',

  '# 铁律',
  '- 操作文件必须调用实际的 function call，口头描述不等于操作完成',
  '- 禁止在文本中用 <tool_name>、[工具名]、或任何 XML/JSON 文本块来模拟工具调用',

  '# 章节创作流程',
  '写章节时严格按以下流程：',
  '1. 先读大纲了解整体剧情走向',
  '2. 读取角色卡了解人物设定和性格',
  '3. 读取该章细纲获取场景安排和写作要点',
  '4. 读取前章摘要了解前情',
  '5. 基于以上信息创作章节正文，字数必须达标',
  '6. 用 create_file 保存章节文件',

  '# 写作要求',
  '- 中文写作，文笔流畅，细节丰富',
  '- 严格按照细纲的场景和事件顺序展开',
  '- 保持角色性格和行为一致',
  '- 字数达到用户要求的数量',

  '# 本次任务文件路径',
  '当前项目: stress-test-proj',
  '大纲: stress-test-proj/outline/plot.md',
  '角色: stress-test-proj/characters/林深.json',
  '第3章细纲: stress-test-proj/detailed_outline/chapter3.json',
  '第2章摘要: stress-test-proj/summaries/chapter2.md',
  '第3章正文保存到: stress-test-proj/chapters/chapter3.txt',

  '# 工具调用规则',
  '- 仅在用户明确要求操作项目文件时才调用工具',
  '- 不确定文件在哪 → list_directory',
  '- 已知文件路径 → 直接 read_file',
  '- 修改文件 → 先 read_file 确认原文，再 edit_file',
]

// ── Anthropic API 调用 (非流式) ──
async function callAnthropic({ system, messages, tools }) {
  // system 必须是 [{type:'text', text:'...'}] 格式
  const systemBlocks = (system || SYS).map(s =>
    typeof s === 'string' ? { type: 'text', text: s } : s
  )
  const body = {
    model: MODEL,
    max_tokens: 4096,
    stream: false,
    system: systemBlocks,
    messages: messages,
    tools: tools || [],
  }

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + API_KEY },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error('HTTP ' + res.status + ': ' + errText.slice(0, 300))
  }

  const json = await res.json()

  // ── 解析 content blocks ──
  let fullText = ''
  const toolUses = []

  for (const block of json.content || []) {
    if (block.type === 'text') {
      fullText += block.text
    } else if (block.type === 'tool_use') {
      toolUses.push({
        id: block.id,
        name: block.name,
        input: block.input || {},
      })
    }
  }

  return {
    text: fullText,
    toolUses,
    stopReason: json.stop_reason || '',
    usage: json.usage,
  }
}

// ── Agent 循环 ──
async function agentRun(userMsg) {
  const messages = [
    { role: 'user', content: [{ type: 'text', text: userMsg }] },
  ]
  let iterations = 0, totalTools = 0, fullText = ''
  const toolLog = []

  while (iterations < MAX_ITERATIONS) {
    iterations++
    process.stdout.write('  [iter' + iterations + '] ')
    const r = await callAnthropic({ system: SYS, messages, tools: TOOLS })

    if (r.text) fullText = r.text || fullText

    if (r.toolUses.length === 0) {
      process.stdout.write('文本回复(' + fullText.length + '字)\n')
      return { text: fullText, iterations, toolCalls: totalTools, toolLog }
    }

    // 构建 assistant content blocks
    const asstContent = []
    if (r.text) asstContent.push({ type: 'text', text: r.text })
    for (const tu of r.toolUses) {
      asstContent.push({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input })
    }
    messages.push({ role: 'assistant', content: asstContent })

    // 执行工具 → tool_result blocks
    const toolResults = []
    for (const tu of r.toolUses) {
      const toolFn = tools[tu.name]
      const result = toolFn ? await toolFn(tu.input) : '[未知工具]'
      const ok = !(typeof result === 'string' && result.startsWith('['))
      totalTools++
      const icon = ok ? '✓' : '✗'
      process.stdout.write(tu.name + icon + ' ')
      toolLog.push({
        name: tu.name,
        ok,
        args: tu.input,
        result: String(result).slice(0, 120),
      })
      toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: String(result) })
    }
    // Anthropic 要求: 所有 tool_result 必须合并在一条 user 消息中
    messages.push({ role: 'user', content: toolResults })
    process.stdout.write('\n')
  }
  return { text: fullText, iterations, toolCalls: totalTools, toolLog }
}

// ── 测试框架 ──
let pass = 0, fail = 0
function t(name, cond, detail) {
  if (cond) {
    pass++
    console.log('  ✅ ' + name + (detail ? ': ' + detail : ''))
  } else {
    fail++
    console.log('  ❌ ' + name + (detail ? ': ' + detail : ''))
  }
}
function hr(title) {
  console.log('\n' + '─'.repeat(55) + '\n  ' + title + '\n' + '─'.repeat(55))
}

// ── 测试场景 ──
async function main() {
  // 确保测试数据就绪
  ensureTestData()

  hr('S1 多工具协作 — “写第3章正文，3000字”')
  const r1 = await agentRun(
    '写第3章正文，3000字。先读大纲和角色卡了解背景，读第3章细纲，读第2章摘要了解前情，然后写 chapters/chapter3.txt'
  )

  // ── 基本验证 ──
  t('S1 文本回复', r1.text.length > 0, r1.text.length + '字')
  t('S1 迭代次数合理', r1.iterations <= MAX_ITERATIONS, r1.iterations + '次')

  // ── read_file 验证 ──
  const readCalls = r1.toolLog.filter(l => l.name === 'read_file')
  t('S1 read_file 被调用', readCalls.length > 0, readCalls.length + '次')
  t('S1 read_file >= 2次', readCalls.length >= 2, '已读取多个上下文文件')

  // ── 检查是否读取了关键文件 ──
  const readPaths = readCalls.map(l => l.args.file_path || l.args.path || '').join(',')
  const hasOutline = /outline.*plot/i.test(readPaths)
  const hasChar = /characters|林深/i.test(readPaths)
  const hasDetail = /detailed_outline|chapter3/i.test(readPaths)
  const hasSummary = /summaries|chapter2/i.test(readPaths)
  t('S1 读取了大纲', hasOutline, hasOutline ? '已读' : '未读 outline/plot.md')
  t('S1 读取了角色卡', hasChar, hasChar ? '已读' : '未读角色文件')
  t('S1 读取了细纲', hasDetail, hasDetail ? '已读' : '未读 chapter3 细纲')
  t('S1 读取了前章摘要', hasSummary, hasSummary ? '已读' : '未读 chapter2 摘要')
  console.log('    实际读取路径: ' + readPaths)

  // ── create_file 验证 ──
  const createCalls = r1.toolLog.filter(l => l.name === 'create_file')
  t('S1 create_file 被调用', createCalls.length > 0, createCalls.length + '次')

  // ── 检查章节文件 ──
  const chapterPath = P(PROJ + '/chapters/chapter3.txt')
  const chapterExists = fs.existsSync(chapterPath)
  t('S1 章节文件已创建', chapterExists, chapterPath)

  let chapterContent = ''
  if (chapterExists) {
    chapterContent = fs.readFileSync(chapterPath, 'utf-8')
    const charCount = chapterContent.replace(/\s/g, '').length
    t('S1 章节内容至少500字', charCount >= 500, charCount + '字（有效字数）')
    console.log('    章节文件大小: ' + chapterContent.length + ' 字节, 有效字数: ' + charCount)

    // 内容质量检查
    const hasParagraphs = chapterContent.split('\n').filter(l => l.trim().length > 20).length
    t('S1 章节有多段正文', hasParagraphs >= 3, hasParagraphs + '段')
  }

  // ── 工具调用摘要 ──
  console.log('\n    工具调用序列: ' + r1.toolLog.map(l => l.name + (l.ok ? '✓' : '✗')).join(' → '))
  console.log('    回复摘要: ' + r1.text.slice(0, 150).replace(/\n/g, ' '))

  // ── 汇总 ──
  const total = pass + fail
  console.log('\n')
  console.log('═══════════════════════════════════════════')
  console.log('  仿真测试: 多工具协作 (Anthropic 协议) — 结果')
  console.log('═══════════════════════════════════════════')
  console.log('  ✅ ' + String(pass).padStart(2) + '  通过')
  console.log('  ❌ ' + String(fail).padStart(2) + '  失败')
  console.log('  通过率: ' + (total > 0 ? ((pass / total) * 100).toFixed(1) : '0.0') + '%')
  console.log('')
  console.log('  场景覆盖:')
  console.log('    S1  写第3章正文 — read_file×4 → create_file×1')
  console.log('═══════════════════════════════════════════')

  if (fail > 0) process.exit(1)
}

main().catch(e => {
  console.error('\n💥 异常:', e.message)
  process.exit(1)
})
