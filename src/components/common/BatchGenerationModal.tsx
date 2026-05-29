import { useState, useRef, useEffect } from 'react'
import { useStore, useSettingsStore } from '@/store'
import { aiService, fileService } from '@/services/fileService'
import { getStyleInjection } from '@/utils/styleInjector'
import { loadOutlineDimensions } from '@/utils/outlineData'
import type { OutlineTabToggles, DetailedOutlineToggles } from '@/types/settings'
import type { DetailedChapter } from '@/types/chapter'
import type { Character } from '@/types/character'
import type { VersionRecord } from './ChapterGenerationModal'
import { saveVersionRecord } from './ChapterGenerationModal'
import Modal from './Modal'
import Button from './Button'
import { SparklesIcon, XMarkIcon, CheckIcon, ClockIcon } from '@heroicons/react/24/outline'
import { logError } from '@/utils/logger'
import { normalizeParagraphs } from './ChapterGenerationModal/promptBuilder'

interface Props {
  isOpen: boolean
  onClose: () => void
  chapters: DetailedChapter[]
  worldbuildingContent: string
  characters: Character[]
  outlineContent: string
  onVersionSaved: (v: VersionRecord) => void
  onGenStart: () => void
  onGenChunk: (data: { charCount: number }) => void
  onGenDone: () => void
  onGenError: (msg: string) => void
  externalAbortRef?: React.MutableRefObject<(() => void) | null>
}

type QueueStatus = 'waiting' | 'generating' | 'done' | 'error'

interface QueueItem {
  chapterId: string
  title: string
  order: number
  status: QueueStatus
  wordCount: number
  error?: string
}

export default function BatchGenerationModal({
  isOpen, onClose, chapters, worldbuildingContent, characters, outlineContent,
  onVersionSaved, onGenStart, onGenChunk, onGenDone, onGenError, externalAbortRef,
}: Props) {
  const activeProjectId = useStore(s => s.activeProjectId)
  const projectsBasePath = useStore(s => s.projectsBasePath)
  const configs = useSettingsStore(s => s.configs)
  const activeConfigId = useSettingsStore(s => s.activeConfigId)
  const prompts = useSettingsStore(s => s.prompts)

  const sortedChapters = [...chapters].sort((a, b) => a.order - b.order)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(sortedChapters.map(c => c.id)))

  // Config (simplified — defaults from persisted settings)
  const cg = useSettingsStore(s => s.aiSettings.chapterGen)
  const [genConfigId, setGenConfigId] = useState(activeConfigId || '')
  const [wordTarget, setWordTarget] = useState(cg.wordTarget)
  const [streamMode, setStreamMode] = useState(cg.streamMode)
  const [replaceMode, setReplaceMode] = useState(cg.replaceMode)
  const [outlineTabs, setOutlineTabs] = useState<OutlineTabToggles>(cg.outlineTabs)
  const [detailedOutlineFields, setDetailedOutlineFields] = useState<DetailedOutlineToggles>(cg.detailedOutlineFields)

  const toggleOutlineTab = (key: keyof OutlineTabToggles) =>
    setOutlineTabs(prev => ({ ...prev, [key]: !prev[key] }))
  const toggleDetailedField = (key: keyof DetailedOutlineToggles) =>
    setDetailedOutlineFields(prev => ({ ...prev, [key]: !prev[key] }))

  // Queue
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [running, setRunning] = useState(false)
  const [currentIdx, setCurrentIdx] = useState(-1)
  const [totalWords, setTotalWords] = useState(0)
  const abortRef = useRef<(() => void) | null>(null)
  const queueRef = useRef<QueueItem[]>([])
  const idxRef = useRef(0)
  const runningRef = useRef(false)

  // Reset on open
  useEffect(() => {
    if (isOpen) {
      setSelectedIds(new Set(sortedChapters.map(c => c.id)))
      setQueue([]); setRunning(false); setCurrentIdx(-1); setTotalWords(0)
    }
  }, [isOpen])

  const toggleId = (id: string) => {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  const chapterPrompt = prompts.find(p => p.type === '章节' && p.enabled)

  const buildPromptForChapter = async (ch: DetailedChapter, loadedDims?: { items: string; locations: string; factions: string; powerSystem: string; emotion: string; foreshadowing: string; plotThreads: string }) => {
    const parts: string[] = []
    // Style injection
    const storeActiveProjectId = useStore.getState().activeProjectId
    if (storeActiveProjectId) {
      const assignments = useSettingsStore.getState().aiSettings.styleAssignments || {}
      const styleInjection = await getStyleInjection(storeActiveProjectId, assignments)
      if (styleInjection) parts.push(styleInjection)
    }
    // Outline tab dimensions
    if (outlineTabs.plot && outlineContent) parts.push(`【故事剧情】\n${outlineContent.slice(0, 15000)}`)
    if (outlineTabs.worldbuilding && worldbuildingContent) parts.push(`【世界观设定】\n${worldbuildingContent.slice(0, 30000)}`)
    if (outlineTabs.characters && characters.length > 0) {
      const charDescs = characters.map(c => [c.name, c.role, c.personality].filter(Boolean).join('，')).join('\n')
      parts.push(`【角色列表】\n${charDescs}`)
    }
    // Async dimensions
    if (loadedDims) {
      if (loadedDims.items) parts.push(loadedDims.items)
      if (loadedDims.locations) parts.push(loadedDims.locations)
      if (loadedDims.factions) parts.push(loadedDims.factions)
      if (loadedDims.powerSystem) parts.push(loadedDims.powerSystem)
      if (loadedDims.emotion) parts.push(loadedDims.emotion)
      if (loadedDims.foreshadowing) parts.push(loadedDims.foreshadowing)
      if (loadedDims.plotThreads) parts.push(loadedDims.plotThreads)
    }
    // Detailed outline fields
    if (detailedOutlineFields.plotOverview && ch.plotOverview) parts.push(`【本章剧情概述】\n${ch.plotOverview}`)
    if (detailedOutlineFields.chapterCharacters && ch.characters) parts.push(`【本章出场角色列表】\n${ch.characters}`)
    if (detailedOutlineFields.location && ch.location) parts.push(`【场景地点】\n${ch.location}`)
    if (detailedOutlineFields.keyEvents && ch.keyEvents) parts.push(`【关键事件】\n${ch.keyEvents}`)
    if (detailedOutlineFields.eroticContent && ch.eroticContent) parts.push(`【情色剧情要求】\n${ch.eroticContent}`)
    const template = chapterPrompt?.content || '根据以上设定和细纲，写出一章完整的小说正文。'
    parts.push(`【创作要求】\n${template}\n\n字数目标: ${wordTarget}字`)
    return parts.join('\n\n---\n\n')
  }

  const handleStart = async () => {
    const config = configs.find(c => c.id === genConfigId)
    if (!config) return
    if (selectedIds.size === 0) return

    const items: QueueItem[] = sortedChapters
      .filter(c => selectedIds.has(c.id))
      .map(c => ({ chapterId: c.id, title: c.title || `第${c.order + 1}章`, order: c.order, status: 'waiting' as QueueStatus, wordCount: 0 }))

    setQueue(items)
    queueRef.current = items
    idxRef.current = 0
    setRunning(true)
    runningRef.current = true
    setCurrentIdx(0)

    // Load async outline dimensions once for all chapters
    const loadedDims = activeProjectId && projectsBasePath
      ? await loadOutlineDimensions(`${projectsBasePath}/${activeProjectId}`, outlineTabs)
      : undefined

    let successCount = 0
    let errorCount = 0

    // Sequential processing
    for (let i = 0; i < items.length; i++) {
      if (!runningRef.current) break // cancelled
      const item = items[i]
      updateQueueItem(i, { status: 'generating' })
      setCurrentIdx(i)

      try {
        const ch = sortedChapters.find(c => c.id === item.chapterId)
        const chContent = ch ? await fileService.read(`${projectsBasePath}/${activeProjectId}/chapters/${item.chapterId}.txt`).catch(() => '') : ''

        const prompt = await buildPromptForChapter(ch || sortedChapters[0], loadedDims)
        const messages = [{ role: 'user' as const, content: prompt }]

        if (streamMode) {
          await new Promise<void>((resolve, reject) => {
            onGenStart()
            const handle = aiService.chatStream(
              messages, genConfigId, activeProjectId || undefined,
              (data) => {
                const liveContent = replaceMode ? data.accumulated : (chContent ? chContent + '\n\n' + data.accumulated : data.accumulated)
                fileService.write(`${projectsBasePath}/${activeProjectId}/chapters/${item.chapterId}.txt`, liveContent).catch(() => {})
                updateQueueItem(i, { wordCount: data.accumulated.length })
                onGenChunk({ charCount: data.accumulated.length })
              },
              (data) => {
                const versionRecord: VersionRecord = {
                  versionId: '', chapterId: item.chapterId, modelConfigId: config.id, modelName: config.model,
                  temperature: config.temperature, promptTitle: chapterPrompt?.title || '批量生成',
                  promptContent: chapterPrompt?.content || '', generatedContent: data.text,
                  tokens: { input: data.usage?.prompt_tokens || 0, output: data.usage?.completion_tokens || 0, total: data.usage?.total_tokens || 0 },
                  cost: data.usage?.cost || 0, generatedAt: new Date().toISOString(),
                  contextUsed: [
                    outlineTabs.plot ? 'outline_plot' : '', outlineTabs.worldbuilding ? 'outline_worldbuilding' : '',
                    outlineTabs.characters ? 'outline_characters' : '',
                    outlineTabs.items ? 'outline_items' : '', outlineTabs.locations ? 'outline_locations' : '',
                    outlineTabs.factions ? 'outline_factions' : '', outlineTabs.powerSystem ? 'outline_powerSystem' : '',
                    outlineTabs.foreshadowing ? 'outline_foreshadowing' : '', outlineTabs.emotion ? 'outline_emotion' : '',
                    outlineTabs.plotThreads ? 'outline_plotThreads' : '',
                    detailedOutlineFields.plotOverview ? 'detail_plotOverview' : '',
                    detailedOutlineFields.chapterCharacters ? 'detail_characters' : '',
                    detailedOutlineFields.location ? 'detail_location' : '',
                    detailedOutlineFields.keyEvents ? 'detail_keyEvents' : '',
                    detailedOutlineFields.eroticContent ? 'detail_eroticContent' : '',
                  ].filter(Boolean),
                }
                if (activeProjectId && projectsBasePath) {
                  saveVersionRecord(`${projectsBasePath}/${activeProjectId}`, item.chapterId, versionRecord).then(() => onVersionSaved(versionRecord))
                  // Write normalized final content (streaming chunks may lack proper paragraph breaks)
                  const normalizedFinal = normalizeParagraphs(data.text)
                  const finalWriteContent = replaceMode ? normalizedFinal : (chContent ? chContent + '\n\n' + normalizedFinal : normalizedFinal)
                  fileService.write(`${projectsBasePath}/${activeProjectId}/chapters/${item.chapterId}.txt`, finalWriteContent).catch(() => {})
                }
                updateQueueItem(i, { status: 'done', wordCount: data.text.length })
                setTotalWords(prev => prev + data.text.length)
                successCount++
                onGenDone()
                resolve()
              },
              (err) => { onGenError(err.message); updateQueueItem(i, { status: 'error', error: err.message }); reject(err) },
              (data) => { onGenError(data.message); updateQueueItem(i, { status: 'error', error: data.message }); reject(new Error(data.message)) },
            )
            abortRef.current = handle.abort
            if (externalAbortRef) externalAbortRef.current = handle.abort
          })
        } else {
          await new Promise<void>(async (resolve, reject) => {
            try {
              const { text: reply } = await aiService.chatWithUsage(messages, genConfigId, activeProjectId || undefined)
              const normalized = normalizeParagraphs(reply)
              const finalContent = replaceMode ? normalized : (chContent ? chContent + '\n\n' + normalized : normalized)
              await fileService.write(`${projectsBasePath}/${activeProjectId}/chapters/${item.chapterId}.txt`, finalContent).catch(() => {})
              updateQueueItem(i, { status: 'done', wordCount: reply.length })
              setTotalWords(prev => prev + reply.length)
              resolve()
            } catch (err) { reject(err) }
          })
        }
      } catch (err) {
        updateQueueItem(i, { status: 'error', error: err instanceof Error ? err.message : '生成失败' })
        errorCount++
      }
    }

    setRunning(false)
    runningRef.current = false
    abortRef.current = null
    if (externalAbortRef) externalAbortRef.current = null
    // Show summary
    if (errorCount > 0) {
      alert(`批量生成完成: ${successCount}章成功, ${errorCount}章失败。请检查下方红色标记的章节，可重新选择后再次生成。`)
    }
  }

  const updateQueueItem = (idx: number, updates: Partial<QueueItem>) => {
    setQueue(prev => prev.map((q, i) => i === idx ? { ...q, ...updates } : q))
  }

  const handleCancel = () => {
    abortRef.current?.()
    abortRef.current = null
    if (externalAbortRef) externalAbortRef.current = null
    setRunning(false)
    runningRef.current = false
  }

  const doneCount = queue.filter(q => q.status === 'done').length
  const errorCount = queue.filter(q => q.status === 'error').length

  return (
    <Modal isOpen={isOpen} onClose={running ? () => {} : onClose} title={running ? '批量生成中...' : '批量生成章节'} width={600} draggable>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {!running ? (
          <>
            {/* Step 1: Chapter selection */}
            <div style={{ fontSize: 12, fontWeight: 600, color: '#6b5e54' }}>选择要生成的章节 ({selectedIds.size}/{sortedChapters.length})</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setSelectedIds(new Set(sortedChapters.map(c => c.id)))} style={linkBtn}>全选</button>
              <button onClick={() => setSelectedIds(new Set())} style={linkBtn}>清空</button>
            </div>
            <div className="custom-scrollbar" style={{ maxHeight: 200, overflowY: 'auto' }}>
              {sortedChapters.map(c => (
                <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', cursor: 'pointer', borderRadius: 6, fontSize: 12, color: '#2d2520' }}>
                  <input type="checkbox" checked={selectedIds.has(c.id)} onChange={() => toggleId(c.id)} style={{ width: 15, height: 15, accentColor: '#7c3aed' }} />
                  第{c.order + 1}章 {c.title || '未命名'}
                  <span style={{ fontSize: 10, color: '#9b8e84' }}>{c.status}</span>
                </label>
              ))}
            </div>

            {/* Config — two-column dimension toggles */}
            <div style={{ padding: '8px 0', borderTop: '1px solid #f0ece8' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', marginBottom: 6 }}>关联大纲和细纲</div>
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, color: '#9b8e84', marginBottom: 3 }}>大纲维度</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                    {([
                      ['plot', '故事剧情'], ['worldbuilding', '世界观'], ['characters', '角色'],
                      ['items', '道具'], ['locations', '地点'], ['factions', '势力'],
                      ['powerSystem', '等级'], ['foreshadowing', '伏笔'], ['emotion', '情绪'],
                      ['plotThreads', '故事线'],
                    ] as [keyof OutlineTabToggles, string][]).map(([key, label]) => (
                      <label key={key} style={{ fontSize: 10, display: 'flex', alignItems: 'center', gap: 2, padding: '1px 5px', borderRadius: 4,
                        background: outlineTabs[key] ? 'rgba(124,58,237,0.06)' : '#fff',
                        border: outlineTabs[key] ? '1px solid rgba(124,58,237,0.15)' : '1px solid rgba(0,0,0,0.06)', cursor: 'pointer',
                      }}>
                        <input type="checkbox" checked={outlineTabs[key]} onChange={() => toggleOutlineTab(key)} style={{ width: 12, height: 12 }} />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, color: '#9b8e84', marginBottom: 3 }}>细纲维度</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                    {([
                      ['plotOverview', '剧情概述'], ['chapterCharacters', '出场角色'],
                      ['location', '场景地点'], ['keyEvents', '关键事件'],
                      ['eroticContent', '情色剧情'],
                    ] as [keyof DetailedOutlineToggles, string][]).map(([key, label]) => (
                      <label key={key} style={{ fontSize: 10, display: 'flex', alignItems: 'center', gap: 2, padding: '1px 5px', borderRadius: 4,
                        background: detailedOutlineFields[key] ? 'rgba(59,130,246,0.06)' : '#fff',
                        border: detailedOutlineFields[key] ? '1px solid rgba(59,130,246,0.15)' : '1px solid rgba(0,0,0,0.06)', cursor: 'pointer',
                      }}>
                        <input type="checkbox" checked={detailedOutlineFields[key]} onChange={() => toggleDetailedField(key)} style={{ width: 12, height: 12 }} />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8 }}>
                <input type="number" step={100} value={wordTarget} onChange={e => setWordTarget(parseInt(e.target.value) || 0)} onBlur={e => { const v = parseInt(e.target.value); if (v < 500 || v > 50000) setWordTarget(4000) }} style={{ width: 80, padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.1)', fontSize: 11 }} />
                <span style={{ fontSize: 10, color: '#9b8e84' }}>字/章</span>
                <select value={genConfigId} onChange={e => setGenConfigId(e.target.value)} style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.1)', fontSize: 11 }}>
                  {configs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Progress */}
            <div style={{ fontSize: 12, color: '#6b5e54' }}>
              进度: {doneCount}/{queue.length} 完成
              {errorCount > 0 && <span style={{ color: '#dc2626', marginLeft: 8 }}>{errorCount} 失败</span>}
              <span style={{ marginLeft: 8 }}>总字数: {totalWords.toLocaleString()}</span>
            </div>
            <div style={{ height: 4, borderRadius: 2, background: 'rgba(0,0,0,0.04)', overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: 2, background: '#7c3aed', width: `${queue.length > 0 ? ((doneCount + errorCount) / queue.length * 100) : 0}%`, transition: 'width 0.3s' }} />
            </div>

            {/* Queue items */}
            <div className="custom-scrollbar" style={{ maxHeight: 260, overflowY: 'auto' }}>
              {queue.map((item, i) => (
                <div key={item.chapterId} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                  borderRadius: 8, background: i === currentIdx && item.status === 'generating' ? 'rgba(124,58,237,0.04)' : 'transparent',
                  border: i === currentIdx && item.status === 'generating' ? '1px solid rgba(124,58,237,0.1)' : '1px solid transparent',
                  fontSize: 12, color: '#2d2520',
                }}>
                  {item.status === 'waiting' && <ClockIcon style={{ width: 14, height: 14, color: '#9b8e84' }} />}
                  {item.status === 'generating' && <SparklesIcon style={{ width: 14, height: 14, color: '#7c3aed' }} />}
                  {item.status === 'done' && <CheckIcon style={{ width: 14, height: 14, color: '#16a34a' }} />}
                  {item.status === 'error' && <XMarkIcon style={{ width: 14, height: 14, color: '#dc2626' }} />}
                  <span style={{ fontWeight: 600 }}>{item.title}</span>
                  {item.status === 'generating' && <span style={{ color: '#7c3aed', fontSize: 11 }}>{item.wordCount.toLocaleString()}字</span>}
                  {item.status === 'done' && <span style={{ color: '#16a34a', fontSize: 11 }}>{item.wordCount.toLocaleString()}字 ✓</span>}
                  {item.status === 'error' && <span style={{ color: '#dc2626', fontSize: 11 }}>{item.error}</span>}
                  {item.status === 'waiting' && <span style={{ color: '#9b8e84', fontSize: 11 }}>等待中</span>}
                </div>
              ))}
            </div>
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8, borderTop: '1px solid #f0ece8' }}>
          {running ? (
            <Button variant="danger" onClick={handleCancel}><XMarkIcon style={{ width: 14, height: 14 }} /> 停止生成</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={onClose}>{doneCount > 0 ? '完成' : '取消'}</Button>
              <Button onClick={handleStart} disabled={selectedIds.size === 0 || !genConfigId} icon={<SparklesIcon style={{ width: 16, height: 16 }} />}>
                开始生成 {selectedIds.size} 章
              </Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}

const linkBtn: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#7c3aed', padding: 0, fontFamily: 'inherit',
}
