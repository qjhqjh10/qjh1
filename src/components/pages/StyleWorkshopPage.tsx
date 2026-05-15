import { useEffect, useState } from 'react'
import { useStore, useSettingsStore } from '@/store'
import { styleProjectService, aiService } from '@/services/fileService'
import { nanoid } from 'nanoid'
import GlassCard from '@/components/common/GlassCard'
import Button from '@/components/common/Button'
import Modal from '@/components/common/Modal'
import ScrollArea from '@/components/common/ScrollArea'
import { inputStyle } from '@/components/common/styles'
import { buildStyleAnalyzePrompt, parseStyleAnalysisReply } from '@/services/extractionService'
import { logError } from '@/utils/logger'
import type { StyleProject, StyleChapter, StyleProfile, StyleProjectMeta, ChapterAnalysis } from '@/types/story'
import { DIMENSION_META, NOVEL_TYPES, NOVEL_TYPE_DIMS } from '@/types/story'
import {
  SparklesIcon, PlusIcon, TrashIcon, PencilIcon, XMarkIcon,
  DocumentTextIcon, PaintBrushIcon, FolderOpenIcon,
  ArrowLeftIcon, CheckIcon, ClockIcon, DocumentMagnifyingGlassIcon,
} from '@heroicons/react/24/outline'

type ViewMode = 'library' | 'detail'
type ResultTab = 'chapters' | 'overall'

const CHAPTER_PATTERNS: { regex: RegExp; type: StyleChapter['chapterType'] }[] = [
  { regex: /^楔子\s*$/, type: 'prologue' }, { regex: /^序章\s*$/, type: 'prologue' },
  { regex: /^引子\s*$/, type: 'prologue' }, { regex: /^前言\s*$/, type: 'prologue' },
  { regex: /^终章\s*$/, type: 'epilogue' }, { regex: /^尾声\s*$/, type: 'epilogue' },
  { regex: /^后记\s*$/, type: 'afterword' }, { regex: /^番外[一二三四五六七八九十百千零\d]+\s*$/, type: 'sideStory' },
  { regex: /^第[一二三四五六七八九十百千零\d]+[章卷节回](\s+.{1,40})?$/, type: 'chapter' },
]

function splitChapters(content: string): StyleChapter[] {
  const lines = content.split('\n')
  const chapters: { title: string; type: StyleChapter['chapterType']; startLine: number }[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    if (line.length > 40) continue
    for (const pat of CHAPTER_PATTERNS) {
      if (pat.regex.test(line)) { chapters.push({ title: line, type: pat.type, startLine: i }) }
    }
  }
  const result: StyleChapter[] = []
  let chapterNum = 0
  for (let c = 0; c < chapters.length; c++) {
    const start = chapters[c].startLine
    const end = c < chapters.length - 1 ? chapters[c + 1].startLine : lines.length
    const body = lines.slice(start, end).join('\n').trim()
    if (body.length < 50) continue
    chapterNum++
    result.push({ id: `ch_${chapterNum}`, title: chapters[c].title, chapterNumber: chapterNum, chapterType: chapters[c].type, content: body, charCount: body.length, analyzed: false, analysis: null })
  }
  if (result.length === 0 && content.trim().length > 0) {
    result.push({ id: 'ch_1', title: '全文', chapterNumber: 1, chapterType: 'chapter', content: content.trim(), charCount: content.length, analyzed: false, analysis: null })
  }
  return result
}
const FEATURE_LABELS: Record<string, string> = {
  sentenceStyle: '句式', vocabularyStyle: '词汇', rhetoricStyle: '修辞',
  rhythmStyle: '节奏', dialogueStyle: '对话', moodStyle: '氛围',
  perspectiveStyle: '视角', bodyLanguageStyle: '身体', sensoryStyle: '感官',
  tensionStyle: '张力', subtextStyle: '暗示', descriptionPattern: '描写结构',
  corruptionArc: '人物演变', degradationRitual: '场景机制', narrativeVoice: '叙事声音', shameVoyeurLoop: '心理循环',
  socialRealism: '社会现实', cultivationCombat: '修炼战斗', romanceArc: '感情发展', archaicStyle: '古风文言', suspensePacing: '悬疑节奏',
}

export default function StyleWorkshopPage() {
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
  const [enabledDimensions, setEnabledDimensions] = useState<string[]>(Object.keys(DIMENSION_META))
  const [showResult, setShowResult] = useState(false)
  const [resultTab, setResultTab] = useState<ResultTab>('chapters')
  const [summarizeLoading, setSummarizeLoading] = useState(false)

  const [showApply, setShowApply] = useState(false)
  const projectsList = useStore(s => s.projects)
  const styleAssignments = useSettingsStore(s => s.aiSettings.styleAssignments || {})
  const setStyleAssignments = useSettingsStore(s => s.setAISettings)
  const activeConfigId = useSettingsStore(s => s.activeConfigId)

  useEffect(() => { loadProjects() }, [])

  const loadProjects = async () => {
    try { setProjects(await styleProjectService.listProjects() as StyleProjectMeta[]) } catch { /* */ }
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
      // Ensure all chapters have analysis field and backward compat for novelType/enabledDimensions
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
  const handleAnalyze = async () => {
    if (!selectedProject || !activeConfigId) return
    const chaptersToAnalyze = selectedProject.chapters.filter(c => analyzeIds.has(c.id))
    if (chaptersToAnalyze.length === 0) return
    setAnalyzeLoading(true)
    try {
      if (analyzeMode === 'quick') {
        const sample = chaptersToAnalyze.sort(() => Math.random() - 0.5).slice(0, 10)
        setAnalyzeProgress(`快速模式: ${sample.length} 章...`)
        // Analyze all at once, then split result per chapter (simple approach: assign same analysis to each)
        for (const ch of sample) {
          const reply = await aiService.chat([{ role: 'user' as const, content: `${buildStyleAnalyzePrompt(enabledDimensions)}\n\n[${ch.title}]\n${ch.content}` }], activeConfigId)
          updateChapterAnalysis(ch.id, parseStyleAnalysisReply(reply))
          setAnalyzeProgress(`快速模式: ${sample.indexOf(ch) + 1}/${sample.length}`)
        }
      } else {
        const batches: StyleChapter[][] = []
        for (let i = 0; i < chaptersToAnalyze.length; i += 3) batches.push(chaptersToAnalyze.slice(i, i + 3))
        for (let i = 0; i < batches.length; i++) {
          setAnalyzeProgress(`精确模式: ${i + 1}/${batches.length} 批...`)
          for (const ch of batches[i]) {
            const reply = await aiService.chat([{ role: 'user' as const, content: `${buildStyleAnalyzePrompt(enabledDimensions)}\n\n[${ch.title}]\n${ch.content}` }], activeConfigId)
            updateChapterAnalysis(ch.id, parseStyleAnalysisReply(reply))
          }
        }
      }
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
      // Save after state update
      styleProjectService.saveProject(updated).catch(() => {})
      return updated
    })
  }

  // ---- Summarize ----
  const handleSummarize = async () => {
    if (!selectedProject || !activeConfigId) return
    const analyzedChapters = selectedProject.chapters.filter(c => c.analysis)
    if (analyzedChapters.length === 0) { alert('没有已分析的章节'); return }
    setSummarizeLoading(true)
    try {
      const analyses = analyzedChapters.map(c => {
        const a = c.analysis!
        return `[${c.title}]\n句式:${a.sentenceStyle} 词汇:${a.vocabularyStyle} 修辞:${a.rhetoricStyle} 节奏:${a.rhythmStyle} 对话:${a.dialogueStyle} 氛围:${a.moodStyle} 视角:${a.perspectiveStyle} 身体:${a.bodyLanguageStyle} 感官:${a.sensoryStyle} 张力:${a.tensionStyle} 暗示:${a.subtextStyle} 描写结构:${JSON.stringify(a.descriptionPattern)} 堕落弧线:${JSON.stringify(a.corruptionArc)} 仪式剧本:${JSON.stringify(a.degradationRitual)} 叙事声音:${JSON.stringify(a.narrativeVoice)} 场景装置:${JSON.stringify(a.sceneMechanics)} 躯体状态:${JSON.stringify(a.somaticTension)} 身份溶解:${JSON.stringify(a.identityDissolution)} 心理循环:${JSON.stringify(a.shameVoyeurLoop)}`
      }).join('\n\n')
      const prompt = `汇总以下 ${analyzedChapters.length} 章的小说风格分析，生成一份完整的风格档案JSON（不要markdown）：\n{"sentenceStyle":"...","vocabularyStyle":"...","rhetoricStyle":"...","rhythmStyle":"...","dialogueStyle":"...","moodStyle":"...","perspectiveStyle":"...","bodyLanguageStyle":"...","sensoryStyle":"...","tensionStyle":"...","subtextStyle":"...","descriptionPattern":{"bodyOrder":["头发","脸","胸"...],"sections":[{"part":"...","sentenceCount":"1-2句","details":["..."],"order":1}],"stockingDetail":"...","characterVisualProfile":"...","detailFingerprints":["..."]},"excerpts":[{"text":"...","note":"..."}]}\n\n${analyses}`
      const reply = await aiService.chat([{ role: 'user' as const, content: prompt }], activeConfigId)
      const result = parseStyleAnalysisReply(reply)
      const profile: StyleProfile = {
        features: {
          sentenceStyle: result.sentenceStyle, vocabularyStyle: result.vocabularyStyle,
          rhetoricStyle: result.rhetoricStyle, rhythmStyle: result.rhythmStyle,
          dialogueStyle: result.dialogueStyle, moodStyle: result.moodStyle,
          perspectiveStyle: result.perspectiveStyle, bodyLanguageStyle: result.bodyLanguageStyle,
          sensoryStyle: result.sensoryStyle, tensionStyle: result.tensionStyle,
          subtextStyle: result.subtextStyle,
          descriptionPattern: result.descriptionPattern || null,
          corruptionArc: result.corruptionArc || null,
          degradationRitual: result.degradationRitual || null,
          narrativeVoice: result.narrativeVoice || null,
          sceneMechanics: result.sceneMechanics || null,
          somaticTension: result.somaticTension || null,
          identityDissolution: result.identityDissolution || null,
          shameVoyeurLoop: result.shameVoyeurLoop || null,
        },
        fullDescription: `句式: ${result.sentenceStyle}; 词汇: ${result.vocabularyStyle}; 修辞: ${result.rhetoricStyle}; 节奏: ${result.rhythmStyle}; 对话: ${result.dialogueStyle}; 氛围: ${result.moodStyle}; 视角: ${result.perspectiveStyle}; 身体: ${result.bodyLanguageStyle}; 感官: ${result.sensoryStyle}; 张力: ${result.tensionStyle}; 暗示: ${result.subtextStyle}`,
        excerpts: result.excerpt ? [{ text: result.excerpt, note: result.excerptNote }] : [],
        analyzedAt: new Date().toISOString(),
        analyzedChapterCount: analyzedChapters.length,
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

  const selectedChapter = selectedProject?.chapters.find(c => c.id === selectedChapterId)
  const analyzedChapters = selectedProject?.chapters.filter(c => c.analysis) || []

  // ---- Library View ----
  if (view === 'library') {
    return (
      <div className="page-enter" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: 32 }}>
        <div style={{ maxWidth: 900, width: '100%', margin: '0 auto', flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
            <div><h2 style={{ fontSize: 22, fontWeight: 700, color: '#2d2520' }}>风格工坊</h2><p style={{ fontSize: 13, color: '#9b8e84', marginTop: 4 }}>导入名家作品，AI分析提取写作风格</p></div>
            <Button onClick={handleImport} disabled={loading} icon={<FolderOpenIcon style={{ width: 16, height: 16 }} />}>{loading ? '导入中...' : '导入TXT小说'}</Button>
          </div>
          {projects.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 80, color: '#9b8e84' }}><PaintBrushIcon style={{ width: 56, height: 56, margin: '0 auto 16px', opacity: 0.2 }} /><p style={{ fontSize: 15 }}>暂无风格档案</p></div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {projects.map(p => (
                <GlassCard key={p.id} hover={false} style={{ padding: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                    <div style={{ flex: 1 }}><h3 style={{ fontSize: 16, fontWeight: 700, color: '#2d2520', marginBottom: 6 }}>{p.name}</h3>
                      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#9b8e84' }}><span>{p.sourceFileName}</span><span>{p.chapterCount}章</span><span>{(p.totalCharCount/10000).toFixed(1)}万字</span><span style={{ color: '#7c3aed' }}>{p.novelType || '通用'}</span>{p.hasProfile && <span style={{ color: '#16a34a' }}>✓ 已总结</span>}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}><Button size="sm" onClick={() => handleEnterProject(p)}>查看详情</Button><Button size="sm" variant="ghost" onClick={() => { setShowApply(true) }}>应用</Button><button onClick={() => handleDeleteProject(p)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, color: '#d4ccc4' }}><TrashIcon style={{ width: 16, height: 16 }} /></button></div>
                  </div>
                </GlassCard>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  if (!selectedProject) return null

  // ---- Detail View ----
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
        <select value={analyzeMode} onChange={e => setAnalyzeMode(e.target.value as 'precise' | 'quick')} style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.1)', fontSize: 11 }}><option value="precise">精确模式</option><option value="quick">快速模式</option></select>
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
                          <span style={{ color: '#4a3f38' }}> {ch.analysis![k as keyof ChapterAnalysis] as string}</span>
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
                        <div style={{ color: '#4a3f38', lineHeight: 1.6 }}>{v as React.ReactNode}</div>
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
                <div style={{ fontSize: 12, fontWeight: 700, color: cat === '情色专属' ? '#ec4899' : cat === '类型专属' ? '#f59e0b' : '#7c3aed', marginBottom: 8 }}>{cat} ({activeInCat.length}维)</div>
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
            <button onClick={() => setEnabledDimensions(Object.keys(DIMENSION_META).filter(k => ['基础文风','进阶技法'].includes(DIMENSION_META[k].category)))} style={presetBtn}>✨ 基础通用</button>
            <button onClick={() => setEnabledDimensions(Object.keys(DIMENSION_META))} style={presetBtn}>🔞 情色全维</button>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#6b5e54', marginLeft: 8 }}>类型:</span>
            {['通用','都市','修仙','恋爱','古风','悬疑'].map(genre => (
              <button key={genre} onClick={() => {
                let dims = enabledDimensions.filter(k => DIMENSION_META[k].category !== '类型专属')
                if (genre === '通用') { setEnabledDimensions(dims) }
                else {
                  const genreKeys = Object.keys(DIMENSION_META).filter(k => DIMENSION_META[k].category === '类型专属' && (k === ({'都市':'socialRealism','修仙':'cultivationCombat','恋爱':'romanceArc','古风':'archaicStyle','悬疑':'suspensePacing'}[genre])) )
                  const others = Object.keys(DIMENSION_META).filter(k => DIMENSION_META[k].category === '类型专属' && !genreKeys.includes(k))
                  setEnabledDimensions([...dims.filter(k => !others.includes(k)), ...genreKeys])
                }
              }} style={presetBtn}>{genre}</button>
            ))}
            <button onClick={() => setEnabledDimensions(Object.keys(DIMENSION_META))} style={{ ...presetBtn, fontSize: 10 }}>全选</button>
            <button onClick={() => setEnabledDimensions([])} style={{ ...presetBtn, fontSize: 10, color: '#9b8e84' }}>清空</button>
          </div>
          {/* Grouped checkboxes */}
          {[...new Set(Object.values(DIMENSION_META).map(m => m.category))].map(cat => (
            <div key={cat}>
              <div style={{ fontSize: 12, fontWeight: 700, color: cat === '情色专属' ? '#ec4899' : cat === '类型专属' ? '#f59e0b' : '#7c3aed', marginBottom: 6 }}>{cat}</div>
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
            <Button onClick={() => setShowDimConfig(false)}>确定</Button>
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
  // Handle simple string prompts: "描述1+描述2+描述3"
  if (prompt.startsWith('"') && !prompt.startsWith('"[') && !prompt.startsWith('"{')) {
    const inner = prompt.replace(/^"[^"]+":\s*"/, '').replace(/"$/, '')
    return inner.split('+').map(p => p.replace(/[:：].*/, '').trim()).filter(Boolean).join('、')
  }
  // Handle JSON prompts: extract key fields and show them
  const fields: string[] = []
  const jsonMatch = prompt.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    const keyMatches = jsonMatch[0].matchAll(/"(\w+)":"([^"]+)"/g)
    for (const m of keyMatches) {
      if (fields.length < 5) fields.push(`${m[1]}: ${m[2].slice(0, 30)}`)
    }
    if (fields.length > 0) return fields.join('; ')
  }
  // Fallback: truncate
  return prompt.length > 80 ? prompt.slice(0, 80) + '...' : prompt
}

const presetBtn: React.CSSProperties = {
  padding: '4px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', background: '#fff',
  fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', color: '#2d2520', fontWeight: 500,
}
const linkBtn: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#7c3aed', padding: 0, fontFamily: 'inherit',
}
