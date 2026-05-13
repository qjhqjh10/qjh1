import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore, useSettingsStore } from '@/store'
import { fileService, exportService, dialogService, aiService } from '@/services/fileService'
import { loadCharacters } from '@/components/pages/CharactersPage'
import RichTextEditor from '@/components/common/RichTextEditor'
import ScrollArea from '@/components/common/ScrollArea'
import Button from '@/components/common/Button'
import Modal from '@/components/common/Modal'
import ChapterGenerationModal from '@/components/common/ChapterGenerationModal'
import type { VersionRecord } from '@/components/common/ChapterGenerationModal'
import BatchGenerationModal from '@/components/common/BatchGenerationModal'
import ReviewModal from '@/components/common/ReviewModal'
import ReviewResultsModal from '@/components/common/ReviewResultsModal'
import {
  ArrowLeftIcon,
  DocumentArrowDownIcon,
  UserIcon,
  SparklesIcon,
  CheckCircleIcon,
  ClipboardDocumentCheckIcon,
  ClockIcon,
  DocumentTextIcon,
} from '@heroicons/react/24/outline'
import type { DetailedChapter } from '@/types/chapter'
import { countChineseWords, formatWordCount } from '@/utils/textUtils'

export default function ChapterWritingPage() {
  const { chapterId } = useParams<{ chapterId: string }>()
  const navigate = useNavigate()
  const activeProjectId = useStore(s => s.activeProjectId)

  // Redirect if no project selected
  useEffect(() => {
    if (!activeProjectId) navigate('/')
  }, [activeProjectId, navigate])
  const projectsBasePath = useStore(s => s.projectsBasePath)
  const detailedChapters = useStore(s => s.detailedChapters)
  const updateDetailedChapter = useStore(s => s.updateDetailedChapter)
  const characters = useStore(s => s.characters)
  const writingChapters = useStore(s => s.writingChapters)
  const setWritingChapter = useStore(s => s.setWritingChapter)
  const setActivePage = useStore(s => s.setActivePage)
  const setCurrentChapterId = useStore(s => s.setCurrentChapterId)
  const insertionAction = useStore(s => s.insertionAction)
  const setInsertionAction = useStore(s => s.setInsertionAction)
  const worldbuildingContent = useStore(s => s.worldbuildingContent)
  const outlineContent = useStore(s => s.outlineContent)

  const activeConfigId = useSettingsStore(s => s.activeConfigId)
  const promptTemplates = useSettingsStore(s => s.prompts)

  const [content, setContent] = useState('')
  const [projectPath, setProjectPath] = useState('')
  const [showSummaryTemplate, setShowSummaryTemplate] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [showAIGen, setShowAIGen] = useState(false)
  const [showReview, setShowReview] = useState(false)
  const [showReviewResults, setShowReviewResults] = useState(false)
  const [showBatchGen, setShowBatchGen] = useState(false)
  const [showVersions, setShowVersions] = useState(false)
  const [versionHistory, setVersionHistory] = useState<VersionRecord[]>([])
  const [aiLoading, setAiLoading] = useState(false)
  const [selectedSummaryTemplate, setSelectedSummaryTemplate] = useState('')

  // Generation overlay state
  const [genOverlay, setGenOverlay] = useState(false)
  const [genWordCount, setGenWordCount] = useState(0)
  const [genDragPos, setGenDragPos] = useState({ x: 0, y: 0 })
  const genAbortRef = useRef<(() => void) | null>(null)

  const detailedChapter = detailedChapters.find(c => c.id === chapterId)

  // Load chapter content
  useEffect(() => {
    if (!activeProjectId || !chapterId || !projectsBasePath) return
    const pp = `${projectsBasePath}/${activeProjectId}`
    setProjectPath(pp)
    setActivePage('chapter')
    setCurrentChapterId(chapterId)
    fileService.read(`${pp}/chapters/${chapterId}.txt`).then(c => {
      const dc = detailedChapters.find(c => c.id === chapterId)
      setContent(c)
      setWritingChapter(chapterId, {
        id: chapterId, detailedChapterId: chapterId,
        title: dc?.title || '', content: c,
        summary: dc?.summary || '',
      })
    })
    // Load characters if not already in store
    if (characters.length === 0) {
      loadCharacters(pp).then(chars => {
        useStore.getState().setCharacters(chars)
      })
    }
    // Load existing version history from disk
    loadVersionHistory(pp, chapterId).then(setVersionHistory)
  }, [activeProjectId, chapterId, projectsBasePath, detailedChapters])

  // Handle insertion action from AI
  useEffect(() => {
    if (!insertionAction) return
    const { keyword, content: insContent, position } = insertionAction

    if (insContent && keyword) {
      const idx = content.indexOf(keyword)
      if (idx !== -1) {
        const insertPos = position === 'after' ? idx + keyword.length : idx
        const newText = content.slice(0, insertPos) + '\n\n' + insContent + content.slice(insertPos)
        setContent(newText)
      }
    }
    setInsertionAction(null)
  }, [insertionAction, setInsertionAction, content])

  // Save (file + store for export). Accept optional content to avoid stale closure.
  const handleSave = async (overrideContent?: string) => {
    if (!projectPath || !chapterId) return
    const c = overrideContent ?? content
    await fileService.write(`${projectPath}/chapters/${chapterId}.txt`, c)
    setWritingChapter(chapterId, {
      id: chapterId,
      detailedChapterId: chapterId,
      title: detailedChapter?.title || '',
      content: c,
      summary: detailedChapter?.summary || '',
    })
  }

  // Save then navigate
  const saveAndNavigate = async (targetChapterId: string) => {
    // Save current chapter first
    if (projectPath && chapterId) {
      await fileService.write(`${projectPath}/chapters/${chapterId}.txt`, content)
      setWritingChapter(chapterId, {
        id: chapterId, detailedChapterId: chapterId,
        title: detailedChapter?.title || '', content,
        summary: detailedChapter?.summary || '',
      })
    }
    setActivePage('chapter')
    setCurrentChapterId(targetChapterId)
    navigate(`/chapter/${targetChapterId}`)
  }

  const handleAIExtract = async () => {
    if (!activeConfigId || !detailedChapter || !content.trim()) return
    setAiLoading(true)
    try {
      const templatePrompt = selectedSummaryTemplate || '请用简洁的语言总结以下章节内容的核心情节、人物发展和关键转折点。'
      const messages = [
        { role: 'user' as const, content: `${templatePrompt}\n\n章节标题: ${detailedChapter.title}\n\n章节内容:\n${content}` },
      ]
      const summary = await aiService.chat(messages, activeConfigId)
      updateDetailedChapter(detailedChapter.id, { ...detailedChapter, summary })
    } catch (err) { console.error('AI extract failed:', err) }
    setAiLoading(false)
  }

  const handleExportTXT = () => setShowExport(true)

  // Summary templates: type '摘要', enabled ones
  const summaryTemplates = promptTemplates.filter(p => p.type === '摘要')
  const enabledSummaryTemplate = summaryTemplates.find(p => p.enabled)

  const chapterWordCount = useMemo(() => countChineseWords(content), [content])

  // Always render the page layout (don't return null)
  if (!activeProjectId || !chapterId) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9b8e84', fontSize: 14 }}>
        请先选择一个项目
      </div>
    )
  }

  return (
    <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
      {/* ====== LEFT: Reference Panel ====== */}
      <div style={{
        width: '20%',
        minWidth: 260,
        borderRight: '1px solid rgba(0,0,0,0.05)',
        display: 'flex',
        flexDirection: 'column',
        background: 'rgba(255,255,255,0.35)',
      }}>
        <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#2d2520' }}>创作参考面板</h3>
        </div>
        <div style={{ height: 1, background: 'rgba(0,0,0,0.04)' }} />

        <ScrollArea maxHeight="100%" style={{ flex: 1 }}>
          {/* Key Characters */}
          <div style={{ padding: '14px 16px' }}>
            <h4 style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              关键角色设定
            </h4>
            <ScrollArea maxHeight={180}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {[...characters].sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0)).map(char => (
                  <div key={char.id} style={{
                    padding: '8px 10px',
                    borderRadius: 10,
                    background: 'rgba(255,255,255,0.7)',
                    border: '1px solid rgba(0,0,0,0.04)',
                    fontSize: 11,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                      <UserIcon style={{ width: 11, height: 11, color: '#7c3aed' }} />
                      <span style={{ fontWeight: 600, fontSize: 12 }}>{char.name || '未命名'}</span>
                      {char.role && <span style={{ fontSize: 10, color: '#9b8e84', marginLeft: 'auto' }}>{char.role}</span>}
                    </div>
                    {char.personality && (
                      <p style={{ color: '#6b5e54', lineHeight: 1.5, fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                        {char.personality}
                      </p>
                    )}
                  </div>
                ))}
                {characters.length === 0 && (
                  <p style={{ fontSize: 11, color: '#9b8e84', textAlign: 'center', padding: 8 }}>暂无角色</p>
                )}
              </div>
            </ScrollArea>
          </div>
          <div style={{ margin: '0 16px', height: 1, background: 'rgba(0,0,0,0.04)' }} />

          {/* Detailed Outline Reference */}
          <div style={{ padding: '14px 16px' }}>
            <h4 style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              本章细纲参考
            </h4>
            <textarea
              value={detailedChapter?.description || ''}
              onChange={e => {
                if (detailedChapter) updateDetailedChapter(detailedChapter.id, { ...detailedChapter, description: e.target.value })
              }}
              className="custom-scrollbar"
              style={{
                width: '100%', border: '1px solid rgba(0,0,0,0.05)', borderRadius: 8, outline: 'none',
                resize: 'none', fontSize: 11, lineHeight: 1.6, fontFamily: 'inherit',
                color: '#4a3f38', background: 'rgba(255,255,255,0.7)', padding: 8, minHeight: 100,
              }}
              placeholder="本章细纲..."
            />
          </div>
          <div style={{ margin: '0 16px', height: 1, background: 'rgba(0,0,0,0.04)' }} />

          {/* Chapter Summary */}
          <div style={{ padding: '14px 16px' }}>
            <h4 style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              章节正文摘要
            </h4>
            <textarea
              value={detailedChapter?.summary || ''}
              onChange={e => {
                if (detailedChapter) updateDetailedChapter(detailedChapter.id, { ...detailedChapter, summary: e.target.value })
              }}
              className="custom-scrollbar"
              style={{
                width: '100%', border: '1px solid rgba(0,0,0,0.05)', borderRadius: 8, outline: 'none',
                resize: 'none', fontSize: 11, lineHeight: 1.6, fontFamily: 'inherit',
                color: '#4a3f38', background: 'rgba(255,255,255,0.7)', padding: 8, minHeight: 72,
              }}
              placeholder="章节摘要..."
            />
            {enabledSummaryTemplate && (
              <div style={{
                marginTop: 6, padding: '6px 8px', borderRadius: 6, background: 'rgba(124,58,237,0.04)',
                fontSize: 10, color: '#7c3aed', lineHeight: 1.4,
              }}>
                已启用提示词: {enabledSummaryTemplate.title}
              </div>
            )}
            <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
              <Button size="sm" variant="secondary" onClick={() => setShowSummaryTemplate(true)}>
                选择摘要模板
              </Button>
              <Button size="sm" onClick={handleAIExtract} disabled={aiLoading || !activeConfigId || !content.trim()} icon={<SparklesIcon style={{ width: 12, height: 12 }} />}>
                {aiLoading ? '提取中...' : 'AI提取'}
              </Button>
            </div>
          </div>
          <div style={{ margin: '0 16px', height: 1, background: 'rgba(0,0,0,0.04)' }} />

          {/* Chapter Navigation */}
          <div style={{ padding: '14px 16px' }}>
            <h4 style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              章节导航
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {detailedChapters.map((ch, idx) => {
                const wc = writingChapters[ch.id]?.content?.length || 0
                const statusColors: Record<string, string> = { outline: '#f59e0b', draft: '#e67e00', revising: '#2563eb', final: '#16a34a' }
                return (
                <button
                  key={ch.id}
                  onClick={() => saveAndNavigate(ch.id)}
                  style={{
                    width: '100%', textAlign: 'left', padding: '6px 8px', borderRadius: 8, border: 'none',
                    background: ch.id === chapterId ? 'rgba(124,58,237,0.08)' : 'transparent',
                    color: ch.id === chapterId ? '#7c3aed' : '#6b5e54',
                    fontSize: 11, fontWeight: ch.id === chapterId ? 600 : 400, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: statusColors[ch.status || 'outline'] || '#9b8e84' }} />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    章节{idx + 1}: {ch.title || '未命名'}
                  </span>
                  {wc > 0 && <span style={{ fontSize: 9, color: '#9b8e84', flexShrink: 0 }}>{wc}字</span>}
                </button>
              )})}
            </div>
          </div>
        </ScrollArea>
      </div>

      {/* ====== RIGHT: Chapter Editor Area ====== */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#e8e4df' }}>
        {/* Top bar */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 24px', background: 'rgba(255,255,255,0.6)', borderBottom: '1px solid rgba(0,0,0,0.05)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <Button variant="ghost" size="sm" onClick={() => navigate('/detailed-outline')} icon={<ArrowLeftIcon style={{ width: 16, height: 16 }} />}>
              返回
            </Button>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: '#2d2520' }}>
              {detailedChapter?.title || '未命名章节'}
            </h1>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => setShowAIGen(true)} style={{ padding: '5px 14px', borderRadius: 10, border: 'none', background: '#7c3aed', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                <SparklesIcon style={{ width: 14, height: 14 }} /> AI生成
              </button>
              <button onClick={() => setShowReview(true)} style={{ padding: '5px 14px', borderRadius: 10, border: '1px solid rgba(124,58,237,0.2)', background: 'rgba(124,58,237,0.04)', color: '#7c3aed', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                <ClipboardDocumentCheckIcon style={{ width: 14, height: 14 }} /> AI审稿
              </button>
              <button onClick={() => setShowReviewResults(true)} style={{ padding: '5px 14px', borderRadius: 10, border: '1px solid rgba(16,163,74,0.2)', background: 'rgba(16,163,74,0.04)', color: '#16a34a', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                <DocumentTextIcon style={{ width: 14, height: 14 }} /> 审稿结果
              </button>
              <button onClick={() => setShowBatchGen(true)} style={{ padding: '5px 14px', borderRadius: 10, border: '1px solid rgba(245,158,11,0.2)', background: 'rgba(245,158,11,0.04)', color: '#e67e00', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                <SparklesIcon style={{ width: 14, height: 14 }} /> 批量生成
              </button>
              <button onClick={() => setShowVersions(true)} style={{ padding: '5px 14px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.08)', background: '#fff', color: '#6b5e54', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                <ClockIcon style={{ width: 14, height: 14 }} /> 版本历史
              </button>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, color: '#9b8e84' }}>{formatWordCount(chapterWordCount)}字</span>
            <Button variant="secondary" size="sm" onClick={async () => { setContent(''); if (projectPath && chapterId) await fileService.write(`${projectPath}/chapters/${chapterId}.txt`, '') }}>清空正文</Button>
            <Button variant="secondary" size="sm" onClick={handleSave}>保存</Button>
            <Button size="sm" onClick={handleExportTXT} icon={<DocumentArrowDownIcon style={{ width: 14, height: 14 }} />}>
              导出TXT
            </Button>
          </div>
        </div>

        {/* Editor body */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', justifyContent: 'center', padding: '16px 32px' }}>
          <div className="custom-scrollbar" style={{ width: '100%', overflowY: 'auto' }}>
            <RichTextEditor
              content={content}
              onContentChange={setContent}
              onBlur={handleSave}
              placeholder="开始创作你的章节内容..."
            />
          </div>
        </div>
      </div>

      {/* Summary Template Selection Modal */}
      <Modal isOpen={showSummaryTemplate} onClose={() => setShowSummaryTemplate(false)} title="选择摘要模板" width={500}>
        <p style={{ fontSize: 12, color: '#9b8e84', marginBottom: 12 }}>
          选择提示词库中的"摘要"类型模板（启用后用于AI提取摘要）：
        </p>
        <div className="custom-scrollbar" style={{ maxHeight: 340, overflowY: 'auto' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div
              onClick={() => { setSelectedSummaryTemplate(''); setShowSummaryTemplate(false) }}
              style={templateStyle(!selectedSummaryTemplate)}
            >
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2, color: !selectedSummaryTemplate ? '#7c3aed' : '#2d2520' }}>
                默认模板
              </div>
              <div style={{ fontSize: 11, color: '#6b5e54' }}>提取本章核心情节、人物发展和关键转折点。</div>
            </div>
            {summaryTemplates.map(p => (
              <div
                key={p.id}
                onClick={() => { setSelectedSummaryTemplate(p.content); setShowSummaryTemplate(false) }}
                style={templateStyle(selectedSummaryTemplate === p.content, p.enabled)}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 600, fontSize: 13, color: selectedSummaryTemplate === p.content ? '#7c3aed' : '#2d2520' }}>
                    {p.title}
                  </span>
                  <span style={{
                    fontSize: 10, padding: '1px 6px', borderRadius: 4,
                    background: p.enabled ? 'rgba(124,58,237,0.1)' : 'transparent',
                    color: p.enabled ? '#7c3aed' : '#9b8e84',
                  }}>
                    {p.enabled ? '已启用' : ''}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: '#6b5e54', lineHeight: 1.4, marginTop: 2 }}>
                  {p.content.slice(0, 80)}{p.content.length > 80 ? '...' : ''}
                </div>
              </div>
            ))}
            {summaryTemplates.length === 0 && (
              <div style={{ textAlign: 'center', padding: 16, color: '#9b8e84', fontSize: 12 }}>
                暂无摘要模板，可在系统设置 → 提示词库中创建
              </div>
            )}
          </div>
        </div>
      </Modal>

      {/* AI Generation Modal */}
      <ChapterGenerationModal
        isOpen={showAIGen}
        onClose={() => setShowAIGen(false)}
        chapterId={chapterId}
        currentContent={content}
        onApply={(newContent) => { setContent(newContent); handleSave(newContent) }}
        onVersionSaved={(v) => setVersionHistory(prev => [v, ...prev])}
        onGenStart={() => { setGenOverlay(true); setGenWordCount(0) }}
        onGenChunk={(data) => { setGenWordCount(data.charCount) }}
        onGenDone={() => { setGenOverlay(false); genAbortRef.current = null }}
        onGenError={() => { setGenOverlay(false); genAbortRef.current = null }}
      />

      <ReviewModal
        isOpen={showReview}
        onClose={() => setShowReview(false)}
        chapterTitle={detailedChapter?.title || '未命名章节'}
        chapterLabel={`第${(detailedChapter?.order ?? 0) + 1}章`}
        chapterContent={content}
        projectId={activeProjectId || ''}
        configId={activeConfigId || ''}
      />

      {/* Version history modal with comparison */}
      <ReviewResultsModal
        isOpen={showReviewResults}
        onClose={() => setShowReviewResults(false)}
      />

      <VersionHistoryModal
        isOpen={showVersions}
        onClose={() => setShowVersions(false)}
        versions={versionHistory}
        onRestore={(v) => { setContent(v.generatedContent); handleSave(v.generatedContent); setShowVersions(false) }}
      />

      <BatchGenerationModal
        isOpen={showBatchGen}
        onClose={() => setShowBatchGen(false)}
        chapters={detailedChapters}
        worldbuildingContent={worldbuildingContent}
        characters={characters}
        outlineContent={outlineContent}
        currentChapterId={chapterId}
        onVersionSaved={(v) => setVersionHistory(prev => [v, ...prev])}
        genOverlay={genOverlay}
        onGenStart={() => { setGenOverlay(true); setGenWordCount(0) }}
        onGenChunk={(data) => { setGenWordCount(data.charCount) }}
        onGenDone={() => { setGenOverlay(false); genAbortRef.current = null }}
        onGenError={() => { setGenOverlay(false); genAbortRef.current = null }}
      />

      <ChapterExportModal
        isOpen={showExport}
        onClose={() => setShowExport(false)}
        projectPath={projectPath}
      />

      {/* Generation Overlay + Floating Card */}
      {genOverlay && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 99,
          background: 'rgba(0,0,0,0.25)', backdropFilter: 'blur(2px)',
          pointerEvents: 'auto',
        }}>
          <div
            onMouseDown={(e) => {
              const startX = e.clientX - genDragPos.x
              const startY = e.clientY - genDragPos.y
              const onMove = (ev: MouseEvent) => setGenDragPos({ x: ev.clientX - startX, y: ev.clientY - startY })
              const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
              window.addEventListener('mousemove', onMove)
              window.addEventListener('mouseup', onUp)
            }}
            style={{
              position: 'fixed', left: '50%', top: '50%', transform: `translate(calc(-50% + ${genDragPos.x}px), calc(-50% + ${genDragPos.y}px))`,
              zIndex: 100, padding: '24px 32px', borderRadius: 20,
              background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(16px)',
              border: '1px solid rgba(0,0,0,0.08)', boxShadow: '0 16px 64px rgba(0,0,0,0.15)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
              cursor: 'grab', userSelect: 'none', minWidth: 220,
            }}
          >
            {/* Spinning ring */}
            <div style={{
              width: 48, height: 48, borderRadius: '50%',
              border: '3px solid rgba(124,58,237,0.15)',
              borderTopColor: '#7c3aed',
              animation: `spin 0.8s linear infinite`,
            }} />
            <div style={{ fontSize: 13, fontWeight: 700, color: '#2d2520' }}>AI 正在生成章节</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#7c3aed' }}>
              {genWordCount.toLocaleString()}
              <span style={{ fontSize: 13, fontWeight: 400, color: '#9b8e84', marginLeft: 4 }}>字</span>
            </div>
            <button
              onClick={() => genAbortRef.current?.()}
              style={{
                padding: '6px 20px', borderRadius: 10, border: '1px solid rgba(220,38,38,0.2)',
                background: 'rgba(220,38,38,0.05)', color: '#dc2626', fontSize: 12, fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              取消生成
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function VersionHistoryModal({ isOpen, onClose, versions, onRestore }: {
  isOpen: boolean; onClose: () => void; versions: VersionRecord[]; onRestore: (v: VersionRecord) => void
}) {
  const [compareA, setCompareA] = useState<number | null>(null)
  const [compareB, setCompareB] = useState<number | null>(null)

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="版本历史" width={compareA !== null && compareB !== null ? 900 : 700}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 500, overflowY: 'auto' }} className="custom-scrollbar">
        {versions.length > 0 ? versions.map((v, i) => (
          <div key={i} style={{ padding: '10px 14px', borderRadius: 10, background: '#faf9f8', border: '1px solid rgba(0,0,0,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4, gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={compareA === i} onChange={() => setCompareA(compareA === i ? null : i)} disabled={compareB === i} style={{ width: 13, height: 13, accentColor: '#7c3aed', cursor: compareB === i ? 'not-allowed' : 'pointer' }} title="选择对比A" />
                <input type="checkbox" checked={compareB === i} onChange={() => setCompareB(compareB === i ? null : i)} disabled={compareA === i} style={{ width: 13, height: 13, accentColor: '#e67e00', cursor: compareA === i ? 'not-allowed' : 'pointer' }} title="选择对比B" />
                <span style={{ fontSize: 13, fontWeight: 600, color: '#2d2520' }}>版本 {versions.length - i} — {v.modelName}</span>
              </div>
              <span style={{ fontSize: 10, color: '#9b8e84', flexShrink: 0 }}>{new Date(v.generatedAt).toLocaleString()}</span>
            </div>
            <div style={{ display: 'flex', gap: 12, fontSize: 10, color: '#6b5e54', marginBottom: 6, flexWrap: 'wrap' }}>
              <span>温度: {v.temperature}</span>
              <span>提示词: {v.promptTitle}</span>
              <span>Token: 入{v.tokens.input} 出{v.tokens.output} 总{v.tokens.total}</span>
              <span style={{ color: '#7c3aed' }}>${v.cost.toFixed(4)}</span>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <details style={{ flex: 1, fontSize: 12, color: '#4a3f38' }}>
                <summary style={{ cursor: 'pointer', color: '#7c3aed', fontWeight: 600 }}>查看内容 ({v.generatedContent.length}字)</summary>
                <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 6, background: '#fff', lineHeight: 1.6, whiteSpace: 'pre-wrap', maxHeight: 300, overflowY: 'auto' }} className="custom-scrollbar">{v.generatedContent}</div>
              </details>
              <button onClick={() => { if (confirm('确定用此版本替换当前正文？')) onRestore(v) }} style={{ padding: '2px 8px', borderRadius: 6, border: '1px solid rgba(124,58,237,0.2)', background: 'rgba(124,58,237,0.04)', color: '#7c3aed', fontSize: 10, cursor: 'pointer', whiteSpace: 'nowrap' }}>恢复</button>
            </div>
          </div>
        )) : (
          <div style={{ textAlign: 'center', padding: 40, color: '#9b8e84', fontSize: 13 }}>暂无版本记录，使用"AI生成"创建第一个版本。</div>
        )}
      </div>

      {/* Comparison view with diff */}
      {compareA !== null && compareB !== null && versions[compareA] && versions[compareB] && (
        <div style={{ marginTop: 12, borderTop: '1px solid rgba(0,0,0,0.08)', paddingTop: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#2d2520', marginBottom: 8 }}>
            版本对比 — 旧(v{versions.length - compareA}) vs 新(v{versions.length - compareB})
          </div>
          <DiffView
            oldText={versions[compareA].generatedContent}
            newText={versions[compareB].generatedContent}
            oldLabel={`${versions[compareA].modelName} ${new Date(versions[compareA].generatedAt).toLocaleString()}`}
            newLabel={`${versions[compareB].modelName} ${new Date(versions[compareB].generatedAt).toLocaleString()}`}
          />
        </div>
      )}
    </Modal>
  )
}

async function loadVersionHistory(projectPath: string, chapterId: string): Promise<VersionRecord[]> {
  try {
    const dir = `${projectPath}/chapters/${chapterId}_versions`
    const files = await fileService.listDir(dir)
    const jsonFiles = files.filter(f => f.endsWith('.json'))
    const versions: VersionRecord[] = []
    for (const f of jsonFiles) {
      try {
        const raw = await fileService.read(`${dir}/${f}`)
        versions.push(JSON.parse(raw))
      } catch { /* skip malformed */ }
    }
    return versions.sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime())
  } catch { return [] }
}

function templateStyle(selected: boolean, enabled?: boolean) {
  return {
    padding: 12, borderRadius: 12, cursor: 'pointer',
    background: selected ? '#f5f3ff' : '#faf9f8',
    border: selected ? '2px solid rgba(124,58,237,0.25)' : enabled ? '1px solid rgba(124,58,237,0.12)' : '1px solid rgba(0,0,0,0.04)',
    transition: 'all 0.15s ease',
  }
}

function ChapterExportModal({ isOpen, onClose, projectPath }: {
  isOpen: boolean; onClose: () => void; projectPath: string
}) {
  const detailedChapters = useStore(s => s.detailedChapters)
  const writingChapters = useStore(s => s.writingChapters)

  const [exportMode, setExportMode] = useState<'single' | 'merge'>('single')
  const [exportType, setExportType] = useState<'summary' | 'body'>('body')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (isOpen) setSelectedIds(new Set(detailedChapters.map(c => c.id)))
  }, [isOpen])

  const toggleChapter = (id: string) => setSelectedIds(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const handleExport = async () => {
    if (exportMode === 'single') {
      const ch = detailedChapters.find(c => selectedIds.has(c.id) || detailedChapters.length === 1 ? true : false)
      if (!ch) return
      const first = detailedChapters.find(c => c.id === [...selectedIds][0])
      if (!first) return
      const content = exportType === 'body' ? writingChapters[first.id]?.content || '' : first.summary || ''
      const outputPath = await dialogService.saveFile(`${first.title}.txt`)
      if (!outputPath) return
      await exportService.exportSingleChapter({ title: first.title, content, outputPath })
    } else {
      const outputPath = await dialogService.saveFile('小说合并导出.txt')
      if (!outputPath) return
      const chapters = detailedChapters
        .filter(c => selectedIds.has(c.id))
        .sort((a, b) => a.order - b.order)
        .map((ch, idx) => ({
          title: `第${idx + 1}章 ${ch.title}`,
          content: exportType === 'body'
            ? writingChapters[ch.id]?.content || ''
            : ch.summary || '暂无摘要',
        }))
      await exportService.exportChapters({ chapters, outputPath, type: exportType })
    }
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="导出章节" width={560}>
      {/* Export mode tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderRadius: 10, overflow: 'hidden', border: '1px solid rgba(0,0,0,0.08)' }}>
        {(['single', 'merge'] as const).map(mode => (
          <button key={mode} onClick={() => setExportMode(mode)} style={{
            flex: 1, padding: '8px 0', border: 'none', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit',
            background: exportMode === mode ? '#7c3aed' : '#fff',
            color: exportMode === mode ? '#fff' : '#6b5e54',
            fontWeight: exportMode === mode ? 600 : 400,
          }}>
            {mode === 'single' ? '单章导出' : '合并导出'}
          </button>
        ))}
      </div>
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 12 }}>
          {(['body', 'summary'] as const).map(type => (
            <button key={type} onClick={() => setExportType(type)} style={{
              flex: 1, padding: '12px 16px', borderRadius: 14,
              border: exportType === type ? '2px solid #7c3aed' : '2px solid rgba(0,0,0,0.06)',
              background: exportType === type ? 'rgba(124,58,237,0.06)' : '#fff',
              cursor: 'pointer', textAlign: 'center',
            }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: exportType === type ? '#7c3aed' : '#4a3f38' }}>
                {type === 'body' ? '章节正文' : '章节摘要'}
              </div>
            </button>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 13, color: '#6b5e54', fontWeight: 600 }}>
          已选择章节 {selectedIds.size}/{detailedChapters.length}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set(detailedChapters.map(c => c.id)))}>全选</Button>
          <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>取消全选</Button>
        </div>
      </div>
      <div className="custom-scrollbar" style={{ maxHeight: 300, overflowY: 'auto' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {detailedChapters.map((ch, idx) => (
            <button key={ch.id} onClick={() => toggleChapter(ch.id)} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
              borderRadius: 12, border: '1px solid rgba(0,0,0,0.06)',
              background: selectedIds.has(ch.id) ? 'rgba(124,58,237,0.04)' : '#fff',
              cursor: 'pointer', textAlign: 'left', width: '100%',
            }}>
              <div style={{
                width: 20, height: 20, borderRadius: 6,
                border: selectedIds.has(ch.id) ? '2px solid #7c3aed' : '2px solid #d9d2cc',
                background: selectedIds.has(ch.id) ? '#7c3aed' : '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                {selectedIds.has(ch.id) && <CheckCircleIcon style={{ width: 14, height: 14, color: '#fff' }} />}
              </div>
              <span style={{ fontSize: 13, color: '#4a3f38', fontWeight: selectedIds.has(ch.id) ? 600 : 400 }}>
                章节{idx + 1}: {ch.title || '未命名'}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20, paddingTop: 16, borderTop: '1px solid #f0ece8' }}>
        <Button variant="secondary" onClick={onClose}>取消</Button>
        <Button onClick={handleExport} disabled={selectedIds.size === 0}>确定导出</Button>
      </div>
    </Modal>
  )
}

// ---- Diff algorithm + component ----

function lineDiff(oldText: string, newText: string): { type: 'same' | 'removed' | 'added'; text: string }[] {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  const result: { type: 'same' | 'removed' | 'added'; text: string }[] = []

  const m = oldLines.length; const n = newLines.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1
      else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }

  let i = m, j = n
  const temp: { type: 'same' | 'removed' | 'added'; text: string }[] = []
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      temp.unshift({ type: 'same', text: oldLines[i - 1] })
      i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      temp.unshift({ type: 'added', text: newLines[j - 1] })
      j--
    } else {
      temp.unshift({ type: 'removed', text: oldLines[i - 1] })
      i--
    }
  }

  for (const line of temp) {
    const last = result[result.length - 1]
    if (last && last.type === line.type) {
      last.text += '\n' + line.text
    } else {
      result.push(line)
    }
  }
  return result
}

function DiffView({ oldText, newText, oldLabel, newLabel }: {
  oldText: string; newText: string; oldLabel: string; newLabel: string
}) {
  const diff = lineDiff(oldText, newText)
  const removedCount = diff.filter(d => d.type === 'removed').reduce((s, d) => s + d.text.split('\n').length, 0)
  const addedCount = diff.filter(d => d.type === 'added').reduce((s, d) => s + d.text.split('\n').length, 0)

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, fontSize: 11 }}>
        <span style={{ color: '#6b5e54' }}>{oldLabel}</span>
        <span style={{ color: '#9b8e84' }}>→</span>
        <span style={{ color: '#6b5e54' }}>{newLabel}</span>
        <span style={{ color: '#dc2626', marginLeft: 8 }}>−{removedCount}行</span>
        <span style={{ color: '#16a34a' }}>+{addedCount}行</span>
      </div>
      <div style={{
        maxHeight: 400, overflowY: 'auto', borderRadius: 10,
        border: '1px solid rgba(0,0,0,0.06)', fontSize: 12, lineHeight: 1.6,
        fontFamily: 'monospace',
      }} className="custom-scrollbar">
        {diff.map((d, i) => (
          <div key={i} style={{
            padding: '1px 12px',
            background: d.type === 'removed' ? 'rgba(220,38,38,0.08)' :
                        d.type === 'added' ? 'rgba(22,163,74,0.08)' :
                        'transparent',
            color: d.type === 'removed' ? '#991b1b' :
                   d.type === 'added' ? '#166534' :
                   '#6b5e54',
            whiteSpace: 'pre-wrap',
            borderLeft: d.type === 'removed' ? '3px solid #dc2626' :
                        d.type === 'added' ? '3px solid #16a34a' :
                        '3px solid transparent',
          }}>
            <span style={{ marginRight: 8, fontSize: 10, opacity: 0.5 }}>
              {d.type === 'removed' ? '−' : d.type === 'added' ? '+' : ' '}
            </span>
            {d.text}
          </div>
        ))}
      </div>
    </div>
  )
}
