import { useEffect, useState, useMemo, useRef } from 'react'
import { useStore, useSettingsStore } from '@/store'
import { styleProjectService, aiService, styleTemplateService } from '@/services/fileService'
import { chatAI } from '@/utils/chatAI'
import type { StyleTemplate } from '@/types/styleTemplate'
import { getTemplateDims } from '@/types/styleTemplate'
import type { DimAnalysis } from '@/types/story'
import { DIMENSION_META, NOVEL_TYPE_LABELS, NOVEL_TYPES, NOVEL_TYPE_DIMS } from '@/types/story'
import { nanoid } from 'nanoid'
import { buildStyleAnalyzePrompt, parseStyleAnalysisReply, buildSummarizePrompt } from '@/services/extractionService'
import { logError } from '@/utils/logger'
import { splitChaptersByHeadings } from '@/utils/textUtils'
import type { StyleProject, StyleChapter, StyleProfile, StyleProjectMeta, ChapterAnalysis } from '@/types/story'
import type { ViewMode, ResultTab, WorkspaceTab, SortKey } from '../constants'
import { splitChapters, FEATURE_LABELS, SORT_OPTIONS, WORLD_TYPE_PRESETS, ATTITUDE_PRESETS } from '../constants'

export function useStyleWorkshop() {
  const setActivePage = useStore(s => s.setActivePage)
  const fileEditNotify = useStore(s => s.fileEditNotify)
  const setFileEditNotify = useStore(s => s.setFileEditNotify)
  const activeProjectId = useStore(s => s.activeProjectId)
  const projectsBasePath = useStore(s => s.projectsBasePath)
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('archives')
  const [view, setView] = useState<ViewMode>('library')
  const [projects, setProjects] = useState<StyleProjectMeta[]>([])
  const [selectedProject, setSelectedProject] = useState<StyleProject | null>(null)
  const [loading, setLoading] = useState(false)

  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null)
  const [analyzeIds, setAnalyzeIds] = useState<Set<string>>(new Set())
  const [analyzeProgress, setAnalyzeProgress] = useState('')
  const [analyzeLoading, setAnalyzeLoading] = useState(false)
  const [analyzeMode, setAnalyzeMode] = useState<'precise' | 'quick'>('precise')
  const [showDimConfig, setShowDimConfig] = useState(false)
  const [showDimDetail, setShowDimDetail] = useState(false)
  const [detailType, setDetailType] = useState('通用')
  const [enabledDimensions, setEnabledDimensions] = useState<string[]>(NOVEL_TYPE_DIMS['通用'] || [])
  const [showResult, setShowResult] = useState(false)
  const [resultTab, setResultTab] = useState<ResultTab>('chapters')
  const [summarizeLoading, setSummarizeLoading] = useState(false)

  const [showApply, setShowApply] = useState(false)
  const projectsList = useStore(s => s.projects)

  const [templates, setTemplates] = useState<StyleTemplate[]>([])
  const [showCreateTemplate, setShowCreateTemplate] = useState(false)
  const [editTemplate, setEditTemplate] = useState<StyleTemplate | null>(null)
  const [templateTab, setTemplateTab] = useState<string>('all')
  const [aiGenLoading, setAiGenLoading] = useState(false)
  const [templateSearch, setTemplateSearch] = useState('')
  const [templateSort, setTemplateSort] = useState<SortKey>('updatedAt')
  const [expandedDims, setExpandedDims] = useState<Set<string>>(new Set())
  const [customWorldType, setCustomWorldType] = useState('')
  const [customAttitude, setCustomAttitude] = useState('')

  const saveCounter = useRef(0)
  const isDirty = useRef(false)

  // Auto-expand all dimensions when a template is opened for editing
  const prevEditId = useRef<string | undefined>(undefined)
  useEffect(() => {
    const currentId = editTemplate ? (editTemplate.id || '__new__') : undefined
    if (currentId && currentId !== prevEditId.current) {
      setExpandedDims(new Set(getTemplateDims(editTemplate!.type)))
    }
    prevEditId.current = currentId
  }, [editTemplate])

  const toggleDimExpanded = (key: string) => {
    setExpandedDims(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const loadTemplates = async () => {
    try {
      const globalList = await styleTemplateService.list() as any[]
      let projectList: any[] = []
      if (activeProjectId && projectsBasePath) {
        try {
          projectList = await styleTemplateService.listProject(`${projectsBasePath}/${activeProjectId}`) as any[]
        } catch { /* project dir may not exist */ }
      }
      const seen = new Set(globalList.map((t: any) => t.id))
      const merged = [...globalList]
      for (const t of projectList) { if (!seen.has(t.id)) { merged.push(t); seen.add(t.id) } }
      setTemplates(merged)
    } catch { setTemplates([]) }
  }

  useEffect(() => { setActivePage('style-workshop'); loadTemplates() }, [])

  useEffect(() => {
    if (fileEditNotify?.filePath?.includes('style_templates')) loadTemplates()
  }, [fileEditNotify])

  const styleAssignments = useSettingsStore(s => s.aiSettings.styleAssignments || {})
  const setStyleAssignments = useSettingsStore(s => s.setAISettings)
  const activeConfigId = useSettingsStore(s => s.activeConfigId)

  useEffect(() => { loadProjects() }, [])

  const loadProjects = async () => {
    try { setProjects(await styleProjectService.listProjects() as StyleProjectMeta[]) } catch { /* */ }
  }

  const filteredAndSortedTemplates = useMemo(() => {
    let list = [...templates]
    if (templateTab !== 'all') list = list.filter(t => t.type === templateTab)
    if (templateSearch.trim()) {
      const q = templateSearch.trim().toLowerCase()
      list = list.filter(t => t.name.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q))
    }
    list.sort((a, b) => {
      switch (templateSort) {
        case 'name': return a.name.localeCompare(b.name, 'zh-CN')
        case 'type': return (a.type || '').localeCompare(b.type || '', 'zh-CN')
        case 'dimCount': return Object.keys(b.dimensions || {}).length - Object.keys(a.dimensions || {}).length
        default: return new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime()
      }
    })
    return list
  }, [templates, templateTab, templateSearch, templateSort])

  const markDirty = () => { isDirty.current = true }

  const updateDim = (key: string, field: keyof DimAnalysis, value: string | string[]) => {
    if (!editTemplate) return; markDirty()
    const dims = { ...editTemplate.dimensions }
    const existing = dims[key] || { description: '', examples: [], writingRules: [], vocabularyList: [] }
    dims[key] = { ...existing, [field]: value }
    setEditTemplate({ ...editTemplate, dimensions: dims })
  }

  const addVocabItem = (dimKey: string) => {
    if (!editTemplate) return; markDirty()
    const dims = { ...editTemplate.dimensions }
    const existing = dims[dimKey] || { description: '', examples: [], writingRules: [], vocabularyList: [] }
    dims[dimKey] = { ...existing, vocabularyList: [...existing.vocabularyList, ''] }
    setEditTemplate({ ...editTemplate, dimensions: dims })
  }

  const updateVocabItem = (dimKey: string, idx: number, value: string) => {
    if (!editTemplate) return; markDirty()
    const dims = { ...editTemplate.dimensions }
    const list = [...(dims[dimKey]?.vocabularyList || [])]
    list[idx] = value
    dims[dimKey] = { ...dims[dimKey], vocabularyList: list }
    setEditTemplate({ ...editTemplate, dimensions: dims })
  }

  const removeVocabItem = (dimKey: string, idx: number) => {
    if (!editTemplate) return; markDirty()
    const dims = { ...editTemplate.dimensions }
    const list = [...(dims[dimKey]?.vocabularyList || [])]
    list.splice(idx, 1)
    dims[dimKey] = { ...dims[dimKey], vocabularyList: list }
    setEditTemplate({ ...editTemplate, dimensions: dims })
  }

  const addRule = (dimKey: string) => {
    if (!editTemplate) return; markDirty()
    const dims = { ...editTemplate.dimensions }
    const existing = dims[dimKey] || { description: '', examples: [], writingRules: [], vocabularyList: [] }
    dims[dimKey] = { ...existing, writingRules: [...existing.writingRules, ''] }
    setEditTemplate({ ...editTemplate, dimensions: dims })
  }

  const updateRule = (dimKey: string, idx: number, value: string) => {
    if (!editTemplate) return; markDirty()
    const dims = { ...editTemplate.dimensions }
    const list = [...(dims[dimKey]?.writingRules || [])]
    list[idx] = value
    dims[dimKey] = { ...dims[dimKey], writingRules: list }
    setEditTemplate({ ...editTemplate, dimensions: dims })
  }

  const removeRule = (dimKey: string, idx: number) => {
    if (!editTemplate) return; markDirty()
    const dims = { ...editTemplate.dimensions }
    const list = [...(dims[dimKey]?.writingRules || [])]
    list.splice(idx, 1)
    dims[dimKey] = { ...dims[dimKey], writingRules: list }
    setEditTemplate({ ...editTemplate, dimensions: dims })
  }

  const handleImport = async () => {
    setLoading(true)
    try {
      const result = await styleProjectService.importFile() as { name: string; content: string } | null
      if (!result) { setLoading(false); return }
      const chapters = splitChapters(result.content)
      const dims = NOVEL_TYPE_DIMS['通用']
      const project: StyleProject = {
        id: `sp_${nanoid(8)}`, name: result.name.replace(/\.txt$/i, ''),
        sourceFileName: result.name, chapters, profile: null,
        createdAt: new Date().toISOString(), totalCharCount: result.content.length,
        enabledDimensions: dims, novelType: '通用',
      }
      await styleProjectService.saveProject(project)
      await loadProjects()
      setSelectedProject(project)
      setEnabledDimensions(dims)
      setView('detail')
    } catch (err) { logError('导入TXT失败', err); alert('导入失败') }
    setLoading(false)
  }

  const handleEnterProject = async (meta: StyleProjectMeta) => {
    setLoading(true)
    try {
      const proj = await styleProjectService.loadProject(meta.id) as StyleProject
      proj.chapters = proj.chapters.map(c => ({ ...c, analysis: c.analysis || null, analyzed: c.analyzed || false }))
      if (!proj.novelType) proj.novelType = '通用'
      if (!proj.enabledDimensions?.length) proj.enabledDimensions = NOVEL_TYPE_DIMS[proj.novelType] || NOVEL_TYPE_DIMS['通用']
      setSelectedProject(proj); setSelectedChapterId(proj.chapters[0]?.id || null)
      setEnabledDimensions(proj.enabledDimensions)
      setAnalyzeIds(new Set()); setAnalyzeProgress(''); setView('detail')
    } catch { /* */ }
    setLoading(false)
  }

  const handleDeleteProject = async (meta: StyleProjectMeta) => {
    if (!confirm(`确定删除「${meta.name}」？`)) return
    await styleProjectService.deleteProject(meta.id)
    await loadProjects()
    if (selectedProject?.id === meta.id) { setSelectedProject(null); setView('library') }
  }

  const toggleAnalyzeId = (id: string) => {
    setAnalyzeIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  const clearChapterAnalysis = async (chapterId: string) => {
    if (!selectedProject) return
    const updated = {
      ...selectedProject,
      chapters: selectedProject.chapters.map(c => c.id === chapterId ? { ...c, analysis: null, analyzed: false } : c),
      profile: selectedProject.profile ? { ...selectedProject.profile, analyzedChapterCount: Math.max(0, (selectedProject.profile.analyzedChapterCount || 1) - 1) } : null,
    }
    setSelectedProject(updated)
    await styleProjectService.saveProject(updated)
    await loadProjects()
  }

  const shuffleChapters = (arr: StyleChapter[]): StyleChapter[] => {
    const a = [...arr]
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]]
    }
    return a
  }

  const batchSaveProject = () => {
    saveCounter.current++
    if (saveCounter.current % 10 === 0 && selectedProject) {
      styleProjectService.saveProject(selectedProject).catch(err => logError('批量保存失败', err))
    }
  }
  const finalSaveProject = () => {
    if (selectedProject) {
      styleProjectService.saveProject(selectedProject).catch(err => logError('最终保存失败', err))
    }
  }

  const handleAnalyze = async () => {
    if (!selectedProject || !activeConfigId) return
    if (enabledDimensions.length === 0) { alert('请先配置分析维度（点击「配置维度」按钮）'); return }
    const chaptersToAnalyze = selectedProject.chapters.filter(c => analyzeIds.has(c.id))
    if (chaptersToAnalyze.length === 0) return
    setAnalyzeLoading(true)
    saveCounter.current = 0
    try {
      if (analyzeMode === 'quick') {
        const sample = shuffleChapters(chaptersToAnalyze).slice(0, 10)
        setAnalyzeProgress(`抽样分析: 0/${sample.length}`)
        for (let idx = 0; idx < sample.length; idx++) {
          try {
            const ch = sample[idx]
            const reply = await chatAI([{ role: 'user' as const, content: `${buildStyleAnalyzePrompt(enabledDimensions, selectedProject.novelType)}\n\n[${ch.title}]\n${ch.content}` }], activeConfigId)
            updateChapterAnalysis(ch.id, parseStyleAnalysisReply(reply, enabledDimensions))
            batchSaveProject()
          } catch (err) { logError(`分析章节失败: ${sample[idx].title}`, err) }
          setAnalyzeProgress(`抽样分析: ${idx + 1}/${sample.length}`)
        }
      } else {
        const batches: StyleChapter[][] = []
        for (let i = 0; i < chaptersToAnalyze.length; i += 3) batches.push(chaptersToAnalyze.slice(i, i + 3))
        for (let i = 0; i < batches.length; i++) {
          setAnalyzeProgress(`全量分析: ${i + 1}/${batches.length} 批...`)
          for (const ch of batches[i]) {
            try {
              const reply = await chatAI([{ role: 'user' as const, content: `${buildStyleAnalyzePrompt(enabledDimensions, selectedProject.novelType)}\n\n[${ch.title}]\n${ch.content}` }], activeConfigId)
              updateChapterAnalysis(ch.id, parseStyleAnalysisReply(reply, enabledDimensions))
              batchSaveProject()
            } catch (err) { logError(`分析章节失败: ${ch.title}`, err) }
          }
        }
      }
      finalSaveProject()
      setAnalyzeProgress('分析完成')
    } catch (err) { logError('风格分析失败', err); setAnalyzeProgress('分析失败') }
    setAnalyzeLoading(false)
  }

  const updateChapterAnalysis = async (chapterId: string, analysis: ChapterAnalysis) => {
    if (!selectedProject) return
    setSelectedProject(prev => {
      if (!prev) return prev
      const updated = {
        ...prev,
        chapters: prev.chapters.map(c => c.id === chapterId ? { ...c, analysis, analyzed: true } : c),
      }
      return updated
    })
  }

  const handleSummarize = async () => {
    if (!selectedProject || !activeConfigId) return
    const analyzedChapters = selectedProject.chapters.filter(c => c.analysis)
    if (analyzedChapters.length === 0) { alert('没有已分析的章节'); return }
    setSummarizeLoading(true)
    try {
      const dimSummaryParts: string[] = []
      for (const ch of analyzedChapters) {
        if (ch.analysis?.dimAnalyses && Object.keys(ch.analysis.dimAnalyses).length > 0) {
          const parts = [`[${ch.title}]`]
          for (const [dk, da] of Object.entries(ch.analysis.dimAnalyses)) {
            const meta = DIMENSION_META[dk]
            parts.push(`  ${dk}(${meta?.label || dk}): ${(da as DimAnalysis).description?.slice(0, 150) || ''}`)
          }
          dimSummaryParts.push(parts.join('\n'))
        }
      }

      const aggregatedDimAnalyses: Record<string, DimAnalysis> = {}
      for (const ch of analyzedChapters) {
        if (ch.analysis?.dimAnalyses) {
          for (const [dk, da] of Object.entries(ch.analysis.dimAnalyses)) {
            const existing = aggregatedDimAnalyses[dk]
            if (!existing) {
              aggregatedDimAnalyses[dk] = { ...(da as DimAnalysis) }
            } else {
              const mergedExamples = [...existing.examples]
              for (const ex of (da as DimAnalysis).examples || []) { if (!mergedExamples.includes(ex)) mergedExamples.push(ex) }
              const mergedVocab = [...existing.vocabularyList]
              for (const v of (da as DimAnalysis).vocabularyList || []) { if (!mergedVocab.includes(v)) mergedVocab.push(v) }
              aggregatedDimAnalyses[dk] = {
                description: existing.description || (da as DimAnalysis).description,
                examples: mergedExamples.slice(0, 30),
                writingRules: [...new Set([...(existing.writingRules || []), ...((da as DimAnalysis).writingRules || [])])],
                vocabularyList: mergedVocab.slice(0, 80),
              }
            }
          }
        }
      }

      let fullDescription = ''
      if (dimSummaryParts.length > 0) {
        const dimSummary = dimSummaryParts.join('\n\n')
        const prompt = buildSummarizePrompt(analyzedChapters.length, dimSummary, selectedProject.novelType || '通用')
        const reply = await chatAI([{ role: 'user' as const, content: prompt }], activeConfigId)
        const analysisResult = parseStyleAnalysisReply(reply, enabledDimensions)
        if (analysisResult.dimAnalyses) {
          for (const [dk, da] of Object.entries(analysisResult.dimAnalyses)) {
            if (!aggregatedDimAnalyses[dk]) {
              aggregatedDimAnalyses[dk] = da
            } else {
              aggregatedDimAnalyses[dk] = {
                ...aggregatedDimAnalyses[dk],
                description: da.description || aggregatedDimAnalyses[dk].description,
              }
            }
          }
        }
        fullDescription = analysisResult.dimAnalyses
          ? Object.entries(analysisResult.dimAnalyses).map(([k, d]) => `${DIMENSION_META[k]?.label || k}: ${d.description?.slice(0, 80)}`).join('; ')
          : `已分析${analyzedChapters.length}章，${Object.keys(aggregatedDimAnalyses).length}个维度`
      } else {
        const strFields = analyzedChapters[0]?.analysis
        fullDescription = strFields
          ? `句式: ${strFields.sentenceStyle || ''}; 词汇: ${strFields.vocabularyStyle || ''}; 节奏: ${strFields.rhythmStyle || ''}; 对话: ${strFields.dialogueStyle || ''}`
          : `已分析${analyzedChapters.length}章`
      }

      const profile: StyleProfile = {
        features: {
          sentenceStyle: aggregatedDimAnalyses['sentenceStyle']?.description || '',
          vocabularyStyle: aggregatedDimAnalyses['vocabularyStyle']?.description || '',
          rhetoricStyle: aggregatedDimAnalyses['rhetoricStyle']?.description || '',
          rhythmStyle: aggregatedDimAnalyses['rhythmStyle']?.description || '',
          dialogueStyle: aggregatedDimAnalyses['dialogueStyle']?.description || '',
          moodStyle: aggregatedDimAnalyses['moodStyle']?.description || '',
          perspectiveStyle: aggregatedDimAnalyses['perspectiveStyle']?.description || '',
          bodyLanguageStyle: aggregatedDimAnalyses['bodyLanguageStyle']?.description || '',
          sensoryStyle: aggregatedDimAnalyses['sensoryStyle']?.description || '',
          tensionStyle: aggregatedDimAnalyses['tensionStyle']?.description || '',
          subtextStyle: aggregatedDimAnalyses['subtextStyle']?.description || '',
          // 复杂维度：V3格式以文本描述存于dimAnalyses，features中保留null（类型为结构化对象，无法用纯文本填充）
          // UI展示和风格注入时直接读取dimAnalyses
          descriptionPattern: null, corruptionArc: null, degradationRitual: null,
          narrativeVoice: null, sceneMechanics: null, somaticTension: null,
          identityDissolution: null, shameVoyeurLoop: null,
        },
        fullDescription,
        excerpts: [],
        analyzedAt: new Date().toISOString(),
        analyzedChapterCount: analyzedChapters.length,
        dimAnalyses: Object.keys(aggregatedDimAnalyses).length > 0 ? aggregatedDimAnalyses : undefined,
      }
      const updated = { ...selectedProject, profile }
      setSelectedProject(updated)
      await styleProjectService.saveProject(updated)
      await loadProjects()
      setResultTab('overall')
    } catch (err) { logError('总结失败', err); alert('总结失败') }
    setSummarizeLoading(false)
  }

  const handleClearProfile = async () => {
    if (!selectedProject) return
    const updated = { ...selectedProject, profile: null }
    setSelectedProject(updated)
    await styleProjectService.saveProject(updated)
    await loadProjects()
  }

  const handleApplyStyle = async (targetProjectId: string, styleProjectId: string) => {
    const updated = { ...styleAssignments, [targetProjectId]: styleProjectId ? styleProjectId : '' }
    if (!styleProjectId) delete updated[targetProjectId]
    setStyleAssignments({ styleAssignments: updated })
  }

  const handleSaveAsTemplate = async () => {
    if (!selectedProject?.profile) return
    const profile = selectedProject.profile
    const dims = profile.dimAnalyses || {}
    const vocabList: string[] = []
    const rulesList: string[] = []
    for (const da of Object.values(dims)) {
      if ((da as any).vocabularyList) vocabList.push(...(da as any).vocabularyList)
      if ((da as any).writingRules) rulesList.push(...(da as any).writingRules)
    }
    const reverseTypeMap: Record<string, string> = {}
    for (const [label, short] of Object.entries(NOVEL_TYPE_LABELS)) { reverseTypeMap[short] = label }
    const templateType = (reverseTypeMap[selectedProject.novelType] || '普通小说') as StyleTemplate['type']

    const template: StyleTemplate = {
      id: '', name: selectedProject.name || 'AI分析模板',
      type: templateType,
      worldType: '', description: profile.fullDescription?.slice(0, 100) || '',
      fullDescription: profile.fullDescription || '',
      dimensions: dims as any,
      vocabularyList: [...new Set(vocabList)].slice(0, 100),
      writingRules: [...new Set(rulesList)].slice(0, 50),
      tone: { word: '', description: '', attitude: '' },
      source: 'ai-generated',
      sourceProjectId: selectedProject.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    try {
      await styleTemplateService.save(template)
      await loadTemplates()
      setWorkspaceTab('ws.templates')
      alert('已保存为风格模板！')
    } catch { alert('保存失败') }
  }

  const handleCloneTemplate = async (t: StyleTemplate) => {
    const clone: StyleTemplate = { ...t, id: '', name: `${t.name} (副本)`, source: 'manual', sourceProjectId: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    try { await styleTemplateService.save(clone); await loadTemplates() } catch { alert('复制失败') }
  }

  const handleDeleteTemplate = async (t: StyleTemplate) => {
    if (!confirm(`确定删除模板「${t.name}」？`)) return
    try { await styleTemplateService.delete(t.id); await loadTemplates() } catch { alert('删除失败') }
  }

  const handleCreateFromType = (type: string, name: string) => {
    const n = name.trim() || '新模板'
    const t: StyleTemplate = {
      id: '', name: n, type: type as StyleTemplate['type'], worldType: '', description: '',
      fullDescription: '', dimensions: {}, vocabularyList: [], writingRules: [],
      tone: { word: '', description: '', attitude: '' }, source: 'manual',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }
    setShowCreateTemplate(false)
    isDirty.current = false
    setEditTemplate(t)
  }

  const [templateSaving, setTemplateSaving] = useState(false)

  const handleSaveTemplate = async () => {
    if (!editTemplate || templateSaving) return
    const clean = { ...editTemplate }
    if (clean.worldType === '__custom__') clean.worldType = ''
    if (clean.tone?.attitude === '__custom__') clean.tone = { ...clean.tone, attitude: '' }
    setTemplateSaving(true)
    try {
      const saved = await styleTemplateService.save({ ...clean, updatedAt: new Date().toISOString() })
      await loadTemplates()
      setFileEditNotify({ filePath: 'style_templates/' + (saved.id || ''), newContent: '' })
      isDirty.current = false
      setEditTemplate(null)
      setExpandedDims(new Set())
      setCustomWorldType('')
      setCustomAttitude('')
    } catch { alert('保存失败') }
    setTemplateSaving(false)
  }

  const selectedChapter = selectedProject?.chapters.find(c => c.id === selectedChapterId)
  const analyzedChapters = selectedProject?.chapters.filter(c => c.analysis) || []

  return {
    view, setView,
    workspaceTab, setWorkspaceTab,
    projects, loading,
    handleImport, handleEnterProject, handleDeleteProject,
    loadProjects,
    templates, showCreateTemplate, setShowCreateTemplate,
    editTemplate, setEditTemplate,
    templateTab, setTemplateTab,
    aiGenLoading, setAiGenLoading,
    templateSearch, setTemplateSearch,
    templateSort, setTemplateSort,
    expandedDims,
    customWorldType, setCustomWorldType,
    customAttitude, setCustomAttitude,
    filteredAndSortedTemplates,
    loadTemplates,
    handleCloneTemplate, handleDeleteTemplate,
    handleCreateFromType, handleSaveTemplate, templateSaving, isDirty,
    toggleDimExpanded, updateDim,
    addVocabItem, updateVocabItem, removeVocabItem,
    addRule, updateRule, removeRule,
    selectedProject, setSelectedProject,
    selectedChapterId, setSelectedChapterId,
    analyzeIds, setAnalyzeIds,
    analyzeProgress, setAnalyzeProgress,
    analyzeLoading,
    analyzeMode, setAnalyzeMode,
    showDimConfig, setShowDimConfig,
    showDimDetail, setShowDimDetail,
    detailType, setDetailType,
    enabledDimensions, setEnabledDimensions,
    showResult, setShowResult,
    resultTab, setResultTab,
    summarizeLoading,
    showApply, setShowApply,
    selectedChapter, analyzedChapters,
    toggleAnalyzeId, clearChapterAnalysis,
    handleAnalyze, handleSummarize, handleClearProfile,
    handleApplyStyle, handleSaveAsTemplate,
    projectsList, styleAssignments, activeConfigId,
    setActivePage,
  }
}
