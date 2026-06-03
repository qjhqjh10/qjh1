#!/usr/bin/env node
/**
 * 仿真测试: 极限压力测试 (17-stress)
 * 模拟 power user 进行超长输入、复杂多步骤操作。
 *
 * 场景: 超长文本分析+角色创建 → 多步骤规则学习+审计
 * 验证: 长输入处理, create_file 角色JSON, list_rules/learn_rule/write_learning/list_audit
 *
 * 复杂度: 高 — 2个高强度场景
 * 工具覆盖: read_file, create_file, list_rules, learn_rule, write_learning, list_audit
 *
 * 运行: node scripts/full-sim/17-stress.mjs
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

// ═══════════════════════════════════════════════════
//  配置
// ═══════════════════════════════════════════════════
const API_KEY = process.env.AI_API_KEY || 'sk-c9c30831df7243209435c60e811c879d'
const API_URL = 'https://api.deepseek.com/v1/chat/completions'
const MODEL = 'deepseek-v4-flash'
const MAX_ITERATIONS = 12
const ROOT = path.resolve(import.meta.dirname || '.', '..', '..')
const P = p => path.join(ROOT, 'projects', p)
const N = p => path.join(ROOT, 'notes', p)
const K = p => path.join(ROOT, 'knowledge_base', 'files', p)

// ═══════════════════════════════════════════════════
//  超长小说文本 (1500+ 字)
// ═══════════════════════════════════════════════════
const LONG_NOVEL_TEXT = [
  '这是一段关于修仙世界的故事。在青云宗的后山，有一片终年被云雾笼罩的竹林。',
  '竹林深处，有一间简陋的茅草屋。陈曦就住在这里。',
  '',
  '陈曦今年十六岁，是青云宗的一名外门弟子。她生得清秀，眉宇间带着几分倔强。',
  '与别的弟子不同，陈曦不喜欢修炼宗门的正统功法。她更喜欢在竹林中发呆，',
  '看云卷云舒，听风过竹梢。',
  '',
  '"陈曦！你又在这里偷懒！"一个洪亮的声音打破了竹林的宁静。',
  '来人是陈曦的师兄王铁柱，五大三粗的汉子，却穿着一身儒雅的道袍，显得有些不伦不类。',
  '',
  '陈曦头也不回，懒洋洋地说："师兄，我不是偷懒。我是在修炼。"',
  '"修炼？你连剑都没出鞘，修什么炼？"',
  '"修炼心性。"陈曦终于转过身，眼神清澈如溪水，"师父说，修仙先修心。"',
  '',
  '王铁柱被噎得说不出话。他挠了挠头，在旁边的大石头上坐下。',
  '"行行行，我说不过你。不过你听说了吗？宗门要进行内门选拔了。"',
  '',
  '陈曦的眼睛微微亮了一下，但很快又恢复了平静。',
  '"我知道。和我有什么关系？我只是个外门弟子。"',
  '"谁说外门弟子不能参加？这次选拔改了规则，所有筑基以下的弟子都可以报名。"',
  '',
  '陈曦站起身，拍了拍衣襟上的几片竹叶。她的动作很轻，轻得像是不想惊扰这片竹林。',
  '"师兄，你觉得我能赢吗？"',
  '"怎么不能？虽然你整天在这发呆，但你的剑法......"王铁柱说到这里停住了，',
  '像是想起了什么不好的回忆。',
  '',
  '陈曦微微一笑。这个笑容很淡，像早晨竹叶上的露珠，转瞬即逝。',
  '但就是这样的笑容，让王铁柱莫名觉得，这个整天在竹林里发呆的小师妹，',
  '可能比所有人都更懂得什么是真正的修炼。',
  '',
  '竹叶沙沙作响，像是在回应他们。陈曦抬头望向天空，透过层层竹叶，',
  '她看到的不是蓝天白云，而是一双深邃的眼睛。那双眼睛的主人，',
  '是一个她从未见过，却在梦里反复出现的身影。',
  '',
  '那是一个身着白衣的女子，站在云端，俯瞰着整座青云山。',
  '她的手中握着一柄剑，剑身上流转着淡金色的光芒。每当陈曦在梦里想要靠近时，',
  '那个身影就会化作点点星光，消散在风中。',
  '',
  '陈曦不知道那个女人是谁。但她有一种直觉——那个女人，和她自己的身世有关。',
  '',
  '陈曦是一个孤儿。十六年前，她被宗主从山门外捡回来。襁褓之中只留有一枚玉佩，',
  '玉佩上刻着一个"曦"字。宗主因此给她取名陈曦——当时正值晨曦初露。',
  '',
  '关于她的身世，宗主从未多言。陈曦也从不追问。但这些年，那些奇怪的梦越来越频繁。',
  '梦中的白衣女子好像在向她传递什么信息。',
  '',
  '"陈曦？陈曦！"王铁柱的声音把她拉回了现实。',
  '"啊？对不起，我又走神了。"陈曦有些不好意思地低下头。',
  '"你啊，整天魂不守舍的。回神堂吧，该吃饭了。"',
  '',
  '陈曦点了点头，跟在王铁柱身后走出竹林。走出竹林的那一刻，',
  '她又回头看了一眼。竹叶还在沙沙作响，像是挽留，也像是祝福。',
  '',
  '陈曦默默地想：总有一天，我会找到答案的。',
  '',
  '——节选自《青云志》第一章',
].join('\n')

const LONG_USER_MESSAGE = '分析下面这段小说文字，然后创建一个角色\'陈曦\'，给她写一段大纲:\n\n' + LONG_NOVEL_TEXT

// ═══════════════════════════════════════════════════
//  准备测试数据
// ═══════════════════════════════════════════════════
function seedTestData() {
  const projDir = P('1')
  fs.mkdirSync(path.join(projDir, 'characters'), { recursive: true })
  fs.mkdirSync(path.join(projDir, 'outline'), { recursive: true })
}

function cleanupTestData() {
  try { fs.rmSync(P('1'), { recursive: true, force: true }) } catch {}
}

// ═══════════════════════════════════════════════════
//  工具实现
// ═══════════════════════════════════════════════════
const tools = {
  read_file: a => {
    try {
      const fp = a.file_path || a.path || ''
      const c = fs.readFileSync(P(fp), 'utf-8')
      return c.length > 4000 ? c.slice(0, 4000) + '\n…(' + c.length + '字)' : c
    } catch (e) {
      return '[错误: 文件不存在]'
    }
  },

  list_directory: a => {
    try {
      const dir = a.path || a.dir_path || '.'
      const e = fs.readdirSync(P(dir), { withFileTypes: true })
      return e.map(x => (x.isDirectory() ? 'DIR ' : 'FILE ') + x.name).join('\n')
    } catch (e) {
      return '[错误: 目录不存在]'
    }
  },

  search_content: a => {
    try {
      const fp = P(a.path || '.')
      const keyword = a.pattern || ''
      if (!keyword) return '[错误]'
      let re
      try { re = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi') } catch { return '[错误]' }
      const results = []
      function searchDir(d) {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const f = path.join(d, e.name)
          if (e.isDirectory()) { searchDir(f); continue }
          const c = fs.readFileSync(f, 'utf-8')
          const ls = c.split('\n')
          for (let i = 0; i < ls.length; i++)
            if (re.test(ls[i]))
              results.push(f.replace(ROOT + '/projects/', '') + ':' + (i + 1) + ':' + ls[i].slice(0, 200))
        }
      }
      if (fs.statSync(fp).isFile()) {
        const c = fs.readFileSync(fp, 'utf-8')
        const ls = c.split('\n')
        for (let i = 0; i < ls.length; i++)
          if (re.test(ls[i]))
            results.push((a.path || '') + ':' + (i + 1) + ':' + ls[i].slice(0, 200))
      } else {
        searchDir(fp)
      }
      return results.slice(0, 15).join('\n') || '无匹配'
    } catch (e) { return '[错误]' }
  },

  create_file: a => {
    try {
      const fp = P(a.file_path || a.path)
      const c = a.content || ''
      fs.mkdirSync(path.dirname(fp), { recursive: true })
      fs.writeFileSync(fp, c)
      return '创建成功: ' + a.file_path + ' (' + c.length + '字)'
    } catch (e) { return '[错误: ' + e.message + ']' }
  },

  edit_file: a => {
    try {
      const fp = P(a.file_path)
      let c = fs.readFileSync(fp, 'utf-8')
      const old = a.old_string || ''
      const nw = a.new_string || ''
      if (old === '__FULL_REPLACE__') { fs.writeFileSync(fp, nw); return '全量替换成功' }
      let idx = c.indexOf(old)
      if (idx < 0) idx = c.indexOf(old.trim())
      if (idx < 0) return '[未找到匹配文本]'
      fs.writeFileSync(fp, c.slice(0, idx) + nw + c.slice(idx + old.length))
      return '编辑成功'
    } catch (e) { return '[错误: ' + e.message + ']' }
  },

  delete_file: a => {
    try { fs.unlinkSync(P(a.file_path)); return '删除成功' } catch { return '[错误]' }
  },

  // ── Harness 管理工具 ──
  list_rules: () => {
    const rulesDir = path.join(ROOT, 'rules')
    try {
      const files = fs.readdirSync(rulesDir)
      return files.length > 0 ? files.join('\n') : '暂无自定义规则'
    } catch {
      return '暂无自定义规则'
    }
  },

  learn_rule: a => {
    const rulesDir = path.join(ROOT, 'rules')
    try {
      fs.mkdirSync(rulesDir, { recursive: true })
      const ruleName = (a.name || 'rule_' + Date.now()) + '.md'
      fs.writeFileSync(path.join(rulesDir, ruleName), a.rule || '')
      return '规则已学习: ' + ruleName
    } catch (e) {
      return '[错误: ' + e.message + ']'
    }
  },

  write_learning: a => {
    const learnDir = path.join(ROOT, 'learnings')
    try {
      fs.mkdirSync(learnDir, { recursive: true })
      const learnName = (a.name || 'learning_' + Date.now()) + '.md'
      fs.writeFileSync(path.join(learnDir, learnName), a.summary || a.content || '')
      return '经验已记录: ' + learnName
    } catch (e) {
      return '[错误: ' + e.message + ']'
    }
  },

  list_audit: () => {
    const auditDir = path.join(ROOT, 'audit')
    try {
      const files = fs.readdirSync(auditDir)
      return files.length > 0 ? files.join('\n') : '暂无审计记录'
    } catch {
      return '暂无审计记录'
    }
  },

  list_prompts: () => '灵感/世界观/角色/大纲/细纲/章节/润色/续写/改写/摘要/审稿',

  create_project: a => {
    try {
      const name = a.name || ''
      if (!name) return '[错误: 缺少项目名称]'
      const projDir = P(name)
      ;['characters', 'chapters', 'outline', 'detailed_outline', 'summaries'].forEach(
        sub => fs.mkdirSync(path.join(projDir, sub), { recursive: true })
      )
      return '项目"' + name + '"创建成功'
    } catch (e) { return '[错误: ' + e.message + ']' }
  },
}

// ═══════════════════════════════════════════════════
//  OpenAI-format 工具定义
// ═══════════════════════════════════════════════════
const TOOLS = [
  { type: 'function', function: { name: 'read_file', description: '读取项目文件', parameters: { type: 'object', properties: { file_path: { type: 'string', description: '文件相对路径' } }, required: ['file_path'] } } },
  { type: 'function', function: { name: 'list_directory', description: '列出目录内容', parameters: { type: 'object', properties: { path: { type: 'string', description: '目录路径' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'search_content', description: '搜索文件内容', parameters: { type: 'object', properties: { pattern: { type: 'string', description: '搜索关键词' }, path: { type: 'string', description: '搜索路径' } }, required: ['pattern'] } } },
  { type: 'function', function: { name: 'create_file', description: '创建新文件。创建角色JSON时，用此工具保存到 1/characters/中文名.yaml', parameters: { type: 'object', properties: { file_path: { type: 'string' }, content: { type: 'string' } }, required: ['file_path', 'content'] } } },
  { type: 'function', function: { name: 'edit_file', description: '编辑文件', parameters: { type: 'object', properties: { file_path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' } }, required: ['file_path', 'old_string', 'new_string'] } } },
  { type: 'function', function: { name: 'delete_file', description: '删除文件', parameters: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] } } },
  { type: 'function', function: { name: 'list_rules', description: '列出所有已学习的规则', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'learn_rule', description: '学习新规则并保存', parameters: { type: 'object', properties: { rule: { type: 'string', description: '规则内容' } }, required: ['rule'] } } },
  { type: 'function', function: { name: 'write_learning', description: '记录学习经验', parameters: { type: 'object', properties: { summary: { type: 'string', description: '经验总结' } }, required: ['summary'] } } },
  { type: 'function', function: { name: 'list_audit', description: '查看审计记录', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'list_prompts', description: '列出提示词模板', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'create_project', description: '创建项目', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } } },
]

// ═══════════════════════════════════════════════════
//  系统提示词
// ═══════════════════════════════════════════════════
const SYS = [
  '你是青剑AI写作助手，一个专业的AI小说创作辅助工具。',
  '',
  '# 长文本处理',
  '用户粘贴长篇文本时，仔细阅读分析，提取角色信息、情节脉络、文风特征。',
  '然后根据用户要求创建角色JSON和大纲文件。',
  '',
  '# 角色创建格式',
  '角色文件: 1/characters/中文名.yaml',
  'JSON内容: { "name": "", "role": "", "age": "", "personality": "", "background": "", "appearance": "" }',
  '',
  '# 规则和学习管理',
  'list_rules: 查看已学规则',
  'learn_rule: 学习新规则',
  'write_learning: 记录经验',
  'list_audit: 查看审计',
  '',
  '# 对话风格',
  '- 用中文回复，简洁明了，完成每一步后汇报结果。',
].join('\n')

// ═══════════════════════════════════════════════════
//  API 调用
// ═══════════════════════════════════════════════════
async function callOpenAI(messages) {
  const body = {
    model: MODEL,
    messages,
    max_tokens: 4096,
    tools: TOOLS,
    tool_choice: 'auto',
  }
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + API_KEY,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error('HTTP ' + res.status + ': ' + errText.slice(0, 200))
  }
  const json = await res.json()
  const choice = json.choices[0]
  return {
    text: choice.message?.content || '',
    toolCalls: choice.message?.tool_calls || [],
    finishReason: choice.finish_reason || 'stop',
    usage: json.usage,
  }
}

// ═══════════════════════════════════════════════════
//  Agent 运行循环
// ═══════════════════════════════════════════════════
async function agentRun(userMsg) {
  const messages = [
    { role: 'system', content: SYS },
    { role: 'user', content: userMsg },
  ]
  let iterations = 0
  let totalTools = 0
  let fullText = ''
  const toolLog = []

  while (iterations < MAX_ITERATIONS) {
    iterations++
    process.stdout.write('  [iter' + iterations + '] ')

    const r = await callOpenAI(messages)
    if (r.text) fullText = r.text

    if (!r.toolCalls.length) {
      process.stdout.write('文本回复(' + r.text.length + '字)\n')
      return { text: fullText, iterations, toolCalls: totalTools, toolLog }
    }

    const asstMsg = {
      role: 'assistant',
      content: r.text || null,
      tool_calls: r.toolCalls,
    }
    messages.push(asstMsg)

    for (const tc of r.toolCalls) {
      const fn = tc.function
      const toolFn = tools[fn.name]
      let args = {}
      try { args = JSON.parse(fn.arguments) } catch {}
      const result = toolFn ? await toolFn(args) : '[未知工具]'
      const ok = result.startsWith && !result.startsWith('[')
      totalTools++
      process.stdout.write(fn.name + (ok ? '✓' : '✗') + ' ')
      toolLog.push({ name: fn.name, ok, args, result: result.slice(0, 100) })
      messages.push({ role: 'tool', tool_call_id: tc.id, content: result })
    }
    process.stdout.write('\n')
  }
  return { text: fullText, iterations, toolCalls: totalTools, toolLog }
}

// ═══════════════════════════════════════════════════
//  测试框架
// ═══════════════════════════════════════════════════
let pass = 0
let fail = 0

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
  console.log('\n' + '─'.repeat(55))
  console.log('  ' + title)
  console.log('─'.repeat(55))
}

// ═══════════════════════════════════════════════════
//  主测试流程
// ═══════════════════════════════════════════════════
async function main() {
  console.log('══════════════════════════════════════')
  console.log('  仿真测试: 压力测试 (17-stress)')
  console.log('  端点: ' + API_URL + '  模型: ' + MODEL)
  console.log('  模式: 长输入 + 多步骤 Harness 操作')
  console.log('══════════════════════════════════════')

  // 准备测试目录
  seedTestData()
  console.log('\n  [初始化] 测试目录已创建')
  // 确认长文本长度
  console.log('  [长文本] ' + LONG_USER_MESSAGE.length + ' 字符 (' + LONG_NOVEL_TEXT.length + ' 字原文)')

  // ──────────────────────────────────────────────
  //  S1: 超长输入 + 分析文本 + 创建角色 + 大纲
  // ──────────────────────────────────────────────
  hr('S1 超长输入分析 — 长文本 + “分析...创建角色‘陈曦’，写大纲”')
  const r1 = await agentRun(LONG_USER_MESSAGE)

  t('S1 返回文本', r1.text.length > 0, r1.text.length + '字')
  t('S1 有工具调用', r1.toolLog.length > 0, r1.toolLog.length + '个工具调用')

  // 检查是否创建了陈曦的角色文件
  const chenxiPath = P('1/characters/陈曦.yaml')
  const chenxiExists = fs.existsSync(chenxiPath)
  t('S1 陈曦角色文件已创建', chenxiExists,
    chenxiExists ? '文件存在' : '文件不存在')

  if (chenxiExists) {
    try {
      const chenxiData = JSON.parse(fs.readFileSync(chenxiPath, 'utf-8'))
      t('S1 角色JSON有效', !!chenxiData.name,
        'name=' + chenxiData.name + ', role=' + (chenxiData.role || '未设置'))
    } catch (e) {
      t('S1 角色JSON有效', false, 'JSON解析失败: ' + e.message)
    }
  }

  console.log('    工具调用 (' + r1.toolLog.length + '): ' + r1.toolLog.map(l => l.name).join(', '))
  console.log('    回复: ' + r1.text.slice(0, 150))
  console.log('    迭代: ' + r1.iterations + '轮, 总工具: ' + r1.toolCalls)

  // ──────────────────────────────────────────────
  //  S2: 多步骤 Harness 管理操作
  // ──────────────────────────────────────────────
  hr('S2 多步骤操作 — “列出规则→学个新规则→记录经验→查看审计”')

  // Step 1: 列出规则
  const r2a = await agentRun('列出所有规则')
  t('S2a list_rules 被调用', r2a.toolLog.some(l => l.name === 'list_rules'),
    r2a.toolLog.filter(l => l.name === 'list_rules').length + '次')
  console.log('    S2a 工具: ' + r2a.toolLog.map(l => l.name).join(', '))

  // Step 2: 学习新规则
  const r2b = await agentRun('学一个新规则：所有角色文件必须包含name和role字段')
  t('S2b learn_rule 被调用', r2b.toolLog.some(l => l.name === 'learn_rule'),
    r2b.toolLog.filter(l => l.name === 'learn_rule').length + '次')
  console.log('    S2b 工具: ' + r2b.toolLog.map(l => l.name).join(', '))

  // Step 3: 记录经验
  const r2c = await agentRun('记录一条经验：为陈曦创建角色时，需要更详细描述她与白衣女子的梦境关联')
  t('S2c write_learning 被调用', r2c.toolLog.some(l => l.name === 'write_learning'),
    r2c.toolLog.filter(l => l.name === 'write_learning').length + '次')
  console.log('    S2c 工具: ' + r2c.toolLog.map(l => l.name).join(', '))

  // Step 4: 查看审计
  const r2d = await agentRun('查看审计记录')
  t('S2d list_audit 被调用', r2d.toolLog.some(l => l.name === 'list_audit'),
    r2d.toolLog.filter(l => l.name === 'list_audit').length + '次')
  console.log('    S2d 工具: ' + r2d.toolLog.map(l => l.name).join(', '))

  // 总体验证：四个工具都被调用了
  const allFourTools = ['list_rules', 'learn_rule', 'write_learning', 'list_audit']
  const allFourCalled = allFourTools.every(tn =>
    [r2a, r2b, r2c, r2d].some(r => r.toolLog.some(l => l.name === tn))
  )
  t('S2 全部4个Harness工具已调用', allFourCalled,
    allFourTools.map(tn =>
      tn + '=' + ([r2a, r2b, r2c, r2d].some(r => r.toolLog.some(l => l.name === tn)) ? '✓' : '✗')
    ).join(' '))

  // 清理
  cleanupTestData()
  try { fs.rmSync(path.join(ROOT, 'rules'), { recursive: true, force: true }) } catch {}
  try { fs.rmSync(path.join(ROOT, 'learnings'), { recursive: true, force: true }) } catch {}

  // ──────────────────────────────────────────────
  //  汇总
  // ──────────────────────────────────────────────
  const total = pass + fail
  console.log('\n')
  console.log('══════════════════════════════════════')
  console.log('  仿真测试: 压力测试 (17-stress) — 测试结果')
  console.log('══════════════════════════════════════')
  console.log('  ✅ ' + String(pass).padStart(2) + '  通过')
  console.log('  ❌ ' + String(fail).padStart(2) + '  失败')
  console.log('  通过率: ' + (total > 0 ? ((pass / total) * 100).toFixed(1) : '0.0') + '%')
  console.log('')
  console.log('  场景覆盖:')
  console.log('    S1  超长输入分析  — ' + LONG_NOVEL_TEXT.length + '字小说 + 创建角色 + 写大纲')
  console.log('    S2  多步骤操作    — list_rules→learn_rule→write_learning→list_audit')
  console.log('══════════════════════════════════════')

  if (fail > 0) process.exit(1)
}

main().catch(e => {
  console.error('\n测试异常:', e.message)
  console.error(e.stack)
  process.exit(1)
})
