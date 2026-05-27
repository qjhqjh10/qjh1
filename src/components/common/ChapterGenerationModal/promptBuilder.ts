import { kbService } from '@/services/fileService'
import { buildStylePrompt, convertTemplateToProfile } from '@/utils/styleInjector'
import { ROLE_LABELS } from '@/components/common/eroticSceneConstants'
import { logError } from '@/utils/logger'
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
    parts.push(a('mainPose') ? '【主戏：AI根据上下文自主决定】' : `【主戏】姿势: ${ec.mainPose || ''} | 节奏: ${ec.mainRhythm || ''} | 转换: ${ec.poseChanges || ''}`)
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
    parts.push(a('soundDensity') ? '【声音：AI根据上下文自主决定】' : `【声音】密度: ${ec.soundDensity || ''} | 呻吟: ${ec.moanStyle || ''}`)
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
    parts.push(a('wordTarget') ? '【篇幅：AI根据上下文自主决定】' : `【篇幅】${nc.wordTarget}字 | ${nc.narrativePOV || ''}`)
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

export async function injectKBContents(prompt: string, selectedKbFileIds: Set<string>): Promise<string> {
  if (selectedKbFileIds.size === 0) return prompt
  const kpParts: string[] = []
  let totalChars = 0
  const maxKBChars = 50000
  for (const fid of selectedKbFileIds) {
    if (totalChars >= maxKBChars) break
    try {
      const result = await kbService.read(fid) as { file: { originalName: string }; content: string }
      const sliceLen = Math.min(result.content.length, 10000, maxKBChars - totalChars)
      kpParts.push(`【文件: ${result.file.originalName}】\n${result.content.slice(0, sliceLen)}`)
      totalChars += sliceLen
    } catch (e) { logError('读取知识库文件内容失败', e) }
  }
  return prompt + '\n' + kpParts.join('\n\n')
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
  chapterPrompt: { title: string; content: string } | undefined
  wordTarget: number
  replaceMode: boolean
}

export function buildPrompt(opts: BuildPromptOptions): string {
  const { outlineTabs, detailedOutlineFields, outlineContent, worldbuildingContent,
    selectedCharacterIds, characters, currentChapter, loadedDims,
    selectedSummaryIds, prevChapters, chapterSummaryMap,
    selectedKbFileIds, selectedScene, selectedStyleTemplateId,
    selectedStyleTemplate, styleStrength, chapterPrompt, wordTarget, replaceMode } = opts

  const parts: string[] = []

  if (outlineTabs.plot && outlineContent) {
    parts.push(`【故事剧情】\n${outlineContent.slice(0, 15000)}\n`)
  }
  if (outlineTabs.worldbuilding && worldbuildingContent) {
    parts.push(`【世界观设定】\n${worldbuildingContent.slice(0, 30000)}\n`)
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
        return fields.join('，')
      })
      parts.push(`【本章出场角色】\n${charDescs.join('\n\n')}\n`)
      parts.push('请根据以上角色的性格特点，写出符合各自设定的对白、行为和心理活动。')
    }
    if (notInChapter.length > 0) {
      parts.push(`【本章未出场角色 — 其本人不会出现在本章场景中，但可以被出场角色提及名字、回忆事迹、夸赞、辱骂、讨论其影响、揣测其意图等】\n${notInChapter.map(c => c.name).join('、')}`)
    }
  }

  if (loadedDims) {
    if (loadedDims.items) parts.push(loadedDims.items)
    if (loadedDims.locations) parts.push(loadedDims.locations)
    if (loadedDims.factions) parts.push(loadedDims.factions)
    if (loadedDims.powerSystem) parts.push(loadedDims.powerSystem)
    if (loadedDims.emotion) parts.push(loadedDims.emotion)
    if (loadedDims.foreshadowing) parts.push(loadedDims.foreshadowing)
    if (loadedDims.plotThreads) parts.push(loadedDims.plotThreads)
  }

  if (detailedOutlineFields.plotOverview && currentChapter?.plotOverview) {
    parts.push(`【本章剧情概述】\n${currentChapter.plotOverview}\n`)
  }
  if (detailedOutlineFields.chapterCharacters && currentChapter?.characters) {
    parts.push(`【本章出场角色列表】\n${currentChapter.characters}\n`)
  }
  if (detailedOutlineFields.location && currentChapter?.location) {
    parts.push(`【场景地点】\n${currentChapter.location}\n`)
  }
  if (detailedOutlineFields.keyEvents && currentChapter?.keyEvents) {
    parts.push(`【关键事件】\n${currentChapter.keyEvents}\n`)
  }
  if (detailedOutlineFields.eroticContent && currentChapter?.eroticContent) {
    parts.push(`【情色剧情要求】\n${currentChapter.eroticContent}\n`)
  }

  if (selectedSummaryIds.size > 0) {
    const summaries = prevChapters.filter(c => selectedSummaryIds.has(c.id)).map(c => `第${c.order + 1}章 ${c.title}: ${chapterSummaryMap[c.id] || '无摘要'}`)
    parts.push(`【前文章节摘要】\n${summaries.join('\n')}\n`)
  }
  if (selectedKbFileIds.size > 0) {
    parts.push(`【知识库参考】\n以下知识库内容可供参考：\n`)
  }

  if (selectedScene) {
    const scenePrompt = buildScenePrompt(selectedScene)
    parts.push('【场景模板注入】\n' + scenePrompt)
  }

  if (selectedStyleTemplateId && selectedStyleTemplate) {
    try {
      const stylePrompt = buildStylePrompt(convertTemplateToProfile(selectedStyleTemplate))
      if (stylePrompt) {
        const strengthHeader = styleStrength === 'light' ? '' :
          styleStrength === 'strong'
            ? '【⚠️ 以下风格要求必须严格执行，优先级高于所有其他设定。违反任何一条都视为生成失败。】\n'
            : '【以下风格要求必须遵守，优先级高于其他设定。】\n'
        parts.unshift('---\n' + strengthHeader + stylePrompt + '\n---')

        if (styleStrength === 'strong' || styleStrength === 'normal') {
          const dims = selectedStyleTemplate.dimensions || {}
          const recapLines: string[] = []
          recapLines.push('【风格约束复述 — 输出前请逐条确认】')
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
          recapLines.push(`• 输出前再次确认: 以上风格约束是否全部满足？`)
          parts.push(recapLines.join('\n'))
        }
      }
    } catch { /* skip */ }
  }

  const template = chapterPrompt?.content || '根据以上设定和细纲，写出一章完整的小说正文。正文用空行分隔自然段，禁止全文一堆到底。'
  parts.push(`【创作要求】\n${template}\n\n字数目标: ${wordTarget}字\n输出模式: ${replaceMode ? '替换当前正文' : '追加到正文末尾'}\n\n重要格式要求:\n- 每个自然段之间必须用空行分隔（即两个换行），不得所有文字连成一片\n- 对话密集处适当分段，同一角色的连续对白可合为一段，角色切换或场景转换必须另起一段\n- 段落不宜过长，一般3-8行为宜，避免超过15行的超大段落`)

  return parts.join('\n\n---\n\n')
}
