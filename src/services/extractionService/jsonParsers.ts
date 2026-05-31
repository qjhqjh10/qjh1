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

// Helper: find outermost balanced-brace JSON object (handles nested objects in AI responses)
function findBalancedJSON(text: string): string | null {
  let depth = 0, start = -1, end = -1
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') { if (depth === 0) start = i; depth++ }
    else if (text[i] === '}') {
      depth--
      if (depth === 0 && start >= 0) { end = i; break }
    }
  }
  if (start >= 0 && end > start) return text.slice(start, end + 1)
  return null
}

// C4: Balanced-brace extraction replaces the greedy /\{[\\s\\S]*\\}/ regex
// which would match from the first { to the last } in multi-object AI responses,
// producing invalid JSON.
export function extractJSON(reply: string): Record<string, any> {
  // Strategy 1: Balanced-brace extraction (handles nested objects, multi-object responses)
  const balanced = findBalancedJSON(reply)
  const candidates: string[] = []
  if (balanced) candidates.push(balanced)
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
    // Fix 4: Find outermost balanced braces via depth tracking (redundant with Strategy 1 for first candidate, but effective for raw reply fallback)
    try {
      let depth = 0, start = -1, end = -1
      for (let i = 0; i < raw.length; i++) {
        if (raw[i] === '{') { if (depth === 0) start = i; depth++ }
        else if (raw[i] === '}') { depth--; if (depth === 0 && start >= 0) { end = i; break } }
      }
      if (start >= 0 && end > start) {
        const balancedObj = raw.slice(start, end + 1)
        return JSON.parse(balancedObj.replace(/,(\s*[}\]])/g, '$1'))
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
