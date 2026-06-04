#!/usr/bin/env node
/**
 * L3 完整链路测试 — 模板创建（风格 + 场景）
 *
 * 使用与 templateTools.ts 完全相同的校验逻辑，
 * 验证 AI 创建的模板能通过真实校验并正确写入 YAML。
 *
 * vs test-v5-anth.mjs 的区别：
 *   - test-v5-anth: 简化 tool stub（yaml.dump(raw_args)）
 *   - 本脚本: 完整校验链路（dimensions结构→逐维度→聚合→ID/时间戳→YAML）
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as yaml from 'js-yaml'

const API_KEY = process.env.AI_API_KEY || 'sk-your-key-here'
const ANTHROPIC_URL = 'https://api.deepseek.com/anthropic/v1/messages'
const ROOT = process.cwd()
const ST = p => path.join(ROOT, 'style_templates', p)
const SC = p => path.join(ROOT, 'scene_templates', p)

// ════════════════════════════════════════════════════════
// 真实校验逻辑（与 templateTools.ts 一致）
// ════════════════════════════════════════════════════════

function validateStyleTemplate(args) {
  const errors = []
  let dims = args.dimensions || {}

  // 1. 解析字符串格式的 dimensions
  if (typeof dims === 'string') {
    try { dims = JSON.parse(dims) } catch {
      errors.push('dimensions JSON 格式错误')
      return { valid: false, errors, dims: null }
    }
  }

  // 2. dimensions 必须是对象非数组
  if (!dims || typeof dims !== 'object' || Array.isArray(dims)) {
    errors.push('dimensions 必须是一个对象')
    return { valid: false, errors, dims: null }
  }

  // 3. 逐维度校验
  for (const [key, val] of Object.entries(dims)) {
    if (!val || typeof val !== 'object') {
      errors.push(`维度 ${key} 的值必须是对象{description,examples,writingRules,vocabularyList}`)
      continue
    }
    const v = val
    if (!v.description || typeof v.description !== 'string' || v.description.length < 20) {
      errors.push(`维度 ${key}: description 太短（≥20字）`)
    }
    if (!Array.isArray(v.examples) || v.examples.length < 2) {
      errors.push(`维度 ${key}: examples 至少 2 条原文`)
    }
    if (!Array.isArray(v.writingRules) || v.writingRules.length < 1) {
      errors.push(`维度 ${key}: writingRules 至少 1 条`)
    }
    if (!Array.isArray(v.vocabularyList) || v.vocabularyList.length < 3) {
      errors.push(`维度 ${key}: vocabularyList 至少 3 词`)
    }
  }

  // 4. 必填维度检查
  const required = ['narrativeTone','sentenceStyle','vocabularyStyle','rhetoricStyle',
    'rhythmStyle','dialogueStyle','moodStyle','perspectiveStyle',
    'bodyLanguageStyle','sensoryStyle','descriptionPattern']
  const missing = required.filter(k => !dims[k])
  if (missing.length > 0) errors.push(`缺必填维度: ${missing.join(',')}`)

  // 5. dimensions 不能为空
  if (Object.keys(dims).length === 0) errors.push('dimensions 不能为空对象')

  return { valid: errors.length === 0, errors, dims }
}

function buildStyleTemplate(args) {
  const { valid, dims } = validateStyleTemplate(args)
  if (!valid || !dims || Object.keys(dims).length === 0) return null

  // 聚合 vocabularyList 和 writingRules
  const allVocab = []
  const allRules = []
  for (const val of Object.values(dims)) {
    if (Array.isArray(val.vocabularyList)) allVocab.push(...val.vocabularyList.map(String))
    if (Array.isArray(val.writingRules)) allRules.push(...val.writingRules.map(String))
  }

  return {
    id: `st_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name: String(args.name || '未命名模板'),
    type: String(args.type || '普通小说'),
    worldType: String(args.worldType || ''),
    description: String(args.description || ''),
    fullDescription: String(args.fullDescription || args.description || ''),
    dimensions: dims,
    vocabularyList: allVocab,
    writingRules: allRules,
    tone: args.tone || {},
    source: 'ai-generated',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

function validateSceneTemplate(args) {
  const errors = []
  if (!args.name) errors.push('缺 name')
  if (!args.type) errors.push('缺 type')
  if (!args.sceneType && !args.plotOverview) errors.push('缺 sceneType 或 plotOverview')
  return { valid: errors.length === 0, errors }
}

function buildSceneTemplate(args) {
  const v = validateSceneTemplate(args)
  if (!v.valid) return null

  const str = (v, d = '') => typeof v === 'string' ? v : v ? String(v) : d
  const arr = (v) => Array.isArray(v) ? v.map(String) : []
  const num = (v, d = 0) => typeof v === 'number' ? v : d

  return {
    id: `sc_${Date.now().toString(36)}`,
    name: str(args.name, '未命名场景模板'),
    type: str(args.type, '普通小说'),
    config: {
      sceneType: str(args.sceneType, '日常'),
      scenePurpose: arr(args.scenePurpose),
      conflictType: str(args.conflictType, '无冲突'),
      characters: arr(args.characters),
      location: str(args.location),
      time: str(args.time, '不限'),
      weather: str(args.weather, '不限'),
      atmosphere: str(args.atmosphere, '不限'),
      wordTarget: num(args.wordTarget, 3000),
      narrativePOV: str(args.narrativePOV, '第三人称'),
      pacing: str(args.pacing, '渐进'),
      bodyLanguage: str(args.bodyLanguage),
      sensoryAnchors: str(args.sensoryAnchors),
      dominantEmotion: str(args.dominantEmotion),
      emotionCurveInput: str(args.emotionCurveInput),
      plotOverview: str(args.plotOverview),
      sceneTurningPoint: str(args.sceneTurningPoint),
      props: str(args.props),
      appearance: str(args.appearance),
      detail: str(args.detail),
      extraNote: str(args.extraNote),
      autoFields: Array.isArray(args.autoFields)
        ? Object.fromEntries(args.autoFields.map(f => [String(f), true]))
        : {},
      intensity: num(args.intensity || args.eroticIntensity, 0),
      selectedKinks: arr(args.selectedKinks),
      opening: arr(args.opening),
      climax: arr(args.climax),
      aftermath: arr(args.aftermath),
      soundDensity: str(args.soundDensity),
      moanStyle: str(args.moanStyle),
      degradeLangs: arr(args.degradeLangs),
      bodyFluidFocus: arr(args.bodyFluidFocus),
      bodyPartFocus: arr(args.bodyPartFocus),
      tactileFocus: arr(args.tactileFocus),
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: 'ai-generated',
  }
}

// ════════════════════════════════════════════════════════
// 工具执行器（真实校验）
// ════════════════════════════════════════════════════════

const tools = {
  read_file: a => {
    try {
      const fp = path.join(ROOT, 'projects', String(a.file_path || a.path || ''))
      return { status: 'success', summary: '读取成功', detail: fs.readFileSync(fp, 'utf-8').slice(0, 2000) }
    } catch {
      return { status: 'error', summary: '文件不存在' }
    }
  },
  list_directory: a => {
    try {
      const p = a.path ? path.join(ROOT, String(a.path)) : ROOT
      return {
        status: 'success', summary: '列出成功',
        detail: fs.readdirSync(p, { withFileTypes: true })
          .map(x => (x.isDirectory() ? 'DIR' : 'FILE') + ' ' + x.name).join('\n')
      }
    } catch { return { status: 'error', summary: '目录不存在' } }
  },
  search_content: a => { return { status: 'success', summary: '搜索完成', detail: '' } },
  create_file: a => {
    try {
      const fp = path.join(ROOT, 'projects', String(a.file_path || ''));
      fs.mkdirSync(path.dirname(fp), { recursive: true });
      fs.writeFileSync(fp, a.content || '');
      return { status: 'success', summary: '创建成功' }
    } catch { return { status: 'error', summary: '创建失败' } }
  },
  edit_file: a => {
    try {
      const fp = path.join(ROOT, 'projects', String(a.file_path || ''));
      let c = fs.readFileSync(fp, 'utf-8');
      const o = a.old_string || '';
      const n = a.new_string || '';
      if (o === '__FULL_REPLACE__') { fs.writeFileSync(fp, n); return { status: 'success', summary: '全量替换' } }
      const i = c.indexOf(o);
      if (i < 0) return { status: 'error', summary: '未找到匹配' };
      fs.writeFileSync(fp, c.slice(0, i) + n + c.slice(i + o.length));
      return { status: 'success', summary: '编辑成功' }
    } catch { return { status: 'error', summary: '编辑失败' } }
  },

  // ── 真实模板创建 ──
  create_style_template: a => {
    try {
      const tmpl = buildStyleTemplate(a)
      if (!tmpl) {
        const v = validateStyleTemplate(a)
        return { status: 'error', summary: `校验失败: ${v.errors.join('; ')}` }
      }
      fs.mkdirSync(ST(''), { recursive: true })
      // 过滤 undefined
      const clean = JSON.parse(JSON.stringify(tmpl))
      fs.writeFileSync(ST(tmpl.name + '.yaml'), yaml.dump(clean, { indent: 2, lineWidth: 120 }), 'utf-8')
      return {
        status: 'success',
        summary: `已创建风格模板: ${tmpl.name}`,
        detail: `ID: ${tmpl.id}, ${Object.keys(tmpl.dimensions).length}维度, ${tmpl.vocabularyList.length}词汇, ${tmpl.writingRules.length}规则`
      }
    } catch (e) {
      return { status: 'error', summary: `创建失败: ${e.message}` }
    }
  },

  create_scene_template: a => {
    try {
      const tmpl = buildSceneTemplate(a)
      if (!tmpl) {
        const v = validateSceneTemplate(a)
        return { status: 'error', summary: `校验失败: ${v.errors.join('; ')}` }
      }
      fs.mkdirSync(SC(''), { recursive: true })
      const clean = JSON.parse(JSON.stringify(tmpl))
      fs.writeFileSync(SC(tmpl.name + '.yaml'), yaml.dump(clean, { indent: 2, lineWidth: 120 }), 'utf-8')
      return { status: 'success', summary: `已创建场景模板: ${tmpl.name}`, detail: `ID: ${tmpl.id}` }
    } catch (e) {
      return { status: 'error', summary: `创建失败: ${e.message}` }
    }
  },

  // 其余工具 stub
  kb_list: () => ({ status: 'success', summary: 'KB列表', detail: '无' }),
  kb_create_file: () => ({ status: 'success', summary: 'KB创建成功' }),
  kb_append_file: () => ({ status: 'error', summary: 'KB文件不存在' }),
  kb_index_file: () => ({ status: 'success', summary: '索引成功' }),
  list_notes: () => ({ status: 'success', summary: '笔记列表', detail: '无' }),
  read_note: () => ({ status: 'success', summary: '读取笔记', detail: '' }),
  write_note: () => ({ status: 'success', summary: '笔记创建成功' }),
  append_note: () => ({ status: 'error', summary: '笔记不存在' }),
  delete_note: () => ({ status: 'success', summary: '笔记删除成功' }),
  search_notes: () => ({ status: 'success', summary: '搜索完成' }),
  search_images: () => ({ status: 'error', summary: '图片搜索暂不可用' }),
  generate_image: () => ({ status: 'error', summary: '图片生成暂不可用' }),
  create_project: a => {
    try {
      const d = path.join(ROOT, 'projects', String(a.name || ''));
      ['characters','chapters','outline','detailed_outline','summaries']
        .forEach(s => fs.mkdirSync(path.join(d, s), { recursive: true }));
      return { status: 'success', summary: '项目创建成功' }
    } catch { return { status: 'error', summary: '项目创建失败' } }
  },
  delete_project: () => ({ status: 'success', summary: '项目删除成功' }),
  list_prompts: () => ({ status: 'success', summary: '提示词列表', detail: '无' }),
  toggle_prompt: () => ({ status: 'success', summary: '已切换' }),
  update_prompt: () => ({ status: 'success', summary: '已更新' }),
  list_rules: () => ({ status: 'success', summary: '规则列表', detail: '无' }),
  learn_rule: () => ({ status: 'success', summary: '已学习' }),
  list_audit: () => ({ status: 'success', summary: '审计列表', detail: '无' }),
  write_learning: () => ({ status: 'success', summary: '已记录' }),
  http_get: () => ({ status: 'error', summary: '不可用' }),
  http_fetch: () => ({ status: 'error', summary: '不可用' }),
  browser_open: () => ({ status: 'error', summary: '不可用' }),
  browser_search: () => ({ status: 'error', summary: '不可用' }),
  shell_exec: () => ({ status: 'error', summary: '不可用' }),
  shell_run_script: () => ({ status: 'error', summary: '不可用' }),
  lsp_diagnose: () => ({ status: 'error', summary: '不可用' }),
  find_files: () => ({ status: 'success', summary: '搜索完成', detail: '无匹配' }),
}

// ════════════════════════════════════════════════════════
// Tool schemas（Anthropic 格式）
// ════════════════════════════════════════════════════════

const SCHEMAS = [
  { name: 'read_file', description: '读取文件', input_schema: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] } },
  { name: 'list_directory', description: '列出目录', input_schema: { type: 'object', properties: { path: { type: 'string' }, pattern: { type: 'string' } }, required: [] } },
  { name: 'search_content', description: '搜索内容', input_schema: { type: 'object', properties: { pattern: { type: 'string' } }, required: ['pattern'] } },
  { name: 'edit_file', description: '编辑文件', input_schema: { type: 'object', properties: { file_path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' } }, required: ['file_path', 'old_string', 'new_string'] } },
  { name: 'create_file', description: '创建文件', input_schema: { type: 'object', properties: { file_path: { type: 'string' }, content: { type: 'string' } }, required: ['file_path', 'content'] } },
  {
    name: 'create_style_template',
    description: '创建风格模板（YAML）。必填:name,type,dimensions(含11维度每维度description/examples/writingRules/vocabularyList),worldType,tone',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        type: { type: 'string' },
        dimensions: { type: 'object' },
        worldType: { type: 'string' },
        description: { type: 'string' },
        fullDescription: { type: 'string' },
        tone: { type: 'object' },
      },
      required: ['name', 'type', 'dimensions'],
    },
  },
  {
    name: 'create_scene_template',
    description: '创建场景模板（YAML）。必填:name,type,sceneType,plotOverview',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        type: { type: 'string' },
        sceneType: { type: 'string' },
        plotOverview: { type: 'string' },
        characters: { type: 'array' },
        location: { type: 'string' },
        autoFields: { type: 'array', items: { type: 'string' } },
      },
      required: ['name', 'type'],
    },
  },
]

// ════════════════════════════════════════════════════════
// System prompt
// ════════════════════════════════════════════════════════

const SYS = `你是"青剑"，AI小说创作助手。

# 铁律
- 操作文件必须调 function call，口头描述 ≠ 完成
- 调用工具后失败时诚实告知原因

# 格式约束
- 风格模板使用 YAML 格式（.yaml 后缀）
- dimensions 每个维度含: {description(100-300字), examples(≥3条原文), writingRules(≥3条), vocabularyList(≥10词)}
- 必填11维度: narrativeTone,sentenceStyle,vocabularyStyle,rhetoricStyle,rhythmStyle,dialogueStyle,moodStyle,perspectiveStyle,bodyLanguageStyle,sensoryStyle,descriptionPattern
- 信号强度: ★★★强→详填(200-400字/3-5例句/10+词) ★★中→标准 ★弱→简要 ☆无信号→跳过
- 禁止传空dimensions！有信号必须填！

# 场景模板
- YAML 格式（.yaml后缀）
- 必填: name, type, sceneType, plotOverview(200-500字)
- 不确定字段列入 autoFields 数组`

// ════════════════════════════════════════════════════════
// API + Agent 循环
// ════════════════════════════════════════════════════════

async function callAnthropic(sys, msgs, tds) {
  const body = { model: 'deepseek-v4-flash', system: [{ type: 'text', text: sys }], messages: msgs, max_tokens: 4096, stream: true }
  if (tds?.length) body.tools = tds.map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema }))
  const r = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  })
  return parseSSE(await r.text())
}

function parseSSE(text) {
  let ft = ''; const tus = []; const bs = []
  for (const c of text.split(/\n\n/)) {
    if (!c.trim()) continue
    let d = '', et = ''
    for (const l of c.split('\n')) {
      if (l.startsWith('event:')) et = l.slice(6).trim()
      else if (l.startsWith('data:')) d = l.slice(5).trim()
    }
    if (!d) continue
    try {
      const e = JSON.parse(d); const t = et || e.type || ''
      if (t === 'content_block_start') bs.push({ ...e.content_block, index: e.index, inputJson: '' })
      else if (t === 'content_block_delta') {
        const b = bs.find(b => b.index === (e.index ?? bs.length - 1))
        if (!b) continue
        if (e.delta?.type === 'text_delta') { b.text = (b.text || '') + e.delta.text; ft += e.delta.text }
        if (e.delta?.type === 'input_json_delta') { b.inputJson = (b.inputJson || '') + e.delta.partial_json; try { b.input = JSON.parse(b.inputJson) } catch {} }
      } else if (t === 'content_block_stop') {
        const b = bs.find(b => b.index === (e.index ?? bs.length - 1))
        if (b?.type === 'tool_use') tus.push({ id: b.id, name: b.name, input: b.input || {} })
      }
    } catch {}
  }
  return { text: ft, toolUses: tus }
}

async function run(msg) {
  const ms = [{ role: 'user', content: [{ type: 'text', text: msg }] }]
  let it = 0, tt = 0
  while (it < 20) {
    it++
    const r = await callAnthropic(SYS, ms, SCHEMAS)
    if (!r.toolUses.length) return { ...r, iterations: it, toolCalls: tt }
    const ac = []
    if (r.text) ac.push({ type: 'text', text: r.text })
    for (const tu of r.toolUses) ac.push({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input })
    ms.push({ role: 'assistant', content: ac })
    const trs = []
    for (const tu of r.toolUses) {
      const tf = tools[tu.name]
      const res = tf ? await tf(tu.input) : { status: 'error', summary: '未知工具' }
      tt++
      trs.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(res) })
      process.stdout.write(res.status === 'success' ? '✓' : '✗')
    }
    ms.push({ role: 'user', content: trs })
  }
  return { text: '', iterations: it, toolCalls: tt }
}

// ════════════════════════════════════════════════════════
// 测试
// ════════════════════════════════════════════════════════

let pass = 0, fail = 0
function t(n, c, d) { if (c) { pass++; console.log('  ✅ ' + n + (d ? ': ' + d : '')) } else { fail++; console.log('  ❌ ' + n + (d ? ': ' + d : '')) } }

console.log('═══════════════════════════════════════════')
console.log('  L3 模板创建完整链路测试')
console.log('═══════════════════════════════════════════\n')

// ── 准备测试数据 ──
const UPLOAD = p => path.join(ROOT, 'uploads/files', p)
fs.mkdirSync(path.join(ROOT, 'uploads/files'), { recursive: true })
fs.writeFileSync(UPLOAD('style_test.txt'),
  '夜色如墨，雨丝如刀。他站在废弃仓库的屋檐下，雨水顺着破败的瓦片滴落，在脚边溅起细碎的水花。' +
  '风从破碎的窗户灌进来，带着铁锈和腐朽木料的气味。他的手按在腰间剑柄上，指节因用力而发白。' +
  '远处有脚步声，很轻，但在这雨夜里格外清晰——来了。' +
  '他没有回头，只是微微侧身，右手的拇指已将剑推出鞘半分。剑身映着远处昏黄的路灯，泛着冷冽的青光。' +
  '雨滴打在剑身上，发出清脆的声响，像是某种古老的韵律。他深吸一口气，空气中混杂着铁锈、雨水、还有——血腥味。' +
  '三道人影从不同方向缓缓逼近。他们的脚步很轻，轻得像猫，但雨水出卖了他们——每一脚落下，都在积水里激起涟漪。' +
  '他的嘴角微微上扬。这种包围，他见过无数次了。', 'utf-8')

// ═══ T1: 风格模板创建（完整校验链路） ═══
console.log('┌─ T1 风格模板完整链路 ────────────────────┐')
const t1 = await run('先读 uploads/files/style_test.txt 分析文风，然后创建风格模板。name="侠客雨夜风"、type="武侠小说"、worldType="古代"。dimensions 用英文维度key（如 narrativeTone, sentenceStyle, vocabularyStyle），每个维度含 description(100-300字分析)、examples(2-3条原文摘录)、writingRules(2-3条)、vocabularyList(5-8词)。必填11维度全部要填。禁止传空dimensions！')
t('T1-1 工具调用', t1.toolCalls >= 2, t1.iterations + '轮 ' + t1.toolCalls + '工具')

// 检查 YAML 文件
const t1File = ST('侠客雨夜风.yaml')
const t1Exists = fs.existsSync(t1File)
t('T1-2 YAML 文件存在', t1Exists, t1File)

if (t1Exists) {
  try {
    const t1Data = yaml.load(fs.readFileSync(t1File, 'utf-8'))
    t('T1-3 有 id', !!t1Data.id, t1Data.id)
    t('T1-4 有时间戳', !!t1Data.createdAt, t1Data.createdAt?.slice(0, 10))
    t('T1-5 source=ai-generated', t1Data.source === 'ai-generated', t1Data.source)

    const dimKeys = Object.keys(t1Data.dimensions || {})
    t('T1-6 dimensions 非空', dimKeys.length > 0, dimKeys.length + '维度')

    const hasEngKey = dimKeys.some(k => /^[a-z]/i.test(k))
    t('T1-7 英文维度 key', hasEngKey, hasEngKey ? '✅' : '全部中文')

    const required = ['narrativeTone','sentenceStyle','vocabularyStyle','rhetoricStyle','rhythmStyle','dialogueStyle','moodStyle','perspectiveStyle','bodyLanguageStyle','sensoryStyle','descriptionPattern']
    const missing = required.filter(k => !dimKeys.includes(k))
    t('T1-8 含必填维度', missing.length <= 3, missing.length > 0 ? '缺: ' + missing.join(',') : '全含')

    t('T1-9 vocabularyList 聚合', Array.isArray(t1Data.vocabularyList) && t1Data.vocabularyList.length > 0, t1Data.vocabularyList?.length + '词')
    t('T1-10 writingRules 聚合', Array.isArray(t1Data.writingRules) && t1Data.writingRules.length > 0, t1Data.writingRules?.length + '规则')

    // 逐维度检查内容质量
    let dimsWithDescription = 0, dimsWithExamples = 0, dimsWithRules = 0, dimsWithVocab = 0
    for (const [k, v] of Object.entries(t1Data.dimensions || {})) {
      if (v.description?.length >= 20) dimsWithDescription++
      if (Array.isArray(v.examples) && v.examples.length >= 2) dimsWithExamples++
      if (Array.isArray(v.writingRules) && v.writingRules.length >= 1) dimsWithRules++
      if (Array.isArray(v.vocabularyList) && v.vocabularyList.length >= 3) dimsWithVocab++
    }
    t('T1-11 维度质量', dimsWithDescription >= 3 && dimsWithExamples >= 2,
      `desc≥20字:${dimsWithDescription} 例句≥2:${dimsWithExamples} 规则≥1:${dimsWithRules} 词≥3:${dimsWithVocab} / ${dimKeys.length}维`)
  } catch (e) {
    t('T1-ERR YAML 解析失败', false, e.message)
  }
}
console.log('└─────────────────────────────────────────┘')

// ═══ T2: 场景模板创建（完整校验链路） ═══
console.log('\n┌─ T2 场景模板完整链路 ────────────────────┐')
const t2 = await run('创建一个武侠小说场景模板：雨夜仓库对峙。name="雨夜仓库对峙"、type="武侠小说"、sceneType="战斗"、plotOverview="主角在废弃仓库遭遇三名杀手，在雨夜中展开一场以少对多的生死对决。氛围紧张压抑，雨水和昏暗灯光营造出强烈的电影感。"、characters=["主角(冷静警惕)","杀手甲(凶狠)","杀手乙(谨慎)","杀手丙(急躁)"]、location="城西废弃仓库"、atmosphere="紧张压抑"、wordTarget=3000')
t('T2-1 工具调用', t2.toolCalls >= 1, t2.iterations + '轮 ' + t2.toolCalls + '工具')

const t2File = SC('雨夜仓库对峙.yaml')
const t2Exists = fs.existsSync(t2File)
t('T2-2 YAML 文件存在', t2Exists, t2File)

if (t2Exists) {
  try {
    const t2Data = yaml.load(fs.readFileSync(t2File, 'utf-8'))
    t('T2-3 有 id', !!t2Data.id, t2Data.id)
    t('T2-4 有 config', !!t2Data.config, '✅')
    t('T2-5 sceneType 正确', t2Data.config?.sceneType === '战斗', t2Data.config?.sceneType)
    t('T2-6 plotOverview 非空', (t2Data.config?.plotOverview || '').length > 0, (t2Data.config?.plotOverview || '').slice(0, 50))
    t('T2-7 characters 有值', Array.isArray(t2Data.config?.characters) && t2Data.config.characters.length > 0, t2Data.config?.characters?.length + '人')
  } catch (e) {
    t('T2-ERR YAML 解析失败', false, e.message)
  }
}
console.log('└─────────────────────────────────────────┘')

// ═══ T3: 校验失败场景 ═══
console.log('\n┌─ T3 校验失败处理 ────────────────────────┐')
const t3 = await run('创建风格模板，name="空测试模板"、type="普通小说"、dimensions 是一个空对象 {}。看看系统会不会拒绝。')
t('T3-1 拒绝空 dimensions', t3.toolCalls >= 1, t3.iterations + '轮 ' + t3.toolCalls + '工具')
// 空 dimensions 应该被校验拒绝
const t3File = ST('空测试模板.yaml')
const t3Rejected = !fs.existsSync(t3File)
t('T3-2 已拒绝空dimensions', t3Rejected, t3Rejected ? '校验已拦截' : '⚠ 文件仍被创建')
console.log('└─────────────────────────────────────────┘')

// ═══ 结果 ═══
const tt = pass + fail
console.log('\n═══════════════════════════════════════════')
console.log('  L3 模板创建测试结果')
console.log('═══════════════════════════════════════════')
console.log('  ✅ ' + pass + '  ❌ ' + fail + '  通过率: ' + ((pass / tt) * 100).toFixed(1) + '%')

// 清理
try { fs.unlinkSync(ST('侠客雨夜风.yaml')) } catch {}
try { fs.unlinkSync(SC('雨夜仓库对峙.yaml')) } catch {}
try { fs.unlinkSync(ST('空模板.yaml')) } catch {}
try { fs.unlinkSync(UPLOAD('style_test.txt')) } catch {}
