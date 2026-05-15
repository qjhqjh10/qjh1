import { styleProjectService } from '@/services/fileService'
import { logError } from '@/utils/logger'
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
  const parts = [
    `【写作风格要求 - 优先级高于角色设定】\n${style.profile.fullDescription}`,
    `\n详细特征:\n- 句式: ${f.sentenceStyle}\n- 词汇: ${f.vocabularyStyle}\n- 修辞: ${f.rhetoricStyle}\n- 节奏: ${f.rhythmStyle}\n- 对话: ${f.dialogueStyle}\n- 氛围: ${f.moodStyle}\n- 视角: ${f.perspectiveStyle}\n- 身体: ${f.bodyLanguageStyle}\n- 感官: ${f.sensoryStyle}\n- 张力: ${f.tensionStyle}\n- 暗示: ${f.subtextStyle}`,
  ]

  // If description pattern exists, add structural constraints
  const dp = style.profile?.features?.descriptionPattern
  if (dp && dp.bodyOrder?.length > 0) {
    const s: string[] = [`【描写结构要求 - 必须严格遵守】`]
    s.push(`女性角色首次出场时，按以下顺序扫描描写: ${dp.bodyOrder.join(' → ')}`)
    if (dp.sections?.length > 0) {
      const rules = dp.sections.filter(x => x.part && x.details?.length > 0).map(x => `${x.part}(至少${x.sentenceCount || '1-2句'}: ${x.details.join('、')})`)
      if (rules.length > 0) s.push(`各部位要求: ${rules.join('; ')}`)
    }
    if (dp.detailFingerprints?.length > 0) s.push(`指纹细节: ${dp.detailFingerprints.join('、')}`)
    if (dp.stockingDetail) s.push(`丝袜描写: ${dp.stockingDetail}`)
    if (dp.characterVisualProfile) s.push(`角色视觉配置: ${dp.characterVisualProfile}`)
    parts.push(s.join('\n'))
  }

  // Corruption arc
  const ca = style.profile?.features?.corruptionArc
  if (ca && ca.overallTrajectory) {
    const s: string[] = [`【角色堕落弧线 - 必须遵守的进展阶梯】`]
    s.push(`整体轨迹: ${ca.overallTrajectory}`)
    if (ca.characterStates?.length > 0) {
      ca.characterStates.forEach(cs => {
        s.push(`${cs.characterName}: ${cs.originalState} → ${cs.currentState} (${(cs.progressionSteps || []).join(' → ')})`)
      })
    }
    s.push(`注意：角色状态必须随章节推进沿弧线变化，不能跳跃式堕落`)
    parts.push(s.join('\n'))
  }

  // Degradation ritual
  const dr = style.profile?.features?.degradationRitual
  if (dr && (dr.sceneTemplate?.length > 0 || dr.authorityEntryPattern)) {
    const s: string[] = [`【羞辱场景剧本 - 必须使用此叙事结构】`]
    if (dr.sceneTemplate?.length > 0) s.push(`场景步骤: ${dr.sceneTemplate.join(' → ')}`)
    if (dr.authorityEntryPattern) s.push(`权威入场: ${dr.authorityEntryPattern}`)
    if (dr.punishmentTools?.length > 0) s.push(`惩罚工具: ${dr.punishmentTools.join('、')}`)
    if (dr.audienceInvolvement) s.push(`观众介入: ${dr.audienceInvolvement}`)
    if (dr.surrenderConfirmation) s.push(`屈服确认句式: ${dr.surrenderConfirmation}`)
    parts.push(s.join('\n'))
  }

  // Narrative voice
  const nv = style.profile?.features?.narrativeVoice
  if (nv && (nv.toneContrast || nv.internalMonologueRatio)) {
    const s: string[] = [`【叙事声音要求 - 决定整体阅读感受】`]
    if (nv.toneContrast) s.push(`语态反差: ${nv.toneContrast}`)
    if (nv.internalMonologueRatio) s.push(`内心独白: ${nv.internalMonologueRatio}`)
    if (nv.worldBuildingStyle) s.push(`世界设定交代方式: ${nv.worldBuildingStyle}`)
    if (nv.routineCatalog) s.push(`日常编目: ${nv.routineCatalog}`)
    if (nv.powerResignation) s.push(`面对压迫/无力时的心理模式: ${nv.powerResignation}`)
    parts.push(s.join('\n'))
  }

  // Scene mechanics
  const sm = style.profile?.features?.sceneMechanics
  if (sm && (sm.sensoryCounterpoint || sm.symbolicTool)) {
    const s: string[] = [`【场景装置要求】`]
    if (sm.sensoryCounterpoint) s.push(`感官对位: ${sm.sensoryCounterpoint}`)
    if (sm.symbolicTool) s.push(`象征工具: ${sm.symbolicTool}`)
    if (sm.recurringVisualFormula) s.push(`视觉定型模板: ${sm.recurringVisualFormula}`)
    parts.push(s.join('\n'))
  }

  // Identity dissolution (merged into corruptionArc or standalone)
  const idis = style.profile?.features?.identityDissolution
  if (idis && (idis.replacementIdentity || idis.correctionFrame || idis.hierarchyStructure)) {
    const s: string[] = [`【身份系统与等级层级】`]
    if (idis.preExistingIdentity) s.push(`旧身份: ${idis.preExistingIdentity}`)
    if (idis.replacementIdentity) s.push(`新身份: ${idis.replacementIdentity}`)
    if (idis.selfGaslightingPattern) s.push(`自我合理化: ${idis.selfGaslightingPattern}`)
    if (idis.competitiveAbasement) s.push(`竞相自贬: ${idis.competitiveAbasement}`)
    if (idis.correctionFrame) s.push(`管教框架: ${idis.correctionFrame}`)
    if (idis.hierarchyStructure) s.push(`等级层级: ${idis.hierarchyStructure}`)
    parts.push(s.join('\n'))
  }

  // Shame-voyeur loop
  const svl = style.profile?.features?.shameVoyeurLoop
  if (svl && svl.triggerPattern) {
    const s: string[] = [`【羞耻-窥视心理循环 - 情感引擎】`]
    if (svl.triggerPattern) s.push(`触发: ${svl.triggerPattern}`)
    if (svl.excitementResponse) s.push(`兴奋: ${svl.excitementResponse}`)
    if (svl.shameLayer) s.push(`羞耻: ${svl.shameLayer}`)
    if (svl.feedbackAmplification) s.push(`闭环: ${svl.feedbackAmplification}`)
    parts.push(s.join('\n'))
  }

  return parts.join('\n')
}

// Get style injection text for a target project
export async function getStyleInjection(targetProjectId: string, styleAssignments: Record<string, string>): Promise<string | null> {
  const styleId = styleAssignments[targetProjectId]
  if (!styleId) {
    logError('风格注入跳过: 当前项目未绑定风格档案', { targetProjectId })
    return null
  }
  const style = await getStyleForProject(styleId)
  if (!style) {
    logError('风格注入跳过: 风格档案加载失败或未完成AI总结', { styleId })
    return null
  }
  return buildStylePrompt(style)
}
