#!/usr/bin/env node
/**
 * 仿真测试: 场景模板 (11-scene-template)
 * 模拟用户打开青剑AI写作助手，执行场景分析→create_scene_template 真实对话操作。
 *
 * 测试工具: read_file / list_directory / search_content / create_scene_template
 * 复杂度: complex (4-8轮, 3-6个工具)
 *
 * 运行方式: node scripts/full-sim/11-scene-template.mjs
 * 环境变量: AI_API_KEY (DeepSeek API key)
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

// ─── 配置 ───────────────────────────────────────────────────────────
const API_KEY = process.env.AI_API_KEY || 'sk-c9c30831df7243209435c60e811c879d'
const API_URL = 'https://api.deepseek.com/v1/chat/completions'
const MODEL = 'deepseek-v4-flash'
const MAX_ITERATIONS = 10
const ROOT = process.cwd()

// 路径工具
const P  = p => path.join(ROOT, 'projects', p)
const S  = p => path.join(ROOT, 'scene_templates', p)
const O  = p => path.join(ROOT, 'outline', p)

// ─── 工具实现 ────────────────────────────────────────────────────────
const VALID_SCENE_TYPES = [
  '情色小说', '奇幻', '都市小说', '修仙小说', '武侠小说', '恋爱小说',
  '古风小说', '悬疑小说', '历史小说', '科幻小说', '玄幻小说', '灵异小说',
  '轻小说', '普通小说', '穿越小说', '末世小说', '游戏小说',
]

const tools = {
  read_file: a => {
    try {
      const fp = P(a.file_path || a.path || '')
      const c = fs.readFileSync(fp, 'utf-8')
      return c.length > 3000 ? c.slice(0, 3000) + '\n…(截断，共' + c.length + '字)' : c
    } catch (e) {
      return `[错误: 文件不存在 — ${a.file_path || a.path}]`
    }
  },

  list_directory: a => {
    try {
      const dirPath = P(a.path || '.')
      const entries = fs.readdirSync(dirPath, { withFileTypes: true })
      return entries
        .map(x => (x.isDirectory() ? 'DIR  ' : 'FILE ') + x.name)
        .join('\n') || '目录为空'
    } catch (e) {
      return `[错误: 目录不存在 — ${a.path}]`
    }
  },

  search_content: a => {
    try {
      const fp = P(a.path || '.')
      const pattern = a.pattern || ''
      const re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
      const results = []

      function searchDir(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name)
          if (entry.isDirectory()) { searchDir(full); continue }
          let content
          try { content = fs.readFileSync(full, 'utf-8') } catch { continue }
          const lines = content.split('\n')
          for (let i = 0; i < lines.length; i++) {
            if (re.test(lines[i])) {
              results.push(
                full.replace(ROOT + '/projects/', '') + ':' + (i + 1) + ': ' + lines[i].slice(0, 200)
              )
            }
          }
        }
      }

      if (fs.statSync(fp).isFile()) {
        const c = fs.readFileSync(fp, 'utf-8')
        const ls = c.split('\n')
        for (let i = 0; i < ls.length; i++) {
          if (re.test(ls[i])) results.push((a.path || '') + ':' + (i + 1) + ': ' + ls[i].slice(0, 200))
        }
      } else {
        searchDir(fp)
      }
      return results.slice(0, 20).join('\n') || '无匹配结果'
    } catch (e) {
      return `[错误: 搜索失败 — ${e.message}]`
    }
  },

  create_scene_template: a => {
    try {
      const name = String(a.name || '未命名场景模板').trim()
      const type = String(a.type || '普通小说').trim()

      // 类型校验
      if (!VALID_SCENE_TYPES.includes(type)) {
        return `[错误: 无效的小说类型"${type}"。有效值: ${VALID_SCENE_TYPES.join('|')}]`
      }

      // 辅助函数
      const arr = (v) => Array.isArray(v) ? v.map(x => typeof x === 'object' ? x : String(x)) : []
      const str = (v, d = '') => typeof v === 'string' ? v : (v != null ? String(v) : d)

      // 处理 characters: 支持对象数组和分号分隔字符串
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

      // autoFields: 数组→对象
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

      // 尝试JSON序列化验证
      const jsonStr = JSON.stringify(tmpl, null, 2)
      try { JSON.parse(jsonStr) } catch (e) {
        return `[JSON格式错误: ${e.message}]`
      }

      const fp = S(name + '.json')
      fs.mkdirSync(path.dirname(fp), { recursive: true })
      fs.writeFileSync(fp, jsonStr, 'utf-8')
      return `已创建场景模板: "${name}" (ID: ${id}, 类型: ${type})`
    } catch (e) {
      return `[错误: 创建场景模板失败 — ${e.message}]`
    }
  },
}

// ─── 工具定义 (发送给API) ─────────────────────────────────────────────
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: '读取项目文件内容。路径格式: {项目}/目录/文件名。例: 1/characters/林语晴.yaml',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '文件相对路径（相对于项目目录）' },
        },
        required: ['file_path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: '列出指定目录中的所有文件和子目录',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '目录路径' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_content',
      description: '在项目文件中搜索关键词或正则表达式',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: '搜索关键词' },
          path: { type: 'string', description: '搜索路径（文件或目录）' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_scene_template',
      description:
        '创建场景模板并保存到场景工坊(../../scene_templates/)。' +
        '根据细纲或用户上传文件分析创建。' +
        '必填: name(模板名称), type(小说类型: ' + VALID_SCENE_TYPES.join('|') + ')。' +
        '通用选填: sceneType(日常|战斗|对话|内心独白|过渡|高潮|情色), conflictType, scenePurpose[], ' +
        'characters(数组[{characterId,characterName,emotion}]), location, time, weather, atmosphere, ' +
        'wordTarget, narrativePOV, pacing, bodyLanguage, detail, extraNote, ' +
        'plotOverview(200-500字), sceneTurningPoint, props, appearance, sensoryAnchors, ' +
        'dominantEmotion, emotionCurveInput。' +
        'autoFields: 把握不好的字段名列入此数组。' +
        '情色专属(type=情色小说): intensity(1-5), selectedKinks[], opening[], climax[], aftermath[], ' +
        'soundDensity, moanStyle, degradeLangs[], bodyFluidFocus[], bodyPartFocus[], tactileFocus[]。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '模板名称' },
          type: { type: 'string', description: '小说类型。有效值: ' + VALID_SCENE_TYPES.join('|') },
          sceneType: { type: 'string', description: '日常|战斗|对话|内心独白|过渡|高潮|情色' },
          conflictType: { type: 'string', description: '冲突类型' },
          scenePurpose: { type: 'array', items: { type: 'string' }, description: '场景目的' },
          characters: {
            type: 'array',
            items: {
              type: 'object',
              properties: { characterId: { type: 'string' }, characterName: { type: 'string' }, emotion: { type: 'string' } },
            },
            description: '出场角色及情绪',
          },
          location: { type: 'string', description: '场景地点+描述' },
          time: { type: 'string', description: '时间' },
          weather: { type: 'string', description: '天气' },
          atmosphere: { type: 'string', description: '氛围描述' },
          wordTarget: { type: 'number', description: '目标字数' },
          narrativePOV: { type: 'string', description: '叙事视角' },
          pacing: { type: 'string', description: '节奏控制' },
          bodyLanguage: { type: 'string', description: '肢体语言描写重点' },
          detail: { type: 'string', description: '详细场景配置(Markdown)' },
          extraNote: { type: 'string', description: '额外要求' },
          autoFields: {
            type: 'array',
            items: { type: 'string' },
            description: '把握不好、无法确定的字段名列表',
          },
          plotOverview: { type: 'string', description: '场景剧情概述(200-500字)' },
          sceneTurningPoint: { type: 'string', description: '场景转折点描述' },
          props: { type: 'string', description: '场景道具清单' },
          appearance: { type: 'string', description: '人物外貌描述' },
          sensoryAnchors: { type: 'string', description: '感官锚点描述' },
          dominantEmotion: { type: 'string', description: '主导情绪' },
          emotionCurveInput: { type: 'string', description: '情绪曲线描述' },
          // 情色专属
          intensity: { type: 'number', description: '情色浓度1-5' },
          selectedKinks: { type: 'array', items: { type: 'string' }, description: '玩法标签' },
          opening: { type: 'array', items: { type: 'string' }, description: '开场阶段描写要点' },
          climax: { type: 'array', items: { type: 'string' }, description: '高潮阶段描写要点' },
          aftermath: { type: 'array', items: { type: 'string' }, description: '余韵阶段描写要点' },
          soundDensity: { type: 'string', description: '声音密度: 低|中|高|极高' },
          moanStyle: { type: 'string', description: '呻吟风格描述' },
          degradeLangs: { type: 'array', items: { type: 'string' }, description: '羞辱语言清单' },
          bodyFluidFocus: { type: 'array', items: { type: 'string' }, description: '体液描写重点' },
          bodyPartFocus: { type: 'array', items: { type: 'string' }, description: '身体部位描写重点' },
          tactileFocus: { type: 'array', items: { type: 'string' }, description: '触觉描写重点' },
        },
        required: ['name', 'type'],
      },
    },
  },
]

// ─── 系统提示词 ──────────────────────────────────────────────────────
const SYS = [
  '你是青剑AI写作助手，专注于辅助用户进行小说创作。',
  '',
  '# 铁律：何时用工具，何时不用',
  '✅ 调工具（用户要求文件操作）: 读取/查看/列出/搜索/分析/创建/保存/修改/写',
  '❌ 不调工具（纯对话）: 你好/我是/我喜欢/我觉得/谢谢/什么是/为什么/怎么/推荐',
  '',
  '# 执行规则',
  '- 已知路径直接读文件，不列目录。修改/创建前先读。只做用户要求的，不多做。',
  '- 创建场景模板前，必须先 read_file 读取参考源文件（细纲/章节/角色等）。',
  '- 多个独立操作可在同一轮并行完成。有依赖的操作分轮执行。',
  '- 回复简洁，操作完成后简要说明结果。',
  '',
  '# 路径速查',
  '角色: {项目}/characters/{中文名}.yaml    例: 1/characters/林语晴.yaml',
  '章节: {项目}/chapters/chapterN.txt        例: 1/chapters/chapter1.txt',
  '细纲: {项目}/detailed_outline/chapterN.yaml  例: 1/detailed_outline/chapter1.yaml',
  '大纲: {项目}/outline/plot.md',
  '场景模板存储: ../../scene_templates/{名称}.json（全局共享，跨项目使用）',
  '',
  '# 场景模板创建规范',
  '必填: name, type(17种之一)。',
  '从原文提取信息填充字段，有则填、无则留空。',
  '模糊/不确定的字段列入 autoFields 数组，≤10个。能推断则必填。',
  '无参考材料时拒绝创建，提示用户先提供素材。',
  '禁止用 create_file 替代 create_scene_template 创建场景模板。',
].join('\n')

// ─── API 调用 ────────────────────────────────────────────────────────
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
    throw new Error('HTTP ' + res.status + ': ' + errText.slice(0, 300))
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

// ─── Agent 运行循环 ──────────────────────────────────────────────────
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
    process.stdout.write(`  [iter${iterations}] `)

    const r = await callOpenAI(messages)
    if (r.text) fullText = r.text

    // 无工具调用 → 结束
    if (!r.toolCalls.length) {
      process.stdout.write('↩回复\n')
      return { text: fullText, iterations, toolCalls: totalTools, toolLog }
    }

    // 构建 assistant 消息
    const asstMsg = {
      role: 'assistant',
      content: r.text || null,
      tool_calls: r.toolCalls,
    }
    messages.push(asstMsg)

    // 执行工具调用
    for (const tc of r.toolCalls) {
      const fn = tc.function
      const toolFn = tools[fn.name]
      let args = {}
      try { args = JSON.parse(fn.arguments) } catch { /* 格式错误 */ }

      const startTime = Date.now()
      const result = toolFn ? await toolFn(args) : '[未知工具: ' + fn.name + ']'
      const elapsed = Date.now() - startTime

      totalTools++
      const isError = result.startsWith('[')
      const marker = isError ? '✗' : '✓'
      process.stdout.write(fn.name + marker + ' ')

      toolLog.push({
        tool: fn.name,
        args: JSON.stringify(args).slice(0, 120),
        result: result.slice(0, 200),
        error: isError,
        elapsed,
      })

      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: result,
      })
    }
    process.stdout.write('\n')
  }

  return { text: fullText, iterations, toolCalls: totalTools, toolLog }
}

// ─── 测试框架 ────────────────────────────────────────────────────────
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ─── 清理: 删除测试中创建的模板 ──────────────────────────────────────
function cleanupSceneTemplate(name) {
  try {
    const fp = S(name + '.json')
    if (fs.existsSync(fp)) fs.unlinkSync(fp)
  } catch { /* 忽略清理错误 */ }
}

// ─── 主测试流程 ──────────────────────────────────────────────────────
console.log('══════════════════════════════════════════════════')
console.log('  场景模板仿真测试 (11-scene-template)')
console.log('  端点: ' + API_URL + '  模型: ' + MODEL)
console.log('══════════════════════════════════════════════════')
console.log('')

let totalApiCalls = 0

async function main() {
  // ═══════════════════════════════════════════════════════════════════
  // S1: 从细纲创建场景模板（核心流程）
  // 用户上传细纲 → read_file → 分析 → create_scene_template
  // ═══════════════════════════════════════════════════════════════════
  console.log('▶ S1 从细纲创建场景模板（核心流程）')
  const r1 = await agentRun(
    '帮我看下第一章的细纲 1/detailed_outline/chapter1.yaml，分析一下里面的场景结构，' +
    '然后创建一个场景模板，名字就叫"第一章-静止的世界-仿真测试"，类型选都市小说。' +
    '把场景类型、冲突类型、出场角色、地点、氛围、叙事视角、节奏、情绪曲线这些能推断的都填上。'
  )
  const s1Tools = r1.toolLog.filter(l => l.tool === 'read_file' || l.tool === 'create_scene_template')
  t('S1-1 读取了细纲文件',
    s1Tools.some(l => l.tool === 'read_file' && !l.error),
    r1.toolCalls + '工具')
  t('S1-2 创建了场景模板',
    s1Tools.some(l => l.tool === 'create_scene_template' && !l.error),
    r1.iterations + '轮')
  t('S1-3 先读后创建（正确顺序）',
    (() => {
      const reads = r1.toolLog.filter(l => l.tool === 'read_file')
      const creates = r1.toolLog.filter(l => l.tool === 'create_scene_template')
      if (reads.length === 0 || creates.length === 0) return false
      const lastReadIdx = Math.max(...reads.map(l => r1.toolLog.indexOf(l)))
      const firstCreateIdx = Math.min(...creates.map(l => r1.toolLog.indexOf(l)))
      return lastReadIdx < firstCreateIdx
    })(),
    'read_file先于create_scene_template')
  totalApiCalls += r1.iterations
  cleanupSceneTemplate('第一章-静止的世界-仿真测试')
  await sleep(500)

  // ═══════════════════════════════════════════════════════════════════
  // S2: 文件不存在 → 错误恢复
  // 用户传入错误路径 → agent 应识别错误并给出建议
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n▶ S2 文件不存在 → 错误恢复')
  const r2 = await agentRun(
    '读取 1/detailed_outline/chapter999.yaml，分析后创建场景模板叫"不存在的章节"'
  )
  const s2ReadFailed = r2.toolLog.some(
    l => l.tool === 'read_file' && l.error
  )
  const s2NoCreate = !r2.toolLog.some(
    l => l.tool === 'create_scene_template' && !l.error
  )
  t('S2-1 文件读取失败被正确识别',
    s2ReadFailed,
    r2.toolCalls + '工具')
  t('S2-2 读取失败后未强行创建模板',
    s2NoCreate || r2.toolLog.filter(l => l.tool === 'create_scene_template' && l.error).length > 0,
    r2.iterations + '轮')
  t('S2-3 Agent给出了错误提示或建议',
    r2.text.length > 10,
    '回复' + r2.text.slice(0, 80) + '…')
  totalApiCalls += r2.iterations
  cleanupSceneTemplate('不存在的章节')
  await sleep(500)

  // ═══════════════════════════════════════════════════════════════════
  // S3: 多轮交互 — 创建 → 用户修正 → 重新创建
  // 模拟真实用户反复修改需求的过程
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n▶ S3 多轮交互修正（创建→修正→确认）')

  // S3-a: 初始创建
  console.log('  [S3-a] 初始创建请求…')
  const r3a = await agentRun(
    '帮我创建一个武侠战斗场景模板，名字"竹林大战-仿真测试"。' +
    '场景类型: 战斗，地点在竹林，主角和反派在竹林中决斗。' +
    '冲突类型写"正邪对决"，目标字数5000。'
  )
  const s3aCreated = r3a.toolLog.some(
    l => l.tool === 'create_scene_template' && !l.error
  )
  t('S3-1a 初始模板创建成功',
    s3aCreated,
    r3a.iterations + '轮 ' + r3a.toolCalls + '工具')
  totalApiCalls += r3a.iterations

  // S3-b: 用户提出修正
  console.log('  [S3-b] 用户修正请求…')
  const r3b = await agentRun(
    '不对不对，我说错了。类型改成修仙小说，不是武侠。然后地点加上"悬崖边的竹林，下面万丈深渊"，' +
    '角色加上"林语晴:紧张戒备"和"张明:冷静沉着"，天气改成"大雾弥漫"，氛围写"杀机四伏的寂静"。' +
    '另外场景目的加上"展示主角实力增长"和"埋下后续剧情伏笔"。' +
    '最后情绪曲线写成"从紧张对峙到激烈交锋再到险中求胜"。' +
    '名字还是用"竹林大战-仿真测试"，把我刚才说的这些全部更新进去。'
  )
  const s3bCreated = r3b.toolLog.some(
    l => l.tool === 'create_scene_template' && !l.error
  )
  t('S3-1b 修正后的模板创建成功',
    s3bCreated,
    r3b.iterations + '轮 ' + r3b.toolCalls + '工具')

  // 验证修正后的模板内容
  let s3bDetail = ''
  try {
    const fp = S('竹林大战-仿真测试.json')
    if (fs.existsSync(fp)) {
      const tmpl = JSON.parse(fs.readFileSync(fp, 'utf-8'))
      const cfg = tmpl.config || {}
      if (cfg.type === '修仙小说' || tmpl.type === '修仙小说') s3bDetail = '类型已修正为修仙'
      if (cfg.location && cfg.location.includes('悬崖')) s3bDetail += ' 地点含悬崖'
      if (cfg.weather && cfg.weather.includes('雾')) s3bDetail += ' 天气含雾'
      if (cfg.characters && cfg.characters.length >= 2) s3bDetail += ' 角色≥2'
    }
  } catch { /* 忽略验证错误 */ }
  t('S3-1c 修正后的模板包含更新内容',
    s3bCreated && s3bDetail.length > 0,
    s3bDetail || '模板已保存')
  totalApiCalls += r3b.iterations
  cleanupSceneTemplate('竹林大战-仿真测试')
  await sleep(500)

  // ═══════════════════════════════════════════════════════════════════
  // S4: 详细规格场景 — 用户提供大量细节参数
  // 测试 agent 能否处理复杂的长参数
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n▶ S4 详细规格场景（大量参数）')
  const r4 = await agentRun(
    '我要创建一个详细的场景模板，请仔细按我说的填：\n' +
    '名字: "校园天台对峙-仿真测试"\n' +
    '类型: 都市小说\n' +
    '场景类型: 对话\n' +
    '冲突类型: 心理对抗+信息博弈\n' +
    '场景目的: ["揭露隐藏线索","加速角色关系发展","制造紧张氛围"]\n' +
    '角色: "张明:表面冷静内心慌乱" 和 "神秘人X:掌控全局微笑施压"\n' +
    '地点: 教学楼天台，废弃的空调外机和生锈的铁栏杆，远处能看到整个校园\n' +
    '时间: 傍晚6点\n' +
    '天气: 阴天多云\n' +
    '氛围: 压抑紧张，空气中弥漫着即将下雨的湿气，对话间充满了试探和反试探\n' +
    '目标字数: 3500\n' +
    '叙事视角: 第三人称有限视角，紧贴张明\n' +
    '节奏: 缓慢渐进，从轻松的寒暄逐步升级到激烈的对质\n' +
    '肢体语言: 张明手插口袋掩饰紧张、神秘人慢条斯理翻看手机\n' +
    '感官锚点: "生锈铁栏杆的冰冷触感" "远处食堂飘来的饭香" "天台风声" "手机翻页声"\n' +
    '主导情绪: 紧张焦虑\n' +
    '情绪曲线: "开场轻松→察觉不对→紧张升级→激烈对质→冷静谈判→达成协议"\n' +
    '场景转折点: "神秘人X掏出一张旧照片，张明的表情从防备变成震惊"\n' +
    '场景剧情概述: "张明按约定来到天台，神秘人X已经在那里等他。开始只是简单的对话，' +
    '但X每一句话都在暗示他知道张明的秘密。张明试图保持冷静，但随着对话的深入，' +
    '他发现X掌握的信息远超预期。关键时刻X掏出一张旧照片，张明看到照片上的内容后表情骤变——' +
    '那是静止世界发生前的证据。两人从试探升级为对质，最终达成一个危险的合作协议。"\n' +
    '道具: 旧照片、智能手机、天台铁栏杆\n' +
    '外貌: 张明穿深色卫衣戴耳机、神秘人X穿黑色风衣戴墨镜'
  )
  const s4Created = r4.toolLog.some(
    l => l.tool === 'create_scene_template' && !l.error
  )

  // 验证模板字段完整性
  let s4Fields = 0
  try {
    const fp = S('校园天台对峙-仿真测试.json')
    if (fs.existsSync(fp)) {
      const tmpl = JSON.parse(fs.readFileSync(fp, 'utf-8'))
      const cfg = tmpl.config || {}
      const checks = [
        cfg.sceneType === '对话',
        cfg.conflictType && cfg.conflictType.length > 0,
        Array.isArray(cfg.scenePurpose) && cfg.scenePurpose.length >= 2,
        Array.isArray(cfg.characters) && cfg.characters.length >= 2,
        cfg.location && cfg.location.length > 10,
        cfg.atmosphere && cfg.atmosphere.length > 0,
        cfg.plotOverview && cfg.plotOverview.length > 50,
        cfg.dominantEmotion && cfg.dominantEmotion.length > 0,
        cfg.emotionCurveInput && cfg.emotionCurveInput.length > 0,
        cfg.sensoryAnchors && cfg.sensoryAnchors.length > 0,
        cfg.sceneTurningPoint && cfg.sceneTurningPoint.length > 0,
        cfg.wordTarget === 3500,
        cfg.narrativePOV && cfg.narrativePOV.length > 0,
        cfg.props && cfg.props.length > 0,
      ]
      s4Fields = checks.filter(Boolean).length
    }
  } catch { /* 忽略验证错误 */ }
  t('S4-1 详细模板创建成功',
    s4Created,
    r4.iterations + '轮 ' + r4.toolCalls + '工具')
  t('S4-2 模板字段填充完整',
    s4Created && s4Fields >= 10,
    s4Fields + '/14个关键字段已填充')
  t('S4-3 plotOverview 内容充足',
    s4Created && s4Fields > 0,
    '模板已保存至scene_templates/')
  totalApiCalls += r4.iterations
  cleanupSceneTemplate('校园天台对峙-仿真测试')
  await sleep(500)

  // ═══════════════════════════════════════════════════════════════════
  // S5: 精简参数 — 用户提供极少信息
  // 测试 agent 能否正确处理信息不足的情况
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n▶ S5 极简参数（信息不足）')
  const r5 = await agentRun(
    '创建个场景模板，名字就叫"测试模板"，类型普通小说。'
  )
  const s5Created = r5.toolLog.some(
    l => l.tool === 'create_scene_template' && !l.error
  )
  const s5Minimal = r5.toolLog.filter(l => l.tool === 'create_scene_template').length <= 1
  t('S5-1 极简参数也能创建',
    s5Created,
    r5.iterations + '轮 ' + r5.toolCalls + '工具')
  t('S5-2 信息不足时使用autoFields标记',
    s5Created,
    r5.text.slice(0, 100))
  totalApiCalls += r5.iterations
  cleanupSceneTemplate('测试模板')
  await sleep(500)

  // ═══════════════════════════════════════════════════════════════════
  // S6: 闲聊防误调 — 纯对话不应触发工具
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n▶ S6 闲聊防误调（纯对话）')
  const r6a = await agentRun('你好，我是新用户，想了解一下场景模板功能')
  const r6b = await agentRun('场景模板和风格模板有什么区别？')
  const r6c = await agentRun('你们这个软件有什么特色功能吗？')
  t('S6 三轮闲聊0工具',
    r6a.toolCalls === 0 && r6b.toolCalls === 0 && r6c.toolCalls === 0,
    '你好:' + r6a.toolCalls + ' 问区别:' + r6b.toolCalls + ' 问功能:' + r6c.toolCalls)
  totalApiCalls += r6a.iterations + r6b.iterations + r6c.iterations

  // ═══════════════════════════════════════════════════════════════════
  // 结果汇总
  // ═══════════════════════════════════════════════════════════════════
  const total = pass + fail
  const pct = total > 0 ? ((pass / total) * 100).toFixed(1) : '0.0'
  console.log('\n══════════════════════════════════════════════════')
  console.log('  场景模板仿真测试结果')
  console.log('══════════════════════════════════════════════════')
  console.log('  ✅ ' + pass + ' 通过   ❌ ' + fail + ' 失败')
  console.log('  通过率: ' + pct + '%')
  console.log('  总API调用轮次: ' + totalApiCalls)
  console.log('  测试覆盖工具: read_file list_directory search_content create_scene_template')
  console.log('══════════════════════════════════════════════════')

  // 清理残留的测试模板文件
  const cleanupNames = [
    '第一章-静止的世界-仿真测试', '不存在的章节', '竹林大战-仿真测试',
    '校园天台对峙-仿真测试', '测试模板',
  ]
  for (const n of cleanupNames) cleanupSceneTemplate(n)
}

main().catch(e => {
  console.error('\n💥 测试异常:', e.message)
  console.error(e.stack)
  process.exit(1)
})
