/**
 * DIM_TIERS — Dimension applicability tiers for smart style analysis.
 * Single source of truth. Used by styleAnalysis.ts, LibraryView.tsx, V4SystemPrompt.ts.
 *
 * Tier meanings:
 *   core     — Always present in any narrative text. MUST analyze.
 *   evidence — Only analyze if text shows clear evidence (≥2 explicit examples).
 *   erotic   — Only for erotic novels (情色小说). Skip entirely for other types.
 *   genre    — Only for specific novel genres. Check if type matches.
 */

export const DIM_TIERS: Record<string, { tier: 'core' | 'evidence' | 'erotic' | 'genre'; desc: string }> = {
  narrativeTone:       { tier: 'core', desc: '叙事基调（任何文本必有）' },
  sentenceStyle:        { tier: 'core', desc: '句式特征（任何文本必有）' },
  vocabularyStyle:      { tier: 'core', desc: '词汇特征（任何文本必有）' },
  rhetoricStyle:        { tier: 'core', desc: '修辞手法（任何文本必有）' },
  rhythmStyle:          { tier: 'core', desc: '节奏结构（任何文本必有）' },
  dialogueStyle:        { tier: 'core', desc: '对话风格（有对话则分析，无对话如实标注）' },
  moodStyle:            { tier: 'core', desc: '氛围描写（任何文本必有）' },
  perspectiveStyle:     { tier: 'core', desc: '叙事视角（任何文本必有）' },
  bodyLanguageStyle:    { tier: 'core', desc: '身体/动作描写（任何文本必有）' },
  sensoryStyle:         { tier: 'core', desc: '感官描写（任何文本必有）' },
  descriptionPattern:   { tier: 'core', desc: '描写结构模式（任何文本必有）' },
  tensionStyle:         { tier: 'evidence', desc: '心理张力（仅当文本有显著内心冲突时分析）' },
  compoundWordPattern:  { tier: 'evidence', desc: '复合造词模式（仅当有大量自造复合词时分析）' },
  onomatopoeiaSystem:   { tier: 'evidence', desc: '拟声词系统（仅当有显著拟声词使用模式时分析）' },
  corruptionArc:        { tier: 'erotic', desc: '人物堕落弧线（情色专属）' },
  degradationRitual:    { tier: 'erotic', desc: '凌辱/调教场景机制（情色专属）' },
  narrativeVoice:       { tier: 'erotic', desc: '叙事声音反差（情色专属）' },
  shameVoyeurLoop:      { tier: 'erotic', desc: '羞耻-窥视循环（情色专属）' },
  sensoryPackFormula:   { tier: 'erotic', desc: '感官打包句型公式（情色专属）' },
  bodyMindBetrayal:     { tier: 'erotic', desc: '身心背离写法（情色专属）' },
  costumeStyle:         { tier: 'erotic', desc: '衣着/装扮描写（情色专属）' },
  humiliationTemplate:  { tier: 'erotic', desc: '羞辱场景结构模板（情色专属）' },
  socialRealism:        { tier: 'genre', desc: '社会现实描写（都市/历史/科幻）' },
  cultivationCombat:    { tier: 'genre', desc: '修炼/战斗描写（修仙/武侠/玄幻）' },
  romanceArc:           { tier: 'genre', desc: '感情线发展（恋爱小说）' },
  archaicStyle:         { tier: 'genre', desc: '古风文言特征（古风/历史/武侠）' },
  suspensePacing:       { tier: 'genre', desc: '悬疑节奏（悬疑/灵异小说）' },
}

// v12.5.1: Dimension priority by novel type for focused style analysis.
// Higher tier = higher priority, more token budget.
// Tier 1: 情色核心（400字）  Tier 2: 情色支撑（300字）
// Tier 3: 辅助（200字）       Tier 4: 有证据才写（100字）
export const DIM_PRIORITY: Record<string, Record<string, { tier: 1 | 2 | 3 | 4; maxChars: number }>> = {
  '情色小说': {
    // Tier 1 — 情色核心: 决定风格模仿质量的关键维度
    narrativeTone:       { tier: 1, maxChars: 400 },
    bodyLanguageStyle:    { tier: 1, maxChars: 400 },
    bodyMindBetrayal:    { tier: 1, maxChars: 400 },  // 含心理撕裂(tensionStyle已合并)
    sensoryStyle:         { tier: 1, maxChars: 400 },  // 含感官打包(sensoryPackFormula已合并)
    degradationRitual:    { tier: 1, maxChars: 400 },
    rhetoricStyle:        { tier: 1, maxChars: 400 },
    vocabularyStyle:      { tier: 1, maxChars: 400 },  // 物化命名词（辱骂/物化+功能性重命名，语义层）
    onomatopoeiaSystem:   { tier: 1, maxChars: 400 },  // 叫床/淫叫词（性反应发声，听觉层）
    // Tier 2 — 情色支撑
    costumeStyle:         { tier: 2, maxChars: 200 },  // 衣着/装扮：衣服与身体的互动
    dialogueStyle:        { tier: 2, maxChars: 300 },
    humiliationTemplate:  { tier: 2, maxChars: 300 },
    shameVoyeurLoop:      { tier: 2, maxChars: 300 },
    // Tier 3 — 辅助（简要分析即可）
    moodStyle:            { tier: 3, maxChars: 150 },
    perspectiveStyle:     { tier: 3, maxChars: 150 },
    descriptionPattern:   { tier: 3, maxChars: 150 },
    narrativeVoice:       { tier: 3, maxChars: 150 },
  },
}

export interface ClassifiedDims {
  mustAnalyze: string[]
  checkFirst: string[]
  skipHint: string[]
}

/**
 * Classify a list of dimension keys by their applicability tier.
 * @param dimKeys — The dimension keys to classify
 * @param novelType — Optional novel type for erotic/genre tier checking
 */
export function classifyDimTiers(dimKeys: string[], novelType?: string): ClassifiedDims {
  const mustAnalyze: string[] = []
  const checkFirst: string[] = []
  const skipHint: string[] = []

  for (const dk of dimKeys) {
    const info = DIM_TIERS[dk] || { tier: 'evidence' as const, desc: '' }
    if (info.tier === 'core') {
      mustAnalyze.push(dk)
    } else if (info.tier === 'erotic') {
      if (novelType === '情色小说' || novelType === 'erotic') {
        mustAnalyze.push(dk)
      } else {
        skipHint.push(dk)
      }
    } else if (info.tier === 'genre') {
      checkFirst.push(dk)
    } else {
      checkFirst.push(dk)
    }
  }

  return { mustAnalyze, checkFirst, skipHint }
}

/**
 * Generate Markdown-formatted tier instructions for system prompts.
 * @param novelType — Optional novel type for erotic/genre tier handling
 */
export function getTieredDimInstructions(novelType?: string): string {
  const lines: string[] = []

  lines.push('✅ 必须分析（任何小说都有，每个维度写100-300字具体描述）：')
  for (const [key, info] of Object.entries(DIM_TIERS)) {
    if (info.tier === 'core') lines.push(`  ${key}(${info.desc})`)
  }

  lines.push('')
  lines.push('🔍 有证据才分析（原文找到≥2处证据→详析；无证据→跳过不填）：')
  for (const [key, info] of Object.entries(DIM_TIERS)) {
    if (info.tier === 'evidence') lines.push(`  ${key}(${info.desc})`)
  }

  const isErotic = novelType === '情色小说' || novelType === 'erotic'
  if (isErotic) {
    lines.push('')
    lines.push('🔞 情色专属（必须分析）：')
    for (const [key, info] of Object.entries(DIM_TIERS)) {
      if (info.tier === 'erotic') lines.push(`  ${key}(${info.desc})`)
    }
  } else {
    lines.push('')
    lines.push('⏭️ 情色专属（跳过，非情色小说不适用）：')
    for (const [key, info] of Object.entries(DIM_TIERS)) {
      if (info.tier === 'erotic') lines.push(`  ${key}(${info.desc})`)
    }
  }

  lines.push('')
  lines.push('📖 类型专属（仅匹配小说类型时分析，否则跳过）：')
  for (const [key, info] of Object.entries(DIM_TIERS)) {
    if (info.tier === 'genre') lines.push(`  ${key}(${info.desc})`)
  }

  return lines.join('\n')
}
