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
import { buildStylePrompt } from '@/utils/styleInjector'
import {
  SparklesIcon, TrashIcon, PlayIcon, StopIcon, FolderOpenIcon,
  ArrowLeftIcon, BookOpenIcon, DocumentArrowDownIcon,
} from '@heroicons/react/24/outline'
import type { ViewMode, NovelType, Step, PreviewTab, DimKey } from './types'
import { TABS, STATUS_LABELS, STATUS_COLORS, TYPE_LABELS, TYPE_DIM_PRESETS, DIM_LABELS, normalizeRole, NOVEL_TYPE_CARDS } from './constants'
import TimelineTab from './tabs/TimelineTab'
import ChapterTab from './tabs/ChapterTab'
import DetailsTab from './tabs/DetailsTab'
import OutlineTab from './tabs/OutlineTab'
import GenerateTab from './tabs/GenerateTab'
import WriteTab from './tabs/WriteTab'
import ExtractionProgressDialog from './dialogs/ExtractionProgressDialog'
import DimensionSelectionDialog from './dialogs/DimensionSelectionDialog'
import StyleDimensionDialog from './dialogs/StyleDimensionDialog'
import ImportCharactersModal from './dialogs/ImportCharactersModal'

export default function ImitationPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeConfigId = useSettingsStore(s => s.activeConfigId)
  const activeProjectId = useStore(s => s.activeProjectId)
  const projectsBasePath = useStore(s => s.projectsBasePath)
  const setCharacters = useStore(s => s.setCharacters)
  const setOutlineContent = useStore(s => s.setOutlineContent)
  const setWorldbuildingContent = useStore(s => s.setWorldbuildingContent)

  const [view, setView] = useState<ViewMode>('detail')
  const [novelType, setNovelType] = useState<NovelType>('general')
  const [projects, setProjects] = useState<{ id: string; name: string; chapterCount: number; status: string; createdAt: string; novelType: string }[]>([])
  const [importLoading, setImportLoading] = useState(false)
  const [extraction, setExtraction] = useState<NovelExtraction | null>(null)
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null)
  const [step, setStep] = useState<Step>('import')
  const [progress, setProgress] = useState({ current: 0, total: 0, text: '' })
  const [loading, setLoading] = useState(false)
  const [previewTab, setPreviewTab] = useState<PreviewTab>(() => {
    const tab = searchParams.get('tab')
    return (tab as PreviewTab) || 'chapter'
  })
  const [extractIds, setExtractIds] = useState<Set<string>>(new Set())
  const [styleLoading, setStyleLoading] = useState(false)
  const [styleProgress, setStyleProgress] = useState('')
  const [stylePaused, setStylePaused] = useState(false)
  const [styleChapterIds, setStyleChapterIds] = useState<Set<string>>(new Set())
  const styleAbortRef = useRef(false)
  const stylePausedRef = useRef(false)
  const [genLoading, setGenLoading] = useState(false)
  const [genPreview, setGenPreview] = useState('')
  const [genType, setGenType] = useState<string | null>(null)
  const [outlineGenerated, setOutlineGenerated] = useState<Record<string, boolean>>({})
  const [outlineResults, setOutlineResults] = useState<Record<string, string>>({})
  const [chapterWriteView, setChapterWriteView] = useState<string | null>(null)
  const [chapterContents, setChapterContents] = useState<Record<string, string>>({})
  const [writeContent, setWriteContent] = useState('')
  const [writeLoading, setWriteLoading] = useState(false)
  const [writeGenOverlay, setWriteGenOverlay] = useState(false)
  const [writeGenWordCount, setWriteGenWordCount] = useState(0)
  const writeGenAbortRef = useRef<(() => void) | null>(null)
  const [showWriteAIGen, setShowWriteAIGen] = useState(false)
  const [showWriteReview, setShowWriteReview] = useState(false)
  const [showWriteReviewResults, setShowWriteReviewResults] = useState(false)
  const [showWriteExport, setShowWriteExport] = useState(false)
  const [showWriteVersions, setShowWriteVersions] = useState(false)
  const [writeVersionHistory, setWriteVersionHistory] = useState<VersionRecord[]>([])
  const [detailsResults, setDetailsResults] = useState<string>('')
  const [detailGenResults, setDetailGenResults] = useState<DetailGenResult[]>([])
  const [detailGenRunning, setDetailGenRunning] = useState(false)
  const [detailGenCurrent, setDetailGenCurrent] = useState(0)
  const detailGenAbortRef = useRef(false)
  const [toast, setToast] = useState('')
  const [dimSubTab, setDimSubTab] = useState<DimKey>('characters')
  const [showDimDialog, setShowDimDialog] = useState(false)
  const [extractDims, setExtractDims] = useState<Set<string>>(new Set())
  const [showStyleDimDialog, setShowStyleDimDialog] = useState(false)
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [editingDetail, setEditingDetail] = useState<DetailGenResult | null>(null)
  const [showSrcDetailModal, setShowSrcDetailModal] = useState(false)
  const [viewingSrcDetail, setViewingSrcDetail] = useState<ChapterExtraction | null>(null)
  const [styleDims, setStyleDims] = useState<Set<string>>(new Set())
  const abortRef = useRef(false)
  const [extracting, setExtracting] = useState(false)
  const pausedRef = useRef(false)
  const mountedRef = useRef(false)

  useEffect(() => { loadProjects() }, [activeProjectId, projectsBasePath])

  // Sync previewTab to URL search params (skip mount to avoid overwriting sidebar deep-link)
  useEffect(() => {
    if (!mountedRef.current) { mountedRef.current = true; return }
    const currentTab = searchParams.get('tab')
    if (previewTab !== currentTab && previewTab !== 'chapter') {
      setSearchParams({ tab: previewTab }, { replace: true })
    } else if (previewTab === 'chapter' && currentTab) {
      setSearchParams({}, { replace: true })
    }
  }, [previewTab])

  // Read tab from URL when searchParams change (sidebar deep-link)
  useEffect(() => {
    const tab = searchParams.get('tab')
    if (tab && (tab === 'outline' || tab === 'details') && tab !== previewTab) {
      setPreviewTab(tab as PreviewTab)
    }
  }, [searchParams])
  const saveExtraction = async (data: NovelExtraction) => {
    if (!activeProjectId || !projectsBasePath) return
    const pp = `${projectsBasePath}/${activeProjectId}`
    await fileService.ensureDir(pp)
    await fileService.write(`${pp}/extraction.json`, JSON.stringify(data, null, 2))
  }


  // Inject imitation data into Zustand store when write tab selected (for modals)
  useEffect(() => {
    if (previewTab !== 'write') return
    // Inject characters
    if (outlineResults.characters) {
      try {
        const chars = JSON.parse(outlineResults.characters)
        if (Array.isArray(chars) && chars.length > 0) {
          const mapped: Character[] = chars.map((c: Record<string, unknown>) => ({ ...EMPTY_CHARACTER, id: nanoid(8), name: (c.name as string) || '', role: (['男主','女主','男配','女配','反派','其他'].includes(c.role as string) ? c.role : '其他') as Character['role'], personality: Array.isArray(c.traits) ? (c.traits as string[]).join('、') : ((c.traits as string) || ''), background: (c.background as string) || '', importance: 50 }))
          useStore.getState().setCharacters(mapped)
        }
      } catch (err) { logError('角色数据注入失败', err) }
    }
    // Inject worldbuilding (excludes erotic - that goes to outline for independence)
    const wbParts: string[] = []
    if (outlineResults.worldbuilding) wbParts.push('## 世界观\n' + outlineResults.worldbuilding)
    if (outlineResults.powerSystem) wbParts.push('## 等级体系\n' + outlineResults.powerSystem)
    if (outlineResults.items) wbParts.push('## 道具目录\n' + outlineResults.items)
    if (wbParts.length > 0) useStore.getState().setWorldbuildingContent(wbParts.join('\n\n'))
    // Inject outline (includes erotic - independent from worldbuilding toggle)
    const olParts: string[] = []
    if (outlineResults.erotic) olParts.push('## 情色设定\n' + outlineResults.erotic)
    if (outlineResults.powerSystem) olParts.push('## 等级体系\n' + outlineResults.powerSystem)
    if (outlineResults.foreshadowing) olParts.push('## 伏笔结构\n' + outlineResults.foreshadowing)
    if (outlineResults.emotionCurve) olParts.push('## 情绪模板\n' + outlineResults.emotionCurve)
    if (olParts.length > 0) useStore.getState().setOutlineContent(olParts.join('\n\n'))
    // Inject fake detailed chapters so ChapterGenerationModal can use chapter descriptions
    const results = detailGenResults.length > 0 ? detailGenResults : (() => { try { return detailsResults ? JSON.parse(detailsResults) : [] } catch { return [] } })()
    if (Array.isArray(results) && results.length > 0) {
      const fakeChapters = results.map(d => ({
        id: String(d.chapterNumber),
        title: d.title || `第${d.chapterNumber}章`,
        description: [
          d.summary || '',
          d.charactersAppearing?.length > 0 ? '出场: ' + d.charactersAppearing.join('、') : '',
          d.levelChange ? '等级变化: ' + d.levelChange : '',
          d.itemsUsed?.length > 0 ? '道具: ' + d.itemsUsed.join('、') : '',
          d.location ? '场景: ' + d.location : '',
          d.emotionalTone ? '情绪: ' + d.emotionalTone : '',
          d.eroticScene ? '【情色场景要求 — 必须写出完整情色内容】\n' + d.eroticScene : '',
        ].filter(Boolean).join('\n'),
        summary: [d.summary || '', d.eroticScene ? '【本章含情色场景】' : ''].filter(Boolean).join(' '),
        order: d.chapterNumber - 1,
        status: 'incomplete' as const,
      }))
      useStore.getState().setDetailedChapters(fakeChapters)
    }
    // Auto-inject erotic style dimensions for erotic novels
    if (novelType === 'erotic' && extraction?.styleProfile) {
      const stylePrompt = buildStylePrompt({ profile: extraction.styleProfile })
      if (stylePrompt) {
        const current = useStore.getState().outlineContent
        useStore.getState().setOutlineContent(current ? current + '\n\n---\n\n' + stylePrompt : stylePrompt)
      }
    }
  }, [previewTab, novelType, extraction, outlineResults.characters, outlineResults.worldbuilding, outlineResults.powerSystem, outlineResults.items, outlineResults.erotic, outlineResults.foreshadowing, outlineResults.emotionCurve, detailGenResults, detailsResults])

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
  const [showImportModal, setShowImportModal] = useState(false)
  const [importChars, setImportChars] = useState<RawCharacterInput[]>([])
  const [existingChars, setExistingChars] = useState<Character[]>([])
  const [charActions, setCharActions] = useState<Record<string, 'new' | 'skip' | 'overwrite' | 'merge'>>({})

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

    // 3. Outline → outline.json (from all dimension results as a combined view)
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

  // ---- Views ----

  // Guard: need an imitation project selected
  const project = useStore(s => s.projects.find(p => p.id === activeProjectId))
  const setActiveProject = useStore(s => s.setActiveProject)
  const allProjects = useStore(s => s.projects)
  const imitationProjects = allProjects.filter(p => p.type === 'imitation')

  if (!activeProjectId || !projectsBasePath || project?.type !== 'imitation') {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 32 }}>
        <div style={{ maxWidth: 900, width: '100%', margin: '0 auto' }}>
          <h2 style={{ fontSize: 24, fontWeight: 700, color: '#2d2520', marginBottom: 8 }}>小说仿写</h2>
          <p style={{ fontSize: 14, color: '#9b8e84', marginBottom: 24 }}>
            {imitationProjects.length === 0 ? '还没有仿写项目，请先在首页新建一个仿写类型项目' : '选择一个仿写项目开始工作'}
          </p>
          {imitationProjects.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {imitationProjects.map(p => (
                <div key={p.id} onClick={() => { setActiveProject(p.id, 'imitation') }} style={{
                  padding: '16px 20px', borderRadius: 14, background: '#fff', border: '1px solid rgba(0,0,0,0.06)',
                  cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
                }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#2d2520' }}>{p.name}</div>
                    <div style={{ fontSize: 12, color: '#9b8e84', marginTop: 4 }}>
                      {p.chapterCount}章 · {p.wordCount.toLocaleString()}字 · 仿写
                    </div>
                  </div>
                  <span style={{ fontSize: 11, color: '#7c3aed', fontWeight: 600 }}>进入 →</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ marginTop: 24, textAlign: 'center' }}>
            <Button onClick={() => navigate('/')}>返回首页新建项目</Button>
          </div>
        </div>
      </div>
    )
  }

  // No extraction yet: show type select + import
  if (!extraction) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
        <div style={{ textAlign: 'center', maxWidth: 960 }}>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: '#2d2520', marginBottom: 8 }}>小说仿写</h1>
          <p style={{ fontSize: 14, color: '#9b8e84', marginBottom: 24 }}>选择小说类型 → 导入TXT → AI分析 → 模仿生成新作品</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
            {NOVEL_TYPE_CARDS.map(card => (
              <button key={card.type} onClick={() => handleSelectType(card.type)} style={{
                padding: '20px 16px', borderRadius: 16, border: novelType === card.type ? '2px solid ' + card.color : '2px solid rgba(0,0,0,0.06)',
                background: novelType === card.type ? card.color + '08' : '#fff', cursor: 'pointer',
                textAlign: 'center', transition: 'all 0.15s',
              }} onMouseEnter={e => (e.currentTarget as HTMLElement).style.boxShadow = '0 6px 20px rgba(0,0,0,0.08)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.boxShadow = 'none'}>
                <card.icon style={{ width: 32, height: 32, color: card.color, marginBottom: 8 }} />
                <h3 style={{ fontSize: 14, fontWeight: 700, color: '#2d2520', marginBottom: 4 }}>{card.label}</h3>
                <p style={{ fontSize: 10, color: '#9b8e84', lineHeight: 1.5, margin: 0 }}>{card.desc}</p>
              </button>
            ))}
          </div>
          <p style={{ fontSize: 13, color: '#9b8e84', marginBottom: 16 }}>已选: <strong style={{ color: novelType === 'erotic' ? '#dc2626' : '#7c3aed' }}>{TYPE_LABELS[novelType] || '通用'}</strong> 类型</p>
          <Button onClick={handleImport} disabled={importLoading} icon={<FolderOpenIcon style={{ width: 18, height: 18 }} />} size="sm">
            {importLoading ? '导入中...' : '导入TXT小说'}
          </Button>
        </div>
      </div>
    )
  }

  // View 3: Detail
  if (!extraction) return null

  return (
    <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', top: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 500, padding: '10px 24px', borderRadius: 12, background: '#16a34a', color: '#fff', fontSize: 13, fontWeight: 600, boxShadow: '0 8px 24px rgba(0,0,0,0.2)', pointerEvents: 'none' }}>
          ✓ {toast}
        </div>
      )}
      {/* Header */}
      <div style={{ padding: '12px 20px', borderBottom: '1px solid rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => { setExtraction(null); setStep('import') }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9b8e84', display: 'flex', padding: 4 }}><ArrowLeftIcon style={{ width: 20, height: 20 }} /></button>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: '#2d2520' }}>{extraction.novelName}</h2>
          <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: novelType === 'erotic' ? 'rgba(220,38,38,0.1)' : 'rgba(124,58,237,0.08)', color: novelType === 'erotic' ? '#dc2626' : '#7c3aed', fontWeight: 600 }}>{TYPE_LABELS[novelType] || '通用'}</span>
          <span style={{ fontSize: 11, color: '#9b8e84' }}>{extraction.chapters.length}章</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <Button size="sm" onClick={() => { const preset = TYPE_DIM_PRESETS[novelType] || TYPE_DIM_PRESETS.general; setExtractDims(new Set(preset)); setShowDimDialog(true) }} disabled={!activeConfigId || extractIds.size === 0 || extracting} icon={<PlayIcon style={{ width: 14, height: 14 }} />}>提取({extractIds.size}章)</Button>
          {extractedCount > 0 && !extracting && (
            <Button size="sm" variant="ghost" onClick={() => setExtractIds(new Set(extraction.chapters.filter(c => !c.extractedAt).map(c => c.chapterId)))}>提取剩余</Button>
          )}
          {extracting && (
            <>
              <Button size="sm" variant="ghost" onClick={() => { pausedRef.current = !pausedRef.current }}>{pausedRef.current ? '继续提取' : '暂停提取'}</Button>
              <Button size="sm" variant="danger" onClick={() => { abortRef.current = true; pausedRef.current = false }}>停止提取</Button>
            </>
          )}
          {extractedCount > 0 && !extracting && !extraction.styleProfile && <Button size="sm" variant="secondary" onClick={() => { const preset = NOVEL_TYPE_DIMS[TYPE_LABELS[novelType]] || NOVEL_TYPE_DIMS['通用']; setStyleDims(new Set(preset)); setStyleChapterIds(new Set(extraction.chapters.filter(c => c.extractedAt).slice(0, 20).map(c => c.chapterId))); setShowStyleDimDialog(true) }} disabled={!activeConfigId} icon={<SparklesIcon style={{ width: 14, height: 14 }} />}>{styleLoading ? (stylePaused ? '已暂停' : styleProgress) : '风格分析'}</Button>}
          {styleLoading && <Button size="sm" variant="ghost" onClick={() => { if (stylePaused) { setStylePaused(false); stylePausedRef.current = false } else { setStylePaused(true); stylePausedRef.current = true } }} icon={stylePaused ? <PlayIcon style={{ width: 14, height: 14 }} /> : <StopIcon style={{ width: 14, height: 14 }} />}>{stylePaused ? '继续' : '暂停'}</Button>}
          {styleLoading && <Button size="sm" variant="danger" onClick={() => { styleAbortRef.current = true; setStylePaused(false); stylePausedRef.current = false }} icon={<StopIcon style={{ width: 14, height: 14 }} />}>停止</Button>}
          {extraction.styleProfile && !extraction.generatedNovel && <Button size="sm" variant="secondary" onClick={() => setPreviewTab('generate')} icon={<SparklesIcon style={{ width: 14, height: 14 }} />}>模仿生成</Button>}
          <Button size="sm" variant="ghost" onClick={handleSendToStyleWorkshop} icon={<SparklesIcon style={{ width: 14, height: 14 }} />}>深度风格</Button>
          <Button size="sm" variant="ghost" onClick={() => { if (confirm('确定清除仿写数据？')) { setExtraction(null); setStep('import') } }} icon={<TrashIcon style={{ width: 14, height: 14 }} />}>删除</Button>
        </div>
      </div>

      {/* Toolbar */}
      <div style={{ padding: '8px 20px', borderBottom: '1px solid rgba(0,0,0,0.04)', display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(0,0,0,0.01)', flexWrap: 'wrap', flexShrink: 0 }}>
        <button onClick={() => setExtractIds(new Set(extraction.chapters.map(c => c.chapterId)))} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#7c3aed' }}>全选</button>
        <button onClick={() => setExtractIds(new Set())} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#7c3aed' }}>清空</button>
        <button onClick={() => setExtractIds(new Set(extraction.chapters.slice(0, 50).map(c => c.chapterId)))} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#7c3aed' }}>前50章</button>
        <button onClick={() => setExtractIds(new Set(extraction.chapters.slice(0, 10).map(c => c.chapterId)))} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#7c3aed' }}>前10章</button>
        <span style={{ fontSize: 11, color: '#9b8e84' }}>已选 {extractIds.size}章</span>
      </div>

      {/* Next step guide after extraction */}
      {extractedCount > 0 && !extracting && !extraction.styleProfile && (
        <div style={{ padding: '8px 20px', background: 'rgba(124,58,237,0.04)', borderBottom: '1px solid rgba(124,58,237,0.08)', display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, color: '#7c3aed' }}>
          <SparklesIcon style={{ width: 14, height: 14 }} />
          提取完成 (已自动聚合)。下一步: ①切换到「生成」Tab → ②大纲模仿(生成新设定) → ③细纲模仿(逐章生成) → ④「导入到项目」
        </div>
      )}

      {/* Main body — tabs */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
        {/* Left: Chapter list */}
        <div style={{ width: 280, minWidth: 260, borderRight: '1px solid rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <ScrollArea maxHeight="100%" style={{ flex: 1, padding: 4 }}>
            {extraction.chapters.map(ch => {
              const wc = ch.chapterContent ? Math.round(ch.chapterContent.length / 1000) : 0
              return (
                <div key={ch.chapterId} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 5, padding: '5px 8px', cursor: 'pointer',
                  borderRadius: 8, background: selectedChapterId === ch.chapterId ? 'rgba(124,58,237,0.06)' : 'transparent',
                  color: selectedChapterId === ch.chapterId ? '#7c3aed' : '#2d2520', fontWeight: selectedChapterId === ch.chapterId ? 600 : 400,
                }} onClick={() => setSelectedChapterId(ch.chapterId)}>
                  <input type="checkbox" checked={extractIds.has(ch.chapterId)} onChange={() => toggleExtractId(ch.chapterId)} style={{ width: 13, height: 13, accentColor: '#7c3aed', flexShrink: 0, marginTop: 1 }} onClick={e => e.stopPropagation()} />
                  <span style={{ flex: 1, fontSize: 11, lineHeight: 1.5, wordBreak: 'break-word', whiteSpace: 'normal' }}>第{ch.chapterNumber}章 {ch.chapterTitle.replace(/^第[一二三四五六七八九十百千零\d]+[章卷节回]\s*/, '')}</span>
                  <span style={{ fontSize: 8, color: '#9b8e84', flexShrink: 0, whiteSpace: 'nowrap' }}>{wc}k</span>
                  {!!ch.extractedAt && <span style={{ fontSize: 9, color: '#16a34a', fontWeight: 600, flexShrink: 0 }}>✓</span>}
                </div>
              )
            })}
          </ScrollArea>
        </div>

        {/* Center */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '4px 14px', borderBottom: '1px solid rgba(0,0,0,0.04)', display: 'flex', gap: 2, flexShrink: 0 }}>
            {TABS.map(tab => (
              <button key={tab.key} onClick={() => {
                if (tab.key === 'outline') { navigate('/imitation-outline'); return }
                if (tab.key === 'details') { navigate('/imitation-detailed'); return }
                setPreviewTab(tab.key)
              }} style={{
                padding: '5px 12px', borderRadius: '6px 6px 0 0', border: 'none',
                background: previewTab === tab.key ? 'rgba(124,58,237,0.06)' : 'transparent',
                color: previewTab === tab.key ? '#7c3aed' : '#6b5e54', fontSize: 12, cursor: 'pointer',
                fontWeight: previewTab === tab.key ? 600 : 400, display: 'flex', alignItems: 'center', gap: 4,
              }}><tab.icon style={{ width: 13, height: 13 }} />{tab.label}</button>
            ))}
          </div>
          {/* Dim switcher for 原书大纲 tab (outside scroll area) */}
          {previewTab === 'srcOutline' && (
            <div style={{ display: 'flex', gap: 4, padding: '4px 14px', borderBottom: '1px solid rgba(0,0,0,0.04)', flexWrap: 'wrap', flexShrink: 0 }}>
              {(['characters','worldbuilding','items','powerSystem','foreshadowing','emotionCurve',...(novelType === 'erotic' ? ['erotic' as DimKey] : [])] as DimKey[]).map(dk => (
                <button key={dk} onClick={() => setDimSubTab(dk)} style={{
                  padding: '3px 8px', borderRadius: 6, border: 'none', fontSize: 10, cursor: 'pointer',
                  background: dimSubTab === dk ? 'rgba(124,58,237,0.08)' : 'transparent',
                  color: dimSubTab === dk ? '#7c3aed' : '#6b5e54', fontWeight: dimSubTab === dk ? 600 : 400,
                }}>{DIM_LABELS[dk]}</button>
              ))}
            </div>
          )}
          {previewTab === 'chapter' && (
            <ChapterTab extraction={extraction} selectedChapterId={selectedChapterId} />
          )}

{/* === 原书大纲 & 大纲 Tab === */}
          {(previewTab === 'srcOutline' || previewTab === 'outline') && (
            <ScrollArea maxHeight="100%" style={{ flex: 1 }}>
              <div style={{ padding: 10 }}>
                <OutlineTab
                  extraction={extraction}
                  outlineResults={outlineResults}
                  dimSubTab={dimSubTab}
                  novelType={novelType}
                  isSrc={previewTab === 'srcOutline'}
                />
              </div>
            </ScrollArea>
          )}

{/* === 原书细纲 & 细纲 Tab === */}
          {previewTab === 'srcDetails' && (
            <DetailsTab
              isSrc={true}
              extraction={extraction}
              detailGenResults={detailGenResults}
              detailsResults={detailsResults}
              chapterContents={chapterContents}
              onViewSrcDetail={(ch) => { setViewingSrcDetail(ch); setShowSrcDetailModal(true) }}
              onEditDetail={(d) => { setEditingDetail(d); setShowDetailModal(true) }}
              onWriteChapter={(num) => { setChapterWriteView(num); setWriteContent(chapterContents[num] || ''); setPreviewTab('write') }}
            />
          )}
          {previewTab === 'details' && (
            <DetailsTab
              isSrc={false}
              extraction={extraction}
              detailGenResults={detailGenResults}
              detailsResults={detailsResults}
              chapterContents={chapterContents}
              onViewSrcDetail={(ch) => { setViewingSrcDetail(ch); setShowSrcDetailModal(true) }}
              onEditDetail={(d) => { setEditingDetail(d); setShowDetailModal(true) }}
              onWriteChapter={(num) => { setChapterWriteView(num); setWriteContent(chapterContents[num] || ''); setPreviewTab('write') }}
            />
          )}

          {/* === 时间线 Tab === */}
          {previewTab === 'timeline' && (
            <TimelineTab extraction={extraction} />
          )}

          {/* === 章节创作 Tab === */}
          {previewTab === 'write' && (
            <>
              <WriteTab
                chapterWriteView={chapterWriteView}
                writeContent={writeContent}
                chapterContents={chapterContents}
                detailGenResults={detailGenResults}
                detailsResults={detailsResults}
                extractionId={extraction?.id || ''}
                activeConfigId={activeConfigId || ''}
                writeVersionHistory={writeVersionHistory}
                writeGenOverlay={writeGenOverlay}
                writeGenWordCount={writeGenWordCount}
                writeGenAbortRef={writeGenAbortRef}
                onSetWriteContent={setWriteContent}
                onSetChapterWriteView={(id) => { setWriteContent(chapterContents[id] || ''); setChapterWriteView(id) }}
                onShowAIGen={() => setShowWriteAIGen(true)}
                onShowReview={() => setShowWriteReview(true)}
                onShowReviewResults={() => setShowWriteReviewResults(true)}
                onShowVersions={() => setShowWriteVersions(true)}
                onShowExport={() => setShowWriteExport(true)}
                onSave={() => {
                  if (!chapterWriteView) return
                  const updated = { ...chapterContents, [chapterWriteView]: writeContent }
                  setChapterContents(updated)
                  if (extraction) saveExtraction({ ...extraction, chapterContents: updated, updatedAt: new Date().toISOString() })
                  setToast('已保存')
                  setTimeout(() => setToast(''), 3000)
                }}
                onClear={async () => { setWriteContent(''); if (extraction) await saveExtraction({ ...extraction, chapterContents: { ...chapterContents, [chapterWriteView || '']: '' }, updatedAt: new Date().toISOString() }) }}
                onNavigateChapter={(dir) => {
                  const target = dir === 'prev' ? parseInt(chapterWriteView || '0') - 1 : parseInt(chapterWriteView || '0') + 1
                  const d = detailGenResults.length > 0 ? detailGenResults.find((d: any) => d.chapterNumber === target) : null
                  if (d) { const updated = { ...chapterContents, [chapterWriteView || '']: writeContent }; setChapterContents(updated); if (extraction) saveExtraction({ ...extraction, chapterContents: updated, updatedAt: new Date().toISOString() }); setChapterWriteView(String(target)); setWriteContent(chapterContents[String(target)] || '') }
                }}
              />

            {/* Write tab modals */}
            <ChapterGenerationModal
              isOpen={showWriteAIGen}
              onClose={() => setShowWriteAIGen(false)}
              chapterId={chapterWriteView || ''}
              currentContent={writeContent}
              onApply={(newContent) => { setWriteContent(newContent); const updated = { ...chapterContents, [chapterWriteView || '']: newContent }; setChapterContents(updated); if (extraction) saveExtraction({ ...extraction, chapterContents: updated, updatedAt: new Date().toISOString() }) }}
              onVersionSaved={(v) => setWriteVersionHistory(prev => [v, ...prev])}
              onGenStart={() => { setWriteGenOverlay(true); setWriteGenWordCount(0) }}
              onGenChunk={(data: any) => { setWriteGenWordCount(data.charCount) }}
              onGenDone={() => { setWriteGenOverlay(false); writeGenAbortRef.current = null }}
              onGenError={() => { setWriteGenOverlay(false); writeGenAbortRef.current = null }}
              externalAbortRef={writeGenAbortRef}
            />
            <ReviewModal
              isOpen={showWriteReview}
              onClose={() => setShowWriteReview(false)}
              chapterTitle={detailGenResults.find((d: any) => d.chapterNumber === parseInt(chapterWriteView || '0'))?.title || '未命名章节'}
              chapterLabel={`第${chapterWriteView || '?'}章`}
              chapterContent={writeContent}
              projectId={extraction?.id || ''}
              configId={activeConfigId || ''}
            />
            <ReviewResultsModal
              isOpen={showWriteReviewResults}
              onClose={() => setShowWriteReviewResults(false)}
            />
            {/* Version history modal */}
            <Modal isOpen={showWriteVersions} onClose={() => setShowWriteVersions(false)} title="版本历史" width={700}>
              <div style={{ maxHeight: 400, overflowY: 'auto' }} className="custom-scrollbar">
                {writeVersionHistory.length > 0 ? writeVersionHistory.map((v: VersionRecord, i: number) => (
                  <div key={i} style={{ padding: '8px 12px', borderRadius: 10, background: '#faf9f8', border: '1px solid rgba(0,0,0,0.06)', marginBottom: 6, fontSize: 11 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontWeight: 600, color: '#2d2520' }}>版本 {writeVersionHistory.length - i} — {v.modelName}</span>
                      <span style={{ fontSize: 10, color: '#9b8e84' }}>{new Date(v.generatedAt).toLocaleString()}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => { setWriteContent(v.generatedContent); setShowWriteVersions(false) }} style={{ padding: '2px 8px', borderRadius: 6, border: '1px solid rgba(124,58,237,0.2)', background: 'rgba(124,58,237,0.04)', color: '#7c3aed', cursor: 'pointer', fontSize: 10 }}>恢复</button>
                    </div>
                  </div>
                )) : <div style={{ textAlign: 'center', padding: 40, color: '#9b8e84', fontSize: 13 }}>暂无版本记录</div>}
              </div>
            </Modal>
            {/* Export modal */}
            <Modal isOpen={showWriteExport} onClose={() => setShowWriteExport(false)} title="导出章节" width={400}>
              <p style={{ fontSize: 13, color: '#6b5e54', marginBottom: 16 }}>导出第{chapterWriteView || '?'}章为TXT文件</p>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <Button variant="secondary" size="sm" onClick={() => setShowWriteExport(false)}>取消</Button>
                <Button size="sm" onClick={async () => {
                  const outputPath = await dialogService.saveFile(`第${chapterWriteView || '0'}章.txt`)
                  if (!outputPath) return
                  await exportService.exportSingleChapter({
                    title: detailGenResults.find((d: any) => d.chapterNumber === parseInt(chapterWriteView || '0'))?.title || `第${chapterWriteView}章`,
                    content: writeContent,
                    outputPath,
                  })
                  setShowWriteExport(false)
                  setToast('导出成功')
                  setTimeout(() => setToast(''), 3000)
                }} icon={<DocumentArrowDownIcon style={{ width: 14, height: 14 }} />}>导出TXT</Button>
              </div>
            </Modal>
          </>
          )}

          {/* === 生成 Tab === */}
          {previewTab === 'generate' && (
            <GenerateTab
              extraction={extraction}
              outlineResults={outlineResults}
              outlineGenerated={outlineGenerated}
              novelType={novelType}
              genLoading={genLoading}
              genPreview={genPreview}
              genType={genType}
              detailGenRunning={detailGenRunning}
              detailGenCurrent={detailGenCurrent}
              detailGenResults={detailGenResults}
              detailsResults={detailsResults}
              extractIds={extractIds}
              onGenerateDim={handleGenerateDim}
              onGenerateDetails={handleGenerateDetailsImitation}
              onStopDetailGen={() => { detailGenAbortRef.current = true }}
              onSaveAllDetails={() => {
                const json = JSON.stringify(detailGenResults, null, 2)
                setDetailsResults(json)
                if (extraction) saveExtraction({ ...extraction, detailsResults: json, detailGenResults, updatedAt: new Date().toISOString() })
                alert(`已保存 ${detailGenResults.length} 章细纲`)
              }}
              onClearDetails={() => {
                if (!confirm(`确定清除全部 ${detailGenResults.length} 章模仿细纲数据？此操作不可恢复。`)) return
                setDetailGenResults([]); setDetailsResults('')
                if (extraction) saveExtraction({ ...extraction, detailsResults: '', detailGenResults: [], updatedAt: new Date().toISOString() })
              }}
              onSelectRemaining={() => {
                const leftovers = extraction.chapters.filter(c => extractIds.has(c.chapterId) && c.extractedAt && !detailGenResults.find((d: any) => d.chapterNumber === c.chapterNumber))
                if (leftovers.length === 0) { alert('所有选中章节已生成细纲'); return }
                setExtractIds(new Set(leftovers.map(c => c.chapterId)))
                setTimeout(() => handleGenerateDetailsImitation(), 100)
              }}
            />
          )}
        </div>

        {/* Right: Stats */}
        <div style={{ width: 400, minWidth: 320, borderLeft: '1px solid rgba(0,0,0,0.05)', background: 'rgba(255,255,255,0.35)', display: 'flex', flexDirection: 'column', padding: '14px 16px', gap: 10, flexShrink: 0 }}>
          <h4 style={{ fontSize: 14, fontWeight: 700, color: '#2d2520' }}>提取统计</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 13 }}>
            <span>角色: {ag?.characters.length || 0}个</span>
            <span>地点: {ag?.worldbuilding.locations.length || 0}个</span>
            <span>道具: {ag?.items.length || 0}个</span>
            <span>等级: {ag?.powerSystem.levels.length || 0}级</span>
          </div>
          {extraction.styleProfile && <><div style={{ height: 1, background: 'rgba(0,0,0,0.05)' }} /><h4 style={{ fontSize: 14, fontWeight: 700, color: '#2d2520' }}>风格</h4><span style={{ fontSize: 11, color: '#16a34a' }}>✓ 已分析</span></>}
          {ag && activeProjectId && <><div style={{ height: 1, background: 'rgba(0,0,0,0.05)' }} /><Button onClick={handleImportToProject} icon={<FolderOpenIcon style={{ width: 16, height: 16 }} />} style={{ width: '100%' }}>导入到项目</Button></>}
        </div>
      </div>

      {/* Extraction Progress Dialog */}
      {extracting && (
        <ExtractionProgressDialog
          progress={progress}
          paused={pausedRef.current}
          onPauseResume={() => { pausedRef.current = !pausedRef.current }}
          onStop={() => { abortRef.current = true; pausedRef.current = false }}
        />
      )}

      {/* Dimension Selection Dialog */}
      {showDimDialog && (
        <DimensionSelectionDialog
          extractDims={extractDims}
          extractCount={extractIds.size}
          onToggleDim={(key) => { const n = new Set(extractDims); n.has(key) ? n.delete(key) : n.add(key); setExtractDims(n) }}
          onSetDims={setExtractDims}
          onConfirm={() => { setShowDimDialog(false); handleStartExtract() }}
          onClose={() => setShowDimDialog(false)}
        />
      )}

      {/* Style Dimension Dialog */}
      {showStyleDimDialog && (
        <StyleDimensionDialog
          styleDims={styleDims}
          styleChapterCount={styleChapterIds.size || 20}
          novelType={novelType}
          onToggleDim={(key) => { const n = new Set(styleDims); n.has(key) ? n.delete(key) : n.add(key); setStyleDims(n) }}
          onSetDims={setStyleDims}
          onConfirm={() => { setShowStyleDimDialog(false); handleStyleAnalyze() }}
          onClose={() => setShowStyleDimDialog(false)}
        />
      )}

            {/* Import Characters Modal */}
            <ImportCharactersModal
              isOpen={showImportModal}
              importChars={importChars}
              existingChars={existingChars}
              charActions={charActions}
              onActionChange={setCharActions}
              onConfirm={handleConfirmImport}
              onClose={() => setShowImportModal(false)}
            />

            {/* Source Detail Modal (read-only view of extracted chapter data) */}
            <Modal isOpen={showSrcDetailModal} onClose={() => { setShowSrcDetailModal(false); setViewingSrcDetail(null) }} title={`原书细纲 - 第${viewingSrcDetail?.chapterNumber || '?'}章`} width={680}>
              {viewingSrcDetail && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '70vh', overflowY: 'auto' }} className="custom-scrollbar">
                  <div><span style={{ fontSize: 14, fontWeight: 700, color: '#2d2520' }}>{viewingSrcDetail.chapterTitle}</span></div>
                  <div><label style={{ fontSize: 11, fontWeight: 600, color: '#9b8e84' }}>剧情摘要</label><p style={{ fontSize: 12, color: '#4a3f38', lineHeight: 1.7, margin: '4px 0 0' }}>{viewingSrcDetail.chapterSummary || '无'}</p></div>
                  {viewingSrcDetail.characters?.length > 0 && <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: '#9b8e84' }}>出场角色 ({viewingSrcDetail.characters.length})</label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                      {viewingSrcDetail.characters.map((c: any) => <span key={c.name} style={{ padding: '4px 10px', borderRadius: 8, background: 'rgba(124,58,237,0.06)', fontSize: 11, color: '#7c3aed' }}>{c.name}{c.role ? `(${c.role})` : ''}{c.traits?.length ? `: ${Array.isArray(c.traits) ? c.traits.join('、') : c.traits}` : ''}</span>)}
                    </div>
                  </div>}
                  {viewingSrcDetail.events?.length > 0 && <div><label style={{ fontSize: 11, fontWeight: 600, color: '#9b8e84' }}>关键事件</label><div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>{viewingSrcDetail.events.map((e: string) => <span key={e} style={{ padding: '3px 8px', borderRadius: 6, background: 'rgba(59,130,246,0.06)', fontSize: 10, color: '#3b82f6' }}>{e}</span>)}</div></div>}
                  {viewingSrcDetail.emotionalTone && <div><label style={{ fontSize: 11, fontWeight: 600, color: '#9b8e84' }}>情绪基调</label><span style={{ fontSize: 12, color: '#4a3f38', marginLeft: 8 }}>{viewingSrcDetail.emotionalTone}</span></div>}
                  {viewingSrcDetail.erotic && <div style={{ padding: '12px 16px', borderRadius: 12, background: 'rgba(220,38,38,0.03)', border: '1px solid rgba(220,38,38,0.12)', marginTop: 4 }}>
                    <label style={{ fontSize: 11, fontWeight: 700, color: '#dc2626' }}>🔞 情色分析</label>
                    {viewingSrcDetail.erotic.characterRoles?.length > 0 && <div style={{ marginTop: 6 }}><div style={{ fontSize: 10, fontWeight: 600, color: '#9b8e84', marginBottom: 2 }}>情色角色</div><div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{viewingSrcDetail.erotic.characterRoles.map((cr: any) => <span key={cr.name} style={{ padding: '4px 10px', borderRadius: 8, background: 'rgba(220,38,38,0.06)', fontSize: 10, color: '#dc2626' }}>{cr.name}({cr.domSub}/{cr.bodyState}) 性癖:{cr.kinks?.join(',')||'无'} 羞耻:{cr.shameLevel}</span>)}</div></div>}
                    {viewingSrcDetail.erotic.sceneFlow?.length > 0 && <div style={{ marginTop: 6 }}><div style={{ fontSize: 10, fontWeight: 600, color: '#9b8e84', marginBottom: 2 }}>性爱流程</div>{viewingSrcDetail.erotic.sceneFlow.map((sf: any, i: number) => <div key={i} style={{ fontSize: 10, color: '#4a3f38', marginBottom: 2, paddingLeft: 8, borderLeft: '2px solid rgba(220,38,38,0.15)' }}>{sf.phase}({sf.duration}): {sf.actions?.join('、')} → {sf.bodyReactions?.join('、')}</div>)}</div>}
                    {viewingSrcDetail.erotic.techniques && <div style={{ marginTop: 4, fontSize: 10, color: '#6b5e54' }}>技法: 体液[{viewingSrcDetail.erotic.techniques.bodyFluids?.join(',')||'无'}] 触感[{viewingSrcDetail.erotic.techniques.touchFocus?.join(',')||'无'}] 声音[{viewingSrcDetail.erotic.techniques.soundStyle||'密集'}] 呻吟[{viewingSrcDetail.erotic.techniques.moanDensity||'密集'}]</div>}
                    {viewingSrcDetail.erotic.powerDynamics && <div style={{ marginTop: 4, fontSize: 10, color: '#4a3f38' }}>权力关系: {viewingSrcDetail.erotic.powerDynamics}</div>}
                    {viewingSrcDetail.erotic.degradationPatterns?.length > 0 && <div style={{ marginTop: 4, fontSize: 10, color: '#6b5e54' }}>羞辱模式: {viewingSrcDetail.erotic.degradationPatterns.join('、')}</div>}
                  </div>}
                </div>
              )}
            </Modal>

            {/* Imitation Detail Modal (editable view of generated chapter data) */}
            <Modal isOpen={showDetailModal} onClose={() => { setShowDetailModal(false); setEditingDetail(null) }} title={`编辑细纲 - 第${editingDetail?.chapterNumber || '?'}章`} width={680}>
              {editingDetail && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: '70vh', overflowY: 'auto' }} className="custom-scrollbar">
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', display: 'block', marginBottom: 3 }}>标题</label>
                    <input value={editingDetail.title || ''} onChange={e => setEditingDetail({ ...editingDetail, title: e.target.value })} style={{ width: '100%', padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', fontSize: 13 }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', display: 'block', marginBottom: 3 }}>剧情摘要</label>
                    <textarea value={editingDetail.summary || ''} onChange={e => setEditingDetail({ ...editingDetail, summary: e.target.value })} rows={4} style={{ width: '100%', padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', fontSize: 13, resize: 'vertical', fontFamily: 'inherit' }} />
                  </div>
                  <div style={{ display: 'flex', gap: 16 }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', display: 'block', marginBottom: 3 }}>出场角色 (逗号分隔)</label>
                      <input value={Array.isArray(editingDetail.charactersAppearing) ? editingDetail.charactersAppearing.join(', ') : (editingDetail.charactersAppearing || '')} onChange={e => setEditingDetail({ ...editingDetail, charactersAppearing: e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean) })} style={{ width: '100%', padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', fontSize: 13 }} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', display: 'block', marginBottom: 3 }}>场景位置</label>
                      <input value={editingDetail.location || ''} onChange={e => setEditingDetail({ ...editingDetail, location: e.target.value })} style={{ width: '100%', padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', fontSize: 13 }} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 16 }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', display: 'block', marginBottom: 3 }}>等级变化</label>
                      <input value={editingDetail.levelChange || ''} onChange={e => setEditingDetail({ ...editingDetail, levelChange: e.target.value })} style={{ width: '100%', padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', fontSize: 13 }} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', display: 'block', marginBottom: 3 }}>情绪基调</label>
                      <input value={editingDetail.emotionalTone || ''} onChange={e => setEditingDetail({ ...editingDetail, emotionalTone: e.target.value })} style={{ width: '100%', padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', fontSize: 13 }} />
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', display: 'block', marginBottom: 3 }}>道具 (逗号分隔)</label>
                    <input value={Array.isArray(editingDetail.itemsUsed) ? editingDetail.itemsUsed.map((i: any) => safeItemName(i)).join(', ') : (editingDetail.itemsUsed || '')} onChange={e => setEditingDetail({ ...editingDetail, itemsUsed: e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean) })} style={{ width: '100%', padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', fontSize: 13 }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', display: 'block', marginBottom: 3 }}>关键事件 (一行一个)</label>
                    <textarea value={Array.isArray(editingDetail.keyEvents) ? editingDetail.keyEvents.join('\n') : (editingDetail.keyEvents || '')} onChange={e => setEditingDetail({ ...editingDetail, keyEvents: e.target.value.split('\n').filter(Boolean) })} rows={3} style={{ width: '100%', padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', fontSize: 13, resize: 'vertical', fontFamily: 'inherit' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: '#dc2626', display: 'block', marginBottom: 3 }}>🔞 情色场景设计</label>
                    <textarea value={editingDetail.eroticScene || ''} onChange={e => setEditingDetail({ ...editingDetail, eroticScene: e.target.value })} rows={6} style={{ width: '100%', padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(220,38,38,0.2)', fontSize: 13, resize: 'vertical', fontFamily: 'inherit', background: 'rgba(220,38,38,0.02)' }} placeholder="情色剧情设计...200-400字" />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8, borderTop: '1px solid rgba(0,0,0,0.06)' }}>
                    <Button variant="secondary" size="sm" onClick={() => { setShowDetailModal(false); setEditingDetail(null) }}>取消</Button>
                    <Button size="sm" onClick={() => handleUpdateDetail(editingDetail)}>保存细纲</Button>
                  </div>
                </div>
              )}
            </Modal>

    </div>
  )
}
