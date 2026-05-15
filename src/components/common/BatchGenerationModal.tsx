import { useState, useRef, useEffect } from 'react'
import { useStore, useSettingsStore } from '@/store'
import { aiService, kbService, fileService } from '@/services/fileService'
import { getStyleInjection } from '@/utils/styleInjector'
import type { DetailedChapter } from '@/types/chapter'
import type { Character } from '@/types/character'
import type { VersionRecord } from './ChapterGenerationModal'
import { saveVersionRecord } from './ChapterGenerationModal'
import Modal from './Modal'
import Button from './Button'
import ScrollArea from './ScrollArea'
import { SparklesIcon, XMarkIcon, CheckIcon, ClockIcon } from '@heroicons/react/24/outline'
import { logError } from '@/utils/logger'

interface Props {
  isOpen: boolean
  onClose: () => void
  chapters: DetailedChapter[]
  worldbuildingContent: string
  characters: Character[]
  outlineContent: string
  currentChapterId: string
  onVersionSaved: (v: VersionRecord) => void
  genOverlay: boolean
  onGenStart: () => void
  onGenChunk: (data: { charCount: number }) => void
  onGenDone: () => void
  onGenError: (msg: string) => void
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
  onVersionSaved, onGenStart, onGenChunk, onGenDone, onGenError,
}: Props) {
  const activeProjectId = useStore(s => s.activeProjectId)
  const projectsBasePath = useStore(s => s.projectsBasePath)
  const configs = useSettingsStore(s => s.configs)
  const activeConfigId = useSettingsStore(s => s.activeConfigId)
  const prompts = useSettingsStore(s => s.prompts)

  const sortedChapters = [...chapters].sort((a, b) => a.order - b.order)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(sortedChapters.map(c => c.id)))

  // Config (simplified A-G)
  const [genConfigId, setGenConfigId] = useState(activeConfigId || '')
  const [wordTarget, setWordTarget] = useState(2000)
  const [streamMode, setStreamMode] = useState(true)
  const [replaceMode, setReplaceMode] = useState(true)
  const [useWorldbuilding, setUseWorldbuilding] = useState(true)
  const [useCharacters, setUseCharacters] = useState(true)
  const [useOutline, setUseOutline] = useState(true)
  const [useDetailedOutline, setUseDetailedOutline] = useState(true)

  // Queue
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [running, setRunning] = useState(false)
  const [currentIdx, setCurrentIdx] = useState(-1)
  const [totalWords, setTotalWords] = useState(0)
  const abortRef = useRef<(() => void) | null>(null)
  const queueRef = useRef<QueueItem[]>([])
  const idxRef = useRef(0)

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

  const buildPromptForChapter = async (ch: DetailedChapter) => {
    const parts: string[] = []
    // Style injection
    const storeActiveProjectId = useStore.getState().activeProjectId
    if (storeActiveProjectId) {
      const assignments = useSettingsStore.getState().aiSettings.styleAssignments || {}
      const styleInjection = await getStyleInjection(storeActiveProjectId, assignments)
      if (styleInjection) parts.push(styleInjection)
    }
    if (useWorldbuilding && worldbuildingContent) parts.push(`【世界观设定】\n${worldbuildingContent.slice(0, 3000)}`)
    if (useOutline && outlineContent) parts.push(`【小说大纲】\n${outlineContent.slice(0, 2000)}`)
    if (useDetailedOutline && ch.description) parts.push(`【本章细纲】\n${ch.description}`)
    if (useCharacters && characters.length > 0) {
      const charDescs = characters.map(c => [c.name, c.role, c.personality].filter(Boolean).join('，')).join('\n')
      parts.push(`【角色列表】\n${charDescs}`)
    }
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
    setCurrentIdx(0)

    // Sequential processing
    for (let i = 0; i < items.length; i++) {
      if (!running) break // cancelled
      const item = items[i]
      updateQueueItem(i, { status: 'generating' })
      setCurrentIdx(i)

      try {
        // Save current content first
        const ch = sortedChapters.find(c => c.id === item.chapterId)
        const chContent = ch ? await fileService.read(`${projectsBasePath}/${activeProjectId}/chapters/${item.chapterId}.txt`).catch(() => '') : ''

        const prompt = await buildPromptForChapter(ch || sortedChapters[0])
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
                  contextUsed: [useWorldbuilding ? 'worldbuilding' : '', useCharacters ? 'characters' : '', useOutline ? 'outline' : '', useDetailedOutline ? 'detailed_outline' : ''].filter(Boolean),
                }
                if (activeProjectId && projectsBasePath) {
                  saveVersionRecord(`${projectsBasePath}/${activeProjectId}`, item.chapterId, versionRecord).then(() => onVersionSaved(versionRecord))
                }
                updateQueueItem(i, { status: 'done', wordCount: data.text.length })
                setTotalWords(prev => prev + data.text.length)
                onGenDone()
                resolve()
              },
              (err) => { onGenError(err.message); updateQueueItem(i, { status: 'error', error: err.message }); reject(err) },
              (data) => { onGenError(data.message); updateQueueItem(i, { status: 'error', error: data.message }); reject(new Error(data.message)) },
            )
            abortRef.current = handle.abort
          })
        } else {
          await new Promise<void>(async (resolve, reject) => {
            try {
              const { text: reply } = await aiService.chatWithUsage(messages, genConfigId, activeProjectId || undefined)
              const finalContent = replaceMode ? reply : (chContent ? chContent + '\n\n' + reply : reply)
              await fileService.write(`${projectsBasePath}/${activeProjectId}/chapters/${item.chapterId}.txt`, finalContent).catch(() => {})
              updateQueueItem(i, { status: 'done', wordCount: reply.length })
              setTotalWords(prev => prev + reply.length)
              resolve()
            } catch (err) { reject(err) }
          })
        }
      } catch (err) {
        updateQueueItem(i, { status: 'error', error: err instanceof Error ? err.message : '生成失败' })
      }
    }

    setRunning(false)
    abortRef.current = null
    // Show summary
    const errs = items.filter(it => it.status === 'error').length
    const oks = items.filter(it => it.status === 'done').length
    if (errs > 0) {
      alert(`批量生成完成: ${oks}章成功, ${errs}章失败。请检查下方红色标记的章节，可重新选择后再次生成。`)
    }
  }

  const updateQueueItem = (idx: number, updates: Partial<QueueItem>) => {
    setQueue(prev => prev.map((q, i) => i === idx ? { ...q, ...updates } : q))
  }

  const handleCancel = () => {
    abortRef.current?.()
    setRunning(false)
  }

  const doneCount = queue.filter(q => q.status === 'done').length
  const errorCount = queue.filter(q => q.status === 'error').length

  return (
    <Modal isOpen={isOpen} onClose={running ? () => {} : onClose} title={running ? '批量生成中...' : '批量生成章节'} width={600}>
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

            {/* Config */}
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', padding: '10px 0', borderTop: '1px solid #f0ece8' }}>
              <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}><input type="checkbox" checked={useWorldbuilding} onChange={() => setUseWorldbuilding(!useWorldbuilding)} /> 世界观</label>
              <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}><input type="checkbox" checked={useCharacters} onChange={() => setUseCharacters(!useCharacters)} /> 角色</label>
              <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}><input type="checkbox" checked={useOutline} onChange={() => setUseOutline(!useOutline)} /> 大纲</label>
              <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}><input type="checkbox" checked={useDetailedOutline} onChange={() => setUseDetailedOutline(!useDetailedOutline)} /> 细纲</label>
              <input type="number" min={500} max={50000} step={100} value={wordTarget} onChange={e => setWordTarget(Math.max(500, Math.min(50000, parseInt(e.target.value) || 500)))} style={{ width: 80, padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.1)', fontSize: 11 }} />
              <span style={{ fontSize: 10, color: '#9b8e84' }}>字/章</span>
              <select value={genConfigId} onChange={e => setGenConfigId(e.target.value)} style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.1)', fontSize: 11 }}>
                {configs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
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
