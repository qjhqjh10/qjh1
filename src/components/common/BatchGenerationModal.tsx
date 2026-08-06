import { useState, useRef, useEffect } from 'react'
import { useStore, useSettingsStore } from '@/store'
import { aiService, fileService, styleTemplateService, kbService, settingsService } from '@/services/fileService'
import { buildKBBlock, getSceneKb } from '@/services/knowledgePipeline'
import type { KBInjectMode } from '@/types/settings'
import { loadOutlineDimensions } from '@/utils/outlineData'
import { loadAllSummaries, saveSummary } from '@/services/summaryService'
import { buildStylePrompt, convertTemplateToProfile } from '@/utils/styleInjector'
import { chatAI } from '@/utils/chatAI'
import type { OutlineTabToggles, DetailedOutlineToggles } from '@/types/settings'
import type { DetailedChapter } from '@/types/chapter'
import type { Character } from '@/types/character'
import type { VersionRecord } from './ChapterGenerationModal'
import { saveVersionRecord } from './ChapterGenerationModal/versionManager'
import { normalizeParagraphs } from './ChapterGenerationModal/promptBuilder'
import { checkInput, miniActionLink, cardStyle, cardHeaderStyle } from './ChapterGenerationModal/constants'
import Modal from './Modal'
import ConfirmModal from './ConfirmModal'
import Button from './Button'
import { SparklesIcon, XMarkIcon, CheckIcon, ClockIcon, BookOpenIcon } from '@heroicons/react/24/outline'


interface Props {
  isOpen: boolean
  onClose: () => void
  chapters: DetailedChapter[]
  worldbuildingContent: string
  characters: Character[]
  outlineContent: string
  writtenChapterIds: Set<string>
  onVersionSaved: (v: VersionRecord) => void
  onGenStart: () => void
  onGenChunk: (data: { charCount: number }) => void
  onGenDone: () => void
  onGenError: (msg: string) => void
  externalAbortRef?: React.MutableRefObject<(() => void) | null>
}

type QueueStatus = 'waiting' | 'generating' | 'done' | 'error'
interface QueueItem {
  chapterId: string; title: string; order: number
  status: QueueStatus; wordCount: number; error?: string
}

const NONE_ID = '__none__'

function selectIds(setter: (v: Set<string> | ((p: Set<string>) => Set<string>)) => void, ids: string[]) {
  setter(new Set(ids))
}
function toggleSetId(setter: (v: Set<string> | ((p: Set<string>) => Set<string>)) => void, id: string) {
  setter((prev: Set<string>) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
}

export default function BatchGenerationModal({
  isOpen, onClose, chapters, worldbuildingContent, characters, outlineContent, writtenChapterIds,
  onVersionSaved, onGenStart, onGenChunk, onGenDone, onGenError, externalAbortRef,
}: Props) {
  const activeProjectId = useStore(s => s.activeProjectId)
  const projectsBasePath = useStore(s => s.projectsBasePath)
  const chapterSummaryMap = useStore(s => s.chapterSummaryMap)
  const configs = useSettingsStore(s => s.configs)
  const activeConfigId = useSettingsStore(s => s.activeConfigId)
  const prompts = useSettingsStore(s => s.prompts)
  const cg = useSettingsStore(s => s.aiSettings.chapterGen)

  const sortedChapters = [...chapters].sort((a, b) => a.order - b.order)

  // Config — same as ChapterGenerationModal
  const [outlineTabs, setOutlineTabs] = useState<OutlineTabToggles>(cg.outlineTabs)
  const [detailedOutlineFields, setDetailedOutlineFields] = useState<DetailedOutlineToggles>(cg.detailedOutlineFields)
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<Set<string>>(new Set(cg.selectedCharacterIds || []))
  const [genConfigId, setGenConfigId] = useState(activeConfigId || '')
  const [wordTarget, setWordTarget] = useState(cg.wordTarget)
  const [streamMode, setStreamMode] = useState(cg.streamMode)
  const [replaceMode, setReplaceMode] = useState(cg.replaceMode)
  const [selectedStyleTemplateId, setSelectedStyleTemplateId] = useState('')
  const [styleTemplates, setStyleTemplates] = useState<any[]>([])
  // KB + summaries
  const [selectedSummaryIds, setSelectedSummaryIds] = useState<Set<string>>(new Set(cg.selectedSummaryIds || []))
  const [selectedKbFileIds, setSelectedKbFileIds] = useState<Set<string>>(new Set(cg.selectedKbFileIds || []))
  // v15.4.0: 知识库注入方式（全量/片段）与片段关键词——弹窗内 state（与 selectedKbFileIds 生命周期一致）
  const [kbInjectMode, setKbInjectMode] = useState<KBInjectMode>('full')
  const [kbKeywords, setKbKeywords] = useState('')
  const [autoSummary, setAutoSummary] = useState(false)
  const [selectedSummaryPromptId, setSelectedSummaryPromptId] = useState(NONE_ID)
  const [kbDeleteConfirm, setKbDeleteConfirm] = useState<{ type: 'batch'; ids: string[]; count: number } | { type: 'single'; id: string; name: string } | null>(null)
  const [kbFiles, setKbFiles] = useState<{ id: string; originalName: string }[]>([])
  const [kbLoaded, setKbLoaded] = useState(false)

  // Chapter selection — only unwritten chapters
  const unwrittenChapters = sortedChapters.filter(c => !writtenChapterIds.has(c.id))
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(unwrittenChapters.map(c => c.id)))
  const selectAll = () => setSelectedIds(new Set(unwrittenChapters.map(c => c.id)))
  const clearSelection = () => setSelectedIds(new Set())

  // Queue
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [running, setRunning] = useState(false)
  const [currentIdx, setCurrentIdx] = useState(-1)
  const [totalWords, setTotalWords] = useState(0)
  const abortRef = useRef<(() => void) | null>(null)
  const runningRef = useRef(false)

  const chapterPrompts = prompts.filter(p => p.type === '章节')
  const [selectedChapterPromptId, setSelectedChapterPromptId] = useState(NONE_ID)
  const chapterPrompt = selectedChapterPromptId !== NONE_ID ? chapterPrompts.find(p => p.id === selectedChapterPromptId) : undefined
  const selectedStyleTemplate = styleTemplates.find((t: any) => t.id === selectedStyleTemplateId)

  const prevChapters = sortedChapters.sort((a, b) => a.order - b.order)
  const prevChaptersWithSummary = prevChapters.filter(c => chapterSummaryMap[c.id]?.trim())

  useEffect(() => {
    if (isOpen) {
      setOutlineTabs(cg.outlineTabs)
      setDetailedOutlineFields(cg.detailedOutlineFields)
      setSelectedCharacterIds(new Set(cg.selectedCharacterIds || []))
      setSelectedStyleTemplateId('')
      setSelectedSummaryIds(new Set())
      setSelectedKbFileIds(new Set())
      setSelectedIds(new Set(unwrittenChapters.map(c => c.id)))
      setQueue([]); setRunning(false); setCurrentIdx(-1); setTotalWords(0)
      setKbLoaded(false)
      styleTemplateService.list().then((list: any[]) => setStyleTemplates(Array.isArray(list) ? list : [])).catch(() => {})
    }
  }, [isOpen])

  const loadKBFiles = async (): Promise<{ id: string; originalName: string }[]> => {
    if (kbLoaded) return kbFiles
    try {
      const meta = await kbService.list() as { files: { id: string; originalName: string; projects: string[] }[] }
      const files = (meta.files || []).map(f => ({ id: f.id, originalName: f.originalName }))
      setKbFiles(files)
      setKbLoaded(true)
      return files
    } catch { setKbLoaded(true); return [] }
  }

  const smartSelectSummaries = () => {
    const recent = prevChaptersWithSummary.slice(-5)
    setSelectedSummaryIds(new Set(recent.map(c => c.id)))
  }

  const generateSummaryForChapter = async (chapterId: string, chapterContent: string, chapterTitle: string) => {
    if (!activeProjectId || !projectsBasePath || !genConfigId) return
    try {
      const summaryPrompts = prompts.filter(p => p.type === '摘要' && p.enabled)
      const selectedPrompt = selectedSummaryPromptId !== NONE_ID ? summaryPrompts.find(p => p.id === selectedSummaryPromptId) : null
      const template = selectedPrompt?.content || '请用简洁的语言总结以下章节内容的核心情节、人物发展和关键转折点。控制在200字以内。'
      const summaryPrompt = `${template}\n\n章节标题: ${chapterTitle}\n\n章节内容:\n${chapterContent.slice(0, 30000)}`
      const summary = await chatAI([{ role: 'user' as const, content: summaryPrompt }], genConfigId, activeProjectId)
      if (summary) {
        await saveSummary(`${projectsBasePath}/${activeProjectId}`, chapterId, summary)
        useStore.getState().setChapterSummary(chapterId, summary)
      }
    } catch { /* non-critical, continue */ }
  }

  const toggleOutlineTab = (key: keyof OutlineTabToggles) =>
    setOutlineTabs(prev => ({ ...prev, [key]: !prev[key] }))
  const toggleDetailedField = (key: keyof DetailedOutlineToggles) =>
    setDetailedOutlineFields(prev => ({ ...prev, [key]: !prev[key] }))
  const setAllOutlineTabs = (val: boolean) => {
    setOutlineTabs(prev => { const n = { ...prev }; for (const k of Object.keys(n) as (keyof OutlineTabToggles)[]) n[k] = val; return n })
  }
  const setAllDetailedFields = (val: boolean) => {
    setDetailedOutlineFields(prev => { const n = { ...prev }; for (const k of Object.keys(n) as (keyof DetailedOutlineToggles)[]) n[k] = val; return n })
  }

  const buildPromptForChapter = async (ch: DetailedChapter, loadedDims?: any, summaryIds?: Set<string>, kbBlock?: string | null) => {
    const parts: string[] = []
    // Style injection
    if (selectedStyleTemplateId && selectedStyleTemplate) {
      try {
        // v12.12.0: Prioritize user-edited prompt TXT
        let sp: string | null = null
        try {
          const { styleTemplateService } = await import('@/services/fileService')
          sp = await styleTemplateService.readPrompt(selectedStyleTemplateId)
        } catch { /* fallback */ }
        if (!sp) {
          // Load rule template if bound
          let rt: any = undefined
          const rtId = (selectedStyleTemplate as any)?.ruleTemplateId
          if (rtId) { try { rt = await styleTemplateService.readRuleTemplate(rtId) } catch {} }
          sp = buildStylePrompt(convertTemplateToProfile(selectedStyleTemplate), rt)
        }
        if (sp) parts.push(`【语言风格要求】\n${sp}`)
      } catch {}
    }
    // Chapter summaries（v13.x: summaryIds 显式传参——autoSummary 时避免读到过期闭包状态）
    const effectiveSummaryIds = summaryIds ?? selectedSummaryIds
    if (effectiveSummaryIds.size > 0) {
      const pp = `${projectsBasePath}/${activeProjectId}`
      try {
        const summaries = await loadAllSummaries(pp, [...effectiveSummaryIds])
        const summaryTexts = Object.entries(summaries).filter(([,v]) => v).map(([id, text]) => {
          const chap = chapters.find(c => c.id === id)
          return `第${(chap?.order ?? 0) + 1}章: ${text}`
        })
        if (summaryTexts.length > 0) parts.push(`【前文章节摘要】\n${summaryTexts.join('\n\n')}`)
      } catch {}
    }
    // Knowledge base（v15.4.0: 预取块由 handleStart 构建一次、N 章复用——全量/片段两种模式）
    if (kbBlock) parts.push(kbBlock)
    // Outline tab dimensions
    if (outlineTabs.plot && outlineContent) parts.push(`【故事剧情】\n${outlineContent.slice(0, 15000)}`)
    if (outlineTabs.worldbuilding && worldbuildingContent) parts.push(`【世界观设定】\n${worldbuildingContent.slice(0, 30000)}`)
    // Selected characters
    if (outlineTabs.characters && selectedCharacterIds.size > 0) {
      const selected = characters.filter(c => selectedCharacterIds.has(c.id))
      if (selected.length > 0) {
        const charDescs = selected.map(c => [c.name, c.role, c.personality].filter(Boolean).join('，')).join('\n')
        parts.push(`【出场角色设定】\n${charDescs}`)
      }
    }
    // Async dimensions
    if (loadedDims) {
      const dims = loadedDims as unknown as Record<string, string>
      if (dims.items) parts.push(dims.items)
      if (dims.locations) parts.push(dims.locations)
      if (dims.factions) parts.push(dims.factions)
      if (dims.powerSystem) parts.push(dims.powerSystem)
      if (dims.emotion) parts.push(dims.emotion)
      if (dims.foreshadowing) parts.push(dims.foreshadowing)
      if (dims.plotThreads) parts.push(dims.plotThreads)
    }
    // Detailed outline fields
    if (detailedOutlineFields.plotOverview && ch.plotOverview) parts.push(`【本章剧情概述】\n${ch.plotOverview}`)
    if (detailedOutlineFields.chapterCharacters && ch.characters) parts.push(`【本章出场角色】\n${ch.characters}`)
    if (detailedOutlineFields.location && ch.location) parts.push(`【场景地点】\n${ch.location}`)
    if (detailedOutlineFields.keyEvents && ch.keyEvents) parts.push(`【关键事件】\n${ch.keyEvents}`)
    if (detailedOutlineFields.eroticContent && ch.eroticContent) parts.push(`【情色剧情要求】\n${ch.eroticContent}`)
    const template = chapterPrompt?.content || '根据以上设定和细纲，写出一章完整的小说正文。'
    parts.push(`【创作要求】\n${template}\n\n字数目标: ${wordTarget}字`)
    return parts.join('\n\n---\n\n')
  }

  const handleStart = async () => {
    if (selectedIds.size === 0 || !genConfigId) return
    const config = configs.find(c => c.id === genConfigId)
    if (!config) return

    const items: QueueItem[] = sortedChapters
      .filter(c => selectedIds.has(c.id))
      .map(c => ({ chapterId: c.id, title: c.title || `第${c.order + 1}章`, order: c.order, status: 'waiting' as QueueStatus, wordCount: 0 }))
    setQueue(items); runningRef.current = true; setRunning(true); setCurrentIdx(0)

    const pp = `${projectsBasePath}/${activeProjectId}`
    const loadedDims = (activeProjectId && projectsBasePath)
      ? await loadOutlineDimensions(pp, outlineTabs)
      : undefined

    // v15.4.0: 知识库注入块预取一次、N 章复用（full 每文件仅读 1 次；chunk 仅 1 次检索）
    const kbBlock = selectedKbFileIds.size > 0
      ? await buildKBBlock([...selectedKbFileIds], {
          mode: kbInjectMode,
          keywords: kbKeywords,
          projectId: activeProjectId || '',
          configId: genConfigId,
          scene: getSceneKb(useSettingsStore.getState().aiSettings.kbSettings, 'chapterGen'),
        })
      : null

    for (let i = 0; i < items.length; i++) {
      if (!runningRef.current) break
      setQueue(prev => prev.map((q, idx) => idx === i ? { ...q, status: 'generating' as QueueStatus } : q))
      setCurrentIdx(i)
      try {
        const ch = sortedChapters.find(c => c.id === items[i].chapterId)
        const chContent = ch ? await fileService.read(`${pp}/chapters/${items[i].chapterId}.txt`).catch(() => '') : ''
        // Auto-summary: before generating, select latest 5 summaries for context
        // v13.x: 局部变量直接传参——setSelectedSummaryIds 异步生效，同闭包内读不到新值
        let autoSummaryIds: Set<string> | undefined
        if (autoSummary) {
          const withSummary = prevChapters.filter(c => chapterSummaryMap[c.id]?.trim())
          const recent5 = withSummary.slice(-5)
          autoSummaryIds = new Set(recent5.map(c => c.id))
          setSelectedSummaryIds(autoSummaryIds)
        }
        const prompt = await buildPromptForChapter(ch || sortedChapters[0], loadedDims, autoSummaryIds, kbBlock)
        const messages = [{ role: 'user' as const, content: prompt }]

        if (streamMode) {
          await new Promise<void>((resolve, reject) => {
            onGenStart()
            const handle = aiService.chatStream(messages, genConfigId, activeProjectId || undefined,
              (data) => {
                const live = replaceMode ? data.accumulated : (chContent ? chContent + '\n\n' + data.accumulated : data.accumulated)
                fileService.write(`${pp}/chapters/${items[i].chapterId}.txt`, live).catch(() => {})
                setQueue(prev => prev.map((q, idx) => idx === i ? { ...q, wordCount: data.accumulated.length } : q))
                onGenChunk({ charCount: data.accumulated.length })
              },
              (data) => {
                const record: VersionRecord = {
                  versionId: '', chapterId: items[i].chapterId, modelConfigId: config.id, modelName: config.model,
                  temperature: config.temperature, promptTitle: chapterPrompt?.title || '批量生成', promptContent: chapterPrompt?.content || '',
                  generatedContent: data.text, tokens: { input: data.usage?.prompt_tokens || 0, output: data.usage?.completion_tokens || 0, total: data.usage?.total_tokens || 0 },
                  cost: data.usage?.cost || 0, generatedAt: new Date().toISOString(), contextUsed: [],
                }
                if (activeProjectId && projectsBasePath) {
                  saveVersionRecord(pp, items[i].chapterId, record).then(() => onVersionSaved(record))
                  const nf = normalizeParagraphs(data.text)
                  const fw = replaceMode ? nf : (chContent ? chContent + '\n\n' + nf : nf)
                  fileService.write(`${pp}/chapters/${items[i].chapterId}.txt`, fw).catch(() => {})
                }
                setQueue(prev => prev.map((q, idx) => idx === i ? { ...q, status: 'done', wordCount: data.text.length } : q))
                setTotalWords(prev => prev + data.text.length)
                // Auto-generate summary for this chapter
                if (autoSummary) {
                  generateSummaryForChapter(items[i].chapterId, data.text, items[i].title).catch(() => {})
                }
                onGenDone(); resolve()
              },
              (err) => { onGenError(err.message); setQueue(prev => prev.map((q, idx) => idx === i ? { ...q, status: 'error', error: err.message } : q)); reject(err) },
              (data) => { onGenError(data.message); setQueue(prev => prev.map((q, idx) => idx === i ? { ...q, status: 'error', error: data.message } : q)); reject(new Error(data.message)) },
            )
            abortRef.current = handle.abort
            if (externalAbortRef) externalAbortRef.current = handle.abort
          })
        } else {
          await new Promise<void>(async (resolve, reject) => {
            try {
              const { text } = await aiService.chatWithUsage(messages, genConfigId, activeProjectId || undefined)
              const nf = normalizeParagraphs(text)
              const fw = replaceMode ? nf : (chContent ? chContent + '\n\n' + nf : nf)
              await fileService.write(`${pp}/chapters/${items[i].chapterId}.txt`, fw).catch(() => {})
              setQueue(prev => prev.map((q, idx) => idx === i ? { ...q, status: 'done', wordCount: text.length } : q))
              setTotalWords(prev => prev + text.length)
              if (autoSummary) {
                generateSummaryForChapter(items[i].chapterId, text, items[i].title).catch(() => {})
              }
              resolve()
            } catch (err) { reject(err) }
          })
        }
      } catch (err) {
        setQueue(prev => prev.map((q, idx) => idx === i ? { ...q, status: 'error', error: err instanceof Error ? err.message : '生成失败' } : q))
      }
    }
    setRunning(false); runningRef.current = false; abortRef.current = null
    if (externalAbortRef) externalAbortRef.current = null
  }

  const handleCancel = () => { abortRef.current?.(); abortRef.current = null; if (externalAbortRef) externalAbortRef.current = null; setRunning(false); runningRef.current = false }
  const doneCount = queue.filter(q => q.status === 'done').length
  const errorCount = queue.filter(q => q.status === 'error').length

  return (
    <>
    <Modal isOpen={isOpen} onClose={running ? () => {} : onClose} title="" width="86vw" maxHeight="100vh" closeOnBackdropClick={false} draggable resizable>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '82vh', minHeight: 600 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 12, background: 'linear-gradient(135deg, #f59e0b, #e67e00)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(245,158,11,0.25)' }}>
              <SparklesIcon style={{ width: 18, height: 18, color: '#fff' }} />
            </div>
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1e1b2e', margin: 0 }}>批量生成章节</h2>
              <p style={{ fontSize: 11, color: '#9b8e84', margin: 0 }}>{running ? `${doneCount}/${queue.length} 完成` : `已选 ${selectedIds.size} 章`}</p>
            </div>
          </div>
          <button onClick={running ? () => {} : onClose} style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid rgba(0,0,0,0.06)', background: '#fff', cursor: 'pointer', color: '#9b8e84', fontSize: 16 }}>×</button>
        </div>

        {running ? (
          <>
            {/* Progress bar */}
            <div style={{ height: 4, borderRadius: 2, background: 'rgba(0,0,0,0.04)', overflow: 'hidden', flexShrink: 0 }}>
              <div style={{ height: '100%', borderRadius: 2, background: 'linear-gradient(90deg, #f59e0b, #e67e00)', width: `${queue.length > 0 ? ((doneCount + errorCount) / queue.length * 100) : 0}%`, transition: 'width 0.3s' }} />
            </div>
            <div style={{ flex: 1, overflow: 'auto' }} className="custom-scrollbar">
              {queue.map((item, i) => (
                <div key={item.chapterId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, background: i === currentIdx ? 'rgba(245,158,11,0.04)' : 'transparent', border: i === currentIdx ? '1px solid rgba(245,158,11,0.12)' : '1px solid transparent', fontSize: 13, color: '#2d2520', marginBottom: 4 }}>
                  {item.status === 'waiting' && <ClockIcon style={{ width: 16, height: 16, color: '#9b8e84' }} />}
                  {item.status === 'generating' && <SparklesIcon style={{ width: 16, height: 16, color: '#e67e00' }} />}
                  {item.status === 'done' && <CheckIcon style={{ width: 16, height: 16, color: '#16a34a' }} />}
                  {item.status === 'error' && <XMarkIcon style={{ width: 16, height: 16, color: '#dc2626' }} />}
                  <span style={{ fontWeight: 600 }}>{item.title}</span>
                  {item.status === 'generating' && <span style={{ color: '#e67e00', fontSize: 12 }}>{item.wordCount.toLocaleString()}字</span>}
                  {item.status === 'done' && <span style={{ color: '#16a34a', fontSize: 12 }}>{item.wordCount.toLocaleString()}字 ✓</span>}
                  {item.status === 'error' && <span style={{ color: '#dc2626', fontSize: 12 }}>{item.error}</span>}
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: '#9b8e84' }}>总 {totalWords.toLocaleString()} 字</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 8, borderTop: '1px solid rgba(0,0,0,0.05)', flexShrink: 0 }}>
              <Button variant="danger" onClick={handleCancel}><XMarkIcon style={{ width: 14, height: 14 }} /> 停止生成</Button>
            </div>
          </>
        ) : (
          <>
            {/* ===== SECTION 1: Chapter selection (only unwritten) ===== */}
            <div style={{ padding: '14px 20px', borderRadius: 14, background: 'rgba(245,158,11,0.03)', border: '1px solid rgba(245,158,11,0.1)', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#e67e00' }}>选择细纲（仅无章节内容） · {selectedIds.size}/{unwrittenChapters.length}</span>
                <button onClick={selectAll} style={miniActionLink}>全选</button>
                <button onClick={clearSelection} style={miniActionLink}>清空</button>
              </div>
              {unwrittenChapters.length === 0 ? (
                <div style={{ fontSize: 12, color: '#9b8e84', padding: 8 }}>所有细纲对应的章节已有内容，无可生成的章节</div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {unwrittenChapters.map(c => (
                    <label key={c.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 12px', borderRadius: 7, fontSize: 12, cursor: 'pointer', background: selectedIds.has(c.id) ? 'rgba(245,158,11,0.08)' : '#f8f7f5', border: selectedIds.has(c.id) ? '1px solid rgba(245,158,11,0.22)' : '1px solid rgba(0,0,0,0.05)', color: selectedIds.has(c.id) ? '#e67e00' : '#6b5e54', fontWeight: selectedIds.has(c.id) ? 600 : 400 }}>
                      <input type="checkbox" checked={selectedIds.has(c.id)} onChange={() => toggleSetId(setSelectedIds, c.id)} style={checkInput} />
                      第{c.order + 1}章 {c.title || '未命名'}
                    </label>
                  ))}
                </div>
              )}
              {/* Written chapters (disabled) */}
              {sortedChapters.filter(c => writtenChapterIds.has(c.id)).length > 0 && (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(0,0,0,0.04)' }}>
                  <span style={{ fontSize: 10, color: '#9b8e84' }}>已有章节内容：</span>
                  <span style={{ fontSize: 10, color: '#c4bdb4' }}>
                    {sortedChapters.filter(c => writtenChapterIds.has(c.id)).map(c => `第${c.order + 1}章`).join('、')}
                  </span>
                </div>
              )}
            </div>

            {/* ===== SECTION 2: Outline + Detailed outline (shared) ===== */}
            <div style={{ padding: '16px 20px', borderRadius: 14, background: 'linear-gradient(135deg, rgba(124,58,237,0.015), rgba(168,85,247,0.02))', border: '1px solid rgba(124,58,237,0.08)', flexShrink: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#7c3aed', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 4, height: 16, borderRadius: 2, background: '#7c3aed' }} />关联大纲和细纲
              </div>
              <div style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#6b5e54' }}>大纲</span>
                  <button onClick={() => setAllOutlineTabs(true)} style={miniActionLink}>全选</button>
                  <button onClick={() => setAllOutlineTabs(false)} style={miniActionLink}>清空</button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {([['plot','故事剧情'],['worldbuilding','世界观'],['characters','角色'],['items','道具'],['locations','地点'],['factions','势力'],['powerSystem','等级'],['foreshadowing','伏笔'],['emotion','情绪'],['plotThreads','故事线']] as [keyof OutlineTabToggles, string][]).map(([k,l]) => (
                    <label key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 12px', borderRadius: 7, fontSize: 12, cursor: 'pointer', background: outlineTabs[k] ? 'rgba(124,58,237,0.08)' : '#f8f7f5', border: outlineTabs[k] ? '1px solid rgba(124,58,237,0.2)' : '1px solid rgba(0,0,0,0.05)', color: outlineTabs[k] ? '#7c3aed' : '#6b5e54', fontWeight: outlineTabs[k] ? 600 : 400 }}>
                      <input type="checkbox" checked={outlineTabs[k]} onChange={() => toggleOutlineTab(k)} style={checkInput} />{l}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#4a3f38' }}>细纲</span>
                  <button onClick={() => setAllDetailedFields(true)} style={miniActionLink}>全选</button>
                  <button onClick={() => setAllDetailedFields(false)} style={miniActionLink}>清空</button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {([['plotOverview','剧情概述'],['chapterCharacters','出场角色'],['location','场景地点'],['keyEvents','关键事件'],['eroticContent','涩涩剧情']] as [keyof DetailedOutlineToggles, string][]).map(([k,l]) => (
                    <label key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 12px', borderRadius: 7, fontSize: 12, cursor: 'pointer', background: detailedOutlineFields[k] ? 'rgba(59,130,246,0.08)' : '#f8f7f5', border: detailedOutlineFields[k] ? '1px solid rgba(59,130,246,0.2)' : '1px solid rgba(0,0,0,0.05)', color: detailedOutlineFields[k] ? '#3b82f6' : '#6b5e54', fontWeight: detailedOutlineFields[k] ? 600 : 400 }}>
                      <input type="checkbox" checked={detailedOutlineFields[k]} onChange={() => toggleDetailedField(k)} style={checkInput} />{l}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {/* ===== SECTION 3: 5 cards — fixed proportions ===== */}
            <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0, overflow: 'hidden' }}>
              {/* Left: 角色库 + 前文摘要 */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
                {/* 角色库 — flex(5) */}
                <div style={{ ...cardStyle, padding: '14px 16px', flex: 5, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  <div style={{ ...cardHeaderStyle, fontSize: 13, flexShrink: 0 }}>角色库 · {selectedCharacterIds.size} 个</div>
                  <div style={{ flexShrink: 0, display: 'flex', gap: 4, marginBottom: 6 }}>
                    <button onClick={() => selectIds(setSelectedCharacterIds, characters.map(c => c.id))} style={{...miniActionLink, fontSize: 12}}>全选</button>
                    <button onClick={() => selectIds(setSelectedCharacterIds, [])} style={{...miniActionLink, fontSize: 12}}>清空</button>
                  </div>
                  <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexWrap: 'wrap', gap: 5, alignContent: 'flex-start' }} className="custom-scrollbar">
                    {characters.length === 0 ? (
                      <span style={{ fontSize: 12, color: '#9b8e84' }}>暂无角色</span>
                    ) : (
                      characters.map(c => (
                        <label key={c.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 12px', borderRadius: 7, fontSize: 13, cursor: 'pointer', background: selectedCharacterIds.has(c.id) ? 'rgba(124,58,237,0.06)' : 'transparent', border: selectedCharacterIds.has(c.id) ? '1px solid rgba(124,58,237,0.18)' : '1px solid rgba(0,0,0,0.05)' }}>
                          <input type="checkbox" checked={selectedCharacterIds.has(c.id)} onChange={() => toggleSetId(setSelectedCharacterIds, c.id)} style={checkInput} />{c.name}
                        </label>
                      ))
                    )}
                  </div>
                </div>
                {/* 前文摘要 — flex(4) */}
                <div style={{ ...cardStyle, padding: '14px 16px', flex: 4, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  <div style={{ ...cardHeaderStyle, fontSize: 13, flexShrink: 0 }}>前文摘要 · {selectedSummaryIds.size}/5</div>
                  <div style={{ flexShrink: 0, display: 'flex', gap: 4, marginBottom: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <button onClick={smartSelectSummaries} style={{...miniActionLink, fontSize: 12}}>最近五章</button>
                    <button onClick={() => setSelectedSummaryIds(new Set())} style={{...miniActionLink, fontSize: 12}}>清空</button>
                    <div style={{ width: 1, height: 14, background: 'rgba(0,0,0,0.1)' }} />
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 12, color: autoSummary ? '#16a34a' : '#6b5e54', fontWeight: autoSummary ? 600 : 400 }}>
                      <input type="checkbox" checked={autoSummary} onChange={() => setAutoSummary(!autoSummary)} style={checkInput} />自动生成摘要
                    </label>
                    {autoSummary && (
                      <select value={selectedSummaryPromptId} onChange={e => setSelectedSummaryPromptId(e.target.value)} style={{ padding: '3px 6px', borderRadius: 5, border: '1px solid rgba(0,0,0,0.1)', fontSize: 11, fontFamily: 'inherit', background: '#faf9f8', cursor: 'pointer' }}>
                        <option value={NONE_ID}>默认模板（200字摘要）</option>
                        {prompts.filter(p => p.type === '摘要').map(p => (
                          <option key={p.id} value={p.id}>{p.title}</option>
                        ))}
                      </select>
                    )}
                  </div>
                  <div className="custom-scrollbar" style={{ flex: 1, overflowY: 'auto' }}>
                    {prevChapters.length === 0 ? (
                      <span style={{ fontSize: 12, color: '#9b8e84' }}>无前序章节</span>
                    ) : (
                      prevChapters.map(c => {
                        const hasSummary = !!chapterSummaryMap[c.id]?.trim()
                        return (
                        <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', cursor: hasSummary ? 'pointer' : 'default', borderRadius: 6, fontSize: 12, color: hasSummary ? '#2d2520' : '#b0a89e' }}>
                          <input type="checkbox" checked={selectedSummaryIds.has(c.id)} onChange={() => toggleSetId(setSelectedSummaryIds, c.id)} disabled={!hasSummary} style={checkInput} />
                          <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>第{c.order + 1}章</span>
                          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</span>
                        </label>
                      )})
                    )}
                  </div>
                </div>
              </div>
              {/* Right: 生成模板 + 风格模板 + 知识库注入 */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
                {/* 生成模板 — flex(2) */}
                <div style={{ ...cardStyle, padding: '14px 16px', flex: 2, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  <div style={{ ...cardHeaderStyle, fontSize: 13, flexShrink: 0 }}>生成模板</div>
                  <select value={selectedChapterPromptId} onChange={e => setSelectedChapterPromptId(e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.08)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', background: '#faf9f8', flexShrink: 0 }}>
                    <option value={NONE_ID}>不使用模板（根据大纲/细纲/角色生成）</option>
                    {chapterPrompts.map(p => (
                      <option key={p.id} value={p.id}>{p.enabled ? '✓ ' : ''}{p.title}</option>
                    ))}
                  </select>
                </div>
                {/* 风格模板 — flex(2) */}
                <div style={{ ...cardStyle, padding: '14px 16px', flex: 2, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  <div style={{ ...cardHeaderStyle, fontSize: 13, flexShrink: 0 }}>风格模板</div>
                  <select value={selectedStyleTemplateId} onChange={e => setSelectedStyleTemplateId(e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.08)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', background: '#faf9f8', flexShrink: 0 }}>
                    <option value="">— 不注入 —</option>
                    {styleTemplates.map((t: any) => <option key={t.id} value={t.id}>{t.name || '未命名'}</option>)}
                  </select>
                </div>
                {/* 知识库注入 — flex(3) */}
                <div style={{ ...cardStyle, padding: '14px 16px', flex: 3, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  <div style={{ ...cardHeaderStyle, fontSize: 13, flexShrink: 0 }}>知识库注入 · {selectedKbFileIds.size} 个</div>
                  {/* v15.4.0: 注入方式（全量/片段）+ 片段关键词——批量 N 章共用一次注入块 */}
                  <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11, color: '#6b5e54', fontWeight: 600 }}>注入方式:</span>
                    <button onClick={() => setKbInjectMode('full')} title="勾选文件全文截断注入（上限取知识库设置）"
                      style={{ padding: '3px 8px', borderRadius: 6, fontSize: 11, fontFamily: 'inherit', cursor: 'pointer',
                        border: kbInjectMode === 'full' ? '1px solid rgba(124,58,237,0.35)' : '1px solid rgba(0,0,0,0.1)',
                        background: kbInjectMode === 'full' ? 'rgba(124,58,237,0.08)' : '#fff', color: kbInjectMode === 'full' ? '#7c3aed' : '#6b5e54', fontWeight: kbInjectMode === 'full' ? 600 : 400 }}>全量注入</button>
                    <button onClick={() => setKbInjectMode('chunk')} title="按关键词向量化检索相关片段注入（topK 取知识库设置）"
                      style={{ padding: '3px 8px', borderRadius: 6, fontSize: 11, fontFamily: 'inherit', cursor: 'pointer',
                        border: kbInjectMode === 'chunk' ? '1px solid rgba(124,58,237,0.35)' : '1px solid rgba(0,0,0,0.1)',
                        background: kbInjectMode === 'chunk' ? 'rgba(124,58,237,0.08)' : '#fff', color: kbInjectMode === 'chunk' ? '#7c3aed' : '#6b5e54', fontWeight: kbInjectMode === 'chunk' ? 600 : 400 }}>片段注入</button>
                  </div>
                  {/* v15.4.0: 模式对比提示——帮助选择注入方式 */}
                  <div style={{ flexShrink: 0, fontSize: 10, color: '#9b8e84', marginBottom: 4, lineHeight: 1.5 }}>
                    全量：适合整体参考（世界观全貌、人物卡）——文件大时按上限截断，末尾可能丢失；
                    片段：适合按主题精准参考（如本章要写战斗、衣服、某角色）——关键词向量化定位，省 token 且不丢关键段落
                  </div>
                  {kbInjectMode === 'chunk' && (
                    <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <input value={kbKeywords} onChange={e => setKbKeywords(e.target.value)}
                        placeholder="片段关键词：如 剑术, 宗门, 炼丹（逗号/顿号分隔）"
                        style={{ flex: 1, padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.1)', fontSize: 11, fontFamily: 'inherit', outline: 'none' }} />
                    </div>
                  )}
                  <div style={{ flexShrink: 0, display: 'flex', gap: 4, marginBottom: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                    <button onClick={async () => { await loadKBFiles(); if (kbFiles.length > 0) setSelectedKbFileIds(new Set(kbFiles.map(f => f.id))) }} style={{...miniActionLink, fontSize: 12}}>全选</button>
                    <button onClick={() => setSelectedKbFileIds(new Set())} style={{...miniActionLink, fontSize: 12}}>清空</button>
                    <button onClick={loadKBFiles} style={{ ...miniActionLink, fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 2 }}><BookOpenIcon style={{ width: 12, height: 12 }} />{kbLoaded ? `已加载 ${kbFiles.length}` : '加载'}</button>
                    {selectedKbFileIds.size > 0 && (
                      <button onClick={() => setKbDeleteConfirm({ type: 'batch', ids: [...selectedKbFileIds], count: selectedKbFileIds.size })} style={{ ...miniActionLink, fontSize: 12, color: '#dc2626' }}>🗑 删除选中</button>
                    )}
                  </div>
                  {kbInjectMode === 'chunk' && (
                    <div style={{ flexShrink: 0, fontSize: 10, color: '#9b8e84', marginBottom: 4, lineHeight: 1.5 }}>
                      💡 片段模式未填关键词时自动退回全量注入；检索不到相关片段时不注入任何内容。
                    </div>
                  )}
                  {kbLoaded && kbFiles.length > 0 ? (
                    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexWrap: 'wrap', gap: 4, alignContent: 'flex-start' }} className="custom-scrollbar">
                      {kbFiles.map(f => (
                        <div key={f.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                          <label style={{
                            display: 'inline-flex', alignItems: 'center', gap: 3, padding: '3px 8px 3px 10px', borderRadius: '6px 0 0 6px', fontSize: 12, cursor: 'pointer',
                            background: selectedKbFileIds.has(f.id) ? 'rgba(124,58,237,0.06)' : '#fff',
                            border: selectedKbFileIds.has(f.id) ? '1px solid rgba(124,58,237,0.18)' : '1px solid rgba(0,0,0,0.05)',
                            borderRight: 'none',
                          }}>
                            <input type="checkbox" checked={selectedKbFileIds.has(f.id)} onChange={() => toggleSetId(setSelectedKbFileIds, f.id)} style={checkInput} />{f.originalName.slice(0, 20)}
                          </label>
                          <button onClick={e => {
                            e.stopPropagation()
                            setKbDeleteConfirm({ type: 'single', id: f.id, name: f.originalName })
                          }} title="删除此文件" style={{
                            padding: '3px 8px', borderRadius: '0 6px 6px 0', border: '1px solid rgba(0,0,0,0.05)', borderLeft: 'none',
                            background: '#fff', cursor: 'pointer', fontSize: 11, color: '#9b8e84', display: 'flex', alignItems: 'center',
                          }}>×</button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#9b8e84' }}>
                      {kbLoaded ? '知识库暂无文件' : '点击"加载"按钮'}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ===== SECTION 4: Output settings ===== */}
            <div style={{ padding: '14px 20px', borderRadius: 14, background: 'rgba(0,0,0,0.01)', border: '1px solid rgba(0,0,0,0.06)', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#6b5e54' }}>目标字数</span>
                  <input type="number" step={100} value={wordTarget} onChange={e => setWordTarget(parseInt(e.target.value) || 0)} onBlur={e => { const v = parseInt(e.target.value); if (v < 500 || v > 50000) setWordTarget(4000) }} style={{ width: 80, padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', fontSize: 13, fontFamily: 'inherit', textAlign: 'center' }} />
                  <span style={{ fontSize: 11, color: '#9b8e84' }}>字/章</span>
                </div>
                <div style={{ width: 1, height: 24, background: 'rgba(0,0,0,0.08)' }} />
                <label title="逐字实时输出生成内容到编辑器，可随时停止" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}><input type="checkbox" checked={streamMode} onChange={() => setStreamMode(!streamMode)} style={checkInput} /> 流式生成</label>
                <label title="勾选：AI生成内容替换当前章节原文；不勾选：追加在原文后面" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}><input type="checkbox" checked={replaceMode} onChange={() => setReplaceMode(!replaceMode)} style={checkInput} /> 替换正文</label>
                <div style={{ width: 1, height: 24, background: 'rgba(0,0,0,0.08)' }} />
                <select value={genConfigId} onChange={e => setGenConfigId(e.target.value)} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', fontSize: 12, fontFamily: 'inherit', background: '#faf9f8', cursor: 'pointer' }}>
                  {configs.map(c => <option key={c.id} value={c.id}>{c.name} ({c.model})</option>)}
                </select>
                <div style={{ width: 1, height: 24, background: 'rgba(0,0,0,0.08)' }} />
                {/* Temperature — draggable gradient slider */}
                {(() => {
                  const curTemp = configs.find(c => c.id === genConfigId)?.temperature ?? 0.8
                  const pct = Math.round((curTemp / 2) * 100)
                  const tempColor = curTemp <= 0.5 ? '#3b82f6' : curTemp <= 1.0 ? '#7c3aed' : curTemp <= 1.5 ? '#f59e0b' : '#ef4444'
                  const tempLabel = curTemp <= 0.5 ? '精确' : curTemp <= 1.0 ? '均衡' : curTemp <= 1.5 ? '创意' : '狂想'
                  const saveTemp = async (newTemp: number) => {
                    const config = configs.find(c => c.id === genConfigId); if (!config) return
                    useSettingsStore.getState().updateConfig(config.id, { temperature: +newTemp.toFixed(1) })
                    await settingsService.saveConfigs(useSettingsStore.getState().configs)
                  }
                  const handleSliderDown = (e: React.MouseEvent) => {
                    const bar = e.currentTarget as HTMLElement
                    const rect = bar.getBoundingClientRect()
                    const updateFromMouse = (clientX: number) => {
                      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
                      saveTemp(Math.round(ratio * 20) / 10)
                    }
                    updateFromMouse(e.clientX)
                    const onMove = (ev: MouseEvent) => updateFromMouse(ev.clientX)
                    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
                    window.addEventListener('mousemove', onMove)
                    window.addEventListener('mouseup', onUp)
                  }
                  return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 200 }}>
                      <span title="控制AI输出随机性：0=精准确定，2=最大创意" style={{ fontSize: 12, fontWeight: 600, color: '#6b5e54', whiteSpace: 'nowrap', cursor: 'help' }}>温度</span>
                      <button onClick={() => saveTemp(Math.max(0, curTemp - 0.1))}
                        style={{ width: 22, height: 22, borderRadius: '50%', border: '1px solid rgba(0,0,0,0.1)', background: '#fff', cursor: 'pointer', fontSize: 14, color: '#6b5e54', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit', lineHeight: 1 }}>−</button>
                      <div onMouseDown={handleSliderDown}
                        style={{ flex: 1, height: 20, borderRadius: 4, background: 'linear-gradient(90deg, #3b82f6 0%, #7c3aed 33%, #f59e0b 66%, #ef4444 100%)', position: 'relative', cursor: 'ew-resize', maxWidth: 120 }}>
                        <div style={{ position: 'absolute', left: 4, right: 4, top: '50%', transform: 'translateY(-50%)', height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.35)' }} />
                        <div style={{ position: 'absolute', left: `calc(${pct}% - 8px)`, top: 2, width: 16, height: 16, borderRadius: '50%', background: tempColor, border: '2px solid #fff', boxShadow: '0 1px 6px rgba(0,0,0,0.3)', transition: 'left 0.15s', pointerEvents: 'none' }} />
                      </div>
                      <button onClick={() => saveTemp(Math.min(2, curTemp + 0.1))}
                        style={{ width: 22, height: 22, borderRadius: '50%', border: '1px solid rgba(0,0,0,0.1)', background: '#fff', cursor: 'pointer', fontSize: 14, color: '#6b5e54', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit', lineHeight: 1 }}>+</button>
                      <span style={{ fontSize: 13, fontWeight: 700, color: tempColor, minWidth: 36, textAlign: 'center' }}>{curTemp.toFixed(1)}°C</span>
                      <span style={{ fontSize: 10, fontWeight: 600, color: tempColor, background: `${tempColor}14`, padding: '1px 6px', borderRadius: 4 }}>{tempLabel}</span>
                    </div>
                  )
                })()}
              </div>
            </div>

            {/* Footer */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 8, borderTop: '1px solid rgba(0,0,0,0.05)', flexShrink: 0 }}>
              <button onClick={doneCount > 0 ? onClose : onClose} style={{ padding: '10px 28px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.08)', background: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 600, color: '#6b5e54', fontFamily: 'inherit' }}>{doneCount > 0 ? '完成' : '取消'}</button>
              <button onClick={handleStart} disabled={selectedIds.size === 0 || !genConfigId} style={{ padding: '10px 34px', borderRadius: 10, border: 'none', background: selectedIds.size === 0 || !genConfigId ? 'linear-gradient(135deg, #e0c8a0, #d4b894)' : 'linear-gradient(135deg, #f59e0b, #e67e00)', cursor: selectedIds.size === 0 || !genConfigId ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 700, color: '#fff', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6, boxShadow: '0 4px 14px rgba(245,158,11,0.3)' }}>
                <SparklesIcon style={{ width: 16, height: 16 }} />开始生成 {selectedIds.size} 章
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
    <ConfirmModal
      isOpen={kbDeleteConfirm !== null}
      title="删除知识库文件"
      message={kbDeleteConfirm?.type === 'batch'
        ? `确定从知识库删除选中的 ${(kbDeleteConfirm as any).count} 个文件？此操作不可撤销。`
        : `确定从知识库删除「${(kbDeleteConfirm as any)?.name || ''}」？`}
      confirmLabel="删除"
      danger
      onConfirm={() => {
        if (!kbDeleteConfirm) return
        if (kbDeleteConfirm.type === 'batch') {
          Promise.all(kbDeleteConfirm.ids.map(id => kbService.delete(id).catch(() => {}))).then(() => {
            setSelectedKbFileIds(new Set())
            setKbLoaded(false)
          })
        } else {
          kbService.delete(kbDeleteConfirm.id).then(() => {
            setSelectedKbFileIds(prev => { const n = new Set(prev); n.delete(kbDeleteConfirm.id); return n })
            setKbLoaded(false)
          }).catch(() => {})
        }
        setKbDeleteConfirm(null)
      }}
      onCancel={() => setKbDeleteConfirm(null)}
    />
    </>
  )
}
