// @ts-nocheck — TODO: 15+ callback params need explicit types, incremental typing needed
import { useEffect, useState, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useStore, useSettingsStore } from '@/store'
import { extractionService, aiService, fileService, styleProjectService, exportService, dialogService } from '@/services/fileService'
import { loadCharacters, saveCharacter } from '@/services/characterService'
import { saveDetailedChapter } from '@/services/chapterService'
import { saveOutlineContent, saveWorldbuildingContent } from '@/services/outlineService'
import {
  aggregateExtractions, parseExtractionReply, splitChapters,
  buildExtractionPrompt, parseExtractionReplyWithErotic, buildEroticExtractionPrompt,
  computePacingTemplate, chaptersToStyleChapters,
  buildGenerateCharactersPrompt, buildGenerateWorldbuildingPrompt,
  buildStyleAnalyzePrompt, parseStyleAnalysisReply,
  buildStyleAnalyzePromptV3, parseStyleAnalysisReplyV3,
  computeEventPattern, computeProgressionRhythm,
  computeCharacterArchetype, computeEmotionCurve,
} from '@/services/extractionService'
import { nanoid } from 'nanoid'
import GlassCard from '@/components/common/GlassCard'
import Button from '@/components/common/Button'
import ScrollArea from '@/components/common/ScrollArea'
import Modal from '@/components/common/Modal'
import ChapterGenerationModal from '@/components/common/ChapterGenerationModal'
import ReviewModal from '@/components/common/ReviewModal'
import ReviewResultsModal from '@/components/common/ReviewResultsModal'
import { logError } from '@/utils/logger'
import { NOVEL_TYPE_DIMS } from '@/types/story'
import type { NovelExtraction, DetailGenResult, ChapterExtraction, StyleChapter } from '@/types/story'

interface RawCharacterInput {
  name?: string; role?: string; traits?: string[] | string; personality?: string
  background?: string; appearance?: string; arc?: string; abilities?: string
  importance?: number; relationships?: { target: string; type: string }[] | string
}
import type { Character } from '@/types/character'
import { EMPTY_CHARACTER } from '@/types/character'
import type { VersionRecord } from '@/components/common/ChapterGenerationModal'
import { buildStylePrompt, getTemplateInjection } from '@/utils/styleInjector'
import { styleTemplateService } from '@/services/fileService'
import type { StyleTemplate } from '@/types/styleTemplate'
import {
  SparklesIcon, TrashIcon, PlayIcon, StopIcon, FolderOpenIcon,
  ArrowLeftIcon, BookOpenIcon, DocumentArrowDownIcon,
} from '@heroicons/react/24/outline'
import type { ViewMode, NovelType, Step, PreviewTab, DimKey } from '../types'
import { TABS, STATUS_LABELS, STATUS_COLORS, TYPE_LABELS, TYPE_DIM_PRESETS, DIM_LABELS, normalizeRole, NOVEL_TYPE_CARDS } from '../constants'
import TimelineTab from '../tabs/TimelineTab'
import ChapterTab from '../tabs/ChapterTab'
import DetailsTab from '../tabs/DetailsTab'
import OutlineTab from '../tabs/OutlineTab'
import GenerateTab from '../tabs/GenerateTab'
import WriteTab from '../tabs/WriteTab'
import ExtractionProgressDialog from '../dialogs/ExtractionProgressDialog'
import DimensionSelectionDialog from '../dialogs/DimensionSelectionDialog'
import StyleDimensionDialog from '../dialogs/StyleDimensionDialog'
import ImportCharactersModal from '../dialogs/ImportCharactersModal'

export function useImitationHandlers(d: any) {
  const { setExtraction, setSelectedChapterId, setStep, setProgress, setExtracting,
    setStyleLoading, setStyleProgress, setStylePaused,
    setGenLoading, setGenType, setGenPreview, setOutlineGenerated, setOutlineResults,
    setDetailGenRunning, setDetailGenCurrent, setDetailGenResults, setDetailsResults,
    setImportChars, setExistingChars, setCharActions, setShowImportModal, setShowDetailModal, setEditingDetail,
    setLoading, setNovelType, setChapterContents, setExtractIds,
    novelType, extraction, extractIds, extractDims, styleChapterIds, styleDims,
    outlineResults, detailGenResults, detailsResults, chapterContents,
    selectedChapterId,
    abortRef, pausedRef, styleAbortRef, stylePausedRef, detailGenAbortRef,
    activeConfigId, activeProjectId, projectsBasePath,
    setCharacters, setOutlineContent, setWorldbuildingContent, setActiveProject,
    navigate } = d;




  const saveExtraction = async (data: NovelExtraction) => {
    if (!activeProjectId || !projectsBasePath) return
    const pp = `${projectsBasePath}/${activeProjectId}`
    await fileService.ensureDir(pp)
    await fileService.write(`${pp}/extraction.json`, JSON.stringify(data, null, 2))
  }


  // Inject imitation data into Zustand store when write tab selected (for modals)

  const loadProjects = async () => {
    if (!activeProjectId || !projectsBasePath) return
    const pp = `${projectsBasePath}/${activeProjectId}`
    try {
      const raw = await fileService.read(`${pp}/extraction.json`)
      if (raw) {
        const ext = JSON.parse(raw) as NovelExtraction
        setExtraction(ext); setSelectedChapterId(ext.chapters[0]?.chapterId || null)
        setNovelType((ext.novelType as NovelType) || 'general')
        const saved = ext.outlineResults || {}
        setOutlineResults(saved)
        const gen: Record<string, boolean> = {}
        Object.keys(saved).forEach(k => { gen[k] = true })
        setOutlineGenerated(gen)
        if (ext.detailsResults) setDetailsResults(ext.detailsResults)
        if (ext.detailGenResults) setDetailGenResults(ext.detailGenResults)
        if (ext.chapterContents) setChapterContents(ext.chapterContents)
        if (ext.status === 'completed') setStep('completed')
        else if (ext.styleProfile) setStep('generating')
        else if (ext.aggregated) setStep('extracting')
        else if (ext.chapters.some(ch => ch.extractedAt)) setStep('extracting')
        else setStep('import')
      }
    } catch { /* no extraction yet */ }
  }

  const handleSelectType = (type: NovelType) => {
    setNovelType(type)
  }

  const handleImport = async () => {
    setLoading(true)
    try {
      const result = await extractionService.importFile() as { name: string; content: string } | null
      if (!result) { setLoading(false); return }
      const chapters = splitChapters(result.content)
      const ext: NovelExtraction = {
        id: `imt_${nanoid(8)}`, novelName: result.name.replace(/\.txt$/i, ''),
        sourceFileName: result.name, novelType,
        chapters: [], aggregated: null, plotStructure: null,
        styleProfile: null, pacingTemplate: null, eventPattern: null, progressionRhythm: null, characterArchetype: null, emotionCurve: null, generatedNovel: null, outlineResults: {},
        status: 'draft', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }
      ext.chapters = chapters.map((ch, i) => ({
        chapterId: `ch_${i + 1}`, chapterNumber: ch.chapterNumber,
        chapterTitle: ch.title, chapterContent: ch.content, chapterType: (ch.chapterType || 'chapter') as StyleChapter['chapterType'],
        characters: [], worldbuilding: [], items: [], powerSystem: [],
        chapterSummary: '', events: [], foreshadowing: [], emotionalTone: '', extractedAt: '',
      }))
      await saveExtraction(ext)
      await loadProjects()
      setExtraction(ext); setSelectedChapterId(ext.chapters[0]?.chapterId || null)
      setExtractIds(new Set()); setStep('import')
    } catch (err) { logError('导入失败', err); alert('导入失败') }
    setLoading(false)
  }

  // Project managed by HomePage/Sidebar - data loaded via loadProjects()

  const toggleExtractId = (id: string) => {
    setExtractIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  const selectedChapter = extraction?.chapters.find(c => c.chapterId === selectedChapterId)
  const extractedCount = extraction?.chapters.filter(c => c.extractedAt).length || 0
  const ag = extraction?.aggregated || null
function safeItemName(i: unknown): string {
  if (typeof i === 'string') return i
  if (i && typeof i === 'object') return (i as Record<string, unknown>).name as string || (i as Record<string, unknown>).title as string || String(i)
  return String(i)
}


  // ---- Extract ----
  const handleStartExtract = async () => {
    if (!extraction || !activeConfigId) return
    const chs = extraction.chapters.filter(c => extractIds.has(c.chapterId))
    if (chs.length === 0) { alert('请先选择章节'); return }
    abortRef.current = false; pausedRef.current = false; setExtracting(true); setStep('extracting')
    const chapters = [...extraction.chapters]
    for (let i = 0; i < chs.length; i++) {
      if (abortRef.current) { setProgress({ current: i, total: chs.length, text: '已停止' }); setExtracting(false); return }
      while (pausedRef.current) { await new Promise(r => setTimeout(r, 200)) }
      const ch = chs[i]
      if (ch.extractedAt) { continue } // Skip already-extracted chapters
      setProgress({ current: i + 1, total: chs.length, text: ch.chapterTitle })
      try {
        const dims = [...extractDims]
        const prompt = novelType === 'erotic' && dims.includes('erotic')
          ? buildEroticExtractionPrompt(ch.chapterTitle, ch.chapterContent, dims)
          : buildExtractionPrompt(ch.chapterTitle, ch.chapterContent, dims.filter(d => d !== 'erotic'))
        const reply = await aiService.chat([{ role: 'user' as const, content: prompt }], activeConfigId)
        const chType = ch.chapterType || 'chapter'
        const parsed = novelType === 'erotic'
          ? parseExtractionReplyWithErotic(reply, ch.chapterId, ch.chapterNumber, ch.chapterTitle, ch.chapterContent, chType)
          : parseExtractionReply(reply, ch.chapterId, ch.chapterNumber, ch.chapterTitle, ch.chapterContent, chType)
        const idx = chapters.findIndex(c => c.chapterId === ch.chapterId)
        if (idx !== -1) chapters[idx] = parsed
        const updated = { ...extraction, chapters, updatedAt: new Date().toISOString(), status: 'extracting' as const }
        setExtraction(updated); await saveExtraction(updated)
      } catch (err) { logError(`提取失败 第${ch.chapterNumber}章`, err) }
    }
    if (!abortRef.current) {
      setProgress({ current: chs.length, total: chs.length, text: '聚合中...' })
      // Auto-aggregate
      const extracted = chapters.filter(c => c.extractedAt)
      if (extracted.length > 0) {
        const aggregated = aggregateExtractions(extracted)
        const pacing = computePacingTemplate(extracted)
        const eventPattern = computeEventPattern(extracted)
        const progressionRhythm = computeProgressionRhythm(extracted, aggregated.powerSystem)
        const characterArchetype = computeCharacterArchetype(aggregated.characters)
        const emotionCurve = computeEmotionCurve(extracted)
        const updated = { ...extraction, chapters, aggregated, pacingTemplate: pacing, eventPattern, progressionRhythm, characterArchetype, emotionCurve, status: 'aggregated' as const, updatedAt: new Date().toISOString() }
        setExtraction(updated)
        await saveExtraction(updated)
      }
      setProgress({ current: chs.length, total: chs.length, text: '完成' })
      setStep('extracting'); setExtracting(false)
    }
    setExtracting(false)
  }

  // ---- Style ----
  const handleStyleAnalyze = async () => {
    if (!extraction || !activeConfigId) return
    const selChs = extraction.chapters.filter(c => styleChapterIds.has(c.chapterId) && c.extractedAt)
    // If no chapters selected, auto-select first 20 extracted chapters
    const chs = selChs.length > 0 ? selChs : extraction.chapters.filter(c => c.extractedAt).slice(0, 20)
    if (chs.length === 0) { alert('请先提取章节内容'); return }
    setStyleLoading(true); setStylePaused(false); styleAbortRef.current = false; stylePausedRef.current = false
    const dims = [...styleDims]
    const chapterAnalyses: { chapterNum: number; analysis: import('@/types/story').ChapterAnalysis }[] = []
    for (let i = 0; i < chs.length; i++) {
      if (styleAbortRef.current) { setStyleProgress(`已停止(${i}/${chs.length})`); setStyleLoading(false); return }
      while (stylePausedRef.current) { await new Promise(r => setTimeout(r, 200)) }
      setStyleProgress(`风格: ${i + 1}/${chs.length}`)
      try {
        const reply = await aiService.chat([{ role: 'user' as const, content: `${buildStyleAnalyzePromptV3(dims)}\n\n[${chs[i].chapterTitle}]\n${chs[i].chapterContent.slice(0, 15000)}` }], activeConfigId)
        const a = parseStyleAnalysisReplyV3(reply, dims)
        chapterAnalyses.push({ chapterNum: chs[i].chapterNumber, analysis: a })
      } catch (err) { logError(`风格分析失败 第${chs[i].chapterNumber}章`, err) }
    }

    // Build summary text from all chapters' deep analyses
    const summaryParts: string[] = []
    for (const { chapterNum, analysis: a } of chapterAnalyses) {
      let summary = `第${chapterNum}章:\n`
      if (a.dimAnalyses) {
        for (const [dk, da] of Object.entries(a.dimAnalyses)) {
          if (da.description) summary += `  [${dk}] ${da.description.slice(0, 120)}\n`
        }
      } else {
        summary += `  ${a.sentenceStyle}; ${a.rhythmStyle}; ${a.dialogueStyle}\n`
      }
      summaryParts.push(summary)
    }

    // Aggregate into full StyleProfile with dimAnalyses
    let profile: Record<string, unknown> | null = null
    try {
      const summaryPrompt = `总结以下多章风格分析为一段完整的StyleProfile JSON。

各章分析摘要:
${summaryParts.join('\n')}

输出JSON:
{
  "fullDescription": "用一段200-400字的话总结整体风格，必须包含具体的词汇特征和句式特征",
  "features": { "sentenceStyle": "...", "vocabularyStyle": "...", ... }
}`

      const summaryReply = await aiService.chat([{ role: 'user' as const, content: summaryPrompt }], activeConfigId)
      const m = summaryReply.match(/\{[\s\S]*\}/)
      if (m) {
        profile = JSON.parse(m[0])
        // Aggregate dimAnalyses from all chapters
        const aggregatedDimAnalyses: Record<string, import('@/types/story').DimAnalysis> = {}
        for (const { analysis: a } of chapterAnalyses) {
          if (a.dimAnalyses) {
            for (const [dk, da] of Object.entries(a.dimAnalyses)) {
              const existing = aggregatedDimAnalyses[dk]
              if (!existing) {
                aggregatedDimAnalyses[dk] = { ...da }
              } else {
                // Merge: deduplicate examples and vocabulary
                const mergedExamples = [...existing.examples]
                for (const ex of da.examples || []) {
                  if (!mergedExamples.includes(ex)) mergedExamples.push(ex)
                }
                const mergedVocab = [...existing.vocabularyList]
                for (const v of da.vocabularyList || []) {
                  if (!mergedVocab.includes(v)) mergedVocab.push(v)
                }
                aggregatedDimAnalyses[dk] = {
                  description: existing.description || da.description,
                  examples: mergedExamples.slice(0, 20),
                  writingRules: [...new Set([...(existing.writingRules || []), ...(da.writingRules || [])])],
                  vocabularyList: mergedVocab.slice(0, 50),
                }
              }
            }
          }
        }
        if (Object.keys(aggregatedDimAnalyses).length > 0) {
          (profile as { dimAnalyses?: Record<string, import('@/types/story').DimAnalysis> }).dimAnalyses = aggregatedDimAnalyses
        }
      }
    } catch { profile = { fullDescription: summaryParts.join('; '), features: {} } }
    const updated = { ...extraction, styleProfile: profile as import('@/types/story').StyleProfile | null, pacingTemplate: computePacingTemplate(extraction.chapters.filter(c => c.extractedAt)), updatedAt: new Date().toISOString() }
    setExtraction(updated); await saveExtraction(updated)
    setStyleProgress('完成'); setStyleLoading(false); setStylePaused(false); setStep('generating')
  }

  // ---- Outline Dim Generation ----
  const handleGenerateDim = async (dimKey: string) => {
    if (!extraction || !activeConfigId || !ag) return
    setGenLoading(true); setGenType(dimKey); setGenPreview('')
    let result = ''
    try {
      let prompt = ''
      switch (dimKey) {
        case 'characters':
          prompt = buildGenerateCharactersPrompt(extraction)
          break
        case 'worldbuilding':
          prompt = buildGenerateWorldbuildingPrompt(extraction)
          break
        case 'items':
          prompt = `以下是原作的道具目录，请生成一套全新的道具目录（保持相同数量和类型分布，名称和能力完全原创）:\n${ag.items.map(i => `${i.name}(${i.type}${i.grade ? '/' + i.grade : ''}): ${i.ability}`).join('\n')}\n\n输出JSON数组(每个道具必须有完整的name/type/ability字段): [{"name":"","type":"法宝|丹药|功法|武器|道具|其他","grade":"等级(无则'')","ability":"详细能力和效果描述","owner":"持有者"}]`
          break
        case 'powerSystem':
          prompt = `以下是原作的等级体系，请生成一套全新的等级体系（保持相同级数和晋升节奏，名称完全原创）:\n${ag.powerSystem.levels.join(' → ')} (共${ag.powerSystem.levels.length}级)\n${ag.powerSystem.description}\n\n输出JSON: {"name":"","levels":[],"description":""}`
          break
        case 'foreshadowing':
          prompt = `以下是原作的伏笔清单，请生成一套全新的伏笔结构（保持相似数量和分布）:\n${ag.foreshadowing.map(f => `${f.description} [第${f.plantChapter}章埋 ${f.payoffChapter ? '第' + f.payoffChapter + '章回收' : '未回收'}]`).join('\n')}\n\n输出JSON数组(每个伏笔含描述/埋设章节/回收章节/状态): [{"description":"伏笔描述","plantChapter":1,"payoffChapter":0,"status":"planted|resolved"}]`
          break
        case 'emotionCurve':
          prompt = extraction.emotionCurve ? `以下是原作的情绪分布，请生成一套全新的情绪模板:\n${extraction.emotionCurve.segments.map(s => `第${s.chapterStart}-${s.chapterEnd}章: ${s.dominantEmotion}`).join('\n')}\n周期: 约${extraction.emotionCurve.cycleLength}章\n\n输出JSON数组: [{"chapterStart":1,"chapterEnd":10,"dominantEmotion":"压抑"}]` : '生成全新的情绪分布模板'
          break
        case 'erotic':
          const erChs = extraction.chapters.filter(c => c.erotic)
          const erNames = [...new Set(erChs.flatMap(c => c.erotic?.characterRoles?.map(cr => cr.name) || []))]
          const allChars = ag.characters.map(c => c.name).filter(n => !erNames.includes(n)).slice(0, 2)
          const allRoles = [...erNames, ...allChars]
          prompt = `以下是原作的角色列表，请生成一套全新的情色设定。每个角色都要有完整的情色属性。

原作角色(${allRoles.length}个): ${allRoles.join('、')}

原作情色章节数: ${erChs.length}章

必须输出JSON(每个字段必填，不要省略):
{
  "characterRoles": [${allRoles.map(() => `{"name":"新角色名","domSub":"dom|sub|switch","bodyState":"正常|发情|改造|退行","kinks":["性癖"],"shameLevel":"高|中|低"}`).join(',\n    ')}],
  "sceneFlow": [{"phase":"前戏","actions":["动作"],"bodyReactions":["反应"],"duration":"短|中|长"},{"phase":"主戏","actions":["动作"],"bodyReactions":["反应"],"duration":"短|中|长"},{"phase":"高潮","actions":["动作"],"bodyReactions":["反应"],"duration":"短|中|长"},{"phase":"收尾","actions":["动作"],"bodyReactions":["反应"],"duration":"短|中|长"}],
  "techniques": {"bodyFluids":["体液"],"touchFocus":["部位"],"soundStyle":"密集","moanDensity":"密集"},
  "powerDynamics": "权力关系描述",
  "degradationPatterns": ["模式1","模式2"]
}
要求: characterRoles数量必须等于${allRoles.length}，每个角色的名字、属性都必须是全新的。`
        // Inject style profile erotic dimensions
        if (extraction.styleProfile?.features) {
          const sf = extraction.styleProfile.features
          if (sf.corruptionArc?.overallTrajectory) prompt += `\n【原作堕落弧线-新设定需继承此模式】\n${sf.corruptionArc.overallTrajectory}`
          if ((sf.degradationRitual?.sceneTemplate?.length ?? 0) > 0) prompt += `\n【原作仪式剧本结构-新设定需继承】\n${sf.degradationRitual!.sceneTemplate!.join(' → ')}`
          if (sf.narrativeVoice?.toneContrast) prompt += `\n【原作叙事声音-新设定需继承】\n极淫内容用极平淡语气写: ${sf.narrativeVoice.toneContrast}`
          if (sf.shameVoyeurLoop?.triggerPattern) prompt += `\n【原作心理循环模式-新设定需继承】\n触发:${sf.shameVoyeurLoop.triggerPattern} → 兴奋→羞耻→反馈放大`
        }
        // Inject eroticStats for cross-chapter context
        if (ag?.eroticStats) {
          const es = ag.eroticStats
          prompt += `\n【原作情色数据统计-供参考】\n情色章节占比: ${es.eroticChapterCount}/${es.totalChapters}\n主要情色角色: ${es.mainEroticChars.join(', ')}\n常见性癖: ${es.commonKinks.join(', ')}\n常用体液: ${es.commonFluids.join(', ')}\n触感焦点: ${es.commonTouchFocus.join(', ')}\n羞辱模式: ${es.degradationPatterns.join(', ')}`
        }
          break
      }
      const reply = await aiService.chat([{ role: 'user' as const, content: prompt }], activeConfigId)
      if (['characters', 'foreshadowing', 'emotionCurve'].includes(dimKey)) {
        try { const m = reply.match(/\[[\s\S]*\]/); result = m ? JSON.stringify(JSON.parse(m[0]), null, 2) : reply } catch { result = reply }
      } else {
        try { const m = reply.match(/\{[\s\S]*\}/); result = m ? JSON.stringify(JSON.parse(m[0]), null, 2) : reply } catch { result = reply.replace(/^#+ .*\n?/gm, '').trim() }
      }
      setGenPreview(result)
    } catch (err) { logError('生成失败', err); result = '' }
    setGenLoading(false)
    if (result) {
      setOutlineGenerated(prev => ({ ...prev, [dimKey]: true }))
      setOutlineResults(prev => {
        const updated = { ...prev, [dimKey]: result }
        if (extraction) {
          saveExtraction({ ...extraction, outlineResults: updated, updatedAt: new Date().toISOString() })
        }
        return updated
      })
      setGenPreview(''); setGenType(null)
      setToast(`${DIM_LABELS[dimKey] || dimKey}模仿完成`)
      setTimeout(() => setToast(''), 5000)
    }
  }

  const handleGenerateDetailsImitation = async () => {
    if (!extraction || !ag || !activeConfigId) return
    const charResult = outlineResults['characters']
    if (!charResult) { alert('请先生成角色模仿'); return }
    const chs = extraction.chapters.filter(c => extractIds.has(c.chapterId) && c.extractedAt)
    if (chs.length === 0) { alert('请先在左侧选择要生成细纲的章节'); return }
    setDetailGenRunning(true); setDetailGenCurrent(0)
    detailGenAbortRef.current = false
    const results: DetailGenResult[] = [...detailGenResults.filter(d => extractIds.has(extraction.chapters.find(c => c.chapterNumber === d.chapterNumber)?.chapterId || ''))]
    const or = outlineResults

    for (let i = 0; i < chs.length; i++) {
      if (detailGenAbortRef.current) { setDetailGenRunning(false); return }
      const ch = chs[i]
      // Skip if already generated
      if (results.find(d => d.chapterNumber === ch.chapterNumber)) continue
      setDetailGenCurrent(i + 1)

      // Build per-chapter prompt
      const parts: string[] = ['你是小说创作专家。为新小说第' + ch.chapterNumber + '章生成细纲。']
      parts.push(`\n## 新大纲设定\n角色:\n${charResult}`)
      if (or.powerSystem) parts.push(`等级:\n${or.powerSystem}`)
      if (or.items) parts.push(`道具:\n${or.items}`)
      if (or.worldbuilding) parts.push(`世界观:\n${or.worldbuilding}`)
      if (or.foreshadowing) parts.push(`伏笔:\n${or.foreshadowing}`)
      // Original chapter reference
      parts.push(`\n## 原作第${ch.chapterNumber}章参考\n摘要: ${ch.chapterSummary}`)
      if (ch.characters.length > 0) parts.push(`出场角色: ${ch.characters.map(c => c.name).join(', ')}`)
      if (ch.events.length > 0) parts.push(`事件: ${ch.events.join(' · ')}`)
      parts.push(`情绪: ${ch.emotionalTone || '无'}`)
      if (ch.powerSystem.length > 0) parts.push(`等级提及: ${ch.powerSystem.map(p => p.term).join(', ')}`)
      if (ch.items.length > 0) parts.push(`道具提及: ${ch.items.map(it => it.name).join(', ')}`)
      // Erotic reference
      if (ch.erotic) {
        if (ch.erotic.powerDynamics) parts.push(`原作情色权力关系: ${ch.erotic.powerDynamics}`)
        if (ch.erotic.characterRoles?.length > 0) parts.push(
            `原作情色角色: ${ch.erotic.characterRoles.map(cr =>
              `${cr.name}(定位:${cr.domSub}/状态:${cr.bodyState}/性癖:${cr.kinks?.join(',')||'无'}/羞耻:${cr.shameLevel})`
            ).join('; ')}`
          )
        if (ch.erotic.sceneFlow?.length > 0) parts.push(
          `原作情色流程: ${ch.erotic.sceneFlow.map(sf =>
            `${sf.phase}(${sf.actions?.join('、')||'无'} → 反应:${sf.bodyReactions?.join('、')||'无'}, ${sf.duration})`
          ).join(' | ')}`
        )
        if (ch.erotic.techniques) {
          const t = ch.erotic.techniques
          parts.push(`原作技法参数: 体液[${t.bodyFluids?.join(',')||'无'}] 触感焦点[${t.touchFocus?.join(',')||'无'}] 声音密度[${t.soundStyle||'密集'}] 呻吟密度[${t.moanDensity||'密集'}]`)
        }
        if (ch.erotic.degradationPatterns?.length > 0) parts.push(`原作羞辱模式: ${ch.erotic.degradationPatterns.join('、')}`)
      }

      parts.push(`\n要求: 为新书第${ch.chapterNumber}章生成细纲JSON:\n{"chapterNumber":${ch.chapterNumber},"title":"","summary":"150-300字","charactersAppearing":["角色(身份)"],"levelChange":"","itemsUsed":[],"location":"","foreshadowingOps":[],"keyEvents":[],"emotionalTone":"","eroticScene":"详细情色剧情设计(200-400字)，包含: ①参与角色及其身体状态/dom-sub定位 ②性爱流程(前戏→渐进→主戏→高潮→收尾)每阶段具体动作与身体反应 ③权力关系在性爱中的展现 ④关键对话与心理活动 ⑤体液/触感/声音密度。如原作本章无情色内容则填''"}\n角色从新列表中选, 道具/等级/世界观使用新设定中的名称, 剧情原创。${ch.erotic ? '原作本章有情色内容，请为新书对应章设计完整的情色场景(eroticScene字段)，参考原作的情色角色/流程/技法参数，使用新角色的情色属性。' : ''}只输出JSON。`)

      try {
        const reply = await aiService.chat([{ role: 'user' as const, content: parts.join('\n') }], activeConfigId)
        const m = reply.match(/\{[\s\S]*\}/)
        if (m) {
          const parsed = JSON.parse(m[0])
          parsed.chapterNumber = ch.chapterNumber // ensure correct chapter number
          results.push(parsed)
          setDetailGenResults([...results])
        }
      } catch (err) { logError(`细纲生成失败 第${ch.chapterNumber}章`, err) }
    }
    setDetailGenRunning(false)
    const json = JSON.stringify(results, null, 2)
    setDetailsResults(json)
    // Persist to extraction
    if (extraction) {
      saveExtraction({ ...extraction, detailsResults: json, detailGenResults: results, updatedAt: new Date().toISOString() })
    }
    setToast(`细纲模仿完成: ${results.length}章`)
    setTimeout(() => setToast(''), 5000)
  }

  const handleSendToStyleWorkshop = async () => {
    if (!extraction) return
    const updated = { ...extraction, pacingTemplate: computePacingTemplate(extraction.chapters.filter(c => c.extractedAt)), updatedAt: new Date().toISOString() }
    setExtraction(updated); saveExtraction(updated)
    const styleId = `sp_${extraction.id.replace('imt_', '')}`
    await styleProjectService.saveProject({
      id: styleId, name: extraction.novelName + '_风格', sourceFileName: extraction.sourceFileName,
      chapters: chaptersToStyleChapters(extraction.chapters), profile: null, createdAt: new Date().toISOString(),
      totalCharCount: extraction.chapters.reduce((s, c) => s + c.chapterContent.length, 0),
      enabledDimensions: ['sentenceStyle', 'vocabularyStyle', 'rhetoricStyle', 'rhythmStyle', 'dialogueStyle', 'moodStyle', 'perspectiveStyle', 'bodyLanguageStyle', 'sensoryStyle', 'tensionStyle'],
      novelType: '通用',
    })
    navigate('/style-workshop')
  }


  const handleUpdateDetail = (updated: DetailGenResult) => {
    const idx = detailGenResults.findIndex(d => d.chapterNumber === updated.chapterNumber)
    if (idx >= 0) {
      const newResults = [...detailGenResults]
      newResults[idx] = updated
      setDetailGenResults(newResults)
      const json = JSON.stringify(newResults, null, 2)
      setDetailsResults(json)
      if (extraction) saveExtraction({ ...extraction, detailsResults: json, detailGenResults: newResults, updatedAt: new Date().toISOString() })
      setToast('细纲已保存')
      setTimeout(() => setToast(''), 3000)
    }
    setShowDetailModal(false)
    setEditingDetail(null)
  }

  // ---- Import to project ----

  const handleImportToProject = async () => {
    if (!ag || !activeProjectId || !projectsBasePath || !extraction) return
    const pp = `${projectsBasePath}/${activeProjectId}`
    const or = outlineResults

    // Parse characters to import
    let chars: RawCharacterInput[] = []
    if (or.characters) {
      try {
        const parsed = JSON.parse(or.characters)
        if (Array.isArray(parsed)) chars = parsed
      } catch (err) { logError('角色数据解析失败', err) }
    }
    if (chars.length === 0) {
      chars = ag.characters.map(ac => ({
        name: ac.name, role: ac.role, traits: ac.traits,
        appearance: ac.appearance, background: ac.background, arc: ac.arc,
        relationships: ac.relationships,
      }))
    }

    if (chars.length === 0) {
      // No characters to import, proceed directly to worldbuilding/outline/details
      await doImportData(pp, or, [])
      return
    }

    // Load existing characters for conflict detection
    const existing = await loadCharacters(pp)
    setExistingChars(existing)
    setImportChars(chars)

    // Determine action for each character
    const existingNames = new Set(existing.map(c => c.name))
    const actions: Record<string, 'new' | 'skip' | 'overwrite' | 'merge'> = {}
    chars.forEach((c, i) => {
      if (!c.name) { actions[i] = 'skip'; return }
      actions[i] = existingNames.has(c.name) ? 'skip' : 'new'
    })
    setCharActions(actions)
    setShowImportModal(true)
  }

  const resolveImportChars = () => {
    const result: { action: 'new' | 'skip' | 'overwrite' | 'merge'; char: RawCharacterInput; existing?: Character }[] = []
    importChars.forEach((c, i) => {
      const action = charActions[i] || 'skip'
      if (action === 'skip') return
      const existing = action !== 'new' ? existingChars.find(ec => ec.name === c.name) : undefined
      result.push({ action, char: c, existing })
    })
    return result
  }

  const doImportData = async (pp: string, or: Record<string, string>, resolvedChars: { action: string; char: RawCharacterInput; existing?: Character }[]) => {
    const imported: string[] = []

    // 1. Import characters with full field mapping
    let charCount = 0
    for (const { action, char: c, existing } of resolvedChars) {
      if (action === 'skip' || !c.name) continue
      const traitsStr = Array.isArray(c.traits) ? c.traits.join('、') : (c.traits || c.personality || '')
      const relsText = c.relationships ? (
        Array.isArray(c.relationships) ? c.relationships.map(r => `${r.target}:${r.type}`).join('; ') : String(c.relationships)
      ) : ''
      const charData: Character = {
        ...EMPTY_CHARACTER,
        id: action === 'overwrite' ? (existing?.id || nanoid(8)) : (action === 'merge' ? (existing?.id || nanoid(8)) : nanoid(8)),
        name: c.name,
        role: (['男主','女主','男配','女配','反派','其他'].includes(c.role || '') ? c.role : normalizeRole(c.role || '')) as Character['role'],
        personality: action === 'merge' ? (traitsStr || existing?.personality || '') : traitsStr,
        background: action === 'merge' ? (c.background || existing?.background || '') : (c.background || ''),
        appearance: action === 'merge' ? (c.appearance || existing?.appearance || '') : (c.appearance || ''),
        arc: action === 'merge' ? (c.arc || existing?.arc || '') : (c.arc || ''),
        abilities: c.abilities || '',
        relationships: action === 'merge' ? (relsText || existing?.relationships || '') : relsText,
        importance: c.importance || 50,
      }
      try {
        await saveCharacter(pp, charData)
        charCount++
      } catch (err) { logError(`导入角色失败: ${c.name}`, err) }
    }
    if (charCount > 0) imported.push(`${charCount}个角色`)
    setCharacters(await loadCharacters(pp))

    // 2. Worldbuilding → worldbuilding.json
    const wb = or.worldbuilding || ''
    const items = or.items || ''
    const power = or.powerSystem || ''
    const erotic = or.erotic || ''
    let wbContent = wb
    if (!wbContent && ag) {
      if (ag.worldbuilding.locations.length > 0) wbContent += '## 地点\n\n' + ag.worldbuilding.locations.map(l => `- ${l.name}: ${l.description}`).join('\n') + '\n\n'
      if (ag.worldbuilding.factions.length > 0) wbContent += '## 势力\n\n' + ag.worldbuilding.factions.map(f => `- ${f.name}: ${f.description}`).join('\n') + '\n\n'
      if (ag.worldbuilding.rules.length > 0) wbContent += '## 规则\n\n' + ag.worldbuilding.rules.map(r => `- ${r.name}: ${r.description}`).join('\n') + '\n\n'
      if (ag.worldbuilding.history) wbContent += '## 历史\n\n' + ag.worldbuilding.history + '\n\n'
    }
    if (power) wbContent += '\n## 等级体系\n\n' + power + '\n'
    else if (ag?.powerSystem.levels.length) { wbContent += '\n## 等级体系\n\n' + ag.powerSystem.levels.join(' → ') + '\n' }
    if (items) wbContent += '\n## 道具目录\n\n' + items + '\n'
    else if (ag?.items.length) { wbContent += '\n## 道具目录\n\n' + ag.items.map(i => `- ${i.name}(${i.type}): ${i.ability}`).join('\n') + '\n' }
    if (erotic) wbContent += '\n## 情色设定\n\n' + erotic + '\n'
    if (wbContent) { await saveWorldbuildingContent(pp, wbContent); setWorldbuildingContent(wbContent); imported.push('世界观') }

    // 3. Outline → outline/plot.json (from all dimension results as a combined view)
    const outlineParts: string[] = []
    if (or.characters) outlineParts.push('## 角色\n\n' + or.characters)
    if (or.worldbuilding) outlineParts.push('## 世界观\n\n' + or.worldbuilding)
    if (or.items) outlineParts.push('## 道具\n\n' + or.items)
    if (or.powerSystem) outlineParts.push('## 等级体系\n\n' + or.powerSystem)
    if (or.foreshadowing) outlineParts.push('## 伏笔结构\n\n' + or.foreshadowing)
    if (or.emotionCurve) outlineParts.push('## 情绪模板\n\n' + or.emotionCurve)
    if (outlineParts.length > 0) {
      const outline = `# 生成的小说设定\n\n${outlineParts.join('\n\n')}`
      await saveOutlineContent(pp, outline)
      setOutlineContent(outline)
      imported.push('大纲')
    }

    // 4. Detailed outlines → detailed_outline/*.json
    if (detailsResults) {
      try {
        const details = JSON.parse(detailsResults)
        if (Array.isArray(details) && details.length > 0) {
          await fileService.ensureDir(`${pp}/detailed_outline`)
          for (const d of details) {
            if (!d.chapterNumber) continue
            const desc = [
              d.summary || '',
              d.charactersAppearing?.length > 0 ? '出场角色: ' + d.charactersAppearing.join(', ') : '',
              d.keyEvents?.length > 0 ? '关键事件: ' + d.keyEvents.join(' · ') : '',
              d.levelChange ? '等级变化: ' + d.levelChange : '',
              d.itemsUsed?.length > 0 ? '道具: ' + d.itemsUsed.join(', ') : '',
              d.location ? '场景: ' + d.location : '',
              d.emotionalTone ? '情绪: ' + d.emotionalTone : '',
              d.foreshadowingOps?.length > 0 ? '伏笔: ' + d.foreshadowingOps.join(', ') : '',
              d.eroticScene ? '情色场景: ' + d.eroticScene : '',
            ].filter(Boolean).join('\n')
            await saveDetailedChapter(pp, { id: String(d.chapterNumber), title: d.title || `第${d.chapterNumber}章`, description: desc, summary: d.summary || '', order: d.chapterNumber - 1, status: 'incomplete' })
          }
          imported.push(`${details.length}章细纲`)
        }
      } catch (err) { logError('细纲数据解析失败', err) }
    }

    // 5. Foreshadowing → outline_meta.json
    const fs = or.foreshadowing
    if (fs || (ag?.foreshadowing.length ?? 0) > 0) {
      const metaPath = `${pp}/outline/outline_meta.json`
      let existingMeta: { foreshadowing: { id: string; description: string; plantChapterId: string; payoffChapterId: string; status: string }[]; plotThreads: unknown[]; updatedAt: string } = { foreshadowing: [], plotThreads: [], updatedAt: '' }
      try { const raw = await fileService.read(metaPath); if (raw) existingMeta = JSON.parse(raw) } catch { /* */ }
      if (fs) {
        try {
          const fsArr = JSON.parse(fs)
          if (Array.isArray(fsArr)) {
            existingMeta.foreshadowing = [...(existingMeta.foreshadowing || []), ...fsArr.map((f: Record<string, unknown>) => ({ id: `fs_${nanoid(6)}`, description: (f.description as string) || String(f), plantChapterId: String(f.plantChapter || 1), payoffChapterId: f.payoffChapter ? String(f.payoffChapter) : '', status: (f.status as string) || 'planted' }))]
          }
        } catch { /* raw text */ }
      }
      if (!fs && (ag?.foreshadowing.length ?? 0) > 0) {
        existingMeta.foreshadowing = [...(existingMeta.foreshadowing || []), ...ag!.foreshadowing.map(f => ({ id: `fs_${nanoid(6)}`, description: f.description, plantChapterId: String(f.plantChapter), payoffChapterId: f.payoffChapter ? String(f.payoffChapter) : '', status: f.status }))]
      }
      existingMeta.updatedAt = new Date().toISOString()
      await fileService.ensureDir(`${pp}/outline`); await fileService.write(metaPath, JSON.stringify(existingMeta, null, 2))
      imported.push(`${existingMeta.foreshadowing.length}条伏笔`)
    }

    alert(`导入完成!\n${imported.join('\n')}`)
    const assignments = useSettingsStore.getState().aiSettings.styleAssignments || {}
    if (activeProjectId && !assignments[activeProjectId]) { const go = confirm('未绑定风格档案，前往风格工坊？'); if (go) navigate('/style-workshop') }

    // Navigate to the real project's chapter writing
    setToast('导入完成！跳转到项目...')
    const fakeChaps = detailGenResults.map(d => ({
      id: String(d.chapterNumber),
      title: d.title || `第${d.chapterNumber}章`,
      description: d.summary || '',
      summary: d.summary || '',
      order: d.chapterNumber - 1,
      status: 'incomplete' as const,
    }))
    useStore.getState().setDetailedChapters(fakeChaps)
    setTimeout(() => navigate('/chapter/' + String(detailGenResults[0]?.chapterNumber || '1')), 300)
  }

  // Wrapper: resolve chars from modal and call doImportData
  const handleConfirmImport = async () => {
    if (!ag || !activeProjectId || !projectsBasePath || !extraction) return
    const pp = `${projectsBasePath}/${activeProjectId}`
    const or = outlineResults
    const resolved = resolveImportChars()
    setShowImportModal(false)
    await doImportData(pp, or, resolved)
    // Continue with worldbuilding/outline/details...
  }

  return { saveExtraction, loadProjects, handleSelectType, handleImport,
    toggleExtractId, handleStartExtract, handleStyleAnalyze, handleGenerateDim,
    handleGenerateDetailsImitation, handleSendToStyleWorkshop, handleUpdateDetail,
    handleImportToProject, handleConfirmImport };
}
