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