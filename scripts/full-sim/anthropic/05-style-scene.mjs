#!/usr/bin/env node
/**
 * 仿真测试: 风格+场景模板组合 (Anthropic 协议)
 * 使用 Anthropic Messages API 替代 OpenAI chat/completions。
 *
 * 关键差异 (vs OpenAI):
 *   - system 作为顶层参数传递 [{type:'text',text:'...'}]
 *   - 消息使用 content 数组格式 [{type:'text',...}, {type:'tool_use',...}]
 *   - 工具响应作为 tool_result block 放在 user 消息中
 *   - 非流式: stream: false，解析 JSON response
 *
 * 场景: 读取测试文本 → 分析文风 → 创建风格模板 → 创建场景模板
 * 验证: read_file → create_style_template → create_scene_template，两个模板文件都创建了
 * 复杂度: medium
 *
 * 运行: node scripts/full-sim/anthropic/05-style-scene.mjs
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

// ── 配置 ──
const API_KEY = 'sk-c9c30831df7243209435c60e811c879d'
const BASE_URL = 'https://api.deepseek.com'
const MODEL = 'deepseek-v4-flash'
const MAX_ITERATIONS = 8

const API_URL = BASE_URL + '/anthropic/v1/messages'

const ROOT = path.resolve(import.meta.dirname || '.', '..', '..', '..')
const P  = p => path.join(ROOT, 'projects', p)
const ST = p => path.join(ROOT, 'style_templates', p)
const SC = p => path.join(ROOT, 'scene_templates', p)

console.log('═══════════════════════════════════════════')
console.log('  仿真测试: 风格+场景模板 (05-style-scene) — Anthropic 协议')
console.log('  端点: ' + API_URL)
console.log('  模型: ' + MODEL)
console.log('  模式: 非流式 JSON — read_file → create_style_template → create_scene_template')
console.log('═══════════════════════════════════════════')

// ── 准备测试数据 ──
function seedTestData() {
  const projDir = P('1')
  fs.mkdirSync(projDir, { recursive: true })

  const sampleProse = [
    '夜已深，窗外的梧桐叶在秋风中簌簌作响。',
    '',
    '沈清雪独坐灯前，手中握着一卷泛黄的古籍。烛火摇曳，在她清冷的侧脸上投下忽明忽暗的光影。她微微蹙眉，指尖在书页上轻轻划过，似乎在寻找什么。',
    '',
    '"师姐。"门外传来一声轻唤。',
    '',
    '沈清雪抬起头，目光淡淡地扫过房门。"进来。"',
    '',
    '门被推开，进来的是一个身着青色道袍的少女。她眉目清秀，眼中带着几分不安。',
    '',
    '"许倩，这么晚了还不歇息？"沈清雪的声音平静如水，听不出情绪。',
    '',
    '许倩低下头，手指不自觉地绞着衣角。"我......我睡不着。"',
    '',
    '沈清雪凝视她片刻，忽然轻轻叹了一口气。"过来坐吧。"',
    '',
    '许倩依言在旁边的蒲团上坐下。烛光映照在她年轻的脸上，映出一种青涩的坚定。',
    '',
    '"师姐，你说修仙之人，到底修的是什么？"',
    '',
    '沈清雪沉默良久，将手中的古籍合上。',
    '',
    '"修的是心。"她的声音很轻，却像落在水面的石子，在寂静的夜里荡开涟漪。',
    '',
    '窗外，一片梧桐叶悄然落下。',
    '',
    '【文风特征】',
    '- 节奏: 舒缓沉静，句子长短交替',
    '- 意象: 古风意象丰富（梧桐、烛火、古籍、道袍、蒲团）',
    '- 对话: 简洁含蓄，言有尽而意无穷',
    '- 描写: 侧重环境和神态，内心活动通过外部动作暗示',
    '- 视角: 第三人称有限视角，偏重清冷氛围',
    '- 语体: 文白夹杂，古韵典雅',
    '',
    '【场景信息】',
    '- 地点: 修仙宗门静室，烛光映照',
    '- 时间: 深夜',
    '- 氛围: 静谧清冷，带哲思意味',
    '- 人物: 沈清雪（师姐，清冷内敛）与许倩（师妹，青涩坚定）',
    '- 冲突: 内心迷茫 vs 修行真谛',
  ].join('\n')

  fs.writeFileSync(path.join(projDir, 'test_text.txt'), sampleProse)
  console.log('  [初始化] 测试文本已创建 (projects/1/test_text.txt)')
}

// ── 工具实现 ──
const VALID_SCENE_TYPES = [
  '情色小说', '奇幻', '都市小说', '修仙小说', '武侠小说', '恋爱小说',
  '古风小说', '悬疑小说', '历史小说', '科幻小说', '玄幻小说', '灵异小说',
  '轻小说', '普通小说', '穿越小说', '末世小说', '游戏小说',
]

const tools = {
  read_file: a => {
    try {
      const fp = a.file_path || a.path || ''
      const c = fs.readFileSync(P(fp), 'utf-8')
      return c.length > 3000 ? c.slice(0, 3000) + '\n…(' + c.length + '字)' : c
    } catch (e) {
      return '[错误: 文件不存在 — ' + fp + ']'
    }
  },

  list_directory: a => {
    try {
      const dir = a.path || a.dir_path || '.'
      const entries = fs.readdirSync(P(dir), { withFileTypes: true })
      return entries.map(e => (e.isDirectory() ? 'DIR  ' : 'FILE ') + e.name).join('\n') || '目录为空'
    } catch (e) {
      return '[错误: 目录不存在]'
    }
  },

  search_content: a => {
    try {
      return '搜索: ' + (a.pattern || '') + ' → 无匹配 (测试环境)'
    } catch { return '[错误]' }
  },

  create_file: a => {
    try {
      const fp = P(a.file_path)
      fs.mkdirSync(path.dirname(fp), { recursive: true })
      fs.writeFileSync(fp, a.content || '')
      return '创建成功: ' + a.file_path
    } catch (e) { return '[错误: ' + e.message + ']' }
  },

  create_style_template: a => {
    try {
      const name = (a.name || '').trim()
      const type = (a.type || '').trim()
      if (!name) return '[错误: name 是必填字段]'
      if (!type) return '[错误: type 是必填字段]'
      const fp = ST(name + '.json')
      fs.mkdirSync(path.dirname(fp), { recursive: true })
      const template = {
        name,
        type,
        description: a.description || '',
        dimensions: a.dimensions || {},
        created_at: new Date().toISOString(),
      }
      fs.writeFileSync(fp, JSON.stringify(template, null, 2))
      return '风格模板创建成功: "' + name + '" (类型: ' + type + ') 已保存到 style_templates/' + name + '.json'
    } catch (e) { return '[错误: ' + e.message + ']' }
  },

  create_scene_template: a => {
    try {
      const name = String(a.name || '未命名场景模板').trim()
      const type = String(a.type || '普通小说').trim()

      if (!VALID_SCENE_TYPES.includes(type)) {
        return '[错误: 无效的小说类型"' + type + '"。有效值: ' + VALID_SCENE_TYPES.join('|') + ']'
      }

      const arr = (v) => Array.isArray(v) ? v.map(x => typeof x === 'object' ? x : String(x)) : []
      const str = (v, d) => typeof v === 'string' ? v : (v != null ? String(v) : d || '')

      // 处理 characters
      let characters = []
      const c = a.characters
      if (Array.isArray(c)) {
        characters = c.map(x =>
          typeof x === 'object' ? x : { characterId: '', characterName: String(x), emotion: '' }
        )
      } else if (typeof c === 'string' && c.trim()) {
        characters = c.split(/[；;]/).map(s => s.trim()).filter(Boolean).map(s => {
          const m = s.match(/^(.+?)[:：](.+)$/)
          return m
            ? { characterId: '', characterName: m[1].trim(), emotion: m[2].trim() }
            : { characterId: '', characterName: s, emotion: '' }
        })
      }

      const af = arr(a.autoFields)
      let autoFields = {}
      if (af.length > 0) {
        for (const f of af) autoFields[f] = true
      }

      const id = 'sc_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6)
      const now = new Date().toISOString()

      const config = {
        sceneType: str(a.sceneType, '日常'),
        scenePurpose: arr(a.scenePurpose),
        conflictType: str(a.conflictType),
        povCharacterId: '',
        povCharacterName: '',
        characters,
        location: str(a.location),
        time: str(a.time, '不限'),
        weather: str(a.weather, '不限'),
        atmosphere: str(a.atmosphere),
        publicity: '私密',
        wordTarget: Number(a.wordTarget) || 3000,
        narrativePOV: str(a.narrativePOV, '第三人称'),
        pacing: str(a.pacing, '渐进'),
        bodyLanguage: str(a.bodyLanguage),
        detail: str(a.detail),
        extraNote: str(a.extraNote),
        autoFields,
        // 情色字段
        intensity: Number(a.intensity) || 0,
        selectedKinks: arr(a.selectedKinks),
        kinkNote: '',
        opening: arr(a.opening),
        mainPose: '', mainRhythm: '', poseChanges: '',
        climax: arr(a.climax),
        aftermath: arr(a.aftermath),
        soundDensity: str(a.soundDensity),
        moanStyle: str(a.moanStyle),
        degradeLangs: arr(a.degradeLangs),
        streamMode: true, replaceMode: true, useStyleProfile: true, useChapterOutline: true,
        kinkIntensities: {}, customKink: '', customCharacters: [],
        customLocation: '', customTime: '', customAtmosphere: '', customPublicity: '',
        extraPhases: [], customInsults: '', bannedWords: '',
        customPoses: [], customRhythms: [], customPOVs: '',
        customOpening: [], customClimax: [], customAftermath: [], customDegradeLangs: [],
        bodyFluidFocus: arr(a.bodyFluidFocus),
        bodyPartFocus: arr(a.bodyPartFocus),
        tactileFocus: arr(a.tactileFocus),
        narrativeStyle: '', timeCompression: '', introspection: '',
        sensoryAnchors: str(a.sensoryAnchors),
        dominantEmotion: str(a.dominantEmotion),
        emotionCurveInput: str(a.emotionCurveInput),
        triggerWords: '', worldRules: '', propList: '', costumeList: '',
        customExtraNotes: '', customEmotions: '', customCurves: '', customTriggers: '',
        customWorldRules: '', customPropLists: '', customCostumeLists: '',
        customPoseChanges: '', customSoundDensity: '', customMoanStyle: '',
        consentDynamic: '', aftercareDetail: '',
        senses: arr(a.senses || ['视觉', '听觉', '触觉']),
        dialogueRatio: '', subtextLevel: '', sentenceStyle: '', paragraphDensity: '',
        emotionStart: '', emotionEnd: '',
        props: str(a.props),
        appearance: str(a.appearance),
        foreshadowUse: '',
        sceneTurningPoint: str(a.sceneTurningPoint),
        plotOverview: str(a.plotOverview),
      }

      const tmpl = {
        id,
        name,
        type,
        createdAt: now,
        updatedAt: now,
        config,
        source: 'ai-generated',
      }

      const jsonStr = JSON.stringify(tmpl, null, 2)
      try { JSON.parse(jsonStr) } catch (e) {
        return '[JSON格式错误: ' + e.message + ']'
      }

      const fp = SC(name + '.json')
      fs.mkdirSync(path.dirname(fp), { recursive: true })
      fs.writeFileSync(fp, jsonStr, 'utf-8')
      return '已创建场景模板: "' + name + '" (ID: ' + id + ', 类型: ' + type + ')'
    } catch (e) {
      return '[错误: 创建场景模板失败 — ' + e.message + ']'
    }
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
}

// ── Anthropic 格式工具定义 ──
const TOOLS = [
  {
    name: 'read_file',
    description: '读取项目文件内容。路径格式: {项目}/目录/文件名。例: 1/test_text.txt',
    input_schema: {
      type: 'object',
      properties: { file_path: { type: 'string', description: '文件相对路径（相对于项目目录）' } },
      required: ['file_path'],
    },
  },
  {
    name: 'list_directory',
    description: '列出指定目录中的所有文件和子目录',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: '目录路径' } },
      required: ['path'],
    },
  },
  {
    name: 'search_content',
    description: '在项目文件中搜索关键词或正则表达式',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: '搜索关键词' },
        path: { type: 'string', description: '搜索路径' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'create_file',
    description: '创建新文件',
    input_schema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: '文件相对路径' },
        content: { type: 'string', description: '文件内容' },
      },
      required: ['file_path', 'content'],
    },
  },
  {
    name: 'create_style_template',
    description: '创建风格模板。分析文本后，提取其文风特征，创建可复用的写作风格模板。必填: name, type。type 可选: 修仙小说|武侠小说|都市小说|玄幻小说|科幻小说 等。dimensions 为文风维度对象，如 {sentence_rhythm:"舒缓", imagery_density:"高", dialogue_style:"含蓄", perspective:"第三人称有限"}。',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '模板名称' },
        type: { type: 'string', description: '模板类型，如 修仙小说、武侠小说' },
        description: { type: 'string', description: '模板描述' },
        dimensions: {
          type: 'object',
          description: '文风维度对象，包含 rhythm(节奏)、imagery(意象密度)、dialogue_style(对话风格)、description_style(描写方式)、perspective(叙事视角)、language_style(语体风格) 等',
        },
      },
      required: ['name', 'type'],
    },
  },
  {
    name: 'create_scene_template',
    description:
      '创建场景模板并保存到 scene_templates/。根据文本分析创建。' +
      '必填: name(模板名称), type(小说类型: ' + VALID_SCENE_TYPES.join('|') + ')。' +
      '选填: sceneType(日常|战斗|对话|内心独白|过渡|高潮), conflictType, scenePurpose[], ' +
      'characters(数组[{characterId,characterName,emotion}]), location, time, weather, atmosphere, ' +
      'wordTarget, narrativePOV, pacing, bodyLanguage, detail, extraNote, plotOverview, sceneTurningPoint, ' +
      'props, appearance, sensoryAnchors, dominantEmotion, emotionCurveInput。' +
      'autoFields: 不确定的字段名列入此数组。',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '模板名称' },
        type: { type: 'string', description: '小说类型。有效值: ' + VALID_SCENE_TYPES.join('|') },
        sceneType: { type: 'string', description: '场景类型: 日常|战斗|对话|内心独白|过渡|高潮' },
        conflictType: { type: 'string', description: '冲突类型' },
        scenePurpose: { type: 'array', items: { type: 'string' }, description: '场景目的列表' },
        characters: {
          type: 'array',
          items: {
            type: 'object',
            properties: { characterId: { type: 'string' }, characterName: { type: 'string' }, emotion: { type: 'string' } },
          },
          description: '出场角色及情绪',
        },
        location: { type: 'string', description: '场景地点描述' },
        time: { type: 'string', description: '时间' },
        weather: { type: 'string', description: '天气' },
        atmosphere: { type: 'string', description: '氛围描述' },
        wordTarget: { type: 'number', description: '目标字数' },
        narrativePOV: { type: 'string', description: '叙事视角' },
        pacing: { type: 'string', description: '节奏控制' },
        bodyLanguage: { type: 'string', description: '肢体语言描写重点' },
        detail: { type: 'string', description: '详细场景配置' },
        extraNote: { type: 'string', description: '额外要求' },
        autoFields: { type: 'array', items: { type: 'string' }, description: '不确定的字段名列表' },
        plotOverview: { type: 'string', description: '场景剧情概述' },
        sceneTurningPoint: { type: 'string', description: '场景转折点' },
        props: { type: 'string', description: '场景道具' },
        appearance: { type: 'string', description: '人物外貌描述' },
        sensoryAnchors: { type: 'string', description: '感官锚点' },
        dominantEmotion: { type: 'string', description: '主导情绪' },
        emotionCurveInput: { type: 'string', description: '情绪曲线' },
        // 情色专属
        intensity: { type: 'number', description: '情色浓度 1-5' },
        selectedKinks: { type: 'array', items: { type: 'string' }, description: '玩法标签' },
        opening: { type: 'array', items: { type: 'string' }, description: '开场描写要点' },
        climax: { type: 'array', items: { type: 'string' }, description: '高潮描写要点' },
        aftermath: { type: 'array', items: { type: 'string' }, description: '余韵描写要点' },
        soundDensity: { type: 'string', description: '声音密度: 低|中|高|极高' },
        moanStyle: { type: 'string', description: '呻吟风格' },
        degradeLangs: { type: 'array', items: { type: 'string' }, description: '羞辱语言' },
        bodyFluidFocus: { type: 'array', items: { type: 'string' }, description: '体液描写重点' },
        bodyPartFocus: { type: 'array', items: { type: 'string' }, description: '身体部位描写重点' },
        tactileFocus: { type: 'array', items: { type: 'string' }, description: '触觉描写重点' },
      },
      required: ['name', 'type'],
    },
  },
  {
    name: 'edit_file',
    description: '编辑文件内容（精确字符串替换）',
    input_schema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: '文件路径' },
        old_string: { type: 'string', description: '要替换的原文' },
        new_string: { type: 'string', description: '替换后的新文本' },
      },
      required: ['file_path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'delete_file',
    description: '删除文件',
    input_schema: {
      type: 'object',
      properties: { file_path: { type: 'string', description: '文件路径' } },
      required: ['file_path'],
    },
  },
]

// ── 系统提示词 ──
const SYS = [
  '你是"青剑"，AI小说创作助手。',
  '',
  '# 铁律',
  '- 操作文件必须调用实际的 function call，口头描述 ≠ 操作完成',
  '- 禁止在文本中用 <tool_name>、[工具名]、或任何 XML/JSON 文本块来模拟工具调用',
  '- 创建风格模板用 create_style_template，创建场景模板用 create_scene_template',
  '',
  '# 风格+场景模板创建流程',
  '1. 用户要求分析文风时，先用 read_file 读取指定文件',
  '2. 分析文本的文风特征：节奏、意象、对话风格、描写方式、语体、视角等维度',
  '3. 使用 create_style_template 创建风格模板，提供 name、type、dimensions',
  '4. 基于文本的场景信息，使用 create_scene_template 创建场景模板',
  '5. 两个模板创建完成后，汇报结果',
  '',
  '# 工具调用规则',
  '- 仅在用户明确要求操作项目文件时才调用工具',
  '- 多个独立操作可在同一轮并行完成',
  '- 有依赖的操作分轮执行（先读后创建）',
  '- 不确定文件在哪 → list_directory',
  '- 已知文件路径 → 直接 read_file',
  '- 修改文件 → 先 read_file 确认原文，再 edit_file',
  '',
  '# 路径',
  '用户文件: projects/1/test_text.txt',
  '风格模板保存在: style_templates/ 目录',
  '场景模板保存在: scene_templates/ 目录',
  '',
  '# 对话风格',
  '- 用中文回复，简洁明了。',
  '- 操作完成后简要说明结果。',
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
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + API_KEY,
    },
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
      const result = toolFn ? await toolFn(tu.input) : '[未知工具: ' + tu.name + ']'
      const ok = typeof result === 'string' && !result.startsWith('[')
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
  console.log('\n' + '─'.repeat(55))
  console.log('  ' + title)
  console.log('─'.repeat(55))
}

// ── 辅助 ──
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ── 清理 ──
function cleanup() {
  try { fs.rmSync(P('1'), { recursive: true, force: true }) } catch {}
  try { fs.rmSync(ST(''), { recursive: true, force: true }) } catch {}
  try { fs.rmSync(SC(''), { recursive: true, force: true }) } catch {}
}

// ── 测试场景 ──
async function main() {
  // 清理旧数据并初始化
  cleanup()
  seedTestData()

  // ═══════════════════════════════════════════════
  // S1: 分析文风 + 创建风格模板 + 创建场景模板
  // ═══════════════════════════════════════════════
  hr('S1 风格+场景组合 — 读取文本 → 创建风格模板 → 创建场景模板')
  const r1 = await agentRun(
    '分析 projects/1/test_text.txt 的文风特征，创建一个风格模板叫"古风仙侠"，类型选"修仙小说"。' +
    '再基于这个文本创建一个场景模板叫"仙侠战斗场景"，类型也是"修仙小说"'
  )

  t('S1 返回文本', r1.text.length > 0, r1.text.length + '字')
  t('S1 read_file 被调用', r1.toolLog.some(l => l.name === 'read_file'),
    r1.toolLog.filter(l => l.name === 'read_file').length + '次')
  t('S1 read_file 调用成功', r1.toolLog.some(l => l.name === 'read_file' && l.ok),
    '读取成功')
  t('S1 create_style_template 被调用', r1.toolLog.some(l => l.name === 'create_style_template'),
    r1.toolLog.filter(l => l.name === 'create_style_template').length + '次')
  t('S1 create_style_template 调用成功', r1.toolLog.some(l => l.name === 'create_style_template' && l.ok),
    '创建成功')
  t('S1 create_scene_template 被调用', r1.toolLog.some(l => l.name === 'create_scene_template'),
    r1.toolLog.filter(l => l.name === 'create_scene_template').length + '次')
  t('S1 create_scene_template 调用成功', r1.toolLog.some(l => l.name === 'create_scene_template' && l.ok),
    '创建成功')
  t('S1 迭代次数合理', r1.iterations <= MAX_ITERATIONS, r1.iterations + '轮 (上限' + MAX_ITERATIONS + ')')

  // 验证执行顺序: read_file 应先于 create_style_template 和 create_scene_template
  const readIdx = r1.toolLog.findIndex(l => l.name === 'read_file')
  const styleIdx = r1.toolLog.findIndex(l => l.name === 'create_style_template')
  const sceneIdx = r1.toolLog.findIndex(l => l.name === 'create_scene_template')
  const orderOk = readIdx >= 0 && readIdx < Math.min(
    styleIdx >= 0 ? styleIdx : Infinity,
    sceneIdx >= 0 ? sceneIdx : Infinity
  )
  t('S1 执行顺序正确 (先读后创建)', orderOk,
    'read_file在第' + (readIdx + 1) + '位, style在第' + (styleIdx + 1) + '位, scene在第' + (sceneIdx + 1) + '位')

  // 验证风格模板文件
  const styleTemplatePath = ST('古风仙侠.json')
  const styleFileExists = fs.existsSync(styleTemplatePath)
  let styleFileValid = false
  if (styleFileExists) {
    try {
      const st = JSON.parse(fs.readFileSync(styleTemplatePath, 'utf-8'))
      styleFileValid = st.name === '古风仙侠' && st.type === '修仙小说'
    } catch {}
  }
  t('S1 风格模板文件已创建', styleFileExists, 'style_templates/古风仙侠.json')
  t('S1 风格模板内容正确', styleFileValid, styleFileValid ? 'name=古风仙侠, type=修仙小说' : '内容校验失败')

  // 验证场景模板文件
  const sceneTemplatePath = SC('仙侠战斗场景.json')
  const sceneFileExists = fs.existsSync(sceneTemplatePath)
  let sceneFileValid = false
  if (sceneFileExists) {
    try {
      const sct = JSON.parse(fs.readFileSync(sceneTemplatePath, 'utf-8'))
      sceneFileValid = sct.name === '仙侠战斗场景' && sct.type === '修仙小说'
    } catch {}
  }
  t('S1 场景模板文件已创建', sceneFileExists, 'scene_templates/仙侠战斗场景.json')
  t('S1 场景模板内容正确', sceneFileValid, sceneFileValid ? 'name=仙侠战斗场景, type=修仙小说' : '内容校验失败')

  // 两个模板文件都创建了
  t('S1 两个模板文件都创建了', styleFileExists && sceneFileExists,
    '风格: ' + (styleFileExists ? '✓' : '✗') + ' 场景: ' + (sceneFileExists ? '✓' : '✗'))

  console.log('    工具调用: ' + r1.toolLog.map(l => l.name + (l.ok ? '✓' : '✗')).join(', '))
  console.log('    回复: ' + r1.text.slice(0, 200))

  await sleep(300)

  // ═══════════════════════════════════════════════
  // S2: 闲聊防误调 — 纯对话不应触发工具
  // ═══════════════════════════════════════════════
  hr('S2 闲聊防误调 — 纯对话不应触发工具')
  const r2a = await agentRun('你好，请问风格模板和场景模板有什么区别？')
  t('S2a 文本回复', r2a.text.length > 0, r2a.text.length + '字')
  t('S2a 零工具调用', r2a.toolCalls === 0, r2a.toolCalls + '个工具')

  await sleep(300)

  const r2b = await agentRun('我喜欢修仙小说，这个软件好用吗？')
  t('S2b 文本回复', r2b.text.length > 0, r2b.text.length + '字')
  t('S2b 零工具调用', r2b.toolCalls === 0, r2b.toolCalls + '个工具')

  // ── 清理 ──
  cleanup()

  // ── 汇总 ──
  const total = pass + fail
  console.log('\n')
  console.log('═══════════════════════════════════════════')
  console.log('  仿真测试: 风格+场景模板 (Anthropic 协议) — 结果')
  console.log('═══════════════════════════════════════════')
  console.log('  ✅ ' + pass + '  通过')
  console.log('  ❌ ' + fail + '  失败')
  console.log('  通过率: ' + (total > 0 ? ((pass / total) * 100).toFixed(1) : '0.0') + '%')
  console.log('')
  console.log('  场景覆盖:')
  console.log('    S1  风格+场景组合 — read_file → create_style_template → create_scene_template')
  console.log('    S2  闲聊防误调 — 纯对话零工具调用')
  console.log('  工具覆盖: read_file create_style_template create_scene_template')
  console.log('═══════════════════════════════════════════')

  if (fail > 0) process.exit(1)
}

main().catch(e => {
  console.error('\n测试异常:', e.message)
  console.error(e.stack)
  cleanup()
  process.exit(1)
})
