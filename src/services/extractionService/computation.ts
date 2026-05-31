import type {
  ChapterExtraction, ExtractedCharacterRaw, ExtractedWorldElement,
  ExtractedItem, ExtractedPowerMention, ExtractedForeshadow,
  AggregatedResult, AggregatedCharacter,
  NovelExtraction, PacingTemplate,
  ChapterAnalysis, StyleProfile, StyleChapter, DimAnalysis,
  EroticExtractionData, EventPattern, ProgressionRhythm,
  CharacterArchetype, EmotionCurve,
} from '@/types/story'
// (dead imports removed)


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

// ---- Erotic extraction ----

// Append erotic section to extraction prompt (only for erotic novels)