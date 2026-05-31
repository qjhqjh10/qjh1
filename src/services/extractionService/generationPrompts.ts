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
