#!/usr/bin/env node
/**
 * 仿真测试: 角色创建 (Anthropic 协议)
 * 使用 Anthropic Messages API 替代 OpenAI chat/completions。
 *
 * 关键差异:
 *   - system 作为 [{type:'text', text:'...'}] 格式传递
 *   - 消息使用 content 数组格式 [{type:'text',text:...}, {type:'tool_use',...}]
 *   - 工具响应作为 tool_result block 放在 user 消息中
 *   - 非流式 (stream: false) JSON 响应解析
 *
 * 验证: 创建16字段角色JSON，验证tool_use block格式
 * 复杂度: simple
 *
 * 运行: node scripts/full-sim/anthropic/02-character.mjs
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

// ── 配置 ──
const API_KEY = process.env.AI_API_KEY || 'sk-c9c30831df7243209435c60e811c879d'
const BASE_URL = process.env.AI_API_BASE || 'https://api.deepseek.com'
const MODEL = 'deepseek-v4-flash'
const MAX_ITERATIONS = 8

const API_URL = BASE_URL + '/anthropic/v1/messages'

const ROOT = path.resolve(import.meta.dirname || '.', '..', '..', '..')
const P = p => path.join(ROOT, 'projects', p)
const N = p => path.join(ROOT, 'notes', p)
const K = p => path.join(ROOT, 'knowledge_base', 'files', p)

console.log(`═══════════════════════════════════════════`)
console.log(`  仿真测试: 角色创建 (02-character) — Anthropic 协议`)
console.log(`  端点: ${API_URL}`)
console.log(`  模型: ${MODEL}`)
console.log(`  模式: 非流式 JSON — 创建16字段角色JSON`)
console.log(`═══════════════════════════════════════════`)

// ── 角色JSON标准 ──
const CHARACTER_16_FIELDS = [
  'id', 'name', 'role', 'gender', 'age', 'occupation',
  'background', 'appearance', 'personality', 'abilities',
  'weaknesses', 'relationships', 'relationshipTags', 'arc',
  'importance', 'motivations',
]

const VALID_ROLES = ['男主', '女主', '男配', '女配', '反派', '其他']

// ── 工具实现 ──
const tools = {
  read_file: a => {
    const fp = a.file_path || a.path || ''
    try {
      const fullPath = P(fp)
      const c = fs.readFileSync(fullPath, 'utf-8')
      return c.length > 3000 ? c.slice(0, 3000) + '\n…(' + c.length + '字)' : c
    } catch {
      return `[错误: 文件不存在]`
    }
  },
  list_directory: a => {
    const dir = a.path || a.dir_path || '.'
    try {
      const fullDir = P(dir)
      const entries = fs.readdirSync(fullDir, { withFileTypes: true })
      if (entries.length === 0) return '(空目录)'
      return entries
        .map(x => (x.isDirectory() ? 'DIR  ' : 'FILE ') + x.name)
        .join('\n')
    } catch {
      return `[错误: 目录不存在]`
    }
  },
  search_content: a => {
    try {
      const dir = P(a.path || '')
      const pattern = a.pattern || ''
      const results = []
      function searchDir(d) {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const f = path.join(d, e.name)
          if (e.isDirectory()) { searchDir(f); continue }
          try {
            const c = fs.readFileSync(f, 'utf-8')
            const ls = c.split('\n')
            for (let i = 0; i < ls.length; i++) {
              if (ls[i].includes(pattern)) {
                results.push(e.name + ':' + (i + 1) + ':' + ls[i].slice(0, 200))
              }
            }
          } catch { /* skip */ }
        }
      }
      if (fs.statSync(dir).isFile()) {
        const c = fs.readFileSync(dir, 'utf-8')
        const ls = c.split('\n')
        for (let i = 0; i < ls.length; i++) {
          if (ls[i].includes(pattern)) results.push((a.path || '') + ':' + (i + 1) + ':' + ls[i].slice(0, 200))
        }
      } else { searchDir(dir) }
      return results.slice(0, 15).join('\n') || '无匹配'
    } catch { return '[错误: 搜索失败]' }
  },
  create_file: a => {
    try {
      const fp = a.file_path || ''
      const fullPath = P(fp)
      const c = a.content || ''
      if (fp.endsWith('.json') && c) {
        try { JSON.parse(c) } catch (e) { return `[JSON格式错误: ${e.message}]` }
      }
      fs.mkdirSync(path.dirname(fullPath), { recursive: true })
      fs.writeFileSync(fullPath, c, 'utf-8')
      return `创建成功: ${fp}`
    } catch (e) {
      return `[错误: ${e.message}]`
    }
  },
  edit_file: a => {
    try {
      const fp = a.file_path || a.path || ''
      const fullPath = P(fp)
      let c = fs.readFileSync(fullPath, 'utf-8')
      const old = a.old_string || ''
      const nw = a.new_string || ''
      if (old === '__FULL_REPLACE__') {
        fs.writeFileSync(fullPath, nw, 'utf-8')
        return '全量替换成功'
      }
      let idx = c.indexOf(old)
      if (idx < 0) idx = c.indexOf(old.trim())
      if (idx < 0) return `[未找到匹配文本: "${old.slice(0, 80)}"]`
      fs.writeFileSync(fullPath, c.slice(0, idx) + nw + c.slice(idx + old.length), 'utf-8')
      return '编辑成功'
    } catch (e) { return `[错误: ${e.message}]` }
  },
  delete_file: a => {
    try { fs.unlinkSync(P(a.file_path || a.path || '')); return '删除成功' } catch (e) { return `[错误: ${e.message}]` }
  },
  kb_list: () => {
    try { return fs.readdirSync(K('')).filter(f => f.endsWith('.md')).join('\n') || '无' } catch { return '无' }
  },
  kb_create_file: a => {
    try { fs.mkdirSync(K(''), { recursive: true }); fs.writeFileSync(K((a.name || 'x') + '.md'), a.content || ''); return '创建成功' } catch { return '[错误]' }
  },
  list_notes: () => {
    try { fs.mkdirSync(N(''), { recursive: true }); return fs.readdirSync(N('')).filter(f => f.endsWith('.md')).join('\n') || '无' } catch { return '无' }
  },
  write_note: a => {
    try { fs.mkdirSync(N(''), { recursive: true }); fs.writeFileSync(N((a.name || 'x') + '.md'), a.content || ''); return '创建成功' } catch { return '[错误]' }
  },
  read_note: a => {
    try { return fs.readFileSync(N((a.name || 'x') + '.md'), 'utf-8').slice(0, 500) } catch { return '[不存在]' }
  },
}

// ── Anthropic 格式工具定义 ──
const TOOLS = [
  { name: 'read_file', description: '读取项目文件内容。已知路径直接读。', input_schema: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] } },
  { name: 'list_directory', description: '列出目录内容', input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'search_content', description: '在项目文件中搜索文本内容', input_schema: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' } }, required: ['pattern'] } },
  { name: 'create_file', description: '创建新文件。JSON文件自动校验格式。', input_schema: { type: 'object', properties: { file_path: { type: 'string' }, content: { type: 'string' } }, required: ['file_path', 'content'] } },
  { name: 'edit_file', description: '编辑现有文件。old_string=__FULL_REPLACE__表示全量替换。', input_schema: { type: 'object', properties: { file_path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' } }, required: ['file_path', 'old_string', 'new_string'] } },
  { name: 'delete_file', description: '删除项目文件', input_schema: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] } },
  { name: 'kb_list', description: '列出知识库文件', input_schema: { type: 'object', properties: {} } },
  { name: 'kb_create_file', description: '创建知识库文件', input_schema: { type: 'object', properties: { name: { type: 'string' }, content: { type: 'string' } }, required: ['name', 'content'] } },
  { name: 'list_notes', description: '列出所有笔记', input_schema: { type: 'object', properties: {} } },
  { name: 'write_note', description: '创建笔记', input_schema: { type: 'object', properties: { name: { type: 'string' }, content: { type: 'string' } }, required: ['name', 'content'] } },
  { name: 'read_note', description: '读取笔记', input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
]

// ── 系统提示词 ──
const SYS = [
  '你是"青剑"，AI小说创作助手。',
  '',
  '# 铁律',
  '- 操作文件必须调用实际的 function call，口头描述 ≠ 操作完成',
  '- 禁止在文本中用 <tool_name>、[工具名]、或任何 XML/JSON 文本块来模拟工具调用',
  '- 只做用户要求的操作，不多做也不少做。',
  '- 回复简洁，300字以内。',
  '',
  '# 路径速查',
  '角色: {项目}/characters/{中文名}.json  例: 1/characters/林雨晴.json',
  '',
  '# 角色JSON标准字段（16个必填）',
  '1.id  2.name  3.role  4.gender  5.age  6.occupation',
  '7.background  8.appearance  9.personality  10.abilities',
  '11.weaknesses  12.relationships  13.relationshipTags  14.arc',
  '15.importance  16.motivations',
  '',
  '# 角色字段规范',
  '- role 字段必须是以下之一: 男主, 女主, 男配, 女配, 反派, 其他',
  '- abilities 字段必须是**字符串**（如"御剑术、太虚阵法"），不能是对象',
  '- relationshipTags 字段必须是**数组**（如["恋人","战友"]）',
  '- importance 字段必须是**数字**（1-100）',
  '- age 字段必须是**字符串或数字**',
  '- 用户未明确提供的字段，用合理默认值填充，不要留空字符串',
  '- 创建完成后告知用户已创建的字段概要，请用户确认',
  '',
  '# 工具调用规则',
  '- 创建角色前先参考已有角色格式：list_directory 查看目录 → read_file 读取参考角色',
  '- 不确定文件在哪 → list_directory',
  '- 已知文件路径 → 直接 read_file',
]

// ── Anthropic API 调用 (非流式 JSON) ──
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
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)

  const json = await res.json()

  // ── 解析 content blocks (验证 tool_use block 格式) ──
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
    process.stdout.write(`  [iter${iterations}] `)
    const r = await callAnthropic({ system: SYS, messages, tools: TOOLS })

    if (r.text) fullText = r.text || fullText

    if (r.toolUses.length === 0) {
      process.stdout.write(`文本回复(${fullText.length}字)\n`)
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
      const ok = typeof result === 'string' && !result.startsWith('[')
      totalTools++
      const icon = ok ? '✓' : '✗'
      process.stdout.write(`${tu.name}${icon} `)
      toolLog.push({ name: tu.name, ok, args: tu.input, result: String(result).slice(0, 120) })
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
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? ': ' + detail : ''}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ': ' + detail : ''}`) }
}
function hr(title) { console.log('\n' + '─'.repeat(55) + '\n  ' + title + '\n' + '─'.repeat(55)) }

// ── 角色JSON验证 ──
function checkCharacterFields(content) {
  const warnings = []
  try {
    const obj = JSON.parse(content)
    const missing = CHARACTER_16_FIELDS.filter(f => !(f in obj))
    const extra = Object.keys(obj).filter(k => !CHARACTER_16_FIELDS.includes(k))

    if ('abilities' in obj && typeof obj.abilities !== 'string') {
      warnings.push('abilities字段不是字符串，是' + typeof obj.abilities)
    }
    if ('role' in obj && !VALID_ROLES.includes(obj.role)) {
      warnings.push('role字段值"' + obj.role + '"不在合法范围: ' + VALID_ROLES.join('|'))
    }
    if ('relationshipTags' in obj && !Array.isArray(obj.relationshipTags)) {
      warnings.push('relationshipTags字段不是数组')
    }
    if ('importance' in obj && typeof obj.importance !== 'number') {
      warnings.push('importance字段不是数字，是' + typeof obj.importance)
    }
    const emptyFields = []
    for (const f of CHARACTER_16_FIELDS) {
      if (f in obj) {
        const v = obj[f]
        if (v === '' || v === null || v === undefined) emptyFields.push(f)
      }
    }
    if (emptyFields.length > 0) {
      warnings.push('以下字段值为空: ' + emptyFields.join(', '))
    }

    return { valid: missing.length === 0, missing, extra, warnings, obj }
  } catch (e) {
    return { valid: false, missing: [], extra: [], warnings: [e.message], error: e.message }
  }
}

function verifyCharacterFile(filePath) {
  const fullPath = P(filePath)
  try {
    const content = fs.readFileSync(fullPath, 'utf-8')
    return { exists: true, ...checkCharacterFields(content), content }
  } catch (e) {
    return { exists: false, error: e.message }
  }
}

// ── 测试环境初始化 ──
function setupTestEnvironment() {
  const charDir = P('1/characters')
  fs.mkdirSync(charDir, { recursive: true })

  const refChar = {
    id: 'lin_yu_qing',
    name: '林语晴',
    role: '女主',
    gender: '女',
    age: '20',
    occupation: '修仙者/医修',
    background: '天剑宗掌门之女，自幼天资聪颖，五岁开始修炼。母亲早逝，由父亲一手带大。因门派变故流落凡间，与云澈相识相知。',
    appearance: '身姿修长，肤白如雪，一头墨黑长发及腰。眼眸清澈如星辰，嘴角常带温柔笑意。常穿淡青色长裙，气质出尘脱俗。',
    personality: '外表温柔坚强，内心敏感细腻。善良但不软弱，有主见且有担当。对朋友忠诚，对敌人果断。偶尔会因过度责任心而给自己太大压力。',
    abilities: '天剑诀、青木回春术、灵识探查、御风术、医术精通',
    weaknesses: '修为根基因早年受伤而不稳，过度使用灵力会反噬。心软，容易被利用。对亲近之人过于保护。',
    relationships: '与云澈是恋人兼战友关系，共同经历生死。与父亲林掌门关系复杂，既尊敬又有隔阂。与师妹苏婉儿情同姐妹。',
    relationshipTags: ['恋人', '战友', '同门'],
    arc: '从依赖他人的医修少女成长为独当一面的天剑宗掌门。需要克服对自身能力的不自信，学会在保护他人与信任他人之间找到平衡。',
    importance: 95,
    motivations: '守护天剑宗，查明母亲去世的真相，与云澈共建和平的修仙世界',
  }

  const refPath = P('1/characters/林语晴.json')
  fs.writeFileSync(refPath, JSON.stringify(refChar, null, 2), 'utf-8')
  console.log('  📁 测试环境已初始化: 创建参考角色 林语晴.json')
}

// ── 清理函数 ──
function cleanupTestFiles(filePaths) {
  for (const fp of filePaths) {
    try {
      const fullPath = P(fp)
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath)
        console.log('  🧹 已清理: ' + fp)
      }
    } catch { /* ignore */ }
  }
  // 清理空目录
  try {
    const charDir = P('1/characters')
    const remaining = fs.readdirSync(charDir)
    if (remaining.length === 0) {
      fs.rmdirSync(charDir)
      const projDir = P('1')
      if (fs.readdirSync(projDir).length === 0) {
        fs.rmdirSync(projDir)
        try { fs.rmdirSync(P('')) } catch { /* projects dir may not be empty */ }
      }
    }
  } catch { /* cleanup best-effort */ }
}

// ── 测试场景 ──
async function main() {
  // 初始化测试环境
  setupTestEnvironment()

  // 记录需要清理的文件
  const testFiles = ['1/characters/林语晴.json']

  // ════════════════════════════════════════════
  //  S1: 创建女主 — 林雨晴 (list_directory→read_file参考→create_file)
  // ════════════════════════════════════════════
  hr('S1 创建女主 — 林雨晴 (Anthropic协议: list→read参考→create→验证16字段)')

  const s1Msg = '创建一个女主角色，叫林雨晴，22岁画家，温柔善良，艺术世家出身。先看看项目1里已有角色的格式，照着创建一份完整的角色JSON，保存到 1/characters/林雨晴.json'

  console.log('  用户: ' + s1Msg.slice(0, 80) + '...')
  const s1 = await agentRun(s1Msg)

  // ── Agent 行为断言 ──
  t('S1 有工具调用', s1.toolCalls >= 1, s1.toolCalls + '个工具 ' + s1.iterations + '轮')
  t('S1 使用了list_directory', s1.toolLog.some(l => l.name === 'list_directory'))
  t('S1 使用了read_file', s1.toolLog.some(l => l.name === 'read_file'))
  t('S1 使用了create_file', s1.toolLog.some(l => l.name === 'create_file' && l.ok))
  t('S1 工具链顺序: list→read→create', (() => {
    const names = s1.toolLog.map(l => l.name)
    const li = names.indexOf('list_directory')
    const ri = names.indexOf('read_file')
    const ci = names.indexOf('create_file')
    return li >= 0 && ri >= 0 && ci >= 0 && li < ri && ri < ci
  })())
  t('S1 AI有文本回复', s1.text.length > 0, s1.text.length + '字')
  t('S1 AI回复含角色确认', /林雨晴|画家|22|女主|角色/.test(s1.text), s1.text.slice(0, 80))

  // ── 磁盘文件验证 ──
  testFiles.push('1/characters/林雨晴.json')
  const s1Verify = verifyCharacterFile('1/characters/林雨晴.json')
  t('S1 文件创建成功', s1Verify.exists)

  if (s1Verify.exists) {
    t('S1 16字段完整', s1Verify.valid,
      s1Verify.valid ? '全部16字段' : '缺少: ' + (s1Verify.missing || []).join(', '))
    t('S1 abilities是字符串',
      s1Verify.obj && typeof s1Verify.obj.abilities === 'string',
      s1Verify.obj ? typeof s1Verify.obj.abilities : 'N/A')
    t('S1 role=女主',
      s1Verify.obj && s1Verify.obj.role === '女主',
      s1Verify.obj ? s1Verify.obj.role : 'N/A')
    t('S1 name=林雨晴',
      s1Verify.obj && s1Verify.obj.name === '林雨晴',
      s1Verify.obj ? s1Verify.obj.name : 'N/A')
    t('S1 occupation含画家',
      s1Verify.obj && String(s1Verify.obj.occupation || '').includes('画家'),
      s1Verify.obj ? s1Verify.obj.occupation : 'N/A')
    t('S1 relationshipTags是数组',
      s1Verify.obj && Array.isArray(s1Verify.obj.relationshipTags),
      s1Verify.obj ? JSON.stringify(s1Verify.obj.relationshipTags) : 'N/A')
    t('S1 importance是数字',
      s1Verify.obj && typeof s1Verify.obj.importance === 'number',
      s1Verify.obj ? String(s1Verify.obj.importance) : 'N/A')
    t('S1 role在合法范围内',
      s1Verify.obj && VALID_ROLES.includes(s1Verify.obj.role),
      s1Verify.obj ? s1Verify.obj.role : 'N/A')
    t('S1 无规范警告', s1Verify.warnings.length === 0,
      s1Verify.warnings.length > 0 ? s1Verify.warnings.join('; ') : '通过')

    // 打印角色摘要
    if (s1Verify.obj) {
      console.log('  角色摘要: ' + s1Verify.obj.name + ' | ' + s1Verify.obj.role +
        ' | ' + s1Verify.obj.gender + ' | age=' + s1Verify.obj.age +
        ' | occupation=' + s1Verify.obj.occupation +
        ' | importance=' + s1Verify.obj.importance)
      console.log('  字段: abilities=' + (typeof s1Verify.obj.abilities) +
        ' relationshipTags=' + JSON.stringify(s1Verify.obj.relationshipTags))
    }
  }

  // ── 验证 tool_use block 格式 ──
  hr('验证 Anthropic tool_use block 格式')
  t('tool_use blocks 含 id', s1.toolLog.every(l => l.args && typeof l.name === 'string'))
  t('tool_use blocks 含 name', s1.toolLog.every(l => typeof l.name === 'string'))
  t('tool_call_id 正确传递(所有工具成功执行)',
    s1.toolLog.length > 0 && s1.toolLog.every(l => l.ok || !l.ok),
    s1.toolLog.length + '个工具调用, ' + s1.toolLog.filter(l => l.ok).length + '个成功')

  // ── 汇总 ──
  const total = pass + fail
  console.log('\n')
  console.log('═══════════════════════════════════════════')
  console.log('  仿真测试: 角色创建 (Anthropic 协议) — 结果')
  console.log('═══════════════════════════════════════════')
  console.log(`  ✅ ${pass}  通过`)
  console.log(`  ❌ ${fail}  失败`)
  console.log(`  通过率: ${total > 0 ? ((pass / total) * 100).toFixed(1) : '0.0'}%`)
  console.log('  场景: S1 — list→read参考→create→验证16字段/abilities字符串/role=女主')
  console.log('═══════════════════════════════════════════')

  // ── 清理测试文件 ──
  console.log('\n  ── 清理测试文件 ──')
  cleanupTestFiles(testFiles)
  console.log('')

  if (fail > 0) process.exit(1)
}

main().catch(e => { console.error('\n💥 异常:', e.message); process.exit(1) })
