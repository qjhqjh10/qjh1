import { extractJSON } from './jsonParsers';

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

