import { countCJKChars } from '@/utils/textUtils'
import type { RewritePromptTemplate } from '@/types/rewritePrompts'
import type { ContextMarker } from '@/types/rewrite'

// ═══════════════════════════════════════════════════════════════
// Scene-segment rewriting utilities (Req 5)
// Extracted from RewriteWorkspacePage.tsx (v13.5.3)
// ═══════════════════════════════════════════════════════════════

/** Find text in content using increasingly fuzzy matching */
export function findTextInContent(content: string, text: string, afterIndex: number = 0): number {
  // Level 1: Exact match
  const exact = content.indexOf(text, afterIndex)
  if (exact !== -1) return exact

  // Level 2: Normalize whitespace then try sliding window
  const normalized = text.replace(/\s+/g, '')
  if (normalized.length >= 4) {
    for (let i = afterIndex; i <= content.length - normalized.length; i++) {
      const slice = content.slice(i, i + normalized.length).replace(/\s+/g, '')
      if (slice === normalized) return i
    }
  }

  // Level 3: Try progressively shorter prefixes (8→6→4 chars)
  for (const prefixLen of [8, 6, 4]) {
    if (text.length >= prefixLen) {
      const prefix = text.slice(0, prefixLen)
      const prefixIdx = content.indexOf(prefix, afterIndex)
      if (prefixIdx !== -1) return prefixIdx
    }
  }

  // Level 4: Character-level fuzzy — find longest common substring
  if (text.length >= 10) {
    let bestIdx = -1; let bestLen = 0
    const minMatch = Math.floor(text.length * 0.5) // at least 50% of text
    for (let i = afterIndex; i < content.length - 3; i++) {
      let matchLen = 0
      while (matchLen < text.length && i + matchLen < content.length && content[i + matchLen] === text[matchLen]) {
        matchLen++
      }
      if (matchLen > bestLen) { bestLen = matchLen; bestIdx = i }
      if (bestLen >= minMatch) break // good enough
    }
    if (bestLen >= minMatch) return bestIdx
  }

  return -1
}

/** Extract the text segment between startText and endText markers in content */
export function extractSceneSegment(content: string, marker: ContextMarker): { text: string; start: number; end: number } | null {
  if (!marker.startText || !marker.endText) return null

  const startIdx = findTextInContent(content, marker.startText)
  if (startIdx === -1) return null

  const endIdx = findTextInContent(content, marker.endText, startIdx + marker.startText.length)
  if (endIdx === -1) return null

  const endPos = endIdx + marker.endText.length
  return { text: content.substring(startIdx, endPos), start: startIdx, end: endPos }
}

/** Build sceneName → guidance mapping (handles both id-keyed and name-keyed sceneGuidance) */
export function buildSceneGuidanceMap(template: RewritePromptTemplate): Record<string, string> {
  const map: Record<string, string> = {}
  if (!template.sceneGuidance) return map
  for (const rule of template.sceneRules) {
    // Try both id and name as keys
    const guidance = template.sceneGuidance[rule.id] || template.sceneGuidance[rule.name]
    if (guidance) {
      map[rule.name] = guidance
    }
  }
  // Also copy any entries keyed directly by name
  for (const [key, value] of Object.entries(template.sceneGuidance)) {
    if (!map[key]) map[key] = value
  }
  return map
}

/** Build a prompt for rewriting ONLY a specific scene segment (not the full chapter) */
// v15.1: 新增 extraWordTarget + chapterWordCount —— 项目级「改写字数」按本段占全章字数比例
// 换算成该段的加料目标（原实现完全不传改写字数，精密改写模式下加料目标不生效）
export function buildSegmentRewritePrompt(
  segmentText: string,
  sceneNames: string[],
  description: string,
  template?: RewritePromptTemplate | null,
  extraWordTarget?: number,
  chapterWordCount?: number,
): string {
  // Build scene-specific guidance using proper name mapping
  let guidanceLines = ''
  if (template && template.sceneGuidance) {
    const guidanceMap = buildSceneGuidanceMap(template)
    const guidances = sceneNames
      .filter(n => guidanceMap[n])
      .map(n => `【${n}】${guidanceMap[n]}`)
    if (guidances.length > 0) {
      guidanceLines = `\n场景改写规则：\n${guidances.join('\n')}`
    }
  }

  // Add universal guidance if available
  if (template?.universalGuidance) {
    guidanceLines += `\n\n通用改写指导：\n${template.universalGuidance}`
  }

  // Word count: defer to template guidance, fallback to generic instruction
  // v15.1: 项目级改写字数（额外加料）按段落占全章比例换算本段目标
  const originalWc = countCJKChars(segmentText)
  const hasTemplateGuidance = !!(template?.universalGuidance || (template?.sceneGuidance && Object.keys(template.sceneGuidance).length > 0))

  let segmentTargetNote = ''
  if (extraWordTarget && extraWordTarget > 0 && chapterWordCount && chapterWordCount > 0) {
    const ratio = Math.min(1, originalWc / chapterWordCount)
    const segTarget = Math.max(0, Math.round(extraWordTarget * ratio))
    segmentTargetNote = segTarget > 0
      ? `\n- 全章加料目标：在原文基础上额外扩充约${extraWordTarget}字。本段原文${originalWc}字（占全章约${Math.round(ratio * 100)}%），本段建议额外扩充约${segTarget}字。`
      : ''
  }

  const wordTargetInstruction = hasTemplateGuidance
    ? `\n- 字数要求：请严格按照上述「场景改写规则」和「通用改写指导」中的篇幅控制来执行。如无特殊说明，请保持与原文相近的字数范围，适当扩展。原文本段${originalWc}字，作为扩展的基数参考。${segmentTargetNote}`
    : `\n- 字数要求：请在保持原文核心情节的基础上，适当扩展内容，使改写后更加丰满。原文本段${originalWc}字，作为扩展的基数参考。${segmentTargetNote}`

  const sceneLabel = sceneNames.join(' + ')
  const isOverlap = sceneNames.length > 1

  return `你是一位专业的小说改写助手。请对以下场景段落进行加料改写。

场景类型：${sceneLabel}${isOverlap ? '（重叠场景，需综合所有场景的改写规则）' : ''}
场景剧情：${description}${guidanceLines}

原文段落：
${segmentText}

改写要求：
- 保持核心剧情走向和人物关系不变
- ⚠️ 加料改写：不是简单润色文字，而是按照改写规则丰富和扩展内容
- 增加详细的感官描写（视觉、触觉、听觉、嗅觉、味觉）
- 扩展肢体互动的细节描述、对话中的情绪反应、环境氛围渲染${wordTargetInstruction}
- 段落之间用空行分隔，不要使用缩进表示分段
- ⚠️ 输出范围：只改写本场景段落本身——不得输出原文中的其他段落、不得添加章节标题、不得在段落前后附加任何说明文字
- 直接输出改写后的段落内容，不要包含任何解释或标记。`
}

/** Simplified: Assemble without marker info (for batch processing) */
export function assembleRewrittenChapterFromSimple(
  originalContent: string,
  positionedSegments: { start: number; end: number; rewritten: string }[]
): string {
  const valid = positionedSegments
    .filter(s => s.start >= 0 && s.end > s.start && s.rewritten.trim())
    .sort((a, b) => a.start - b.start)

  if (valid.length === 0) return originalContent

  // Merge overlapping segments
  const merged: { start: number; end: number; rewritten: string }[] = []
  for (const seg of valid) {
    const last = merged[merged.length - 1]
    if (last && seg.start <= last.end) {
      last.end = Math.max(last.end, seg.end)
      last.rewritten = last.rewritten + '\n' + seg.rewritten
    } else {
      merged.push({ start: seg.start, end: seg.end, rewritten: seg.rewritten })
    }
  }

  let result = originalContent
  for (let i = merged.length - 1; i >= 0; i--) {
    const { start, end, rewritten } = merged[i]
    result = result.substring(0, start) + rewritten + result.substring(end)
  }
  return result
}

/** Assemble a full chapter by replacing scene segments with their rewritten versions */
export function assembleRewrittenChapter(
  originalContent: string,
  positionedSegments: { marker: ContextMarker; start: number; end: number; rewritten: string }[]
): string {
  const valid = positionedSegments
    .filter(s => s.start >= 0 && s.end > s.start && s.rewritten.trim())
    .sort((a, b) => a.start - b.start)

  if (valid.length === 0) return originalContent

  // Merge overlapping segments
  const merged: { start: number; end: number; rewritten: string }[] = []
  for (const seg of valid) {
    const last = merged[merged.length - 1]
    if (last && seg.start <= last.end) {
      last.end = Math.max(last.end, seg.end)
      last.rewritten = last.rewritten + '\n' + seg.rewritten
    } else {
      merged.push({ start: seg.start, end: seg.end, rewritten: seg.rewritten })
    }
  }

  // Assemble from right to left to preserve indices
  let result = originalContent
  for (let i = merged.length - 1; i >= 0; i--) {
    const { start, end, rewritten } = merged[i]
    result = result.substring(0, start) + rewritten + result.substring(end)
  }
  return result
}

// v15.2.0: mergeAdjacentSegments 已删除——全仓零引用死代码（相邻段合并实际由
// assembleRewrittenChapter/FromSimple 的区间重叠合并逻辑承担，见上）
