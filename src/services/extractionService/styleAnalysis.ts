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
import { safeJsonParse } from '@/utils/safeJsonParse'


// ============================================================
// Style Analysis: marked-block format (resilient to JSON errors)
// ============================================================

import { DIM_TIERS, classifyDimTiers, type ClassifiedDims } from '@/utils/dimTiers'

export function buildStyleAnalyzePrompt(dims: string[], novelType?: string): string {
  const { mustAnalyze, checkFirst, skipHint } = classifyDimTiers(dims, novelType)

  const fmtGroup = (items: string[], prefix: string) => items.map(k => {
    const meta = DIMENSION_META[k]
    return `  ${prefix} ${k}: ${meta?.label || k}（${(DIM_TIERS[k] || { desc: '内容判定' }).desc}）`
  }).join('\n')

  const mustList = fmtGroup(mustAnalyze, '✅')
  const checkList = fmtGroup(checkFirst, '🔍')
  const skipList = fmtGroup(skipHint, '⏭️')

  return `你是专业的文学风格分析师。请对以下章节进行深度写作风格分析。

【维度分析策略 — 极其重要，仔细阅读并严格执行】

以下维度按适用性分为三类，每类有不同的分析要求：

1️⃣ 必须分析（任何叙事文本都包含这些特征，必须输出分析）：
${mustList || '  （无）'}

2️⃣ 先检查再决定（在原文中找到 ≥2处证据 → 详细分析；找不到 → 静默跳过）：
${checkList || '  （无）'}

3️⃣ 类型不匹配（非当前小说类型的专属维度，强烈建议全部跳过）：
${skipList || '  （无）'}

【分析三原则】
✅ 有证据 → 必须写: 200-400字深度分析 + ≥3个原文例句(> 引用) + 具体写作规则
❌ 无证据 → 必须跳: 不输出该维度的 ## 区块，不写占位内容，不强行编造
🔍 证据标准: 至少能在原文中找到2处以上明确的、可直接引用的原文词句

【输出格式】
每个有证据的维度输出一个 Markdown 二级标题区块：

## 维度key: 中文标签
200-400字深度分析。引用原文词句时用 > 标记。
> 原文例句（必须直接从原文摘录）
> 原文例句
> 原文例句

---VOCABULARY---
["原文词1","原文词2",...]（20-50个高频/特色词，双引号，无尾逗号）

---RULES---
["写作规则1","规则2",...]（3-10条可执行的具体写作指令）

---TONE---
{"word":"基调词","description":"100字叙事基调描述","attitude":"冷漠旁观/欣赏把玩/幽默调侃/温柔包容/神圣庄严/冷酷写实/热忱歌颂/暧昧诱导/疑惑探索（选一）"}

【格式铁律】
1. 标题严格用 ## dimKey: 中文标签（如 ## sentenceStyle: 句式）
2. VOCABULARY/RULES/TONE 三个标记独占一行，从行首开始
3. 所有JSON用双引号，数组和对象末尾不要有逗号
4. 全文只输出一次 VOCABULARY/RULES/TONE（各一个），汇总所有维度
5. 禁止用代码块包裹输出内容`
}

// Parses marked-block format into ChapterAnalysis
export function parseStyleAnalysisReply(reply: string, dims: string[]): ChapterAnalysis {
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
    const label = DIMENSION_META[dk]?.label || dk
    const escapedKey = dk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const patterns = [
      // V4: Markdown header ## dimKey: label or ## label（dimKey）
      new RegExp(`##\\s+${escapedKey}\\s*[:：]\\s*${escapedLabel}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|\\n---VOCABULARY|\\n---RULES|\\n---TONE|$)`, 'im'),
      new RegExp(`##\\s+${escapedLabel}\\s*[（(]?\\s*${escapedKey}\\s*[）)]?\\s*\\n([\\s\\S]*?)(?=\\n##\\s|\\n---VOCABULARY|\\n---RULES|\\n---TONE|$)`, 'im'),
      // Legacy: === dimKey: label ===
      new RegExp(`===\\s*${escapedKey}\\s*:\\s*[^=]+?\\s*===\\s*\\n([\\s\\S]*?)(?=\\n===|\\n##\\s|$)`, 'im'),
      new RegExp(`===\\s*${escapedKey}\\s*===\\s*\\n([\\s\\S]*?)(?=\\n===|\\n##\\s|$)`, 'im'),
      // Bracket format: [dimKey]: description
      new RegExp(`\\[${escapedKey}\\][:：]([\\s\\S]*?)(?=\\n\\[|\\n===|\\n##\\s|$)`, 'im'),
      // Bold: **label** or **dimKey**
      new RegExp(`\\*\\*${escapedLabel}\\*\\*\\s*[:：]?\\s*\\n([\\s\\S]*?)(?=\\n\\*\\*|\\n##\\s|\\n---|$)`, 'im'),
    ]
    for (const pat of patterns) {
      const m = freeText.match(pat)
      if (m && m[1]?.trim().length > 20) {
        dimMap.set(dk, { label, description: m[1].trim() })
        break
      }
    }
    // Fallback: find dimension mentioned anywhere in text
    if (!dimMap.has(dk)) {
      const mentionPat = new RegExp(`${escapedKey}|${escapedLabel}\\s*[:：]\\s*`, 'i')
      if (mentionPat.test(freeText) && freeText.length > 100) {
        dimMap.set(dk, { label, description: '' })
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
    const candidates = [block, block.replace(/,\s*\]/g, ']'), block.replace(/，/g, ',').replace(/,\s*\]/g, ']')]
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
        const parsed = safeJsonParse(objMatch[0]) as Record<string, unknown> | null
        toneWord = typeof parsed?.word === 'string' ? parsed.word : ''
        toneDesc = typeof parsed?.description === 'string' ? parsed.description : ''
        toneAttitude = typeof parsed?.attitude === 'string' ? parsed.attitude : ''
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

// Builds a summary prompt that asks AI to synthesize per-chapter
// dimAnalyses into a unified StyleProfile using the same marked-block format.
export function buildSummarizePrompt(
  analyzedCount: number,
  dimAnalysesSummary: string,
  novelType: string,
): string {
  // Determine which tier-3/4 dims are relevant for this novel type
  const isErotic = novelType === '情色小说' || novelType === 'erotic'

  const typeNote = isErotic
    ? `【类型提示】当前为情色小说。情色专属维度（corruptionArc/degradationRitual/narrativeVoice/shameVoyeurLoop/sensoryPackFormula/bodyMindBetrayal/humiliationTemplate）如果各章分析中有数据，必须重点综合。`
    : `【类型提示】当前为${novelType || '未指定'}类型。非本类型专属的维度不要强行总结。`

  return `你是专业的文学风格分析师。请综合以下 ${analyzedCount} 章的逐章分析，生成一份完整的风格档案。

【小说类型】${novelType}
${typeNote}

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

【综合规则】
1. 只总结在逐章分析中实际出现过的维度。未出现的维度说明原文没有相关特征，不要强行补充
2. 如果某维度在 ≥30% 的章节中被分析到，重点综合；如果仅在个别章节出现，简要提及即可；如果从未出现，跳过
3. 全书写词汇和规则从各章分析中提炼，去重合并。优先列出高频词和可跨章执行的通用规则
4. 所有 JSON 数组和对象不要尾部逗号，不要用代码块包裹内容`
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
      const bodyCount = (p.match(/屁眼|鸡巴|卵蛋|龟头|肉穴|阴唇|子宫|乳房|臀部/g) || []).length
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
