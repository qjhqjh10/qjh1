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


import { extractJSON } from './jsonParsers';
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

【可选的分析维度（参考清单）】
${dimensionInstructions}

【输出格式】
请严格按照以下格式输出（不要用 markdown 代码块）：

=== [维度key]: [中文标签] ===
（200-400字深度分析。必须包含：具体描述 + 引用3个以上原文词句作为证据）
...分析内容...

---VOCABULARY---
["原文词1","原文词2","原文词3",...]

---RULES---
["写作规则1","写作规则2","写作规则3",...]

---TONE---
{"word":"基调词","description":"100字基调描述","attitude":"叙述者态度（冷漠旁观/欣赏把玩/幽默调侃/温柔包容/神圣庄严/冷酷写实/热忱歌颂/暧昧诱导/疑惑探索，或自定义）"}

【关键规则——决定输出哪些维度】
1. **有证据才写，没证据不写**。仅分析在原文中找到实际证据的维度。某维度在本章中完全没有体现（如纯对话章没有身体描写、普通章节没有情色内容），**直接跳过不写该维度**，不要输出空分析，不要写"[此维度在本章不适用]"之类的占位文字。
2. 每个输出维度分析必须 200-400 字，引用原文具体词汇/句子
3. VOCABULARY 数组必须是原文中实际出现的词，禁止编造
4. RULES 数组必须是可直接执行的写作指令（每条 15-50 字），不要写笼统建议
5. TONE 中的基调词限 2-8 字
6. 标记块（---XXX---）必须从行首开始，单独一行
7. 数组和对象必须是合法 JSON（注意：字符串用双引号，不要尾部逗号）
8. 不要用 \`\`\`json 代码块包裹任何内容
9. 宁可少分析几个维度，也不编造不存在的内容凑数`
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

  // ── Step 5: Assemble ChapterAnalysis (only for dimensions AI actually reported) ──
  const dimAnalyses: Record<string, DimAnalysis> = {}
  for (const [dk, info] of dimMap) {
    const desc = info.description || ''
    if (!desc || desc.length < 10) continue // Skip truly empty/placeholder dimensions
    const dimVocab: string[] = []
    if (vocabularyList.length > 0) {
      if (dk === 'bodyLanguageStyle' || dk === 'sensoryStyle' || dk === 'vocabularyStyle') {
        dimVocab.push(...vocabularyList)
      }
    }
    const dimRules = dk === 'narrativeTone' && toneDesc
      ? [`基调: ${toneWord} - ${toneDesc}`]
      : writingRules.length > 0 ? writingRules.slice(0, 8) : []

    dimAnalyses[dk] = {
      description: desc,
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
  // Extract first non-empty description as excerpt, limit to 200 chars
  const firstDesc = Object.values(dimAnalyses).find(d => (d as DimAnalysis)?.description?.length > 10)
  const excerpt = firstDesc ? (firstDesc as DimAnalysis).description.slice(0, 200) : ''

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

// Builds a V3-format summary prompt that asks AI to synthesize per-chapter
// dimAnalyses into a unified StyleProfile using the same marked-block format.
export function buildSummarizePromptV3(
  analyzedCount: number,
  dimAnalysesSummary: string,
  novelType: string,
): string {
  return `你是专业的文学风格分析师。请综合以下 ${analyzedCount} 章的逐章分析，生成一份完整的风格档案。

【小说类型】${novelType}

【各章分析汇总】
${dimAnalysesSummary}

【输出格式】
请严格按照以下格式输出（不要用 markdown 代码块）：

=== 风格综述 ===
（300-500字。综合所有章节，描述该小说的整体写作风格特征）

=== [维度key]: [中文标签] ===
（200-400字。该维度在全书的综合表现，引用最具代表性的原文证据）
...分析内容...

---VOCABULARY---
["全书高频词1","全书高频词2",...]

---RULES---
["全局写作规则1","全局写作规则2",...]

---TONE---
{"word":"整体叙事基调词","description":"100字基调描述","attitude":"叙述者态度（冷漠旁观/欣赏把玩/幽默调侃/温柔包容/神圣庄严/冷酷写实/热忱歌颂/暧昧诱导/疑惑探索，或自定义）"}

【规则】
1. 综合各章分析，提炼最具代表性的特征。如果某维度在多数章节都有体现，重点分析；如果某维度仅偶尔出现，简要提及即可
2. 全书写词汇优先列出出现频率最高、最具辨识度的词
3. 全局写作规则应提炼为可跨章节执行的通用原则
4. 只输出 JSON 合法的数组和对象，不要尾部逗号
5. 不要用代码块包裹内容`
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
