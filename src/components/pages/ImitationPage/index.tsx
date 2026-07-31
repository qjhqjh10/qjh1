import { useEffect, useState, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useStore, useSettingsStore } from '@/store'
import { extractionService, aiService, fileService, styleProjectService, exportService, dialogService, projectService } from '@/services/fileService'
import { loadCharacters, saveCharacter } from '@/services/characterService'
import { saveDetailedChapter } from '@/services/chapterService'
import { saveOutlineContent, saveWorldbuildingContent } from '@/services/outlineService'
import {
  aggregateExtractions, parseExtractionReply, splitChapters,
  buildExtractionPrompt, parseExtractionReplyWithErotic, buildEroticExtractionPrompt,
  computePacingTemplate, chaptersToStyleChapters,
  buildGenerateCharactersPrompt, buildGenerateWorldbuildingPrompt,
  buildStyleAnalyzePrompt, parseStyleAnalysisReply,
  computeEventPattern, computeProgressionRhythm,
  computeCharacterArchetype, computeEmotionCurve,
} from '@/services/extractionService'
import { nanoid } from 'nanoid'
import GlassCard from '@/components/common/GlassCard'
import Button from '@/components/common/Button'
import ScrollArea from '@/components/common/ScrollArea'
import Modal from '@/components/common/Modal'
import EmptyState from '@/components/common/EmptyState'
import ConfirmModal from '@/components/common/ConfirmModal'
import ProjectHubLayout from '@/components/common/ProjectHubLayout'
import ChapterGenerationModal from '@/components/common/ChapterGenerationModal'
import ReviewModal from '@/components/common/ReviewModal'
import ReviewResultsModal from '@/components/common/ReviewResultsModal'
import { logError } from '@/utils/logger'
import { NOVEL_TYPE_DIMS } from '@/types/story'
import type { NovelExtraction, DetailGenResult, ChapterExtraction, StyleChapter } from '@/types/story'

interface RawCharacterInput {
  name?: string; role?: string; traits?: string[] | string; personality?: string
  background?: string; appearance?: string; arc?: string; abilities?: string
  importance?: number; relationships?: { target: string; type: string }[] | string
}
import type { Character } from '@/types/character'
import { EMPTY_CHARACTER } from '@/types/character'
import type { VersionRecord } from '@/components/common/ChapterGenerationModal'
import { buildStylePrompt, getTemplateInjection } from '@/utils/styleInjector'
import { styleTemplateService } from '@/services/fileService'
import type { StyleTemplate } from '@/types/styleTemplate'
import {
  SparklesIcon, TrashIcon, PlayIcon, StopIcon, FolderOpenIcon,
  ArrowLeftIcon, BookOpenIcon, DocumentArrowDownIcon, PlusIcon, ArrowRightIcon,
} from '@heroicons/react/24/outline'
import type { NovelType, Step, PreviewTab, DimKey } from './types'
import { TABS, STATUS_LABELS, STATUS_COLORS, TYPE_LABELS, TYPE_DIM_PRESETS, DIM_LABELS, normalizeRole, NOVEL_TYPE_CARDS } from './constants'
import TimelineTab from './tabs/TimelineTab'
import ChapterTab from './tabs/ChapterTab'
import DetailsTab from './tabs/DetailsTab'
import OutlineTab from './tabs/OutlineTab'
import GenerateTab from './tabs/GenerateTab'
import WriteTab from './tabs/WriteTab'
import ExtractionProgressDialog from './dialogs/ExtractionProgressDialog'
import DimensionSelectionDialog from './dialogs/DimensionSelectionDialog'
import StyleDimensionDialog from './dialogs/StyleDimensionDialog'
import ImportCharactersModal from './dialogs/ImportCharactersModal'
import { useImitationHandlers } from "./hooks/useImitationHandlers";
import { useWriteTabInjection } from "./hooks/useWriteTabInjection";
import { safeItemName } from "./utils";

export default function ImitationPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeConfigId = useSettingsStore(s => s.activeConfigId)
  const activeProjectId = useStore(s => s.activeProjectId)
  const setActiveProject = useStore(s => s.setActiveProject)
  const projectsBasePath = useStore(s => s.projectsBasePath)
  const imitationProjectsPath = useStore(s => s.imitationProjectsPath)
  const fileVersion = useStore(s => s.fileVersion)
  const fileEditNotify = useStore(s => s.fileEditNotify)
  const setFileEditNotify = useStore(s => s.setFileEditNotify)
  const setActivePage = useStore(s => s.setActivePage)
  const setCharacters = useStore(s => s.setCharacters)
  const setOutlineContent = useStore(s => s.setOutlineContent)
  const setWorldbuildingContent = useStore(s => s.setWorldbuildingContent)

  const [novelType, setNovelType] = useState<NovelType>('general')
  const [projects, setProjects] = useState<{ id: string; name: string; chapterCount: number; status: string; createdAt: string; novelType: string }[]>([])
  const [importLoading, setImportLoading] = useState(false)
  const [showCreateProject, setShowCreateProject] = useState(false)
  const [newImitationName, setNewImitationName] = useState('')
  const [confirmClearData, setConfirmClearData] = useState(false)
  const [hubConfirmed, setHubConfirmed] = useState(false)
  const [extraction, setExtraction] = useState<NovelExtraction | null>(null)
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null)
  const [step, setStep] = useState<Step>('import')
  const [progress, setProgress] = useState({ current: 0, total: 0, text: '' })
  const [loading, setLoading] = useState(false)
  const [previewTab, setPreviewTab] = useState<PreviewTab>(() => {
    const tab = searchParams.get('tab')
    return (tab as PreviewTab) || 'chapter'
  })
  const [extractIds, setExtractIds] = useState<Set<string>>(new Set())
  const [styleLoading, setStyleLoading] = useState(false)
  const [styleProgress, setStyleProgress] = useState('')
  const [stylePaused, setStylePaused] = useState(false)
  const [styleChapterIds, setStyleChapterIds] = useState<Set<string>>(new Set())
  const styleAbortRef = useRef(false)
  const stylePausedRef = useRef(false)
  const [genLoading, setGenLoading] = useState(false)
  const [genPreview, setGenPreview] = useState('')
  const [genType, setGenType] = useState<string | null>(null)
  const [extStyleId, setExtStyleId] = useState('')
  const [extStyleTpls, setExtStyleTpls] = useState<StyleTemplate[]>([])
  const [outlineGenerated, setOutlineGenerated] = useState<Record<string, boolean>>({})
  const [outlineResults, setOutlineResults] = useState<Record<string, string>>({})
  const [chapterWriteView, setChapterWriteView] = useState<string | null>(null)
  const [chapterContents, setChapterContents] = useState<Record<string, 'new' | 'skip' | 'overwrite' | 'merge'>>({})
  const [writeContent, setWriteContent] = useState('')
  const [writeLoading, setWriteLoading] = useState(false)
  const [writeGenOverlay, setWriteGenOverlay] = useState(false)
  const [writeGenWordCount, setWriteGenWordCount] = useState(0)
  const writeGenAbortRef = useRef<(() => void) | null>(null)
  const [showWriteAIGen, setShowWriteAIGen] = useState(false)
  const [showWriteReview, setShowWriteReview] = useState(false)
  const [showWriteReviewResults, setShowWriteReviewResults] = useState(false)
  const [showWriteExport, setShowWriteExport] = useState(false)
  const [showWriteVersions, setShowWriteVersions] = useState(false)
  const [writeVersionHistory, setWriteVersionHistory] = useState<VersionRecord[]>([])
  const [detailsResults, setDetailsResults] = useState<string>('')
  const [detailGenResults, setDetailGenResults] = useState<DetailGenResult[]>([])
  const [detailGenRunning, setDetailGenRunning] = useState(false)
  const [detailGenCurrent, setDetailGenCurrent] = useState(0)
  const detailGenAbortRef = useRef(false)
  const [toast, setToast] = useState('')
  const [dimSubTab, setDimSubTab] = useState<DimKey>('characters')
  const [showDimDialog, setShowDimDialog] = useState(false)
  const [extractDims, setExtractDims] = useState<Set<string>>(new Set())
  const [showStyleDimDialog, setShowStyleDimDialog] = useState(false)
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [editingDetail, setEditingDetail] = useState<DetailGenResult | null>(null)
  const [showSrcDetailModal, setShowSrcDetailModal] = useState(false)
  const [viewingSrcDetail, setViewingSrcDetail] = useState<ChapterExtraction | null>(null)
  const [styleDims, setStyleDims] = useState<Set<string>>(new Set())
  const abortRef = useRef(false)
  const [extracting, setExtracting] = useState(false)
  const pausedRef = useRef(false)
  const mountedRef = useRef(false)

  useEffect(() => { setActivePage("imitation"); handlers.loadProjects() }, [activeProjectId, projectsBasePath, fileVersion])
  useEffect(() => {
    if (!fileEditNotify || !activeProjectId) return
    const fp = fileEditNotify.filePath.replace(/\\/g, '/').toLowerCase()
    if (fp.includes('/chapters/') || fp.includes('/outline/') || fp.includes('/detailed_outline/') || fp.includes('/summaries/')) {
      handlers.loadProjects(); setFileEditNotify(null)
    }
  }, [fileEditNotify, activeProjectId])

  // Sync previewTab to URL search params (skip mount to avoid overwriting sidebar deep-link)
  useEffect(() => {
    if (!mountedRef.current) { mountedRef.current = true; return }
    const currentTab = searchParams.get('tab')
    if (previewTab !== currentTab && previewTab !== 'chapter') {
      setSearchParams({ tab: previewTab }, { replace: true })
    } else if (previewTab === 'chapter' && currentTab) {
      setSearchParams({}, { replace: true })
    }
  }, [previewTab])

  // Read tab from URL when searchParams change (sidebar deep-link)
  useEffect(() => {
    const tab = searchParams.get('tab')
    if (tab && (tab === 'outline' || tab === 'details') && tab !== previewTab) {
      setPreviewTab(tab as PreviewTab)
    }
  }, [searchParams])

  const [importChars, setImportChars] = useState<any[]>([]);
  const [existingChars, setExistingChars] = useState<any[]>([]);
  const [charActions, setCharActions] = useState<Record<string, any>>({});
  const [showImportModal, setShowImportModal] = useState(false);

  const handlers = useImitationHandlers({
    setExtraction, setSelectedChapterId, setStep, setProgress, setExtracting,
    setStyleLoading, setStyleProgress, setStylePaused,
    setGenLoading, setGenType, setGenPreview, setOutlineGenerated, setOutlineResults,
    setDetailGenRunning, setDetailGenCurrent, setDetailGenResults, setDetailsResults,
    setImportChars, setExistingChars, setCharActions, setShowImportModal, setShowDetailModal, setEditingDetail,
    setLoading, setNovelType, setChapterContents, setExtractIds, setToast,
    importChars, existingChars, charActions,
    novelType, extraction, extractIds, extractDims, styleChapterIds, styleDims,
    outlineResults, detailGenResults, detailsResults, chapterContents,
    selectedChapterId,
    abortRef, pausedRef, styleAbortRef, stylePausedRef, detailGenAbortRef,
    activeConfigId, activeProjectId, imitationProjectsPath,
    setCharacters, setOutlineContent, setWorldbuildingContent, setActiveProject,
    navigate,
  });


  useWriteTabInjection({
    previewTab, novelType, extraction,
    outlineResults, detailGenResults, detailsResults,
  });

  const selectedChapter = extraction?.chapters.find(c => c.chapterId === selectedChapterId)
  const extractedCount = extraction?.chapters.filter(c => c.extractedAt).length || 0
  const ag = extraction?.aggregated || null


  // v13.1.0: 在仿写界面直接创建/删除/导入仿写项目
  const handleCreateImitationProject = async () => {
    if (!newImitationName.trim() || !imitationProjectsPath) return
    const name = newImitationName.trim()
    try {
      await projectService.create(name, imitationProjectsPath, 'imitation')
      const meta = await projectService.getMeta(`${imitationProjectsPath}/${name}`)
      const { useStore } = await import('@/store')
      useStore.getState().addProject({ id: name, ...meta, type: 'imitation' })
      setNewImitationName(''); setShowCreateProject(false)
      setActiveProject(name, 'imitation')
    } catch (err) { alert('创建项目失败：' + (err instanceof Error ? err.message : '未知错误')) }
  }

  const handleDeleteImitationProject = async (p: { id: string; name: string }) => {
    try {
      const { useStore } = await import('@/store')
      const projectPath = `${imitationProjectsPath}/${p.id}`
      try { await projectService.delete(projectPath) } catch (err) { logError('删除项目目录失败', err) }
      useStore.getState().removeProject(p.id)
    } catch (err) { alert('删除失败') }
  }

  const handleImportImitationProject = async () => {
    try {
      const { dialogService, projectService: ps } = await import('@/services/fileService')
      const zipPath = await dialogService.openZip()
      if (!zipPath) return
      await ps.importProject(zipPath)
      // Force reload via fileVersion
      const { useStore: us } = await import('@/store')
      us.getState().setFileEditNotify?.({ filePath: 'projects/', newContent: '' })
    } catch (err) { alert('导入失败') }
  }

  // ---- Views ----

  // Guard: need an imitation project selected
  const project = useStore(s => s.projects.find(p => p.id === activeProjectId))
  const allProjects = useStore(s => s.projects)
  const imitationProjects = allProjects.filter(p => p.type === 'imitation')

  if (!activeProjectId || !imitationProjectsPath || project?.type !== 'imitation' || !hubConfirmed) {
    return (
      <>
        <ProjectHubLayout
          title="小说仿写"
          projects={imitationProjects as any}
          activeProjectId={activeProjectId && !hubConfirmed ? activeProjectId : null}
          onSelectProject={(p) => { setActiveProject(p.id, 'imitation') }}
          onCreateProject={() => setShowCreateProject(true)}
          onImportProject={handleImportImitationProject}
          importLabel="导入项目"
          createLabel="新建"
          onDeleteProject={handleDeleteImitationProject}
          deleteTitle="删除仿写项目"
          deleteMessage={(name) => `确定要删除仿写项目「${name}」吗？此操作不可撤销。`}
          emptyIcon="📝"
          emptyTitle="暂无仿写项目"
          emptyDescription="创建仿写项目开始模仿你喜欢的作家风格"
          renderProjectItem={(p, active) => (
            <div>
              <div style={{ fontSize: 13, fontWeight: active ? 700 : 500, color: active ? '#7c3aed' : '#2d2520', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.name}
              </div>
              <div style={{ fontSize: 11, color: '#9b8e84', marginTop: 2 }}>
                {(p as any).chapterCount}章 · {((p as any).wordCount || 0).toLocaleString()}字
              </div>
            </div>
          )}
          renderEmptyState={() => (
            <EmptyState icon="📝" title="选择左侧仿写项目" description="或新建 / 导入一个项目开始仿写" />
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
                  <div style={{ fontSize: 26, fontWeight: 700, color: '#7c3aed' }}>{(p as any).chapterCount || 0}</div>
                  <div style={{ fontSize: 11, color: '#9b8e84', marginTop: 2 }}>章节数</div>
                </div>
                <div style={{ width: 1, background: 'rgba(124,58,237,0.06)' }} />
                <div className="stagger-item" style={{ flex: 1, textAlign: 'center', padding: '16px 12px' }}>
                  <div style={{ fontSize: 26, fontWeight: 700, color: '#7c3aed' }}>{((p as any).wordCount || 0).toLocaleString()}</div>
                  <div style={{ fontSize: 11, color: '#9b8e84', marginTop: 2 }}>总字数</div>
                </div>
                <div style={{ width: 1, background: 'rgba(124,58,237,0.06)' }} />
                <div className="stagger-item" style={{ flex: 1, textAlign: 'center', padding: '16px 12px' }}>
                  <div style={{ fontSize: 26, fontWeight: 700, color: '#7c3aed' }}>仿写</div>
                  <div style={{ fontSize: 11, color: '#9b8e84', marginTop: 2 }}>项目类型</div>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
                <Button variant="accent-gradient" onClick={() => setHubConfirmed(true)}
                  icon={<ArrowRightIcon style={{ width: 16, height: 16 }} />}
                  style={{ flex: 1, justifyContent: 'center', padding: '12px 0', fontSize: 14 }}>
                  进入项目
                </Button>
              </div>
            </div>
          )}
        />

        {/* 新建仿写项目弹窗 */}
        <Modal isOpen={showCreateProject} onClose={() => setShowCreateProject(false)} title="新建仿写项目" width={440}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#6b5e54', marginBottom: 6 }}>项目名称</label>
              <input type="text" value={newImitationName} onChange={e => setNewImitationName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCreateImitationProject() }}
                placeholder="输入项目名称..." autoFocus className="focus-ring"
                style={{ width: '100%', padding: '10px 14px', fontSize: 14, borderRadius: 10,
                  border: '1px solid #e5e0da', outline: 'none', background: '#faf9f8', fontFamily: 'inherit' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8, borderTop: '1px solid #f0ece8' }}>
              <Button variant="secondary" onClick={() => setShowCreateProject(false)}>取消</Button>
              <Button onClick={handleCreateImitationProject} disabled={!newImitationName.trim()}>创建</Button>
            </div>
          </div>
        </Modal>
      </>
    )
  }

  // No extraction yet: show type select + import
  if (!extraction) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
        <div style={{ textAlign: 'center', maxWidth: 960 }}>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: '#2d2520', marginBottom: 8 }}>小说仿写</h1>
          <p style={{ fontSize: 14, color: '#9b8e84', marginBottom: 24 }}>选择小说类型 → 导入TXT → AI分析 → 模仿生成新作品</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
            {NOVEL_TYPE_CARDS.map(card => (
              <button key={card.type} onClick={() => handlers.handleSelectType(card.type)} style={{
                padding: '20px 16px', borderRadius: 16, border: novelType === card.type ? '2px solid ' + card.color : '2px solid rgba(0,0,0,0.06)',
                background: novelType === card.type ? card.color + '08' : '#fff', cursor: 'pointer',
                textAlign: 'center', transition: 'all 0.15s',
              }} onMouseEnter={e => (e.currentTarget as HTMLElement).style.boxShadow = '0 6px 20px rgba(0,0,0,0.08)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.boxShadow = 'none'}>
                <card.icon style={{ width: 32, height: 32, color: card.color, marginBottom: 8 }} />
                <h3 style={{ fontSize: 14, fontWeight: 700, color: '#2d2520', marginBottom: 4 }}>{card.label}</h3>
                <p style={{ fontSize: 10, color: '#9b8e84', lineHeight: 1.5, margin: 0 }}>{card.desc}</p>
              </button>
            ))}
          </div>
          <p style={{ fontSize: 13, color: '#9b8e84', marginBottom: 16 }}>已选: <strong style={{ color: novelType === 'erotic' ? '#dc2626' : '#7c3aed' }}>{TYPE_LABELS[novelType] || '通用'}</strong> 类型</p>
          <Button onClick={handlers.handleImport} disabled={importLoading} icon={<FolderOpenIcon style={{ width: 18, height: 18 }} />} size="sm">
            {importLoading ? '导入中...' : '导入TXT小说'}
          </Button>
        </div>
      </div>
    )
  }

  // View 3: Detail
  return (
    <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', top: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 500, padding: '10px 24px', borderRadius: 12, background: '#16a34a', color: '#fff', fontSize: 13, fontWeight: 600, boxShadow: '0 8px 24px rgba(0,0,0,0.2)', pointerEvents: 'none' }}>
          ✓ {toast}
        </div>
      )}
      {/* Header */}
      <div style={{ padding: '12px 20px', borderBottom: '1px solid rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => { setExtraction(null); setStep('import') }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9b8e84', display: 'flex', padding: 4 }}><ArrowLeftIcon style={{ width: 20, height: 20 }} /></button>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: '#2d2520' }}>{extraction.novelName}</h2>
          <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: novelType === 'erotic' ? 'rgba(220,38,38,0.1)' : 'rgba(124,58,237,0.08)', color: novelType === 'erotic' ? '#dc2626' : '#7c3aed', fontWeight: 600 }}>{TYPE_LABELS[novelType] || '通用'}</span>
          <span style={{ fontSize: 11, color: '#9b8e84' }}>{extraction.chapters.length}章</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <Button size="sm" onClick={() => { const preset = TYPE_DIM_PRESETS[novelType] || TYPE_DIM_PRESETS.general; setExtractDims(new Set(preset)); setShowDimDialog(true) }} disabled={!activeConfigId || extractIds.size === 0 || extracting} icon={<PlayIcon style={{ width: 14, height: 14 }} />}>提取({extractIds.size}章)</Button>
          {extractedCount > 0 && !extracting && (
            <Button size="sm" variant="ghost" onClick={() => setExtractIds(new Set(extraction.chapters.filter(c => !c.extractedAt).map(c => c.chapterId)))}>提取剩余</Button>
          )}
          {extracting && (
            <>
              <Button size="sm" variant="ghost" onClick={() => { pausedRef.current = !pausedRef.current }}>{pausedRef.current ? '继续提取' : '暂停提取'}</Button>
              <Button size="sm" variant="danger" onClick={() => { abortRef.current = true; pausedRef.current = false }}>停止提取</Button>
            </>
          )}
          {extractedCount > 0 && !extracting && !extraction.styleProfile && <Button size="sm" variant="secondary" onClick={() => { const preset = NOVEL_TYPE_DIMS[TYPE_LABELS[novelType]] || NOVEL_TYPE_DIMS['通用']; setStyleDims(new Set(preset)); setStyleChapterIds(new Set(extraction.chapters.filter(c => c.extractedAt).slice(0, 20).map(c => c.chapterId))); setShowStyleDimDialog(true) }} disabled={!activeConfigId} icon={<SparklesIcon style={{ width: 14, height: 14 }} />}>{styleLoading ? (stylePaused ? '已暂停' : styleProgress) : '风格分析'}</Button>}
          {styleLoading && <Button size="sm" variant="ghost" onClick={() => { if (stylePaused) { setStylePaused(false); stylePausedRef.current = false } else { setStylePaused(true); stylePausedRef.current = true } }} icon={stylePaused ? <PlayIcon style={{ width: 14, height: 14 }} /> : <StopIcon style={{ width: 14, height: 14 }} />}>{stylePaused ? '继续' : '暂停'}</Button>}
          {styleLoading && <Button size="sm" variant="danger" onClick={() => { styleAbortRef.current = true; setStylePaused(false); stylePausedRef.current = false }} icon={<StopIcon style={{ width: 14, height: 14 }} />}>停止</Button>}
          {extraction.styleProfile && !extraction.generatedNovel && <Button size="sm" variant="secondary" onClick={() => setPreviewTab('generate')} icon={<SparklesIcon style={{ width: 14, height: 14 }} />}>模仿生成</Button>}
          <Button size="sm" variant="ghost" onClick={handlers.handleSendToStyleWorkshop} icon={<SparklesIcon style={{ width: 14, height: 14 }} />}>深度风格</Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirmClearData(true)} icon={<TrashIcon style={{ width: 14, height: 14 }} />}>删除</Button>
        </div>
      </div>

      {/* Toolbar */}
      <div style={{ padding: '8px 20px', borderBottom: '1px solid rgba(0,0,0,0.04)', display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(0,0,0,0.01)', flexWrap: 'wrap', flexShrink: 0 }}>
        <button onClick={() => setExtractIds(new Set(extraction.chapters.map(c => c.chapterId)))} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#7c3aed' }}>全选</button>
        <button onClick={() => setExtractIds(new Set())} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#7c3aed' }}>清空</button>
        <button onClick={() => setExtractIds(new Set(extraction.chapters.slice(0, 50).map(c => c.chapterId)))} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#7c3aed' }}>前50章</button>
        <button onClick={() => setExtractIds(new Set(extraction.chapters.slice(0, 10).map(c => c.chapterId)))} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#7c3aed' }}>前10章</button>
        <span style={{ fontSize: 11, color: '#9b8e84' }}>已选 {extractIds.size}章</span>
      </div>

      {/* Next step guide after extraction */}
      {extractedCount > 0 && !extracting && !extraction.styleProfile && (
        <div style={{ padding: '8px 20px', background: 'rgba(124,58,237,0.04)', borderBottom: '1px solid rgba(124,58,237,0.08)', display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, color: '#7c3aed' }}>
          <SparklesIcon style={{ width: 14, height: 14 }} />
          提取完成 (已自动聚合)。下一步: ①切换到「生成」Tab → ②大纲模仿(生成新设定) → ③细纲模仿(逐章生成) → ④「导入到项目」
        </div>
      )}

      {/* Main body — tabs */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
        {/* Left: Chapter list */}
        <div style={{ width: 280, minWidth: 260, borderRight: '1px solid rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <ScrollArea maxHeight="100%" style={{ flex: 1, padding: 4 }}>
            {extraction.chapters.map(ch => {
              const wc = ch.chapterContent ? Math.round(ch.chapterContent.length / 1000) : 0
              return (
                <div key={ch.chapterId} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 5, padding: '5px 8px', cursor: 'pointer',
                  borderRadius: 8, background: selectedChapterId === ch.chapterId ? 'rgba(124,58,237,0.06)' : 'transparent',
                  color: selectedChapterId === ch.chapterId ? '#7c3aed' : '#2d2520', fontWeight: selectedChapterId === ch.chapterId ? 600 : 400,
                }} onClick={() => setSelectedChapterId(ch.chapterId)}>
                  <input type="checkbox" checked={extractIds.has(ch.chapterId)} onChange={() => handlers.toggleExtractId(ch.chapterId)} style={{ width: 13, height: 13, accentColor: '#7c3aed', flexShrink: 0, marginTop: 1 }} onClick={e => e.stopPropagation()} />
                  <span style={{ flex: 1, fontSize: 11, lineHeight: 1.5, wordBreak: 'break-word', whiteSpace: 'normal' }}>第{ch.chapterNumber}章 {ch.chapterTitle.replace(/^第[一二三四五六七八九十百千零\d]+[章卷节回]\s*/, '')}</span>
                  <span style={{ fontSize: 8, color: '#9b8e84', flexShrink: 0, whiteSpace: 'nowrap' }}>{wc}k</span>
                  {!!ch.extractedAt && <span style={{ fontSize: 9, color: '#16a34a', fontWeight: 600, flexShrink: 0 }}>✓</span>}
                </div>
              )
            })}
          </ScrollArea>
        </div>

        {/* Center */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '4px 14px', borderBottom: '1px solid rgba(0,0,0,0.04)', display: 'flex', gap: 2, flexShrink: 0 }}>
            {TABS.map(tab => (
              <button key={tab.key} onClick={() => {
                if (tab.key === 'outline') { navigate('/imitation-outline'); return }
                if (tab.key === 'details') { navigate('/imitation-detailed'); return }
                setPreviewTab(tab.key)
              }} style={{
                padding: '5px 12px', borderRadius: '6px 6px 0 0', border: 'none',
                background: previewTab === tab.key ? 'rgba(124,58,237,0.06)' : 'transparent',
                color: previewTab === tab.key ? '#7c3aed' : '#6b5e54', fontSize: 12, cursor: 'pointer',
                fontWeight: previewTab === tab.key ? 600 : 400, display: 'flex', alignItems: 'center', gap: 4,
              }}><tab.icon style={{ width: 13, height: 13 }} />{tab.label}</button>
            ))}
          </div>
          {/* Dim switcher for 原书大纲 tab (outside scroll area) */}
          {previewTab === 'srcOutline' && (
            <div style={{ display: 'flex', gap: 4, padding: '4px 14px', borderBottom: '1px solid rgba(0,0,0,0.04)', flexWrap: 'wrap', flexShrink: 0 }}>
              {(['characters','worldbuilding','items','powerSystem','foreshadowing','emotionCurve',...(novelType === 'erotic' ? ['erotic' as DimKey] : [])] as DimKey[]).map(dk => (
                <button key={dk} onClick={() => setDimSubTab(dk)} style={{
                  padding: '3px 8px', borderRadius: 6, border: 'none', fontSize: 10, cursor: 'pointer',
                  background: dimSubTab === dk ? 'rgba(124,58,237,0.08)' : 'transparent',
                  color: dimSubTab === dk ? '#7c3aed' : '#6b5e54', fontWeight: dimSubTab === dk ? 600 : 400,
                }}>{DIM_LABELS[dk]}</button>
              ))}
            </div>
          )}
          {previewTab === 'chapter' && (
            <ChapterTab extraction={extraction} selectedChapterId={selectedChapterId} />
          )}

{/* === 原书大纲 & 大纲 Tab === */}
          {(previewTab === 'srcOutline' || previewTab === 'outline') && (
            <ScrollArea maxHeight="100%" style={{ flex: 1 }}>
              <div style={{ padding: 10 }}>
                <OutlineTab
                  extraction={extraction}
                  outlineResults={outlineResults}
                  dimSubTab={dimSubTab}
                  novelType={novelType}
                  isSrc={previewTab === 'srcOutline'}
                />
              </div>
            </ScrollArea>
          )}

{/* === 原书细纲 & 细纲 Tab === */}
          {previewTab === 'srcDetails' && (
            <DetailsTab
              isSrc={true}
              extraction={extraction}
              detailGenResults={detailGenResults}
              detailsResults={detailsResults}
              chapterContents={chapterContents}
              onViewSrcDetail={(ch) => { setViewingSrcDetail(ch); setShowSrcDetailModal(true) }}
              onEditDetail={(d) => { setEditingDetail(d); setShowDetailModal(true) }}
              onWriteChapter={(num) => { setChapterWriteView(num); setWriteContent(chapterContents[num] || ''); setPreviewTab('write') }}
            />
          )}
          {previewTab === 'details' && (
            <DetailsTab
              isSrc={false}
              extraction={extraction}
              detailGenResults={detailGenResults}
              detailsResults={detailsResults}
              chapterContents={chapterContents}
              onViewSrcDetail={(ch) => { setViewingSrcDetail(ch); setShowSrcDetailModal(true) }}
              onEditDetail={(d) => { setEditingDetail(d); setShowDetailModal(true) }}
              onWriteChapter={(num) => { setChapterWriteView(num); setWriteContent(chapterContents[num] || ''); setPreviewTab('write') }}
            />
          )}

          {/* === 时间线 Tab === */}
          {previewTab === 'timeline' && (
            <TimelineTab extraction={extraction} />
          )}

          {/* === 章节创作 Tab === */}
          {previewTab === 'write' && (
            <>
              <WriteTab
                chapterWriteView={chapterWriteView}
                writeContent={writeContent}
                chapterContents={chapterContents}
                detailGenResults={detailGenResults}
                detailsResults={detailsResults}
                extractionId={extraction?.id || ''}
                activeConfigId={activeConfigId || ''}
                writeVersionHistory={writeVersionHistory}
                writeGenOverlay={writeGenOverlay}
                writeGenWordCount={writeGenWordCount}
                writeGenAbortRef={writeGenAbortRef}
                onSetWriteContent={setWriteContent}
                onSetChapterWriteView={(id) => { setWriteContent(chapterContents[id] || ''); setChapterWriteView(id) }}
                onShowAIGen={() => setShowWriteAIGen(true)}
                onShowReview={() => setShowWriteReview(true)}
                onShowReviewResults={() => setShowWriteReviewResults(true)}
                onShowVersions={() => setShowWriteVersions(true)}
                onShowExport={() => setShowWriteExport(true)}
                onSave={() => {
                  if (!chapterWriteView) return
                  const updated = { ...chapterContents, [chapterWriteView]: writeContent }
                  setChapterContents(updated as any)
                  if (extraction) handlers.saveExtraction({ ...extraction, chapterContents: updated, updatedAt: new Date().toISOString() })
                  setToast('已保存')
                  setTimeout(() => setToast(''), 3000)
                }}
                onClear={async () => { setWriteContent(''); if (extraction) await handlers.saveExtraction({ ...extraction, chapterContents: { ...chapterContents, [chapterWriteView || '']: '' }, updatedAt: new Date().toISOString() }) }}
                onNavigateChapter={(dir) => {
                  const target = dir === 'prev' ? parseInt(chapterWriteView || '0') - 1 : parseInt(chapterWriteView || '0') + 1
                  const d = detailGenResults.length > 0 ? detailGenResults.find((d: any) => d.chapterNumber === target) : null
                  if (d) { const updated = { ...chapterContents, [chapterWriteView || '']: writeContent }; setChapterContents(updated as any); if (extraction) handlers.saveExtraction({ ...extraction, chapterContents: updated, updatedAt: new Date().toISOString() }); setChapterWriteView(String(target)); setWriteContent(chapterContents[String(target)] || '') }
                }}
              />

            {/* Write tab modals */}
            <ChapterGenerationModal
              isOpen={showWriteAIGen}
              onClose={() => setShowWriteAIGen(false)}
              chapterId={chapterWriteView || ''}
              currentContent={writeContent}
              onApply={(newContent) => { setWriteContent(newContent); const updated = { ...chapterContents, [chapterWriteView || '']: newContent }; setChapterContents(updated as any); if (extraction) handlers.saveExtraction({ ...extraction, chapterContents: updated, updatedAt: new Date().toISOString() }) }}
              onVersionSaved={(v) => setWriteVersionHistory(prev => [v, ...prev])}
              onGenStart={() => { setWriteGenOverlay(true); setWriteGenWordCount(0) }}
              onGenChunk={(data: any) => { setWriteGenWordCount(data.charCount) }}
              onGenDone={() => { setWriteGenOverlay(false); writeGenAbortRef.current = null }}
              onGenError={() => { setWriteGenOverlay(false); writeGenAbortRef.current = null }}
              externalAbortRef={writeGenAbortRef}
            />
            <ReviewModal
              isOpen={showWriteReview}
              onClose={() => setShowWriteReview(false)}
              chapterTitle={detailGenResults.find((d: any) => d.chapterNumber === parseInt(chapterWriteView || '0'))?.title || '未命名章节'}
              chapterLabel={`第${chapterWriteView || '?'}章`}
              chapterContent={writeContent}
              projectId={extraction?.id || ''}
              configId={activeConfigId || ''}
            />
            <ReviewResultsModal
              isOpen={showWriteReviewResults}
              onClose={() => setShowWriteReviewResults(false)}
            />
            {/* Version history modal */}
            <Modal isOpen={showWriteVersions} onClose={() => setShowWriteVersions(false)} title="版本历史" width={700}>
              <div style={{ maxHeight: 400, overflowY: 'auto' }} className="custom-scrollbar">
                {writeVersionHistory.length > 0 ? writeVersionHistory.map((v: VersionRecord, i: number) => (
                  <div key={i} style={{ padding: '8px 12px', borderRadius: 10, background: '#faf9f8', border: '1px solid rgba(0,0,0,0.06)', marginBottom: 6, fontSize: 11 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontWeight: 600, color: '#2d2520' }}>版本 {writeVersionHistory.length - i} — {v.modelName}</span>
                      <span style={{ fontSize: 10, color: '#9b8e84' }}>{new Date(v.generatedAt).toLocaleString()}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => { setWriteContent(v.generatedContent); setShowWriteVersions(false) }} style={{ padding: '2px 8px', borderRadius: 6, border: '1px solid rgba(124,58,237,0.2)', background: 'rgba(124,58,237,0.04)', color: '#7c3aed', cursor: 'pointer', fontSize: 10 }}>恢复</button>
                    </div>
                  </div>
                )) : <div style={{ textAlign: 'center', padding: 40, color: '#9b8e84', fontSize: 13 }}>暂无版本记录</div>}
              </div>
            </Modal>
            {/* Export modal */}
            <Modal isOpen={showWriteExport} onClose={() => setShowWriteExport(false)} title="导出章节" width={400}>
              <p style={{ fontSize: 13, color: '#6b5e54', marginBottom: 16 }}>导出第{chapterWriteView || '?'}章为TXT文件</p>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <Button variant="secondary" size="sm" onClick={() => setShowWriteExport(false)}>取消</Button>
                <Button size="sm" onClick={async () => {
                  const outputPath = await dialogService.saveFile(`第${chapterWriteView || '0'}章.txt`)
                  if (!outputPath) return
                  await exportService.exportSingleChapter({
                    title: detailGenResults.find((d: any) => d.chapterNumber === parseInt(chapterWriteView || '0'))?.title || `第${chapterWriteView}章`,
                    content: writeContent,
                    outputPath,
                  })
                  setShowWriteExport(false)
                  setToast('导出成功')
                  setTimeout(() => setToast(''), 3000)
                }} icon={<DocumentArrowDownIcon style={{ width: 14, height: 14 }} />}>导出TXT</Button>
              </div>
            </Modal>
          </>
          )}

          {/* === 生成 Tab === */}
          {previewTab === 'generate' && (
            <GenerateTab
              extraction={extraction}
              outlineResults={outlineResults}
              outlineGenerated={outlineGenerated}
              novelType={novelType}
              genLoading={genLoading}
              genPreview={genPreview}
              genType={genType}
              detailGenRunning={detailGenRunning}
              detailGenCurrent={detailGenCurrent}
              detailGenResults={detailGenResults}
              detailsResults={detailsResults}
              extractIds={extractIds}
              externalStyleId={extStyleId}
              externalTemplates={extStyleTpls}
              onStyleChange={setExtStyleId}
              onGenerateDim={handlers.handleGenerateDim}
              onGenerateDetails={handlers.handleGenerateDetailsImitation}
              onStopDetailGen={() => { detailGenAbortRef.current = true }}
              onSaveAllDetails={() => {
                const json = JSON.stringify(detailGenResults, null, 2)
                setDetailsResults(json)
                if (extraction) handlers.saveExtraction({ ...extraction, detailsResults: json, detailGenResults, updatedAt: new Date().toISOString() })
                alert(`已保存 ${detailGenResults.length} 章细纲`)
              }}
              onClearDetails={() => {
                if (!confirm(`确定清除全部 ${detailGenResults.length} 章模仿细纲数据？此操作不可恢复。`)) return
                setDetailGenResults([]); setDetailsResults('')
                if (extraction) handlers.saveExtraction({ ...extraction, detailsResults: '', detailGenResults: [], updatedAt: new Date().toISOString() })
              }}
              onSelectRemaining={() => {
                const leftovers = extraction.chapters.filter(c => extractIds.has(c.chapterId) && c.extractedAt && !detailGenResults.find((d: any) => d.chapterNumber === c.chapterNumber))
                if (leftovers.length === 0) { alert('所有选中章节已生成细纲'); return }
                setExtractIds(new Set(leftovers.map(c => c.chapterId)))
                setTimeout(() => handlers.handleGenerateDetailsImitation(), 100)
              }}
            />
          )}
        </div>

        {/* Right: Stats */}
        <div style={{ width: 400, minWidth: 320, borderLeft: '1px solid rgba(0,0,0,0.05)', background: 'rgba(255,255,255,0.35)', display: 'flex', flexDirection: 'column', padding: '14px 16px', gap: 10, flexShrink: 0 }}>
          <h4 style={{ fontSize: 14, fontWeight: 700, color: '#2d2520' }}>提取统计</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 13 }}>
            <span>角色: {ag?.characters.length || 0}个</span>
            <span>地点: {ag?.worldbuilding.locations.length || 0}个</span>
            <span>道具: {ag?.items.length || 0}个</span>
            <span>等级: {ag?.powerSystem.levels.length || 0}级</span>
          </div>
          {extraction.styleProfile && <><div style={{ height: 1, background: 'rgba(0,0,0,0.05)' }} /><h4 style={{ fontSize: 14, fontWeight: 700, color: '#2d2520' }}>风格</h4><span style={{ fontSize: 11, color: '#16a34a' }}>✓ 已分析</span></>}
          {ag && activeProjectId && <><div style={{ height: 1, background: 'rgba(0,0,0,0.05)' }} /><Button onClick={handlers.handleImportToProject} icon={<FolderOpenIcon style={{ width: 16, height: 16 }} />} style={{ width: '100%' }}>导入到项目</Button></>}
        </div>
      </div>

      {/* Extraction Progress Dialog */}
      {extracting && (
        <ExtractionProgressDialog
          progress={progress}
          paused={pausedRef.current}
          onPauseResume={() => { pausedRef.current = !pausedRef.current }}
          onStop={() => { abortRef.current = true; pausedRef.current = false }}
        />
      )}

      {/* Dimension Selection Dialog */}
      {showDimDialog && (
        <DimensionSelectionDialog
          extractDims={extractDims}
          extractCount={extractIds.size}
          onToggleDim={(key) => { const n = new Set(extractDims); n.has(key) ? n.delete(key) : n.add(key); setExtractDims(n) }}
          onSetDims={setExtractDims}
          onConfirm={() => { setShowDimDialog(false); handlers.handleStartExtract() }}
          onClose={() => setShowDimDialog(false)}
        />
      )}

      {/* Style Dimension Dialog */}
      {showStyleDimDialog && (
        <StyleDimensionDialog
          styleDims={styleDims}
          styleChapterCount={styleChapterIds.size || 20}
          novelType={novelType}
          onToggleDim={(key) => { const n = new Set(styleDims); n.has(key) ? n.delete(key) : n.add(key); setStyleDims(n) }}
          onSetDims={setStyleDims}
          onConfirm={() => { setShowStyleDimDialog(false); handlers.handleStyleAnalyze() }}
          onClose={() => setShowStyleDimDialog(false)}
        />
      )}

            {/* Import Characters Modal */}
            <ImportCharactersModal
              isOpen={showImportModal}
              importChars={importChars}
              existingChars={existingChars}
              charActions={charActions}
              onActionChange={setCharActions}
              onConfirm={handlers.handleConfirmImport}
              onClose={() => setShowImportModal(false)}
            />

            {/* Source Detail Modal (read-only view of extracted chapter data) */}
            <Modal isOpen={showSrcDetailModal} onClose={() => { setShowSrcDetailModal(false); setViewingSrcDetail(null) }} title={`原书细纲 - 第${viewingSrcDetail?.chapterNumber || '?'}章`} width={680}>
              {viewingSrcDetail && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '70vh', overflowY: 'auto' }} className="custom-scrollbar">
                  <div><span style={{ fontSize: 14, fontWeight: 700, color: '#2d2520' }}>{viewingSrcDetail.chapterTitle}</span></div>
                  <div><label style={{ fontSize: 11, fontWeight: 600, color: '#9b8e84' }}>剧情摘要</label><p style={{ fontSize: 12, color: '#4a3f38', lineHeight: 1.7, margin: '4px 0 0' }}>{viewingSrcDetail.chapterSummary || '无'}</p></div>
                  {viewingSrcDetail.characters?.length > 0 && <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: '#9b8e84' }}>出场角色 ({viewingSrcDetail.characters.length})</label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                      {viewingSrcDetail.characters.map((c: any) => <span key={c.name} style={{ padding: '4px 10px', borderRadius: 8, background: 'rgba(124,58,237,0.06)', fontSize: 11, color: '#7c3aed' }}>{c.name}{c.role ? `(${c.role})` : ''}{c.traits?.length ? `: ${Array.isArray(c.traits) ? c.traits.join('、') : c.traits}` : ''}</span>)}
                    </div>
                  </div>}
                  {viewingSrcDetail.events?.length > 0 && <div><label style={{ fontSize: 11, fontWeight: 600, color: '#9b8e84' }}>关键事件</label><div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>{viewingSrcDetail.events.map((e: string) => <span key={e} style={{ padding: '3px 8px', borderRadius: 6, background: 'rgba(59,130,246,0.06)', fontSize: 10, color: '#3b82f6' }}>{e}</span>)}</div></div>}
                  {viewingSrcDetail.emotionalTone && <div><label style={{ fontSize: 11, fontWeight: 600, color: '#9b8e84' }}>情绪基调</label><span style={{ fontSize: 12, color: '#4a3f38', marginLeft: 8 }}>{viewingSrcDetail.emotionalTone}</span></div>}
                  {viewingSrcDetail.erotic && <div style={{ padding: '12px 16px', borderRadius: 12, background: 'rgba(220,38,38,0.03)', border: '1px solid rgba(220,38,38,0.12)', marginTop: 4 }}>
                    <label style={{ fontSize: 11, fontWeight: 700, color: '#dc2626' }}>🔞 情色分析</label>
                    {viewingSrcDetail.erotic.characterRoles?.length > 0 && <div style={{ marginTop: 6 }}><div style={{ fontSize: 10, fontWeight: 600, color: '#9b8e84', marginBottom: 2 }}>情色角色</div><div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{viewingSrcDetail.erotic.characterRoles.map((cr: any) => <span key={cr.name} style={{ padding: '4px 10px', borderRadius: 8, background: 'rgba(220,38,38,0.06)', fontSize: 10, color: '#dc2626' }}>{cr.name}({cr.domSub}/{cr.bodyState}) 性癖:{cr.kinks?.join(',')||'无'} 羞耻:{cr.shameLevel}</span>)}</div></div>}
                    {viewingSrcDetail.erotic.sceneFlow?.length > 0 && <div style={{ marginTop: 6 }}><div style={{ fontSize: 10, fontWeight: 600, color: '#9b8e84', marginBottom: 2 }}>性爱流程</div>{viewingSrcDetail.erotic.sceneFlow.map((sf: any, i: number) => <div key={i} style={{ fontSize: 10, color: '#4a3f38', marginBottom: 2, paddingLeft: 8, borderLeft: '2px solid rgba(220,38,38,0.15)' }}>{sf.phase}({sf.duration}): {sf.actions?.join('、')} → {sf.bodyReactions?.join('、')}</div>)}</div>}
                    {viewingSrcDetail.erotic.techniques && <div style={{ marginTop: 4, fontSize: 10, color: '#6b5e54' }}>技法: 体液[{viewingSrcDetail.erotic.techniques.bodyFluids?.join(',')||'无'}] 触感[{viewingSrcDetail.erotic.techniques.touchFocus?.join(',')||'无'}] 声音[{viewingSrcDetail.erotic.techniques.soundStyle||'密集'}] 呻吟[{viewingSrcDetail.erotic.techniques.moanDensity||'密集'}]</div>}
                    {viewingSrcDetail.erotic.powerDynamics && <div style={{ marginTop: 4, fontSize: 10, color: '#4a3f38' }}>权力关系: {viewingSrcDetail.erotic.powerDynamics}</div>}
                    {viewingSrcDetail.erotic.degradationPatterns?.length > 0 && <div style={{ marginTop: 4, fontSize: 10, color: '#6b5e54' }}>羞辱模式: {viewingSrcDetail.erotic.degradationPatterns.join('、')}</div>}
                  </div>}
                </div>
              )}
            </Modal>

            {/* Imitation Detail Modal (editable view of generated chapter data) */}
            <Modal isOpen={showDetailModal} onClose={() => { setShowDetailModal(false); setEditingDetail(null) }} title={`编辑细纲 - 第${editingDetail?.chapterNumber || '?'}章`} width={680}>
              {editingDetail && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: '70vh', overflowY: 'auto' }} className="custom-scrollbar">
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', display: 'block', marginBottom: 3 }}>标题</label>
                    <input value={editingDetail.title || ''} onChange={e => setEditingDetail({ ...editingDetail, title: e.target.value })} style={{ width: '100%', padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', fontSize: 13 }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', display: 'block', marginBottom: 3 }}>剧情摘要</label>
                    <textarea value={editingDetail.summary || ''} onChange={e => setEditingDetail({ ...editingDetail, summary: e.target.value })} rows={4} style={{ width: '100%', padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', fontSize: 13, resize: 'vertical', fontFamily: 'inherit' }} />
                  </div>
                  <div style={{ display: 'flex', gap: 16 }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', display: 'block', marginBottom: 3 }}>出场角色 (逗号分隔)</label>
                      <input value={Array.isArray(editingDetail.charactersAppearing) ? editingDetail.charactersAppearing.join(', ') : (editingDetail.charactersAppearing || '')} onChange={e => setEditingDetail({ ...editingDetail, charactersAppearing: e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean) })} style={{ width: '100%', padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', fontSize: 13 }} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', display: 'block', marginBottom: 3 }}>场景位置</label>
                      <input value={editingDetail.location || ''} onChange={e => setEditingDetail({ ...editingDetail, location: e.target.value })} style={{ width: '100%', padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', fontSize: 13 }} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 16 }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', display: 'block', marginBottom: 3 }}>等级变化</label>
                      <input value={editingDetail.levelChange || ''} onChange={e => setEditingDetail({ ...editingDetail, levelChange: e.target.value })} style={{ width: '100%', padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', fontSize: 13 }} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', display: 'block', marginBottom: 3 }}>情绪基调</label>
                      <input value={editingDetail.emotionalTone || ''} onChange={e => setEditingDetail({ ...editingDetail, emotionalTone: e.target.value })} style={{ width: '100%', padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', fontSize: 13 }} />
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', display: 'block', marginBottom: 3 }}>道具 (逗号分隔)</label>
                    <input value={Array.isArray(editingDetail.itemsUsed) ? editingDetail.itemsUsed.map((i: any) => safeItemName(i)).join(', ') : (editingDetail.itemsUsed || '')} onChange={e => setEditingDetail({ ...editingDetail, itemsUsed: e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean) })} style={{ width: '100%', padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', fontSize: 13 }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', display: 'block', marginBottom: 3 }}>关键事件 (一行一个)</label>
                    <textarea value={Array.isArray(editingDetail.keyEvents) ? editingDetail.keyEvents.join('\n') : (editingDetail.keyEvents || '')} onChange={e => setEditingDetail({ ...editingDetail, keyEvents: e.target.value.split('\n').filter(Boolean) })} rows={3} style={{ width: '100%', padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', fontSize: 13, resize: 'vertical', fontFamily: 'inherit' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: '#dc2626', display: 'block', marginBottom: 3 }}>🔞 情色场景设计</label>
                    <textarea value={editingDetail.eroticScene || ''} onChange={e => setEditingDetail({ ...editingDetail, eroticScene: e.target.value })} rows={6} style={{ width: '100%', padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(220,38,38,0.2)', fontSize: 13, resize: 'vertical', fontFamily: 'inherit', background: 'rgba(220,38,38,0.02)' }} placeholder="情色剧情设计...200-400字" />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8, borderTop: '1px solid rgba(0,0,0,0.06)' }}>
                    <Button variant="secondary" size="sm" onClick={() => { setShowDetailModal(false); setEditingDetail(null) }}>取消</Button>
                    <Button size="sm" onClick={() => handlers.handleUpdateDetail(editingDetail)}>保存细纲</Button>
                  </div>
                </div>
              )}
            </Modal>

      {/* 清除数据确认 */}
      {confirmClearData && (
        <ConfirmModal
          isOpen={true}
          title="清除仿写数据"
          message="确定清除仿写数据？此操作不可撤销。"
          confirmLabel="清除"
          danger
          onConfirm={() => { setExtraction(null); setStep('import'); setConfirmClearData(false) }}
          onCancel={() => setConfirmClearData(false)}
        />
      )}
    </div>
  )
}
