import { useEffect, useState, useMemo } from 'react'
import { useStore, useSettingsStore } from '@/store'
import { styleProjectService, aiService, styleTemplateService } from '@/services/fileService'
import type { StyleTemplate } from '@/types/styleTemplate'
import { getTemplateDims } from '@/types/styleTemplate'
import type { DimAnalysis } from '@/types/story'
import { DIMENSION_META, NOVEL_TYPE_LABELS, NOVEL_TYPES, NOVEL_TYPE_DIMS } from '@/types/story'
import { nanoid } from 'nanoid'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from '@/components/common/GlassCard'
import Button from '@/components/common/Button'
import Modal from '@/components/common/Modal'
import ScrollArea from '@/components/common/ScrollArea'
import { inputStyle } from '@/components/common/styles'
import { buildStyleAnalyzePromptV3, parseStyleAnalysisReplyV3, buildSummarizePromptV3 } from '@/services/extractionService'
import { logError } from '@/utils/logger'
import { splitChaptersByHeadings } from '@/utils/textUtils'
import type { StyleProject, StyleChapter, StyleProfile, StyleProjectMeta, ChapterAnalysis } from '@/types/story'
import {
  SparklesIcon, PlusIcon, TrashIcon, XMarkIcon,
  DocumentTextIcon, PaintBrushIcon, FolderOpenIcon,
  ArrowLeftIcon, MagnifyingGlassIcon, ArrowsUpDownIcon,
  ArrowPathIcon, TagIcon,
} from '@heroicons/react/24/outline'

type ViewMode = 'library' | 'detail'
type ResultTab = 'chapters' | 'overall'
type WorkspaceTab = 'archives' | 'templates'
type SortKey = 'updatedAt' | 'name' | 'type' | 'dimCount'

function splitChapters(content: string): StyleChapter[] {
  let chapterNum = 0
  return splitChaptersByHeadings(content).map(r => {
    chapterNum++
    return {
      id: `ch_${chapterNum}`, title: r.title, chapterNumber: chapterNum,
      chapterType: r.chapterType as StyleChapter['chapterType'],
      content: r.content, charCount: r.content.length, analyzed: false, analysis: null,
    }
  })
}
const FEATURE_LABELS: Record<string, string> = {
  narrativeTone: '叙事基调', sentenceStyle: '句式', vocabularyStyle: '词汇', rhetoricStyle: '修辞',
  rhythmStyle: '节奏', dialogueStyle: '对话', moodStyle: '氛围',
  perspectiveStyle: '视角', bodyLanguageStyle: '身体', sensoryStyle: '感官',
  tensionStyle: '张力', subtextStyle: '暗示', descriptionPattern: '描写结构',
  corruptionArc: '人物演变', degradationRitual: '场景机制', narrativeVoice: '叙事声音', shameVoyeurLoop: '心理循环',
  socialRealism: '社会现实', cultivationCombat: '修炼战斗', romanceArc: '感情发展', archaicStyle: '古风文言', suspensePacing: '悬疑节奏',
  compoundWordPattern: '造词模式', onomatopoeiaSystem: '拟声词系统', sensoryPackFormula: '感官打包',
  bodyMindBetrayal: '身心背离', humiliationTemplate: '羞辱公式',
}

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'updatedAt', label: '最新' },
  { key: 'name', label: '名称' },
  { key: 'type', label: '类型' },
  { key: 'dimCount', label: '维度' },
]

const WORLD_TYPE_PRESETS = ['古代', '现代', '西幻', '日系', '末日', '科幻', '灵异', '架空历史', '玄幻', '游戏', '混合']
const ATTITUDE_PRESETS = ['冷漠旁观', '欣赏把玩', '幽默调侃', '温柔包容', '神圣庄严', '冷酷写实', '热忱歌颂', '暧昧诱导', '疑惑探索']

export default function StyleWorkshopPage() {
  const setActivePage = useStore(s => s.setActivePage)
  const fileEditNotify = useStore(s => s.fileEditNotify)
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

  // 风格模板状态
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

  // Reload when AI creates style templates
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

  // ── Computed template list ──
  const filteredAndSortedTemplates = useMemo(() => {
    let list = [...templates]
    // Filter by type
    if (templateTab !== 'all') list = list.filter(t => t.type === templateTab)
    // Search by name
    if (templateSearch.trim()) {
      const q = templateSearch.trim().toLowerCase()
      list = list.filter(t => t.name.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q))
    }
    // Sort
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

  // ── Dim editing helpers (from TemplateLibraryPage) ──
  const updateDim = (key: string, field: keyof DimAnalysis, value: string | string[]) => {
    if (!editTemplate) return
    const dims = { ...editTemplate.dimensions }
    const existing = dims[key] || { description: '', examples: [], writingRules: [], vocabularyList: [] }
    dims[key] = { ...existing, [field]: value }
    setEditTemplate({ ...editTemplate, dimensions: dims })
  }

  const addVocabItem = (dimKey: string) => {
    if (!editTemplate) return
    const dims = { ...editTemplate.dimensions }
    const existing = dims[dimKey] || { description: '', examples: [], writingRules: [], vocabularyList: [] }
    dims[dimKey] = { ...existing, vocabularyList: [...existing.vocabularyList, ''] }
    setEditTemplate({ ...editTemplate, dimensions: dims })
  }

  const updateVocabItem = (dimKey: string, idx: number, value: string) => {
    if (!editTemplate) return
    const dims = { ...editTemplate.dimensions }
    const list = [...(dims[dimKey]?.vocabularyList || [])]
    list[idx] = value
    dims[dimKey] = { ...dims[dimKey], vocabularyList: list }
    setEditTemplate({ ...editTemplate, dimensions: dims })
  }

  const removeVocabItem = (dimKey: string, idx: number) => {
    if (!editTemplate) return
    const dims = { ...editTemplate.dimensions }
    const list = [...(dims[dimKey]?.vocabularyList || [])]
    list.splice(idx, 1)
    dims[dimKey] = { ...dims[dimKey], vocabularyList: list }
    setEditTemplate({ ...editTemplate, dimensions: dims })
  }

  const addRule = (dimKey: string) => {
    if (!editTemplate) return
    const dims = { ...editTemplate.dimensions }
    const existing = dims[dimKey] || { description: '', examples: [], writingRules: [], vocabularyList: [] }
    dims[dimKey] = { ...existing, writingRules: [...existing.writingRules, ''] }
    setEditTemplate({ ...editTemplate, dimensions: dims })
  }

  const updateRule = (dimKey: string, idx: number, value: string) => {
    if (!editTemplate) return
    const dims = { ...editTemplate.dimensions }
    const list = [...(dims[dimKey]?.writingRules || [])]
    list[idx] = value
    dims[dimKey] = { ...dims[dimKey], writingRules: list }
    setEditTemplate({ ...editTemplate, dimensions: dims })
  }

  const removeRule = (dimKey: string, idx: number) => {
    if (!editTemplate) return
    const dims = { ...editTemplate.dimensions }
    const list = [...(dims[dimKey]?.writingRules || [])]
    list.splice(idx, 1)
    dims[dimKey] = { ...dims[dimKey], writingRules: list }
    setEditTemplate({ ...editTemplate, dimensions: dims })
  }

  // ── Archived project operations ──

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

  // ---- Analysis ----
  // Fisher-Yates shuffle (unbiased, non-mutating)
  const shuffleChapters = (arr: StyleChapter[]): StyleChapter[] => {
    const a = [...arr]
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]]
    }
    return a
  }

  let saveCounter = 0
  const batchSaveProject = () => {
    saveCounter++
    if (saveCounter % 10 === 0 && selectedProject) {
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
    saveCounter = 0
    try {
      if (analyzeMode === 'quick') {
        const sample = shuffleChapters(chaptersToAnalyze).slice(0, 10)
        setAnalyzeProgress(`抽样分析: 0/${sample.length}`)
        for (let idx = 0; idx < sample.length; idx++) {
          try {
            const ch = sample[idx]
            const reply = await aiService.chat([{ role: 'user' as const, content: `${buildStyleAnalyzePromptV3(enabledDimensions)}\n\n[${ch.title}]\n${ch.content}` }], activeConfigId)
            updateChapterAnalysis(ch.id, parseStyleAnalysisReplyV3(reply, enabledDimensions))
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
              const reply = await aiService.chat([{ role: 'user' as const, content: `${buildStyleAnalyzePromptV3(enabledDimensions)}\n\n[${ch.title}]\n${ch.content}` }], activeConfigId)
              updateChapterAnalysis(ch.id, parseStyleAnalysisReplyV3(reply, enabledDimensions))
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

  // ---- Summarize (V3 format) ----
  const handleSummarize = async () => {
    if (!selectedProject || !activeConfigId) return
    const analyzedChapters = selectedProject.chapters.filter(c => c.analysis)
    if (analyzedChapters.length === 0) { alert('没有已分析的章节'); return }
    setSummarizeLoading(true)
    try {
      // Build dimAnalyses summary from all analyzed chapters
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

      // First, manually aggregate dimAnalyses across chapters
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

      // Use V3 summarization if there are dimAnalyses, otherwise fall back to string-based summary
      let fullDescription = ''
      if (dimSummaryParts.length > 0) {
        const dimSummary = dimSummaryParts.join('\n\n')
        const prompt = buildSummarizePromptV3(analyzedChapters.length, dimSummary, selectedProject.novelType || '通用')
        const reply = await aiService.chat([{ role: 'user' as const, content: prompt }], activeConfigId)
        const v3Result = parseStyleAnalysisReplyV3(reply, enabledDimensions)
        // Merge AI-summarized dimAnalyses with the manually-aggregated ones
        if (v3Result.dimAnalyses) {
          for (const [dk, da] of Object.entries(v3Result.dimAnalyses)) {
            if (!aggregatedDimAnalyses[dk]) {
              aggregatedDimAnalyses[dk] = da
            } else {
              // AI summary takes description priority, manual aggregation keeps examples/vocab
              aggregatedDimAnalyses[dk] = {
                ...aggregatedDimAnalyses[dk],
                description: da.description || aggregatedDimAnalyses[dk].description,
              }
            }
          }
        }
        fullDescription = v3Result.dimAnalyses
          ? Object.entries(v3Result.dimAnalyses).map(([k, d]) => `${DIMENSION_META[k]?.label || k}: ${d.description?.slice(0, 80)}`).join('; ')
          : `已分析${analyzedChapters.length}章，${Object.keys(aggregatedDimAnalyses).length}个维度`
      } else {
        // Fallback: build simple summary from legacy string fields
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
    const template: StyleTemplate = {
      id: '', name: selectedProject.name || 'AI分析模板',
      type: selectedProject.novelType === '情色' ? '情色小说' : '普通小说',
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
      setWorkspaceTab('templates')
      alert('已保存为风格模板！')
    } catch { alert('保存失败') }
  }

  // ── 模板操作 ──
  const handleCloneTemplate = async (t: StyleTemplate) => {
    const clone: StyleTemplate = { ...t, id: '', name: `${t.name} (副本)`, source: 'manual', sourceProjectId: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    try { await styleTemplateService.save(clone); await loadTemplates() } catch { alert('复制失败') }
  }

  const handleDeleteTemplate = async (t: StyleTemplate) => {
    if (!confirm(`确定删除模板「${t.name}」？`)) return
    try { await styleTemplateService.delete(t.id); await loadTemplates() } catch { alert('删除失败') }
  }

  const handleCreateFromType = (type: string) => {
    const name = (document.getElementById('newTmplName') as HTMLInputElement)?.value?.trim() || '新模板'
    const t: StyleTemplate = {
      id: '', name, type: type as StyleTemplate['type'], worldType: '', description: '',
      fullDescription: '', dimensions: {}, vocabularyList: [], writingRules: [],
      tone: { word: '', description: '', attitude: '' }, source: 'manual',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }
    setShowCreateTemplate(false)
    setEditTemplate(t)
  }

  const handleSaveTemplate = async () => {
    if (!editTemplate) return
    // Clean up sentinel values from custom inputs
    const clean = { ...editTemplate }
    if (clean.worldType === '__custom__') clean.worldType = ''
    if (clean.tone?.attitude === '__custom__') clean.tone = { ...clean.tone, attitude: '' }
    try {
      await styleTemplateService.save({ ...clean, updatedAt: new Date().toISOString() })
      await loadTemplates()
      setEditTemplate(null)
      setExpandedDims(new Set())
      setCustomWorldType('')
      setCustomAttitude('')
    } catch { alert('保存失败') }
  }

  const selectedChapter = selectedProject?.chapters.find(c => c.id === selectedChapterId)
  const analyzedChapters = selectedProject?.chapters.filter(c => c.analysis) || []

  // ============ LIBRARY VIEW ============
  if (view === 'library') {
    return (
      <div className="page-enter" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: 32 }}>
        <ScrollArea style={{ flex: 1 }}>
        <div style={{ maxWidth: 960, width: '100%', margin: '0 auto' }}>
          {/* Tabs */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
            <div style={{ display: 'flex', gap: 4, background: 'rgba(0,0,0,0.03)', borderRadius: 14, padding: 4 }}>
              {([
                ['archives', '风格档案', PaintBrushIcon],
                ['templates', '风格模板', TagIcon],
              ] as [WorkspaceTab, string, React.ComponentType<{ style?: React.CSSProperties }>][]).map(([tab, label, Icon]) => (
                <button key={tab} onClick={() => setWorkspaceTab(tab)} style={{
                  padding: '9px 22px', borderRadius: 11, border: 'none',
                  background: workspaceTab === tab ? '#fff' : 'transparent',
                  color: workspaceTab === tab ? '#7c3aed' : '#9b8e84',
                  fontSize: 13, fontWeight: workspaceTab === tab ? 700 : 500,
                  cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.2s',
                  boxShadow: workspaceTab === tab ? '0 2px 8px rgba(0,0,0,0.08)' : 'none',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                }}>
                  <Icon style={{ width: 16, height: 16 }} />{label}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {workspaceTab === 'archives' && (
                <Button onClick={handleImport} disabled={loading} icon={<FolderOpenIcon style={{ width: 16, height: 16 }} />}>
                  {loading ? '导入中...' : '导入TXT小说'}
                </Button>
              )}
              {workspaceTab === 'templates' && (
                <Button onClick={() => setShowCreateTemplate(true)} icon={<PlusIcon style={{ width: 16, height: 16 }} />}>
                  新建模板
                </Button>
              )}
            </div>
          </div>

          {/* Archives Tab */}
          {workspaceTab === 'archives' && (
            <div>
              <div style={{ marginBottom: 20 }}>
                <h2 style={{ fontSize: 20, fontWeight: 700, color: '#2d2520', margin: '0 0 4px' }}>风格档案</h2>
                <p style={{ fontSize: 13, color: '#9b8e84', margin: 0 }}>导入名家作品，AI分析提取写作风格</p>
              </div>
              {projects.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 80, color: '#9b8e84' }}>
                  <PaintBrushIcon style={{ width: 56, height: 56, margin: '0 auto 16px', opacity: 0.2 }} />
                  <p style={{ fontSize: 15 }}>暂无风格档案</p>
                  <p style={{ fontSize: 12, marginTop: 4 }}>导入TXT小说开始分析</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {projects.map(p => (
                    <GlassCard key={p.id} hover={false} style={{ padding: 20 }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                        <div style={{ flex: 1 }}>
                          <h3 style={{ fontSize: 16, fontWeight: 700, color: '#2d2520', marginBottom: 6 }}>{p.name}</h3>
                          <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#9b8e84' }}>
                            <span>{p.sourceFileName}</span>
                            <span>{p.chapterCount}章</span>
                            <span>{(p.totalCharCount/10000).toFixed(1)}万字</span>
                            <span style={{ color: '#7c3aed' }}>{p.novelType || '通用'}</span>
                            {p.hasProfile && <span style={{ color: '#16a34a', fontWeight: 600 }}>✓ 已总结</span>}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <Button size="sm" onClick={() => handleEnterProject(p)}>查看详情</Button>
                          <Button size="sm" variant="ghost" onClick={() => { handleEnterProject(p); setTimeout(() => setShowApply(true), 100) }}>应用</Button>
                          {p.hasProfile && (
                            <Button size="sm" variant="ghost" onClick={async () => {
                              const proj = await styleProjectService.loadProject(p.id) as StyleProject
                              setSelectedProject(proj)
                              setTimeout(() => handleSaveAsTemplate(), 100)
                            }}>存为模板</Button>
                          )}
                          <button onClick={() => handleDeleteProject(p)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, color: '#d4ccc4' }}>
                            <TrashIcon style={{ width: 16, height: 16 }} />
                          </button>
                        </div>
                      </div>
                    </GlassCard>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ───── 风格模板 Tab ───── */}
          {workspaceTab === 'templates' && (
            <div>
              <div style={{ marginBottom: 20 }}>
                <h2 style={{ fontSize: 20, fontWeight: 700, color: '#2d2520', margin: '0 0 4px' }}>风格模板</h2>
                <p style={{ fontSize: 13, color: '#9b8e84', margin: 0 }}>管理风格模板，让AI写出你想要的文风</p>
              </div>

              {/* Search + Sort bar */}
              <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'center' }}>
                <div style={{
                  flex: 1, display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 14px', borderRadius: 12,
                  background: 'rgba(255,255,255,0.7)', border: '1px solid rgba(0,0,0,0.06)',
                  backdropFilter: 'blur(8px)',
                }}>
                  <MagnifyingGlassIcon style={{ width: 16, height: 16, color: '#9b8e84', flexShrink: 0 }} />
                  <input
                    value={templateSearch}
                    onChange={e => setTemplateSearch(e.target.value)}
                    placeholder="搜索模板名称或描述..."
                    style={{
                      flex: 1, border: 'none', outline: 'none', background: 'transparent',
                      fontSize: 13, color: '#2d2520', fontFamily: 'inherit',
                    }}
                  />
                  {templateSearch && (
                    <button onClick={() => setTemplateSearch('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9b8e84', padding: 0, display: 'flex' }}>
                      <XMarkIcon style={{ width: 14, height: 14 }} />
                    </button>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 2, background: 'rgba(0,0,0,0.03)', borderRadius: 10, padding: 3 }}>
                  {SORT_OPTIONS.map(opt => (
                    <button
                      key={opt.key}
                      onClick={() => setTemplateSort(opt.key)}
                      style={{
                        padding: '6px 12px', borderRadius: 8, border: 'none',
                        background: templateSort === opt.key ? '#fff' : 'transparent',
                        color: templateSort === opt.key ? '#7c3aed' : '#9b8e84',
                        fontSize: 11, fontWeight: templateSort === opt.key ? 600 : 400,
                        cursor: 'pointer', fontFamily: 'inherit',
                        boxShadow: templateSort === opt.key ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        transition: 'all 0.15s',
                      }}
                    >
                      {opt.key === 'updatedAt' && <ArrowsUpDownIcon style={{ width: 12, height: 12 }} />}
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Type filter tag cloud */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 18, flexWrap: 'wrap', alignItems: 'center' }}>
                {(['all', ...Object.keys(NOVEL_TYPE_LABELS)] as const).map(t => {
                  const selected = templateTab === t
                  const isErotic = t === '情色小说'
                  return (
                    <motion.button
                      key={t}
                      onClick={() => setTemplateTab(t)}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      style={{
                        padding: '5px 14px', borderRadius: 20, border: selected
                          ? `1.5px solid ${isErotic ? 'rgba(236,72,153,0.3)' : 'rgba(124,58,237,0.25)'}`
                          : '1px solid rgba(0,0,0,0.06)',
                        background: selected
                          ? isErotic ? 'rgba(236,72,153,0.06)' : 'rgba(124,58,237,0.06)'
                          : 'transparent',
                        color: selected ? (isErotic ? '#ec4899' : '#7c3aed') : '#9b8e84',
                        fontSize: 11, fontWeight: selected ? 600 : 400,
                        cursor: 'pointer', fontFamily: 'inherit',
                        transition: 'background 0.15s, border 0.15s',
                      }}
                    >
                      {t === 'all' ? '全部' : NOVEL_TYPE_LABELS[t] || t}
                    </motion.button>
                  )
                })}
              </div>

              {/* Template Cards Grid */}
              {filteredAndSortedTemplates.length === 0 ? (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  style={{
                    textAlign: 'center', padding: 64, color: '#9b8e84',
                    background: 'rgba(255,255,255,0.4)', borderRadius: 20,
                    border: '2px dashed rgba(0,0,0,0.06)',
                  }}
                >
                  <TagIcon style={{ width: 44, height: 44, margin: '0 auto 12px', opacity: 0.25 }} />
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, color: '#6b5e54' }}>
                    {templateSearch ? '没有匹配的模板' : '暂无风格模板'}
                  </div>
                  <div style={{ fontSize: 12 }}>
                    {templateSearch ? '换个搜索词试试' : (
                      <>切换到「<span style={{ color: '#7c3aed', fontWeight: 600, cursor: 'pointer' }} onClick={() => setWorkspaceTab('archives')}>风格档案</span>」导入小说分析后保存为模板，或点击"新建模板"手动创建</>
                    )}
                  </div>
                  {!templateSearch && (
                    <Button size="sm" style={{ marginTop: 12 }} onClick={() => setShowCreateTemplate(true)} icon={<PlusIcon style={{ width: 14, height: 14 }} />}>
                      新建模板
                    </Button>
                  )}
                </motion.div>
              ) : (
                <motion.div
                  initial="hidden"
                  animate="visible"
                  variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.04 } } }}
                  style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}
                >
                  {filteredAndSortedTemplates.map(t => {
                    const totalDims = getTemplateDims(t.type).length
                    const filledDims = Object.values(t.dimensions || {}).filter(d => (d as DimAnalysis)?.description).length
                    const fillPct = totalDims > 0 ? Math.round((filledDims / totalDims) * 100) : 0
                    const isErotic = t.type === '情色小说'
                    const accentColor = isErotic ? '#ec4899' : '#7c3aed'
                    const accentBg = isErotic ? 'rgba(236,72,153,0.06)' : 'rgba(124,58,237,0.06)'

                    return (
                      <motion.div
                        key={t.id}
                        variants={{ hidden: { opacity: 0, y: 16 }, visible: { opacity: 1, y: 0 } }}
                        whileHover={{ y: -4, boxShadow: '0 12px 32px rgba(0,0,0,0.1), 0 0 0 1px rgba(124,58,237,0.08)' }}
                        onClick={() => setEditTemplate(t)}
                        style={{
                          padding: '18px 20px', borderRadius: 16,
                          background: 'rgba(255,255,255,0.75)', backdropFilter: 'blur(12px)',
                          border: '1px solid rgba(255,255,255,0.6)',
                          boxShadow: '0 4px 16px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.03)',
                          cursor: 'pointer', transition: 'box-shadow 0.2s ease',
                          display: 'flex', flexDirection: 'column', gap: 10,
                        }}
                      >
                        {/* Top row: type badge + source */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{
                            fontSize: 10, fontWeight: 600, padding: '2px 10px', borderRadius: 10,
                            background: `linear-gradient(135deg, ${accentColor}15, ${accentColor}08)`,
                            color: accentColor, border: `1px solid ${accentColor}20`,
                          }}>
                            {isErotic ? '🔥 ' : '📖 '}{NOVEL_TYPE_LABELS[t.type] || t.type}
                          </span>
                          <span style={{ fontSize: 10, color: '#9b8e84' }}>
                            {t.source === 'ai-generated' ? '🤖 AI' : '✏️ 手动'}
                          </span>
                        </div>

                        {/* Name */}
                        <h4 style={{
                          fontSize: 15, fontWeight: 700, color: '#2d2520',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          margin: 0, lineHeight: 1.3,
                        }}>
                          {t.name || '未命名模板'}
                        </h4>

                        {/* Description */}
                        <p style={{
                          fontSize: 11, color: '#6b5e54', margin: 0,
                          overflow: 'hidden', display: '-webkit-box',
                          WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                          lineHeight: 1.5, minHeight: 33,
                        }}>
                          {t.description || t.fullDescription?.slice(0, 100) || '暂无描述'}
                        </p>

                        {/* Progress bar */}
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 10 }}>
                            <span style={{ color: '#9b8e84' }}>维度填充</span>
                            <span style={{ color: fillPct > 0 ? accentColor : '#9b8e84', fontWeight: 600 }}>
                              {filledDims}/{totalDims} ({fillPct}%)
                            </span>
                          </div>
                          <div style={{
                            height: 4, borderRadius: 2, background: 'rgba(0,0,0,0.05)',
                            overflow: 'hidden',
                          }}>
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${fillPct}%` }}
                              transition={{ duration: 0.6, ease: 'easeOut' }}
                              style={{
                                height: '100%', borderRadius: 2,
                                background: fillPct > 0
                                  ? `linear-gradient(90deg, ${accentColor}80, ${accentColor})`
                                  : 'rgba(0,0,0,0.04)',
                              }}
                            />
                          </div>
                        </div>

                        {/* Info row */}
                        <div style={{ display: 'flex', gap: 10, fontSize: 10, color: '#9b8e84', flexWrap: 'wrap' }}>
                          {t.worldType && <span>🌍 {t.worldType}</span>}
                          {t.tone?.word && <span>🎭 {t.tone.word.slice(0, 8)}</span>}
                          <span>{new Date(t.updatedAt).toLocaleDateString()}</span>
                        </div>

                        {/* Action buttons */}
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', paddingTop: 4, borderTop: '1px solid rgba(0,0,0,0.04)' }}>
                          <button onClick={(e) => { e.stopPropagation(); setEditTemplate(t) }} style={cardActionBtn}>
                            ✎ 编辑
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); handleCloneTemplate(t) }} style={cardActionBtn}>
                            <ArrowPathIcon style={{ width: 10, height: 10 }} /> 复制
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); handleDeleteTemplate(t) }} style={{ ...cardActionBtn, color: '#dc2626' }}>
                            <TrashIcon style={{ width: 10, height: 10 }} /> 删除
                          </button>
                        </div>
                      </motion.div>
                    )
                  })}
                </motion.div>
              )}
            </div>
          )}
        </div>
        </ScrollArea>

        {/* ───── 新建模板：选择类型 ───── */}
        <AnimatePresence>
          {showCreateTemplate && (
            <Modal isOpen={showCreateTemplate} onClose={() => setShowCreateTemplate(false)} title="新建风格模板" width={600}>
              <div style={{ fontSize: 13, color: '#6b5e54', marginBottom: 4 }}>输入模板名称（可选）：</div>
              <input id="newTmplName" style={{ ...inputStyle, marginBottom: 14 }} placeholder="例如: 古风武侠·华丽战斗风格" />
              <div style={{ fontSize: 13, color: '#6b5e54', marginBottom: 10 }}>选择小说类型：</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                {Object.entries(NOVEL_TYPE_LABELS).map(([type, label]) => {
                  const dimCount = getTemplateDims(type).length
                  const isErotic = type === '情色小说'
                  return (
                    <motion.button
                      key={type}
                      whileHover={{ scale: 1.03, y: -2 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => handleCreateFromType(type)}
                      style={{
                        padding: '14px 14px', borderRadius: 12, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                        border: isErotic ? '1px solid rgba(239,68,68,0.15)' : '1px solid rgba(124,58,237,0.1)',
                        background: isErotic ? 'rgba(239,68,68,0.02)' : 'rgba(124,58,237,0.02)',
                        transition: 'all 0.15s',
                      }}
                    >
                      <div style={{ fontSize: 13, fontWeight: 700, color: isErotic ? '#dc2626' : '#7c3aed', marginBottom: 3 }}>
                        {label}
                      </div>
                      <div style={{ fontSize: 10, color: '#9b8e84' }}>{dimCount}个维度</div>
                    </motion.button>
                  )
                })}
              </div>
            </Modal>
          )}
        </AnimatePresence>

        {/* ───── 编辑模板 Modal ───── */}
        <AnimatePresence>
          {editTemplate !== null && (
            <Modal isOpen={true} onClose={() => { setEditTemplate(null); setExpandedDims(new Set()); setCustomWorldType(''); setCustomAttitude(''); setAiGenLoading(false) }} title={editTemplate.id ? `编辑模板 — ${editTemplate.name}` : '新建模板'} width={720}>
              <div style={{ maxHeight: '65vh', overflowY: 'auto', paddingRight: 4 }} className="custom-scrollbar">
                {/* Basic info */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <div style={labelStyle}>模板名称</div>
                      <input value={editTemplate.name} onChange={e => setEditTemplate({ ...editTemplate, name: e.target.value })} style={inputStyle as any} placeholder="输入模板名称" />
                    </div>
                    <div style={{ width: 180 }}>
                      <div style={labelStyle}>世界观</div>
                      <select
                        value={(() => {
                          if (!editTemplate.worldType) return ''
                          return WORLD_TYPE_PRESETS.includes(editTemplate.worldType) ? editTemplate.worldType : '__custom__'
                        })()}
                        onChange={e => {
                          const v = e.target.value
                          if (v === '__custom__') {
                            setCustomWorldType('')
                            setEditTemplate({ ...editTemplate, worldType: '__custom__' })
                          } else {
                            setCustomWorldType('')
                            setEditTemplate({ ...editTemplate, worldType: v })
                          }
                        }}
                        style={{ ...inputStyle as any, cursor: 'pointer' }}
                      >
                        <option value="">未设置</option>
                        {WORLD_TYPE_PRESETS.map(w => (
                          <option key={w} value={w}>{w}</option>
                        ))}
                        <option value="__custom__">✎ 自定义...</option>
                      </select>
                      {(!WORLD_TYPE_PRESETS.includes(editTemplate.worldType) && editTemplate.worldType) && (
                        <input
                          value={customWorldType || (editTemplate.worldType === '__custom__' ? '' : editTemplate.worldType)}
                          onChange={e => {
                            setCustomWorldType(e.target.value)
                            setEditTemplate({ ...editTemplate, worldType: e.target.value || '__custom__' })
                          }}
                          style={{ ...inputStyle as any, marginTop: 4, fontSize: 11 }}
                          placeholder="输入自定义世界观..."
                        />
                      )}
                    </div>
                  </div>
                  <div>
                    <div style={labelStyle}>简介</div>
                    <input value={editTemplate.description} onChange={e => setEditTemplate({ ...editTemplate, description: e.target.value })} style={inputStyle as any} placeholder="一句话描述这个风格" />
                  </div>
                </div>

                {/* Tone section */}
                <div style={{ marginBottom: 14, padding: '14px 16px', borderRadius: 12, background: 'rgba(236,72,153,0.03)', border: '1px solid rgba(236,72,153,0.1)' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#ec4899', marginBottom: 10 }}>🎭 叙事基调</div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <div style={labelStyle}>基调词</div>
                      <input value={editTemplate.tone?.word || ''} onChange={e => setEditTemplate({ ...editTemplate, tone: { ...editTemplate.tone, word: e.target.value, description: editTemplate.tone?.description || '', attitude: editTemplate.tone?.attitude || '' } })} style={inputStyle as any} placeholder="如: 冷酷复仇的性支配" />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={labelStyle}>叙述者态度</div>
                      <select
                        value={(() => {
                          if (!editTemplate.tone?.attitude) return ''
                          return ATTITUDE_PRESETS.includes(editTemplate.tone.attitude) ? editTemplate.tone.attitude : '__custom__'
                        })()}
                        onChange={e => {
                          const v = e.target.value
                          if (v === '__custom__') {
                            setCustomAttitude('')
                            setEditTemplate({ ...editTemplate, tone: { ...editTemplate.tone, word: editTemplate.tone?.word || '', description: editTemplate.tone?.description || '', attitude: '__custom__' } })
                          } else {
                            setCustomAttitude('')
                            setEditTemplate({ ...editTemplate, tone: { ...editTemplate.tone, word: editTemplate.tone?.word || '', description: editTemplate.tone?.description || '', attitude: v } })
                          }
                        }}
                        style={{ ...inputStyle as any, cursor: 'pointer' }}
                      >
                        <option value="">未设置</option>
                        {ATTITUDE_PRESETS.map(a => (
                          <option key={a} value={a}>{a}</option>
                        ))}
                        <option value="__custom__">✎ 自定义...</option>
                      </select>
                      {(!ATTITUDE_PRESETS.includes(editTemplate.tone?.attitude || '') && editTemplate.tone?.attitude) && (
                        <input
                          value={customAttitude || (editTemplate.tone?.attitude === '__custom__' ? '' : editTemplate.tone?.attitude || '')}
                          onChange={e => {
                            setCustomAttitude(e.target.value)
                            setEditTemplate({ ...editTemplate, tone: { ...editTemplate.tone, word: editTemplate.tone?.word || '', description: editTemplate.tone?.description || '', attitude: e.target.value || '__custom__' } })
                          }}
                          style={{ ...inputStyle as any, marginTop: 4, fontSize: 11 }}
                          placeholder="输入自定义叙述者态度..."
                        />
                      )}
                    </div>
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <div style={labelStyle}>基调描述</div>
                    <textarea value={editTemplate.tone?.description || ''} onChange={e => setEditTemplate({ ...editTemplate, tone: { ...editTemplate.tone, word: editTemplate.tone?.word || '', description: e.target.value, attitude: editTemplate.tone?.attitude || '' } })} rows={2} style={{ ...inputStyle as any, width: '100%', resize: 'vertical', fontFamily: 'inherit' }} placeholder="50-100字基调描述" />
                  </div>
                </div>

                {/* AI辅助填充维度 */}
                <div style={{ marginBottom: 14, padding: '14px 16px', borderRadius: 12, background: 'rgba(124,58,237,0.03)', border: '1px solid rgba(124,58,237,0.1)' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#7c3aed', marginBottom: 8 }}>✨ AI辅助填充维度</div>
                  <p style={{ fontSize: 11, color: '#6b5e54', margin: '0 0 8px' }}>描述你想要的写作风格，AI 将自动填充模板的维度描述、词汇和写作规则。</p>
                  <textarea
                    id="aiDescInput"
                    placeholder="例如：适合修仙小说的风格，战斗场面招式华丽，日常对话幽默轻松，古风文言和现代白话交织，节奏紧凑步步推进..."
                    style={{ width: '100%', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 8, outline: 'none', fontSize: 12, lineHeight: 1.6, fontFamily: 'inherit', color: '#2d2520', background: '#fff', padding: 10, minHeight: 80, resize: 'vertical' }}
                  />
                  <button
                    disabled={aiGenLoading || !activeConfigId}
                    onClick={async () => {
                      const desc = (document.getElementById('aiDescInput') as HTMLTextAreaElement)?.value?.trim()
                      if (!desc) { alert('请描述你想要的写作风格'); return }
                      setAiGenLoading(true)
                      try {
                        const dimKeys = getTemplateDims(editTemplate.type)
                        const dimList = dimKeys.map(k => `${k}(${DIMENSION_META[k]?.label || k})`).join(', ')
                        const prompt = `你是专业的写作风格分析师。请根据以下风格描述，为${editTemplate.type}生成风格模板的维度数据。

风格描述: ${desc}

需要填充的维度: ${dimList}

对每个维度，请用JSON格式输出：
{
  "dimensions": {
    "维度key": { "description": "该维度的特征描述(100-200字)", "examples": ["原文例证1", "例证2"], "writingRules": ["写作规则1", "规则2"], "vocabularyList": ["词汇1", "词汇2"] },
    ...
  },
  "fullDescription": "整体风格综述(200-400字)",
  "tone": { "word": "叙事基调词", "description": "基调描述(50-100字)" }
}

只输出JSON，不要markdown。`
                        const reply = await aiService.chat([{ role: 'user', content: prompt }], activeConfigId!)
                        const m = reply.match(/\{[\s\S]*\}/)
                        if (m) {
                          const json = JSON.parse(m[0].replace(/,(\s*[}\]])/g, '$1'))
                          setEditTemplate(prev => prev ? {
                            ...prev,
                            fullDescription: json.fullDescription || prev.fullDescription,
                            tone: json.tone ? { ...prev.tone, ...json.tone } : prev.tone,
                            dimensions: { ...prev.dimensions, ...(json.dimensions || {}) },
                            source: prev.source === 'ai-generated' ? 'ai-generated' : 'manual',
                            description: prev.description || (json.fullDescription || '').slice(0, 100),
                          } : prev)
                        }
                      } catch (err) { logError('AI填充失败', err); alert('AI填充失败: ' + (err instanceof Error ? err.message : '未知错误')) }
                      setAiGenLoading(false)
                    }}
                    style={{ marginTop: 8, padding: '8px 18px', borderRadius: 8, border: 'none', background: activeConfigId ? '#7c3aed' : '#d4ccc4', color: '#fff', fontSize: 12, fontWeight: 600, cursor: activeConfigId ? 'pointer' : 'not-allowed', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  >
                    <SparklesIcon style={{ width: 14, height: 14 }} /> {aiGenLoading ? '生成中...' : 'AI填充维度'}
                  </button>
                  {editTemplate.fullDescription && (
                    <div style={{ marginTop: 8, fontSize: 11, color: '#6b5e54', lineHeight: 1.6, maxHeight: 100, overflow: 'auto', padding: 8, borderRadius: 6, background: '#fff' }}>
                      {editTemplate.fullDescription}
                    </div>
                  )}
                </div>

                {/* Dimension accordion list */}
                <div style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#2d2520' }}>
                      维度编辑 · {
                        getTemplateDims(editTemplate.type).filter(dk => (editTemplate.dimensions?.[dk] as DimAnalysis)?.description).length
                      }/{getTemplateDims(editTemplate.type).length} 已填充
                    </span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={() => setExpandedDims(new Set(getTemplateDims(editTemplate.type)))}
                        style={{
                          padding: '3px 10px', borderRadius: 6, border: '1px solid rgba(124,58,237,0.12)',
                          background: 'rgba(124,58,237,0.03)', color: '#7c3aed', fontSize: 10,
                          fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                        }}
                      >
                        全部展开
                      </button>
                      <button
                        onClick={() => setExpandedDims(new Set())}
                        style={{
                          padding: '3px 10px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.08)',
                          background: 'rgba(0,0,0,0.02)', color: '#6b5e54', fontSize: 10,
                          fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                        }}
                      >
                        全部折叠
                      </button>
                    </div>
                  </div>

                  {/* Dimension overview tags */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 14 }}>
                    {getTemplateDims(editTemplate.type).map(dk => {
                      const dim = (editTemplate.dimensions?.[dk] || {}) as DimAnalysis
                      const filled = !!dim.description
                      const label = DIMENSION_META[dk]?.label || dk
                      return (
                        <motion.button
                          key={dk}
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          onClick={() => toggleDimExpanded(dk)}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 3,
                            padding: '4px 10px', borderRadius: 8, border: 'none',
                            cursor: 'pointer', fontFamily: 'inherit',
                            borderColor: filled ? 'rgba(16,185,129,0.3)' : 'rgba(0,0,0,0.08)',
                            borderStyle: 'solid', borderWidth: 1,
                            background: expandedDims.has(dk)
                              ? (filled ? 'rgba(16,185,129,0.08)' : 'rgba(124,58,237,0.05)')
                              : (filled ? 'rgba(16,185,129,0.03)' : 'rgba(0,0,0,0.01)'),
                            color: filled ? '#16a34a' : '#9b8e84',
                            fontSize: 10, fontWeight: filled ? 600 : 400,
                            transition: 'all 0.15s',
                          }}
                        >
                          {filled ? '✓' : '—'} {label}
                        </motion.button>
                      )
                    })}
                  </div>

                  {/* Expanded dimension editors */}
                  {getTemplateDims(editTemplate.type).filter(dk => expandedDims.has(dk)).map(dk => {
                    const meta = DIMENSION_META[dk]
                    const dim = (editTemplate.dimensions?.[dk] || { description: '', examples: [], writingRules: [], vocabularyList: [] }) as DimAnalysis
                    return (
                      <motion.div
                        key={dk}
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        style={{ marginBottom: 12, padding: '12px 14px', borderRadius: 10, background: '#faf9f8', border: '1px solid rgba(0,0,0,0.05)', overflow: 'hidden' }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                          <div>
                            <span style={{ fontSize: 13, fontWeight: 700, color: '#2d2520' }}>{meta?.label || dk}</span>
                            <span style={{ fontWeight: 400, color: '#9b8e84', fontSize: 10, marginLeft: 6 }}>({meta?.category || ''})</span>
                          </div>
                          <button onClick={() => toggleDimExpanded(dk)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9b8e84', padding: 2 }}>
                            <XMarkIcon style={{ width: 14, height: 14 }} />
                          </button>
                        </div>

                        {/* Description */}
                        <textarea
                          value={dim.description || ''}
                          onChange={e => updateDim(dk, 'description', e.target.value)}
                          rows={2}
                          style={{ ...inputStyle as any, width: '100%', resize: 'vertical', fontFamily: 'inherit', fontSize: 11, marginBottom: 10 }}
                          placeholder="维度描述（200-400字）"
                        />

                        {/* Vocabulary tags */}
                        <div style={{ marginBottom: 8 }}>
                          <div style={{ fontSize: 10, fontWeight: 600, color: '#6b5e54', marginBottom: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            词汇清单 ({(dim.vocabularyList || []).length})
                            <button onClick={() => addVocabItem(dk)} style={{ background: 'none', border: 'none', color: '#7c3aed', cursor: 'pointer', fontSize: 10, fontWeight: 600 }}>+ 添加</button>
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {(dim.vocabularyList || []).map((v: string, i: number) => (
                              <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                <input value={v} onChange={e => updateVocabItem(dk, i, e.target.value)} style={{ width: 80, padding: '3px 6px', borderRadius: 4, border: '1px solid rgba(0,0,0,0.1)', fontSize: 10, fontFamily: 'inherit' }} placeholder="词" />
                                <button onClick={() => removeVocabItem(dk, i)} style={{ background: 'none', border: 'none', color: '#9b8e84', cursor: 'pointer', fontSize: 10 }}>×</button>
                              </span>
                            ))}
                          </div>
                        </div>

                        {/* Writing rules */}
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 600, color: '#6b5e54', marginBottom: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            写作规则 ({(dim.writingRules || []).length})
                            <button onClick={() => addRule(dk)} style={{ background: 'none', border: 'none', color: '#7c3aed', cursor: 'pointer', fontSize: 10, fontWeight: 600 }}>+ 添加</button>
                          </div>
                          {(dim.writingRules || []).map((r: string, i: number) => (
                            <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 3, alignItems: 'center' }}>
                              <input value={r} onChange={e => updateRule(dk, i, e.target.value)} style={{ flex: 1, padding: '3px 6px', borderRadius: 4, border: '1px solid rgba(0,0,0,0.1)', fontSize: 10, fontFamily: 'inherit' }} placeholder="规则" />
                              <button onClick={() => removeRule(dk, i)} style={{ background: 'none', border: 'none', color: '#9b8e84', cursor: 'pointer', fontSize: 12 }}>×</button>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )
                  })}
                </div>
              </div>

              {/* Footer */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14, paddingTop: 12, borderTop: '1px solid #f0ece8' }}>
                <Button variant="secondary" onClick={() => { setEditTemplate(null); setExpandedDims(new Set()); setCustomWorldType(''); setCustomAttitude(''); setAiGenLoading(false) }}>取消</Button>
                <Button onClick={handleSaveTemplate} disabled={!editTemplate.name.trim()}>保存模板</Button>
              </div>
            </Modal>
          )}
        </AnimatePresence>
      </div>
    )
  }

  if (!selectedProject) return null

  // ============ DETAIL VIEW ============
  return (
    <div className="page-enter" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '12px 20px', borderBottom: '1px solid rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => { setView('library'); setSelectedProject(null) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9b8e84', display: 'flex', padding: 4 }}><ArrowLeftIcon style={{ width: 20, height: 20 }} /></button>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: '#2d2520' }}>{selectedProject.name}</h2>
          <span style={{ fontSize: 11, color: '#9b8e84' }}>{selectedProject.chapters.length}章 {(selectedProject.totalCharCount/10000).toFixed(1)}万字</span>
          {selectedProject.profile && <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 600 }}>✓ 已总结</span>}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button size="sm" variant="ghost" onClick={() => setShowApply(true)}>应用到项目</Button>
          <Button size="sm" variant="danger" onClick={() => handleDeleteProject({ id: selectedProject.id, name: selectedProject.name, sourceFileName: '', chapterCount: 0, totalCharCount: 0, hasProfile: false, createdAt: '', novelType: '通用' })} icon={<TrashIcon style={{ width: 14, height: 14 }} />}>删除</Button>
        </div>
      </div>

      {/* Analyze bar */}
      <div style={{ padding: '10px 20px', borderBottom: '1px solid rgba(0,0,0,0.04)', display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(0,0,0,0.01)', flexWrap: 'wrap' }}>
        <button onClick={() => setAnalyzeIds(new Set(selectedProject.chapters.map(c => c.id)))} style={linkBtn}>全选</button>
        <button onClick={() => setAnalyzeIds(new Set())} style={linkBtn}>清空</button>
        <button onClick={() => setAnalyzeIds(new Set(selectedProject.chapters.slice(0, 50).map(c => c.id)))} style={linkBtn}>前50章</button>
        <button onClick={() => setAnalyzeIds(new Set(selectedProject.chapters.slice(0, 10).map(c => c.id)))} style={linkBtn}>前10章</button>
        <span style={{ fontSize: 11, color: '#9b8e84' }}>已选 {analyzeIds.size}章</span>
        <select value={analyzeMode} onChange={e => setAnalyzeMode(e.target.value as 'precise' | 'quick')} style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.1)', fontSize: 11 }}><option value="precise">全量分析</option><option value="quick">抽样分析</option></select>
        <Button size="sm" variant="secondary" onClick={() => setShowDimConfig(true)}>配置维度 ({enabledDimensions.length})</Button>
        <Button size="sm" variant="ghost" onClick={() => setShowDimDetail(true)}>维度详情</Button>
        <Button size="sm" onClick={handleAnalyze} disabled={analyzeLoading || !activeConfigId || analyzeIds.size === 0} icon={<SparklesIcon style={{ width: 14, height: 14 }} />}>{analyzeLoading ? '分析中...' : '开始分析'}</Button>
        {analyzedChapters.length > 0 && <Button size="sm" variant="secondary" onClick={() => { setShowResult(true); setResultTab('chapters') }}>分析结果 ({analyzedChapters.length}章)</Button>}
        {analyzeProgress && <span style={{ fontSize: 11, color: '#7c3aed' }}>{analyzeProgress}</span>}
      </div>

      {/* Main: left chapters + right content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
        {/* Left: chapter list */}
        <div style={{ width: 340, borderRight: '1px solid rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <ScrollArea maxHeight="100%" style={{ flex: 1, padding: 6 }}>
            {selectedProject.chapters.map(ch => (
              <div key={ch.id} style={{
                display: 'flex', alignItems: 'center', gap: 5, padding: '4px 8px', cursor: 'pointer',
                borderRadius: 8, background: selectedChapterId === ch.id ? 'rgba(124,58,237,0.06)' : 'transparent',
                fontSize: 12, color: selectedChapterId === ch.id ? '#7c3aed' : '#2d2520',
                fontWeight: selectedChapterId === ch.id ? 600 : 400,
              }} onClick={() => setSelectedChapterId(ch.id)}>
                <input type="checkbox" checked={analyzeIds.has(ch.id)} onChange={() => toggleAnalyzeId(ch.id)}
                  style={{ width: 13, height: 13, accentColor: '#7c3aed', flexShrink: 0 }} onClick={e => e.stopPropagation()} />
                <span style={{ flex: 1, fontSize: 12.5, lineHeight: 1.4, wordBreak: 'break-all' }}>{ch.title}</span>
                <span style={{ fontSize: 9, color: '#9b8e84', flexShrink: 0 }}>{(ch.charCount/1000).toFixed(0)}k</span>
                {ch.analyzed && <span style={{ fontSize: 9, color: '#16a34a', fontWeight: 600, flexShrink: 0 }}>✓</span>}
                {ch.analyzed && (
                  <button onClick={e => { e.stopPropagation(); clearChapterAnalysis(ch.id) }}
                    title="清除本章分析" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', color: '#d4ccc4', display: 'flex', flexShrink: 0 }}>
                    <XMarkIcon style={{ width: 11, height: 11 }} />
                  </button>
                )}
              </div>
            ))}
          </ScrollArea>
        </div>

        {/* Right: chapter content */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {selectedChapter ? (
            <div style={{ flex: 1, padding: '20px 28px', overflowY: 'auto', fontSize: 18, lineHeight: 2.0, color: '#4a3f38', whiteSpace: 'pre-wrap' }} className="custom-scrollbar">
              {selectedChapter.content || '（本章无内容）'}
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9b8e84', fontSize: 14 }}>
              <div style={{ textAlign: 'center' }}><DocumentTextIcon style={{ width: 40, height: 40, margin: '0 auto 10px', opacity: 0.3 }} /><p>选择左侧章节查看内容</p></div>
            </div>
          )}
        </div>
      </div>

      {/* Analysis Result Modal */}
      <Modal isOpen={showResult} onClose={() => setShowResult(false)} title={`分析结果 — ${selectedProject.name}`} width={window.innerWidth > 1300 ? 1200 : 680 * 2}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: 4, borderBottom: '2px solid rgba(0,0,0,0.04)' }}>
            {([['chapters', '章节分析'], ['overall', '小说整体风格']] as [ResultTab, string][]).map(([k, label]) => (
              <button key={k} onClick={() => setResultTab(k)} style={{
                padding: '8px 20px', border: 'none', background: 'transparent', fontSize: 13,
                fontWeight: resultTab === k ? 700 : 500, color: resultTab === k ? '#7c3aed' : '#6b5e54',
                borderBottom: resultTab === k ? '2px solid #7c3aed' : '2px solid transparent',
                cursor: 'pointer', marginBottom: -2, transition: 'all 0.15s ease',
              }}>{label}</button>
            ))}
          </div>

          {resultTab === 'chapters' && (
            <div className="custom-scrollbar" style={{ maxHeight: 500, overflowY: 'auto' }}>
              {analyzedChapters.length === 0 ? (
                <p style={{ textAlign: 'center', color: '#9b8e84', fontSize: 13, padding: 40 }}>暂无已分析的章节</p>
              ) : (
                analyzedChapters.map(ch => (
                  <div key={ch.id} style={{ padding: '12px 14px', borderRadius: 12, background: '#faf9f8', border: '1px solid rgba(0,0,0,0.04)', marginBottom: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#2d2520' }}>{ch.title}</span>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <span style={{ fontSize: 10, color: '#9b8e84' }}>{ch.analysis!.analyzedAt ? new Date(ch.analysis!.analyzedAt).toLocaleString() : ''}</span>
                        <button onClick={() => clearChapterAnalysis(ch.id)} style={{ ...linkBtn, color: '#9b8e84', fontSize: 11 }}>清除</button>
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                      {Object.entries(FEATURE_LABELS).filter(([k]) => !['descriptionPattern','corruptionArc','degradationRitual','narrativeVoice','shameVoyeurLoop','sceneMechanics','somaticTension','identityDissolution'].includes(k)).map(([k, label]) => (
                        <div key={k} style={{ fontSize: 11 }}>
                          <span style={{ fontWeight: 600, color: '#7c3aed' }}>{label}:</span>
                          <span style={{ color: '#4a3f38' }}> {(ch.analysis![k as keyof ChapterAnalysis] as string) || '未检测到'}</span>
                        </div>
                      ))}
                    </div>
                    {ch.analysis!.descriptionPattern && (
                      <div style={{ marginTop: 6, padding: '6px 8px', borderRadius: 6, background: 'rgba(124,58,237,0.03)', border: '1px solid rgba(124,58,237,0.08)', fontSize: 10, lineHeight: 1.5, color: '#4a3f38' }}>
                        <span style={{ fontWeight: 700, color: '#7c3aed' }}>描写结构:</span> {ch.analysis!.descriptionPattern.bodyOrder?.join('→')}
                      </div>
                    )}
                    {ch.analysis!.corruptionArc && (
                      <div style={{ marginTop: 4, padding: '6px 8px', borderRadius: 6, background: 'rgba(220,38,38,0.03)', border: '1px solid rgba(220,38,38,0.08)', fontSize: 10, lineHeight: 1.5, color: '#4a3f38' }}>
                        <span style={{ fontWeight: 700, color: '#dc2626' }}>堕落弧线:</span> {ch.analysis!.corruptionArc.overallTrajectory?.slice(0, 80)}
                      </div>
                    )}
                    {ch.analysis!.degradationRitual && (
                      <div style={{ marginTop: 4, padding: '6px 8px', borderRadius: 6, background: 'rgba(245,158,11,0.03)', border: '1px solid rgba(245,158,11,0.08)', fontSize: 10, lineHeight: 1.5, color: '#4a3f38' }}>
                        <span style={{ fontWeight: 700, color: '#e67e00' }}>仪式剧本:</span> {ch.analysis!.degradationRitual.sceneTemplate?.join(' → ')?.slice(0, 100)}
                      </div>
                    )}
                    {ch.analysis!.narrativeVoice && (
                      <div style={{ marginTop: 4, padding: '6px 8px', borderRadius: 6, background: 'rgba(59,130,246,0.03)', border: '1px solid rgba(59,130,246,0.08)', fontSize: 10, lineHeight: 1.5, color: '#4a3f38' }}>
                        <span style={{ fontWeight: 700, color: '#3b82f6' }}>叙事声音:</span> {ch.analysis!.narrativeVoice.toneContrast?.slice(0, 80)}
                      </div>
                    )}
                    {ch.analysis!.sceneMechanics && (
                      <div style={{ marginTop: 4, padding: '6px 8px', borderRadius: 6, background: 'rgba(139,92,246,0.03)', border: '1px solid rgba(139,92,246,0.08)', fontSize: 10, lineHeight: 1.5, color: '#4a3f38' }}>
                        <span style={{ fontWeight: 700, color: '#8b5cf6' }}>场景装置:</span> {ch.analysis!.sceneMechanics.sensoryCounterpoint?.slice(0, 80)}
                      </div>
                    )}
                    {ch.analysis!.somaticTension && (
                      <div style={{ marginTop: 4, padding: '6px 8px', borderRadius: 6, background: 'rgba(6,182,212,0.03)', border: '1px solid rgba(6,182,212,0.08)', fontSize: 10, lineHeight: 1.5, color: '#4a3f38' }}>
                        <span style={{ fontWeight: 700, color: '#06b6d4' }}>躯体状态:</span> {ch.analysis!.somaticTension.bodyCondition?.slice(0, 80)}
                      </div>
                    )}
                    {ch.analysis!.identityDissolution && (
                      <div style={{ marginTop: 4, padding: '6px 8px', borderRadius: 6, background: 'rgba(34,197,94,0.03)', border: '1px solid rgba(34,197,94,0.08)', fontSize: 10, lineHeight: 1.5, color: '#4a3f38' }}>
                        <span style={{ fontWeight: 700, color: '#22c55e' }}>身份溶解:</span> {ch.analysis!.identityDissolution.replacementIdentity?.slice(0, 80)}
                      </div>
                    )}
                    {ch.analysis!.shameVoyeurLoop && (
                      <div style={{ marginTop: 4, padding: '6px 8px', borderRadius: 6, background: 'rgba(250,204,21,0.03)', border: '1px solid rgba(250,204,21,0.08)', fontSize: 10, lineHeight: 1.5, color: '#4a3f38' }}>
                        <span style={{ fontWeight: 700, color: '#eab308' }}>心理循环:</span> {ch.analysis!.shameVoyeurLoop.triggerPattern?.slice(0, 80)}
                      </div>
                    )}
                    {ch.analysis!.excerpt && (
                      <div style={{ marginTop: 6, fontSize: 10, color: '#9b8e84', fontStyle: 'italic' }}>摘录: "{ch.analysis!.excerpt}" — {ch.analysis!.excerptNote}</div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {resultTab === 'overall' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontSize: 12, color: '#6b5e54' }}>已分析章节: {analyzedChapters.length}章</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button size="sm" onClick={handleSummarize} disabled={summarizeLoading || analyzedChapters.length === 0} icon={<SparklesIcon style={{ width: 14, height: 14 }} />}>
                  {summarizeLoading ? '总结中...' : 'AI总结'}
                </Button>
                {selectedProject.profile && <Button size="sm" variant="secondary" onClick={handleSaveAsTemplate}>保存为模板</Button>}
                {selectedProject.profile && <Button size="sm" variant="danger" onClick={handleClearProfile}>清空总结</Button>}
              </div>
              {selectedProject.profile ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ fontSize: 13, lineHeight: 1.8, color: '#4a3f38', padding: 12, borderRadius: 10, background: '#faf9f8' }}>
                    <strong>风格综述：</strong>{selectedProject.profile.fullDescription}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 }}>
                    {Object.entries(selectedProject.profile.features).filter(([k]) => !['descriptionPattern','corruptionArc','degradationRitual','narrativeVoice','shameVoyeurLoop','sceneMechanics','somaticTension','identityDissolution'].includes(k)).map(([k, v]) => (
                      <div key={k} style={{ padding: '10px 12px', borderRadius: 8, background: '#faf9f8', fontSize: 12 }}>
                        <div style={{ fontWeight: 700, color: '#7c3aed', marginBottom: 4 }}>{FEATURE_LABELS[k]}</div>
                        <div style={{ color: '#4a3f38', lineHeight: 1.6 }}>{(v as string) || '未检测到'}</div>
                      </div>
                    ))}
                  </div>
                  {selectedProject.profile.features.corruptionArc && (
                    <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(220,38,38,0.03)', border: '1px solid rgba(220,38,38,0.08)', fontSize: 12 }}>
                      <div style={{ fontWeight: 700, color: '#dc2626', marginBottom: 8 }}>堕落弧线</div>
                      <div style={{ color: '#4a3f38', lineHeight: 1.8 }}>
                        <div>{selectedProject.profile.features.corruptionArc.overallTrajectory}</div>
                        {selectedProject.profile.features.corruptionArc.characterStates?.map((cs, i) => (
                          <div key={i} style={{ marginTop: 6, paddingLeft: 8, borderLeft: '2px solid rgba(220,38,38,0.3)' }}>
                            <strong>{cs.characterName}</strong>: {cs.originalState} → {cs.currentState}
                            {cs.progressionSteps?.length > 0 && <span style={{ fontSize: 10, color: '#9b8e84' }}> ({cs.progressionSteps.join(' → ')})</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {selectedProject.profile.features.degradationRitual && (
                    <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(245,158,11,0.03)', border: '1px solid rgba(245,158,11,0.08)', fontSize: 12 }}>
                      <div style={{ fontWeight: 700, color: '#e67e00', marginBottom: 8 }}>仪式剧本</div>
                      <div style={{ color: '#4a3f38', lineHeight: 1.8 }}>
                        {selectedProject.profile.features.degradationRitual.sceneTemplate?.length > 0 && <div>场景模板: {selectedProject.profile.features.degradationRitual.sceneTemplate.join(' → ')}</div>}
                        {selectedProject.profile.features.degradationRitual.authorityEntryPattern && <div>权威入场: {selectedProject.profile.features.degradationRitual.authorityEntryPattern}</div>}
                        {selectedProject.profile.features.degradationRitual.surrenderConfirmation && <div>屈服确认: {selectedProject.profile.features.degradationRitual.surrenderConfirmation}</div>}
                      </div>
                    </div>
                  )}
                  {selectedProject.profile.features.narrativeVoice && (
                    <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(59,130,246,0.03)', border: '1px solid rgba(59,130,246,0.08)', fontSize: 12 }}>
                      <div style={{ fontWeight: 700, color: '#3b82f6', marginBottom: 8 }}>叙事声音</div>
                      <div style={{ color: '#4a3f38', lineHeight: 1.8 }}>
                        {selectedProject.profile.features.narrativeVoice.toneContrast && <div>语态反差: {selectedProject.profile.features.narrativeVoice.toneContrast}</div>}
                        {selectedProject.profile.features.narrativeVoice.internalMonologueRatio && <div>内心独白: {selectedProject.profile.features.narrativeVoice.internalMonologueRatio}</div>}
                        {selectedProject.profile.features.narrativeVoice.worldBuildingStyle && <div>世界交代: {selectedProject.profile.features.narrativeVoice.worldBuildingStyle}</div>}
                        {selectedProject.profile.features.narrativeVoice.routineCatalog && <div>日常编目: {selectedProject.profile.features.narrativeVoice.routineCatalog}</div>}
                        {selectedProject.profile.features.narrativeVoice.powerResignation && <div>权力妥协: {selectedProject.profile.features.narrativeVoice.powerResignation}</div>}
                      </div>
                    </div>
                  )}
                  {selectedProject.profile.features.sceneMechanics && (
                    <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(139,92,246,0.03)', border: '1px solid rgba(139,92,246,0.08)', fontSize: 12 }}>
                      <div style={{ fontWeight: 700, color: '#8b5cf6', marginBottom: 8 }}>场景装置与感官对位</div>
                      <div style={{ color: '#4a3f38', lineHeight: 1.8 }}>
                        {selectedProject.profile.features.sceneMechanics.sensoryCounterpoint && <div>感官对位: {selectedProject.profile.features.sceneMechanics.sensoryCounterpoint}</div>}
                        {selectedProject.profile.features.sceneMechanics.symbolicTool && <div>象征工具: {selectedProject.profile.features.sceneMechanics.symbolicTool}</div>}
                        {selectedProject.profile.features.sceneMechanics.recurringVisualFormula && <div>视觉定型: {selectedProject.profile.features.sceneMechanics.recurringVisualFormula}</div>}
                      </div>
                    </div>
                  )}
                  {selectedProject.profile.features.somaticTension && (
                    <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(6,182,212,0.03)', border: '1px solid rgba(6,182,212,0.08)', fontSize: 12 }}>
                      <div style={{ fontWeight: 700, color: '#06b6d4', marginBottom: 8 }}>躯体状态与精确解剖</div>
                      <div style={{ color: '#4a3f38', lineHeight: 1.8 }}>
                        {selectedProject.profile.features.somaticTension.bodyCondition && <div>躯体状态: {selectedProject.profile.features.somaticTension.bodyCondition}</div>}
                        {selectedProject.profile.features.somaticTension.anatomicalPrecision && <div>解剖精度: {selectedProject.profile.features.somaticTension.anatomicalPrecision}</div>}
                        {selectedProject.profile.features.somaticTension.orchestrationPattern && <div>协作编排: {selectedProject.profile.features.somaticTension.orchestrationPattern}</div>}
                        {selectedProject.profile.features.somaticTension.powerAnxiety && <div>权力焦虑: {selectedProject.profile.features.somaticTension.powerAnxiety}</div>}
                      </div>
                    </div>
                  )}
                  {selectedProject.profile.features.identityDissolution && (
                    <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(34,197,94,0.03)', border: '1px solid rgba(34,197,94,0.08)', fontSize: 12 }}>
                      <div style={{ fontWeight: 700, color: '#22c55e', marginBottom: 8 }}>身份溶解机制</div>
                      <div style={{ color: '#4a3f38', lineHeight: 1.8 }}>
                        {selectedProject.profile.features.identityDissolution.preExistingIdentity && <div>旧身份: {selectedProject.profile.features.identityDissolution.preExistingIdentity}</div>}
                        {selectedProject.profile.features.identityDissolution.replacementIdentity && <div>新身份: {selectedProject.profile.features.identityDissolution.replacementIdentity}</div>}
                        {selectedProject.profile.features.identityDissolution.selfGaslightingPattern && <div>自我合理化: {selectedProject.profile.features.identityDissolution.selfGaslightingPattern}</div>}
                        {selectedProject.profile.features.identityDissolution.competitiveAbasement && <div>竞相自贬: {selectedProject.profile.features.identityDissolution.competitiveAbasement}</div>}
                        {selectedProject.profile.features.identityDissolution.correctionFrame && <div>管教框架: {selectedProject.profile.features.identityDissolution.correctionFrame}</div>}
                      </div>
                    </div>
                  )}
                  {selectedProject.profile.features.shameVoyeurLoop && (
                    <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(250,204,21,0.03)', border: '1px solid rgba(250,204,21,0.08)', fontSize: 12 }}>
                      <div style={{ fontWeight: 700, color: '#eab308', marginBottom: 8 }}>羞耻-窥视心理循环</div>
                      <div style={{ color: '#4a3f38', lineHeight: 1.8 }}>
                        {selectedProject.profile.features.shameVoyeurLoop.triggerPattern && <div>触发: {selectedProject.profile.features.shameVoyeurLoop.triggerPattern}</div>}
                        {selectedProject.profile.features.shameVoyeurLoop.excitementResponse && <div>兴奋: {selectedProject.profile.features.shameVoyeurLoop.excitementResponse}</div>}
                        {selectedProject.profile.features.shameVoyeurLoop.shameLayer && <div>羞耻: {selectedProject.profile.features.shameVoyeurLoop.shameLayer}</div>}
                        {selectedProject.profile.features.shameVoyeurLoop.feedbackAmplification && <div>闭环: {selectedProject.profile.features.shameVoyeurLoop.feedbackAmplification}</div>}
                      </div>
                    </div>
                  )}
                  {selectedProject.profile.features.descriptionPattern && (
                    <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(124,58,237,0.03)', border: '1px solid rgba(124,58,237,0.08)', fontSize: 12 }}>
                      <div style={{ fontWeight: 700, color: '#7c3aed', marginBottom: 8 }}>描写结构模板</div>
                      <div style={{ color: '#4a3f38', lineHeight: 1.8 }}>
                        <div>扫描顺序: {selectedProject.profile.features.descriptionPattern.bodyOrder?.join(' → ')}</div>
                        {selectedProject.profile.features.descriptionPattern.stockingDetail && <div>丝袜: {selectedProject.profile.features.descriptionPattern.stockingDetail}</div>}
                        {selectedProject.profile.features.descriptionPattern.characterVisualProfile && <div>角色配置: {selectedProject.profile.features.descriptionPattern.characterVisualProfile}</div>}
                        {selectedProject.profile.features.descriptionPattern.detailFingerprints?.length > 0 && <div>指纹: {selectedProject.profile.features.descriptionPattern.detailFingerprints.join('、')}</div>}
                      </div>
                    </div>
                  )}
                  <div style={{ fontSize: 10, color: '#9b8e84' }}>
                    总结时间: {new Date(selectedProject.profile.analyzedAt).toLocaleString()} · 分析章节: {selectedProject.profile.analyzedChapterCount}章
                  </div>
                </div>
              ) : (
                <p style={{ textAlign: 'center', color: '#9b8e84', fontSize: 13, padding: 20 }}>尚未生成整体风格总结，请先分析章节后点击「AI总结」</p>
              )}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8, borderTop: '1px solid #f0ece8' }}>
            <Button onClick={() => setShowResult(false)}>关闭</Button>
          </div>
        </div>
      </Modal>

      {/* Dimension Detail Modal */}
      <Modal isOpen={showDimDetail} onClose={() => setShowDimDetail(false)} title="分析维度详情" width={720}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {NOVEL_TYPES.map(t => {
              const dims = NOVEL_TYPE_DIMS[t] || []
              return (
                <button key={t} onClick={() => setDetailType(t)} style={{
                  ...presetBtn,
                  background: detailType === t ? '#7c3aed' : '#fff',
                  color: detailType === t ? '#fff' : '#2d2520',
                  fontWeight: detailType === t ? 700 : 400,
                }}>{t} ({dims.length}维)</button>
              )
            })}
          </div>
          {[...new Set(Object.values(DIMENSION_META).map(m => m.category))].map(cat => {
            const dimsInCat = Object.entries(DIMENSION_META).filter(([, m]) => m.category === cat)
            if (dimsInCat.length === 0) return null
            const activeIds = NOVEL_TYPE_DIMS[detailType] || []
            const activeInCat = dimsInCat.filter(([k]) => activeIds.includes(k))
            const inactiveInCat = dimsInCat.filter(([k]) => !activeIds.includes(k))
            return (
              <div key={cat}>
                <div style={{ fontSize: 12, fontWeight: 700, color: cat === '情色专属' ? '#ec4899' : cat === '类型专属' ? '#f59e0b' : cat === '泛用技法' ? '#16a34a' : '#7c3aed', marginBottom: 8 }}>{cat} ({activeInCat.length}维)</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {activeInCat.map(([k, m]) => (
                    <div key={k} style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(124,58,237,0.04)', border: '1px solid rgba(124,58,237,0.1)', fontSize: 12, lineHeight: 1.7 }}>
                      <span style={{ fontWeight: 700, color: '#7c3aed' }}>{m.label}</span>
                      <span style={{ color: '#4a3f38', marginLeft: 8 }}>{parsePromptDescription(m.prompt)}</span>
                    </div>
                  ))}
                  {inactiveInCat.map(([k, m]) => (
                    <div key={k} style={{ padding: '10px 14px', borderRadius: 10, background: '#faf9f8', border: '1px solid rgba(0,0,0,0.04)', fontSize: 12, lineHeight: 1.7, opacity: 0.5 }}>
                      <span style={{ fontWeight: 600, color: '#9b8e84' }}>{m.label}</span>
                      <span style={{ color: '#9b8e84', marginLeft: 8 }}>{parsePromptDescription(m.prompt)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTop: '1px solid #f0ece8' }}>
            <span style={{ fontSize: 12, color: '#6b5e54' }}>{detailType} · {(NOVEL_TYPE_DIMS[detailType] || []).length} 个维度</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="secondary" onClick={() => setShowDimDetail(false)}>关闭</Button>
              <Button onClick={() => { setEnabledDimensions(NOVEL_TYPE_DIMS[detailType] || []); setShowDimDetail(false) }}>应用此类型</Button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Dimension Config Modal */}
      <Modal isOpen={showDimConfig} onClose={() => setShowDimConfig(false)} title={`选择分析维度 (${enabledDimensions.length})`} width={580}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Presets */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#6b5e54' }}>预设:</span>
            <button onClick={() => setEnabledDimensions(Object.keys(DIMENSION_META).filter(k => ['基础文风','进阶技法','泛用技法'].includes(DIMENSION_META[k].category)))} style={presetBtn}>✨ 基础通用</button>
            <button onClick={() => setEnabledDimensions(NOVEL_TYPE_DIMS['情色'] || [])} style={presetBtn}>🔞 情色全维</button>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#6b5e54', marginLeft: 8 }}>类型:</span>
            {['通用','情色','玄幻','奇幻','灵异','游戏','末世','轻小说','都市','修仙','恋爱','古风','悬疑'].map(genre => (
              <button key={genre} onClick={() => {
                let dims = enabledDimensions.filter(k => DIMENSION_META[k].category !== '类型专属')
                if (genre === '情色') { setEnabledDimensions(NOVEL_TYPE_DIMS['情色'] || []) }
                else if (genre === '通用') { setEnabledDimensions(dims) }
                else {
                  const genreKeyMap: Record<string, string> = {'都市':'socialRealism','修仙':'cultivationCombat','恋爱':'romanceArc','古风':'archaicStyle','悬疑':'suspensePacing'}
                  const genreKey = genreKeyMap[genre]
                  if (genreKey) {
                    const others = Object.keys(DIMENSION_META).filter(k => DIMENSION_META[k].category === '类型专属' && k !== genreKey)
                    setEnabledDimensions([...dims.filter(k => !others.includes(k)), genreKey])
                  }
                }
              }} style={presetBtn}>{genre}</button>
            ))}
            <button onClick={() => setEnabledDimensions(Object.keys(DIMENSION_META))} style={{ ...presetBtn, fontSize: 10 }}>全选</button>
            <button onClick={() => setEnabledDimensions([])} style={{ ...presetBtn, fontSize: 10, color: '#9b8e84' }}>清空</button>
          </div>
          {/* Grouped checkboxes */}
          {[...new Set(Object.values(DIMENSION_META).map(m => m.category))].map(cat => (
            <div key={cat}>
              <div style={{ fontSize: 12, fontWeight: 700, color: cat === '情色专属' ? '#ec4899' : cat === '类型专属' ? '#f59e0b' : cat === '泛用技法' ? '#16a34a' : '#7c3aed', marginBottom: 6 }}>{cat}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
                {Object.entries(DIMENSION_META).filter(([, m]) => m.category === cat).map(([k, m]) => (
                  <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 6px', cursor: 'pointer', borderRadius: 6, fontSize: 11, color: '#2d2520' }}>
                    <input type="checkbox" checked={enabledDimensions.includes(k)} onChange={() => { setEnabledDimensions(prev => prev.includes(k) ? prev.filter(d => d !== k) : [...prev, k]) }} style={{ width: 13, height: 13, accentColor: '#7c3aed' }} />
                    {m.label}
                  </label>
                ))}
              </div>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8, borderTop: '1px solid #f0ece8' }}>
            <Button onClick={() => { setShowDimConfig(false); if (selectedProject) { const updated = { ...selectedProject, enabledDimensions }; styleProjectService.saveProject(updated).catch(err => logError('保存维度配置失败', err)); setSelectedProject(updated) } }}>确定</Button>
          </div>
        </div>
      </Modal>

      {/* Apply Style Modal */}
      <Modal isOpen={showApply} onClose={() => setShowApply(false)} title={`应用风格 — ${selectedProject?.name || ''}`} width={500}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p style={{ fontSize: 13, color: '#6b5e54' }}>选择要应用此风格的目标写作项目：</p>
          {projectsList.map(p => (
            <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 13, color: '#2d2520', background: styleAssignments[p.id] === selectedProject?.id ? 'rgba(124,58,237,0.04)' : 'transparent' }}>
              <input type="checkbox" checked={styleAssignments[p.id] === selectedProject?.id}
                onChange={e => handleApplyStyle(p.id, e.target.checked ? (selectedProject?.id || '') : '')}
                style={{ width: 16, height: 16, accentColor: '#7c3aed' }} />
              {p.name}
            </label>
          ))}
          {projectsList.length === 0 && <p style={{ fontSize: 12, color: '#9b8e84' }}>暂无写作项目</p>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8, borderTop: '1px solid #f0ece8' }}>
            <Button onClick={() => setShowApply(false)}>完成</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

// Extract readable description from DIMENSION_META prompt
function parsePromptDescription(prompt: string): string {
  if (prompt.startsWith('"') && !prompt.startsWith('"[') && !prompt.startsWith('"{')) {
    const inner = prompt.replace(/^"[^"]+":\s*"/, '').replace(/"$/, '')
    return inner.split('+').map(p => p.replace(/[:：].*/, '').trim()).filter(Boolean).join('、')
  }
  const fields: string[] = []
  const jsonMatch = prompt.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    const keyMatches = jsonMatch[0].matchAll(/"(\w+)":"([^"]+)"/g)
    for (const m of keyMatches) {
      if (fields.length < 5) fields.push(`${m[1]}: ${m[2].slice(0, 30)}`)
    }
    if (fields.length > 0) return fields.join('; ')
  }
  return prompt.length > 80 ? prompt.slice(0, 80) + '...' : prompt
}

const presetBtn: React.CSSProperties = {
  padding: '4px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', background: '#fff',
  fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', color: '#2d2520', fontWeight: 500,
}
const linkBtn: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#7c3aed', padding: 0, fontFamily: 'inherit',
}
const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: '#6b5e54', marginBottom: 4 }
const cardActionBtn: React.CSSProperties = {
  fontSize: 10, padding: '3px 10px', borderRadius: 6,
  border: '1px solid rgba(0,0,0,0.06)', background: 'rgba(255,255,255,0.6)',
  cursor: 'pointer', color: '#6b5e54', fontFamily: 'inherit',
  display: 'inline-flex', alignItems: 'center', gap: 3,
}
