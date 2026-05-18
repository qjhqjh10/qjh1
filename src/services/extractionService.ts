import type {
  ChapterExtraction, ExtractedCharacterRaw, ExtractedWorldElement,
  ExtractedItem, ExtractedPowerMention, ExtractedForeshadow,
  AggregatedResult, AggregatedCharacter,
  NovelExtraction, PacingTemplate,
  ChapterAnalysis, StyleProfile, StyleChapter, DimAnalysis,
  EroticExtractionData, EventPattern, ProgressionRhythm,
  CharacterArchetype, EmotionCurve,
} from '@/types/story'
import { DIMENSION_META } from '@/types/story'
import { splitChaptersByHeadings } from '@/utils/textUtils'

// JSON extraction helpers for AI replies
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI-generated JSON has unpredictable shape
function extractJSON(reply: string): Record<string, any> {
  // Strategy 1: Direct regex + clean parse
  const m = reply.match(/\{[\s\S]*\}/)
  const candidates: string[] = []
  if (m) candidates.push(m[0])
  candidates.push(reply) // fallback to raw reply

  for (const raw of candidates) {
    try { return JSON.parse(raw) } catch { /* try fixes */ }
    // Fix 1: Remove trailing commas
    try { return JSON.parse(raw.replace(/,(\s*[}\]])/g, '$1')) } catch { /* */ }
    // Fix 2: Remove all commas before } or ] (aggressive)
    try { return JSON.parse(raw.replace(/,(\s*\n?\s*[}\]])/g, '$1')) } catch { /* */ }
    // Fix 3: Truncate to last complete object
    try {
      const lastBrace = raw.lastIndexOf('}')
      if (lastBrace > 0) {
        let truncated = raw.slice(0, lastBrace + 1)
        truncated = truncated.replace(/,(\s*[}\]])/g, '$1')
        return JSON.parse(truncated)
      }
    } catch { /* */ }
    // Fix 4: Find the outermost balanced braces
    try {
      let depth = 0, start = -1
      for (let i = 0; i < raw.length; i++) {
        if (raw[i] === '{') { if (depth === 0) start = i; depth++ }
        else if (raw[i] === '}') { depth--; if (depth === 0 && start >= 0) break }
      }
      if (start >= 0 && depth === 0) {
        const balanced = raw.slice(start, raw.lastIndexOf('}') + 1)
        return JSON.parse(balanced.replace(/,(\s*[}\]])/g, '$1'))
      }
    } catch { /* */ }
  }

  // All fixes failed — throw with preview for debugging
  const preview = reply.slice(0, 200) + '...' + reply.slice(-100)
  throw new Error(`无法解析AI返回的JSON: ${preview}`)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI-generated JSON has unpredictable shape
function extractJSONArray(reply: string): any[] {
  const m = reply.match(/\[[\s\S]*\]/)
  if (!m) throw new Error('未找到JSON数组')
  try { return JSON.parse(m[0]) } catch { /* try fix */ }
  try { return JSON.parse(m[0].replace(/,(\s*[\]])/g, '$1')) } catch { /* */ }
  // Fallback: find balanced brackets
  let depth = 0, start = -1
  for (let i = 0; i < reply.length; i++) {
    if (reply[i] === '[') { if (depth === 0) start = i; depth++ }
    else if (reply[i] === ']') { depth--; if (depth === 0 && start >= 0) break }
  }
  if (start >= 0 && depth === 0) {
    return JSON.parse(reply.slice(start, reply.lastIndexOf(']') + 1).replace(/,(\s*[\]])/g, '$1'))
  }
  throw new Error('无法解析AI返回的JSON数组')
}

// ---- Cross-chapter aggregation (pure frontend, no AI calls) ----

export function aggregateExtractions(chapters: ChapterExtraction[]): AggregatedResult {
  const charMap = new Map<string, ExtractedCharacterRaw[]>()
  const locationMap = new Map<string, ExtractedWorldElement[]>()
  const factionMap = new Map<string, ExtractedWorldElement[]>()
  const ruleMap = new Map<string, ExtractedWorldElement[]>()
  const itemMap = new Map<string, { item: ExtractedItem; chapter: number }[]>()
  const powerTerms = new Map<string, ExtractedPowerMention>()
  const historyParts: string[] = []

  // Collect per-chapter data
  for (const ch of chapters) {
    for (const c of ch.characters) {
      const key = c.name
      if (!charMap.has(key)) charMap.set(key, [])
      charMap.get(key)!.push(c)
    }
    for (const w of ch.worldbuilding) {
      if (w.type === 'location') {
        if (!locationMap.has(w.name)) locationMap.set(w.name, [])
        locationMap.get(w.name)!.push(w)
      } else if (w.type === 'faction') {
        if (!factionMap.has(w.name)) factionMap.set(w.name, [])
        factionMap.get(w.name)!.push(w)
      } else if (w.type === 'rule') {
        if (!ruleMap.has(w.name)) ruleMap.set(w.name, [])
        ruleMap.get(w.name)!.push(w)
      } else if (w.type === 'history') {
        historyParts.push(w.description)
      }
    }
    for (const item of ch.items) {
      if (!itemMap.has(item.name)) itemMap.set(item.name, [])
      itemMap.get(item.name)!.push({ item, chapter: ch.chapterNumber })
    }
    for (const ps of ch.powerSystem) {
      if (!powerTerms.has(ps.term)) {
        powerTerms.set(ps.term, ps)
      }
    }
  }

  // Aggregate characters
  const characters: AggregatedCharacter[] = []
  for (const [, entries] of charMap) {
    const first = entries[0]
    const allTraits = new Set<string>()
    const allActions: string[] = []
    let bestAppearance = ''
    let bestBackground = ''
    const chaptersSet = new Set<number>()
    for (const e of entries) {
      e.traits.forEach(t => allTraits.add(t))
      if (e.action) allActions.push(e.action)
      if (e.appearance && e.appearance.length > bestAppearance.length) bestAppearance = e.appearance
      if (e.newInfo && e.newInfo.length > bestBackground.length) bestBackground = e.newInfo
    }
    // Find first/last chapter
    const chNums: number[] = []
    for (const ch of chapters) {
      if (ch.characters.some(c => c.name === first.name)) chNums.push(ch.chapterNumber)
    }

    // Build relationships from co-occurring characters
    const coChars = new Map<string, number[]>()
    for (const ch of chapters) {
      const names = ch.characters.map(c => c.name)
      if (names.includes(first.name)) {
        for (const n of names) {
          if (n === first.name) continue
          if (!coChars.has(n)) coChars.set(n, [])
          coChars.get(n)!.push(ch.chapterNumber)
        }
      }
    }
    const relationships: AggregatedCharacter['relationships'] = []
    for (const [target, chs] of coChars) {
      if (chs.length >= 2) {
        relationships.push({ target, type: '', evolution: '', chapters: [...new Set(chs)].sort((a, b) => a - b) })
      }
    }

    characters.push({
      name: first.name,
      aliases: first.aliases || [],
      role: first.role || '',
      traits: [...allTraits],
      appearance: bestAppearance,
      background: bestBackground,
      arc: allActions.join(' → '),
      firstChapter: chNums.length > 0 ? Math.min(...chNums) : 0,
      lastChapter: chNums.length > 0 ? Math.max(...chNums) : 0,
      relationships,
    })
  }

  // Aggregate worldbuilding
  const aggregateWorldElements = (map: Map<string, ExtractedWorldElement[]>) => {
    const result: ExtractedWorldElement[] = []
    for (const [, entries] of map) {
      let bestDesc = entries[0].description
      let bestNew = entries[0].newInfo
      for (const e of entries) {
        if (e.description && e.description.length > bestDesc.length) bestDesc = e.description
        if (e.newInfo && e.newInfo.length > bestNew.length) bestNew = e.newInfo
      }
      result.push({ ...entries[0], description: bestDesc, newInfo: bestNew })
    }
    return result
  }

  // Aggregate items
  const items: ExtractedItem[] = []
  for (const [, entries] of itemMap) {
    const first = entries.sort((a, b) => a.chapter - b.chapter)[0]
    items.push({ ...first.item, firstChapter: first.chapter })
  }

  // Aggregate power system
  const sortedPower = [...powerTerms.values()].sort((a, b) => a.inferredLevel - b.inferredLevel)
  const levels = sortedPower.map(p => p.term)

  // Aggregate foreshadowing
  const foreshadowing: AggregatedResult['foreshadowing'] = []
  const planted: { description: string; chapter: number }[] = []
  for (const ch of chapters) {
    for (const f of ch.foreshadowing) {
      if (f.type === 'planted') {
        planted.push({ description: f.description, chapter: ch.chapterNumber })
      } else if (f.type === 'resolved') {
        const match = planted.find(p => {
          const words1 = new Set(p.description.split(/\s+/).filter(w => w.length > 1))
          const words2 = new Set(f.description.split(/\s+/).filter(w => w.length > 1))
          const intersection = [...words1].filter(w => words2.has(w)).length
          const union = new Set([...words1, ...words2]).size
          return union > 0 && intersection / union > 0.2
        })
        foreshadowing.push({
          description: f.description,
          plantChapter: match?.chapter ?? ch.chapterNumber,
          payoffChapter: ch.chapterNumber,
          status: 'resolved',
        })
        if (match) planted.splice(planted.indexOf(match), 1)
      }
    }
  }
  // Remaining planted items
  for (const p of planted) {
    foreshadowing.push({ description: p.description, plantChapter: p.chapter, payoffChapter: null, status: 'planted' })
  }

  // Aggregate erotic statistics
  const eroticChapters = chapters.filter(c => c.erotic)
  const eroticStats = eroticChapters.length > 0 ? {
    eroticChapterCount: eroticChapters.length,
    totalChapters: chapters.length,
    mainEroticChars: [...new Set(eroticChapters.flatMap(c => c.erotic!.characterRoles?.map(cr => cr.name) || []))],
    commonKinks: [...new Set(eroticChapters.flatMap(c => c.erotic!.characterRoles?.flatMap(cr => cr.kinks || []) || []))],
    commonFluids: [...new Set(eroticChapters.flatMap(c => c.erotic!.techniques?.bodyFluids || []))],
    commonTouchFocus: [...new Set(eroticChapters.flatMap(c => c.erotic!.techniques?.touchFocus || []))],
    degradationPatterns: [...new Set(eroticChapters.flatMap(c => c.erotic!.degradationPatterns || []))],
  } : undefined

  return {
    characters,
    worldbuilding: {
      locations: aggregateWorldElements(locationMap),
      factions: aggregateWorldElements(factionMap),
      rules: aggregateWorldElements(ruleMap),
      history: historyParts.join('\n'),
    },
    items,
    powerSystem: {
      name: levels.length > 0 ? '境界等级' : '',
      levels,
      description: sortedPower.map(p => p.context).join('\n'),
    },
    foreshadowing,
    eroticStats,
  }
}

// Dimension schemas for dynamic prompt building
const DIM_SCHEMAS: Record<string, string> = {
  characters: `"characters": [
    {
      "name": "角色名",
      "aliases": ["别名1"],
      "role": "角色身份: 男主/女主/男配/女配/反派/其他(从上下文推断角色性别和定位)",
      "traits": ["性格特征"],
      "appearance": "外貌描写",
      "action": "本章中做了什么",
      "newInfo": "本章新揭示的关于此角色的信息(没有填'')"
    }
  ]`,
  worldbuilding: `"worldbuilding": [
    {
      "type": "location|faction|rule|history|other",
      "name": "名称",
      "description": "描述",
      "newInfo": "本章新信息"
    }
  ]`,
  items: `"items": [
    {
      "name": "物品/法宝/功法名",
      "type": "法宝|丹药|功法|武器|道具|其他",
      "grade": "等级/品阶(未知填'')",
      "owner": "持有者",
      "ability": "能力/效果",
      "acquisitionMethod": "获得方式"
    }
  ]`,
  powerSystem: `"powerSystem": [
    {
      "term": "等级术语(如'筑基期')",
      "context": "上下文描述",
      "inferredLevel": 数字(从低到高推测排序,练气=1,筑基=2...)
    }
  ]`,
  chapterSummary: `"chapterSummary": "本章150-300字详细剧情摘要（包含起因经过结果和情感转折，如有情色内容需描述情色场景和情绪变化）"`,
  events: `"events": ["本章关键事件1", "本章关键事件2", "本章关键事件3"]`,
  foreshadowing: `"foreshadowing": [
    {
      "description": "伏笔或回收描述",
      "type": "planted|resolved"
    }
  ]`,
  emotionalTone: `"emotionalTone": "本章情绪基调(紧张/温馨/悲伤/热血/悬疑...)"`,
  erotic: `"erotic": {
    "characterRoles": [
      {"name": "角色名", "domSub": "dom|sub|switch", "bodyState": "正常|发情|改造|退行|...", "kinks": ["束缚","露出","..."], "shameLevel": "高|中|低"}
    ],
    "sceneFlow": [
      {"phase": "前戏|渐进|主戏|高潮|收尾", "actions": ["具体动作"], "bodyReactions": ["身体反应"], "duration": "短|中|长"}
    ],
    "techniques": {"bodyFluids": ["精液","爱液","汗液","..."], "touchFocus": ["乳房","腿","..."], "soundStyle": "稀疏|适量|密集|极密集", "moanDensity": "稀疏|适量|密集|极密集"},
    "powerDynamics": "本章的权力关系和变化",
    "degradationPatterns": ["言语羞辱","公开暴露","..."]
  }`,
}

// Dynamic extraction prompt builder
export function buildExtractionPrompt(chapterTitle: string, chapterContent: string, dims?: string[]): string {
  const selected = (dims && dims.length > 0) ? dims : ['characters', 'worldbuilding', 'items', 'powerSystem', 'chapterSummary', 'events', 'foreshadowing', 'emotionalTone']
  const fields = selected.map(k => `  ${DIM_SCHEMAS[k]}`).join(',\n')
  return `你是一位专业的小说分析师。请分析以下小说章节，提取结构化信息。

【章节标题】${chapterTitle}
【章节内容】
${chapterContent}

请严格输出以下 JSON（不要markdown，不要额外说明）。未选中的维度不要输出，选中的维度必须填写（无数据填[]或""）：
{
${fields}
}

要求:
1. 只提取文中明确写出或强烈暗示的信息，不要编造
2. 角色名使用文中原名称，保持一致性
3. 等级术语不要翻译，保持原文用词
4. 伏笔判断标准: 文中提到但未完全解释的信息=planted; 之前planted的信息在本章得到解释=resolved
5. chapterSummary必须详细(150-300字)，包含本章的起因、经过、结果和情感转折，足够让没读过的人理解剧情
6. events至少列出3-5个关键事件点`
}

// Parse AI reply into ChapterExtraction
export function parseExtractionReply(reply: string, chapterId: string, chapterNumber: number, chapterTitle: string, chapterContent: string, chapterType: StyleChapter['chapterType'] = 'chapter'): ChapterExtraction {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI-generated JSON
  let parsed: Record<string, any>
  try {
    parsed = extractJSON(reply)
  } catch {
    throw new Error(`AI返回内容无法解析为JSON: ${reply.slice(0, 200)}...`)
  }
  return {
    chapterId, chapterNumber, chapterTitle, chapterContent, chapterType,
    characters: parsed.characters || [],
    worldbuilding: parsed.worldbuilding || [],
    items: (parsed.items || []).map((i: ExtractedItem & { firstChapter?: number }) => ({ ...i, firstChapter: i.firstChapter || chapterNumber })),
    powerSystem: parsed.powerSystem || [],
    chapterSummary: parsed.chapterSummary || '',
    events: parsed.events || [],
    foreshadowing: parsed.foreshadowing || [],
    emotionalTone: parsed.emotionalTone || '',
    extractedAt: new Date().toISOString(),
  }
}

export function splitChapters(content: string): { title: string; content: string; chapterNumber: number; chapterType: string }[] {
  return splitChaptersByHeadings(content).map(({ title, content: c, chapterNumber, chapterType }) => ({
    title, content: c, chapterNumber, chapterType,
  }))
}

// ---- Style analysis (shared with StyleWorkshopPage) ----

export function buildStyleAnalyzePrompt(dims: string[]): string {
  const schema = dims.map(k => `  ${DIMENSION_META[k]?.prompt || `"${k}": "..."`}`).join(',\n')

  return `你是专业的文学风格分析师。请对以下章节进行深度的写作风格分析。

【分析要求】
对每个维度，不要写抽象概括，必须给出：
1. 具体描述: 从原文中提取的具体模式
2. 原文例证: 摘录5-10个最能体现该特征的原文句子/短语
3. 写作规则: 从分析中归纳的可操作的写作指令
4. 词汇清单: 完整的相关词汇/短语列表（必须是原文中实际出现的词汇）

同时，为每个维度保留一个简短的摘要字符串（填充在旧格式字段中，用于向后兼容）。

输出JSON（不要markdown，只输出已启用的维度）：
{
${schema},
  "excerpts": [{"text": "代表性摘录(50字内)", "note": "体现的特征"}, ...共5个]
}

注意:
- 如果某个维度的分析在原文中不适用，将其值设为空字符串 ""
- 所有 examples 和 vocabularyList 必须是原文中实际出现的词汇/句子，禁止编造
- writingRules 必须是具体的、"拿来就能用"的写作指令，不要写笼统建议
- 身体描写(bodyLanguageStyle)、感官(sensoryStyle)是核心维度，必须最详尽`
}

export function parseStyleAnalysisReply(reply: string): ChapterAnalysis {
  const parsed = extractJSON(reply)
  const excerpts = parsed.excerpts || []
  const first = excerpts[0] || {}

  // Helper: extract a value that might be a string (old format) or DimAnalysis object (new format)
  const strVal = (key: string): string => {
    const v = parsed[key]
    if (!v) return ''
    if (typeof v === 'string') return v
    if (typeof v === 'object' && (v as DimAnalysis).description) return (v as DimAnalysis).description
    return JSON.stringify(v)
  }

  // Parse dimAnalyses from new-format output
  const dimKeys = Object.keys(DIMENSION_META)
  const dimAnalyses: Record<string, DimAnalysis> = {}
  for (const key of dimKeys) {
    const v = parsed[key]
    if (v && typeof v === 'object' && (v as DimAnalysis).description) {
      const da = v as DimAnalysis
      dimAnalyses[key] = {
        description: da.description || '',
        examples: Array.isArray(da.examples) ? da.examples : [],
        writingRules: Array.isArray(da.writingRules) ? da.writingRules : [],
        vocabularyList: Array.isArray(da.vocabularyList) ? da.vocabularyList : [],
      }
    }
  }

  return {
    sentenceStyle: strVal('sentenceStyle'), vocabularyStyle: strVal('vocabularyStyle'),
    rhetoricStyle: strVal('rhetoricStyle'), rhythmStyle: strVal('rhythmStyle'),
    dialogueStyle: strVal('dialogueStyle'), moodStyle: strVal('moodStyle'),
    perspectiveStyle: strVal('perspectiveStyle'), bodyLanguageStyle: strVal('bodyLanguageStyle'),
    sensoryStyle: strVal('sensoryStyle'), tensionStyle: strVal('tensionStyle'),
    subtextStyle: strVal('subtextStyle'),
    descriptionPattern: parsed.descriptionPattern || null,
    corruptionArc: parsed.corruptionArc || null, degradationRitual: parsed.degradationRitual || null,
    narrativeVoice: parsed.narrativeVoice || null, sceneMechanics: parsed.sceneMechanics || null,
    somaticTension: parsed.somaticTension || null, identityDissolution: parsed.identityDissolution || null,
    shameVoyeurLoop: parsed.shameVoyeurLoop || null,
    excerpt: first.text || '', excerptNote: first.note || '',
    analyzedAt: new Date().toISOString(),
    dimAnalyses: Object.keys(dimAnalyses).length > 0 ? dimAnalyses : undefined,
  }
}

// ============================================================
// V3 Style Analysis: marked blocks + flat arrays (resilient to JSON errors)
// ============================================================

export function buildStyleAnalyzePromptV3(dims: string[]): string {
  const dimensionInstructions = dims.map(k => {
    const meta = DIMENSION_META[k]
    return meta ? `  ${k}: ${meta.label}（${meta.category}）` : `  ${k}`
  }).join('\n')

  return `你是专业的文学风格分析师。请对以下章节进行深度写作风格分析。

【启用的分析维度】
${dimensionInstructions}

【输出格式】
请严格按照以下格式输出（不要用 markdown 代码块）：

=== [维度key]: [中文标签] ===
（200-400字深度分析。必须包含：具体描述 + 引用3个以上原文词句作为证据）
...分析内容...

=== [下一个维度key]: [中文标签] ===
...分析内容...

（重复以上格式，为上面列出的每个维度写一段分析）

---VOCABULARY---
["原文词1","原文词2","原文词3",...]

---RULES---
["写作规则1","写作规则2","写作规则3",...]

---TONE---
{"word":"基调词","description":"100字基调描述","attitude":"叙述者态度（冷漠旁观/欣赏把玩/幽默调侃/温柔包容/神圣庄严）"}

【硬性要求】
1. 每个维度分析必须 200-400 字，引用原文具体词汇/句子
2. VOCABULARY 数组必须是原文中实际出现的词，禁止编造
3. RULES 数组必须是可直接执行的写作指令（每条 15-50 字），不要写笼统建议
4. TONE 中的基调词限 2-8 字
5. 标记块（---XXX---）必须从行首开始，单独一行
6. 数组和对象必须是合法 JSON（注意：字符串用双引号，不要尾部逗号）
7. 不要用 \`\`\`json 代码块包裹任何内容`
}

// Parses V3 marked-block format into ChapterAnalysis
export function parseStyleAnalysisReplyV3(reply: string, dims: string[]): ChapterAnalysis {
  // ── Step 1: Split into sections by markers ──
  const vocabMarker = '---VOCABULARY---'
  const rulesMarker = '---RULES---'
  const toneMarker = '---TONE---'

  const vocabIdx = reply.indexOf(vocabMarker)
  const rulesIdx = reply.indexOf(rulesMarker)
  const toneIdx = reply.indexOf(toneMarker)

  // Free text is everything before the first marker
  const firstMarker = Math.min(
    vocabIdx >= 0 ? vocabIdx : Infinity,
    rulesIdx >= 0 ? rulesIdx : Infinity,
    toneIdx >= 0 ? toneIdx : Infinity,
  )
  const freeText = firstMarker < Infinity ? reply.slice(0, firstMarker).trim() : reply.trim()

  // ── Step 2: Extract per-dimension descriptions from free text ──
  const dimMap = new Map<string, { label: string; description: string }>()
  for (const dk of dims) {
    // Match: === sentenceStyle: 句式 === (content) === next dimension
    const label = DIMENSION_META[dk]?.label || dk
    const escapedKey = dk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const patterns = [
      new RegExp(`===\\s*${escapedKey}\\s*:\\s*[^=]+?\\s*===\\s*\\n([\\s\\S]*?)(?=\\n===|$)`, 'im'),
      new RegExp(`===\\s*${escapedKey}\\s*===\\s*\\n([\\s\\S]*?)(?=\\n===|$)`, 'im'),
      new RegExp(`\\[${escapedKey}\\][:：]([\\s\\S]*?)(?=\\n\\[|\\n===|$)`, 'im'),
    ]
    for (const pat of patterns) {
      const m = freeText.match(pat)
      if (m && m[1]?.trim().length > 20) {
        dimMap.set(dk, { label, description: m[1].trim() })
        break
      }
    }
    // If no explicit section, try to find dimension name mentioned anywhere
    if (!dimMap.has(dk)) {
      const dimLabel = DIMENSION_META[dk]?.label || dk
      const mentionPat = new RegExp(`${dk}|${dimLabel}\\s*[:：]\\s*`, 'i')
      if (mentionPat.test(freeText) && freeText.length > 100) {
        // Store a fallback note — the full text may contain relevant analysis
        dimMap.set(dk, { label: dimLabel, description: '' })
      }
    }
  }

  // ── Step 3: Parse marked blocks independently ──
  const parseBlock = (raw: string, marker: string): string[] => {
    const idx = raw.indexOf(marker)
    if (idx < 0) return []
    const after = raw.slice(idx + marker.length)
    // Find the next marker or end of string
    const nextMarker = Math.min(
      ...[vocabMarker, rulesMarker, toneMarker].map(m => {
        const i = after.indexOf(m)
        return i >= 0 ? i : Infinity
      }),
    )
    const block = (nextMarker < Infinity ? after.slice(0, nextMarker) : after).trim()

    // Try JSON.parse with fixes
    const candidates = [block, block.replace(/,(\s*[\]])/g, '$1'), block.replace(/，/g, ',').replace(/,(\s*[\]])/g, '$1')]
    for (const c of candidates) {
      try {
        const arrMatch = c.match(/\[[\s\S]*\]/)
        if (arrMatch) {
          const parsed = JSON.parse(arrMatch[0])
          if (Array.isArray(parsed)) return parsed.filter((x: unknown): x is string => typeof x === 'string')
        }
      } catch { /* try next */ }
    }

    // Fallback: regex extract all quoted strings
    const quoted = after.match(/"([^"]{2,50})"/g)
    if (quoted) return [...new Set(quoted.map(q => q.slice(1, -1)))].slice(0, 50)

    return []
  }

  const vocabularyList = parseBlock(reply, vocabMarker)
  const writingRules = parseBlock(reply, rulesMarker)

  // Parse tone block
  let toneWord = ''
  let toneDesc = ''
  let toneAttitude = ''
  if (toneIdx >= 0) {
    const afterTone = reply.slice(toneIdx + toneMarker.length)
    const nextMarker = Math.min(
      ...[vocabMarker, rulesMarker].map(m => {
        const i = afterTone.indexOf(m)
        return i >= 0 ? i : Infinity
      }),
    )
    const toneBlock = (nextMarker < Infinity ? afterTone.slice(0, nextMarker) : afterTone).trim()
    try {
      const objMatch = toneBlock.match(/\{[\s\S]*?\}/)
      if (objMatch) {
        const parsed = JSON.parse(objMatch[0].replace(/,(\s*[}\]])/g, '$1'))
        toneWord = typeof parsed.word === 'string' ? parsed.word : ''
        toneDesc = typeof parsed.description === 'string' ? parsed.description : ''
        toneAttitude = typeof parsed.attitude === 'string' ? parsed.attitude : ''
      }
    } catch { /* keep defaults */ }
  }

  // ── Step 4: Build fullDescription from all dimension descriptions ──
  const descParts: string[] = []
  for (const dk of dims) {
    const info = dimMap.get(dk)
    if (info?.description) descParts.push(`【${info.label}】${info.description.slice(0, 200)}`)
  }

  // ── Step 5: Assemble ChapterAnalysis ──
  const dimAnalyses: Record<string, DimAnalysis> = {}
  for (const dk of dims) {
    const info = dimMap.get(dk)
    const desc = info?.description || ''
    // Distribute vocabulary to relevant dimensions based on keyword matching
    const dimVocab: string[] = []
    if (vocabularyList.length > 0) {
      const keywords = [dk, DIMENSION_META[dk]?.label || '']
      for (const v of vocabularyList) {
        // Assign first 20 generic entries to body/sensory, rest by keyword
        if (dk === 'bodyLanguageStyle' || dk === 'sensoryStyle' || dk === 'vocabularyStyle') {
          dimVocab.push(v)
        }
      }
    }
    const dimRules = dk === 'narrativeTone' && toneDesc
      ? [`基调: ${toneWord} - ${toneDesc}`]
      : writingRules.length > 0 ? writingRules.slice(0, 8) : []

    dimAnalyses[dk] = {
      description: desc || `（见完整分析文本，共 ${freeText.length} 字）`,
      examples: [],
      writingRules: dimRules,
      vocabularyList: dimVocab.slice(0, 30),
    }
  }

  // If tone data exists, ensure narrativeTone always has content
  if (toneWord && dimAnalyses['narrativeTone']) {
    dimAnalyses['narrativeTone'] = {
      description: toneDesc || `基调: ${toneWord}`,
      examples: [],
      writingRules: [`维持"${toneWord}"的叙事基调`, `叙事态度: ${toneAttitude}`],
      vocabularyList: [],
    }
  }

  // Build string fields (backward compat)
  const strVal = (dk: string) => dimAnalyses[dk]?.description || ''
  const excerpt = '' // V3 doesn't output excerpts

  return {
    sentenceStyle: strVal('sentenceStyle'), vocabularyStyle: strVal('vocabularyStyle'),
    rhetoricStyle: strVal('rhetoricStyle'), rhythmStyle: strVal('rhythmStyle'),
    dialogueStyle: strVal('dialogueStyle'), moodStyle: strVal('moodStyle'),
    perspectiveStyle: strVal('perspectiveStyle'), bodyLanguageStyle: strVal('bodyLanguageStyle'),
    sensoryStyle: strVal('sensoryStyle'), tensionStyle: strVal('tensionStyle'),
    subtextStyle: strVal('subtextStyle'),
    descriptionPattern: null, corruptionArc: null, degradationRitual: null,
    narrativeVoice: null, sceneMechanics: null, somaticTension: null,
    identityDissolution: null, shameVoyeurLoop: null,
    excerpt, excerptNote: '',
    analyzedAt: new Date().toISOString(),
    dimAnalyses: Object.keys(dimAnalyses).length > 0 ? dimAnalyses : undefined,
  }
}

// ---- Extract representative excerpts for few-shot prompting ----
// Picks the most distinctive paragraphs from analyzed chapters based on style features
export function buildFewShotExcerpts(
  chapters: { title: string; content: string; chapterNumber: number }[],
  maxChapters: number = 5,
  maxPerChapter: number = 2,
  excerptLength: number = 200,
): string[] {
  const excerpts: string[] = []
  const selected = chapters.slice(0, Math.min(chapters.length, maxChapters))

  for (const ch of selected) {
    // Split into natural paragraphs (double newlines)
    const paras = ch.content.split(/\n\n+/).filter(p => p.trim().length > 40)
    if (paras.length === 0) continue

    // Score each paragraph by "style signal density": presence of onomatopoeia, sensory words, dialogue markers
    const scored = paras.map((p, i) => {
      let score = 0
      // Onomatopoeia density
      const onoCount = (p.match(/哦|噫|齁|呜|叽|噗|咕|啪|唧|嘎/g) || []).length
      score += Math.min(onoCount, 20) * 2
      // Sensory words
      const sensoryCount = (p.match(/热|烫|紧|软|湿|黏|滑|硬|粗|嫩/g) || []).length
      score += sensoryCount
      // Body part words
      const bodyCount = (p.match(/屁眼|鸡巴|卵蛋|龟头|肉穴|阴唇|子宫|乳房|臀部|肚/g) || []).length
      score += bodyCount * 2
      // Exclamation density (emotional intensity)
      const exclCount = (p.match(/[！!]/g) || []).length
      score += exclCount
      return { para: p, score, idx: i }
    })

    scored.sort((a, b) => b.score - a.score)
    for (let i = 0; i < Math.min(maxPerChapter, scored.length); i++) {
      const excerpt = scored[i].para.slice(0, excerptLength)
      if (excerpt.length > 40) {
        excerpts.push(excerpt)
      }
    }
  }

  return excerpts
}

// ---- Pacing template ----

export function computePacingTemplate(chapters: ChapterExtraction[]): PacingTemplate {
  const tones = chapters.map(c => c.emotionalTone)
  const total = chapters.length || 1
  const battle = tones.filter(t => /热血|紧张|战斗|激烈/.test(t)).length
  const climax = tones.filter(t => /高潮|爆发|决战/.test(t)).length
  const training = tones.filter(t => /专注|突破|修炼|成长/.test(t)).length
  const social = tones.filter(t => /轻松|温馨|日常|社交/.test(t)).length
  const transition = total - battle - climax - training - social
  const totalWords = chapters.reduce((sum, c) => sum + c.chapterContent.length, 0)
  return {
    battleRatio: Math.round((battle / total) * 100),
    transitionRatio: Math.round((Math.max(0, transition) / total) * 100),
    climaxRatio: Math.round((climax / total) * 100),
    trainingRatio: Math.round((training / total) * 100),
    socialRatio: Math.round((social / total) * 100),
    avgChapterWords: Math.round(totalWords / total),
  }
}

// Compute event cycle patterns from chapter events
export function computeEventPattern(chapters: ChapterExtraction[]): EventPattern {
  const cycles: { name: string; chapterSpan: number }[] = []
  const eventCounts = chapters.reduce((sum, c) => sum + c.events.length, 0)
  const density = chapters.length > 0 ? Math.round((eventCounts / chapters.length) * 10) / 10 : 0
  // Find recurring event keywords
  const eventWords = new Map<string, number>()
  for (const ch of chapters) {
    for (const ev of ch.events) {
      eventWords.set(ev, (eventWords.get(ev) || 0) + 1)
    }
  }
  // Take top recurring events
  const sorted = [...eventWords.entries()].filter(([, count]) => count >= 2).sort((a, b) => b[1] - a[1]).slice(0, 8)
  for (const [name] of sorted) {
    const spans = chapters.filter(c => c.events.includes(name)).map(c => c.chapterNumber)
    const span = spans.length >= 2 ? Math.round((spans[spans.length - 1] - spans[0]) / (spans.length - 1)) : 1
    cycles.push({ name, chapterSpan: span })
  }
  return { cycles, eventDensity: density }
}

// Compute progression rhythm from power system and chapter summaries
export function computeProgressionRhythm(chapters: ChapterExtraction[], powerSystem?: { levels: string[] }): ProgressionRhythm {
  const levelCount = powerSystem?.levels.length || 0
  const totalChapters = chapters.length
  if (totalChapters === 0 || levelCount === 0) return { levelCount, pattern: '', stages: [] }

  // Find which chapters mention level terms
  const levelMentions: { chapter: number; level: string }[] = []
  for (const ch of chapters) {
    for (const ps of ch.powerSystem) {
      levelMentions.push({ chapter: ch.chapterNumber, level: ps.term })
    }
  }

  let pattern = '均匀'
  const third = Math.floor(totalChapters / 3)
  if (third > 10) {
    const early = levelMentions.filter(m => m.chapter <= third).length
    const late = levelMentions.filter(m => m.chapter > totalChapters - third).length
    if (early > late * 2) pattern = '前快后慢'
    else if (late > early * 2) pattern = '前慢后快'
  }

  return {
    levelCount,
    pattern,
    stages: [
      { name: '前期', chapters: `1-${third}`, levelsGained: Math.round(levelCount * 0.3), avgChaptersPerLevel: Math.round(third / Math.max(1, levelCount * 0.3)) },
      { name: '中期', chapters: `${third + 1}-${totalChapters - third}`, levelsGained: Math.round(levelCount * 0.35), avgChaptersPerLevel: Math.round((totalChapters - 2 * third) / Math.max(1, levelCount * 0.35)) },
      { name: '后期', chapters: `${totalChapters - third + 1}-${totalChapters}`, levelsGained: Math.round(levelCount * 0.35), avgChaptersPerLevel: Math.round(third / Math.max(1, levelCount * 0.35)) },
    ],
  }
}

// Extract character archetypes from aggregated characters
export function computeCharacterArchetype(characters: AggregatedCharacter[]): CharacterArchetype {
  const archetypes = characters.slice(0, 8).map(c => ({
    role: c.role || '配角',
    function: c.traits.slice(0, 3).join('+'),
    arcSpan: `${c.firstChapter}-${c.lastChapter}`,
  }))
  return { archetypes }
}

// Compute emotion curve from chapter tones
export function computeEmotionCurve(chapters: ChapterExtraction[]): EmotionCurve {
  const tones = chapters.filter(c => c.emotionalTone).map(c => c)
  if (tones.length === 0) return { segments: [], cycleLength: 0 }

  const segments: EmotionCurve['segments'] = []
  let currentEmotion = tones[0].emotionalTone
  let start = tones[0].chapterNumber

  for (let i = 1; i < tones.length; i++) {
    if (tones[i].emotionalTone !== currentEmotion) {
      segments.push({ chapterStart: start, chapterEnd: tones[i - 1].chapterNumber, dominantEmotion: currentEmotion })
      currentEmotion = tones[i].emotionalTone
      start = tones[i].chapterNumber
    }
  }
  segments.push({ chapterStart: start, chapterEnd: tones[tones.length - 1].chapterNumber, dominantEmotion: currentEmotion })

  return { segments, cycleLength: Math.round(tones.length / Math.max(1, segments.length)) }
}

// ---- Generation prompts ----

export function buildGenerateCharactersPrompt(extraction: NovelExtraction): string {
  const ag = extraction.aggregated
  if (!ag) return ''
  const charDesc = ag.characters.map(c => `${c.name}(${c.role}): ${c.traits.join('、')}. ${c.background}`).join('\n')
  return `你是一位小说角色设计师。以下是原作的角色体系，请生成一套全新的角色阵容。

原作角色:
${charDesc}

要求:
1. 保持相同的角色数量(${ag.characters.length}个)和类型分布
2. 所有姓名完全原创
3. role必须从以下选择: "男主" / "女主" / "男配" / "女配" / "反派" / "其他"
4. 男主只能有一个，女主可以有多个(后宫/多女主小说中允许多个女主)
5. 每个角色保留原作对应角色的性格特征模式，但具体内容不同

请输出JSON数组:
[{"name": "新角色名", "role": "男主|女主|男配|女配|反派|其他", "traits": ["特征1", "特征2"], "background": "背景简介"}]
只输出JSON，不要额外说明。`
}

export function buildGenerateWorldbuildingPrompt(extraction: NovelExtraction): string {
  const ag = extraction.aggregated
  if (!ag) return ''
  let p = '你是一位世界观设计师。以下是原作的世界设定，请生成一套全新的世界观。\n\n'
  if (ag.worldbuilding.locations.length > 0) p += `原作地点(${ag.worldbuilding.locations.length}个): ${ag.worldbuilding.locations.map(l => l.name).join('、')}\n`
  if (ag.worldbuilding.factions.length > 0) p += `原作势力(${ag.worldbuilding.factions.length}个): ${ag.worldbuilding.factions.map(f => f.name).join('、')}\n`
  if (ag.worldbuilding.rules.length > 0) p += `原作规则: ${ag.worldbuilding.rules.map(r => r.name).join('、')}\n`
  if (ag.powerSystem.levels.length > 0) p += `原作等级体系: ${ag.powerSystem.levels.join(' → ')} (共${ag.powerSystem.levels.length}级)\n`
  p += '\n要求: 保持相同的地点数、势力数、规则数、等级数，但名称和内容完全原创\n\n'
  p += '请输出JSON:\n{"locations": [{"name":"","description":""}], "factions": [{"name":"","description":""}], "rules": [{"name":"","description":""}], "powerSystem": {"name":"新体系名","levels":["级1","级2",...],"description":"体系描述"}}\n只输出JSON，不要额外说明。'
  p += '\n注意: locations数组中每个地点是一个独立对象,不是一段文字。factions同理。'
  return p
}

// ---- Erotic extraction ----

// Append erotic section to extraction prompt (only for erotic novels)
export function buildEroticExtractionPrompt(chapterTitle: string, chapterContent: string, dims?: string[]): string {
  let p = buildExtractionPrompt(chapterTitle, chapterContent, dims)
  p += `

【情色分析 — 仅情色小说执行】
请额外分析本章的情色要素，输出在 "erotic" 字段中（如果不含情色内容则输出 null）：
{
  "erotic": {
    "characterRoles": [
      {"name": "角色名", "domSub": "dom|sub|switch", "bodyState": "正常|发情|改造|退行|包茎|微型化|怀孕|哺乳期", "kinks": ["束缚","露出","..."], "shameLevel": "高|中|低→高"}
    ],
    "sceneFlow": [
      {"phase": "前戏|渐进|主戏|高潮|收尾", "actions": ["具体动作"], "bodyReactions": ["身体反应"], "duration": "短|中|长"}
    ],
    "techniques": {"bodyFluids": ["精液","爱液","汗液","..."], "touchFocus": ["乳房","腿","..."], "soundStyle": "稀疏|适量|密集|极密集", "moanDensity": "稀疏|适量|密集|极密集"},
    "powerDynamics": "本章的权力关系和变化",
    "degradationPatterns": ["言语羞辱","公开暴露","..."]
  }
}`
  return p
}

// Parse erotic extraction reply (extends parseExtractionReply)
export function parseExtractionReplyWithErotic(reply: string, chapterId: string, chapterNumber: number, chapterTitle: string, chapterContent: string, chapterType: StyleChapter['chapterType'] = 'chapter'): ChapterExtraction {
  const base = parseExtractionReply(reply, chapterId, chapterNumber, chapterTitle, chapterContent, chapterType)
  try {
    const parsed = extractJSON(reply)
    if (parsed.erotic) base.erotic = parsed.erotic as EroticExtractionData
  } catch { /* erotic parsing failed, continue without */ }
  return base
}

// ---- Convert extraction chapters to StyleChapter format ----
export function chaptersToStyleChapters(chapters: ChapterExtraction[]): StyleChapter[] {
  return chapters.map((ch, i) => ({
    id: `ch_${i + 1}`,
    title: ch.chapterTitle,
    chapterNumber: ch.chapterNumber,
    chapterType: ch.chapterType || 'chapter',
    content: ch.chapterContent,
    charCount: ch.chapterContent.length,
    analyzed: false,
    analysis: null,
  }))
}
