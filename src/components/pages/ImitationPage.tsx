import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore, useSettingsStore } from '@/store'
import { extractionService, aiService, fileService, styleProjectService } from '@/services/fileService'
import { loadCharacters, saveCharacter } from '@/services/characterService'
import { saveDetailedChapter } from '@/services/chapterService'
import { sceneService } from '@/services/sceneService'
import {
  aggregateExtractions, parseExtractionReply, splitChapters,
  buildExtractionPrompt, parseExtractionReplyWithErotic, buildEroticExtractionPrompt,
  computePacingTemplate, chaptersToStyleChapters,
  buildGenerateOutlinePrompt, buildGenerateDetailedOutlinesPrompt,
  buildGenerateCharactersPrompt, buildGenerateWorldbuildingPrompt,
  buildEroticGenerateOutlinePrompt, buildEroticGenerateCharactersPrompt,
  buildEroticGenerateDetailedOutlinesPrompt, buildEroticGenerateWorldbuildingPrompt,
  parseGeneratedOutline, parseGeneratedDetailedOutlines,
  parseGeneratedCharacters, parseGeneratedWorldbuilding,
  buildStyleAnalyzePrompt, parseStyleAnalysisReply,
  computeEventPattern, computeProgressionRhythm,
  computeCharacterArchetype, computeEmotionCurve,
  buildGenerateOutlinePromptWithPatterns,
} from '@/services/extractionService'
import { nanoid } from 'nanoid'
import GlassCard from '@/components/common/GlassCard'
import Button from '@/components/common/Button'
import ScrollArea from '@/components/common/ScrollArea'
import { logError } from '@/utils/logger'
import type { NovelExtraction, AggregatedResult, EroticSceneConfig } from '@/types/story'
import { DIMENSION_META, NOVEL_TYPE_DIMS } from '@/types/story'
import type { Character } from '@/types/character'
import { EMPTY_CHARACTER } from '@/types/character'
import {
  SparklesIcon, TrashIcon, DocumentTextIcon, UserGroupIcon, GlobeAltIcon,
  LightBulbIcon, PlayIcon, StopIcon, ArrowPathIcon, FolderOpenIcon,
  CheckCircleIcon, ArrowLeftIcon, BookOpenIcon, FireIcon,
} from '@heroicons/react/24/outline'

type ViewMode = 'typeSelect' | 'library' | 'detail'
type NovelType = 'general' | 'urban' | 'cultivation' | 'martial' | 'romance' | 'ancient' | 'mystery' | 'historical' | 'transmigration' | 'scifi' | 'erotic'
type Step = 'import' | 'extracting' | 'style' | 'generating' | 'completed'
type PreviewTab = 'chapter' | 'characters' | 'worldbuilding' | 'outline' | 'items' | 'power' | 'generate'

const TABS: { key: PreviewTab; label: string; icon: typeof DocumentTextIcon }[] = [
  { key: 'chapter', label: '章节', icon: BookOpenIcon },
  { key: 'characters', label: '角色', icon: UserGroupIcon },
  { key: 'worldbuilding', label: '世界观', icon: GlobeAltIcon },
  { key: 'outline', label: '章节摘要', icon: DocumentTextIcon },
  { key: 'items', label: '道具', icon: SparklesIcon },
  { key: 'power', label: '等级', icon: LightBulbIcon },
  { key: 'generate', label: '生成', icon: SparklesIcon },
]

const STATUS_LABELS: Record<string, string> = { draft: '未开始', extracting: '提取中', aggregated: '已聚合', completed: '已完成' }
const STATUS_COLORS: Record<string, string> = { draft: '#9b8e84', extracting: '#f59e0b', aggregated: '#3b82f6', completed: '#16a34a' }

const TYPE_LABELS: Record<string, string> = { general: '通用', urban: '都市', cultivation: '修仙', martial: '武侠', romance: '恋爱', ancient: '古风', mystery: '悬疑', historical: '历史', transmigration: '穿越', scifi: '科幻', erotic: '情色' }

const TYPE_DIM_PRESETS: Record<string, string[]> = {
  general: ['characters','worldbuilding','items','powerSystem','chapterSummary','events','foreshadowing','emotionalTone'],
  urban: ['characters','worldbuilding','chapterSummary','events','foreshadowing','emotionalTone'],
  cultivation: ['characters','worldbuilding','items','powerSystem','chapterSummary','events','foreshadowing'],
  martial: ['characters','worldbuilding','items','powerSystem','chapterSummary','events','foreshadowing'],
  romance: ['characters','worldbuilding','chapterSummary','events','emotionalTone'],
  ancient: ['characters','worldbuilding','items','powerSystem','chapterSummary','events','foreshadowing','emotionalTone'],
  mystery: ['characters','worldbuilding','chapterSummary','events','foreshadowing','emotionalTone'],
  historical: ['characters','worldbuilding','chapterSummary','events','foreshadowing'],
  transmigration: ['characters','worldbuilding','items','powerSystem','chapterSummary','events'],
  scifi: ['characters','worldbuilding','items','powerSystem','chapterSummary','events'],
  erotic: ['characters','worldbuilding','items','powerSystem','chapterSummary','events','foreshadowing','emotionalTone','erotic'],
}

export default function ImitationPage() {
  const navigate = useNavigate()
  const activeConfigId = useSettingsStore(s => s.activeConfigId)
  const activeProjectId = useStore(s => s.activeProjectId)
  const projectsBasePath = useStore(s => s.projectsBasePath)
  const setCharacters = useStore(s => s.setCharacters)
  const setOutlineContent = useStore(s => s.setOutlineContent)
  const setWorldbuildingContent = useStore(s => s.setWorldbuildingContent)

  const [view, setView] = useState<ViewMode>('typeSelect')
  const [novelType, setNovelType] = useState<NovelType>('general')
  const [projects, setProjects] = useState<{ id: string; name: string; chapterCount: number; status: string; createdAt: string; novelType: string }[]>([])
  const [extraction, setExtraction] = useState<NovelExtraction | null>(null)
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null)
  const [step, setStep] = useState<Step>('import')
  const [progress, setProgress] = useState({ current: 0, total: 0, text: '' })
  const [loading, setLoading] = useState(false)
  const [previewTab, setPreviewTab] = useState<PreviewTab>('chapter')
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
  const [showDimDialog, setShowDimDialog] = useState(false)
  const [extractDims, setExtractDims] = useState<Set<string>>(new Set())
  const [showStyleDimDialog, setShowStyleDimDialog] = useState(false)
  const [styleDims, setStyleDims] = useState<Set<string>>(new Set())
  const abortRef = useRef(false)
  const extractingRef = useRef(false)
  const pausedRef = useRef(false)

  useEffect(() => { loadProjects() }, [])

  const loadProjects = async () => {
    try { setProjects(await extractionService.listProjects() as any[]) } catch { /* */ }
  }

  const handleSelectType = (type: NovelType) => {
    setNovelType(type)
    setView('library')
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
        styleProfile: null, pacingTemplate: null, eventPattern: null, progressionRhythm: null, characterArchetype: null, emotionCurve: null, generatedNovel: null,
        status: 'draft', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }
      ext.chapters = chapters.map((ch, i) => ({
        chapterId: `ch_${i + 1}`, chapterNumber: ch.chapterNumber,
        chapterTitle: ch.title, chapterContent: ch.content,
        characters: [], worldbuilding: [], items: [], powerSystem: [],
        chapterSummary: '', events: [], foreshadowing: [], emotionalTone: '', extractedAt: '',
      }))
      await extractionService.saveProject(ext)
      await loadProjects()
      setExtraction(ext); setSelectedChapterId(ext.chapters[0]?.chapterId || null)
      setExtractIds(new Set()); setStep('import'); setView('detail')
    } catch (err) { logError('导入失败', err); alert('导入失败') }
    setLoading(false)
  }

  const handleEnterProject = async (id: string) => {
    setLoading(true)
    try {
      const ext = await extractionService.loadProject(id) as NovelExtraction
      setExtraction(ext); setSelectedChapterId(ext.chapters[0]?.chapterId || null)
      setExtractIds(new Set(ext.chapters.filter(c => c.extractedAt).map(c => c.chapterId))); setNovelType((ext.novelType as NovelType) || 'general')
      if (ext.status === 'completed') setStep('completed')
      else if (ext.styleProfile) setStep('style')
      else if (ext.aggregated) setStep('extracting')
      else if (ext.chapters.some(c => c.extractedAt)) setStep('extracting')
      else setStep('import')
      setView('detail')
    } catch { /* */ }
    setLoading(false)
  }

  const handleDeleteProject = async (id: string, name: string) => {
    if (!confirm(`确定删除「${name}」？`)) return
    await extractionService.deleteProject(id)
    if (extraction?.id === id) { setExtraction(null); setView('library') }
    await loadProjects()
  }

  const toggleExtractId = (id: string) => {
    setExtractIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  const selectedChapter = extraction?.chapters.find(c => c.chapterId === selectedChapterId)
  const extractedCount = extraction?.chapters.filter(c => c.extractedAt).length || 0
  const ag = extraction?.aggregated || null

  // ---- Extract ----
  const handleStartExtract = async () => {
    if (!extraction || !activeConfigId) return
    const chs = extraction.chapters.filter(c => extractIds.has(c.chapterId))
    if (chs.length === 0) { alert('请先选择章节'); return }
    abortRef.current = false; pausedRef.current = false; extractingRef.current = true; setStep('extracting')
    const chapters = [...extraction.chapters]
    for (let i = 0; i < chs.length; i++) {
      if (abortRef.current) { setProgress({ current: i, total: chs.length, text: '已停止' }); extractingRef.current = false; return }
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
        const parsed = novelType === 'erotic'
          ? parseExtractionReplyWithErotic(reply, ch.chapterId, ch.chapterNumber, ch.chapterTitle, ch.chapterContent)
          : parseExtractionReply(reply, ch.chapterId, ch.chapterNumber, ch.chapterTitle, ch.chapterContent)
        const idx = chapters.findIndex(c => c.chapterId === ch.chapterId)
        if (idx !== -1) chapters[idx] = parsed
        const updated = { ...extraction, chapters, updatedAt: new Date().toISOString(), status: 'extracting' as const }
        setExtraction(updated); await extractionService.saveProject(updated)
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
        await extractionService.saveProject(updated)
      }
      setProgress({ current: chs.length, total: chs.length, text: '完成' })
      setStep('extracting'); extractingRef.current = false
    }
    extractingRef.current = false
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
    const analyses: string[] = []
    for (let i = 0; i < chs.length; i++) {
      if (styleAbortRef.current) { setStyleProgress(`已停止(${i}/${chs.length})`); setStyleLoading(false); return }
      while (stylePausedRef.current) { await new Promise(r => setTimeout(r, 200)) }
      setStyleProgress(`风格: ${i + 1}/${chs.length}`)
      try {
        const reply = await aiService.chat([{ role: 'user' as const, content: `${buildStyleAnalyzePrompt(dims)}\n\n[${chs[i].chapterTitle}]\n${chs[i].chapterContent.slice(0, 3000)}` }], activeConfigId)
        const a = parseStyleAnalysisReply(reply)
        analyses.push(`第${chs[i].chapterNumber}章: ${a.sentenceStyle}; ${a.rhythmStyle}; ${a.dialogueStyle}`)
      } catch (err) { logError(`风格分析失败 第${chs[i].chapterNumber}章`, err) }
    }
    // Aggregate into simple profile
    const summaryReply = await aiService.chat([{ role: 'user' as const, content: `总结以下风格分析为一段完整的StyleProfile JSON:\n${analyses.join('\n')}\n输出JSON: {"fullDescription":"总结","features":{...}}` }], activeConfigId)
    let profile: any = null
    try { const m = summaryReply.match(/\{[\s\S]*\}/); if (m) profile = JSON.parse(m[0]) } catch { profile = { fullDescription: analyses.join('; '), features: {} } }
    const updated = { ...extraction, styleProfile: profile, pacingTemplate: computePacingTemplate(extraction.chapters.filter(c => c.extractedAt)), updatedAt: new Date().toISOString() }
    setExtraction(updated); await extractionService.saveProject(updated)
    setStyleProgress('完成'); setStyleLoading(false); setStylePaused(false); setStep('generating')
  }

  // ---- Generate ----
  const handleGenerate = async (type: string) => {
    if (!extraction || !activeConfigId) return
    setGenLoading(true); setGenType(type); setGenPreview('')
    const isErotic = novelType === 'erotic'
    try {
      let prompt = ''; let reply = ''
      switch (type) {
        case 'outline':
          prompt = isErotic ? buildEroticGenerateOutlinePrompt(extraction) : buildGenerateOutlinePromptWithPatterns(extraction)
          // Use streaming for outline (long output), accumulate in local var
          let streamed = ''
          await new Promise<void>((resolve) => {
            aiService.chatStream(
              [{ role: 'user' as const, content: prompt }], activeConfigId, undefined,
              (data) => { setGenPreview(data.accumulated); streamed = data.accumulated },
              () => { reply = streamed; resolve() },
              () => { resolve() },
              () => { resolve() },
            )
          })
          if (!reply) reply = streamed
          setGenPreview(parseGeneratedOutline(reply)); break
        case 'details':
          if (!extraction.generatedNovel?.outline) { alert('请先生成新大纲'); setGenLoading(false); return }
          prompt = isErotic ? buildEroticGenerateDetailedOutlinesPrompt(extraction.generatedNovel.outline, extraction) : buildGenerateDetailedOutlinesPrompt(extraction.generatedNovel.outline, extraction)
          reply = await aiService.chat([{ role: 'user' as const, content: prompt }], activeConfigId)
          setGenPreview(JSON.stringify(parseGeneratedDetailedOutlines(reply), null, 2)); break
        case 'characters':
          prompt = isErotic ? buildEroticGenerateCharactersPrompt(extraction) : buildGenerateCharactersPrompt(extraction)
          reply = await aiService.chat([{ role: 'user' as const, content: prompt }], activeConfigId)
          setGenPreview(JSON.stringify(parseGeneratedCharacters(reply), null, 2)); break
        case 'worldbuilding':
          prompt = isErotic ? buildEroticGenerateWorldbuildingPrompt(extraction) : buildGenerateWorldbuildingPrompt(extraction)
          reply = await aiService.chat([{ role: 'user' as const, content: prompt }], activeConfigId)
          const parsed = parseGeneratedWorldbuilding(reply)
          setGenPreview(`## 世界观\n\n${parsed.worldbuilding}\n\n## 等级体系\n\n${parsed.powerSystem.levels.join(' → ')}\n\n${parsed.powerSystem.description}`); break
      }
    } catch (err) { logError('生成失败', err) }
    setGenLoading(false)
  }

  const handleSaveGenerated = async () => {
    if (!extraction || !genPreview) return
    const gn = extraction.generatedNovel || { outline: '', detailedOutlines: [], characters: [], worldbuilding: '', powerSystem: { name: '', levels: [], description: '' }, generatedAt: '' }
    switch (genType) {
      case 'outline': gn.outline = genPreview; break
      case 'details': try { gn.detailedOutlines = JSON.parse(genPreview) } catch { gn.detailedOutlines = [] }; break
      case 'characters': try { gn.characters = JSON.parse(genPreview) } catch { gn.characters = [] }; break
      case 'worldbuilding': gn.worldbuilding = genPreview; break
    }
    gn.generatedAt = new Date().toISOString()
    const updated = { ...extraction, generatedNovel: gn, updatedAt: new Date().toISOString(), status: 'completed' as const }
    setExtraction(updated); await extractionService.saveProject(updated)
    setGenPreview(''); setGenType(null); setStep('completed'); alert('已保存')
  }

  const handleSendToStyleWorkshop = async () => {
    if (!extraction) return
    const updated = { ...extraction, pacingTemplate: computePacingTemplate(extraction.chapters.filter(c => c.extractedAt)), updatedAt: new Date().toISOString() }
    setExtraction(updated); extractionService.saveProject(updated)
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

  // ---- Import to project ----
  const handleImportToProject = async () => {
    if (!ag || !activeProjectId || !projectsBasePath || !extraction) return
    const pp = `${projectsBasePath}/${activeProjectId}`
    const gn = extraction.generatedNovel; const imported: string[] = []

    // Outline
    if (gn?.outline) { await fileService.write(`${pp}/outline/outline.txt`, gn.outline); setOutlineContent(gn.outline); imported.push('大纲') }

    // Detailed outlines
    if (gn?.detailedOutlines && gn.detailedOutlines.length > 0) {
      await fileService.ensureDir(`${pp}/detailed_outline`)
      for (const d of gn.detailedOutlines) {
        if (!d.chapterNumber || !d.title) continue
        const origSummary = extraction.chapters.find(c => c.chapterNumber === d.chapterNumber)?.chapterSummary
        const desc = d.summary + (origSummary ? `\n\n[原作参考]\n${origSummary}` : '')
        await saveDetailedChapter(pp, { id: `ch_${d.chapterNumber}`, title: d.title, description: desc, summary: d.summary, order: d.chapterNumber - 1, status: 'outline' })
      }
      imported.push(`${gn.detailedOutlines.length}章细纲`)
    }

    // Characters
    let existingNames = new Set<string>()
    if (gn?.characters && gn.characters.length > 0) {
      const existing = await loadCharacters(pp); existingNames = new Set(existing.map(c => c.name))
      for (const gc of gn!.characters) {
        if (existingNames.has(gc.name)) continue
        await saveCharacter(pp, { ...EMPTY_CHARACTER, id: nanoid(8), name: gc.name, role: (['男主','女主','男配','女配','反派','其他'].includes(gc.role) ? gc.role : '其他') as Character['role'], personality: gc.traits?.join('、') || '', background: gc.background || '', importance: 50 })
        existingNames.add(gc.name)
      }
      imported.push(`${gn.characters.length}个角色`)
    }
    for (const ac of ag.characters) {
      if (existingNames.has(ac.name)) continue
      await saveCharacter(pp, { ...EMPTY_CHARACTER, id: nanoid(8), name: ac.name, role: (['男主','女主','男配','女配','反派','其他'].includes(ac.role) ? ac.role : '其他') as Character['role'], personality: ac.traits.join('、'), appearance: ac.appearance, background: ac.background, importance: 50 })
    }
    setCharacters(await loadCharacters(pp))

    // Worldbuilding
    let wbContent = gn?.worldbuilding || ''
    if (!wbContent) {
      if (ag.worldbuilding.locations.length > 0) wbContent += '## 地点\n\n' + ag.worldbuilding.locations.map(l => `- ${l.name}: ${l.description}`).join('\n') + '\n\n'
      if (ag.worldbuilding.factions.length > 0) wbContent += '## 势力\n\n' + ag.worldbuilding.factions.map(f => `- ${f.name}: ${f.description}`).join('\n') + '\n\n'
      if (ag.worldbuilding.rules.length > 0) wbContent += '## 规则\n\n' + ag.worldbuilding.rules.map(r => `- ${r.name}: ${r.description}`).join('\n') + '\n\n'
      if (ag.worldbuilding.history) wbContent += '## 历史\n\n' + ag.worldbuilding.history + '\n\n'
      if (ag.powerSystem.levels.length > 0) { wbContent += '## 等级体系\n\n' + ag.powerSystem.levels.join(' → ') + '\n'; if (ag.powerSystem.description) wbContent += ag.powerSystem.description + '\n' }
    }
    if (ag.items.length > 0) { wbContent += '\n## 道具目录\n\n' + ag.items.map(i => `- ${i.name}(${i.type}): ${i.ability}`).join('\n') + '\n'; imported.push(`${ag.items.length}个道具`) }
    if (wbContent) { await fileService.write(`${pp}/worldbuilding/worldbuilding.txt`, wbContent); setWorldbuildingContent(wbContent); imported.push('世界观') }

    // Erotic scene configs (auto-create for erotic novels)
    if (novelType === 'erotic') {
      let sceneCount = 0
      await fileService.ensureDir(`${pp}/scenes`)
      for (const ch of extraction.chapters.filter(c => c.erotic && c.extractedAt)) {
        const ed = ch.erotic!
        const esc: EroticSceneConfig = {
          characters: ed.characterRoles.map(cr => ({ characterId: '', characterName: cr.name, role: (cr.domSub === 'dom' ? 'dom' : 'sub') as any, bodyState: cr.bodyState, customNote: '' })),
          location: '', time: '', atmosphere: '', publicity: '',
          selectedKinks: [...new Set(ed.characterRoles.flatMap(cr => cr.kinks))], kinkNote: '',
          opening: ed.sceneFlow.filter(sf => sf.phase === '前戏').flatMap(sf => sf.actions).slice(0, 3),
          mainPose: '无偏好', mainRhythm: '无偏好', poseChanges: '2-3次转换',
          climax: ed.sceneFlow.filter(sf => sf.phase === '高潮').flatMap(sf => sf.actions).slice(0, 3),
          aftermath: ed.sceneFlow.filter(sf => sf.phase === '收尾').flatMap(sf => sf.actions).slice(0, 2),
          soundDensity: ed.techniques.soundStyle || '密集', moanStyle: ed.techniques.moanDensity || '密集',
          degradeLangs: ed.degradationPatterns || [],
          intensity: 3, wordTarget: 3000, streamMode: true, replaceMode: true,
          useStyleProfile: true, useChapterOutline: true, extraNote: ed.powerDynamics,
          kinkIntensities: {}, customKink: '', customCharacters: [],
          customLocation: '', customTime: '', customAtmosphere: '', customPublicity: '',
          extraPhases: ed.sceneFlow.map(sf => ({ name: sf.phase, desc: sf.actions.join('、') })),
          customInsults: '', bannedWords: '', narrativePOV: '第三人称',
        }
        await sceneService.saveChapterSceneConfig(pp, { chapterId: ch.chapterId, chapterTitle: ch.chapterTitle, eroticScene: esc, novelScene: null, updatedAt: new Date().toISOString() })
        sceneCount++
      }
      if (sceneCount > 0) imported.push(`${sceneCount}个情色场景配置`)
    }

    // Foreshadowing + plot structure
    if (ag.foreshadowing.length > 0) {
      const metaPath = `${pp}/outline/outline_meta.json`
      let existingMeta: any = { foreshadowing: [], plotThreads: [], updatedAt: '' }
      try { const raw = await fileService.read(metaPath); if (raw) existingMeta = JSON.parse(raw) } catch { /* */ }
      existingMeta.foreshadowing = [...(existingMeta.foreshadowing || []), ...ag.foreshadowing.map(f => ({ id: `fs_${nanoid(6)}`, description: f.description, plantChapterId: String(f.plantChapter), payoffChapterId: f.payoffChapter ? String(f.payoffChapter) : '', status: f.status }))]
      existingMeta.updatedAt = new Date().toISOString()
      await fileService.ensureDir(`${pp}/outline`); await fileService.write(metaPath, JSON.stringify(existingMeta, null, 2))
      imported.push(`${ag.foreshadowing.length}条伏笔`)
    }

    alert(`导入完成!\n${imported.join('\n')}`)
    const assignments = useSettingsStore.getState().aiSettings.styleAssignments || {}
    if (!assignments[activeProjectId]) { const go = confirm('未绑定风格档案，前往风格工坊？'); if (go) navigate('/style-workshop') }
  }

  // ---- Views ----

  // View 1: Type Select (11 types in grid)
  const NOVEL_TYPE_CARDS: { type: NovelType; label: string; icon: typeof BookOpenIcon; color: string; desc: string }[] = [
    { type: 'general', label: '通用', icon: BookOpenIcon, color: '#7c3aed', desc: '角色·世界观·等级·摘要·伏笔·情节结构' },
    { type: 'urban', label: '都市', icon: BookOpenIcon, color: '#3b82f6', desc: '职场·社交·资产(无道具等级)' },
    { type: 'cultivation', label: '修仙', icon: BookOpenIcon, color: '#16a34a', desc: '境界·丹药·秘境·功法' },
    { type: 'martial', label: '武侠', icon: BookOpenIcon, color: '#e67e00', desc: '门派·经脉·招式·江湖' },
    { type: 'romance', label: '恋爱', icon: BookOpenIcon, color: '#ec4899', desc: '感情阶段·好感度(无道具等级)' },
    { type: 'ancient', label: '古风', icon: BookOpenIcon, color: '#8b5cf6', desc: '礼仪·称谓·古物·诗词' },
    { type: 'mystery', label: '悬疑', icon: BookOpenIcon, color: '#1e293b', desc: '线索·嫌疑人·反转(无道具等级)' },
    { type: 'historical', label: '历史', icon: BookOpenIcon, color: '#92400e', desc: '官职·制度·权谋·战争(无道具)' },
    { type: 'transmigration', label: '穿越', icon: BookOpenIcon, color: '#06b6d4', desc: '现代知识·新旧对比·身份冲突' },
    { type: 'scifi', label: '科幻', icon: BookOpenIcon, color: '#6366f1', desc: '科技等级·机甲·星际·基因' },
    { type: 'erotic', label: '情色', icon: FireIcon, color: '#dc2626', desc: 'dom-sub·身体状态·性爱流程·体液·权力' },
  ]

  if (view === 'typeSelect') {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
        <div style={{ textAlign: 'center', maxWidth: 960 }}>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: '#2d2520', marginBottom: 8 }}>小说仿写</h1>
          <p style={{ fontSize: 14, color: '#9b8e84', marginBottom: 32 }}>选择小说类型 — AI 分析 → 提取骨架 → 模仿生成新作品</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
            {NOVEL_TYPE_CARDS.map(card => (
              <button key={card.type} onClick={() => handleSelectType(card.type)} style={{
                padding: '20px 16px', borderRadius: 16, border: '2px solid rgba(0,0,0,0.06)', background: '#fff', cursor: 'pointer',
                textAlign: 'center', transition: 'all 0.15s',
              }} onMouseEnter={e => (e.currentTarget as HTMLElement).style.boxShadow = '0 6px 20px rgba(0,0,0,0.08)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.boxShadow = 'none'}>
                <card.icon style={{ width: 32, height: 32, color: card.color, marginBottom: 8 }} />
                <h3 style={{ fontSize: 14, fontWeight: 700, color: '#2d2520', marginBottom: 4 }}>{card.label}</h3>
                <p style={{ fontSize: 10, color: '#9b8e84', lineHeight: 1.5, margin: 0 }}>{card.desc}</p>
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // View 2: Library
  if (view === 'library') {
    const typeLabel = TYPE_LABELS[novelType] || '通用'
    return (
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: 32 }}>
        <div style={{ maxWidth: 900, width: '100%', margin: '0 auto', flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
            <div>
              <h2 style={{ fontSize: 22, fontWeight: 700, color: '#2d2520' }}>
                小说仿写
                <span style={{ fontSize: 14, fontWeight: 400, color: novelType === 'erotic' ? '#dc2626' : '#7c3aed', marginLeft: 10 }}>{typeLabel}小说</span>
              </h2>
              <p style={{ fontSize: 13, color: '#9b8e84', marginTop: 4 }}>导入小说，AI逐章提取并模仿生成新作品</p>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="ghost" size="sm" onClick={() => setView('typeSelect')}>切换类型</Button>
              <Button onClick={handleImport} disabled={loading} icon={<FolderOpenIcon style={{ width: 16, height: 16 }} />}>{loading ? '导入中...' : '导入TXT小说'}</Button>
            </div>
          </div>
          {projects.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 80, color: '#9b8e84' }}>
              <BookOpenIcon style={{ width: 56, height: 56, margin: '0 auto 16px', opacity: 0.2 }} />
              <p style={{ fontSize: 15 }}>暂无仿写仿写项目</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {projects.map(p => (
                <GlassCard key={p.id} hover={false} style={{ padding: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                    <div style={{ flex: 1 }}>
                      <h3 style={{ fontSize: 16, fontWeight: 700, color: '#2d2520', marginBottom: 6 }}>{p.name}</h3>
                      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#9b8e84' }}>
                        <span>{p.chapterCount}章</span>
                        <span style={{ color: STATUS_COLORS[p.status], fontWeight: 600 }}>{STATUS_LABELS[p.status] || p.status}</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Button size="sm" onClick={() => handleEnterProject(p.id)}>查看</Button>
                      <button onClick={() => handleDeleteProject(p.id, p.name)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, color: '#d4ccc4' }}><TrashIcon style={{ width: 16, height: 16 }} /></button>
                    </div>
                  </div>
                </GlassCard>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  // View 3: Detail
  if (!extraction) return null

  return (
    <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '12px 20px', borderBottom: '1px solid rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => { setView('library'); setExtraction(null); loadProjects() }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9b8e84', display: 'flex', padding: 4 }}><ArrowLeftIcon style={{ width: 20, height: 20 }} /></button>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: '#2d2520' }}>{extraction.novelName}</h2>
          <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: novelType === 'erotic' ? 'rgba(220,38,38,0.1)' : 'rgba(124,58,237,0.08)', color: novelType === 'erotic' ? '#dc2626' : '#7c3aed', fontWeight: 600 }}>{TYPE_LABELS[novelType] || '通用'}</span>
          <span style={{ fontSize: 11, color: '#9b8e84' }}>{extraction.chapters.length}章</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <Button size="sm" onClick={() => { const preset = TYPE_DIM_PRESETS[novelType] || TYPE_DIM_PRESETS.general; setExtractDims(new Set(preset)); setShowDimDialog(true) }} disabled={!activeConfigId || extractIds.size === 0 || extractingRef.current} icon={<PlayIcon style={{ width: 14, height: 14 }} />}>提取({extractIds.size}章)</Button>
          {extractingRef.current && (
            <>
              <Button size="sm" variant="ghost" onClick={() => { pausedRef.current = !pausedRef.current }}>{pausedRef.current ? '继续提取' : '暂停提取'}</Button>
              <Button size="sm" variant="danger" onClick={() => { abortRef.current = true; pausedRef.current = false }}>停止提取</Button>
            </>
          )}
          {extractedCount > 0 && !extractingRef.current && !extraction.styleProfile && <Button size="sm" variant="secondary" onClick={() => { const preset = NOVEL_TYPE_DIMS[novelType] || NOVEL_TYPE_DIMS['通用']; setStyleDims(new Set(preset)); setStyleChapterIds(new Set(extraction.chapters.filter(c => c.extractedAt).slice(0, 20).map(c => c.chapterId))); setShowStyleDimDialog(true) }} disabled={!activeConfigId} icon={<SparklesIcon style={{ width: 14, height: 14 }} />}>{styleLoading ? (stylePaused ? '已暂停' : styleProgress) : '风格分析'}</Button>}
          {styleLoading && <Button size="sm" variant="ghost" onClick={() => { if (stylePaused) { setStylePaused(false); stylePausedRef.current = false } else { setStylePaused(true); stylePausedRef.current = true } }} icon={stylePaused ? <PlayIcon style={{ width: 14, height: 14 }} /> : <StopIcon style={{ width: 14, height: 14 }} />}>{stylePaused ? '继续' : '暂停'}</Button>}
          {styleLoading && <Button size="sm" variant="danger" onClick={() => { styleAbortRef.current = true; setStylePaused(false); stylePausedRef.current = false }} icon={<StopIcon style={{ width: 14, height: 14 }} />}>停止</Button>}
          {extraction.styleProfile && !extraction.generatedNovel && <Button size="sm" variant="secondary" onClick={() => setPreviewTab('generate')} icon={<SparklesIcon style={{ width: 14, height: 14 }} />}>模仿生成</Button>}
          <Button size="sm" variant="ghost" onClick={handleSendToStyleWorkshop} icon={<SparklesIcon style={{ width: 14, height: 14 }} />}>深度风格</Button>
          <Button size="sm" variant="ghost" onClick={() => handleDeleteProject(extraction.id, extraction.novelName)} icon={<TrashIcon style={{ width: 14, height: 14 }} />}>删除</Button>
        </div>
      </div>

      {/* Toolbar */}
      <div style={{ padding: '8px 20px', borderBottom: '1px solid rgba(0,0,0,0.04)', display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(0,0,0,0.01)', flexWrap: 'wrap', flexShrink: 0 }}>
        <button onClick={() => setExtractIds(new Set(extraction.chapters.map(c => c.chapterId)))} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#7c3aed' }}>全选</button>
        <button onClick={() => setExtractIds(new Set())} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#7c3aed' }}>清空</button>
        <button onClick={() => setExtractIds(new Set(extraction.chapters.slice(0, 50).map(c => c.chapterId)))} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#7c3aed' }}>前50章</button>
        <button onClick={() => setExtractIds(new Set(extraction.chapters.slice(0, 10).map(c => c.chapterId)))} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#7c3aed' }}>前10章</button>
        <span style={{ fontSize: 11, color: '#9b8e84' }}>已选 {extractIds.size}章</span>
        {(step === 'extracting' || progress.total > 0) && (
          <>
            <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'rgba(0,0,0,0.05)', overflow: 'hidden', minWidth: 100 }}>
              <div style={{ height: '100%', width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%`, background: '#7c3aed', borderRadius: 2, transition: 'width 0.3s' }} />
            </div>
            <span style={{ fontSize: 10, color: '#9b8e84' }}>{progress.current}/{progress.total} {progress.text}</span>
          </>
        )}
      </div>

      {/* Next step guide after extraction */}
      {extractedCount > 0 && !extractingRef.current && !extraction.styleProfile && (
        <div style={{ padding: '8px 20px', background: 'rgba(124,58,237,0.04)', borderBottom: '1px solid rgba(124,58,237,0.08)', display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, color: '#7c3aed' }}>
          <SparklesIcon style={{ width: 14, height: 14 }} />
          提取完成 (数据已自动聚合)。下一步建议: ①风格分析 → ②模仿生成 → ③导入到项目
        </div>
      )}

      {/* Main body */}
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
              <button key={tab.key} onClick={() => setPreviewTab(tab.key)} style={{
                padding: '5px 12px', borderRadius: '6px 6px 0 0', border: 'none',
                background: previewTab === tab.key ? 'rgba(124,58,237,0.06)' : 'transparent',
                color: previewTab === tab.key ? '#7c3aed' : '#6b5e54', fontSize: 12, cursor: 'pointer',
                fontWeight: previewTab === tab.key ? 600 : 400, display: 'flex', alignItems: 'center', gap: 4,
              }}><tab.icon style={{ width: 13, height: 13 }} />{tab.label}</button>
            ))}
          </div>
          <ScrollArea maxHeight="100%" style={{ flex: 1 }}>
            <div style={{ padding: 10 }}>
              {previewTab === 'chapter' && (!selectedChapter
                ? <div style={{ textAlign: 'center', padding: 40, color: '#9b8e84', fontSize: 12 }}>请从左侧选择章节</div>
                : (
                <div>
                  <h3 style={{ fontSize: 14, fontWeight: 700, color: '#2d2520', marginBottom: 8 }}>{selectedChapter.chapterTitle}</h3>
                  {selectedChapter.chapterSummary && (
                    <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(124,58,237,0.04)', border: '1px solid rgba(124,58,237,0.1)', marginBottom: 10 }}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: '#7c3aed', marginBottom: 4 }}>AI 摘要</div>
                      <p style={{ fontSize: 11, color: '#4a3f38', lineHeight: 1.7, margin: 0 }}>{selectedChapter.chapterSummary}</p>
                    </div>
                  )}
                  <div style={{ fontSize: 15, lineHeight: 2.2, color: '#2d2520', whiteSpace: 'pre-wrap', padding: '10px 14px', borderRadius: 10, background: '#faf9f8', border: '1px solid rgba(0,0,0,0.04)' }}>
                    {selectedChapter.chapterContent}
                  </div>
                </div>
              ))}

              {previewTab === 'characters' && ag && <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{ag.characters.map(c => <div key={c.name} style={{ padding: '10px 12px', borderRadius: 10, background: '#fff', border: '1px solid rgba(0,0,0,0.05)' }}><div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><span style={{ fontSize: 13, fontWeight: 700, color: '#2d2520' }}>{c.name}</span>{c.role && <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, background: 'rgba(124,58,237,0.08)', color: '#7c3aed' }}>{c.role}</span>}<span style={{ fontSize: 9, color: '#9b8e84', marginLeft: 'auto' }}>第{c.firstChapter}-{c.lastChapter}章</span></div>{c.traits.length > 0 && <p style={{ fontSize: 10, color: '#6b5e54', margin: '2px 0' }}>{c.traits.join('、')}</p>}</div>)}</div>}

              {previewTab === 'worldbuilding' && ag && <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{ag.worldbuilding.locations.length > 0 && <div><h4 style={{ fontSize: 12, fontWeight: 700 }}>地点</h4>{ag.worldbuilding.locations.map(l => <div key={l.name} style={{ fontSize: 10, padding: '2px 0' }}><strong>{l.name}</strong>: {l.description}</div>)}</div>}{ag.worldbuilding.factions.length > 0 && <div><h4 style={{ fontSize: 12, fontWeight: 700 }}>势力</h4>{ag.worldbuilding.factions.map(f => <div key={f.name} style={{ fontSize: 10, padding: '2px 0' }}><strong>{f.name}</strong>: {f.description}</div>)}</div>}{ag.powerSystem.levels.length > 0 && <div><h4 style={{ fontSize: 12, fontWeight: 700 }}>等级</h4><div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{ag.powerSystem.levels.map((l: string) => <span key={l} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 8, background: 'rgba(0,0,0,0.03)', color: '#6b5e54', fontWeight: 600 }}>{l}</span>)}</div></div>}</div>}

              {previewTab === 'outline' && <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{extraction.chapters.filter(c => c.extractedAt).map(ch => <div key={ch.chapterId} style={{ padding: '8px 10px', borderRadius: 8, background: '#fff', border: '1px solid rgba(0,0,0,0.04)' }}><div style={{ fontSize: 11, fontWeight: 600, color: '#7c3aed' }}>第{ch.chapterNumber}章: {ch.chapterTitle}</div><p style={{ fontSize: 10, color: '#4a3f38', lineHeight: 1.6, margin: '3px 0 0' }}>{ch.chapterSummary}</p></div>)}</div>}

              {previewTab === 'items' && ag && <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{ag.items.map(item => <div key={item.name} style={{ padding: '8px 10px', borderRadius: 8, background: '#fff', border: '1px solid rgba(0,0,0,0.04)', fontSize: 10 }}><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ fontWeight: 600, color: '#2d2520' }}>{item.name}</span><span style={{ fontSize: 8, padding: '1px 4px', borderRadius: 4, background: 'rgba(245,158,11,0.1)', color: '#f59e0b' }}>{item.type}</span></div></div>)}</div>}

              {previewTab === 'power' && ag && <div>{ag.powerSystem.levels.length > 0 ? <><div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>{ag.powerSystem.levels.map((l: string, i: number) => <span key={l} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 8, background: i === 0 ? 'rgba(22,163,74,0.1)' : i === ag!.powerSystem.levels.length - 1 ? 'rgba(124,58,237,0.1)' : 'rgba(0,0,0,0.03)', color: i === 0 ? '#16a34a' : i === ag!.powerSystem.levels.length - 1 ? '#7c3aed' : '#6b5e54', fontWeight: 600 }}>{l}</span>)}</div></> : <div style={{ padding: 32, fontSize: 12, color: '#9b8e84', textAlign: 'center' }}>未检测到</div>}</div>}

              {previewTab === 'generate' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <Button size="sm" onClick={() => handleGenerate('outline')} disabled={genLoading || !extraction.aggregated} icon={<SparklesIcon style={{ width: 14, height: 14 }} />}>生成新大纲</Button>
                    <Button size="sm" onClick={() => handleGenerate('details')} disabled={genLoading || !extraction.generatedNovel?.outline} icon={<SparklesIcon style={{ width: 14, height: 14 }} />}>生成新细纲</Button>
                    <Button size="sm" onClick={() => handleGenerate('characters')} disabled={genLoading || !extraction.aggregated} icon={<SparklesIcon style={{ width: 14, height: 14 }} />}>生成新角色</Button>
                    <Button size="sm" onClick={() => handleGenerate('worldbuilding')} disabled={genLoading || !extraction.aggregated} icon={<SparklesIcon style={{ width: 14, height: 14 }} />}>生成新世界观</Button>
                  </div>
                  {/* Current generation preview */}
                  {genPreview && <div><div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}><span style={{ fontSize: 12, fontWeight: 600 }}>{genLoading ? '生成中...' : '预览'}</span><Button size="sm" onClick={handleSaveGenerated}>保存</Button></div><div style={{ fontSize: 12, lineHeight: 1.8, whiteSpace: 'pre-wrap', padding: 12, borderRadius: 10, background: '#faf9f8', border: '1px solid rgba(0,0,0,0.04)', maxHeight: 600, overflow: 'auto' }}>{genPreview}</div></div>}
                  {/* Saved generated content */}
                  {extraction.generatedNovel && !genPreview && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {extraction.generatedNovel.outline && (
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: '#16a34a', marginBottom: 4 }}>✓ 已保存的大纲</div>
                          <div style={{ fontSize: 12, lineHeight: 1.8, whiteSpace: 'pre-wrap', padding: 10, borderRadius: 10, background: '#faf9f8', border: '1px solid rgba(0,0,0,0.04)', maxHeight: 400, overflow: 'auto' }}>{extraction.generatedNovel.outline.slice(0, 3000)}{extraction.generatedNovel.outline.length > 3000 && '...'}</div>
                        </div>
                      )}
                      {extraction.generatedNovel.detailedOutlines.length > 0 && (
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: '#16a34a', marginBottom: 4 }}>✓ 已保存的细纲 ({extraction.generatedNovel.detailedOutlines.length}章)</div>
                          <div style={{ fontSize: 11, color: '#4a3f38', maxHeight: 300, overflow: 'auto' }}>
                            {extraction.generatedNovel.detailedOutlines.slice(0, 10).map(d => (
                              <div key={d.chapterNumber} style={{ padding: '4px 0', borderBottom: '1px solid rgba(0,0,0,0.03)' }}>
                                第{d.chapterNumber}章 {d.title}: {d.summary?.slice(0, 80)}...
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {extraction.generatedNovel.characters.length > 0 && (
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: '#16a34a', marginBottom: 4 }}>✓ 已保存的角色 ({extraction.generatedNovel.characters.length}个)</div>
                        </div>
                      )}
                      {extraction.generatedNovel.worldbuilding && (
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: '#16a34a', marginBottom: 4 }}>✓ 已保存的世界观</div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </ScrollArea>
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

      {/* Dimension Selection Dialog */}
      {showDimDialog && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowDimDialog(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 20, padding: 24, width: 420, boxShadow: '0 16px 48px rgba(0,0,0,0.15)' }}>
            <h3 style={{ fontSize: 17, fontWeight: 700, color: '#2d2520', marginBottom: 16 }}>选择提取维度</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
              {[
                { key: 'characters', label: '角色提取', desc: '姓名/性格/关系/弧线' },
                { key: 'worldbuilding', label: '世界观测', desc: '地点/势力/规则/历史' },
                { key: 'items', label: '道具物品', desc: '法宝/丹药/武器/能力' },
                { key: 'powerSystem', label: '等级体系', desc: '境界/段位/晋升条件' },
                { key: 'chapterSummary', label: '章节摘要', desc: '150-300字详细剧情摘要' },
                { key: 'events', label: '关键事件', desc: '3-5个本章关键事件点' },
                { key: 'foreshadowing', label: '伏笔追踪', desc: '埋设/回收/相关章节' },
                { key: 'emotionalTone', label: '情绪基调', desc: '紧张/温馨/悲伤/热血' },
                { key: 'erotic', label: '情色分析', desc: 'dom-sub/性爱流程/体液/权力关系' },
              ].map(d => (
                <label key={d.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 8, cursor: 'pointer', background: extractDims.has(d.key) ? 'rgba(124,58,237,0.04)' : 'transparent', border: extractDims.has(d.key) ? '1px solid rgba(124,58,237,0.15)' : '1px solid transparent' }}>
                  <input type="checkbox" checked={extractDims.has(d.key)} onChange={() => { const n = new Set(extractDims); n.has(d.key) ? n.delete(d.key) : n.add(d.key); setExtractDims(n) }} style={{ width: 14, height: 14, accentColor: '#7c3aed' }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#2d2520' }}>{d.label}</span>
                  <span style={{ fontSize: 10, color: '#9b8e84', marginLeft: 'auto' }}>{d.desc}</span>
                </label>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
              <button onClick={() => setExtractDims(new Set(['characters','worldbuilding','items','powerSystem','chapterSummary','events','foreshadowing','emotionalTone','erotic']))} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: '#7c3aed' }}>全选</button>
              <button onClick={() => setExtractDims(new Set())} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: '#7c3aed' }}>清空</button>
              <button onClick={() => setExtractDims(new Set(['characters','worldbuilding','chapterSummary','events','emotionalTone']))} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: '#7c3aed' }}>城市/恋爱</button>
              <button onClick={() => setExtractDims(new Set(['characters','worldbuilding','items','powerSystem','chapterSummary','events','foreshadowing']))} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: '#7c3aed' }}>修仙/玄幻</button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Button variant="secondary" size="sm" onClick={() => setShowDimDialog(false)}>取消</Button>
              <Button size="sm" onClick={() => { setShowDimDialog(false); handleStartExtract() }} icon={<PlayIcon style={{ width: 14, height: 14 }} />}>
                开始提取 ({extractIds.size}章 · {extractDims.size}维)
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Style Dimension Dialog */}
      {showStyleDimDialog && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowStyleDimDialog(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 20, padding: 24, width: 500, boxShadow: '0 16px 48px rgba(0,0,0,0.15)' }}>
            <h3 style={{ fontSize: 17, fontWeight: 700, color: '#2d2520', marginBottom: 16 }}>选择风格分析维度</h3>
            {['基础文风', '进阶技法', '情色专属', '类型专属'].map(cat => {
              const dimsInCat = Object.entries(DIMENSION_META).filter(([, v]) => v.category === cat)
              if (dimsInCat.length === 0) return null
              return (
                <div key={cat} style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#9b8e84', marginBottom: 4 }}>{cat}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {dimsInCat.map(([key, meta]) => (
                      <label key={key} style={{
                        display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderRadius: 6, cursor: 'pointer',
                        background: styleDims.has(key) ? 'rgba(124,58,237,0.06)' : 'transparent',
                        border: styleDims.has(key) ? '1px solid rgba(124,58,237,0.2)' : '1px solid rgba(0,0,0,0.06)',
                        fontSize: 10,
                      }}>
                        <input type="checkbox" checked={styleDims.has(key)} onChange={() => { const n = new Set(styleDims); n.has(key) ? n.delete(key) : n.add(key); setStyleDims(n) }} style={{ width: 12, height: 12, accentColor: '#7c3aed' }} />
                        {meta.label}
                      </label>
                    ))}
                  </div>
                </div>
              )
            })}
            <div style={{ display: 'flex', gap: 6, marginBottom: 16, marginTop: 8 }}>
              <button onClick={() => setStyleDims(new Set(Object.keys(DIMENSION_META)))} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: '#7c3aed' }}>全选</button>
              <button onClick={() => setStyleDims(new Set(NOVEL_TYPE_DIMS['通用']))} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: '#7c3aed' }}>基础</button>
              <button onClick={() => setStyleDims(new Set(NOVEL_TYPE_DIMS[novelType] || NOVEL_TYPE_DIMS['通用']))} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: '#7c3aed' }}>按类型推荐</button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Button variant="secondary" size="sm" onClick={() => setShowStyleDimDialog(false)}>取消</Button>
              <Button size="sm" onClick={() => { setShowStyleDimDialog(false); handleStyleAnalyze() }} icon={<SparklesIcon style={{ width: 14, height: 14 }} />}>
                开始分析 ({[...styleDims].length}维 · {styleChapterIds.size || 20}章)
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
