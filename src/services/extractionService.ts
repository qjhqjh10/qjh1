import type {
  ChapterExtraction, ExtractedCharacterRaw, ExtractedWorldElement,
  ExtractedItem, ExtractedPowerMention, ExtractedForeshadow,
  AggregatedResult, AggregatedCharacter,
  NovelExtraction, PacingTemplate, GeneratedNovel,
  ChapterAnalysis, StyleProfile, StyleChapter,
  EroticExtractionData, EventPattern, ProgressionRhythm,
  CharacterArchetype, EmotionCurve,
} from '@/types/story'
import { DIMENSION_META } from '@/types/story'

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
          plantChapter: match?.chapter || ch.chapterNumber - 1,
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
  }
}

// Dimension schemas for dynamic prompt building
const DIM_SCHEMAS: Record<string, string> = {
  characters: `"characters": [
    {
      "name": "角色名",
      "aliases": ["别名1"],
      "role": "推测的角色定位(主角/反派/配角/路人)",
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
  chapterSummary: `"chapterSummary": "本章150-300字详细剧情摘要（包含起因经过结果和情感转折）"`,
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
export function parseExtractionReply(reply: string, chapterId: string, chapterNumber: number, chapterTitle: string, chapterContent: string): ChapterExtraction {
  let jsonStr = reply
  const m = reply.match(/\{[\s\S]*\}/)
  if (m) jsonStr = m[0]
  const parsed = JSON.parse(jsonStr)
  return {
    chapterId, chapterNumber, chapterTitle, chapterContent,
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

// Split novel into chapters (copied from StyleWorkshopPage patterns)
const CHAPTER_PATTERNS: { regex: RegExp; type: string }[] = [
  { regex: /^楔子\s*$/, type: 'prologue' }, { regex: /^序章\s*$/, type: 'prologue' },
  { regex: /^引子\s*$/, type: 'prologue' }, { regex: /^前言\s*$/, type: 'prologue' },
  { regex: /^终章\s*$/, type: 'epilogue' }, { regex: /^尾声\s*$/, type: 'epilogue' },
  { regex: /^后记\s*$/, type: 'afterword' }, { regex: /^番外[一二三四五六七八九十百千零\d]+\s*$/, type: 'sideStory' },
  { regex: /^第[一二三四五六七八九十百千零\d]+[章卷节回](\s+.{1,40})?$/, type: 'chapter' },
]

export function splitChapters(content: string): { title: string; content: string; chapterNumber: number }[] {
  const lines = content.split('\n')
  const headings: { title: string; startLine: number }[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    // Real chapter headings are short (≤40 chars). Body text lines matching
    // the pattern by accident (e.g. "第一回见到他...") are long sentences.
    if (line.length > 40) continue
    for (const pat of CHAPTER_PATTERNS) {
      if (pat.regex.test(line)) { headings.push({ title: line, startLine: i }); break }
    }
  }
  const result: { title: string; content: string; chapterNumber: number }[] = []
  let chapterNum = 0
  for (let c = 0; c < headings.length; c++) {
    const start = headings[c].startLine
    const end = c < headings.length - 1 ? headings[c + 1].startLine : lines.length
    const body = lines.slice(start, end).join('\n').trim()
    if (body.length < 50) continue
    chapterNum++
    result.push({ title: headings[c].title, content: body, chapterNumber: chapterNum })
  }
  if (result.length === 0 && content.trim().length > 0) {
    result.push({ title: '全文', content: content.trim(), chapterNumber: 1 })
  }
  return result
}

// ---- Style analysis (shared with StyleWorkshopPage) ----

export function buildStyleAnalyzePrompt(dims: string[]): string {
  const fields = dims.map(k => `  ${DIMENSION_META[k]?.prompt || `"${k}": "..."`}`).join(',\n')
  return `分析以下小说章节的写作风格特征。输出JSON（不要markdown，不分析的维度不要输出）：\n{\n${fields},\n  "excerpts": [{"text": "代表性摘录(50字内)", "note": "体现的特征"}]\n}`
}

export function parseStyleAnalysisReply(reply: string): ChapterAnalysis {
  let jsonStr = reply
  const m = reply.match(/\{[\s\S]*\}/)
  if (m) jsonStr = m[0]
  const parsed = JSON.parse(jsonStr)
  const excerpts = parsed.excerpts || []
  const first = excerpts[0] || {}
  return {
    sentenceStyle: parsed.sentenceStyle || '', vocabularyStyle: parsed.vocabularyStyle || '',
    rhetoricStyle: parsed.rhetoricStyle || '', rhythmStyle: parsed.rhythmStyle || '',
    dialogueStyle: parsed.dialogueStyle || '', moodStyle: parsed.moodStyle || '',
    perspectiveStyle: parsed.perspectiveStyle || '', bodyLanguageStyle: parsed.bodyLanguageStyle || '',
    sensoryStyle: parsed.sensoryStyle || '', tensionStyle: parsed.tensionStyle || '',
    subtextStyle: parsed.subtextStyle || '',
    descriptionPattern: parsed.descriptionPattern || null,
    corruptionArc: parsed.corruptionArc || null, degradationRitual: parsed.degradationRitual || null,
    narrativeVoice: parsed.narrativeVoice || null, sceneMechanics: parsed.sceneMechanics || null,
    somaticTension: parsed.somaticTension || null, identityDissolution: parsed.identityDissolution || null,
    shameVoyeurLoop: parsed.shameVoyeurLoop || null,
    excerpt: first.text || '', excerptNote: first.note || '',
    analyzedAt: new Date().toISOString(),
  }
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

// Enhanced outline prompt with pattern constraints
export function buildGenerateOutlinePromptWithPatterns(extraction: NovelExtraction): string {
  let p = buildGenerateOutlinePrompt(extraction)
  if (extraction.pacingTemplate) {
    const pt = extraction.pacingTemplate
    p += `\n节奏约束: 新大纲应保持战斗${pt.battleRatio}%、过渡${pt.transitionRatio}%、修炼${pt.trainingRatio}%、高潮${pt.climaxRatio}%、日常${pt.socialRatio}%的章比例`
  }
  return p
}

// ---- Generation prompts ----

export function buildGenerateOutlinePrompt(extraction: NovelExtraction): string {
  const ag = extraction.aggregated
  const pacing = extraction.pacingTemplate
  const summaries = extraction.chapters.filter(c => c.extractedAt).map(c => `第${c.chapterNumber}章: ${c.chapterSummary}`).join('\n')
  let p = '你是一位小说创作专家。以下是分析一本小说得到的数据，请基于此生成一部全新小说的完整大纲。\n\n'
  if (pacing) p += `节奏分布: 战斗${pacing.battleRatio}% 过渡${pacing.transitionRatio}% 高潮${pacing.climaxRatio}% 修炼${pacing.trainingRatio}% 社交${pacing.socialRatio}% 平均每章${pacing.avgChapterWords}字\n`
  if (ag) {
    if (ag.characters.length > 0) p += `角色阵容: ${ag.characters.map(c => c.role).join('、')} 共${ag.characters.length}个\n`
    if (ag.powerSystem.levels.length > 0) p += `等级体系: ${ag.powerSystem.levels.join(' → ')}\n`
  }
  if (extraction.plotStructure?.acts) p += `原作幕结构: ${extraction.plotStructure.acts.map(a => a.name).join(' → ')}\n`
  p += `\n原作章节摘要:\n${summaries.slice(0, 3000)}\n\n`
  p += '请输出一部全新小说的完整大纲（Markdown格式）。要求:\n'
  p += '1. 保持相似的幕结构、节奏分布、角色类型数量\n'
  p += '2. 所有角色名、地名、物品名完全原创，不要使用原名\n'
  p += '3. 每章写一句剧情摘要，格式: "第X章: 标题 - 摘要"'
  return p
}

export function buildGenerateDetailedOutlinesPrompt(outline: string, extraction: NovelExtraction): string {
  return `你是一位小说创作专家。以下是新小说的大纲，请为每一章生成详细的细纲信息。

新大纲:
${outline}

原作章节摘要参考（保持相似的节奏和密度）:
${extraction.chapters.filter(c => c.extractedAt).map(c => `第${c.chapterNumber}章: ${c.chapterSummary}`).join('\n').slice(0, 2000)}

请输出JSON数组，每章包含：
{
  "chapterNumber": 1,
  "title": "章节标题",
  "summary": "150-300字详细剧情摘要",
  "charactersAppearing": ["出场角色1", "出场角色2"],
  "keyEvents": ["关键事件1", "关键事件2"],
  "emotionalTone": "情绪基调(紧张/温馨/悲伤/热血/悬疑...)"
}

只输出JSON数组，不要额外说明。`
}

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
3. 每个角色保留原作对应角色的性格特征模式，但具体内容不同

请输出JSON数组:
[{"name": "新角色名", "role": "主角|女主|导师|反派|配角", "traits": ["特征1", "特征2"], "background": "背景简介"}]
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
  p += '请输出JSON:\n{"worldbuilding": "世界观设定全文(Markdown格式)", "powerSystem": {"name": "新体系名", "levels": ["级1", "级2", ...], "description": "体系描述"}}\n只输出JSON，不要额外说明。'
  return p
}

// ---- Parsers ----

export function parseGeneratedOutline(reply: string): string {
  return reply.replace(/```markdown\n?|```\n?/g, '').trim()
}

export function parseGeneratedDetailedOutlines(reply: string): { chapterNumber: number; title: string; summary: string }[] {
  const m = reply.match(/\[[\s\S]*\]/)
  if (m) return JSON.parse(m[0])
  return []
}

export function parseGeneratedCharacters(reply: string): { name: string; role: string; traits: string[]; background: string }[] {
  const m = reply.match(/\[[\s\S]*\]/)
  if (m) return JSON.parse(m[0])
  return []
}

export function parseGeneratedWorldbuilding(reply: string): { worldbuilding: string; powerSystem: { name: string; levels: string[]; description: string } } {
  const m = reply.match(/\{[\s\S]*\}/)
  if (m) {
    const parsed = JSON.parse(m[0])
    return {
      worldbuilding: parsed.worldbuilding || '',
      powerSystem: parsed.powerSystem || { name: '', levels: [], description: '' },
    }
  }
  return { worldbuilding: '', powerSystem: { name: '', levels: [], description: '' } }
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
export function parseExtractionReplyWithErotic(reply: string, chapterId: string, chapterNumber: number, chapterTitle: string, chapterContent: string): ChapterExtraction {
  const base = parseExtractionReply(reply, chapterId, chapterNumber, chapterTitle, chapterContent)
  try {
    let jsonStr = reply
    const m = reply.match(/\{[\s\S]*\}/)
    if (m) jsonStr = m[0]
    const parsed = JSON.parse(jsonStr)
    if (parsed.erotic) base.erotic = parsed.erotic as EroticExtractionData
  } catch { /* erotic parsing failed, continue without */ }
  return base
}

// ---- Erotic generation prompts ----

export function buildEroticGenerateOutlinePrompt(extraction: NovelExtraction): string {
  let p = buildGenerateOutlinePrompt(extraction)
  p += '\n额外要求: 为每章标注情色节奏等级(1-5)，1=纯剧情，5=高尺度。在大纲中使用格式: "第X章: 标题 - 摘要 [情色Lv.Y]"'
  return p
}

export function buildEroticGenerateCharactersPrompt(extraction: NovelExtraction): string {
  let p = buildGenerateCharactersPrompt(extraction)
  p += '\n额外字段: 每个角色增加 "domSub": "dom|sub|switch", "bodyState": "身体状态", "kinks": ["性癖1","性癖2"], "shameLevel": "羞耻度"'
  return p
}

export function buildEroticGenerateDetailedOutlinesPrompt(outline: string, extraction: NovelExtraction): string {
  let p = buildGenerateDetailedOutlinesPrompt(outline, extraction)
  p += '\n额外字段: 每章增加 "eroticFlow": "前戏→主戏→高潮→收尾", "intensity": 1-5, "characterStates": {"角色名": "身体状态"}'
  return p
}

export function buildEroticGenerateWorldbuildingPrompt(extraction: NovelExtraction): string {
  let p = buildGenerateWorldbuildingPrompt(extraction)
  p += '\n额外: 世界观测中增加身体改造规则、羞耻体系(等级层级+服从机制)、权力仪式、性爱相关的社会组织结构'
  return p
}

// ---- Convert extraction chapters to StyleChapter format ----
export function chaptersToStyleChapters(chapters: ChapterExtraction[]): StyleChapter[] {
  return chapters.map((ch, i) => ({
    id: `ch_${i + 1}`,
    title: ch.chapterTitle,
    chapterNumber: ch.chapterNumber,
    chapterType: 'chapter' as StyleChapter['chapterType'],
    content: ch.chapterContent,
    charCount: ch.chapterContent.length,
    analyzed: false,
    analysis: null,
  }))
}
