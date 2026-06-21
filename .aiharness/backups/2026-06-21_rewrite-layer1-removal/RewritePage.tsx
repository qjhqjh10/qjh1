import { useState, useEffect } from 'react'
import { useStore, useSettingsStore } from '@/store'
import { rewriteService, extractionService } from '@/services/fileService'
import { chatAI } from '@/utils/chatAI'
import { splitChaptersByHeadings } from '@/utils/textUtils'
import { buildRewriteAnalysisPrompt } from '@/services/continuationService'
import Button from '@/components/common/Button'
import ScrollArea from '@/components/common/ScrollArea'
import RichTextEditor from '@/components/common/RichTextEditor'
import AIPolishDialog from '@/components/common/AIPolishDialog'
import EmptyState from '@/components/common/EmptyState'
import ProjectHubLayout from '@/components/common/ProjectHubLayout'
import Modal from '@/components/common/Modal'
import { ArrowLeftIcon, SparklesIcon, CheckCircleIcon, ArrowRightIcon } from '@heroicons/react/24/outline'
import { logError } from '@/utils/logger'
import { safeJsonParseAs } from '@/utils/safeJsonParse'
import { useRewriteInsertion } from '@/hooks/useRewriteInsertion'

interface RewriteProject { id: string; name: string; chapterCount: number; charCount: number; analyzedCount: number; createdAt: string; updatedAt: string }
interface Chapter { id: string; chapterNumber: number; title: string; content: string }
interface ChapterAnalysis { plotSummary: string; characters: { name: string; gender: string; identity: string; traits: string }[]; keyEvents: string[] }

type Step = 1 | 2 | 3

export default function RewritePage() {
  const activeConfigId = useSettingsStore(s => s.activeConfigId)
  const setActivePage = useStore(s => s.setActivePage)
  const setRewriteContent = useStore(s => s.setRewriteContent)
  const fileVersion = useStore(s => s.fileVersion)
  const fileEditNotify = useStore(s => s.fileEditNotify)
  const setFileEditNotify = useStore(s => s.setFileEditNotify)

  const [projects, setProjects] = useState<RewriteProject[]>([])
  const [projectId, setProjectId] = useState('')
  const [project, setProject] = useState<RewriteProject | null>(null)
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [selectedChIdx, setSelectedChIdx] = useState(0)
  const [chapterContent, setChapterContent] = useState('')
  const [step, setStep] = useState<Step>(1)
  const [analyses, setAnalyses] = useState<Record<string, ChapterAnalysis>>({})
  const [analyzing, setAnalyzing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [polishMode, setPolishMode] = useState<'改写' | '润色' | '续写'>('改写')
  const [polishOpen, setPolishOpen] = useState(false)
  const [selectedRewriteText, setSelectedRewriteText] = useState('')

  // v13.1.0: New project creation
  const [showNewDialog, setShowNewDialog] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')

  const prompts = useSettingsStore(s => s.prompts)

  const openPolish = (mode: '改写' | '润色' | '续写') => {
    const sel = window.getSelection()?.toString()?.trim()
    if (!activeConfigId || !sel || sel.length < 2) { alert('请先在编辑器中选中需要处理的文字'); return }
    setSelectedRewriteText(sel)
    setPolishMode(mode)
    setPolishOpen(true)
  }
  const handlePolishInsert = (text: string) => {
    if (polishMode === '续写') { setChapterContent(prev => prev + '\n\n' + text) }
    else { setChapterContent(text) }
    setPolishOpen(false)
  }

  useEffect(() => { setActivePage('rewrite') }, [])
  useRewriteInsertion(() => chapterContent, setChapterContent)

  useEffect(() => { if (rewriteService) loadProjects() }, [fileVersion])
  useEffect(() => {
    if (!fileEditNotify) return
    const fp = fileEditNotify.filePath.replace(/\\/g, '/').toLowerCase()
    if (fp.includes('/chapters/') || fp.includes('/summaries/')) { loadProjects(); setFileEditNotify(null) }
  }, [fileEditNotify])

  useEffect(() => {
    if (!projectId || !fileVersion) return
    const ch = chapters[selectedChIdx]
    if (!ch) return
    rewriteService.readChapter(projectId, ch.id).then(setChapterContent).catch(() => {})
    rewriteService.readAnalysis(projectId, ch.id).then(raw => {
      if (raw) { try { setAnalyses(prev => ({ ...prev, [ch.id]: JSON.parse(raw) })) } catch {} }
    }).catch(() => {})
  }, [fileVersion])

  const loadProjects = async () => {
    const list = await rewriteService.list()
    setProjects(list)
  }

  const loadProject = async (id: string) => {
    const meta = await rewriteService.readMeta(id)
    setProject(meta)
    setProjectId(id)
    const chs: Chapter[] = []
    const ans: Record<string, ChapterAnalysis> = {}
    for (let i = 1; i <= (meta.chapterCount || 0); i++) {
      const cid = `ch_${i}`
      const content = await rewriteService.readChapter(id, cid)
      chs.push({ id: cid, chapterNumber: i, title: `第${i}章`, content })
      const raw = await rewriteService.readAnalysis(id, cid)
      if (raw) { try { ans[cid] = JSON.parse(raw) } catch (err) { logError(`解析章节${i}分析数据失败`, err) } }
    }
    setChapters(chs)
    setAnalyses(ans)
    if (chs.length > 0) { setSelectedChIdx(0); setChapterContent(chs[0].content) }
  }

  const handleSelectProject = (p: RewriteProject) => { loadProject(p.id) }

  const handleDeleteProject = async (p: RewriteProject) => {
    await rewriteService.delete(p.id)
    if (projectId === p.id) { setProjectId(''); setProject(null); setChapters([]) }
    loadProjects()
  }

  const handleCreateEmpty = async () => {
    if (!newProjectName.trim()) return
    const proj = await rewriteService.create(newProjectName.trim())
    setNewProjectName('')
    setShowNewDialog(false)
    loadProjects()
    loadProject(proj.id)
  }

  const handleImport = async () => {
    if (!extractionService) return
    setImporting(true)
    try {
      const result = await extractionService.importFile() as { name: string; content: string } | null
      if (!result) { setImporting(false); return }
      const split = splitChaptersByHeadings(result.content)
      const proj = await rewriteService.create(result.name.replace(/\.txt$/i, ''))
      for (let i = 0; i < split.length; i++) {
        await rewriteService.writeChapter(proj.id, `ch_${i + 1}`, split[i].content)
      }
      await rewriteService.saveMeta(proj.id, { ...proj, chapterCount: split.length, charCount: split.reduce((s: number, c: any) => s + c.content.length, 0) })
      loadProjects()
      loadProject(proj.id)
    } catch (err) { logError('导入失败', err); alert('导入失败') }
    setImporting(false)
  }

  const handleSaveContent = async () => {
    if (!projectId || !chapters[selectedChIdx]) return
    await rewriteService.writeChapter(projectId, chapters[selectedChIdx].id, chapterContent)
  }

  const handleAnalyzeAll = async () => {
    if (!activeConfigId || chapters.length === 0) return
    setAnalyzing(true)
    const ans = { ...analyses }
    for (let i = 0; i < chapters.length; i++) {
      const ch = chapters[i]
      if (ans[ch.id]) continue
      try {
        const prompt = buildRewriteAnalysisPrompt(ch.title, ch.content, ch.chapterNumber)
        const reply = await chatAI([{ role: 'user', content: prompt }], activeConfigId)
        const data = safeJsonParseAs<ChapterAnalysis>(reply)
        if (data) {
          ans[ch.id] = data
          await rewriteService.writeAnalysis(projectId, ch.id, JSON.stringify(data))
        }
      } catch (err) { logError(`分析第${ch.chapterNumber}章失败`, err) }
    }
    setAnalyses(ans)
    if (project) await rewriteService.saveMeta(projectId, { ...project, analyzedCount: Object.keys(ans).length })
    setAnalyzing(false)
  }

  const selectChapter = (idx: number) => {
    setSelectedChIdx(idx)
    setChapterContent(chapters[idx].content)
  }

  const ch = chapters[selectedChIdx]
  const analysis = ch ? analyses[ch.id] : null
  const analyzedCount = Object.keys(analyses).length

  // v13.1.0: Hub-selected project (for detail card) vs workspace projectId
  const [hubSelectedId, setHubSelectedId] = useState<string | null>(null)

  // ====================== Project list screen (v13.1.0: refactored with ProjectHubLayout) ======================
  if (!projectId) {
    return (
      <>
        <ProjectHubLayout
          title="小说改写"
          projects={projects}
          activeProjectId={hubSelectedId}
          onSelectProject={(p) => setHubSelectedId(p.id)}
          onCreateProject={() => setShowNewDialog(true)}
          onImportProject={handleImport}
          importLabel={importing ? '导入中...' : '导入 TXT'}
          createLabel="新建"
          onDeleteProject={(p) => { handleDeleteProject(p); if (hubSelectedId === p.id) setHubSelectedId(null) }}
          deleteTitle="删除改写项目"
          deleteMessage={(name) => `确定要删除改写项目「${name}」吗？此操作不可撤销。`}
          emptyIcon="📖"
          emptyTitle="暂无改写项目"
          emptyDescription="导入 TXT 文件，AI 将逐章分析剧情并支持改写操作"
          renderProjectItem={(p, active) => (
            <div>
              <div style={{ fontSize: 13, fontWeight: active ? 700 : 500, color: active ? '#7c3aed' : '#2d2520', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.name}
              </div>
              <div style={{ fontSize: 11, color: '#9b8e84', marginTop: 2 }}>
                {p.chapterCount}章 · 已分析{p.analyzedCount || 0} · {p.charCount.toLocaleString()}字
              </div>
            </div>
          )}
          renderEmptyState={() => (
            <EmptyState icon="📖" title="选择左侧改写项目" description="或新建 / 导入一个项目开始改写" />
          )}
          renderProjectDetail={(p) => (
            <div style={{
              width: '82%', minWidth: 520, maxWidth: 880, minHeight: '60vh', margin: '40px auto',
              padding: '44px 48px', borderRadius: 24,
              background: 'rgba(255,255,255,0.75)', backdropFilter: 'blur(24px)',
              border: '1px solid rgba(255,255,255,0.6)',
              boxShadow: '0 8px 40px rgba(0,0,0,0.06), 0 2px 8px rgba(0,0,0,0.04)',
            }}>
              <h3 style={{ fontSize: 24, fontWeight: 700, color: '#2d2520', margin: '0 0 24px' }}>{p.name}</h3>

              <div style={{ display: 'flex', gap: 0, marginBottom: 28, borderRadius: 16, background: 'rgba(124,58,237,0.03)', border: '1px solid rgba(124,58,237,0.06)', overflow: 'hidden' }}>
                <div className="stagger-item" style={{ flex: 1, textAlign: 'center', padding: '16px 12px' }}>
                  <div style={{ fontSize: 26, fontWeight: 700, color: '#7c3aed' }}>{p.chapterCount}</div>
                  <div style={{ fontSize: 11, color: '#9b8e84', marginTop: 2 }}>章节数</div>
                </div>
                <div style={{ width: 1, background: 'rgba(124,58,237,0.06)' }} />
                <div className="stagger-item" style={{ flex: 1, textAlign: 'center', padding: '16px 12px' }}>
                  <div style={{ fontSize: 26, fontWeight: 700, color: '#7c3aed' }}>{p.analyzedCount || 0}</div>
                  <div style={{ fontSize: 11, color: '#9b8e84', marginTop: 2 }}>已分析</div>
                </div>
                <div style={{ width: 1, background: 'rgba(124,58,237,0.06)' }} />
                <div className="stagger-item" style={{ flex: 1, textAlign: 'center', padding: '16px 12px' }}>
                  <div style={{ fontSize: 26, fontWeight: 700, color: '#7c3aed' }}>{p.charCount.toLocaleString()}</div>
                  <div style={{ fontSize: 11, color: '#9b8e84', marginTop: 2 }}>总字数</div>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
                <Button variant="accent-gradient" onClick={() => handleSelectProject(p)} icon={<ArrowRightIcon style={{ width: 16, height: 16 }} />}
                  style={{ flex: 1, justifyContent: 'center', padding: '12px 0', fontSize: 14 }}>
                  进入项目
                </Button>
                <Button variant="secondary" onClick={handleImport} disabled={importing}
                  style={{ padding: '12px 24px' }}>
                  导入 TXT
                </Button>
              </div>
            </div>
          )}
        />

        {/* Create Modal */}
        <Modal isOpen={showNewDialog} onClose={() => setShowNewDialog(false)} title="新建改写项目" width={440}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#6b5e54', marginBottom: 6 }}>项目名称</label>
              <input value={newProjectName} onChange={e => setNewProjectName(e.target.value)}
                placeholder="输入项目名称..." autoFocus className="focus-ring"
                onKeyDown={e => { if (e.key === 'Enter') handleCreateEmpty() }}
                style={{ width: '100%', padding: '10px 14px', fontSize: 14, borderRadius: 10,
                  border: '1px solid #e5e0da', outline: 'none', background: '#faf9f8', fontFamily: 'inherit' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8, borderTop: '1px solid #f0ece8' }}>
              <Button variant="secondary" onClick={() => setShowNewDialog(false)}>取消</Button>
              <Button onClick={handleCreateEmpty} disabled={!newProjectName.trim()}>创建</Button>
            </div>
          </div>
        </Modal>
      </>
    )
  }

  // ====================== Project workspace ======================
  return (
    <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={() => { setProjectId(''); setProject(null); setChapters([]) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9b8e84' }}><ArrowLeftIcon style={{ width: 18, height: 18 }} /></button>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#2d2520' }}>小说改写</span>
        <span style={{ fontSize: 11, color: '#9b8e84' }}>{project?.name}</span>
        <span style={{ fontSize: 11, color: '#9b8e84' }}>{chapters.length}章</span>
        <span style={{ fontSize: 11, color: '#16a34a' }}>已分析{analyzedCount}</span>
        <span style={{ flex: 1 }} />
        <Button size="sm" variant="secondary" onClick={handleImport} disabled={importing}>导入 TXT</Button>
      </div>

      {/* Step tabs */}
      <div style={{ padding: '6px 16px', borderBottom: '1px solid rgba(0,0,0,0.04)', display: 'flex', gap: 4 }}>
        {(['内容浏览', '逐章分析', '剧情改写'] as const).map((label, i) => (
          <button key={i} onClick={() => setStep((i + 1) as Step)} style={{
            padding: '4px 12px', borderRadius: 6, border: 'none', fontSize: 11, cursor: 'pointer',
            background: step === i + 1 ? 'rgba(124,58,237,0.08)' : 'transparent',
            color: step === i + 1 ? '#7c3aed' : '#6b5e54', fontWeight: step === i + 1 ? 700 : 400,
          }}>{step > i + 1 && <CheckCircleIcon style={{ width: 10, height: 10, marginRight: 4, display: 'inline' }} />}{label}</button>
        ))}
        <span style={{ flex: 1 }} />
        {step === 2 && <Button size="sm" onClick={handleAnalyzeAll} disabled={analyzing || !activeConfigId} icon={<SparklesIcon style={{ width: 11, height: 11 }} />}>{analyzing ? '分析中...' : '全部逐章分析'}</Button>}
      </div>

      {/* Content area */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Step 1: Browse */}
        {step === 1 && (
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            <div style={{ width: 180, borderRight: '1px solid rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '8px 12px', fontSize: 11, fontWeight: 600, color: '#6b5e54', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>章节 ({chapters.length})</div>
              <ScrollArea style={{ flex: 1 }}>
                {chapters.map((c, i) => (
                  <div key={i} onClick={() => selectChapter(i)} style={{ padding: '6px 12px', fontSize: 11, cursor: 'pointer', background: selectedChIdx === i ? 'rgba(124,58,237,0.06)' : 'transparent', borderLeft: selectedChIdx === i ? '2px solid #7c3aed' : '2px solid transparent', color: '#2d2520' }}>第{c.chapterNumber}章</div>
                ))}
              </ScrollArea>
            </div>
            <ScrollArea style={{ flex: 1, padding: '20px 24px' }}>
              {ch && (
                <div style={{ padding: '24px 28px', borderRadius: 14, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', fontSize: 14, lineHeight: 2.2, whiteSpace: 'pre-wrap' }}>
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: '#7c3aed', marginBottom: 16 }}>第{ch.chapterNumber}章</h3>
                  {ch.content}
                </div>
              )}
            </ScrollArea>
          </div>
        )}

        {/* Step 2: Analysis */}
        {step === 2 && (
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            <div style={{ width: 180, borderRight: '1px solid rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '8px 12px', fontSize: 11, fontWeight: 600, color: '#6b5e54', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>章节 ({analyzedCount}/{chapters.length})</div>
              <ScrollArea style={{ flex: 1 }}>
                {chapters.map((c, i) => (
                  <div key={i} onClick={() => selectChapter(i)} style={{ padding: '6px 12px', fontSize: 11, cursor: 'pointer', background: selectedChIdx === i ? 'rgba(124,58,237,0.06)' : 'transparent', borderLeft: selectedChIdx === i ? '2px solid #7c3aed' : '2px solid transparent', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: analyses[c.id] ? '#16a34a' : '#d9d2cc', fontSize: 10 }}>{analyses[c.id] ? '✓' : '○'}</span>
                    <span style={{ color: '#2d2520' }}>第{c.chapterNumber}章</span>
                  </div>
                ))}
              </ScrollArea>
            </div>
            <ScrollArea style={{ flex: 1, padding: '16px 20px' }}>
              {analysis ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ padding: '16px 18px', borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,0.06)' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#7c3aed', marginBottom: 8 }}>📋 剧情概述</div>
                    <div style={{ fontSize: 13, color: '#4a3f38', lineHeight: 1.9 }}>{analysis.plotSummary}</div>
                  </div>
                  <div style={{ padding: '16px 18px', borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,0.06)' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#f59e0b', marginBottom: 8 }}>👤 角色 ({analysis.characters.length})</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {analysis.characters.map((c, j) => (
                        <div key={j} style={{ padding: '8px 12px', borderRadius: 8, background: '#faf9f8', fontSize: 11 }}>
                          <span style={{ fontWeight: 600, color: '#2d2520' }}>{c.name}</span>
                          <span style={{ color: '#6b5e54', marginLeft: 6 }}>{c.gender} · {c.identity || '未知'}</span>
                          <div style={{ color: '#9b8e84', marginTop: 2 }}>{c.traits}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div style={{ padding: '16px 18px', borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,0.06)' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#16a34a', marginBottom: 8 }}>⚡ 关键事件 ({analysis.keyEvents.length})</div>
                    {analysis.keyEvents.map((ev, j) => (
                      <div key={j} style={{ fontSize: 12, color: '#4a3f38', padding: '4px 0', borderBottom: '1px solid rgba(0,0,0,0.03)' }}>{j + 1}. {ev}</div>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: 60, color: '#9b8e84' }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>🔍</div>
                  <div style={{ fontSize: 14 }}>本章尚未分析</div>
                  <div style={{ fontSize: 12, marginTop: 4 }}>点击右上角"全部逐章分析"开始 AI 分析</div>
                </div>
              )}
            </ScrollArea>
          </div>
        )}

        {/* Step 3: Rewrite */}
        {step === 3 && (
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            <div style={{ width: 140, borderRight: '1px solid rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '8px 10px', fontSize: 10, fontWeight: 600, color: '#6b5e54', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>章节</div>
              <ScrollArea style={{ flex: 1 }}>
                {chapters.map((c, i) => (
                  <div key={i} onClick={() => selectChapter(i)} style={{ padding: '5px 10px', fontSize: 10, cursor: 'pointer', background: selectedChIdx === i ? 'rgba(124,58,237,0.06)' : 'transparent', borderLeft: selectedChIdx === i ? '2px solid #7c3aed' : '2px solid transparent', color: '#2d2520' }}>
                    第{c.chapterNumber}章 {analyses[c.id] ? '✓' : ''}
                  </div>
                ))}
              </ScrollArea>
            </div>
            <div style={{ flex: 1, borderRight: '1px solid rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '6px 12px', borderBottom: '1px solid rgba(0,0,0,0.04)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54' }}>第{ch?.chapterNumber}章</span>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <Button size="sm" variant="ghost" onClick={() => openPolish('改写')} disabled={!activeConfigId} style={{ fontSize: 10, padding: '2px 8px' }} >✏️ 改写</Button>
                  <Button size="sm" variant="ghost" onClick={() => openPolish('润色')} disabled={!activeConfigId} style={{ fontSize: 10, padding: '2px 8px' }}>✨ 润色</Button>
                  <Button size="sm" variant="ghost" onClick={() => openPolish('续写')} disabled={!activeConfigId} style={{ fontSize: 10, padding: '2px 8px' }}>📝 续写</Button>
                  <Button size="sm" variant="secondary" onClick={handleSaveContent} style={{ fontSize: 10, padding: '2px 8px' }}>保存</Button>
                </div>
              </div>
              <div style={{ flex: 1, overflow: 'hidden', display: 'flex', justifyContent: 'center' }}>
                <RichTextEditor content={chapterContent} onContentChange={(c) => { setChapterContent(c); setRewriteContent(c) }} placeholder="章节内容..." />
              </div>
            </div>
            <ScrollArea style={{ width: 340, padding: '12px' }}>
              {analysis ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ padding: '12px 14px', borderRadius: 10, background: '#fff', border: '1px solid rgba(0,0,0,0.06)' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#7c3aed', marginBottom: 6 }}>📋 剧情概述</div>
                    <div style={{ fontSize: 11, color: '#4a3f38', lineHeight: 1.8 }}>{analysis.plotSummary}</div>
                  </div>
                  <div style={{ padding: '12px 14px', borderRadius: 10, background: '#fff', border: '1px solid rgba(0,0,0,0.06)' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b', marginBottom: 6 }}>👤 角色 ({analysis.characters.length})</div>
                    {analysis.characters.map((c, j) => (
                      <div key={j} style={{ fontSize: 10, padding: '3px 0', borderBottom: '1px solid rgba(0,0,0,0.03)' }}>
                        <span style={{ fontWeight: 600 }}>{c.name}</span> <span style={{ color: '#6b5e54' }}>{c.gender} · {c.identity}</span>
                        <div style={{ color: '#9b8e84' }}>{c.traits}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ padding: '12px 14px', borderRadius: 10, background: '#fff', border: '1px solid rgba(0,0,0,0.06)' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#16a34a', marginBottom: 6 }}>⚡ 关键事件</div>
                    {analysis.keyEvents.map((ev, j) => (
                      <div key={j} style={{ fontSize: 10, color: '#4a3f38', padding: '3px 0', borderBottom: '1px solid rgba(0,0,0,0.03)' }}>{j + 1}. {ev}</div>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: 40, color: '#9b8e84', fontSize: 12 }}>该章未分析</div>
              )}
            </ScrollArea>
          </div>
        )}

        <AIPolishDialog
          isOpen={polishOpen}
          mode={polishMode}
          selectedText={selectedRewriteText}
          prompts={prompts}
          configId={activeConfigId}
          projectId={projectId || null}
          onClose={() => setPolishOpen(false)}
          onInsert={handlePolishInsert}
        />
      </div>
    </div>
  )
}
