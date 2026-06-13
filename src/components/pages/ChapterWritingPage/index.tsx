import { useEffect, useState, useMemo, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore, useSettingsStore } from '@/store'
import { fileService, aiService } from '@/services/fileService'
import { chatAI } from '@/utils/chatAI'
import { loadCharacters } from '@/services/characterService'
import { sceneService } from '@/services/sceneService'
import type { ChapterSceneConfig } from '@/types/story'
import RichTextEditor from '@/components/common/RichTextEditor'
import ScrollArea from '@/components/common/ScrollArea'
import Button from '@/components/common/Button'
import EmptyState from '@/components/common/EmptyState'
import Modal from '@/components/common/Modal'
import ChapterGenerationModal from '@/components/common/ChapterGenerationModal'
import type { VersionRecord } from '@/components/common/ChapterGenerationModal'
import { VersionHistoryModal } from '@/components/common/VersionHistoryModal'
import { ChapterExportModal } from '@/components/common/ChapterExportModal'
import { DiffView } from '@/components/common/DiffView'
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
import ChapterSummaryPanel from '@/components/chapterWriting/ChapterSummaryPanel/ChapterSummaryPanel'
import type { DetailedChapter } from '@/types/chapter'
import { countChineseWords, formatWordCount, stripHtml } from '@/utils/textUtils'
import { logError } from '@/utils/logger'
import { loadSummary, saveSummary } from '@/services/summaryService'

import { GenerationOverlay } from "./GenerationOverlay";
import { loadVersionHistory, templateStyle } from "./utils";
export default function ChapterWritingPage() {

  const { chapterId } = useParams<{ chapterId: string }>()
  const navigate = useNavigate()
  const activeProjectId = useStore(s => s.activeProjectId)

  // Redirect if no project selected
  useEffect(() => {
    if (!activeProjectId) navigate('/')
  }, [activeProjectId, navigate])
  const projectsBasePath = useStore(s => s.projectsBasePath)
  const fileVersion = useStore(s => s.fileVersion)
  const detailedChapters = useStore(s => s.detailedChapters)
  const updateDetailedChapter = useStore(s => s.updateDetailedChapter)
  const characters = useStore(s => s.characters)
  const writingChapters = useStore(s => s.writingChapters)
  const setWritingChapter = useStore(s => s.setWritingChapter)
  const setActivePage = useStore(s => s.setActivePage)
  const setCurrentChapterId = useStore(s => s.setCurrentChapterId)
  const insertionAction = useStore(s => s.insertionAction)
  const setInsertionAction = useStore(s => s.setInsertionAction)
  const replaceAction = useStore(s => s.replaceAction)
  const setReplaceAction = useStore(s => s.setReplaceAction)
  const fileEditNotify = useStore(s => s.fileEditNotify)
  const setFileEditNotify = useStore(s => s.setFileEditNotify)
  const chapterSummaryMap = useStore(s => s.chapterSummaryMap)
  const setChapterSummary = useStore(s => s.setChapterSummary)
  const worldbuildingContent = useStore(s => s.worldbuildingContent)
  const outlineContent = useStore(s => s.outlineContent)

  const activeConfigId = useSettingsStore(s => s.activeConfigId)
  const promptTemplates = useSettingsStore(s => s.prompts)

  const [content, setContent] = useState('')
  const contentRef = useRef(content)
  contentRef.current = content
  const [summaryContent, setSummaryContent] = useState('')
  const [projectPath, setProjectPath] = useState('')
  const [showSummaryTemplate, setShowSummaryTemplate] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [showAIGen, setShowAIGen] = useState(false)
  const [showReview, setShowReview] = useState(false)
  const [showReviewResults, setShowReviewResults] = useState(false)
  const [showBatchGen, setShowBatchGen] = useState(false)
  const chapterGenTrigger = useStore(s => s.chapterGenTrigger)
  const setChapterGenTrigger = useStore(s => s.setChapterGenTrigger)
  const [showVersions, setShowVersions] = useState(false)
  const [versionHistory, setVersionHistory] = useState<VersionRecord[]>([])
  const [chapterSceneConfig, setChapterSceneConfig] = useState<ChapterSceneConfig | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [selectedSummaryTemplate, setSelectedSummaryTemplate] = useState('')

  // Generation overlay state
  const [genOverlay, setGenOverlay] = useState(false)
  const [genWordCount, setGenWordCount] = useState(0)
  const [genDragPos, setGenDragPos] = useState({ x: 0, y: 0 })
  const genAbortRef = useRef<(() => void) | null>(null)

  // Use ref to avoid detailedChapters triggering chapter content reload
  const detailedChaptersRef = useRef(detailedChapters)
  useEffect(() => { detailedChaptersRef.current = detailedChapters }, [detailedChapters])

  const detailedChapter = detailedChapters.find(c => c.id === chapterId)

  // Load chapter content
  useEffect(() => {
    if (!activeProjectId || !chapterId || !projectsBasePath) return
    const pp = `${projectsBasePath}/${activeProjectId}`
    setProjectPath(pp)
    setActivePage('chapter')
    setCurrentChapterId(chapterId)
    fileService.read(`${pp}/chapters/${chapterId}.txt`).then(c => {
      const dc = detailedChaptersRef.current.find(c => c.id === chapterId)
      setContent(c)
      setWritingChapter(chapterId, {
        id: chapterId, detailedChapterId: chapterId,
        title: dc?.title || '', content: c,
        summary: '',
      })
    }).catch(() => {
      setContent('')
      // 章节 TXT 不存在 → 自动创建空文件
      fileService.write(`${pp}/chapters/${chapterId}.txt`, '').catch(() => {})
      const dc = detailedChaptersRef.current.find(c => c.id === chapterId)
      setWritingChapter(chapterId, {
        id: chapterId, detailedChapterId: chapterId,
        title: dc?.title || '', content: '',
        summary: '',
      })
    })
    // Load chapter summary from standalone file
    loadSummary(pp, chapterId).then(s => {
      if (s) {
        setSummaryContent(s)
        setChapterSummary(chapterId, s)
      } else {
        setSummaryContent('')
      }
    }).catch(() => {
      setSummaryContent('')
    })
    // Load characters if not already in store
    if (characters.length === 0) {
      loadCharacters(pp).then(chars => {
        useStore.getState().setCharacters(chars)
      }).catch(() => { /* characters file doesn't exist yet */ })
    }
    // Load existing version history from disk
    loadVersionHistory(pp, chapterId).then(setVersionHistory)
    // Load saved scene config
    sceneService.loadChapterSceneConfig(pp, chapterId).then(setChapterSceneConfig)
  }, [activeProjectId, chapterId, projectsBasePath, fileVersion])

  // Handle insertion action from AI
  useEffect(() => {
    if (!insertionAction) return
    const { keyword, content: insContent, position, mode } = insertionAction

    if (insContent && keyword) {
      const idx = content.indexOf(keyword)
      if (idx !== -1) {
        const isRewrite = mode === 'rewrite'
        let newText: string
        if (isRewrite) {
          // Rewrite: original → RED, rewrite → BLUE inserted after
          const before = content.slice(0, idx)
          const original = content.slice(idx, idx + keyword.length)
          const after = content.slice(idx + keyword.length)
          newText = before + '<span style="color: #dc2626; background: rgba(220,38,38,0.06)">' + original + '</span>' + '\n\n' + '<span style="color: #3b82f6; background: rgba(59,130,246,0.06)">【改写建议】\n' + insContent + '</span>' + after
        } else {
          const insertPos = position === 'after' ? idx + keyword.length : idx
          newText = content.slice(0, insertPos) + '\n\n' + insContent + content.slice(insertPos)
        }
        setContent(newText)
        if (projectPath && chapterId) {
          fileService.write(`${projectPath}/chapters/${chapterId}.txt`, newText).then(() => {
            setWritingChapter(chapterId!, {
              id: chapterId, detailedChapterId: chapterId,
              title: detailedChapter?.title || '', content: newText,
              summary: '',
            })
          })
        }
      }
    }
    setInsertionAction(null)
  }, [insertionAction, setInsertionAction, content, projectPath as string, chapterId, detailedChapter])

  // Auto-save: debounced 2s after last change. Undo/redo now safely reverts unwanted AI edits.
  useEffect(() => {
    if (!projectPath || !chapterId) return
    const timer = setTimeout(() => {
      if (contentRef.current) {
        fileService.write(`${projectPath}/chapters/${chapterId}.txt`, contentRef.current).catch(() => {})
      }
    }, 2000)
    return () => clearTimeout(timer)
  }, [content, projectPath, chapterId])

  // Save on app exit — best effort async save
  useEffect(() => {
    const save = () => {
      if (contentRef.current && projectPath && chapterId) {
        fileService.write(`${projectPath}/chapters/${chapterId}.txt`, contentRef.current).catch(() => {})
      }
    }
    window.addEventListener('beforeunload', save)
    return () => window.removeEventListener('beforeunload', save)
  }, [projectPath, chapterId])

  // Handle replace action from AI assistant (apply to editor + save)
  useEffect(() => {
    if (!replaceAction || replaceAction.chapterId !== chapterId) return
    setContent(replaceAction.content)
    handleSave(replaceAction.content).catch(err => logError('replaceAction自动保存失败', err))
    setReplaceAction(null)
  }, [replaceAction])

  // AI triggered chapter generation via 【生成本章】command
  useEffect(() => {
    if (!chapterGenTrigger || !chapterId) return
    // Match: same chapter ID, or AI said "生成本章" (__current__) while user is on this chapter
    if (chapterGenTrigger === chapterId || chapterGenTrigger === '__current__') {
      setShowAIGen(true)
      setChapterGenTrigger(null)
    }
  }, [chapterGenTrigger, chapterId])

  // AI direct edit via edit_file → reload editor from disk
  useEffect(() => {
    if (!fileEditNotify || !chapterId || !projectPath) return
    const expectedPath = `${projectPath}/chapters/${chapterId}.txt`.replace(/\\/g, '/').toLowerCase()
    const notifyPath = fileEditNotify.filePath.replace(/\\/g, '/').toLowerCase()
    if (notifyPath === expectedPath) {
      fileService.read(expectedPath).then(c => {
        setContent(c)
        handleSave(c).catch(err => logError('fileEditNotify自动保存失败', err))
      }).catch(() => {})
      setFileEditNotify(null)
    }
  }, [fileEditNotify, chapterId, projectPath])

  // AI direct edit on summary file → reload
  useEffect(() => {
    if (!fileEditNotify || !chapterId || !projectPath) return
    const expectedPath = `${projectPath}/summaries/${chapterId}.md`.replace(/\\/g, '/').toLowerCase()
    const notifyPath = fileEditNotify.filePath.replace(/\\/g, '/').toLowerCase()
    if (notifyPath === expectedPath) {
      loadSummary(projectPath, chapterId).then(s => {
        if (s) { setSummaryContent(s); setChapterSummary(chapterId, s) }
      }).catch(() => {})
      setFileEditNotify(null)
    }
  }, [fileEditNotify, chapterId, projectPath])

  // Save (file + store for export). Accept optional content to avoid stale closure.
  const handleSave = async (overrideContent?: string) => {
    if (!projectPath || !chapterId) return
    const c = overrideContent ?? contentRef.current
    await fileService.write(`${projectPath}/chapters/${chapterId}.txt`, c)
    setWritingChapter(chapterId, {
      id: chapterId,
      detailedChapterId: chapterId,
      title: detailedChapter?.title || '',
      content: c,
      summary: '',
    })
  }

  // Auto-save summary content (debounced 2s)
  useEffect(() => {
    if (!projectPath || !chapterId || !summaryContent) return
    const timer = setTimeout(() => {
      saveSummary(projectPath, chapterId, summaryContent).catch(err => logError('摘要自动保存失败', err))
    }, 2000)
    return () => clearTimeout(timer)
  }, [summaryContent])

  // Save then navigate
  const saveAndNavigate = async (targetChapterId: string) => {
    await handleSave()
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
      const summary = await chatAI(messages, activeConfigId)
      setSummaryContent(summary)
      setChapterSummary(detailedChapter.id, summary)
      if (projectPath) await saveSummary(projectPath, detailedChapter.id, summary).catch(() => {})
    } catch (err) { logError('AI extract failed', err) }
    setAiLoading(false)
  }

  const handleExportTXT = () => setShowExport(true)

  // Summary templates: type '摘要', enabled ones
  const summaryTemplates = promptTemplates.filter(p => p.type === '摘要')
  const enabledSummaryTemplate = summaryTemplates.find(p => p.enabled)

  const chapterWordCount = useMemo(() => countChineseWords(content), [content])

  // Build outline reference text from structured fields (v3.8+) or legacy description
  const outlineReferenceText = useMemo(() => {
    const dc = detailedChapter
    if (!dc) return ''
    // Legacy description takes priority if present (user may have edited it)
    if (dc.description) return dc.description
    // Assemble from structured fields
    const parts: string[] = []
    if (dc.plotOverview) parts.push('【剧情概述】\n' + dc.plotOverview)
    if (dc.characters) parts.push('【出场角色】\n' + dc.characters)
    if (dc.location) parts.push('【场景地点】\n' + dc.location)
    if (dc.keyEvents) parts.push('【关键事件】\n' + dc.keyEvents)
    if (dc.emotionCurve) parts.push('【情绪曲线】\n' + dc.emotionCurve)
    if (dc.writingNotes) parts.push('【写作笔记】\n' + dc.writingNotes)
    if (dc.customContent) parts.push('【自定义内容】\n' + dc.customContent)
    if (dc.eroticContent) parts.push('【情色剧情】\n' + dc.eroticContent)
    return parts.join('\n\n')
  }, [detailedChapter])

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
      <div className="glass" style={{
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

        {/* Scene config status */}
        {chapterSceneConfig && (chapterSceneConfig.eroticScene || chapterSceneConfig.novelScene) && (
          <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(0,0,0,0.06)', background: 'rgba(124,58,237,0.03)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <h4 style={{ fontSize: 11, fontWeight: 600, color: '#7c3aed', display: 'flex', alignItems: 'center', gap: 4 }}>
                <SparklesIcon style={{ width: 12, height: 12 }} />场景配置已加载
              </h4>
              <button onClick={() => navigate('/scene-workshop')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: '#7c3aed', textDecoration: 'underline' }}>
                在工坊中编辑
              </button>
            </div>
            <div style={{ display: 'flex', gap: 8, fontSize: 10 }}>
              {chapterSceneConfig.eroticScene && (
                <span style={{ padding: '2px 6px', borderRadius: 4, background: 'rgba(124,58,237,0.08)', color: '#7c3aed' }}>
                  情色: {chapterSceneConfig.eroticScene.intensity}/5 · {chapterSceneConfig.eroticScene.wordTarget}字
                </span>
              )}
              {chapterSceneConfig.novelScene && (
                <span style={{ padding: '2px 6px', borderRadius: 4, background: 'rgba(59,130,246,0.08)', color: '#3b82f6' }}>
                  通用: {chapterSceneConfig.novelScene.sceneType} · {chapterSceneConfig.novelScene.wordTarget}字
                </span>
              )}
            </div>
          </div>
        )}

        {/* No scene config hint */}
        {!chapterSceneConfig?.eroticScene && !chapterSceneConfig?.novelScene && detailedChapter?.description && (
          <div style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.06)', background: 'rgba(245,158,11,0.03)' }}>
            <p style={{ fontSize: 10, color: '#f59e0b', margin: 0 }}>
              本章尚未配置场景，AI生成可能缺少具体指导。
            </p>
            <button onClick={() => navigate('/scene-workshop')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: '#7c3aed', textDecoration: 'underline', marginTop: 2, padding: 0 }}>
              前往场景工坊配置
            </button>
          </div>
        )}

        <ScrollArea maxHeight="100%" style={{ flex: 1 }}>
          {/* Key Characters */}
          <div style={{ padding: '14px 16px' }}>
            <h4 style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              关键角色设定
            </h4>
            <ScrollArea maxHeight={280}>
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
                  <EmptyState icon="👤" title="暂无角色" description="在角色面板中创建角色" />
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
              value={outlineReferenceText}
              onChange={e => {
                if (detailedChapter) updateDetailedChapter(detailedChapter.id, { ...detailedChapter, description: e.target.value })
              }}
              className="custom-scrollbar focus-ring"
              style={{
                width: '100%', border: '1px solid rgba(0,0,0,0.05)', borderRadius: 10, outline: 'none',
                resize: 'none', fontSize: 11, lineHeight: 1.6, fontFamily: 'inherit',
                color: '#4a3f38', background: 'rgba(255,255,255,0.7)', padding: 8, minHeight: 220,
              }}
              placeholder="本章细纲..."
            />
          </div>
          <div style={{ margin: '0 16px', height: 1, background: 'rgba(0,0,0,0.04)' }} />

          <ChapterSummaryPanel
            summaryContent={summaryContent}
            onSummaryChange={setSummaryContent}
            enabledSummaryTemplate={enabledSummaryTemplate}
            aiLoading={aiLoading}
            activeConfigId={activeConfigId || ''}
            content={content}
            onShowTemplateModal={() => setShowSummaryTemplate(true)}
            onAIExtract={handleAIExtract}
          />
          <div style={{ margin: '0 16px', height: 1, background: 'rgba(0,0,0,0.04)' }} />

          {/* Chapter Navigation */}
          <div style={{ padding: '14px 16px' }}>
            <h4 style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              章节导航
            </h4>
            <ScrollArea maxHeight={160}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {detailedChapters.map((ch, idx) => {
                  const wc = countChineseWords(writingChapters[ch.id]?.content || '')
                  const statusColors: Record<string, string> = { outline: '#f59e0b', draft: '#e67e00', revising: '#2563eb', final: '#16a34a' }
                  return (
                  <button
                    key={ch.id}
                    onClick={() => saveAndNavigate(ch.id)}
                    className="interactive"
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
            </ScrollArea>
          </div>
        </ScrollArea>
      </div>

      {/* ====== RIGHT: Chapter Editor Area ====== */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'rgba(255,255,255,0.25)' }}>
        {/* Top bar */}
        <div className="glass" style={{
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
              <Button size="sm" onClick={() => setShowAIGen(true)} icon={<SparklesIcon style={{ width: 14, height: 14 }} />}>
                AI生成
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setShowReview(true)} icon={<ClipboardDocumentCheckIcon style={{ width: 14, height: 14 }} />}
                style={{ borderColor: 'rgba(124,58,237,0.2)', background: 'rgba(124,58,237,0.04)', color: '#7c3aed' }}>
                AI审稿
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setShowReviewResults(true)} icon={<DocumentTextIcon style={{ width: 14, height: 14 }} />}
                style={{ borderColor: 'rgba(16,163,74,0.2)', background: 'rgba(16,163,74,0.04)', color: '#16a34a' }}>
                审稿结果
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setShowBatchGen(true)} icon={<SparklesIcon style={{ width: 14, height: 14 }} />}
                style={{ borderColor: 'rgba(245,158,11,0.2)', background: 'rgba(245,158,11,0.04)', color: '#e67e00' }}>
                批量生成
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowVersions(true)} icon={<ClockIcon style={{ width: 14, height: 14 }} />}>
                版本历史
              </Button>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#4a3f38' }}>
              {formatWordCount(chapterWordCount)}字
              <span style={{ color: '#6b5e54', fontSize: 12, fontWeight: 400 }}>（含空格{formatWordCount(stripHtml(content).length)}）</span>
            </span>
            <Button variant="danger" size="sm" onClick={async () => { setContent(''); if (projectPath && chapterId) await fileService.write(`${projectPath}/chapters/${chapterId}.txt`, '') }}>清空正文</Button>
            <Button size="sm" onClick={handleSave}>保存</Button>
            <Button size="sm" onClick={handleExportTXT} icon={<DocumentArrowDownIcon style={{ width: 14, height: 14 }} />}>
              导出TXT
            </Button>
          </div>
        </div>

        {/* Editor body */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', justifyContent: 'center', padding: '16px 32px' }}>
          <div className="custom-scrollbar writing-paper" style={{ width: '100%', overflowY: 'auto' }}>
            <RichTextEditor
              content={content}
              onContentChange={setContent}
              projectPath={projectPath}
              chapterId={chapterId}
              placeholder={!content.trim() && detailedChapter?.description ? '本章细纲已就绪，点击上方 AI生成 开始写作，或手动输入内容...' : '开始创作你的章节内容...'}
            />
          </div>
        </div>
      </div>

      {/* Summary Template Selection Modal */}
      <Modal isOpen={showSummaryTemplate} onClose={() => setShowSummaryTemplate(false)} title="选择摘要模板" width={500} draggable>
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
        externalAbortRef={genAbortRef}
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
        writtenChapterIds={new Set(Object.entries(writingChapters).filter(([,v]) => v?.content?.trim()).map(([k]) => k))}
        onVersionSaved={(v) => setVersionHistory(prev => [v, ...prev])}
        onGenStart={() => { setGenOverlay(true); setGenWordCount(0) }}
        onGenChunk={(data) => { setGenWordCount(data.charCount) }}
        onGenDone={() => { setGenOverlay(false); genAbortRef.current = null }}
        onGenError={() => { setGenOverlay(false); genAbortRef.current = null }}
        externalAbortRef={genAbortRef}
      />

      <ChapterExportModal
        isOpen={showExport}
        onClose={() => setShowExport(false)}
        projectPath={projectPath}
      />

      {/* Generation Overlay + Floating Card */}
      {genOverlay && (
        <GenerationOverlay genWordCount={genWordCount} genDragPos={genDragPos} onDragMouseDown={(e) => {
          const startX = e.clientX - genDragPos.x;
          const startY = e.clientY - genDragPos.y;
          const onMove = (ev: MouseEvent) => setGenDragPos({ x: ev.clientX - startX, y: ev.clientY - startY });
          const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
          window.addEventListener("mousemove", onMove);
          window.addEventListener("mouseup", onUp);
        }} onCancel={() => { genAbortRef.current?.(); setGenOverlay(false); genAbortRef.current = null; }} />
      )}
    </div>
  )
}
