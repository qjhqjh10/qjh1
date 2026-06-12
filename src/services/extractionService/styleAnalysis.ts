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
import type { CategorizedVocab } from '@/types/story/style'
import { safeJsonParse } from '@/utils/safeJsonParse'


// ============================================================
// Style Analysis: marked-block format (resilient to JSON errors)
// ============================================================

import { DIM_TIERS, DIM_PRIORITY, classifyDimTiers, type ClassifiedDims } from '@/utils/dimTiers'
import { getSpecialNote } from './specialNotes'

export function buildStyleAnalyzePrompt(dims: string[], novelType?: string): string {
  const { mustAnalyze, checkFirst, skipHint } = classifyDimTiers(dims, novelType)
  const priorityMap = (novelType && DIM_PRIORITY[novelType]) ? DIM_PRIORITY[novelType] : null

  // Sort mustAnalyze dims by priority
  const sortedMustAnalyze = priorityMap
    ? [...mustAnalyze].sort((a, b) => (priorityMap[a]?.tier ?? 4) - (priorityMap[b]?.tier ?? 4))
    : mustAnalyze

  // v12.8: Split into two phases — T1 first (full attention), then T0+T2+T3 (shorter)
  const phase1Dims = sortedMustAnalyze.filter(dk => priorityMap?.[dk]?.tier === 1)
  const phase2Dims = sortedMustAnalyze.filter(dk => priorityMap?.[dk]?.tier !== 1)

  const fmtGroup = (items: string[], prefix: string) => items.map(k => {
    const meta = DIMENSION_META[k]
    const p = priorityMap?.[k]
    let tierTag = ''
    if (p) {
      if (p.tier === 0) tierTag = '【总基调】 '
      else tierTag = `★T${p.tier} `
    }
    const charsHint = p ? `（${p.minChars}-${p.maxChars}字）` : ''
    return `  ${prefix} ${tierTag}${k}: ${meta?.label || k}${charsHint}`
  }).join('\n')

  const requiredDims = sortedMustAnalyze.filter(dk => {
    const p = priorityMap?.[dk]
    return p && p.tier <= 2
  })

  return `你是专业的文学风格分析师。请对以下章节进行深度写作风格分析。

【两段式分析 — 严格按顺序执行，先Phase1再Phase2】

Phase 1【T1核心维度，必须首先分析，投入最多篇幅】：
这5个维度直接决定情色文本的感官质地——集中精力逐项分析。

${fmtGroup(phase1Dims, '🔴')}

⬇ 完成Phase 1全部维度后，再开始Phase 2 ⬇

Phase 2【总基调+T2+T3，简要分析】：
字数约为Phase 1各维度的一半，公式化输出即可。

${fmtGroup(phase2Dims, '🔹')}

【维度分析策略 — 请仔细阅读并认真遵循】

1️⃣ 必须分析（共 ${sortedMustAnalyze.length} 个维度）：

2️⃣ 先检查再决定（在原文中找到 ≥2处证据 → 分析；找不到 → 跳过）：
${fmtGroup(checkFirst, '🔍') || '  （无）'}

3️⃣ 类型不匹配（非当前小说类型的专属维度，强烈建议全部跳过）：
${fmtGroup(skipHint, '⏭️') || '  （无）'}

${priorityMap ? (() => {
  const dims = priorityMap;
  const t1 = Object.entries(dims).filter(([,v]: [string, any]) => v.tier === 1);
  const t2 = Object.entries(dims).filter(([,v]: [string, any]) => v.tier === 2);
  const t03 = Object.entries(dims).filter(([,v]: [string, any]) => v.tier === 0 || v.tier === 3);
  const fmtDim = ([k, v]: [string, { minChars: number; maxChars: number }]) => `   ${k.padEnd(24)}约 ${v.minChars}-${v.maxChars}字`;
  return `【篇幅分配 — T2篇幅约为T1的2/3，以下为参考范围，不强制精确】

🔴 T1核心（最详细）：
${t1.map(fmtDim).join('\n')}

🔹 T2结构（约为T1篇幅的2/3）：
${t2.map(fmtDim).join('\n')}

⚪ T0+T3（简要）：
${t03.map(fmtDim).join('\n')}
` })() : `【分析三原则】
✅ 有证据 → 必须写: 200-400字深度分析 + ≥3个原文例句(> 引用) + 具体写作规则
❌ 无证据 → 必须跳: 不输出该维度的 ## 区块，不写占位内容，不强行编造
`}

【输出格式 — 标题请用 ## 双井号，不要用 # 单井号】

${priorityMap ? `应覆盖的维度（总基调+T1+T2共 ${requiredDims.length} 个维度）：
${requiredDims.map(dk => `  ## ${dk}: ${DIMENSION_META[dk]?.label || dk}（${priorityMap[dk]?.tier === 0 ? '总基调，' + priorityMap[dk]?.minChars + '-' + priorityMap[dk]?.maxChars + '字' : '★T' + priorityMap[dk]?.tier + '，' + priorityMap[dk]?.minChars + '-' + priorityMap[dk]?.maxChars + '字'}）`).join('\n')}
` : ''}
每个维度用 ## 标题开头，正文用紧凑纯文本。每段之间一个空行。

## 维度key: 中文标签
正文直接从分析开始，不要前缀废话。需要引用原文时单独一行用 > 开头。
> 从原文摘录的词句
正文末尾附该维度专属写作规则，用"规则："开头独占一行。每条规则只写本维度特有技法——不同维度的规则不得相同。

${getSpecialNote(novelType)}

⚠️ 在输出所有维度分析之前，必须先输出以下三个汇总块。这是强制要求——没有VOCABULARY/RULES/TONE的分析是不完整的。

---VOCABULARY---
{"sexBody":["词1"],"roleIdentity":["词1"],"actionTechnique":["词1"],"sceneCostume":["词1"],"moanOnomatopoeia":["词1"]}
每类1-5个代表性词，某类若原文未出现写空数组[]。双引号，无尾逗号。

---RULES---
["写作规则1","规则2",...]（各维度专属规则汇总，去重后列出）

---TONE---
{"word":"基调词","description":"100字叙事基调描述","attitude":"冷漠旁观/欣赏把玩/幽默调侃/温柔包容/神圣庄严/冷酷写实/热忱歌颂/暧昧诱导/疑惑探索（选一）"}

然后再逐维度输出各 ## 分析。

【各维度分析指导 — 请按以下要点逐维度分析】
${(() => {
  // v12.5.1: Append DIMENSION_META.prompt for key dims (cap to prevent token bloat)
  const critical = mustAnalyze.slice(0, 10)
  return critical.map(dk => {
    const meta = DIMENSION_META[dk]
    if (!meta?.prompt) return ''
    // Only include the analysis focus (first 120 chars), drop JSON format template
    const p = meta.prompt.slice(0, 120).replace(/".*?"/, '').trim()
    return `- ${dk} (${meta.label}): ${p}`
  }).filter(Boolean).join('\n')
})()}

【格式规范 — 请遵守以下输出约定】
1. 标题统一用 ## dimKey: 中文标签（如 ## sentenceStyle: 句式）
2. VOCABULARY/RULES/TONE 三个标记独占一行，从行首开始
3. 所有JSON用双引号，数组和对象末尾不要有逗号
4. 全文只输出一次 VOCABULARY/RULES/TONE（各一个），汇总所有维度
5. 不要用代码块包裹输出内容
6. ⚠️ 请确保输出所有1️⃣中列出的维度。分析完一个维度后继续输出下一个 ## 维度，直到全部完成。不要中途停止。`
}

// Parses marked-block format into ChapterAnalysis
export function parseStyleAnalysisReply(reply: string, dims: string[]): ChapterAnalysis {
  // ── Step 0: Extract VOCABULARY/RULES/TONE blocks FIRST, before any stripping ──
  let processed = reply

  // Extract global VOCABULARY/RULES: merge ALL occurrences across the text
  // Supports both old flat array ["w1","w2"] and new categorized object {"sexBody":[...],...}
  const allVocabWords: string[] = []
  const categorizedVocab: CategorizedVocab = {
    sexBody: [], roleIdentity: [], actionTechnique: [], sceneCostume: [], moanOnomatopoeia: []
  }
  const allRules: string[] = []
  processed = processed.replace(/(?:^|\n)---VOCABULARY---\n(\[[\s\S]*?\]|\{[\s\S]*?\})/g, (_m, json) => {
    try {
      const p = JSON.parse(json)
      if (Array.isArray(p)) {
        // Old flat format
        allVocabWords.push(...p)
      } else if (typeof p === 'object' && p !== null) {
        // New categorized format: merge each category
        for (const cat of Object.keys(categorizedVocab) as (keyof CategorizedVocab)[]) {
          const val = p[cat]
          if (Array.isArray(val)) categorizedVocab[cat].push(...val)
          else if (typeof val === 'string') categorizedVocab[cat].push(val)
        }
      }
    } catch {}
    return '\n'
  })
  processed = processed.replace(/(?:^|\n)---RULES---\n(\[[\s\S]*?\])/g, (_m, arr) => {
    try { const p = JSON.parse(arr); if (Array.isArray(p)) allRules.push(...p) } catch {}
    return '\n'
  })

  // Parse TONE block
  const toneMatch = processed.match(/(?:^|\n)---TONE---\n(\{[\s\S]*?\})/)
  let toneWord = ''
  let toneDesc = ''
  let toneAttitude = ''
  if (toneMatch) {
    try {
      const parsed = safeJsonParse(toneMatch[1]) as Record<string, unknown> | null
      toneWord = typeof parsed?.word === 'string' ? parsed.word : ''
      toneDesc = typeof parsed?.description === 'string' ? parsed.description : ''
      toneAttitude = typeof parsed?.attitude === 'string' ? parsed.attitude : ''
    } catch { /* keep defaults */ }
    processed = processed.replace(/(?:^|\n)---TONE---\n\{[\s\S]*?\}/g, '\n')
  }

  // ── Step 1: Strip AI intro, normalize headers ──
  let firstHeader = processed.search(/^##? /m)
  if (firstHeader < 0) firstHeader = processed.search(/^# /m)
  if (firstHeader > 0) processed = processed.slice(firstHeader)
  // Normalize ## headers (AI sometimes uses single #)
  processed = processed.replace(/^# /gm, '## ')

  // ── Step 2: Extract per-dimension descriptions by splitting on ## headers ──
  const dimMap = new Map<string, { label: string; description: string }>()
  // Build a key→label lookup for matching
  const keyToLabel = new Map(dims.map(dk => [dk, DIMENSION_META[dk]?.label || dk]))
  // Split by ## headers, match each section to its dimension
  const sections = processed.split(/\n(?=## )/)
  for (const section of sections) {
    const headerMatch = section.match(/^##\s+(\w+)\s*[:：]\s*(.+)/m)
    if (!headerMatch) continue
    const key = headerMatch[1]
    // Strip priority tags like （★T1）from header label for matching
    const headerLabel = headerMatch[2]?.replace(/[（(]★T\d[）)]/g, '').trim()
    const expectedLabel = keyToLabel.get(key)
    // Match if the header label contains the expected label (AI may add extra text)
    if (!expectedLabel || !headerLabel?.includes(expectedLabel)) continue
    // Body is everything after the header line
    const bodyIdx = section.indexOf('\n')
    const body = bodyIdx >= 0 ? section.slice(bodyIdx + 1).trim() : ''
    if (body.length > 20) {
      dimMap.set(key, { label: expectedLabel, description: body })
    }
  }

  // Deduplicate global vocab/rules
  const vocabularyList = [...new Set(allVocabWords)]
  const writingRules = [...new Set(allRules)]

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

    // v12.5.1: Extract > -prefixed example lines from description
    const examples: string[] = []
    const exampleLines = desc.match(/^>\s*.+$/gm)
    let cleanDesc = desc
    if (exampleLines) {
      for (const line of exampleLines) {
        const cleaned = line.replace(/^>\s*/, '').trim()
        if (cleaned.length > 5 && !examples.includes(cleaned)) {
          examples.push(cleaned)
        }
      }
      // Strip > lines from description to avoid duplication
      cleanDesc = desc.replace(/^>\s*.+$/gm, '').replace(/\n{3,}/g, '\n\n').trim()
    }

    // v12.5.1: Distribute vocabulary to all dimensions (not just 3)
    const dimVocab: string[] = []
    if (vocabularyList.length > 0) {
      if (dk === 'bodyLanguageStyle' || dk === 'sensoryStyle' || dk === 'vocabularyStyle') {
        dimVocab.push(...vocabularyList)
      } else {
        // Extract quoted terms from this dimension's description
        const quotedTerms = cleanDesc.match(/["「]([^"「」]{1,12})["」]/g)
        if (quotedTerms) {
          const terms = quotedTerms.map(t => t.replace(/["「」]/g, '').trim()).filter(t => t.length >= 2)
          dimVocab.push(...terms.slice(0, 15))
        }
        // Also give each dimension a few words from the global vocabulary
        dimVocab.push(...vocabularyList.slice(0, 8))
      }
    }
    // Extract per-dimension rules from this dimension's description.
    // Priority: 1) "规则：" lines in description → 2) global RULES block → 3) empty
    const descRuleLines = cleanDesc.match(/^规则[：:]\s*(.+)$/gm)
    const extractedRules: string[] = []
    if (descRuleLines) {
      for (const rl of descRuleLines) {
        const cleaned = rl.replace(/^规则[：:]\s*/, '').trim()
        if (cleaned.length > 3 && cleaned.length < 200) extractedRules.push(cleaned)
      }
      // Remove rule lines from description to avoid duplication
      cleanDesc = cleanDesc.replace(/^规则[：:]\s*.+$/gm, '').replace(/\n{3,}/g, '\n\n').trim()
    }
    const dimRules = dk === 'narrativeTone' && toneDesc
      ? [`基调: ${toneWord} - ${toneDesc}`]
      : extractedRules.length > 0
        ? extractedRules.slice(0, 8)
        : writingRules.length > 0 ? writingRules.slice(0, 4) : []

    dimAnalyses[dk] = {
      description: cleanDesc,
      examples: examples.slice(0, 10),
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
    categorizedVocab: (categorizedVocab.sexBody.length > 0 || categorizedVocab.roleIdentity.length > 0) ? categorizedVocab : undefined,
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
    ? `【类型提示】当前为情色小说。情色专属维度（corruptionArc/degradationRitual/narrativeVoice/shameVoyeurLoop/sensoryPackFormula/bodyMindBetrayal/humiliationTemplate）如果各章分析中有数据，请重点综合。`
    : `【类型提示】当前为${novelType || '未指定'}类型。非本类型专属的维度不必强行总结——没有数据就跳过。`

  return `你是专业的文学风格分析师。请综合以下 ${analyzedCount} 章的逐章分析，生成一份完整的风格档案。

【小说类型】${novelType}
${typeNote}

【各章分析汇总】
${dimAnalysesSummary}

【输出格式】
请按以下格式输出（不要用 markdown 代码块包裹）：

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

【综合规范】
1. 只总结在逐章分析中实际出现过的维度。未出现的维度说明原文没有相关特征，不必强行补充
2. 某维度在 ≥30% 的章节中被分析到 → 重点综合；仅在个别章节出现 → 简要提及；从未出现 → 跳过
3. 全书词汇和规则从各章分析中提炼、去重合并。优先列出高频词和可跨章执行的通用规则
4. JSON 数组和对象不要尾部逗号，不要用代码块包裹内容`
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
