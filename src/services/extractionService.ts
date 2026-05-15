import type {
  ChapterExtraction, ExtractedCharacterRaw, ExtractedWorldElement,
  ExtractedItem, ExtractedPowerMention, ExtractedForeshadow,
  AggregatedResult, AggregatedCharacter,
  NovelExtraction, PacingTemplate, GeneratedNovel,
  ChapterAnalysis, StyleProfile, StyleChapter,
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

// Build extraction prompt
export function buildExtractionPrompt(chapterTitle: string, chapterContent: string): string {
  return `你是一位专业的小说分析师。请分析以下小说章节，提取结构化信息。

【章节标题】${chapterTitle}
【章节内容】
${chapterContent}

请严格输出以下 JSON（不要markdown，不要额外说明）：
{
  "characters": [
    {
      "name": "角色名",
      "aliases": ["别名1"],
      "role": "推测的角色定位(主角/反派/配角/路人)",
      "traits": ["性格特征"],
      "appearance": "外貌描写",
      "action": "本章中做了什么",
      "newInfo": "本章新揭示的关于此角色的信息(没有填'')"
    }
  ],
  "worldbuilding": [
    {
      "type": "location|faction|rule|history|other",
      "name": "名称",
      "description": "描述",
      "newInfo": "本章新信息"
    }
  ],
  "items": [
    {
      "name": "物品/法宝/功法名",
      "type": "法宝|丹药|功法|武器|道具|其他",
      "grade": "等级/品阶(未知填'')",
      "owner": "持有者",
      "ability": "能力/效果",
      "acquisitionMethod": "获得方式"
    }
  ],
  "powerSystem": [
    {
      "term": "等级术语(如'筑基期')",
      "context": "上下文描述",
      "inferredLevel": 数字(从低到高推测排序,练气=1,筑基=2...)
    }
  ],
  "chapterSummary": "本章3-5句剧情摘要",
  "events": ["本章关键事件1", "本章关键事件2"],
  "foreshadowing": [
    {
      "description": "伏笔或回收描述",
      "type": "planted|resolved"
    }
  ],
  "emotionalTone": "本章情绪基调(紧张/温馨/悲伤/热血/悬疑...)"
}

要求:
1. 只提取文中明确写出或强烈暗示的信息，不要编造
2. 角色名使用文中原名称，保持一致性
3. 等级术语不要翻译，保持原文用词
4. 伏笔判断标准: 文中提到但未完全解释的信息=planted; 之前planted的信息在本章得到解释=resolved`
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
  return `你是一位小说创作专家。以下是新小说的大纲，请为每一章生成详细的剧情摘要（3-5句话），包括主要事件、角色互动和情绪基调。

新大纲:
${outline}

原作章节摘要参考（保持相似的节奏和密度）:
${extraction.chapters.filter(c => c.extractedAt).map(c => `第${c.chapterNumber}章: ${c.chapterSummary}`).join('\n').slice(0, 2000)}

请输出JSON数组:
[{"chapterNumber": 1, "title": "标题", "summary": "详细摘要"}]
只输出JSON，不要额外说明。`
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
