import { useEffect, useState } from 'react'
import { useStore, useSettingsStore } from '@/store'
import { styleProjectService, aiService } from '@/services/fileService'
import { nanoid } from 'nanoid'
import GlassCard from '@/components/common/GlassCard'
import Button from '@/components/common/Button'
import Modal from '@/components/common/Modal'
import ScrollArea from '@/components/common/ScrollArea'
import { inputStyle } from '@/components/common/styles'
import { logError } from '@/utils/logger'
import type { StyleProject, StyleChapter, StyleProfile, StyleProjectMeta, ChapterAnalysis } from '@/types/story'
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
  { regex: /^后记\s*$/, type: 'afterword' }, { regex: /^番外[一二三四五六七八九十百千零\d]*\s*/, type: 'sideStory' },
  { regex: /^第[一二三四五六七八九十百千零\d]+[章卷节回]\s*/, type: 'chapter' },
]

function splitChapters(content: string): StyleChapter[] {
  const lines = content.split('\n')
  const chapters: { title: string; type: StyleChapter['chapterType']; startLine: number }[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line || line.length > 80) continue
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

function parseAnalysisFromReply(reply: string): ChapterAnalysis {
  let jsonStr = reply
  const m = reply.match(/\{[\s\S]*\}/)
  if (m) jsonStr = m[0]
  const parsed = JSON.parse(jsonStr)
  const excerpts = parsed.excerpts || []
  const first = excerpts[0] || {}
  return {
    sentenceStyle: parsed.sentenceStyle || '',
    vocabularyStyle: parsed.vocabularyStyle || '',
    rhetoricStyle: parsed.rhetoricStyle || '',
    rhythmStyle: parsed.rhythmStyle || '',
    dialogueStyle: parsed.dialogueStyle || '',
    moodStyle: parsed.moodStyle || '',
    excerpt: first.text || '',
    excerptNote: first.note || '',
    analyzedAt: new Date().toISOString(),
  }
}

const ANALYZE_PROMPT = `分析以下小说章节的写作风格特征。输出JSON（不要markdown）：
{"sentenceStyle":"句式特征","vocabularyStyle":"词汇偏好","rhetoricStyle":"修辞习惯","rhythmStyle":"节奏模式","dialogueStyle":"对话风格","moodStyle":"氛围基调","excerpts":[{"text":"代表性摘录(50字内)","note":"体现的特征"}]}`

const FEATURE_LABELS: Record<string, string> = {
  sentenceStyle: '句式', vocabularyStyle: '词汇', rhetoricStyle: '修辞',
  rhythmStyle: '节奏', dialogueStyle: '对话', moodStyle: '氛围',
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
      const project: StyleProject = {
        id: `sp_${nanoid(8)}`, name: result.name.replace(/\.txt$/i, ''),
        sourceFileName: result.name, chapters, profile: null,
        createdAt: new Date().toISOString(), totalCharCount: result.content.length,
      }
      await styleProjectService.saveProject(project)
      await loadProjects()
      setSelectedProject(project); setView('detail')
    } catch (err) { logError('导入TXT失败', err); alert('导入失败') }
    setLoading(false)
  }

  const handleEnterProject = async (meta: StyleProjectMeta) => {
    setLoading(true)
    try {
      const proj = await styleProjectService.loadProject(meta.id) as StyleProject
      // Ensure all chapters have analysis field
      proj.chapters = proj.chapters.map(c => ({ ...c, analysis: c.analysis || null, analyzed: c.analyzed || false }))
      setSelectedProject(proj); setSelectedChapterId(proj.chapters[0]?.id || null)
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
          const reply = await aiService.chat([{ role: 'user' as const, content: `${ANALYZE_PROMPT}\n\n[${ch.title}]\n${ch.content}` }], activeConfigId)
          updateChapterAnalysis(ch.id, parseAnalysisFromReply(reply))
          setAnalyzeProgress(`快速模式: ${sample.indexOf(ch) + 1}/${sample.length}`)
        }
      } else {
        const batches: StyleChapter[][] = []
        for (let i = 0; i < chaptersToAnalyze.length; i += 3) batches.push(chaptersToAnalyze.slice(i, i + 3))
        for (let i = 0; i < batches.length; i++) {
          setAnalyzeProgress(`精确模式: ${i + 1}/${batches.length} 批...`)
          for (const ch of batches[i]) {
            const reply = await aiService.chat([{ role: 'user' as const, content: `${ANALYZE_PROMPT}\n\n[${ch.title}]\n${ch.content}` }], activeConfigId)
            updateChapterAnalysis(ch.id, parseAnalysisFromReply(reply))
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
      const analyses = analyzedChapters.map(c => `[${c.title}]\n句式:${c.analysis!.sentenceStyle} 词汇:${c.analysis!.vocabularyStyle} 修辞:${c.analysis!.rhetoricStyle} 节奏:${c.analysis!.rhythmStyle} 对话:${c.analysis!.dialogueStyle} 氛围:${c.analysis!.moodStyle}`).join('\n\n')
      const prompt = `汇总以下 ${analyzedChapters.length} 章的小说风格分析，生成一份完整的风格档案JSON（不要markdown）：\n{"sentenceStyle":"...","vocabularyStyle":"...","rhetoricStyle":"...","rhythmStyle":"...","dialogueStyle":"...","moodStyle":"...","excerpts":[{"text":"摘录","note":"特征"}]}\n\n${analyses}`
      const reply = await aiService.chat([{ role: 'user' as const, content: prompt }], activeConfigId)
      const result = parseAnalysisFromReply(reply)
      const profile: StyleProfile = {
        features: {
          sentenceStyle: result.sentenceStyle, vocabularyStyle: result.vocabularyStyle,
          rhetoricStyle: result.rhetoricStyle, rhythmStyle: result.rhythmStyle,
          dialogueStyle: result.dialogueStyle, moodStyle: result.moodStyle,
        },
        fullDescription: `句式: ${result.sentenceStyle}; 词汇: ${result.vocabularyStyle}; 修辞: ${result.rhetoricStyle}; 节奏: ${result.rhythmStyle}; 对话: ${result.dialogueStyle}; 氛围: ${result.moodStyle}`,
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
                      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#9b8e84' }}><span>{p.sourceFileName}</span><span>{p.chapterCount}章</span><span>{(p.totalCharCount/10000).toFixed(1)}万字</span>{p.hasProfile && <span style={{ color: '#16a34a' }}>✓ 已总结</span>}</div>
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
          <Button size="sm" variant="danger" onClick={() => handleDeleteProject({ id: selectedProject.id, name: selectedProject.name, sourceFileName: '', chapterCount: 0, totalCharCount: 0, hasProfile: false, createdAt: '' })} icon={<TrashIcon style={{ width: 14, height: 14 }} />}>删除</Button>
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
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ch.title}</span>
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
            <div style={{ flex: 1, padding: '20px 28px', overflowY: 'auto', fontSize: 24, lineHeight: 2.1, color: '#4a3f38', whiteSpace: 'pre-wrap' }} className="custom-scrollbar">
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
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                      {Object.entries(FEATURE_LABELS).map(([k, label]) => (
                        <div key={k} style={{ fontSize: 11 }}>
                          <span style={{ fontWeight: 600, color: '#7c3aed' }}>{label}:</span>
                          <span style={{ color: '#4a3f38' }}> {ch.analysis![k as keyof ChapterAnalysis] as string}</span>
                        </div>
                      ))}
                    </div>
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
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                    {Object.entries(selectedProject.profile.features).map(([k, v]) => (
                      <div key={k} style={{ padding: '10px 12px', borderRadius: 8, background: '#faf9f8', fontSize: 12 }}>
                        <div style={{ fontWeight: 700, color: '#7c3aed', marginBottom: 4 }}>{FEATURE_LABELS[k]}</div>
                        <div style={{ color: '#4a3f38', lineHeight: 1.6 }}>{v}</div>
                      </div>
                    ))}
                  </div>
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

const linkBtn: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#7c3aed', padding: 0, fontFamily: 'inherit',
}
