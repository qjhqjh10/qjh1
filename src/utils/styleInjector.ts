import { styleProjectService } from '@/services/fileService'
import type { StyleProject } from '@/types/story'

// Cache loaded style projects to avoid repeated IPC calls
const styleCache = new Map<string, StyleProject>()

export async function getStyleForProject(styleProjectId: string): Promise<StyleProject | null> {
  if (!styleProjectId) return null
  if (styleCache.has(styleProjectId)) return styleCache.get(styleProjectId)!
  try {
    const proj = await styleProjectService.loadProject(styleProjectId) as StyleProject
    if (proj?.profile) {
      styleCache.set(styleProjectId, proj)
      return proj
    }
  } catch { /* not found */ }
  return null
}

export function clearStyleCache() {
  styleCache.clear()
}

// Build the style system prompt addition
export function buildStylePrompt(style: StyleProject): string {
  if (!style.profile) return ''
  const f = style.profile.features
  return `【写作风格要求 - 优先级高于角色设定】\n${style.profile.fullDescription}\n\n详细特征:\n- 句式: ${f.sentenceStyle}\n- 词汇: ${f.vocabularyStyle}\n- 修辞: ${f.rhetoricStyle}\n- 节奏: ${f.rhythmStyle}\n- 对话: ${f.dialogueStyle}\n- 氛围: ${f.moodStyle}`
}

// Get style injection text for a target project
export async function getStyleInjection(targetProjectId: string, styleAssignments: Record<string, string>): Promise<string | null> {
  const styleId = styleAssignments[targetProjectId]
  if (!styleId) return null
  const style = await getStyleForProject(styleId)
  if (!style) return null
  return buildStylePrompt(style)
}
