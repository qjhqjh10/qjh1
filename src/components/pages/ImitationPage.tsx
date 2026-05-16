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
import RichTextEditor from '@/components/common/RichTextEditor'
import EroticSceneModal from '@/components/common/EroticSceneModal'
import NovelSceneModal from '@/components/common/NovelSceneModal'
import { logError } from '@/utils/logger'
import { countChineseWords, formatWordCount } from '@/utils/textUtils'
import type { NovelExtraction, AggregatedResult, EroticSceneConfig } from '@/types/story'
import { DIMENSION_META, NOVEL_TYPE_DIMS } from '@/types/story'
import type { Character } from '@/types/character'
import { EMPTY_CHARACTER } from '@/types/character'
import {
  SparklesIcon, TrashIcon, DocumentTextIcon, UserGroupIcon, GlobeAltIcon,
  LightBulbIcon, PlayIcon, StopIcon, FolderOpenIcon,
  ArrowLeftIcon, BookOpenIcon, FireIcon, ListBulletIcon, CheckCircleIcon,
} from '@heroicons/react/24/outline'

type ViewMode = 'typeSelect' | 'library' | 'detail'
type NovelType = 'general' | 'urban' | 'cultivation' | 'martial' | 'romance' | 'ancient' | 'mystery' | 'historical' | 'transmigration' | 'scifi' | 'erotic'
type Step = 'import' | 'extracting' | 'style' | 'generating' | 'completed'
type PreviewTab = 'chapter' | 'srcOutline' | 'srcDetails' | 'outline' | 'details' | 'timeline' | 'write' | 'generate'
type DimKey = 'characters' | 'worldbuilding' | 'items' | 'powerSystem' | 'foreshadowing' | 'emotionCurve' | 'erotic'

const TABS: { key: PreviewTab; label: string; icon: typeof DocumentTextIcon }[] = [
  { key: 'chapter', label: '章节', icon: BookOpenIcon },
  { key: 'srcOutline', label: '原书大纲', icon: DocumentTextIcon },
  { key: 'srcDetails', label: '原书细纲', icon: ListBulletIcon },
  { key: 'generate', label: '生成', icon: SparklesIcon },
  { key: 'outline', label: '大纲', icon: DocumentTextIcon },
  { key: 'details', label: '细纲', icon: ListBulletIcon },
  { key: 'timeline', label: '时间线', icon: LightBulbIcon },
  { key: 'write', label: '章节创作', icon: BookOpenIcon },
]

const STATUS_LABELS: Record<string, string> = { draft: '未开始', extracting: '提取中', aggregated: '已聚合', completed: '已完成' }
const STATUS_COLORS: Record<string, string> = { draft: '#9b8e84', extracting: '#f59e0b', aggregated: '#3b82f6', completed: '#16a34a' }

const TYPE_LABELS: Record<string, string> = { general: '通用', urban: '都市', cultivation: '修仙', martial: '武侠', romance: '恋爱', ancient: '古风', mystery: '悬疑', historical: '历史', transmigration: '穿越', scifi: '科幻', erotic: '情色' }

function normalizeRole(role: string): string {
  const r = (role || '').trim()
  // New prompt: AI outputs exact 6 categories
  if (['男主','女主','男配','女配','反派'].includes(r)) return r
  // Backward compat for old extraction data
  if (r.includes('男主') || r === '主角') return '男主'
  if (r.includes('女主')) return '女主'
  if (r.includes('男配') || r.includes('兄弟') || r.includes('朋友')) return '男配'
  if (r.includes('女配') || r.includes('姐妹')) return '女配'
  if (r.includes('反派') || r.includes('敌人') || r.includes('对手')) return '反派'
  return '其他'
}

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
  const [outlineGenerated, setOutlineGenerated] = useState<Record<string, boolean>>({})
  const [outlineResults, setOutlineResults] = useState<Record<string, string>>({})
  const [chapterWriteView, setChapterWriteView] = useState<string | null>(null)
  const [chapterContents, setChapterContents] = useState<Record<string, string>>({})
  const [writeContent, setWriteContent] = useState('')
  const [writeLoading, setWriteLoading] = useState(false)
  const [writeGenOverlay, setWriteGenOverlay] = useState(false)
  const [writeGenWordCount, setWriteGenWordCount] = useState(0)
  const writeGenAbortRef = useRef<(() => void) | null>(null)
  const [showWriteErotic, setShowWriteErotic] = useState(false)
  const [showWriteNovel, setShowWriteNovel] = useState(false)
  const [detailsResults, setDetailsResults] = useState<string>('')
  const [detailGenResults, setDetailGenResults] = useState<any[]>([])
  const [detailGenRunning, setDetailGenRunning] = useState(false)
  const [detailGenCurrent, setDetailGenCurrent] = useState(0)
  const detailGenAbortRef = useRef(false)
  const [toast, setToast] = useState('')
  const [dimSubTab, setDimSubTab] = useState<DimKey>('characters')
  const [showDimDialog, setShowDimDialog] = useState(false)
  const [extractDims, setExtractDims] = useState<Set<string>>(new Set())
  const [showStyleDimDialog, setShowStyleDimDialog] = useState(false)
  const [styleDims, setStyleDims] = useState<Set<string>>(new Set())
  const abortRef = useRef(false)
  const extractingRef = useRef(false)
  const pausedRef = useRef(false)

  useEffect(() => { loadProjects() }, [])

  // Inject imitation data into Zustand store when write tab selected (for modals)
  useEffect(() => {
    if (previewTab !== 'write' || !outlineResults.characters) return
    try {
      const chars = JSON.parse(outlineResults.characters)
      if (Array.isArray(chars)) {
        const mapped: Character[] = chars.map((c: any) => ({ ...EMPTY_CHARACTER, id: nanoid(8), name: c.name || '', role: (['男主','女主','男配','女配','反派','其他'].includes(c.role) ? c.role : '其他') as Character['role'], personality: Array.isArray(c.traits) ? c.traits.join('、') : (c.traits || ''), background: c.background || '', importance: 50 }))
        setCharacters(mapped)
      }
    } catch {}
    if (outlineResults.worldbuilding) setWorldbuildingContent(outlineResults.worldbuilding)
    if (outlineResults.powerSystem) setOutlineContent('等级: ' + outlineResults.powerSystem)
  }, [previewTab, outlineResults.characters])

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
        styleProfile: null, pacingTemplate: null, eventPattern: null, progressionRhythm: null, characterArchetype: null, emotionCurve: null, generatedNovel: null, outlineResults: {},
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
      // Restore saved outline results
      const saved = (ext as any).outlineResults || {}
      setOutlineResults(saved)
      const gen: Record<string, boolean> = {}
      Object.keys(saved).forEach(k => { gen[k] = true })
      setOutlineGenerated(gen)
      // Restore saved details
      if ((ext as any).detailsResults) setDetailsResults((ext as any).detailsResults)
      if ((ext as any).detailGenResults) setDetailGenResults((ext as any).detailGenResults)
      if ((ext as any).chapterContents) setChapterContents((ext as any).chapterContents)
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
          const erNames = [...new Set(erChs.flatMap(c => c.erotic?.characterRoles?.map((cr: any) => cr.name) || []))]
          const allChars = ag.characters.map(c => c.name).filter(n => !erNames.includes(n)).slice(0, 10)
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
          extractionService.saveProject({ ...extraction, outlineResults: updated, updatedAt: new Date().toISOString() })
        }
        return updated
      })
      setGenPreview(''); setGenType(null)
      const labels: Record<string,string> = {characters:'角色',worldbuilding:'世界观',items:'道具',powerSystem:'等级',foreshadowing:'伏笔',emotionCurve:'情绪',erotic:'情色'}
      setToast(`${labels[dimKey] || dimKey}模仿完成`)
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
    const results: any[] = [...detailGenResults.filter((d: any) => extractIds.has(extraction.chapters.find(c => c.chapterNumber === d.chapterNumber)?.chapterId || ''))]
    const or = outlineResults

    for (let i = 0; i < chs.length; i++) {
      if (detailGenAbortRef.current) { setDetailGenRunning(false); return }
      const ch = chs[i]
      // Skip if already generated
      if (results.find((d: any) => d.chapterNumber === ch.chapterNumber)) continue
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
      if (ch.characters.length > 0) parts.push(`出场角色: ${ch.characters.map((c: any) => c.name || c).join(', ')}`)
      if (ch.events.length > 0) parts.push(`事件: ${ch.events.join(' · ')}`)
      parts.push(`情绪: ${ch.emotionalTone || '无'}`)
      if (ch.powerSystem.length > 0) parts.push(`等级提及: ${ch.powerSystem.map((p: any) => p.term).join(', ')}`)
      if (ch.items.length > 0) parts.push(`道具提及: ${ch.items.map((it: any) => it.name).join(', ')}`)
      // Erotic reference
      if (ch.erotic) {
        if (ch.erotic.powerDynamics) parts.push(`情色权力关系: ${ch.erotic.powerDynamics}`)
        if (ch.erotic.characterRoles?.length > 0) parts.push(`情色角色: ${ch.erotic.characterRoles.map((cr: any) => `${cr.name}(${cr.domSub}/${cr.bodyState})`).join(', ')}`)
        if (ch.erotic.sceneFlow?.length > 0) parts.push(`情色流程: ${ch.erotic.sceneFlow.map((sf: any) => sf.phase).join(' → ')}`)
        if (ch.erotic.degradationPatterns?.length > 0) parts.push(`羞辱模式: ${ch.erotic.degradationPatterns.join('、')}`)
      }

      parts.push(`\n要求: 为新书第${ch.chapterNumber}章生成细纲JSON:\n{"chapterNumber":${ch.chapterNumber},"title":"","summary":"150-300字","charactersAppearing":["角色(身份)"],"levelChange":"","itemsUsed":[],"location":"","foreshadowingOps":[],"keyEvents":[],"emotionalTone":"","eroticScene":"本章情色剧情设计(如有,含角色状态/流程/尺度)"}\n角色从新列表中选, 道具/等级/世界观使用新设定中的名称, 剧情原创。${ch.erotic ? '如果原作本章有情色内容,请为新书对应章设计情色场景(eroticScene字段),使用新角色的情色属性。' : ''}只输出JSON。`)

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
      extractionService.saveProject({ ...extraction, detailsResults: json, detailGenResults: results, updatedAt: new Date().toISOString() })
    }
    setToast(`细纲模仿完成: ${results.length}章`)
    setTimeout(() => setToast(''), 5000)
  }

  // ---- Generate (legacy, kept for type support) ----
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
    const or = outlineResults
    const imported: string[] = []

    // 1. Generated characters → characters/*.json
    if (or.characters) {
      const existing = await loadCharacters(pp)
      const existingNames = new Set(existing.map(c => c.name))
      try {
        const chars = JSON.parse(or.characters)
        if (Array.isArray(chars)) {
          let count = 0
          for (const c of chars) {
            if (!c.name || existingNames.has(c.name)) continue
            await saveCharacter(pp, { ...EMPTY_CHARACTER, id: nanoid(8), name: c.name, role: (['男主','女主','男配','女配','反派','其他'].includes(c.role) ? c.role : '其他') as Character['role'], personality: Array.isArray(c.traits) ? c.traits.join('、') : (c.traits || ''), background: c.background || '', importance: 50 })
            existingNames.add(c.name); count++
          }
          if (count > 0) imported.push(`${count}个角色`)
        }
      } catch { /* parse failed, characters stored as text */ }
    }
    // Fallback: aggregated characters
    if (!or.characters) {
      const existing = await loadCharacters(pp)
      const existingNames = new Set(existing.map(c => c.name))
      for (const ac of ag.characters) {
        if (existingNames.has(ac.name)) continue
        await saveCharacter(pp, { ...EMPTY_CHARACTER, id: nanoid(8), name: ac.name, role: (['男主','女主','男配','女配','反派','其他'].includes(ac.role) ? ac.role : '其他') as Character['role'], personality: ac.traits.join('、'), appearance: ac.appearance, background: ac.background, importance: 50 })
      }
    }
    setCharacters(await loadCharacters(pp))

    // 2. Worldbuilding → worldbuilding.txt
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
    if (wbContent) { await fileService.write(`${pp}/worldbuilding/worldbuilding.txt`, wbContent); setWorldbuildingContent(wbContent); imported.push('世界观') }

    // 3. Outline → outline.txt (from all dimension results as a combined view)
    const outlineParts: string[] = []
    if (or.characters) outlineParts.push('## 角色\n\n' + or.characters)
    if (or.worldbuilding) outlineParts.push('## 世界观\n\n' + or.worldbuilding)
    if (or.items) outlineParts.push('## 道具\n\n' + or.items)
    if (or.powerSystem) outlineParts.push('## 等级体系\n\n' + or.powerSystem)
    if (or.foreshadowing) outlineParts.push('## 伏笔结构\n\n' + or.foreshadowing)
    if (or.emotionCurve) outlineParts.push('## 情绪模板\n\n' + or.emotionCurve)
    if (outlineParts.length > 0) {
      const outline = `# 生成的小说设定\n\n${outlineParts.join('\n\n')}`
      await fileService.write(`${pp}/outline/outline.txt`, outline)
      setOutlineContent(outline)
      imported.push('大纲')
    }

    // 4. Detailed outlines → detailed_outline/*.json
    const detResult = detailsResults || or.characters // use stored details or check if we have details
    if (detailsResults) {
      try {
        const details = JSON.parse(detailsResults)
        if (Array.isArray(details) && details.length > 0) {
          await fileService.ensureDir(`${pp}/detailed_outline`)
          for (const d of details) {
            if (!d.chapterNumber) continue
            const desc = (d.summary || '') + '\n\n出场角色:' + (d.charactersAppearing || []).join(', ') + '\n关键事件:' + (d.keyEvents || []).join(' · ')
            await saveDetailedChapter(pp, { id: `ch_${d.chapterNumber}`, title: d.title || `第${d.chapterNumber}章`, description: desc, summary: d.summary || '', order: d.chapterNumber - 1, status: 'outline' })
          }
          imported.push(`${details.length}章细纲`)
        }
      } catch { /* parse failed */ }
    }

    // 5. Foreshadowing → outline_meta.json
    const fs = or.foreshadowing
    if (fs || ag.foreshadowing.length > 0) {
      const metaPath = `${pp}/outline/outline_meta.json`
      let existingMeta: any = { foreshadowing: [], plotThreads: [], updatedAt: '' }
      try { const raw = await fileService.read(metaPath); if (raw) existingMeta = JSON.parse(raw) } catch { /* */ }
      if (fs) {
        try {
          const fsArr = JSON.parse(fs)
          if (Array.isArray(fsArr)) {
            existingMeta.foreshadowing = [...(existingMeta.foreshadowing || []), ...fsArr.map((f: any) => ({ id: `fs_${nanoid(6)}`, description: f.description || f, plantChapterId: String(f.plantChapter || 1), payoffChapterId: f.payoffChapter ? String(f.payoffChapter) : '', status: f.status || 'planted' }))]
          }
        } catch { /* raw text */ }
      }
      if (!fs && ag.foreshadowing.length > 0) {
        existingMeta.foreshadowing = [...(existingMeta.foreshadowing || []), ...ag.foreshadowing.map(f => ({ id: `fs_${nanoid(6)}`, description: f.description, plantChapterId: String(f.plantChapter), payoffChapterId: f.payoffChapter ? String(f.payoffChapter) : '', status: f.status }))]
      }
      existingMeta.updatedAt = new Date().toISOString()
      await fileService.ensureDir(`${pp}/outline`); await fileService.write(metaPath, JSON.stringify(existingMeta, null, 2))
      imported.push(`${existingMeta.foreshadowing.length}条伏笔`)
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
      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', top: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 500, padding: '10px 24px', borderRadius: 12, background: '#16a34a', color: '#fff', fontSize: 13, fontWeight: 600, boxShadow: '0 8px 24px rgba(0,0,0,0.2)', pointerEvents: 'none' }}>
          ✓ {toast}
        </div>
      )}
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
          {extractedCount > 0 && !extractingRef.current && (
            <Button size="sm" variant="ghost" onClick={() => setExtractIds(new Set(extraction.chapters.filter(c => !c.extractedAt).map(c => c.chapterId)))}>提取剩余</Button>
          )}
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
      </div>

      {/* Next step guide after extraction */}
      {extractedCount > 0 && !extractingRef.current && !extraction.styleProfile && (
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
              <button key={tab.key} onClick={() => setPreviewTab(tab.key)} style={{
                padding: '5px 12px', borderRadius: '6px 6px 0 0', border: 'none',
                background: previewTab === tab.key ? 'rgba(124,58,237,0.06)' : 'transparent',
                color: previewTab === tab.key ? '#7c3aed' : '#6b5e54', fontSize: 12, cursor: 'pointer',
                fontWeight: previewTab === tab.key ? 600 : 400, display: 'flex', alignItems: 'center', gap: 4,
              }}><tab.icon style={{ width: 13, height: 13 }} />{tab.label}</button>
            ))}
          </div>
          {/* Dim switcher for 大纲 tabs (outside scroll area) */}
          {(previewTab === 'srcOutline' || previewTab === 'outline') && (
            <div style={{ display: 'flex', gap: 4, padding: '4px 14px', borderBottom: '1px solid rgba(0,0,0,0.04)', flexWrap: 'wrap', flexShrink: 0 }}>
              {(['characters','worldbuilding','items','powerSystem','foreshadowing','emotionCurve',...(novelType === 'erotic' ? ['erotic' as DimKey] : [])] as DimKey[]).map(dk => (
                <button key={dk} onClick={() => setDimSubTab(dk)} style={{
                  padding: '3px 8px', borderRadius: 6, border: 'none', fontSize: 10, cursor: 'pointer',
                  background: dimSubTab === dk ? 'rgba(124,58,237,0.08)' : 'transparent',
                  color: dimSubTab === dk ? '#7c3aed' : '#6b5e54', fontWeight: dimSubTab === dk ? 600 : 400,
                }}>{{characters:'角色',worldbuilding:'世界观',items:'道具',powerSystem:'等级',foreshadowing:'伏笔',emotionCurve:'情绪',erotic:'情色'}[dk]}</button>
              ))}
            </div>
          )}
          {previewTab === 'chapter' && (
            <ScrollArea maxHeight="100%" style={{ flex: 1 }}>
              <div style={{ padding: 10 }}>
                {!selectedChapter
                  ? <div style={{ textAlign: 'center', padding: 40, color: '#9b8e84', fontSize: 12 }}>请从左侧选择章节</div>
                  : <div>
                    <h3 style={{ fontSize: 14, fontWeight: 700, color: '#2d2520', marginBottom: 8 }}>{selectedChapter.chapterTitle}</h3>
                    {selectedChapter.chapterSummary && (
                      <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(124,58,237,0.04)', border: '1px solid rgba(124,58,237,0.1)', marginBottom: 10 }}>
                        <div style={{ fontSize: 10, fontWeight: 600, color: '#7c3aed', marginBottom: 4 }}>AI 摘要</div>
                        <p style={{ fontSize: 11, color: '#4a3f38', lineHeight: 1.7, margin: 0 }}>{selectedChapter.chapterSummary}</p>
                      </div>
                    )}
                    <div style={{ fontSize: 15, lineHeight: 2.2, color: '#2d2520', whiteSpace: 'pre-wrap', padding: '10px 14px', borderRadius: 10, background: '#faf9f8', border: '1px solid rgba(0,0,0,0.04)' }}>{selectedChapter.chapterContent}</div>
                  </div>
                }
              </div>
            </ScrollArea>
          )}

{/* === 原书大纲 & 大纲 Tab === */}
          {(previewTab === 'srcOutline' || previewTab === 'outline') && (
            <ScrollArea maxHeight="100%" style={{ flex: 1 }}>
              <div style={{ padding: 10 }}>
                {(() => {
                  const isSrc = previewTab === 'srcOutline'
                  const isGen = previewTab === 'outline'
                  if (isGen && !outlineResults[dimSubTab]) return <div style={{ textAlign: 'center', padding: 40, fontSize: 12, color: '#9b8e84' }}>该维度尚未生成。切换到「生成」Tab → 大纲模仿 → 点击对应维度按钮进行模仿。</div>

                  // Characters
                  if (dimSubTab === 'characters') {
                    const srcChars = ag?.characters || []
                    let genChars: any[] = []
                    try { const p = JSON.parse(outlineResults.characters || '[]'); if (Array.isArray(p)) genChars = p } catch {}
                    const chars = isSrc ? srcChars : genChars
                    const groups: Record<string, any[]> = { '男主': [], '女主': [], '男配': [], '女配': [], '反派': [], '其他': [] }
                    chars.forEach((c: any) => { const r = normalizeRole(c.role); groups[r].push(c) })
                    return <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {Object.entries(groups).filter(([, list]) => list.length > 0).map(([role, list]) => (
                        <div key={role}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#7c3aed', marginBottom: 4 }}>{role} ({list.length})</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {list.map((c: any, idx: number) => (
                              <div key={c.name || idx} style={{ padding: '10px 14px', borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,0.06)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                                  <span style={{ fontSize: 13, fontWeight: 700, color: '#2d2520' }}>{c.name}</span>
                                  <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: 'rgba(124,58,237,0.1)', color: '#7c3aed' }}>{role}</span>
                                  {isSrc && <span style={{ fontSize: 9, color: '#9b8e84', marginLeft: 'auto' }}>第{c.firstChapter}-{c.lastChapter}章</span>}
                                </div>
                                {c.traits && <p style={{ fontSize: 10, color: '#6b5e54', margin: '2px 0' }}>{Array.isArray(c.traits) ? c.traits.join('、') : c.traits}</p>}
                                {c.background && <p style={{ fontSize: 9, color: '#9b8e84', margin: 0 }}>{c.background}</p>}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  }

                  // Worldbuilding
                  if (dimSubTab === 'worldbuilding') {
                    if (isSrc && ag) return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {ag.worldbuilding.locations.length > 0 && <div><div style={{ fontSize: 11, fontWeight: 700, color: '#7c3aed', marginBottom: 4 }}>地点 ({ag.worldbuilding.locations.length})</div><div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{ag.worldbuilding.locations.map(l => <div key={l.name} style={{ padding: '8px 12px', borderRadius: 10, background: '#fff', border: '1px solid rgba(0,0,0,0.04)', fontSize: 11 }}><strong>{l.name}</strong>: {l.description}</div>)}</div></div>}
                        {ag.worldbuilding.factions.length > 0 && <div><div style={{ fontSize: 11, fontWeight: 700, color: '#7c3aed', marginBottom: 4 }}>势力 ({ag.worldbuilding.factions.length})</div><div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{ag.worldbuilding.factions.map(f => <div key={f.name} style={{ padding: '8px 12px', borderRadius: 10, background: '#fff', border: '1px solid rgba(0,0,0,0.04)', fontSize: 11 }}><strong>{f.name}</strong>: {f.description}</div>)}</div></div>}
                      </div>
                    )
                    // Try card display for generated data
                    let genWb: any = null
                    try { genWb = JSON.parse(outlineResults.worldbuilding || '') } catch {}
                    if (genWb?.locations || genWb?.factions) return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {genWb.locations?.length > 0 && <div><div style={{ fontSize: 11, fontWeight: 700, color: '#7c3aed', marginBottom: 4 }}>地点 ({genWb.locations.length})</div><div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{genWb.locations.map((l: any) => <div key={l.name} style={{ padding: '8px 12px', borderRadius: 10, background: '#fff', border: '1px solid rgba(0,0,0,0.04)', fontSize: 11 }}><strong>{l.name}</strong>: {l.description}</div>)}</div></div>}
                        {genWb.factions?.length > 0 && <div><div style={{ fontSize: 11, fontWeight: 700, color: '#7c3aed', marginBottom: 4 }}>势力 ({genWb.factions.length})</div><div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{genWb.factions.map((f: any) => <div key={f.name} style={{ padding: '8px 12px', borderRadius: 10, background: '#fff', border: '1px solid rgba(0,0,0,0.04)', fontSize: 11 }}><strong>{f.name}</strong>: {f.description}</div>)}</div></div>}
                      </div>
                    )
                    return <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', color: '#4a3f38' }}>{outlineResults.worldbuilding || ''}</pre>
                  }

                  // Items
                  if (dimSubTab === 'items') {
                    if (isSrc && ag) return <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{ag.items.map(i => <div key={i.name} style={{ padding: '10px 14px', borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,0.06)' }}><div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><span style={{ fontSize: 12, fontWeight: 700, color: '#2d2520' }}>{i.name}</span><span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: 'rgba(245,158,11,0.1)', color: '#e67e00' }}>{i.type}</span>{i.grade && <span style={{ fontSize: 9, color: '#9b8e84' }}>{i.grade}</span>}</div>{i.ability && <p style={{ fontSize: 10, color: '#6b5e54', margin: 0 }}>{i.ability}</p>}</div>)}</div>
                    let genItems: any[] = []
                    try { const p = JSON.parse(outlineResults.items || '[]'); if (Array.isArray(p)) genItems = p } catch {}
                    if (genItems.length > 0) return <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{genItems.map((i: any) => <div key={i.name} style={{ padding: '10px 14px', borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,0.06)' }}><div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><span style={{ fontSize: 12, fontWeight: 700, color: '#2d2520' }}>{i.name}</span><span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: 'rgba(245,158,11,0.1)', color: '#e67e00' }}>{i.type}</span>{i.grade && <span style={{ fontSize: 9, color: '#9b8e84' }}>{i.grade}</span>}</div>{i.ability && <p style={{ fontSize: 10, color: '#6b5e54', margin: 0 }}>{i.ability}</p>}</div>)}</div>
                    return <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', color: '#4a3f38' }}>{outlineResults.items || ''}</pre>
                  }

                  // Power System
                  if (dimSubTab === 'powerSystem') {
                    if (isSrc && ag) return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {ag.powerSystem.levels.map((l: string, i: number) => (
                          <div key={l} style={{ padding: '10px 14px', borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontSize: 20, fontWeight: 800, color: i === 0 ? '#16a34a' : i === ag!.powerSystem.levels.length - 1 ? '#7c3aed' : '#3b82f6', minWidth: 36, textAlign: 'center' }}>{i + 1}</span>
                            <div><span style={{ fontSize: 13, fontWeight: 700, color: '#2d2520' }}>{l}</span></div>
                          </div>
                        ))}
                      </div>
                    )
                    let genPs: any = null
                    try { genPs = JSON.parse(outlineResults.powerSystem || '') } catch {}
                    if (genPs?.levels) return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {genPs.levels.map((l: string, i: number) => (
                          <div key={l} style={{ padding: '10px 14px', borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontSize: 20, fontWeight: 800, color: i === 0 ? '#16a34a' : i === genPs!.levels.length - 1 ? '#7c3aed' : '#3b82f6', minWidth: 36, textAlign: 'center' }}>{i + 1}</span>
                            <div><span style={{ fontSize: 13, fontWeight: 700, color: '#2d2520' }}>{l}</span></div>
                          </div>
                        ))}
                      </div>
                    )
                    return <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', color: '#4a3f38' }}>{outlineResults.powerSystem || ''}</pre>
                  }

                  // Foreshadowing
                  if (dimSubTab === 'foreshadowing') {
                    if (isSrc && ag) return <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{ag.foreshadowing.map(f => (
                      <div key={f.description} style={{ padding: '10px 14px', borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', fontSize: 11 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                          <span style={{ fontSize: 9, padding: '2px 8px', borderRadius: 6, background: f.status === 'resolved' ? 'rgba(22,163,74,0.1)' : 'rgba(245,158,11,0.1)', color: f.status === 'resolved' ? '#16a34a' : '#f59e0b', fontWeight: 600 }}>{f.status === 'resolved' ? '已回收' : '已埋'}</span>
                          <span style={{ color: '#9b8e84', fontSize: 10 }}>第{f.plantChapter}章{f.payoffChapter ? ` → 第${f.payoffChapter}章` : ''}</span>
                        </div>
                        <p style={{ color: '#4a3f38', margin: 0 }}>{f.description}</p>
                      </div>
                    ))}</div>
                    let genFs: any[] = []
                    try { const p = JSON.parse(outlineResults.foreshadowing || '[]'); if (Array.isArray(p)) genFs = p } catch {}
                    if (genFs.length > 0) return <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{genFs.map((f: any) => (
                      <div key={f.description} style={{ padding: '10px 14px', borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', fontSize: 11 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                          <span style={{ fontSize: 9, padding: '2px 8px', borderRadius: 6, background: f.status === 'resolved' ? 'rgba(22,163,74,0.1)' : 'rgba(245,158,11,0.1)', color: f.status === 'resolved' ? '#16a34a' : '#f59e0b', fontWeight: 600 }}>{f.status === 'resolved' ? '已回收' : '已埋'}</span>
                          <span style={{ color: '#9b8e84', fontSize: 10 }}>{f.plantChapter ? `第${f.plantChapter}章` : ''}{f.payoffChapter ? ` → 第${f.payoffChapter}章` : ''}</span>
                        </div>
                        <p style={{ color: '#4a3f38', margin: 0 }}>{f.description}</p>
                      </div>
                    ))}</div>
                    return <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', color: '#4a3f38' }}>{outlineResults.foreshadowing || ''}</pre>
                  }

                  // Emotion Curve
                  if (dimSubTab === 'emotionCurve') {
                    let genEm: any[] = []
                    if (!isSrc) { try { const p = JSON.parse(outlineResults.emotionCurve || '[]'); genEm = Array.isArray(p) ? p : [] } catch {} }
                    if (genEm.length > 0) return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {genEm.map((s: any, i: number) => (
                          <div key={i} style={{ padding: '10px 14px', borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', fontSize: 11, display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontSize: 9, padding: '2px 8px', borderRadius: 6, background: /热血|高潮|激动/.test(s.dominantEmotion || '') ? 'rgba(220,38,38,0.1)' : /压抑|悲伤|恐惧/.test(s.dominantEmotion || '') ? 'rgba(59,130,246,0.1)' : /温馨|希望/.test(s.dominantEmotion || '') ? 'rgba(22,163,74,0.1)' : 'rgba(0,0,0,0.03)', color: /热血|高潮|激动/.test(s.dominantEmotion || '') ? '#dc2626' : '#6b5e54', fontWeight: 600 }}>{s.dominantEmotion}</span>
                            <span style={{ color: '#6b5e54' }}>{s.chapterStart ? `第${s.chapterStart}${s.chapterEnd ? `-${s.chapterEnd}` : ''}章` : ''}</span>
                          </div>
                        ))}
                      </div>
                    )
                    if (isSrc && extraction.emotionCurve) return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {extraction.emotionCurve.segments.map((s: any) => (
                          <div key={s.chapterStart} style={{ padding: '10px 14px', borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', fontSize: 11, display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontSize: 9, padding: '2px 8px', borderRadius: 6, background: /热血|高潮|激动/.test(s.dominantEmotion) ? 'rgba(220,38,38,0.1)' : /压抑|悲伤|恐惧/.test(s.dominantEmotion) ? 'rgba(59,130,246,0.1)' : /温馨|希望/.test(s.dominantEmotion) ? 'rgba(22,163,74,0.1)' : 'rgba(0,0,0,0.03)', color: /热血|高潮|激动/.test(s.dominantEmotion) ? '#dc2626' : /压抑|悲伤|恐惧/.test(s.dominantEmotion) ? '#3b82f6' : '#6b5e54', fontWeight: 600 }}>{s.dominantEmotion}</span>
                            <span style={{ color: '#6b5e54' }}>第{s.chapterStart}-{s.chapterEnd}章</span>
                          </div>
                        ))}
                      </div>
                    )
                    return <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', color: '#4a3f38' }}>{outlineResults.emotionCurve || '未生成'}</pre>
                  }

                  // Erotic
                  if (dimSubTab === 'erotic') {
                    let genEr: any = null
                    if (!isSrc) { try { genEr = JSON.parse(outlineResults.erotic || '{}') } catch {} }
                    if (genEr) return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 11 }}>
                        {genEr.characterRoles?.length > 0 && (
                          <div>
                            <div style={{ fontWeight: 700, color: '#dc2626', marginBottom: 4 }}>角色情色设定 ({genEr.characterRoles.length}个)</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              {genEr.characterRoles.map((cr: any) => (
                                <div key={cr.name} style={{ padding: '10px 14px', borderRadius: 12, background: '#fff', border: '1px solid rgba(220,38,38,0.12)' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                                    <span style={{ fontWeight: 700, color: '#dc2626', fontSize: 13 }}>{cr.name}</span>
                                    <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: 'rgba(220,38,38,0.1)', color: '#dc2626' }}>{cr.domSub || 'sub'}</span>
                                    <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: 'rgba(0,0,0,0.03)', color: '#6b5e54' }}>{cr.bodyState || '正常'}</span>
                                    {cr.shameLevel && <span style={{ fontSize: 9, color: '#9b8e84' }}>羞耻: {cr.shameLevel}</span>}
                                  </div>
                                  {cr.kinks?.length > 0 && <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>{cr.kinks.map((k: string) => <span key={k} style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: 'rgba(220,38,38,0.06)', color: '#dc2626' }}>{k}</span>)}</div>}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {genEr.sceneFlow?.length > 0 && (
                          <div style={{ padding: '10px 14px', borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,0.04)' }}>
                            <div style={{ fontWeight: 600, color: '#dc2626', marginBottom: 4 }}>场景流程</div>
                            {genEr.sceneFlow.map((sf: any, i: number) => (
                              <div key={i} style={{ marginBottom: i < genEr.sceneFlow.length - 1 ? 4 : 0 }}>
                                <span style={{ fontWeight: 600, color: '#4a3f38' }}>{sf.phase || `阶段${i+1}`}:</span>
                                <span style={{ color: '#6b5e54' }}> {sf.actions?.join('、') || ''}</span>
                                {sf.bodyReactions?.length > 0 && <span style={{ color: '#9b8e84', fontSize: 10 }}> → {sf.bodyReactions.join('、')}</span>}
                              </div>
                            ))}
                          </div>
                        )}
                        {genEr.techniques && (
                          <div style={{ padding: '10px 14px', borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,0.04)' }}>
                            <div style={{ fontWeight: 600, color: '#dc2626', marginBottom: 4 }}>技法参数</div>
                            {genEr.techniques.bodyFluids?.length > 0 && <div style={{ marginTop: 2 }}><span style={{ color: '#9b8e84' }}>体液:</span> <span style={{ color: '#4a3f38' }}>{genEr.techniques.bodyFluids.join('、')}</span></div>}
                            {genEr.techniques.touchFocus?.length > 0 && <div style={{ marginTop: 2 }}><span style={{ color: '#9b8e84' }}>触感焦点:</span> <span style={{ color: '#4a3f38' }}>{genEr.techniques.touchFocus.join('、')}</span></div>}
                            <div style={{ marginTop: 2 }}><span style={{ color: '#9b8e84' }}>声音:</span> <span style={{ color: '#4a3f38' }}>{genEr.techniques.soundStyle || '密集'} · {genEr.techniques.moanDensity || '密集'}</span></div>
                          </div>
                        )}
                        {genEr.powerDynamics && <div style={{ padding: '10px 14px', borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,0.04)' }}><div style={{ fontWeight: 600, color: '#dc2626', marginBottom: 4 }}>权力关系</div><span style={{ color: '#4a3f38' }}>{genEr.powerDynamics}</span></div>}
                        {genEr.degradationPatterns?.length > 0 && <div style={{ padding: '10px 14px', borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,0.04)' }}><div style={{ fontWeight: 600, color: '#dc2626', marginBottom: 4 }}>羞辱模式</div><div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{genEr.degradationPatterns.map((p: string, i: number) => <span key={i} style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: 'rgba(220,38,38,0.06)', color: '#dc2626' }}>{p}</span>)}</div></div>}
                      </div>
                    )
                    if (isSrc) return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {extraction.chapters.filter(c => c.erotic).map(ch => (
                          <div key={ch.chapterId} style={{ padding: '10px 14px', borderRadius: 12, background: '#fff', border: '1px solid rgba(220,38,38,0.1)', fontSize: 11 }}>
                            <div style={{ fontWeight: 700, color: '#dc2626', marginBottom: 4 }}>第{ch.chapterNumber}章</div>
                            {ch.erotic?.characterRoles && ch.erotic.characterRoles.length > 0 && (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 4 }}>
                                {ch.erotic.characterRoles.map((cr: any) => (
                                  <div key={cr.name} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <span style={{ fontWeight: 600, color: '#dc2626' }}>{cr.name}</span>
                                    <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 4, background: 'rgba(220,38,38,0.06)', color: '#dc2626' }}>{cr.domSub || 'sub'}</span>
                                    <span style={{ fontSize: 9, color: '#9b8e84' }}>{cr.bodyState}</span>
                                    {cr.kinks?.length > 0 && cr.kinks.map((k: string) => <span key={k} style={{ fontSize: 8, color: '#e67e00' }}>#{k}</span>)}
                                  </div>
                                ))}
                              </div>
                            )}
                            {ch.erotic?.powerDynamics && <p style={{ color: '#6b5e54', margin: '2px 0 0', fontSize: 10 }}>{ch.erotic.powerDynamics}</p>}
                          </div>
                        ))}
                      </div>
                    )
                    return <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', color: '#4a3f38' }}>{outlineResults.erotic || '未生成'}</pre>
                  }

                  return null
                })()}
              </div>
            </ScrollArea>
          )}

{/* === 原书细纲 Tab: extracted chapter cards === */}
          {previewTab === 'srcDetails' && (
            <ScrollArea maxHeight="100%" style={{ flex: 1 }}>
              <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {extraction.chapters.filter(c => c.extractedAt).length > 0 ? (
                  extraction.chapters.filter(c => c.extractedAt).map((ch: any) => (
                    <div key={ch.chapterId} style={{ padding: '12px 16px', borderRadius: 14, background: '#fff', border: '1px solid rgba(0,0,0,0.05)' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#7c3aed', marginBottom: 8 }}>第{ch.chapterNumber}章: {ch.chapterTitle}</div>
                      <div style={{ marginBottom: 8 }}><div style={{ fontSize: 10, fontWeight: 600, color: '#9b8e84', marginBottom: 2 }}>剧情摘要</div><p style={{ fontSize: 11, color: '#4a3f38', lineHeight: 1.7, margin: 0 }}>{ch.chapterSummary}</p></div>
                      {ch.characters && ch.characters.length > 0 && (<div style={{ marginBottom: 6 }}><div style={{ fontSize: 10, fontWeight: 600, color: '#9b8e84', marginBottom: 2 }}>出场角色</div><div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{ch.characters.map((c: any) => <span key={c.name || c} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6, background: 'rgba(124,58,237,0.06)', color: '#7c3aed' }}>{typeof c === 'string' ? c : (c.name + (c.role ? `(${c.role})` : ''))}</span>)}</div></div>)}
                      {ch.events && ch.events.length > 0 && (<div style={{ marginBottom: 6 }}><div style={{ fontSize: 10, fontWeight: 600, color: '#9b8e84', marginBottom: 2 }}>关键事件</div><div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{ch.events.map((ev: string) => <span key={ev} style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: 'rgba(59,130,246,0.06)', color: '#3b82f6' }}>{ev}</span>)}</div></div>)}
                      {ch.emotionalTone && <div style={{ fontSize: 10 }}><span style={{ color: '#9b8e84' }}>情绪基调:</span> <span style={{ color: '#4a3f38' }}>{ch.emotionalTone}</span></div>}
                    </div>
                  ))
                ) : <div style={{ textAlign: 'center', padding: 40, fontSize: 12, color: '#9b8e84' }}>请先提取章节</div>}
              </div>
            </ScrollArea>
          )}

          {/* === 细纲 Tab: generated imitation chapter cards === */}
          {previewTab === 'details' && (
            <ScrollArea maxHeight="100%" style={{ flex: 1 }}>
              <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(detailGenResults.length > 0 ? detailGenResults : (() => { try { return detailsResults ? JSON.parse(detailsResults) : [] } catch { return [] } })()).length > 0 ? (
                  (detailGenResults.length > 0 ? detailGenResults : JSON.parse(detailsResults || '[]')).map((d: any) => (
                    <div key={d.chapterNumber} style={{ padding: '12px 16px', borderRadius: 14, background: '#fff', border: '1px solid rgba(0,0,0,0.05)' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#3b82f6', marginBottom: 8 }}>第{d.chapterNumber}章: {d.title}</div>
                      <div style={{ marginBottom: 8 }}><div style={{ fontSize: 10, fontWeight: 600, color: '#9b8e84', marginBottom: 2 }}>剧情摘要</div><p style={{ fontSize: 11, color: '#4a3f38', lineHeight: 1.7, margin: 0 }}>{d.summary}</p></div>
                      {d.charactersAppearing?.length > 0 && (<div style={{ marginBottom: 6 }}><div style={{ fontSize: 10, fontWeight: 600, color: '#9b8e84', marginBottom: 2 }}>出场角色</div><div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{d.charactersAppearing.map((c: string) => <span key={c} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6, background: 'rgba(59,130,246,0.06)', color: '#3b82f6' }}>{c}</span>)}</div></div>)}
                      {d.levelChange && <div style={{ marginBottom: 6 }}><span style={{ fontSize: 10 }}><span style={{ color: '#9b8e84' }}>等级:</span> <span style={{ color: '#16a34a' }}>{d.levelChange}</span></span></div>}
                      {d.itemsUsed?.length > 0 && (<div style={{ marginBottom: 6 }}><span style={{ fontSize: 10 }}><span style={{ color: '#9b8e84' }}>道具:</span> {d.itemsUsed.map((i: string) => <span key={i} style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: 'rgba(245,158,11,0.06)', color: '#e67e00', marginRight: 4 }}>{i}</span>)}</span></div>)}
                      {d.keyEvents?.length > 0 && (<div style={{ marginBottom: 6 }}><span style={{ fontSize: 10 }}><span style={{ color: '#9b8e84' }}>事件:</span> {d.keyEvents.join(' · ')}</span></div>)}
                      {d.emotionalTone && <div style={{ fontSize: 10 }}><span style={{ color: '#9b8e84' }}>情绪基调:</span> <span style={{ color: '#4a3f38' }}>{d.emotionalTone}</span></div>}
                      <div style={{ marginTop: 8, display: 'flex', gap: 4 }}>
                        <Button size="sm" variant="ghost" onClick={() => { setChapterWriteView(String(d.chapterNumber)); setWriteContent(chapterContents[String(d.chapterNumber)] || ''); setPreviewTab('write') }}>写本章</Button>
                        {chapterContents[String(d.chapterNumber)] && <span style={{ fontSize: 10, color: '#16a34a', padding: '4px 0' }}>✓ 已写 {chapterContents[String(d.chapterNumber)].length}字</span>}
                      </div>
                    </div>
                  ))
                ) : <div style={{ textAlign: 'center', padding: 40, fontSize: 12, color: '#9b8e84' }}>尚未生成细纲。切换到「生成」Tab → 细纲模仿 → 开始逐章生成。</div>}
              </div>
            </ScrollArea>
          )}

          {/* === 时间线 Tab === */}
          {previewTab === 'timeline' && extraction.chapters.some(c => c.extractedAt) && (
            <ScrollArea maxHeight="100%" style={{ flex: 1 }}>
              <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {extraction.chapters.filter(c => c.extractedAt).map(ch => (
                  <div key={ch.chapterId} style={{ padding: '12px 16px', borderRadius: 14, background: '#fff', border: '1px solid rgba(0,0,0,0.05)' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#7c3aed', marginBottom: 10 }}>第{ch.chapterNumber}章: {ch.chapterTitle}</div>
                    {/* Characters */}
                    {ch.characters.length > 0 && (
                      <div style={{ marginBottom: 6 }}>
                        <div style={{ fontSize: 10, fontWeight: 600, color: '#9b8e84', marginBottom: 2 }}>出场角色</div>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {ch.characters.map((c: any) => <span key={c.name} style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: 'rgba(124,58,237,0.06)', color: '#7c3aed' }}>{c.name}{c.role ? `(${c.role})` : ''}</span>)}
                        </div>
                      </div>
                    )}
                    {/* Power System mentions */}
                    {ch.powerSystem.length > 0 && (
                      <div style={{ marginBottom: 6 }}>
                        <div style={{ fontSize: 10, fontWeight: 600, color: '#9b8e84', marginBottom: 2 }}>等级</div>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {ch.powerSystem.map((ps: any, idx: number) => <span key={idx} style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: 'rgba(22,163,74,0.06)', color: '#16a34a' }}>{ps.term}</span>)}
                        </div>
                      </div>
                    )}
                    {/* Items */}
                    {ch.items.length > 0 && (
                      <div style={{ marginBottom: 6 }}>
                        <div style={{ fontSize: 10, fontWeight: 600, color: '#9b8e84', marginBottom: 2 }}>道具</div>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {ch.items.map((it: any, idx: number) => <span key={idx} style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: 'rgba(245,158,11,0.06)', color: '#e67e00' }}>{it.name}({it.type})</span>)}
                        </div>
                      </div>
                    )}
                    {/* Worldbuilding */}
                    {ch.worldbuilding.length > 0 && (
                      <div style={{ marginBottom: 6 }}>
                        <div style={{ fontSize: 10, fontWeight: 600, color: '#9b8e84', marginBottom: 2 }}>世界观</div>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {ch.worldbuilding.map((w: any, idx: number) => <span key={idx} style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: 'rgba(59,130,246,0.06)', color: '#3b82f6' }}>{w.name}</span>)}
                        </div>
                      </div>
                    )}
                    {/* Foreshadowing */}
                    {ch.foreshadowing.length > 0 && (
                      <div style={{ marginBottom: 6 }}>
                        <div style={{ fontSize: 10, fontWeight: 600, color: '#9b8e84', marginBottom: 2 }}>伏笔</div>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {ch.foreshadowing.map((f: any, idx: number) => <span key={idx} style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: f.type === 'planted' ? 'rgba(245,158,11,0.06)' : 'rgba(22,163,74,0.06)', color: f.type === 'planted' ? '#f59e0b' : '#16a34a' }}>{f.type==='planted'?'埋':'收'}:{f.description.slice(0,30)}</span>)}
                        </div>
                      </div>
                    )}
                    {/* Events + Emotion */}
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 10, marginTop: 4 }}>
                      {ch.events.length > 0 && <span style={{ color: '#4a3f38' }}>事件: {ch.events.join(' · ')}</span>}
                      {ch.emotionalTone && <span style={{ color: '#9b8e84' }}>情绪: {ch.emotionalTone}</span>}
                    </div>
                    {ch.erotic && <div style={{ fontSize: 9, color: '#dc2626', marginTop: 4 }}>含情色数据</div>}
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
          {previewTab === 'timeline' && !extraction.chapters.some(c => c.extractedAt) && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ textAlign: 'center', color: '#9b8e84', fontSize: 12 }}>请先提取章节数据</div>
            </div>
          )}

          {/* === 章节创作 Tab === */}
          {previewTab === 'write' && (
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
              {/* Left: Chapter list + 细纲 reference */}
              <div style={{ width: 260, borderRight: '1px solid rgba(0,0,0,0.05)', background: 'rgba(255,255,255,0.35)', display: 'flex', flexDirection: 'column' }}>
                {/* Chapter navigation */}
                <div style={{ padding: '12px 14px 8px', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                  {(detailGenResults.length > 0 ? detailGenResults : (() => { try { return detailsResults ? JSON.parse(detailsResults) : [] } catch { return [] } })()).length > 0 ? (
                    (detailGenResults.length > 0 ? detailGenResults : JSON.parse(detailsResults || '[]')).map((d: any) => (
                      <div key={d.chapterNumber} onClick={() => { setWriteContent(chapterContents[String(d.chapterNumber)] || ''); setChapterWriteView(String(d.chapterNumber)) }} style={{
                        padding: '4px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 11,
                        background: chapterWriteView === String(d.chapterNumber) ? 'rgba(124,58,237,0.06)' : 'transparent',
                        color: chapterWriteView === String(d.chapterNumber) ? '#7c3aed' : '#4a3f38',
                        fontWeight: chapterWriteView === String(d.chapterNumber) ? 600 : 400,
                      }}>
                        第{d.chapterNumber}章 {d.title} {chapterContents[String(d.chapterNumber)] ? ' ✓' : ''}
                      </div>
                    ))
                  ) : <div style={{ textAlign: 'center', padding: 20, fontSize: 11, color: '#9b8e84' }}>暂无细纲<br/>请先在「生成」Tab生成细纲</div>}
                </div>
                {/* Selected chapter 细纲 reference */}
                <div style={{ flex: 1, overflow: 'auto', padding: '10px 14px' }}>
                  {chapterWriteView && (() => {
                    const d = detailGenResults.length > 0 ? detailGenResults.find((d: any) => d.chapterNumber === parseInt(chapterWriteView)) : null
                    if (!d) return <div style={{ fontSize: 11, color: '#9b8e84' }}>请选择章节</div>
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 11 }}>
                        <div><div style={{ fontWeight: 700, color: '#7c3aed', marginBottom: 4 }}>剧情摘要</div><p style={{ color: '#4a3f38', lineHeight: 1.6, margin: 0 }}>{d.summary}</p></div>
                        {d.charactersAppearing?.length > 0 && <div><div style={{ fontWeight: 700, color: '#7c3aed', marginBottom: 4 }}>出场角色</div>{d.charactersAppearing.map((c: string) => <div key={c} style={{ color: '#6b5e54', padding: '1px 0' }}>{c}</div>)}</div>}
                        {d.levelChange && <div><span style={{ color: '#9b8e84' }}>等级:</span> <span style={{ color: '#16a34a' }}>{d.levelChange}</span></div>}
                        {d.itemsUsed?.length > 0 && <div><span style={{ color: '#9b8e84' }}>道具:</span> {d.itemsUsed.join(', ')}</div>}
                        {d.location && <div><span style={{ color: '#9b8e84' }}>场景:</span> {d.location}</div>}
                        {d.emotionalTone && <div><span style={{ color: '#9b8e84' }}>情绪:</span> {d.emotionalTone}</div>}
                      </div>
                    )
                  })()}
                </div>
              </div>
              {/* Right: Editor */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {/* Toolbar */}
                <div style={{ padding: '10px 20px', borderBottom: '1px solid rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#2d2520' }}>第{chapterWriteView || '?'}章</span>
                  <span style={{ fontSize: 12, color: '#9b8e84' }}>
                    {detailGenResults.length > 0 ? detailGenResults.find((d: any) => d.chapterNumber === parseInt(chapterWriteView || '0'))?.title || '' : ''}
                  </span>
                  <div style={{ flex: 1 }} />
                  <span style={{ fontSize: 11, color: '#9b8e84' }}>{formatWordCount(countChineseWords(writeContent))}字</span>
                  <Button size="sm" onClick={async () => {
                    if (!activeConfigId || !chapterWriteView) return; setWriteLoading(true)
                    const d = detailGenResults.length > 0 ? detailGenResults.find((d: any) => d.chapterNumber === parseInt(chapterWriteView)) : null
                    if (!d) { setWriteLoading(false); return }
                    const or = outlineResults
                    let prompt = `你是小说创作专家。根据以下设定写一章完整小说正文(2000-5000字)。\n\n`
                    if (or.characters) prompt += `## 角色\n${or.characters.slice(0, 1000)}\n\n`
                    if (or.powerSystem) prompt += `## 等级\n${or.powerSystem.slice(0, 500)}\n\n`
                    if (or.worldbuilding) prompt += `## 世界观\n${or.worldbuilding.slice(0, 500)}\n\n`
                    if (or.items) prompt += `## 道具\n${or.items.slice(0, 500)}\n\n`
                    if (or.erotic) prompt += `## 情色设定\n${or.erotic.slice(0, 500)}\n\n`
                    prompt += `## 本章细纲\n标题: ${d.title}\n剧情: ${d.summary}\n出场角色: ${(d.charactersAppearing || []).join(', ')}\n等级变化: ${d.levelChange || '无'}\n道具: ${(d.itemsUsed || []).join(', ')}\n场景: ${d.location || ''}\n伏笔: ${(d.foreshadowingOps || []).join(', ')}\n情绪: ${d.emotionalTone || ''}\n\n要求: 使用设定中的名称,文笔流畅,叙事自然。直接输出正文,不要markdown。`
                    let streamed = ''
                    await new Promise<void>((resolve) => {
                      aiService.chatStream([{ role: 'user' as const, content: prompt }], activeConfigId, undefined,
                        (data) => { setWriteContent(data.accumulated); streamed = data.accumulated },
                        () => { resolve() }, () => { resolve() }, () => { resolve() }
                      )
                    })
                    setWriteLoading(false)
                  }} disabled={writeLoading || !activeConfigId || !chapterWriteView} icon={<SparklesIcon style={{ width: 14, height: 14 }} />}>{writeLoading ? '生成中...' : 'AI生成'}</Button>
                  <Button size="sm" variant="secondary" onClick={() => {
                    if (!chapterWriteView) return
                    const updated = { ...chapterContents, [chapterWriteView]: writeContent }
                    setChapterContents(updated)
                    if (extraction) extractionService.saveProject({ ...extraction, chapterContents: updated, updatedAt: new Date().toISOString() })
                    setToast('已保存')
                    setTimeout(() => setToast(''), 3000)
                  }} disabled={!writeContent.trim()}>保存</Button>
                  <Button size="sm" variant="ghost" onClick={() => {
                    const prev = parseInt(chapterWriteView || '0') - 1
                    const d = detailGenResults.length > 0 ? detailGenResults.find((d: any) => d.chapterNumber === prev) : null
                    if (d) { setChapterContents(p => ({ ...p, [chapterWriteView || '']: writeContent })); setChapterWriteView(String(prev)); setWriteContent(chapterContents[String(prev)] || '') }
                  }} disabled={!chapterWriteView || parseInt(chapterWriteView) <= 1}>上一章</Button>
                  <Button size="sm" variant="ghost" onClick={() => {
                    const next = parseInt(chapterWriteView || '0') + 1
                    const d = detailGenResults.length > 0 ? detailGenResults.find((d: any) => d.chapterNumber === next) : null
                    if (d) { setChapterContents(p => ({ ...p, [chapterWriteView || '']: writeContent })); setChapterWriteView(String(next)); setWriteContent(chapterContents[String(next)] || '') }
                  }} disabled={!chapterWriteView || !detailGenResults.find((d: any) => d.chapterNumber === parseInt(chapterWriteView || '0') + 1)}>下一章</Button>
                </div>
                {/* Editor */}
                <div style={{ flex: 1, overflow: 'hidden', padding: '12px 24px', display: 'flex', justifyContent: 'center' }}>
                  <div className="custom-scrollbar" style={{ width: '100%', height: '100%', overflowY: 'auto' }}>
                    <RichTextEditor
                      content={writeContent}
                      onContentChange={setWriteContent}
                      placeholder={chapterWriteView ? '点击「AI生成」或手动输入正文...' : '请从左侧选择章节'}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* === 生成 Tab === */}
          {previewTab === 'generate' && (
            <ScrollArea maxHeight="100%" style={{ flex: 1 }}>
              <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ padding: 14, borderRadius: 16, background: 'rgba(124,58,237,0.03)', border: '1px solid rgba(124,58,237,0.1)' }}>
                  <h4 style={{ fontSize: 14, fontWeight: 700, color: '#7c3aed', marginBottom: 10 }}>大纲模仿 — 逐维度生成新设定</h4>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                    {[
                      { key: 'characters', label: '角色模仿', icon: UserGroupIcon },
                      { key: 'worldbuilding', label: '世界观模仿', icon: GlobeAltIcon },
                      { key: 'items', label: '道具模仿', icon: SparklesIcon },
                      { key: 'powerSystem', label: '等级模仿', icon: LightBulbIcon },
                      { key: 'foreshadowing', label: '伏笔模仿', icon: BookOpenIcon },
                      { key: 'emotionCurve', label: '情绪模仿', icon: SparklesIcon },
                      ...(novelType === 'erotic' ? [{ key: 'erotic', label: '情色模仿', icon: FireIcon }] : []),
                    ].map(dim => (
                      <Button key={dim.key} size="sm" variant={outlineGenerated[dim.key] ? 'secondary' : 'ghost'} onClick={() => {
                        if (outlineGenerated[dim.key] && !confirm(`${dim.label}已完成，是否重新生成？`)) return
                        handleGenerateDim(dim.key)
                      }} disabled={genLoading || !extraction.aggregated} icon={outlineGenerated[dim.key] ? <CheckCircleIcon style={{ width: 14, height: 14 }} /> : <SparklesIcon style={{ width: 14, height: 14 }} />}>{dim.label}{outlineGenerated[dim.key] ? ' ✓' : ''}</Button>
                    ))}
                    <Button size="sm" variant="secondary" onClick={async () => {
                      const keys = ['characters','worldbuilding','items','powerSystem','foreshadowing','emotionCurve',...(novelType === 'erotic' ? ['erotic'] : [])]
                      for (const k of keys) { if (!outlineGenerated[k]) await handleGenerateDim(k) }
                    }} disabled={genLoading || !extraction.aggregated} icon={<SparklesIcon style={{ width: 14, height: 14 }} />}>自动模仿全部</Button>
                  </div>
                  {genPreview && genType && (
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                        <span style={{ fontSize: 11, fontWeight: 600, color: '#7c3aed' }}>{genLoading ? '生成中...' : genType + ' 预览'}</span>
                        <Button size="sm" onClick={() => { setOutlineGenerated({ ...outlineGenerated, [genType!]: true }); setOutlineResults({ ...outlineResults, [genType!]: genPreview }); setGenPreview(''); setGenType(null) }}>保存此维度</Button>
                      </div>
                      <div style={{ fontSize: 11, lineHeight: 1.7, whiteSpace: 'pre-wrap', padding: 10, borderRadius: 10, background: '#fff', border: '1px solid rgba(0,0,0,0.04)', maxHeight: 400, overflow: 'auto', color: '#4a3f38' }}>{genPreview}</div>
                    </div>
                  )}
                  {Object.keys(outlineResults).length > 0 && !genPreview && (
                    <div style={{ fontSize: 10, color: '#9b8e84' }}>已生成: {Object.entries(outlineResults).map(([k]) => {
                      const labels: Record<string, string> = { characters: '角色', worldbuilding: '世界观', items: '道具', powerSystem: '等级', foreshadowing: '伏笔', emotionCurve: '情绪', erotic: '情色' }
                      return labels[k] || k
                    }).join(' · ')}</div>
                  )}
                </div>
                <div style={{ padding: 14, borderRadius: 16, background: 'rgba(59,130,246,0.03)', border: '1px solid rgba(59,130,246,0.1)' }}>
                  <h4 style={{ fontSize: 14, fontWeight: 700, color: '#3b82f6', marginBottom: 10 }}>细纲模仿 — 逐章生成（每章对照原作对应章）</h4>
                  <p style={{ fontSize: 11, color: '#6b5e54', marginBottom: 8 }}>先生成角色模仿。每章AI会拿到：①原作该章摘要+②新大纲全部设定。逐章生成，精确对应。</p>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
                    <Button size="sm" onClick={() => handleGenerateDetailsImitation()} disabled={detailGenRunning || !outlineGenerated['characters'] || !extraction.aggregated || extractIds.size === 0} icon={<SparklesIcon style={{ width: 14, height: 14 }} />}>
                      {detailGenRunning ? `生成中 ${detailGenCurrent}/${extractIds.size}` : `开始逐章生成 (${extractIds.size}章)`}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => {
                      const leftovers = extraction.chapters.filter(c => extractIds.has(c.chapterId) && c.extractedAt && !detailGenResults.find((d: any) => d.chapterNumber === c.chapterNumber))
                      if (leftovers.length === 0) { alert('所有选中章节已生成细纲'); return }
                      setExtractIds(new Set(leftovers.map(c => c.chapterId)))
                      setTimeout(() => handleGenerateDetailsImitation(), 100)
                    }} disabled={detailGenRunning || !outlineGenerated['characters'] || extractIds.size === 0}>
                      生成剩余
                    </Button>
                    {detailGenRunning && <Button size="sm" variant="danger" onClick={() => { detailGenAbortRef.current = true }}>停止</Button>}
                    {detailGenResults.length > 0 && !detailGenRunning && (
                      <><Button size="sm" variant="secondary" onClick={() => {
                      const json = JSON.stringify(detailGenResults, null, 2)
                      setDetailsResults(json)
                      if (extraction) extractionService.saveProject({ ...extraction, detailsResults: json, detailGenResults, updatedAt: new Date().toISOString() })
                      alert(`已保存 ${detailGenResults.length} 章细纲`)
                    }}>保存全部细纲</Button>
                    <Button size="sm" variant="ghost" onClick={() => {
                      if (!confirm(`确定清除全部 ${detailGenResults.length} 章模仿细纲数据？此操作不可恢复。`)) return
                      setDetailGenResults([]); setDetailsResults('')
                      if (extraction) extractionService.saveProject({ ...extraction, detailsResults: '', detailGenResults: [], updatedAt: new Date().toISOString() })
                    }}>清空</Button></>
                    )}
                  </div>
                  {detailGenRunning && (
                    <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'rgba(0,0,0,0.05)', overflow: 'hidden', marginBottom: 8 }}>
                      <div style={{ height: '100%', width: `${extractIds.size > 0 ? (detailGenCurrent / extractIds.size) * 100 : 0}%`, background: '#3b82f6', borderRadius: 2, transition: 'width 0.3s' }} />
                    </div>
                  )}
                  {detailGenResults.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 400, overflow: 'auto' }}>
                      {detailGenResults.map((d: any) => (
                        <div key={d.chapterNumber} style={{ padding: '8px 10px', borderRadius: 10, background: '#fff', border: '1px solid rgba(0,0,0,0.04)', fontSize: 11 }}>
                          <div style={{ fontWeight: 700, color: '#3b82f6', marginBottom: 4 }}>第{d.chapterNumber}章: {d.title}</div>
                          <div style={{ color: '#4a3f38', lineHeight: 1.6, marginBottom: 4 }}>{d.summary}</div>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 9 }}>
                            {d.charactersAppearing?.length > 0 && <span style={{ color: '#7c3aed' }}>角色:{d.charactersAppearing.join(',')}</span>}
                            {d.levelChange && <span style={{ color: '#16a34a' }}>等级:{d.levelChange}</span>}
                            {d.itemsUsed?.length > 0 && <span style={{ color: '#e67e00' }}>道具:{d.itemsUsed.join(',')}</span>}
                            {d.emotionalTone && <span style={{ color: '#9b8e84' }}>情绪:{d.emotionalTone}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {detailsResults && detailGenResults.length === 0 && (
                    <div style={{ fontSize: 10, color: '#16a34a' }}>✓ 细纲已保存 ({(() => { try { return JSON.parse(detailsResults).length } catch { return 0 } })()}章)</div>
                  )}
                </div>
              </div>
            </ScrollArea>
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
      {extractingRef.current && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 20, padding: 32, width: 360, textAlign: 'center', boxShadow: '0 16px 48px rgba(0,0,0,0.15)' }}>
            <div style={{ width: 48, height: 48, borderRadius: '50%', border: '4px solid rgba(124,58,237,0.1)', borderTopColor: '#7c3aed', animation: 'spin 0.8s linear infinite', margin: '0 auto 16px' }} />
            <div style={{ height: 6, borderRadius: 3, background: 'rgba(0,0,0,0.05)', overflow: 'hidden', marginBottom: 12 }}>
              <div style={{ height: '100%', width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%`, background: '#7c3aed', borderRadius: 3, transition: 'width 0.3s' }} />
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, color: '#7c3aed', marginBottom: 4 }}>{progress.current}/{progress.total}</div>
            <div style={{ fontSize: 12, color: '#9b8e84', marginBottom: 16 }}>{progress.text || '正在提取...'}</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <Button size="sm" variant="ghost" onClick={() => { pausedRef.current = !pausedRef.current }}>{pausedRef.current ? '继续提取' : '暂停提取'}</Button>
              <Button size="sm" variant="danger" onClick={() => { abortRef.current = true; pausedRef.current = false }}>停止提取</Button>
            </div>
          </div>
        </div>
      )}

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

	      {/* Generation Overlay */}
	      {writeGenOverlay && (
	        <div style={{ position: "fixed", inset: 0, zIndex: 99, background: "rgba(0,0,0,0.25)", backdropFilter: "blur(2px)", display: "flex", alignItems: "center", justifyContent: "center" }}>
	          <div style={{ background: "#fff", borderRadius: 20, padding: "24px 40px", textAlign: "center", boxShadow: "0 16px 48px rgba(0,0,0,0.15)" }}>
	            <div style={{ width: 36, height: 36, borderRadius: "50%", border: "3px solid rgba(124,58,237,0.1)", borderTopColor: "#7c3aed", animation: "spin 0.8s linear infinite", margin: "0 auto 12px" }} />
	            <div style={{ fontSize: 13, color: "#2d2520", marginBottom: 4 }}>AI 正在生成章节</div>
	            <div style={{ fontSize: 24, fontWeight: 800, color: "#7c3aed" }}>{writeGenWordCount.toLocaleString()}</div>
	            <button onClick={() => writeGenAbortRef.current?.()} style={{ marginTop: 12, padding: "4px 16px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.1)", background: "#fff", cursor: "pointer", fontSize: 11 }}>取消生成</button>
	          </div>
	        </div>
	      )}

          </div>
        </div>
      )}
    </div>
  )
}
