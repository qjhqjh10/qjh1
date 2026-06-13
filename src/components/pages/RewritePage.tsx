import { useState, useEffect } from 'react'
import { useStore, useSettingsStore } from '@/store'
import { aiService, rewriteService, extractionService } from '@/services/fileService'
import { chatAI } from '@/utils/chatAI'
// 注意: rewriteService 和 extractionService 来自 @/services/fileService 封装层，不是 window.electron 直接调用。
// Service 层提供了完整的类型安全和错误处理，请勿改为 (window as any).electron?.xxx 的访问方式。
import { splitChaptersByHeadings } from '@/utils/textUtils'
import { buildRewriteAnalysisPrompt } from '@/services/continuationService'
import Button from '@/components/common/Button'
import ScrollArea from '@/components/common/ScrollArea'
import RichTextEditor from '@/components/common/RichTextEditor'
import AIPolishDialog from '@/components/common/AIPolishDialog'
import { ArrowLeftIcon, SparklesIcon, CheckCircleIcon, TrashIcon } from '@heroicons/react/24/outline'
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
  // AI 改写/润色/续写 — 统一使用 AIPolishDialog
  const [polishMode, setPolishMode] = useState<'改写' | '润色' | '续写'>('改写')
  const [polishOpen, setPolishOpen] = useState(false)
  const [selectedRewriteText, setSelectedRewriteText] = useState('')

  const prompts = useSettingsStore(s => s.prompts)

  const openPolish = (mode: '改写' | '润色' | '续写') => {
    const sel = window.getSelection()?.toString()?.trim()
    if (!activeConfigId || !sel || sel.length < 2) { alert('请先在编辑器中选中需要处理的文字'); return }
    setSelectedRewriteText(sel)
    setPolishMode(mode)
    setPolishOpen(true)
  }
  const handlePolishInsert = (text: string) => {
    if (polishMode === '续写') {
      setChapterContent(prev => prev + '\n\n' + text)
    } else {
      setChapterContent(text)
    }
    setPolishOpen(false)
  }

  // Set activePage for AI assistant
  useEffect(() => { setActivePage('rewrite') }, [])

  // Handle insertion action from AI assistant (rewrite: red/blue annotation)
  useRewriteInsertion(() => chapterContent, setChapterContent)

  useEffect(() => { if (rewriteService) loadProjects() }, [fileVersion])

  // AI 修改文件后刷新当前项目内容
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
    // Load chapters + analyses
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
    if (!confirm(`删除项目「${p.name}」？`)) return
    await rewriteService.delete(p.id)
    if (projectId === p.id) { setProjectId(''); setProject(null); setChapters([]) }
    loadProjects()
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

  // ====================== Project list screen ======================
  if (!projectId) {
    return (
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div style={{ width: 260, borderRight: '1px solid rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', background: 'rgba(255,255,255,0.4)' }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid rgba(0,0,0,0.04)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#2d2520' }}>改写项目</span>
            <span style={{ fontSize: 10, color: '#9b8e84' }}>{projects.length}个</span>
          </div>
          <ScrollArea style={{ flex: 1 }}>
            {projects.map(p => (
              <div key={p.id} onClick={() => handleSelectProject(p)} style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid rgba(0,0,0,0.03)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#2d2520' }}>{p.name}</div>
                  <div style={{ fontSize: 10, color: '#9b8e84', marginTop: 2 }}>{p.chapterCount}章 · 已分析{p.analyzedCount || 0}</div>
                </div>
                <button onClick={e => { e.stopPropagation(); handleDeleteProject(p) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#d4ccc4', padding: 2 }}><TrashIcon style={{ width: 14, height: 14 }} /></button>
              </div>
            ))}
            {projects.length === 0 && <div style={{ textAlign: 'center', padding: 40, color: '#9b8e84', fontSize: 12 }}>暂无项目</div>}
          </ScrollArea>
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>📖</div>
            <div style={{ fontSize: 15, color: '#9b8e84', marginBottom: 16 }}>导入 TXT 文件开始剧情改写</div>
            <Button size="sm" onClick={handleImport} disabled={importing || !activeConfigId} icon={<SparklesIcon style={{ width: 14, height: 14 }} />}>{importing ? '导入中...' : '导入 TXT'}</Button>
          </div>
        </div>
      </div>
    )
  }

  // ====================== Project workspace ======================
  return (
    <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={() => { setProjectId(''); setProject(null); setChapters([]) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9b8e84' }}><ArrowLeftIcon style={{ width: 18, height: 18 }} /></button>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#2d2520' }}>剧情改写</span>
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
            {/* Left: chapter list */}
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
            {/* Center: editable content */}
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
            {/* Right: analysis cards */}
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
