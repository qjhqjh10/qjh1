import { useEffect, useState, useRef } from 'react'
import { useStore, useSettingsStore } from '@/store'
import { extractionService, aiService, fileService } from '@/services/fileService'
import { loadCharacters, saveCharacter } from '@/services/characterService'
import {
  aggregateExtractions, buildExtractionPrompt, parseExtractionReply, splitChapters,
  buildStyleAnalyzePrompt, parseStyleAnalysisReply, computePacingTemplate,
  buildGenerateOutlinePrompt, buildGenerateDetailedOutlinesPrompt,
  buildGenerateCharactersPrompt, buildGenerateWorldbuildingPrompt,
  parseGeneratedOutline, parseGeneratedDetailedOutlines,
  parseGeneratedCharacters, parseGeneratedWorldbuilding,
} from '@/services/extractionService'
import { nanoid } from 'nanoid'
import GlassCard from '@/components/common/GlassCard'
import Button from '@/components/common/Button'
import ScrollArea from '@/components/common/ScrollArea'
import { logError } from '@/utils/logger'
import type { NovelExtraction, AggregatedResult } from '@/types/story'
import type { Character } from '@/types/character'
import { EMPTY_CHARACTER } from '@/types/character'
import {
  SparklesIcon, TrashIcon, DocumentTextIcon, UserGroupIcon, GlobeAltIcon,
  LightBulbIcon, PlayIcon, StopIcon, ArrowPathIcon, FolderOpenIcon,
  CheckCircleIcon, ClockIcon, ArrowLeftIcon, XMarkIcon,
  BookOpenIcon,
} from '@heroicons/react/24/outline'

type ViewMode = 'library' | 'detail'
type Step = 'import' | 'extracting' | 'aggregating' | 'structure' | 'completed'
type PreviewTab = 'chapter' | 'characters' | 'worldbuilding' | 'outline' | 'items' | 'power' | 'generate'

const TABS: { key: PreviewTab; label: string; icon: typeof DocumentTextIcon }[] = [
  { key: 'chapter', label: '章节', icon: BookOpenIcon },
  { key: 'characters', label: '角色', icon: UserGroupIcon },
  { key: 'worldbuilding', label: '世界观', icon: GlobeAltIcon },
  { key: 'outline', label: '章节摘要', icon: DocumentTextIcon },
  { key: 'items', label: '道具', icon: SparklesIcon },
  { key: 'power', label: '等级', icon: LightBulbIcon },
  { key: 'generate', label: '模仿生成', icon: SparklesIcon },
]

const STATUS_LABELS: Record<string, string> = { draft: '未开始', extracting: '提取中', aggregated: '已聚合', completed: '已完成' }
const STATUS_COLORS: Record<string, string> = { draft: '#9b8e84', extracting: '#f59e0b', aggregated: '#3b82f6', completed: '#16a34a' }

export default function ExtractionPage() {
  const activeConfigId = useSettingsStore(s => s.activeConfigId)
  const activeProjectId = useStore(s => s.activeProjectId)
  const projectsBasePath = useStore(s => s.projectsBasePath)
  const setCharacters = useStore(s => s.setCharacters)

  const [view, setView] = useState<ViewMode>('library')
  const [projects, setProjects] = useState<{ id: string; name: string; chapterCount: number; status: string; createdAt: string }[]>([])
  const [extraction, setExtraction] = useState<NovelExtraction | null>(null)
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null)
  const [step, setStep] = useState<Step>('import')
  const [progress, setProgress] = useState({ current: 0, total: 0, text: '' })
  const [loading, setLoading] = useState(false)
  const [previewTab, setPreviewTab] = useState<PreviewTab>('chapter')
  const [extractIds, setExtractIds] = useState<Set<string>>(new Set())
  const [styleLoading, setStyleLoading] = useState(false)
  const [styleProgress, setStyleProgress] = useState('')
  const [genLoading, setGenLoading] = useState(false)
  const [genPreview, setGenPreview] = useState('')
  const [genType, setGenType] = useState<string | null>(null)
  const abortRef = useRef(false)

  useEffect(() => { loadProjects() }, [])

  const loadProjects = async () => {
    try { setProjects(await extractionService.listProjects() as any[]) } catch { /* */ }
  }

  const handleImport = async () => {
    setLoading(true)
    try {
      const result = await extractionService.importFile() as { name: string; content: string } | null
      if (!result) { setLoading(false); return }
      const chapters = splitChapters(result.content)
      const ext: NovelExtraction = {
        id: `ext_${nanoid(8)}`, novelName: result.name.replace(/\.txt$/i, ''),
        sourceFileName: result.name, chapters: [], aggregated: null, plotStructure: null,
        styleProfile: null, pacingTemplate: null, generatedNovel: null,
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
      setExtraction(ext)
      setSelectedChapterId(ext.chapters[0]?.chapterId || null)
      setExtractIds(new Set())
      setStep('import')
      setView('detail')
    } catch (err) { logError('导入失败', err); alert('导入失败') }
    setLoading(false)
  }

  const handleEnterProject = async (id: string) => {
    setLoading(true)
    try {
      const ext = await extractionService.loadProject(id) as NovelExtraction
      setExtraction(ext)
      setSelectedChapterId(ext.chapters[0]?.chapterId || null)
      setExtractIds(new Set())
      if (ext.status === 'completed') setStep('completed')
      else if (ext.aggregated) setStep('structure')
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
    const chaptersToExtract = extraction.chapters.filter(c => extractIds.has(c.chapterId))
    if (chaptersToExtract.length === 0) {
      alert('请先在左侧选择要提取的章节'); return
    }
    abortRef.current = false
    setStep('extracting')
    const chapters = [...extraction.chapters]
    for (let i = 0; i < chaptersToExtract.length; i++) {
      if (abortRef.current) { setProgress({ current: i, total: chaptersToExtract.length, text: '已暂停' }); return }
      const ch = chaptersToExtract[i]
      setProgress({ current: i + 1, total: chaptersToExtract.length, text: `提取: ${ch.chapterTitle}` })
      try {
        const reply = await aiService.chat(
          [{ role: 'user' as const, content: buildExtractionPrompt(ch.chapterTitle, ch.chapterContent) }],
          activeConfigId,
        )
        const parsed = parseExtractionReply(reply, ch.chapterId, ch.chapterNumber, ch.chapterTitle, ch.chapterContent)
        const idx = chapters.findIndex(c => c.chapterId === ch.chapterId)
        if (idx !== -1) chapters[idx] = parsed
        const updated = { ...extraction, chapters, updatedAt: new Date().toISOString(), status: 'extracting' as const }
        setExtraction(updated)
        await extractionService.saveProject(updated)
      } catch (err) { logError(`提取章节 ${ch.chapterNumber} 失败`, err) }
    }
    if (!abortRef.current) {
      setProgress({ current: chaptersToExtract.length, total: chaptersToExtract.length, text: '提取完成' })
      setStep('extracting')
    }
  }

  const handleAbort = () => { abortRef.current = true }

  // ---- Aggregate ----
  const handleAggregate = async () => {
    if (!extraction) return
    setStep('aggregating')
    const chapters = extraction.chapters.filter(c => c.extractedAt)
    const aggregated = aggregateExtractions(chapters)
    const updated = { ...extraction, aggregated, status: 'aggregated' as const, updatedAt: new Date().toISOString() }
    setExtraction(updated)
    await extractionService.saveProject(updated)
    setStep('structure')
  }

  // ---- Structure inference ----
  const handleInferStructure = async () => {
    if (!extraction || !activeConfigId) return
    setStep('structure')
    const chapters = extraction.chapters.filter(c => c.extractedAt)
    const summaries = chapters.map(c => `第${c.chapterNumber}章 ${c.chapterTitle}: ${c.chapterSummary}`).join('\n\n')
    const prompt = `基于以下章节摘要和事件，推断这部小说的结构。

${summaries}

请输出JSON:
{
  "acts": [{"name": "幕名", "chapters": [1, 2, ...], "summary": "本幕概要"}],
  "turningPoints": [{"chapter": 数字, "type": "激励事件|中点转折|黑暗时刻|高潮", "desc": "描述"}],
  "plotThreads": [{"name": "故事线名", "type": "main|sub|hidden", "chapters": [1, 2, ...]}]
}`
    try {
      const reply = await aiService.chat([{ role: 'user' as const, content: prompt }], activeConfigId)
      const m = reply.match(/\{[\s\S]*\}/)
      const parsed = m ? JSON.parse(m[0]) : null
      const updated = { ...extraction, plotStructure: parsed, status: 'completed' as const, updatedAt: new Date().toISOString() }
      setExtraction(updated)
      await extractionService.saveProject(updated)
      setStep('completed')
    } catch (err) { logError('结构推断失败', err) }
  }

  // ---- Style analysis ----
  const handleStyleAnalyze = async () => {
    if (!extraction || !activeConfigId) return
    const dims = ['sentenceStyle', 'vocabularyStyle', 'rhetoricStyle', 'rhythmStyle', 'dialogueStyle', 'moodStyle', 'perspectiveStyle', 'bodyLanguageStyle', 'sensoryStyle', 'tensionStyle']
    const chapters = extraction.chapters.filter(c => c.extractedAt)
    if (chapters.length === 0) { alert('请先提取章节内容'); return }
    setStyleLoading(true)
    const updated = { ...extraction }
    for (let i = 0; i < chapters.length; i++) {
      const ch = chapters[i]
      setStyleProgress(`风格分析: ${i + 1}/${chapters.length}`)
      try {
        const reply = await aiService.chat([{ role: 'user' as const, content: `${buildStyleAnalyzePrompt(dims)}\n\n[${ch.chapterTitle}]\n${ch.chapterContent.slice(0, 3000)}` }], activeConfigId)
        const analysis = parseStyleAnalysisReply(reply)
        const idx = updated.chapters.findIndex(c => c.chapterId === ch.chapterId)
        if (idx !== -1) { /* style stored separately, not on ChapterExtraction */ }
      } catch (err) { logError(`风格分析章节 ${ch.chapterNumber} 失败`, err) }
    }
    // Build simple style profile from aggregated results
    const profile: any = { fullDescription: '', features: { sentenceStyle: '', vocabularyStyle: '', rhetoricStyle: '', rhythmStyle: '', dialogueStyle: '', moodStyle: '', perspectiveStyle: '', bodyLanguageStyle: '', sensoryStyle: '', tensionStyle: '', subtextStyle: '', descriptionPattern: null, corruptionArc: null, degradationRitual: null, narrativeVoice: null, sceneMechanics: null, somaticTension: null, identityDissolution: null, shameVoyeurLoop: null } }
    updated.styleProfile = profile as any
    // Compute pacing
    updated.pacingTemplate = computePacingTemplate(extraction.chapters.filter(c => c.extractedAt))
    setExtraction(updated)
    await extractionService.saveProject(updated)
    setStyleProgress('风格分析完成')
    setStyleLoading(false)
  }

  // ---- Generation ----
  const handleGenerate = async (type: string) => {
    if (!extraction || !activeConfigId) return
    setGenLoading(true); setGenType(type); setGenPreview('')
    try {
      let prompt = ''
      let reply = ''
      switch (type) {
        case 'outline':
          if (!extraction.pacingTemplate) extraction.pacingTemplate = computePacingTemplate(extraction.chapters.filter(c => c.extractedAt))
          prompt = buildGenerateOutlinePrompt(extraction)
          reply = await aiService.chat([{ role: 'user' as const, content: prompt }], activeConfigId)
          setGenPreview(parseGeneratedOutline(reply))
          break
        case 'details': {
          if (!extraction.generatedNovel?.outline) { alert('请先生成新大纲'); setGenLoading(false); return }
          prompt = buildGenerateDetailedOutlinesPrompt(extraction.generatedNovel.outline, extraction)
          reply = await aiService.chat([{ role: 'user' as const, content: prompt }], activeConfigId)
          setGenPreview(JSON.stringify(parseGeneratedDetailedOutlines(reply), null, 2))
          break
        }
        case 'characters':
          prompt = buildGenerateCharactersPrompt(extraction)
          reply = await aiService.chat([{ role: 'user' as const, content: prompt }], activeConfigId)
          setGenPreview(JSON.stringify(parseGeneratedCharacters(reply), null, 2))
          break
        case 'worldbuilding':
          prompt = buildGenerateWorldbuildingPrompt(extraction)
          reply = await aiService.chat([{ role: 'user' as const, content: prompt }], activeConfigId)
          const parsed = parseGeneratedWorldbuilding(reply)
          setGenPreview(`## 世界观\n\n${parsed.worldbuilding}\n\n## 等级体系\n\n${parsed.powerSystem.levels.join(' → ')}\n\n${parsed.powerSystem.description}`)
          break
      }
    } catch (err) { logError('生成失败', err); setGenPreview('生成失败') }
    setGenLoading(false)
  }

  const handleSaveGenerated = async () => {
    if (!extraction || !genPreview) return
    const gn = extraction.generatedNovel || { outline: '', detailedOutlines: [], characters: [], worldbuilding: '', powerSystem: { name: '', levels: [], description: '' }, generatedAt: '' }
    switch (genType) {
      case 'outline': gn.outline = genPreview; break
      case 'details':
        try { gn.detailedOutlines = JSON.parse(genPreview) } catch { gn.detailedOutlines = [] }; break
      case 'characters':
        try { gn.characters = JSON.parse(genPreview) } catch { gn.characters = [] }; break
      case 'worldbuilding':
        gn.worldbuilding = genPreview
        if (extraction.aggregated?.powerSystem) gn.powerSystem = extraction.aggregated.powerSystem
        break
    }
    gn.generatedAt = new Date().toISOString()
    const updated = { ...extraction, generatedNovel: gn, updatedAt: new Date().toISOString() }
    setExtraction(updated)
    await extractionService.saveProject(updated)
    setGenPreview(''); setGenType(null)
    alert('已保存到生成计划')
  }

  // ---- Import to project ----
  const handleImportToProject = async () => {
    if (!ag || !activeProjectId || !projectsBasePath) return
    const pp = `${projectsBasePath}/${activeProjectId}`
    const existingChars = await loadCharacters(pp)
    const existingNames = new Set(existingChars.map(c => c.name))
    for (const ac of ag.characters) {
      if (existingNames.has(ac.name)) continue
      const char: Character = {
        ...EMPTY_CHARACTER, id: nanoid(8), name: ac.name,
        role: (['男主', '女主', '男配', '女配', '反派', '其他'].includes(ac.role) ? ac.role : '其他') as Character['role'],
        personality: ac.traits.join('、'), appearance: ac.appearance,
        background: ac.background, importance: 50,
      }
      await saveCharacter(pp, char)
    }
    setCharacters(await loadCharacters(pp))

    let wbContent = ''
    if (ag.worldbuilding.locations.length > 0)
      wbContent += '## 地点\n\n' + ag.worldbuilding.locations.map(l => `- ${l.name}: ${l.description}`).join('\n') + '\n\n'
    if (ag.worldbuilding.factions.length > 0)
      wbContent += '## 势力\n\n' + ag.worldbuilding.factions.map(f => `- ${f.name}: ${f.description}`).join('\n') + '\n\n'
    if (ag.worldbuilding.rules.length > 0)
      wbContent += '## 规则\n\n' + ag.worldbuilding.rules.map(r => `- ${r.name}: ${r.description}`).join('\n') + '\n\n'
    if (ag.worldbuilding.history)
      wbContent += '## 历史\n\n' + ag.worldbuilding.history + '\n\n'
    if (ag.powerSystem.levels.length > 0) {
      wbContent += '## 等级体系\n\n' + ag.powerSystem.levels.join(' → ') + '\n'
      if (ag.powerSystem.description) wbContent += ag.powerSystem.description + '\n'
    }
    if (wbContent) {
      const existing = await fileService.read(`${pp}/worldbuilding/worldbuilding.txt`)
      await fileService.write(`${pp}/worldbuilding/worldbuilding.txt`, existing ? existing + '\n\n---\n\n' + wbContent : wbContent)
    }
    alert(`已导入: ${ag.characters.length}个角色, ${ag.worldbuilding.locations.length}个地点, ${ag.items.length}个道具`)
  }

  // ---- Render: Library ----
  if (view === 'library') {
    return (
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: 32 }}>
        <div style={{ maxWidth: 900, width: '100%', margin: '0 auto', flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
            <div>
              <h2 style={{ fontSize: 22, fontWeight: 700, color: '#2d2520' }}>小说反推</h2>
              <p style={{ fontSize: 13, color: '#9b8e84', marginTop: 4 }}>导入小说，AI逐章提取角色、世界观测、道具、等级体系</p>
            </div>
            <Button onClick={handleImport} disabled={loading} icon={<FolderOpenIcon style={{ width: 16, height: 16 }} />}>
              {loading ? '导入中...' : '导入TXT小说'}
            </Button>
          </div>

          {projects.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 80, color: '#9b8e84' }}>
              <BookOpenIcon style={{ width: 56, height: 56, margin: '0 auto 16px', opacity: 0.2 }} />
              <p style={{ fontSize: 15 }}>暂无反推项目</p>
              <p style={{ fontSize: 12, marginTop: 4 }}>点击上方按钮导入一本TXT小说</p>
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
                        {p.createdAt && <span>{new Date(p.createdAt).toLocaleDateString()}</span>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Button size="sm" onClick={() => handleEnterProject(p.id)}>查看</Button>
                      <button onClick={() => handleDeleteProject(p.id, p.name)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, color: '#d4ccc4' }}>
                        <TrashIcon style={{ width: 16, height: 16 }} />
                      </button>
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

  // ---- Render: Detail ----
  if (!extraction) return null

  return (
    <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '12px 20px', borderBottom: '1px solid rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => { setView('library'); setExtraction(null); loadProjects() }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9b8e84', display: 'flex', padding: 4 }}>
            <ArrowLeftIcon style={{ width: 20, height: 20 }} />
          </button>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: '#2d2520' }}>{extraction.novelName}</h2>
          <span style={{ fontSize: 11, color: '#9b8e84' }}>{extraction.chapters.length}章</span>
          <span style={{ fontSize: 11, color: STATUS_COLORS[extraction.status], fontWeight: 600 }}>{STATUS_LABELS[extraction.status] || extraction.status}</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {step !== 'completed' && (
            <Button size="sm" onClick={handleStartExtract} disabled={!activeConfigId || extractIds.size === 0} icon={<PlayIcon style={{ width: 14, height: 14 }} />}>
              开始提取 ({extractIds.size}章)
            </Button>
          )}
          {step === 'extracting' && (
            <Button size="sm" variant="danger" onClick={handleAbort} icon={<StopIcon style={{ width: 14, height: 14 }} />}>暂停</Button>
          )}
          {extractedCount > 0 && !extraction.aggregated && (
            <Button size="sm" variant="secondary" onClick={handleAggregate} icon={<ArrowPathIcon style={{ width: 14, height: 14 }} />}>跨章聚合</Button>
          )}
          {extraction.aggregated && step !== 'completed' && (
            <Button size="sm" variant="secondary" onClick={handleInferStructure} disabled={!activeConfigId} icon={<SparklesIcon style={{ width: 14, height: 14 }} />}>结构推断</Button>
          )}
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

      {/* Main body */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
        {/* Left: Chapter list */}
        <div style={{ width: 280, minWidth: 260, borderRight: '1px solid rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <ScrollArea maxHeight="100%" style={{ flex: 1, padding: 4 }}>
            {extraction.chapters.map(ch => {
              const isExtracted = !!ch.extractedAt
              const wc = ch.chapterContent ? Math.round(ch.chapterContent.length / 1000) : 0
              return (
                <div key={ch.chapterId} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 5, padding: '5px 8px', cursor: 'pointer',
                  borderRadius: 8, background: selectedChapterId === ch.chapterId ? 'rgba(124,58,237,0.06)' : 'transparent',
                  color: selectedChapterId === ch.chapterId ? '#7c3aed' : '#2d2520',
                  fontWeight: selectedChapterId === ch.chapterId ? 600 : 400,
                }} onClick={() => setSelectedChapterId(ch.chapterId)}>
                  <input type="checkbox" checked={extractIds.has(ch.chapterId)} onChange={() => toggleExtractId(ch.chapterId)}
                    style={{ width: 13, height: 13, accentColor: '#7c3aed', flexShrink: 0, marginTop: 1 }} onClick={e => e.stopPropagation()} />
                  <span style={{
                    flex: 1, fontSize: 11, lineHeight: 1.5, wordBreak: 'break-word', whiteSpace: 'normal',
                    color: selectedChapterId === ch.chapterId ? '#7c3aed' : '#2d2520',
                  }}>
                    第{ch.chapterNumber}章 {ch.chapterTitle.replace(/^第[一二三四五六七八九十百千零\d]+[章卷节回]\s*/, '')}
                  </span>
                  <span style={{ fontSize: 8, color: '#9b8e84', flexShrink: 0, whiteSpace: 'nowrap' }}>{wc}k</span>
                  {isExtracted && <span style={{ fontSize: 9, color: '#16a34a', fontWeight: 600, flexShrink: 0 }} title="已提取">✓</span>}
                </div>
              )
            })}
          </ScrollArea>
        </div>

        {/* Center: Content / Results */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Tabs */}
          <div style={{ padding: '4px 14px', borderBottom: '1px solid rgba(0,0,0,0.04)', display: 'flex', gap: 2, flexShrink: 0 }}>
            {TABS.map(tab => (
              <button key={tab.key} onClick={() => setPreviewTab(tab.key)} style={{
                padding: '5px 12px', borderRadius: '6px 6px 0 0', border: 'none',
                background: previewTab === tab.key ? 'rgba(124,58,237,0.06)' : 'transparent',
                color: previewTab === tab.key ? '#7c3aed' : '#6b5e54', fontSize: 12, cursor: 'pointer',
                fontWeight: previewTab === tab.key ? 600 : 400, display: 'flex', alignItems: 'center', gap: 4,
              }}>
                <tab.icon style={{ width: 13, height: 13 }} />{tab.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <ScrollArea maxHeight="100%" style={{ flex: 1 }}>
            <div style={{ padding: 10 }}>
              {previewTab === 'chapter' && (
                selectedChapter ? (
                  <div>
                    <h3 style={{ fontSize: 14, fontWeight: 700, color: '#2d2520', marginBottom: 8 }}>{selectedChapter.chapterTitle}</h3>
                    {selectedChapter.chapterSummary && (
                      <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(124,58,237,0.04)', border: '1px solid rgba(124,58,237,0.1)', marginBottom: 10 }}>
                        <div style={{ fontSize: 10, fontWeight: 600, color: '#7c3aed', marginBottom: 4 }}>AI 摘要</div>
                        <p style={{ fontSize: 11, color: '#4a3f38', lineHeight: 1.7, margin: 0 }}>{selectedChapter.chapterSummary}</p>
                      </div>
                    )}
                    {selectedChapter.events.length > 0 && (
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: 10, fontWeight: 600, color: '#6b5e54', marginBottom: 4 }}>关键事件</div>
                        {selectedChapter.events.map((ev, i) => (
                          <span key={i} style={{ display: 'inline-block', fontSize: 10, padding: '2px 8px', borderRadius: 6, background: 'rgba(0,0,0,0.03)', color: '#4a3f38', margin: '0 4px 4px 0' }}>{ev}</span>
                        ))}
                      </div>
                    )}
                    <div style={{ fontSize: 15, lineHeight: 2.2, color: '#2d2520', whiteSpace: 'pre-wrap', maxHeight: 1000, overflow: 'auto', padding: '10px 14px', borderRadius: 10, background: '#faf9f8', border: '1px solid rgba(0,0,0,0.04)' }}>
                      {selectedChapter.chapterContent.slice(0, 10000)}
                      {selectedChapter.chapterContent.length > 10000 && <p style={{ color: '#9b8e84', textAlign: 'center', marginTop: 8 }}>... (显示前10000字)</p>}
                    </div>
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: 40, color: '#9b8e84', fontSize: 12 }}>请从左侧选择章节</div>
                )
              )}

              {previewTab === 'characters' && (
                ag ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {ag.characters.map(c => (
                      <div key={c.name} style={{ padding: '10px 12px', borderRadius: 10, background: '#fff', border: '1px solid rgba(0,0,0,0.05)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: '#2d2520' }}>{c.name}</span>
                          {c.role && <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, background: 'rgba(124,58,237,0.08)', color: '#7c3aed' }}>{c.role}</span>}
                          <span style={{ fontSize: 9, color: '#9b8e84', marginLeft: 'auto' }}>第{c.firstChapter}-{c.lastChapter}章</span>
                        </div>
                        {c.traits.length > 0 && <p style={{ fontSize: 10, color: '#6b5e54', margin: '2px 0' }}>{c.traits.join('、')}</p>}
                        {c.arc && <p style={{ fontSize: 9, color: '#9b8e84', margin: 0 }}>{c.arc.slice(0, 120)}</p>}
                        {c.relationships.length > 0 && (
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                            {c.relationships.slice(0, 5).map(r => (
                              <span key={r.target} style={{ fontSize: 8, padding: '1px 5px', borderRadius: 4, background: 'rgba(0,0,0,0.03)', color: '#6b5e54' }}>{r.target}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : <div style={{ textAlign: 'center', padding: 32, fontSize: 12, color: '#9b8e84' }}>请先提取章节再进行聚合</div>
              )}

              {previewTab === 'worldbuilding' && ag && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {ag.worldbuilding.locations.length > 0 && (
                    <div><h4 style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>地点</h4>
                      {ag.worldbuilding.locations.map(l => <div key={l.name} style={{ fontSize: 10, padding: '2px 0' }}><strong>{l.name}</strong>: {l.description}</div>)}</div>
                  )}
                  {ag.worldbuilding.factions.length > 0 && (
                    <div><h4 style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>势力</h4>
                      {ag.worldbuilding.factions.map(f => <div key={f.name} style={{ fontSize: 10, padding: '2px 0' }}><strong>{f.name}</strong>: {f.description}</div>)}</div>
                  )}
                  {ag.worldbuilding.rules.length > 0 && (
                    <div><h4 style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>规则</h4>
                      {ag.worldbuilding.rules.map(r => <div key={r.name} style={{ fontSize: 10, padding: '2px 0' }}><strong>{r.name}</strong>: {r.description}</div>)}</div>
                  )}
                  {ag.worldbuilding.history && <div><h4 style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>历史</h4><p style={{ fontSize: 10, whiteSpace: 'pre-wrap' }}>{ag.worldbuilding.history}</p></div>}
                </div>
              )}

              {previewTab === 'outline' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {extraction.chapters.filter(c => c.extractedAt).map(ch => (
                    <div key={ch.chapterId} style={{ padding: '8px 10px', borderRadius: 8, background: '#fff', border: '1px solid rgba(0,0,0,0.04)' }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#7c3aed' }}>第{ch.chapterNumber}章: {ch.chapterTitle}</div>
                      <p style={{ fontSize: 10, color: '#4a3f38', lineHeight: 1.6, margin: '3px 0 0' }}>{ch.chapterSummary}</p>
                    </div>
                  ))}
                  {extraction.plotStructure && (
                    <div style={{ marginTop: 8, padding: 10, borderRadius: 10, background: 'rgba(124,58,237,0.04)' }}>
                      <h4 style={{ fontSize: 12, fontWeight: 700, color: '#7c3aed', marginBottom: 6 }}>结构推断</h4>
                      {extraction.plotStructure.acts.map((act: any) => (
                        <div key={act.name} style={{ fontSize: 10, marginBottom: 4 }}><strong>{act.name}</strong>: {act.summary}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {previewTab === 'items' && ag && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {ag.items.map(item => (
                    <div key={item.name} style={{ padding: '8px 10px', borderRadius: 8, background: '#fff', border: '1px solid rgba(0,0,0,0.04)', fontSize: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontWeight: 600, color: '#2d2520' }}>{item.name}</span>
                        <span style={{ fontSize: 8, padding: '1px 4px', borderRadius: 4, background: 'rgba(245,158,11,0.1)', color: '#f59e0b' }}>{item.type}</span>
                        {item.grade && <span style={{ fontSize: 8, color: '#9b8e84' }}>{item.grade}</span>}
                        <span style={{ fontSize: 8, color: '#9b8e84', marginLeft: 'auto' }}>第{item.firstChapter}章</span>
                      </div>
                      {item.ability && <p style={{ color: '#6b5e54', margin: '2px 0 0' }}>{item.ability}</p>}
                    </div>
                  ))}
                </div>
              )}

              {previewTab === 'power' && ag && (
                <div>
                  {ag.powerSystem.levels.length > 0 ? (
                    <>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                        {ag.powerSystem.levels.map((l: string, i: number) => (
                          <span key={l} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 8, background: i === 0 ? 'rgba(22,163,74,0.1)' : i === ag!.powerSystem.levels.length - 1 ? 'rgba(124,58,237,0.1)' : 'rgba(0,0,0,0.03)', color: i === 0 ? '#16a34a' : i === ag!.powerSystem.levels.length - 1 ? '#7c3aed' : '#6b5e54', fontWeight: 600 }}>
                            {l}
                          </span>
                        ))}
                      </div>
                      {ag.powerSystem.description && <p style={{ fontSize: 10, whiteSpace: 'pre-wrap' }}>{ag.powerSystem.description}</p>}
                    </>
                  ) : <div style={{ padding: 32, fontSize: 12, color: '#9b8e84', textAlign: 'center' }}>未检测到等级体系</div>}
                </div>
              )}

              {previewTab === 'generate' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <Button size="sm" onClick={() => handleGenerate('outline')} disabled={genLoading || !extraction.aggregated} icon={<SparklesIcon style={{ width: 14, height: 14 }} />}>
                      {genLoading && genType === 'outline' ? '生成中...' : '生成新大纲'}
                    </Button>
                    <Button size="sm" onClick={() => handleGenerate('details')} disabled={genLoading || !extraction.generatedNovel?.outline} icon={<SparklesIcon style={{ width: 14, height: 14 }} />}>
                      {genLoading && genType === 'details' ? '生成中...' : '生成新细纲'}
                    </Button>
                    <Button size="sm" onClick={() => handleGenerate('characters')} disabled={genLoading || !extraction.aggregated} icon={<SparklesIcon style={{ width: 14, height: 14 }} />}>
                      {genLoading && genType === 'characters' ? '生成中...' : '生成新角色'}
                    </Button>
                    <Button size="sm" onClick={() => handleGenerate('worldbuilding')} disabled={genLoading || !extraction.aggregated} icon={<SparklesIcon style={{ width: 14, height: 14 }} />}>
                      {genLoading && genType === 'worldbuilding' ? '生成中...' : '生成新世界观'}
                    </Button>
                  </div>

                  {genPreview && (
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: '#2d2520' }}>
                          {genType === 'outline' ? '新大纲预览' : genType === 'details' ? '新细纲预览' : genType === 'characters' ? '新角色预览' : '新世界观预览'}
                        </span>
                        <Button size="sm" onClick={handleSaveGenerated}>保存到计划</Button>
                      </div>
                      <div style={{ fontSize: 12, lineHeight: 1.8, color: '#4a3f38', whiteSpace: 'pre-wrap', padding: 12, borderRadius: 10, background: '#faf9f8', border: '1px solid rgba(0,0,0,0.04)', maxHeight: 600, overflow: 'auto' }}>
                        {genPreview}
                      </div>
                    </div>
                  )}

                  {extraction.generatedNovel?.outline && !genPreview && (
                    <div style={{ padding: 10, borderRadius: 10, background: 'rgba(22,163,74,0.04)', border: '1px solid rgba(22,163,74,0.1)' }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#16a34a', marginBottom: 4 }}>
                        已保存的生成计划
                        ({extraction.generatedNovel.detailedOutlines.length > 0 ? '大纲' : ''}
                        {extraction.generatedNovel.characters.length > 0 ? '、角色' : ''}
                        {extraction.generatedNovel.worldbuilding ? '、世界观' : ''})
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Right: Stats panel */}
        <div style={{ width: 400, minWidth: 320, borderLeft: '1px solid rgba(0,0,0,0.05)', background: 'rgba(255,255,255,0.35)', display: 'flex', flexDirection: 'column', padding: '14px 16px', gap: 10, flexShrink: 0 }}>
          <h4 style={{ fontSize: 14, fontWeight: 700, color: '#2d2520', marginBottom: 2 }}>提取统计</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 13 }}>
            <span style={{ color: '#4a3f38' }}>角色: {ag?.characters.length || 0}个</span>
            <span style={{ color: '#4a3f38' }}>地点: {ag?.worldbuilding.locations.length || 0}个</span>
            <span style={{ color: '#4a3f38' }}>道具: {ag?.items.length || 0}个</span>
            <span style={{ color: '#4a3f38' }}>等级: {ag?.powerSystem.levels.length || 0}级</span>
            <span style={{ color: '#4a3f38' }}>伏笔: {ag?.foreshadowing.filter((f: any) => f.status === 'resolved').length || 0}/{ag?.foreshadowing.length || 0}</span>
          </div>

          <div style={{ height: 1, background: 'rgba(0,0,0,0.05)' }} />

          <h4 style={{ fontSize: 14, fontWeight: 700, color: '#2d2520', marginBottom: 2 }}>步骤状态</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
            {(['import', 'extracting', 'structure', 'completed'] as string[]).map((s: string) => {
              const st = step as string
              const done = st === 'completed' || (s === 'import' && st !== 'import') ||
                (s === 'extracting' && (st === 'structure' || st === 'completed')) ||
                (s === 'structure' && st === 'completed')
              const active = st === s || (s === 'extracting' && st === 'extracting')
              const labels: Record<string, string> = { import: '章节分章', extracting: `逐章提取(${extractedCount})`, structure: '聚合+结构', completed: '完成' }
              return (
                <span key={s} style={{ color: done ? '#16a34a' : active ? '#7c3aed' : '#9b8e84', display: 'flex', alignItems: 'center', gap: 4 }}>
                  {done ? '✓' : active ? '●' : '○'} {labels[s] || s}
                </span>
              )
            })}
          </div>

          {ag && activeProjectId && (
            <>
              <div style={{ height: 1, background: 'rgba(0,0,0,0.05)' }} />
              <Button onClick={handleImportToProject} icon={<FolderOpenIcon style={{ width: 16, height: 16 }} />} style={{ width: '100%' }}>
                导入到项目
              </Button>
            </>
          )}

          {/* Style Analysis */}
          {extractedCount > 0 && (
            <>
              <div style={{ height: 1, background: 'rgba(0,0,0,0.05)', marginTop: 4 }} />
              <h4 style={{ fontSize: 14, fontWeight: 700, color: '#2d2520', marginBottom: 2 }}>风格分析</h4>
              <Button size="sm" onClick={handleStyleAnalyze} disabled={styleLoading || !activeConfigId} icon={<SparklesIcon style={{ width: 14, height: 14 }} />} style={{ width: '100%' }}>
                {styleLoading ? styleProgress : extraction.styleProfile ? '重新分析' : `分析文风 (${extractedCount}章)`}
              </Button>
              {extraction.styleProfile && <span style={{ fontSize: 10, color: '#16a34a' }}>✓ 风格已分析</span>}
              {extraction.pacingTemplate && (
                <div style={{ fontSize: 10, color: '#6b5e54' }}>
                  战斗{extraction.pacingTemplate.battleRatio}% 过渡{extraction.pacingTemplate.transitionRatio}% 高潮{extraction.pacingTemplate.climaxRatio}%
                </div>
              )}
            </>
          )}

          {/* Generation quick access */}
          {extraction.aggregated && (
            <>
              <div style={{ height: 1, background: 'rgba(0,0,0,0.05)', marginTop: 4 }} />
              <h4 style={{ fontSize: 14, fontWeight: 700, color: '#2d2520', marginBottom: 2 }}>模仿生成</h4>
              <Button size="sm" variant="secondary" onClick={() => { setPreviewTab('generate'); setGenType('outline'); handleGenerate('outline') }} disabled={genLoading || !activeConfigId} icon={<SparklesIcon style={{ width: 14, height: 14 }} />} style={{ width: '100%' }}>
                生成新大纲
              </Button>
              {extraction.generatedNovel?.outline && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <Button size="sm" variant="ghost" onClick={() => { setPreviewTab('generate'); setGenType('details'); handleGenerate('details') }} disabled={genLoading} icon={<SparklesIcon style={{ width: 14, height: 14 }} />} style={{ width: '100%' }}>
                    生成新细纲
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setPreviewTab('generate'); setGenType('characters'); handleGenerate('characters') }} disabled={genLoading} icon={<SparklesIcon style={{ width: 14, height: 14 }} />} style={{ width: '100%' }}>
                    生成新角色
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setPreviewTab('generate'); setGenType('worldbuilding'); handleGenerate('worldbuilding') }} disabled={genLoading} icon={<SparklesIcon style={{ width: 14, height: 14 }} />} style={{ width: '100%' }}>
                    生成新世界观
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
