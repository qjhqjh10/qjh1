import { convertTemplateToProfile, buildSceneAwareStylePrompt, classifySceneType } from '@/utils/styleInjector'
import { ROLE_LABELS } from '@/components/common/eroticSceneConstants'
import { logError } from '@/utils/logger'
import { injectKnowledge, injectKnowledgeFallback } from '@/services/knowledgePipeline'
import type { SceneTemplate, EroticSceneConfig, NovelSceneConfig } from '@/types/story'
import type { OutlineTabToggles, DetailedOutlineToggles } from '@/types/settings'
import type { DetailedChapter } from '@/types/chapter'
import type { Character } from '@/types/character'

export function buildScenePrompt(tpl: SceneTemplate): string {
  const auto = (tpl.config.autoFields || {}) as Record<string, boolean>
  const a = (field: string) => !!auto[field]
  const autoLabel = (field: string, label: string) => a(field) ? `【${label}：AI根据上下文自主决定】` : null

  if (tpl.type === '情色小说') {
    const ec = tpl.config as EroticSceneConfig
    const parts: string[] = []
    if (a('characters')) parts.push('【角色状态：AI根据上下文自主决定】')
    else {
      const charLines: string[] = []
      if (ec.characters?.length > 0) charLines.push(ec.characters.map(c => `${c.characterName}: ${ROLE_LABELS[c.role] || c.role}, ${c.bodyState}${c.customNote ? ', ' + c.customNote : ''}`).join('\n'))
      if (ec.customCharacters?.length > 0) charLines.push(ec.customCharacters.map(c => `${c.name}: ${c.role}, ${c.bodyState}${c.note ? ', ' + c.note : ''}`).join('\n'))
      if (charLines.length > 0) parts.push('【角色状态】\n' + charLines.join('\n'))
    }
    const sceneLine = autoLabel('location', '场景') || `【场景】${ec.location || ''} | ${ec.time || ''} | ${ec.atmosphere || ''} | ${ec.publicity || ''} — 必须在此场景展开`
    parts.push(sceneLine)
    if (a('selectedKinks')) parts.push('【玩法：AI根据上下文自主决定】')
    else if (ec.selectedKinks?.length > 0) {
      let kinkLine = `【玩法】${ec.selectedKinks.join('、')}${ec.kinkNote ? ' | ' + ec.kinkNote : ''}`
      const intensities = ec.kinkIntensities || {}
      const intensityParts = Object.entries(intensities).filter(([, v]) => v && v !== '标准').map(([k, v]) => `${k}:${v}`)
      if (intensityParts.length > 0) kinkLine += ` | 强度: ${intensityParts.join('、')}`
      parts.push(kinkLine)
    }
    if (a('opening')) parts.push('【起始：AI根据上下文自主决定】')
    else if (ec.opening?.length > 0) parts.push(`【起始】${ec.opening.join('、')}`)
    const mainParts = [ec.mainPose && `姿势: ${ec.mainPose}`, ec.mainRhythm && `节奏: ${ec.mainRhythm}`, ec.poseChanges && `转换: ${ec.poseChanges}`].filter(Boolean)
    if (mainParts.length > 0) parts.push(`【主戏】${mainParts.join(' | ')}`)
    else if (a('mainPose')) parts.push('【主戏：AI根据上下文自主决定】')
    if (a('climax')) parts.push('【高潮：AI根据上下文自主决定】')
    else if (ec.climax?.length > 0) parts.push(`【高潮】${ec.climax.join('、')}`)
    if (a('aftermath')) parts.push('【余韵：AI根据上下文自主决定】')
    else if (ec.aftermath?.length > 0) parts.push(`【余韵】${ec.aftermath.join('、')}`)
    if (!a('extraPhases') && ec.extraPhases?.length > 0) parts.push(`【自定义阶段】${ec.extraPhases.map(p => `${p.name}: ${p.desc}`).join(' | ')}`)
    if (!a('bodyFluidFocus') && ec.bodyFluidFocus?.length) parts.push(`【体液】${ec.bodyFluidFocus.join('、')}`)
    if (!a('bodyPartFocus') && ec.bodyPartFocus?.length) parts.push(`【身体焦点】${ec.bodyPartFocus.join('、')}`)
    if (!a('tactileFocus') && ec.tactileFocus?.length) parts.push(`【触感焦点】${ec.tactileFocus.join('、')}`)
    if (!a('sensoryAnchors') && ec.sensoryAnchors) parts.push(`【感官锚点】${ec.sensoryAnchors}`)
    if (!a('bodyLanguage') && ec.bodyLanguage) parts.push(`【非言语表达】${ec.bodyLanguage}`)
    if (!a('degradeLangs') && ec.degradeLangs?.length) {
      let degradeLine = `【侮辱词】${ec.degradeLangs.join('、')}`
      if (ec.customDegradeLangs?.length) degradeLine += ' | 自定义:' + ec.customDegradeLangs.join(',')
      if (ec.customInsults) degradeLine += ' | 补充:' + ec.customInsults
      parts.push(degradeLine)
    }
    if (!a('bannedWords') && ec.bannedWords) parts.push(`【禁用词】${ec.bannedWords}`)
    const soundParts = [ec.soundDensity && `密度: ${ec.soundDensity}`, ec.moanStyle && `呻吟: ${ec.moanStyle}`].filter(Boolean)
    if (soundParts.length > 0) parts.push(`【声音】${soundParts.join(' | ')}`)
    else if (a('soundDensity')) parts.push('【声音：AI根据上下文自主决定】')
    if (a('dominantEmotion')) parts.push('【情绪：AI根据上下文自主决定】')
    else if (ec.dominantEmotion) parts.push(`【情绪】${ec.dominantEmotion}${ec.emotionCurveInput ? ' | 曲线: ' + ec.emotionCurveInput : ''}${ec.triggerWords ? ' | 触发: ' + ec.triggerWords : ''}`)
    if (a('narrativeStyle')) parts.push('【叙事：AI根据上下文自主决定】')
    else if (ec.narrativeStyle) parts.push(`【叙事】${ec.narrativeStyle} | 时间: ${ec.timeCompression || ''} | 内省: ${ec.introspection || ''}`)
    if (!a('worldRules') && (ec.worldRules || ec.propList || ec.costumeList)) parts.push(`【特殊设定】${[ec.worldRules, ec.propList, ec.costumeList].filter(Boolean).join(' | ')}`)
    parts.push(a('intensity') ? '【强度：AI根据上下文自主决定】' : `【强度】${ec.intensity}/5 | ${ec.narrativePOV || ''}`)
    if (a('pacing')) parts.push('【节奏：AI根据上下文自主决定】')
    else if (ec.pacing) parts.push(`【节奏】${ec.pacing}`)
    if (a('consentDynamic')) parts.push('【同意动态：AI根据上下文自主决定】')
    else if (ec.consentDynamic) parts.push(`【同意动态】${ec.consentDynamic}`)
    if (a('aftercareDetail')) parts.push('【事后关怀：AI根据上下文自主决定】')
    else if (ec.aftercareDetail) parts.push(`【事后关怀】${ec.aftercareDetail}`)
    if (!a('extraNote') && ec.extraNote) parts.push('【额外要求】' + ec.extraNote)
    if (!a('plotOverview') && (ec as any).plotOverview) parts.push(`【剧情概述】${(ec as any).plotOverview}`)
    if (!a('sceneTurningPoint') && (ec as any).sceneTurningPoint) parts.push(`【转折点】${(ec as any).sceneTurningPoint}`)
    if (!a('props') && (ec as any).props) parts.push(`【道具】${(ec as any).props}`)
    if (!a('appearance') && (ec as any).appearance) parts.push(`【外观】${(ec as any).appearance}`)
    return parts.join('\n')
  } else {
    const nc = tpl.config as NovelSceneConfig
    const parts: string[] = []
    parts.push(a('sceneType') ? '【场景类型：AI根据上下文自主决定】' : `【场景类型】${nc.sceneType} | ${(nc.scenePurpose || []).join('、')} | ${nc.conflictType}`)
    if (a('povCharacterId')) parts.push('【主视角：AI根据上下文自主决定】')
    else if (nc.povCharacterName) parts.push(`【主视角】${nc.povCharacterName}`)
    if (a('characters')) parts.push('【角色情绪：AI根据上下文自主决定】')
    else if (nc.characters?.length > 0) parts.push('【角色情绪】\n' + nc.characters.map(c => `${c.characterName}: ${c.emotion || ''}`).join('\n'))
    parts.push(a('location') ? '【环境：AI根据上下文自主决定】' : `【环境】${nc.location} / ${nc.weather || ''} / ${nc.time || ''} / ${nc.atmosphere || ''} / 感官: ${(nc.senses || []).join('、')}`)
    if (a('genreElements')) parts.push('【类型要素：AI根据上下文自主决定】')
    else if (nc.genreElements?.length) parts.push(`【类型要素】${nc.genreElements.join('、')}`)
    parts.push(a('dialogueRatio') ? '【对话：AI根据上下文自主决定】' : `【对话】${nc.dialogueRatio || ''} | 潜台词: ${nc.subtextLevel || ''} | ${nc.sentenceStyle || ''} | 段落: ${nc.paragraphDensity || ''}`)
    parts.push(a('wordTarget') ? '【篇幅：AI根据上下文自主决定】' : `【场景篇幅参考】约${nc.wordTarget}字（此场景内容约占本章总字数的参考比例，非独立字数要求） | ${nc.narrativePOV || ''}`)
    if (a('emotionStart')) parts.push('【情绪：AI根据上下文自主决定】')
    else if (nc.emotionStart) parts.push(`【情绪】${nc.emotionStart}→${nc.emotionEnd || ''}`)
    if (a('narrativeStyle')) parts.push('【叙事技法：AI根据上下文自主决定】')
    else if (nc.narrativeStyle) parts.push(`【叙事技法】${nc.narrativeStyle} | 时间: ${nc.timeCompression || ''} | 内省: ${nc.introspection || ''}`)
    if (a('dominantEmotion')) parts.push('【情绪设计：AI根据上下文自主决定】')
    else if (nc.dominantEmotion || nc.pacing) parts.push(`【情绪设计】${nc.dominantEmotion || ''} | 节奏: ${nc.pacing || ''}${nc.emotionCurveInput ? ' | 曲线: ' + nc.emotionCurveInput : ''}`)
    if (a('sensoryAnchors')) parts.push('【感官细节：AI根据上下文自主决定】')
    else if (nc.sensoryAnchors || nc.props || nc.appearance || nc.bodyLanguage) parts.push(`【感官细节】${[nc.sensoryAnchors && '锚点:' + nc.sensoryAnchors, nc.props && '道具:' + nc.props, nc.appearance && '外观:' + nc.appearance, nc.bodyLanguage && '肢体:' + nc.bodyLanguage].filter(Boolean).join(' | ')}`)
    if (a('foreshadowUse')) parts.push('【伏笔转折：AI根据上下文自主决定】')
    else if (nc.foreshadowUse && nc.foreshadowUse !== '无') parts.push(`【伏笔转折】${nc.foreshadowUse}${nc.sceneTurningPoint ? ' | 转折: ' + nc.sceneTurningPoint : ''}`)
    if (!a('extraNote') && nc.extraNote) parts.push('【额外要求】' + nc.extraNote)
    return parts.join('\n')
  }
}

export function normalizeParagraphs(text: string): string {
  if (!text) return text
  if (/\n{2,}/.test(text)) {
    return text.split(/\n{2,}/).filter(b => b.trim()).map(b => b.trim()).join('\n\n')
  }
  const lines = text.split(/\n/).filter(l => l.trim())
  if (lines.length > 1) {
    const paragraphs: string[] = []
    let current = ''
    for (const line of lines) {
      const t = line.trim()
      if (current && /[。！？…"」\)]$/.test(current)) {
        paragraphs.push(current)
        current = t
      } else {
        current = current ? current + t : t
      }
    }
    if (current) paragraphs.push(current)
    return paragraphs.join('\n\n')
  }
  const singleBlock = lines[0] || text
  if (singleBlock.length < 200) return singleBlock
  const parts = singleBlock.split(/(?<=[。！？…])(?=[^」\)\]）])/g)
  const result: string[] = []
  let chunk = ''
  let sentenceCount = 0
  for (const part of parts) {
    chunk += part
    sentenceCount++
    if (sentenceCount >= 4 && part.trim()) {
      result.push(chunk.trim())
      chunk = ''
      sentenceCount = 0
    }
  }
  if (chunk.trim()) result.push(chunk.trim())
  return result.join('\n\n')
}

/**
 * 向 prompt 注入知识库内容。使用 KnowledgePipeline 语义搜索，
 * 降级到全量转储。注入位置在"创作要求"之前。
 */
export async function injectKBContents(
  prompt: string,
  selectedKbFileIds: Set<string>,
  searchQuery?: string,
  projectId?: string,
  configId?: string,
  maxChunks = 5,
): Promise<string> {
  if (selectedKbFileIds.size === 0) return prompt

  // 检索条数取自知识库设置的「章节生成」场景
  const { useSettingsStore } = await import('@/store')
  const genTopK = Math.min(20, Math.max(1,
    useSettingsStore.getState().aiSettings.kbSettings?.generation?.searchTopK || maxChunks))

  // 优先语义搜索
  if (searchQuery && projectId && configId) {
    const result = await injectKnowledge(
      prompt, searchQuery, projectId, configId,
      [...selectedKbFileIds], genTopK, 'before-writing',
    )
    if (result.chunksInjected > 0) return result.prompt
  }

  // 降级全量注入（参数取自知识库设置的「章节生成」场景）
  const kbSettings = useSettingsStore.getState().aiSettings.kbSettings
  const gen = kbSettings?.generation || { fallbackTotalMaxChars: 10000, fallbackPerFileMaxChars: 5000 }
  const fallback = await injectKnowledgeFallback(
    prompt, [...selectedKbFileIds],
    gen.fallbackTotalMaxChars || 10000,
    gen.fallbackPerFileMaxChars || 5000,
  )
  return fallback.prompt
}

export interface BuildPromptOptions {
  outlineTabs: OutlineTabToggles
  detailedOutlineFields: DetailedOutlineToggles
  outlineContent: string
  worldbuildingContent: string
  selectedCharacterIds: Set<string>
  characters: Character[]
  currentChapter: DetailedChapter | undefined
  loadedDims: { items?: string; locations?: string; factions?: string; powerSystem?: string; emotion?: string; foreshadowing?: string; plotThreads?: string } | undefined
  selectedSummaryIds: Set<string>
  prevChapters: DetailedChapter[]
  chapterSummaryMap: Record<string, string>
  selectedKbFileIds: Set<string>
  selectedScene: SceneTemplate | null | undefined
  selectedStyleTemplateId: string
  selectedStyleTemplate: any
  styleStrength: string
  stylePromptOverride?: string  // v12.12.0: pre-loaded prompt TXT bypasses dynamic generation
  styleRuleTemplate?: any       // v12.12.0: rule template for dynamic generation
  chapterPrompt: { title: string; content: string } | undefined
  wordTarget: number
  replaceMode: boolean
  // 前文注入
  prevTextInjection?: { chapterLabel: string; selectedContent: string }
}

export function buildPrompt(opts: BuildPromptOptions): string {
  const { outlineTabs, detailedOutlineFields, outlineContent, worldbuildingContent,
    selectedCharacterIds, characters, currentChapter, loadedDims,
    selectedSummaryIds, prevChapters, chapterSummaryMap,
    selectedKbFileIds, selectedScene, selectedStyleTemplateId,
    selectedStyleTemplate, styleStrength, chapterPrompt, wordTarget, replaceMode } = opts

  const styleParts: string[] = []   // 第1层: 风格要求（语言层面必须遵循）
  const plotParts: string[] = []    // 第2层: 本章核心剧情（必须覆盖的大方向）
  const sceneParts: string[] = []   // 第3层: 场景描写指导（帮助写好具体场景）
  const refParts: string[] = []     // 第4层: 背景参考（仅供参考，不需要复述）

  // ════════════════════════════════════════════════════════════════
  // 第1层: 风格模板（语言层面必须遵循，最高优先级）
  // ════════════════════════════════════════════════════════════════
  if (selectedStyleTemplateId && selectedStyleTemplate) {
    try {
      // v12.12.0: Use pre-loaded prompt TXT if provided, else dynamic generation
      let stylePrompt: string | null = null
      if (opts.stylePromptOverride) {
        stylePrompt = opts.stylePromptOverride
      } else {
        const sceneCategory = classifySceneType(
          selectedScene?.config,
          (currentChapter as any)?.description || ''
        )
        const styleProfile = convertTemplateToProfile(selectedStyleTemplate)
        // v12.12.0: Pass rule template if provided
        const rt = opts.styleRuleTemplate
        stylePrompt = buildSceneAwareStylePrompt(rt ? { ...styleProfile, _ruleTemplate: rt } : styleProfile, sceneCategory)
      }
      if (stylePrompt) {
        const intensityLabel = styleStrength === 'strong' ? '⚠️ 必须严格执行，违反视为生成失败' :
          styleStrength === 'light' ? '参考以下风格倾向' : '必须遵守，优先级高于其他设定'
        styleParts.push(`━━━ 第1层：语言风格（${intensityLabel}）━━━`)
        styleParts.push(stylePrompt)

        if (styleStrength === 'strong' || styleStrength === 'normal') {
          const dims = selectedStyleTemplate.dimensions || {}
          const recapLines: string[] = []
          recapLines.push('【输出前逐条确认以下风格约束】')
          const recaps: { key: string; label: string }[] = [
            { key: 'dialogueStyle', label: '对话风格' },
            { key: 'narrativeTone', label: '叙事基调' },
            { key: 'sentenceStyle', label: '句式风格' },
            { key: 'bodyLanguageStyle', label: '身体描写' },
            { key: 'moodStyle', label: '情绪氛围' },
            { key: 'rhetoricStyle', label: '修辞手法' },
          ]
          recaps.forEach(r => {
            if (dims[r.key]?.description) {
              recapLines.push(`• ${r.label}: ${(dims[r.key].description || '').slice(0, 100)}`)
            }
          })
          recapLines.push('• 角色对白必须有明显差异（语气词/句式/礼貌度）')
          recapLines.push('• 确认以上全部满足后再输出正文')
          styleParts.push(recapLines.join('\n'))
        }
      }
    } catch { /* skip */ }
  }

  // ════════════════════════════════════════════════════════════════
  // 第2层: 本章核心剧情（必须覆盖的大方向）
  // ════════════════════════════════════════════════════════════════
  plotParts.push('━━━ 第2层：本章核心剧情（必须覆盖的大方向）━━━')

  if (detailedOutlineFields.plotOverview && currentChapter?.plotOverview) {
    plotParts.push(currentChapter.plotOverview)
  }
  if (detailedOutlineFields.keyEvents && currentChapter?.keyEvents) {
    plotParts.push(currentChapter.keyEvents)
  }
  if (detailedOutlineFields.eroticContent && currentChapter?.eroticContent) {
    plotParts.push(currentChapter.eroticContent)
  }
  // Chapter characters belong to the outline layer (they define who must appear)
  if (detailedOutlineFields.chapterCharacters && currentChapter?.characters) {
    plotParts.push(`【出场角色】${currentChapter.characters}`)
  }
  if (detailedOutlineFields.location && currentChapter?.location) {
    plotParts.push(`【场景地点】${currentChapter.location}`)
  }
  // Fallback: no detailed outline → use a brief description from the chapter
  if (plotParts.length === 1) {
    if (currentChapter?.description) {
      plotParts.push(currentChapter.description)
    } else {
      plotParts.push('（无细纲，请根据参考材料自由创作）')
    }
  }

  // ════════════════════════════════════════════════════════════════
  // 第3层: 场景模板（帮助描写具体场景，小的方面）
  // ════════════════════════════════════════════════════════════════
  if (selectedScene) {
    const scenePrompt = buildScenePrompt(selectedScene)
    sceneParts.push('━━━ 第3层：场景描写指导（帮助写好具体场景）━━━')
    sceneParts.push(scenePrompt)
  }

  // ════════════════════════════════════════════════════════════════
  // 第4层: 背景参考（仅供参考，不需要复述，不需要在正文中解释）
  // ════════════════════════════════════════════════════════════════
  refParts.push('━━━ 参考材料（仅供参考，不需要复述或解释设定）━━━')

  if (outlineTabs.plot && outlineContent) {
    refParts.push(`【故事剧情】${outlineContent.slice(0, 15000)}`)
  }
  if (outlineTabs.worldbuilding && worldbuildingContent) {
    refParts.push(`【世界观设定】${worldbuildingContent.slice(0, 30000)}`)
  }
  if (outlineTabs.characters && selectedCharacterIds.size > 0) {
    const chapterCharNames: string[] = []
    if (currentChapter?.characters) {
      currentChapter.characters.split('\n').forEach(line => {
        const name = line.trim().split(/（|\(|：|:/)[0]?.trim()
        if (name) chapterCharNames.push(name)
      })
    }
    const selected = characters.filter(c => selectedCharacterIds.has(c.id))
    const inChapter = selected.filter(c => chapterCharNames.some(n => c.name.includes(n) || n.includes(c.name)))
    const notInChapter = selected.filter(c => !inChapter.includes(c))

    if (inChapter.length > 0) {
      const charDescs = inChapter.map(c => {
        const fields = [c.name, c.role, c.gender, c.age, c.occupation, c.personality, c.appearance, c.abilities, c.relationships].filter(Boolean)
        const custom = (c.customBlocks || []).filter(b => b.label.trim() && b.content.trim()).map(b => `${b.label}: ${b.content}`)
        return [...fields, ...custom].join('，')
      })
      refParts.push(`【出场角色设定】\n${charDescs.join('\n')}\n（行为和对白要符合角色性格，但不能直接复述角色设定）`)
    }
    if (notInChapter.length > 0) {
      refParts.push(`【未出场角色（可被提及）】${notInChapter.map(c => c.name).join('、')}`)
    }
  }

  if (loadedDims) {
    if (loadedDims.items) refParts.push(loadedDims.items)
    if (loadedDims.locations) refParts.push(loadedDims.locations)
    if (loadedDims.factions) refParts.push(loadedDims.factions)
    if (loadedDims.powerSystem) refParts.push(loadedDims.powerSystem)
    if (loadedDims.emotion) refParts.push(loadedDims.emotion)
    if (loadedDims.foreshadowing) refParts.push(loadedDims.foreshadowing)
    if (loadedDims.plotThreads) refParts.push(loadedDims.plotThreads)
  }

  if (selectedSummaryIds.size > 0) {
    const summaries = prevChapters.filter(c => selectedSummaryIds.has(c.id)).map(c =>
      `第${c.order + 1}章 ${c.title}: ${chapterSummaryMap[c.id] || '无摘要'}`
    )
    refParts.push(`【前文章节摘要】\n${summaries.join('\n')}`)
  }
  if (selectedKbFileIds.size > 0) {
    refParts.push(`【知识库参考】以下知识库内容可供参考（注入在下方）`)
  }

  // ════════════════════════════════════════════════════════════════
  // 组装: 风格 → 剧情 → 场景 → 参考 → 前文衔接 → 硬约束
  // ════════════════════════════════════════════════════════════════
  const result: string[] = []

  if (styleParts.length > 0) {
    result.push(`═══════════════════════════════════════\n${styleParts.join('\n\n')}\n═══════════════════════════════════════`)
  }

  result.push(`═══════════════════════════════════════\n${plotParts.join('\n\n')}\n═══════════════════════════════════════`)

  if (sceneParts.length > 0) {
    result.push(`${sceneParts.join('\n\n')}`)
  }

  result.push(refParts.join('\n\n'))

  // ════════════════════════════════════════════════════════════════
  // 前文衔接注入（独立区域，在参考材料之后、创作要求之前，优先级高于参考材料）
  // ════════════════════════════════════════════════════════════════
  if (opts.prevTextInjection?.selectedContent) {
    const lines = [
      '━━━ 前文衔接 — 以下是前文章节原文，请确保本章开头无缝衔接 ━━━',
      `【${opts.prevTextInjection.chapterLabel}】选中内容：`,
      opts.prevTextInjection.selectedContent,
      `续写要求：
- 本章第1段必须从以上内容自然延续
- 场景/时间/地点不能跳跃
- 人物对话和动作不能中断
- 情绪基调自然过渡`,
    ]
    result.push(lines.join('\n\n'))
  }

  // ── 硬约束 ──
  const template = chapterPrompt?.content || '根据以上核心剧情和风格要求，写出一章完整的小说正文。'
  const sceneWordTarget = (selectedScene?.config as any)?.wordTarget || 0
  let wordTargetText = `【总字数目标】${wordTarget}字（必须严格遵守）`
  if (sceneWordTarget > 0) {
    if (sceneWordTarget > wordTarget) {
      wordTargetText += `\n场景模板内容约占本章主要篇幅`
    } else {
      wordTargetText += `\n其中场景模板描述的内容约占${sceneWordTarget}字`
    }
  }

  result.push(`【创作要求】\n${template}\n\n${wordTargetText}\n输出模式: ${replaceMode ? '替换当前正文' : '追加到正文末尾'}\n\n重要格式要求:\n- 每个自然段之间用空行分隔（两个换行），不得所有文字连成一片\n- 对话密集处适当分段，角色切换或场景转换必须另起一段\n- 段落不宜过长，一般3-8行为宜，避免超过15行的超大段落`)

  return result.join('\n\n')
}
