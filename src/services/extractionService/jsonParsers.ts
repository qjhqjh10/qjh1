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

// JSON extraction helpers for AI replies
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI-generated JSON has unpredictable shape
export function extractJSON(reply: string): Record<string, any> {
  // Strategy 1: Direct regex + clean parse
  const m = reply.match(/\{[\s\S]*\}/)
  const candidates: string[] = []
  if (m) candidates.push(m[0])
  candidates.push(reply) // fallback to raw reply

  for (const raw of candidates) {
    try { return JSON.parse(raw) } catch { /* try fixes */ }
    // Fix 1: Remove trailing commas
    try { return JSON.parse(raw.replace(/,(\s*[}\]])/g, '$1')) } catch { /* */ }
    // Fix 2: Remove all commas before } or ] (aggressive)
    try { return JSON.parse(raw.replace(/,(\s*\n?\s*[}\]])/g, '$1')) } catch { /* */ }
    // Fix 3: Truncate to last complete object
    try {
      const lastBrace = raw.lastIndexOf('}')
      if (lastBrace > 0) {
        let truncated = raw.slice(0, lastBrace + 1)
        truncated = truncated.replace(/,(\s*[}\]])/g, '$1')
        return JSON.parse(truncated)
      }
    } catch { /* */ }
    // Fix 4: Find the outermost balanced braces
    try {
      let depth = 0, start = -1
      for (let i = 0; i < raw.length; i++) {
        if (raw[i] === '{') { if (depth === 0) start = i; depth++ }
        else if (raw[i] === '}') { depth--; if (depth === 0 && start >= 0) break }
      }
      if (start >= 0 && depth === 0) {
        const balanced = raw.slice(start, raw.lastIndexOf('}') + 1)
        return JSON.parse(balanced.replace(/,(\s*[}\]])/g, '$1'))
      }
    } catch { /* */ }
  }

  // All fixes failed — throw with preview for debugging
  const preview = reply.slice(0, 200) + '...' + reply.slice(-100)
  throw new Error(`无法解析AI返回的JSON: ${preview}`)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI-generated JSON has unpredictable shape
function extractJSONArray(reply: string): any[] {
  const m = reply.match(/\[[\s\S]*\]/)
  if (!m) throw new Error('未找到JSON数组')
  try { return JSON.parse(m[0]) } catch { /* try fix */ }
  try { return JSON.parse(m[0].replace(/,(\s*[\]])/g, '$1')) } catch { /* */ }
  // Fallback: find balanced brackets
  let depth = 0, start = -1
  for (let i = 0; i < reply.length; i++) {
    if (reply[i] === '[') { if (depth === 0) start = i; depth++ }
    else if (reply[i] === ']') { depth--; if (depth === 0 && start >= 0) break }
  }
  if (start >= 0 && depth === 0) {
    return JSON.parse(reply.slice(start, reply.lastIndexOf(']') + 1).replace(/,(\s*[\]])/g, '$1'))
  }
  throw new Error('无法解析AI返回的JSON数组')
}
