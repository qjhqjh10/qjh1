import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore, useSettingsStore } from '@/store'
import { continuationService, aiService, extractionService, styleTemplateService, templateService, fileService } from '@/services/fileService'
import { getTemplateInjection } from '@/utils/styleInjector'
import type { SceneTemplate } from '@/types/story'
import type { StyleTemplate } from '@/types/styleTemplate'
import { splitChaptersByHeadings, countChineseWords } from '@/utils/textUtils'
import * as cs from '@/services/continuationService'
import { logError } from '@/utils/logger'
import Button from '@/components/common/Button'
import { SkeletonCard } from '@/components/common/Skeleton'
import ScrollArea from '@/components/common/ScrollArea'
import Modal from '@/components/common/Modal'
import {
  ArrowLeftIcon, SparklesIcon, CheckCircleIcon, PencilIcon, FolderOpenIcon,
} from '@heroicons/react/24/outline'
import type { ContinuationProject, ContinuationChapter, StoryUnderstanding, ContinuationPlan, ContinuationChapterPlan, ContinuationWrittenChapter, ContinuationChapterAnalysis, OutlineMergeData, PlotDirectionSegment, CharacterRole } from '@/types/continuation'
import { CONTINUATION_DIMS } from '@/types/continuation'

import type { Step } from './constants';
import { stepLabels, resultCard, resultCardHeader, resultCardBody, dimItem, dimEmpty } from './constants';
import { DimensionSelectDialog } from './dialogs/DimensionSelectDialog';

export default function ContinuationWorkspacePage() {
  const navigate = useNavigate()
  const activeProjectId = useStore(s => s.activeProjectId)
  const projectsBasePath = useStore(s => s.projectsBasePath)
  const setActivePage = useStore(s => s.setActivePage)
  const activeConfigId = useSettingsStore(s => s.activeConfigId)

  const [project, setProject] = useState<ContinuationProject | null>(null)
  const [chapters, setChapters] = useState<ContinuationChapter[]>([])
  const [step, setStep] = useState<Step>(1)
  const [selectedChapterIdx, setSelectedChapterIdx] = useState(0)
  const [selectedChapterIds, setSelectedChapterIds] = useState<Set<number>>(new Set())
  const chaptersRef = useRef(chapters)

  const [importing, setImporting] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzingChapter, setAnalyzingChapter] = useState<number | null>(null)
  const [aggregating, setAggregating] = useState(false)
  const [aggregationProgress, setAggregationProgress] = useState('')
  const [storyUnderstand, setStoryUnderstand] = useState<StoryUnderstanding | null>(null)
  const [plotDirection, setPlotDirection] = useState<PlotDirectionSegment[]>([])
  const [outlineMerge, setOutlineMerge] = useState<OutlineMergeData | null>(null)
  const [continuationPlan, setContinuationPlan] = useState<ContinuationPlan | null>(null)
  const [writingChapter, setWritingChapter] = useState<ContinuationWrittenChapter | null>(null)
  const [writingContent, setWritingContent] = useState('')
  const [writingLoading, setWritingLoading] = useState(false)
  // 模板注入
  const [sceneTemplates, setSceneTemplates] = useState<SceneTemplate[]>([])
  const [styleTemplates, setStyleTemplates] = useState<StyleTemplate[]>([])
  const [selectedSceneTplId, setSelectedSceneTplId] = useState('')
  const [selectedStyleTplId, setSelectedStyleTplId] = useState(project?.styleTemplateId || '')
  // 维度选择
  const [showDimDialog, setShowDimDialog] = useState(false)
  const [enabledDims, setEnabledDims] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(`cont_dims_${activeProjectId}`)
      return saved ? new Set(JSON.parse(saved)) : new Set(CONTINUATION_DIMS.map(d => d.key))
    } catch { return new Set(CONTINUATION_DIMS.map(d => d.key)) }
  })

  const toggleDim = (key: string) => {
    setEnabledDims(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      localStorage.setItem(`cont_dims_${activeProjectId}`, JSON.stringify([...next]))
      return next
    })
  }

  useEffect(() => { setActivePage('continuation-workspace') }, [])
  useEffect(() => {
    templateService.list().then((list: any) => setSceneTemplates(Array.isArray(list) ? list : [])).catch(() => {})
    styleTemplateService.list().then(setStyleTemplates).catch(() => {})
  }, [])
  useEffect(() => { chaptersRef.current = chapters }, [chapters])

  useEffect(() => {
    if (!activeProjectId) { navigate('/continuation'); return }
    loadProject()
  }, [activeProjectId])

  const loadProject = async () => {
    if (!activeProjectId) return
    // activeProjectId is the project name; try reading continuation JSON by id
    try {
      const list = await continuationService.list() as ContinuationProject[]
      const found = list.find(p => p.id === activeProjectId || p.name === activeProjectId)
      if (found) {
        setProject(found)
        setChapters(found.sourceChapters)
        setStoryUnderstand(found.storyUnderstanding || null)
        setPlotDirection(found.plotDirection || [])
        setOutlineMerge(found.outlineMerge || null)
        setContinuationPlan(found.continuationPlan || null)
        const s = found.status
        setStep(s === 'writing' ? 7 : s === 'planned' ? 6 : s === 'merged' ? 5 : s === 'outlining' ? 4 : s === 'analyzed' ? 3 : 1)
      }
    } catch (err) { logError('加载续写项目失败', err) }
  }

  const save = async (updates: Partial<ContinuationProject>) => {
    if (!project) return
    const updated = { ...project, ...updates, updatedAt: new Date().toISOString() }
    const saved = await continuationService.save(updated)
    setProject(saved)
    setChapters(saved.sourceChapters)
    return saved
  }

  const handleImport = async () => {
    setImporting(true)
    try {
      const result = await extractionService.importFile() as { name: string; content: string } | null
      if (!result) { setImporting(false); return }
      const split = splitChaptersByHeadings(result.content)
      if (split.length === 1 && split[0].chapterType === 'chapter' && split[0].title === '全文') {
        alert('未检测到章节标题，已导入为单章全文。\n请确认小说文件使用了标准的"第X章"格式。')
      }
      const chs: ContinuationChapter[] = split.map((r, i) => ({
        chapterNumber: i + 1, title: r.title, content: r.content, wordCount: countChineseWords(r.content),
      }))
      setChapters(chs)
      const proj: ContinuationProject = {
        id: project?.id || '', name: project?.name || result.name.replace(/\.txt$/i, ''),
        sourceFileName: result.name, sourceChapters: chs, writtenChapters: [],
        status: 'imported', createdAt: project?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
      }
      const saved = await continuationService.save(proj)
      setProject(saved)
    } catch (err) { logError('导入失败', err) }
    setImporting(false)
  }

  const handleImportFromContent = async (name: string, content: string) => {
    const split = splitChaptersByHeadings(content)
    const chs: ContinuationChapter[] = split.map((r, i) => ({
      chapterNumber: i + 1, title: r.title, content: r.content, wordCount: countChineseWords(r.content),
    }))
    setChapters(chs)
    const proj: ContinuationProject = {
      id: project?.id || '', name: project?.name || name.replace(/\.txt$/i, ''),
      sourceFileName: name, sourceChapters: chs, writtenChapters: [],
      status: 'imported', createdAt: project?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
    }
    const saved = await continuationService.save(proj)
    setProject(saved)
  }

  const handleAnalyzeChapter = async (idx: number) => {
    if (!activeConfigId || !project) return
    const ch = chapters[idx]
    setAnalyzingChapter(idx)
    try {
      const prompt = cs.buildChapterAnalysisPrompt(ch.title, ch.content, ch.chapterNumber, enabledDims)
      const reply = await aiService.chat([{ role: 'user', content: prompt }], activeConfigId)
      const m = reply.match(/\{[\s\S]*\}/)
      if (m) {
        const json = JSON.parse(m[0].replace(/,(\s*[}\]])/g, '$1'))
        const chars: any[] = json.charactersAppeared || []
        const analysis: ContinuationChapterAnalysis = {
          charactersAppeared: chars.map((c: any) => ({ name: c.name, role: (c.role || '其他') as CharacterRole, importance: c.importance || 0, action: c.action || '', newInfo: c.newInfo || '' })), plotEvents: json.plotEvents || [],
          foreshadowingPlanted: json.foreshadowingPlanted || [], foreshadowingResolved: json.foreshadowingResolved || [],
          worldbuildingRevealed: json.worldbuildingRevealed || [],
          powerSystemMentions: json.powerSystemMentions || [], itemsMentioned: json.itemsMentioned || [],
          factionsMentioned: json.factionsMentioned || [], locationsMentioned: json.locationsMentioned || [],
          emotionalTone: json.emotionalTone || '',
          timelinePosition: json.timelinePosition || '', chapterRole: json.chapterRole || 'development',
          unresolvedQuestions: json.unresolvedQuestions || [],
          // 快照数据提取
          characterSnapshots: (json.characterSnapshots || []).map((s: any) => ({ name: s.name || '', alive: s.alive !== false, powerLevel: s.powerLevel || '', location: s.location || '' })),
          itemSnapshots: (json.itemSnapshots || []).map((s: any) => ({ name: s.name || '', status: (s.status || '完好') as any, owner: s.owner || '' })),
          factionSnapshots: (json.factionSnapshots || []).map((s: any) => ({ name: s.name || '', status: (s.status || '活跃') as any, leader: s.leader || '' })),
          locationSnapshots: (json.locationSnapshots || []).map((s: any) => ({ name: s.name || '', status: (s.status || '存在') as any, significance: s.significance || '' })),
        }
        const updated = [...chapters]
        updated[idx] = { ...ch, analysis }
        setChapters(updated)
        await save({ sourceChapters: updated, status: 'analyzed' })
      }
    } catch (err) { logError('分析失败', err) }
    setAnalyzingChapter(null)
  }

  const handleAnalyzeRemaining = async () => {
    if (!activeConfigId) return
    setAnalyzing(true)
    const currentChapters = chaptersRef.current
    for (let i = 0; i < currentChapters.length; i++) { if (!currentChapters[i].analysis) await handleAnalyzeChapter(i) }
    setAnalyzing(false)
  }

  const handleAnalyzeSelected = async () => {
    if (!activeConfigId || selectedChapterIds.size === 0) return
    setAnalyzing(true)
    const currentChapters = chaptersRef.current
    const toAnalyze = [...selectedChapterIds].sort((a, b) => a - b)
    for (const idx of toAnalyze) {
      if (idx < currentChapters.length && !currentChapters[idx].analysis) {
        await handleAnalyzeChapter(idx)
      }
    }
    setSelectedChapterIds(new Set())
    setAnalyzing(false)
  }

  const handleReanalyzeChapter = async (idx: number) => {
    if (!activeConfigId || !project) return
    const ch = chapters[idx]
    if (!ch.analysis) return
    const { analysis: _removed, ...rest } = ch
    const updated = [...chapters]
    updated[idx] = rest as ContinuationChapter
    setChapters(updated)
    await save({ sourceChapters: updated, status: 'analyzed' })
    await handleAnalyzeChapter(idx)
  }

  const handleAggregate = async () => {
    if (!activeConfigId || !project) return
    setAggregating(true)
    try {
      const analyzed = chapters.filter(c => c.analysis)
      if (analyzed.length === 0) { setAggregating(false); return }

      // Helper to parse AI JSON reply
      const parseReply = (reply: string) => {
        const m = reply.match(/\{[\s\S]*\}/)
        return m ? JSON.parse(m[0].replace(/,(\s*[}\]])/g, '$1')) : null
      }

      const BATCH_SIZE = 50
      const totalChapters = chapters.length

      if (analyzed.length <= BATCH_SIZE) {
        // Direct aggregation (small novel)
        setAggregationProgress('直接聚合中...')
        const summaries = analyzed.map(c => `第${c.chapterNumber}章: ${c.analysis!.plotEvents.join('; ')}`)
        const prompt = cs.buildAggregationPrompt(summaries, totalChapters)
        const reply = await aiService.chat([{ role: 'user', content: prompt }], activeConfigId)
        const su = parseReply(reply) as StoryUnderstanding | null
        if (su) {
          su.powerSystemFinal = su.powerSystemFinal || { name: '', levels: '', description: '' }
          su.keyItemsFinal = su.keyItemsFinal || []
          su.factionsFinal = su.factionsFinal || []
          su.locationsFinal = su.locationsFinal || []
          su.foreshadowingUnresolved = su.foreshadowingUnresolved || []
          setStoryUnderstand(su); await save({ storyUnderstanding: su })
        }
      } else {
        // Multi-stage: batch → global
        const totalBatches = Math.ceil(analyzed.length / BATCH_SIZE)
        const batchResults: string[] = []
        let prevEndingState = ''

        // Stage 1: Batch aggregation
        for (let b = 0; b < totalBatches; b++) {
          const start = b * BATCH_SIZE
          const end = Math.min(start + BATCH_SIZE, analyzed.length)
          const batch = analyzed.slice(start, end)
          const firstChapter = batch[0].chapterNumber
          const lastChapter = batch[batch.length - 1].chapterNumber

          setAggregationProgress(`阶段聚合 (${b + 1}/${totalBatches}) 第${firstChapter}-${lastChapter}章`)
          const summaries = batch.map(c => `第${c.chapterNumber}章 ${c.title}: ${c.analysis!.plotEvents.join('; ')}`)
          const prompt = cs.buildBatchSummaryPrompt(summaries, b + 1, totalBatches, firstChapter, lastChapter, prevEndingState)
          const reply = await aiService.chat([{ role: 'user', content: prompt }], activeConfigId)
          const parsed = parseReply(reply)
          if (parsed) {
            batchResults.push(JSON.stringify(parsed))
            // Extract ending character states for next batch continuity
            if (parsed.endingCharacterStates) {
              prevEndingState = JSON.stringify(parsed.endingCharacterStates)
            }
          }
        }

        // Stage 2: Global aggregation with last-20 deep focus
        setAggregationProgress('全局聚合中...')
        const last20Start = Math.max(0, analyzed.length - 20)
        const last20Summaries = analyzed.slice(last20Start).map(c =>
          `第${c.chapterNumber}章 ${c.title}: 事件${c.analysis!.plotEvents.join('；')} | 角色${c.analysis!.charactersAppeared.map(a => a.name).join('、')} | 伏笔${c.analysis!.foreshadowingPlanted.concat(c.analysis!.foreshadowingResolved).join('、')}`
        )
        const prompt = cs.buildGlobalAggregationPrompt(batchResults, last20Summaries.join('\n\n'), totalChapters)
        const reply = await aiService.chat([{ role: 'user', content: prompt }], activeConfigId)
        const su = parseReply(reply) as StoryUnderstanding | null
        if (su) {
          su.powerSystemFinal = su.powerSystemFinal || { name: '', levels: '', description: '' }
          su.keyItemsFinal = su.keyItemsFinal || []
          su.factionsFinal = su.factionsFinal || []
          su.locationsFinal = su.locationsFinal || []
          su.foreshadowingUnresolved = su.foreshadowingUnresolved || []
          setStoryUnderstand(su); await save({ storyUnderstanding: su })
        }
      }
    } catch (err) { logError('聚合失败', err) }
    setAggregationProgress('')
    setAggregating(false)
  }

  const handlePlotDirection = async () => {
    if (!activeConfigId || !storyUnderstand) return
    setAggregating(true)
    try {
      const analyzed = chapters.filter(c => c.analysis)
      const lastStart = Math.max(0, analyzed.length - 20)
      const lastDetail = analyzed.slice(lastStart).map(c =>
        `第${c.chapterNumber}章 ${c.title}: ${c.analysis!.plotEvents.join('；')} | 角色:${c.analysis!.charactersAppeared.map(a => `${a.name}(${a.role})`).join('、')}`
      ).join('\n\n')
      const prompt = cs.buildPlotDirectionPrompt(JSON.stringify(storyUnderstand), lastDetail)
      const reply = await aiService.chat([{ role: 'user', content: prompt }], activeConfigId)
      const seg: PlotDirectionSegment = { id: 'pd_' + Date.now(), content: reply, label: '首次生成', generatedAt: new Date().toISOString() }
      setPlotDirection([seg])
      await save({ plotDirection: [seg], status: 'outlining' })
    } catch (err) { logError('剧情走向生成失败', err) }
    setAggregating(false)
  }

  const handleOutlineMerge = async () => {
    if (!activeConfigId || !storyUnderstand || plotDirection.length === 0) return
    setAggregating(true)
    const fullPlot = plotDirection.map(s => s.content).join('\n\n')
    try {
      const prompt = cs.buildOutlineMergePrompt(fullPlot, JSON.stringify(storyUnderstand))
      const reply = await aiService.chat([{ role: 'user', content: prompt }], activeConfigId)
      const m = reply.match(/\{[\s\S]*\}/)
      if (m) {
        const om = JSON.parse(m[0].replace(/,(\s*[}\]])/g, '$1')) as OutlineMergeData
        setOutlineMerge(om)
        await save({ outlineMerge: om, status: 'merged' })
      }
    } catch (err) { logError('大纲融合失败', err) }
    setAggregating(false)
  }

  const handleGeneratePlan = async () => {
    if (!activeConfigId || !storyUnderstand || plotDirection.length === 0) return
    setAggregating(true)
    // Estimate chapter count from plot direction (rough: ~3000 chars per chapter)
    const totalChars = plotDirection.reduce((sum, s) => sum + s.content.length, 0)
    const estimatedChapters = Math.max(5, Math.round(totalChars / 1000))
    try {
      const mergeJson = outlineMerge ? JSON.stringify(outlineMerge) : '{}'
      const prompt = cs.buildContinuationPlanPrompt(JSON.stringify(storyUnderstand), mergeJson, estimatedChapters)
      const reply = await aiService.chat([{ role: 'user', content: prompt }], activeConfigId)
      const m = reply.match(/\{[\s\S]*\}/)
      if (m) { const cp = JSON.parse(m[0].replace(/,(\s*[}\]])/g, '$1')) as ContinuationPlan; setContinuationPlan(cp); await save({ continuationPlan: cp, status: 'planned' }) }
    } catch (err) { logError('计划生成失败', err) }
    setAggregating(false)
  }

  const handleWriteChapter = async (plan: ContinuationChapterPlan) => {
    if (!activeConfigId) return
    setWritingLoading(true); setWritingContent('')
    const prevChs = project?.writtenChapters || []
    const prevSummary = prevChs.length > 0 ? prevChs.map(c => `第${c.chapterNumber}章: ${c.content.slice(0, 200)}...`).join('\n') : chapters.slice(-3).map(c => `第${c.chapterNumber}章: ${c.content.slice(0, 200)}...`).join('\n')
    const chars = storyUnderstand?.characterArcs?.map(c => `${c.name}: ${c.currentState}`).join('\n') || ''
    const rules = storyUnderstand?.worldRules?.join('\n') || ''

    // Build characterFocus objects with role/personality
    const charFocus = plan.characterFocus.map(name => {
      const arc = storyUnderstand?.characterArcs?.find(a => a.name === name)
      return { name, role: arc?.role || '其他', personality: arc?.personality || '', state: arc?.currentState || '' }
    })

    // Build constraints from outline merge
    const constraints: string[] = []
    if (outlineMerge) {
      const deadChars = outlineMerge.characters?.filter(c => c.ending.includes('死') || c.ending.includes('逝'))
      if (deadChars.length > 0) constraints.push(`已死亡角色(不可出现): ${deadChars.map(c => c.name).join('、')}`)
      const destroyedItems = outlineMerge.items?.filter(i => i.previousStatus.includes('毁') || i.previousStatus.includes('失'))
      if (destroyedItems.length > 0) constraints.push(`已毁/已失道具(不可使用): ${destroyedItems.map(i => i.name).join('、')}`)
      const destroyedFactions = outlineMerge.factions?.filter(f => f.previousStatus.includes('灭') || f.previousStatus.includes('亡'))
      if (destroyedFactions.length > 0) constraints.push(`已灭势力(不可出现): ${destroyedFactions.map(f => f.name).join('、')}`)
      if (outlineMerge.powerSystem?.length > 0) constraints.push(`等级体系: ${outlineMerge.powerSystem.map(p => `${p.name}(${p.originalLevels}→${p.newLevels})`).join('; ')}`)
    }
    if (storyUnderstand?.foreshadowingUnresolved?.length) {
      constraints.push(`待回收伏笔: ${storyUnderstand.foreshadowingUnresolved.map(f => f.description).join('; ')}`)
    }

    // 加载模板注入
    let styleInjection = ''
    let sceneInjection = ''
    try {
      if (selectedStyleTplId) styleInjection = await getTemplateInjection(selectedStyleTplId) || ''
      const sceneTpl = sceneTemplates.find(s => s.id === selectedSceneTplId)
      if (sceneTpl) {
        const cfg = sceneTpl.config as any
        if (sceneTpl.type === '情色小说') {
          sceneInjection = `场景类型: 情色 | 角色: ${cfg.characters?.map?.((c: any) => c.name || c.characterName).join(',') || ''} | 地点: ${cfg.location || ''} | 氛围: ${cfg.atmosphere || ''} | 字数: ${cfg.wordTarget || ''}`
        } else {
          sceneInjection = `场景类型: ${cfg.sceneType || ''} | 角色: ${cfg.characters?.map?.((c: any) => c.characterName || c.name).filter(Boolean).join(',') || cfg.povCharacterName || ''} | 地点: ${cfg.location || ''} | 情绪: ${cfg.dominantEmotion || ''} | 冲突: ${cfg.conflictType || ''} | 字数: ${cfg.wordTarget || ''} | 叙事: ${cfg.narrativeStyle || ''}`
        }
      }
    } catch { /* template injection optional */ }

    try {
      const prompt = cs.buildContinuationWritingPrompt(
        { ...plan, characterFocus: charFocus }, prevSummary, chars, rules, plan.relativeChapterNumber, constraints.join('\n'), styleInjection, sceneInjection)
      const result = await aiService.chat([{ role: 'user', content: prompt }], activeConfigId)
      setWritingContent(result)
      setWritingChapter({ chapterNumber: plan.relativeChapterNumber, title: plan.tentativeTitle, content: result, plan, generatedAt: new Date().toISOString() })
    } catch (err) { logError('续写失败', err) }
    setWritingLoading(false)
  }

  const handleSaveWritten = async () => {
    if (!writingChapter || !project) return
    const updated = { ...project, writtenChapters: [...project.writtenChapters.filter(c => c.chapterNumber !== writingChapter.chapterNumber), writingChapter].sort((a, b) => a.chapterNumber - b.chapterNumber) }
    const saved = await continuationService.save(updated)
    setProject(saved)
    setWritingChapter(null); setWritingContent('')
  }

  const analyzedCount = chapters.filter(c => c.analysis).length

  // Style constants
  if (!project) return <div style={{ flex: 1, padding: 24 }}><SkeletonCard lines={3} /></div>

  return (
    <div className="page-enter" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', gap: 12 }}>
        <Button variant="ghost" size="sm" onClick={() => navigate('/continuation')} icon={<ArrowLeftIcon style={{ width: 16, height: 16 }} />}>返回</Button>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#2d2520' }}>{project.name}</span>
        <div style={{ display: 'flex', gap: 0, marginLeft: 16 }}>
          {stepLabels.map((label, i) => (
            <div key={i} onClick={() => setStep((i + 1) as Step)} className="interactive-accent" style={{
              padding: '4px 10px', fontSize: 11, cursor: 'pointer', borderRadius: 6,
              color: step > i + 1 ? '#16a34a' : step === i + 1 ? '#7c3aed' : '#9b8e84',
              fontWeight: step === i + 1 ? 700 : 400, background: step === i + 1 ? 'rgba(124,58,237,0.06)' : 'transparent',
              display: 'flex', alignItems: 'center', gap: 2,
            }}>{step > i + 1 && <CheckCircleIcon style={{ width: 10, height: 10 }} />}{label}</div>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div className="glass" style={{ width: 210, borderRight: '1px solid rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '6px 10px', fontSize: 11, fontWeight: 600, color: '#6b5e54', borderBottom: '1px solid rgba(0,0,0,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>章节 ({analyzedCount}/{chapters.length})</span>
            <Button variant="ghost" size="sm" onClick={() => {
              if (selectedChapterIds.size === chapters.length) setSelectedChapterIds(new Set())
              else setSelectedChapterIds(new Set(chapters.map((_, i) => i)))
            }} style={{ fontSize: 10, padding: '1px 6px' }}>{selectedChapterIds.size === chapters.length ? '取消全选' : '全选'}</Button>
          </div>
          <ScrollArea style={{ flex: 1 }}>
            {chapters.map((ch, i) => (
              <div key={i} style={{ padding: '5px 8px', fontSize: 11, cursor: 'pointer', background: selectedChapterIdx === i ? 'rgba(124,58,237,0.06)' : 'transparent', borderLeft: selectedChapterIdx === i ? '2px solid #7c3aed' : '2px solid transparent', display: 'flex', alignItems: 'center', gap: 5 }}>
                <input type="checkbox" checked={selectedChapterIds.has(i)} onChange={() => {
                  setSelectedChapterIds(prev => { const next = new Set(prev); next.has(i) ? next.delete(i) : next.add(i); return next })
                }} onClick={e => e.stopPropagation()} style={{ width: 12, height: 12, cursor: 'pointer', accentColor: '#7c3aed', flexShrink: 0 }} />
                <span onClick={() => setSelectedChapterIdx(i)} style={{ display: 'flex', alignItems: 'center', gap: 5, flex: 1, minWidth: 0 }}>
                  <span style={{ color: ch.analysis ? '#16a34a' : '#d9d2cc', fontSize: 10, flexShrink: 0 }}>{ch.analysis ? '✓' : '○'}</span>
                  <span style={{ color: '#2d2520', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>第{ch.chapterNumber}章 {ch.title}</span>
                </span>
              </div>
            ))}
          </ScrollArea>
          <div style={{ padding: '6px 10px', borderTop: '1px solid rgba(0,0,0,0.04)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
              <span style={{ fontSize: 9, color: '#9b8e84' }}>分析维度({enabledDims.size}/{CONTINUATION_DIMS.length})</span>
              <Button variant="ghost" size="sm" onClick={() => setShowDimDialog(true)} style={{ fontSize: 9, padding: '1px 4px' }}>选择</Button>
            </div>
            <Button size="sm" onClick={handleAnalyzeRemaining} disabled={analyzing || !activeConfigId} style={{ width: '100%', fontSize: 10 }}>{analyzing ? '分析中...' : '分析剩余章节'}</Button>
            {selectedChapterIds.size > 0 && <Button size="sm" variant="secondary" onClick={handleAnalyzeSelected} disabled={analyzing || !activeConfigId} style={{ width: '100%', fontSize: 10 }}>分析选中({selectedChapterIds.size})</Button>}
          </div>
        </div>

        <ScrollArea style={{ flex: 1, padding: '16px 20px' }}>
          {step === 1 && (
            <div>
              {chapters.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 60 }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>📖</div>
                  <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>导入小说</h3>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                    <Button onClick={handleImport} disabled={importing} icon={<SparklesIcon style={{ width: 14, height: 14 }} />}>{importing ? '导入中...' : '选择 TXT 文件'}</Button>
                    <Button variant="secondary" onClick={async () => {
                      try {
                        const pp = `${projectsBasePath}/${activeProjectId}`
                        const files = await fileService.listDir(pp) as string[]
                        const txtFiles = files.filter(f => f.endsWith('.txt'))
                        if (txtFiles.length === 0) { alert('项目目录下无 TXT 文件。可让 AI 在 ai_workspace/ 创建。'); return }
                        const name = prompt(`选择文件:\n${txtFiles.map((f, i) => `${i + 1}. ${f}`).join('\n')}\n\n输入序号:`, '1')
                        if (!name) return
                        const idx = parseInt(name) - 1
                        if (isNaN(idx) || idx < 0 || idx >= txtFiles.length) { alert('无效选择'); return }
                        const result = await extractionService.importFromPath(`${pp}/${txtFiles[idx]}`)
                        if (result) await handleImportFromContent(result.name, result.content)
                      } catch (err) { alert('导入失败: ' + (err instanceof Error ? err.message : '未知错误')) }
                    }} icon={<FolderOpenIcon style={{ width: 14, height: 14 }} />}>从项目目录导入</Button>
                  </div>
                </div>
              ) : (
                <div>
                  <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>已导入 {chapters.length} 章</h3>
                  {chapters.map((ch, i) => (<div key={i} style={{ padding: '8px 12px', borderRadius: 8, background: '#faf9f8', fontSize: 12, display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}><span><strong>第{ch.chapterNumber}章</strong> {ch.title}</span><span style={{ color: '#9b8e84' }}>{ch.wordCount}字</span></div>))}
                  <Button size="sm" style={{ marginTop: 12 }} onClick={() => setStep(2)}>确认，进入分析</Button>
                </div>
              )}
            </div>
          )}

          {step === 2 && chapters.length > 0 && (
            <div style={{ display: 'flex', gap: 20, height: 'calc(100vh - 180px)' }}>
              <div style={{ flex: 5, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, flexShrink: 0 }}>第{chapters[selectedChapterIdx]?.chapterNumber}章 {chapters[selectedChapterIdx]?.title}<span style={{ fontWeight: 400, fontSize: 11, color: '#9b8e84', marginLeft: 8 }}>{chapters[selectedChapterIdx]?.wordCount}字</span></div>
                <div style={{ flex: 1, padding: '18px 22px', borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', fontSize: 13, lineHeight: 1.9, whiteSpace: 'pre-wrap', overflow: 'auto', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }} className="custom-scrollbar">{chapters[selectedChapterIdx]?.content}</div>
              </div>
              <div style={{ flex: 4, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 320, maxWidth: 520 }}>
                <div style={{ fontSize: 13, fontWeight: 700, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>分析结果</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {chapters[selectedChapterIdx]?.analysis ? (
                      <>
                        <span style={{ fontSize: 10, color: '#16a34a', fontWeight: 600 }}><CheckCircleIcon style={{ width: 12, height: 12, marginRight: 2, display: 'inline' }} />已分析</span>
                        <Button size="sm" variant="secondary" onClick={() => handleReanalyzeChapter(selectedChapterIdx)} disabled={analyzingChapter !== null} style={{ fontSize: 10, padding: '2px 8px' }} icon={<SparklesIcon style={{ width: 10, height: 10 }} />}>重新分析</Button>
                      </>
                    ) : <span style={{ fontSize: 10, color: '#9b8e84' }}>待分析</span>}
                  </div>
                </div>
                {chapters[selectedChapterIdx]?.analysis ? (
                  <div className="custom-scrollbar" style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={resultCard}><div style={resultCardHeader('#7c3aed')}>角色与事件</div><div style={resultCardBody}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: '#7c3aed', marginBottom: 4 }}>出场角色 ({chapters[selectedChapterIdx].analysis!.charactersAppeared.length})</div>
                      {chapters[selectedChapterIdx].analysis!.charactersAppeared.map((c, i) => (<div key={i} style={dimItem}><span style={{ fontWeight: 600 }}>{c.name}</span><span style={{ color: '#6b5e54' }}> — {c.action}</span>{c.newInfo && <span style={{ color: '#3b82f6', fontSize: 10 }}> [{c.newInfo}]</span>}</div>))}
                      <div style={{ fontSize: 10, fontWeight: 600, color: '#7c3aed', marginBottom: 4, marginTop: 8 }}>关键事件 ({chapters[selectedChapterIdx].analysis!.plotEvents.length})</div>
                      {chapters[selectedChapterIdx].analysis!.plotEvents.map((e, i) => (<div key={i} style={dimItem}>• {e}</div>))}
                    </div></div>
                    <div style={resultCard}><div style={resultCardHeader('#f59e0b')}>伏笔管理</div><div style={resultCardBody}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: '#f59e0b', marginBottom: 4 }}>新埋伏笔 ({chapters[selectedChapterIdx].analysis!.foreshadowingPlanted.length})</div>
                      {chapters[selectedChapterIdx].analysis!.foreshadowingPlanted.map((f, i) => (<div key={i} style={{ ...dimItem, borderLeft: '2px solid #f59e0b' }}>🌱 {f}</div>))}
                      <div style={{ fontSize: 10, fontWeight: 600, color: '#16a34a', marginBottom: 4, marginTop: 8 }}>回收伏笔 ({chapters[selectedChapterIdx].analysis!.foreshadowingResolved.length})</div>
                      {chapters[selectedChapterIdx].analysis!.foreshadowingResolved.map((f, i) => (<div key={i} style={{ ...dimItem, borderLeft: '2px solid #16a34a' }}>✅ {f}</div>))}
                    </div></div>
                    <div style={resultCard}><div style={resultCardHeader('#3b82f6')}>世界观与未解问题</div><div style={resultCardBody}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: '#3b82f6', marginBottom: 4 }}>世界观 ({chapters[selectedChapterIdx].analysis!.worldbuildingRevealed.length})</div>
                      {chapters[selectedChapterIdx].analysis!.worldbuildingRevealed.map((w, i) => (<div key={i} style={dimItem}>🌐 {w}</div>))}
                      {chapters[selectedChapterIdx].analysis!.worldbuildingRevealed.length === 0 && <div style={dimEmpty}>本章无新世界观信息</div>}
                      <div style={{ fontSize: 10, fontWeight: 600, color: '#ef4444', marginBottom: 4, marginTop: 8 }}>未解问题 ({chapters[selectedChapterIdx].analysis!.unresolvedQuestions.length})</div>
                      {chapters[selectedChapterIdx].analysis!.unresolvedQuestions.map((q, i) => (<div key={i} style={{ ...dimItem, borderLeft: '2px solid #ef4444' }}>❓ {q}</div>))}
                      {chapters[selectedChapterIdx].analysis!.unresolvedQuestions.length === 0 && <div style={dimEmpty}>无未解问题</div>}
                    </div></div>
                    {(chapters[selectedChapterIdx].analysis!.powerSystemMentions.length > 0 || chapters[selectedChapterIdx].analysis!.itemsMentioned.length > 0 || chapters[selectedChapterIdx].analysis!.factionsMentioned.length > 0 || chapters[selectedChapterIdx].analysis!.locationsMentioned.length > 0) && (
                      <div style={resultCard}><div style={resultCardHeader('#8b5cf6')}>设定元素</div><div style={resultCardBody}>
                        {chapters[selectedChapterIdx].analysis!.powerSystemMentions.length > 0 && <>
                          <div style={{ fontSize: 10, fontWeight: 600, color: '#8b5cf6', marginBottom: 4, marginTop: 2 }}>⚡ 等级体系</div>
                          {chapters[selectedChapterIdx].analysis!.powerSystemMentions.map((p, i) => (<div key={i} style={dimItem}><strong>{p.name}</strong> {p.levels}: {p.detail}</div>))}
                        </>}
                        {chapters[selectedChapterIdx].analysis!.itemsMentioned.length > 0 && <>
                          <div style={{ fontSize: 10, fontWeight: 600, color: '#8b5cf6', marginBottom: 4, marginTop: 6 }}>🗡️ 道具</div>
                          {chapters[selectedChapterIdx].analysis!.itemsMentioned.map((it, i) => (<div key={i} style={dimItem}><strong>{it.name}</strong> [{it.type}]: {it.ability}{it.owner ? ` (持有者: ${it.owner})` : ''}</div>))}
                        </>}
                        {chapters[selectedChapterIdx].analysis!.factionsMentioned.length > 0 && <>
                          <div style={{ fontSize: 10, fontWeight: 600, color: '#8b5cf6', marginBottom: 4, marginTop: 6 }}>🏛️ 势力</div>
                          {chapters[selectedChapterIdx].analysis!.factionsMentioned.map((f, i) => (<div key={i} style={dimItem}><strong>{f.name}</strong> [{f.type}]: {f.detail}</div>))}
                        </>}
                        {chapters[selectedChapterIdx].analysis!.locationsMentioned.length > 0 && <>
                          <div style={{ fontSize: 10, fontWeight: 600, color: '#8b5cf6', marginBottom: 4, marginTop: 6 }}>📍 地点</div>
                          {chapters[selectedChapterIdx].analysis!.locationsMentioned.map((l, i) => (<div key={i} style={dimItem}><strong>{l.name}</strong> [{l.type}]: {l.detail}</div>))}
                        </>}
                      </div></div>
                    )}
                    <div style={{ padding: '8px 12px', borderRadius: 8, background: '#faf9f8', fontSize: 10, color: '#6b5e54', display: 'flex', gap: 16, flexShrink: 0 }}>
                      <span>🎭 {chapters[selectedChapterIdx].analysis!.emotionalTone}</span><span>📍 {chapters[selectedChapterIdx].analysis!.timelinePosition}</span><span>📐 {chapters[selectedChapterIdx].analysis!.chapterRole}</span>
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: '20px 16px', borderRadius: 12, background: '#faf9f8', border: '1px dashed rgba(0,0,0,0.1)', textAlign: 'center' }}>
                    <div style={{ fontSize: 12, color: '#9b8e84', marginBottom: 12 }}>点击"分析本章"或"全部分析"</div>
                    <Button size="sm" onClick={() => handleAnalyzeChapter(selectedChapterIdx)} disabled={analyzingChapter === selectedChapterIdx} icon={<SparklesIcon style={{ width: 12, height: 12 }} />}>{analyzingChapter === selectedChapterIdx ? '分析中...' : '分析本章'}</Button>
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 3 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}><h3 style={{ fontSize: 15, fontWeight: 700 }}>分析结果汇总</h3><div style={{ display: 'flex', gap: 8 }}><Button size="sm" onClick={handleAggregate} disabled={aggregating || !activeConfigId || analyzedCount === 0} icon={<SparklesIcon style={{ width: 12, height: 12 }} />}>{aggregating ? (aggregationProgress || '聚合中...') : `AI 全局理解${analyzedCount > 50 ? ` (${Math.ceil(analyzedCount / 50)}批)` : ''}`}</Button><Button size="sm" variant="secondary" onClick={() => setStep(4)}>跳过 →</Button></div></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
                {chapters.filter(c => c.analysis).map((ch, i) => (<div key={i} style={{ padding: '10px 12px', borderRadius: 10, background: '#faf9f8', fontSize: 11 }}><div style={{ fontWeight: 600, marginBottom: 4 }}>第{ch.chapterNumber}章 [{ch.analysis!.chapterRole}]</div><div>角色: {ch.analysis!.charactersAppeared.map(a => a.name).join('、')}</div><div>事件: {ch.analysis!.plotEvents.slice(0, 3).join('; ')}</div></div>))}
              </div>
              {storyUnderstand && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ padding: 12, borderRadius: 10, background: 'rgba(124,58,237,0.04)', border: '1px solid rgba(124,58,237,0.1)' }}><div style={{ fontSize: 12, fontWeight: 700, color: '#7c3aed', marginBottom: 6 }}>角色 ({storyUnderstand.characterArcs?.length || 0})</div>{storyUnderstand.characterArcs?.slice(0, 12).map((c, i) => (<div key={i} style={{ fontSize: 11, marginTop: 3 }}><strong>{c.name}</strong>: {c.currentState} | {c.arcType} | {c.unresolved ? '⚠' : '✓'} | 预测: {c.predictedDirection}</div>))}</div>
                  <div style={{ fontSize: 12 }}><strong>主线:</strong> {storyUnderstand.mainPlot}</div>
                  <div style={{ fontSize: 12 }}><strong>未完问题:</strong> {(storyUnderstand.unresolvedQuestions || []).join('; ')}</div>
                  <div style={{ fontSize: 12 }}><strong>阶段:</strong> {storyUnderstand.currentStage} | <strong>结构:</strong> {storyUnderstand.storyStructure}</div>
                </div>
              )}
            </div>
          )}

          {step === 4 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}><h3 style={{ fontSize: 15, fontWeight: 700 }}>剧情走向</h3><Button size="sm" onClick={handlePlotDirection} disabled={aggregating || !activeConfigId} icon={<SparklesIcon style={{ width: 12, height: 12 }} />}>{aggregating ? '生成中...' : 'AI 生成剧情走向'}</Button></div>
              {plotDirection.length > 0 ? (
                <div>
                  <div style={{ padding: '20px 24px', borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', fontSize: 14, lineHeight: 2, whiteSpace: 'pre-wrap', marginBottom: 16, maxHeight: '50vh', overflow: 'auto' }} className="custom-scrollbar">{plotDirection.map(s => s.content).join('\n\n')}</div>
                  <div style={{ fontSize: 10, color: '#9b8e84', marginBottom: 16 }}>共 {plotDirection.length} 段，约 {plotDirection.reduce((s, seg) => s + seg.content.length, 0)} 字</div>
                  <Button onClick={() => setStep(5)}>进入大纲融合 →</Button>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: 60, color: '#9b8e84' }}>
                  <p style={{ fontSize: 14, marginBottom: 8 }}>点击按钮让 AI 以叙事方式写出续写的整体剧情走向</p>
                  <p style={{ fontSize: 12 }}>不是结构大纲，而是连贯的剧情描述文字</p>
                </div>
              )}
            </div>
          )}

          {step === 5 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}><h3 style={{ fontSize: 15, fontWeight: 700 }}>大纲融合</h3><Button size="sm" onClick={handleOutlineMerge} disabled={aggregating || !activeConfigId || !plotDirection} icon={<SparklesIcon style={{ width: 12, height: 12 }} />}>{aggregating ? '生成中...' : 'AI 生成新大纲'}</Button></div>
              {outlineMerge ? (
                <div className="custom-scrollbar" style={{ maxHeight: '60vh', overflow: 'auto' }}>
                  <div style={{ fontSize: 13, color: '#4a3f38', lineHeight: 1.8, marginBottom: 16, padding: '12px 16px', borderRadius: 10, background: '#faf9f8' }}><strong>基础设定:</strong> {outlineMerge.basicSettingUpdate}</div>
                  {outlineMerge.characters?.length > 0 && (
                    <div style={{ marginBottom: 12 }}><div style={{ fontSize: 12, fontWeight: 700, color: '#7c3aed', marginBottom: 6 }}>角色变化 ({outlineMerge.characters.length})</div>
                      {outlineMerge.characters.map((c, i) => (<div key={i} style={{ padding: '8px 12px', borderRadius: 8, background: '#faf9f8', marginBottom: 4, fontSize: 11 }}><strong>{c.name}</strong> [{c.role}] {c.originalStatus} → {c.newStatus} | 结局: {c.ending}</div>))}
                    </div>
                  )}
                  {outlineMerge.items?.length > 0 && (
                    <div style={{ marginBottom: 12 }}><div style={{ fontSize: 12, fontWeight: 700, color: '#f59e0b', marginBottom: 6 }}>道具流转 ({outlineMerge.items.length})</div>
                      {outlineMerge.items.map((it, i) => (<div key={i} style={{ padding: '8px 12px', borderRadius: 8, background: '#faf9f8', marginBottom: 4, fontSize: 11 }}><strong>{it.name}</strong> [{it.type}] {it.previousStatus} → {it.newStatus} | 持有: {it.owner}</div>))}
                    </div>
                  )}
                  {outlineMerge.factions?.length > 0 && (
                    <div style={{ marginBottom: 12 }}><div style={{ fontSize: 12, fontWeight: 700, color: '#ef4444', marginBottom: 6 }}>势力变化 ({outlineMerge.factions.length})</div>
                      {outlineMerge.factions.map((f, i) => (<div key={i} style={{ padding: '8px 12px', borderRadius: 8, background: '#faf9f8', marginBottom: 4, fontSize: 11 }}><strong>{f.name}</strong> [{f.type}] {f.previousStatus} → {f.newStatus}</div>))}
                    </div>
                  )}
                  {outlineMerge.newForeshadowing?.length > 0 && <div style={{ marginBottom: 12, fontSize: 11 }}><strong>新增伏笔:</strong> {outlineMerge.newForeshadowing.map(f => f.description).join('；')}</div>}
                  <Button onClick={() => setStep(6)} style={{ marginTop: 8 }}>进入续写细纲 →</Button>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: 60, color: '#9b8e84' }}>
                  <p style={{ fontSize: 14, marginBottom: 8 }}>基于剧情走向生成续写部分的大纲元素</p>
                  <p style={{ fontSize: 12 }}>角色/道具/势力/地点/等级/伏笔/故事线 将融入原著大纲</p>
                </div>
              )}
            </div>
          )}

          {step === 6 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}><h3 style={{ fontSize: 15, fontWeight: 700 }}>续写细纲</h3><Button size="sm" onClick={handleGeneratePlan} disabled={aggregating || !activeConfigId || !plotDirection} icon={<SparklesIcon style={{ width: 12, height: 12 }} />}>{aggregating ? '生成中...' : 'AI 生成'}</Button></div>
              {continuationPlan && (<div><div style={{ fontSize: 12, marginBottom: 8, color: '#6b5e54' }}>{continuationPlan.overallDirection} | 结局: {continuationPlan.endingType} | {continuationPlan.chapterPlans?.length || 0} 章</div>{continuationPlan.chapterPlans?.map((plan, i) => (<div key={i} style={{ padding: '10px 14px', borderRadius: 10, background: '#faf9f8', marginBottom: 8 }}><div style={{ fontSize: 12, fontWeight: 600, display: 'flex', justifyContent: 'space-between' }}><span>续第{i + 1}章: {plan.tentativeTitle}</span><span style={{ fontSize: 10, color: '#9b8e84' }}>~{plan.wordTarget}字</span></div><div style={{ fontSize: 11, marginTop: 4 }}>剧情: {plan.plotPoints.join(' → ')}</div><div style={{ fontSize: 11 }}>角色: {plan.characterFocus.join('、')}</div><Button size="sm" style={{ marginTop: 4 }} onClick={() => { setStep(7); handleWriteChapter(plan) }} icon={<PencilIcon style={{ width: 11, height: 11 }} />}>续写本章</Button></div>))}</div>)}
            </div>
          )}

          {step === 7 && continuationPlan && (
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ width: 200, flexShrink: 0 }}>
                {/* 模板注入选择器 */}
                <div style={{ marginBottom: 12, padding: '8px 10px', borderRadius: 8, background: 'rgba(124,58,237,0.03)', border: '1px solid rgba(124,58,237,0.08)' }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: '#7c3aed', marginBottom: 6 }}>模板注入</div>
                  <select value={selectedStyleTplId} onChange={e => setSelectedStyleTplId(e.target.value)} style={{ width: '100%', padding: '3px 6px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.1)', fontSize: 10, fontFamily: 'inherit', marginBottom: 4 }}>
                    <option value="">风格: 无</option>
                    {styleTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                  <select value={selectedSceneTplId} onChange={e => setSelectedSceneTplId(e.target.value)} style={{ width: '100%', padding: '3px 6px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.1)', fontSize: 10, fontFamily: 'inherit' }}>
                    <option value="">场景: 无</option>
                    {sceneTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>续写计划</div>
                {continuationPlan.chapterPlans?.map((plan, i) => {
                  const written = project?.writtenChapters?.find(c => c.chapterNumber === plan.relativeChapterNumber)
                  return (
                    <div key={i} onClick={() => handleWriteChapter(plan)} style={{
                      padding: '8px 10px', borderRadius: 8, cursor: 'pointer', marginBottom: 4,
                      background: written ? 'rgba(22,163,74,0.04)' : '#faf9f8',
                      border: '1px solid rgba(0,0,0,0.04)',
                    }}>
                      <div style={{ fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                        {written && <CheckCircleIcon style={{ width: 12, height: 12, color: '#16a34a' }} />}
                        续第{i + 1}章
                      </div>
                      <div style={{ fontSize: 10, color: '#9b8e84' }}>{plan.tentativeTitle}</div>
                    </div>
                  )
                })}
              </div>
              <div style={{ flex: 1 }}>
                {writingLoading && <div style={{ textAlign: 'center', padding: 40, color: '#7c3aed' }}>AI 续写中...</div>}
                {writingContent && !writingLoading && (
                  <div>
                    <div style={{ padding: '16px 20px', borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', fontSize: 13, lineHeight: 1.8, whiteSpace: 'pre-wrap', maxHeight: '60vh', overflow: 'auto' }} className="custom-scrollbar">{writingContent}</div>
                    <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                      <Button onClick={handleSaveWritten} icon={<CheckCircleIcon style={{ width: 14, height: 14 }} />}>保存</Button>
                      <Button variant="secondary" onClick={() => { setWritingContent(''); setWritingChapter(null) }}>放弃</Button>
                    </div>
                  </div>
                )}
                {!writingLoading && !writingContent && <div style={{ textAlign: 'center', padding: 40, color: '#9b8e84', fontSize: 13 }}>点击左侧章节开始续写</div>}
              </div>
            </div>
          )}
        </ScrollArea>
      </div>

      <DimensionSelectDialog isOpen={showDimDialog} enabledDims={enabledDims} activeProjectId={activeProjectId} onClose={() => setShowDimDialog(false)} onUpdate={(dims) => setEnabledDims(dims)} />
    </div>
  )
}
