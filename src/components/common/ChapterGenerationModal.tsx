import { useState, useEffect, useRef } from 'react'
import { useStore, useSettingsStore } from '@/store'
import { aiService, kbService, fileService } from '@/services/fileService'
import Modal from './Modal'
import Button from './Button'
import ScrollArea from './ScrollArea'
import { SparklesIcon, XMarkIcon, BookOpenIcon } from '@heroicons/react/24/outline'
import type { DetailedChapter, ChapterStatus } from '@/types/chapter'
import type { Character } from '@/types/character'
import { logError } from '@/utils/logger'

interface Props {
  isOpen: boolean
  onClose: () => void
  chapterId: string
  currentContent: string
  onApply: (content: string) => void
  onVersionSaved: (version: VersionRecord) => void
}

export interface VersionRecord {
  versionId: string
  chapterId: string
  modelConfigId: string
  modelName: string
  temperature: number
  promptTitle: string
  promptContent: string
  generatedContent: string
  tokens: { input: number; output: number; total: number }
  cost: number
  generatedAt: string
  contextUsed: string[]
}

const STATUS_LABELS: Record<ChapterStatus, string> = {
  outline: '大纲', draft: '初稿', revising: '修改中', final: '定稿',
}

export async function saveVersionRecord(projectPath: string, chapterId: string, record: VersionRecord) {
  const id = `v_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const version = { ...record, versionId: id }
  const dir = `${projectPath}/chapters/${chapterId}_versions`
  await fileService.ensureDir(dir)
  await fileService.write(`${dir}/${id}.json`, JSON.stringify(version, null, 2))
  return id
}

export default function ChapterGenerationModal({ isOpen, onClose, chapterId, currentContent, onApply, onVersionSaved }: Props) {
  const activeProjectId = useStore(s => s.activeProjectId)
  const projectsBasePath = useStore(s => s.projectsBasePath)
  const worldbuildingContent = useStore(s => s.worldbuildingContent)
  const characters = useStore(s => s.characters)
  const outlineContent = useStore(s => s.outlineContent)
  const detailedChapters = useStore(s => s.detailedChapters)
  const configs = useSettingsStore(s => s.configs)
  const activeConfigId = useSettingsStore(s => s.activeConfigId)
  const prompts = useSettingsStore(s => s.prompts)

  const currentChapter = detailedChapters.find(c => c.id === chapterId)
  const prevChapters = detailedChapters.filter(c => c.order < (currentChapter?.order ?? 0)).sort((a, b) => a.order - b.order)

  // Section states
  const [useWorldbuilding, setUseWorldbuilding] = useState(true)
  const [useCharacters, setUseCharacters] = useState(true)
  const [useOutline, setUseOutline] = useState(true)
  const [useDetailedOutline, setUseDetailedOutline] = useState(true)

  const [selectedCharacterIds, setSelectedCharacterIds] = useState<Set<string>>(new Set())
  const [selectedSummaryIds, setSelectedSummaryIds] = useState<Set<string>>(new Set())
  const [selectedKbFileIds, setSelectedKbFileIds] = useState<Set<string>>(new Set())
  const [kbFiles, setKbFiles] = useState<{ id: string; originalName: string }[]>([])
  const [kbLoaded, setKbLoaded] = useState(false)

  const [genConfigId, setGenConfigId] = useState(activeConfigId || '')
  const [wordTarget, setWordTarget] = useState(2000)
  const [streamMode, setStreamMode] = useState(false)
  const [replaceMode, setReplaceMode] = useState(true)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const abortRef = useRef<(() => void) | null>(null)
  const [streamContent, setStreamContent] = useState('')
  const [streamChars, setStreamChars] = useState(0)
  const [streamDone, setStreamDone] = useState(false)
  const [streamUsage, setStreamUsage] = useState<{ prompt_tokens: number; completion_tokens: number; total_tokens: number; cost: number } | undefined>()

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) { setError(''); setStreamContent(''); setStreamChars(0); setStreamDone(false); setStreamUsage(undefined) }
  }, [isOpen])

  // Abort stream on unmount
  useEffect(() => {
    return () => { abortRef.current?.() }
  }, [])

  const chapterPrompt = prompts.find(p => p.type === '章节' && p.enabled)

  // Typing-safe helpers
  const toggleId = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) => {
    setter(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
  }

  const selectIds = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, ids: string[]) => {
    setter(new Set(ids))
  }

  const loadKBFiles = async () => {
    if (kbLoaded) return
    try {
      const meta = await kbService.list() as { files: { id: string; originalName: string; projects: string[] }[] }
      setKbFiles(meta.files.filter(f => f.projects.includes(activeProjectId || '')))
      setKbLoaded(true)
    } catch (e) { logError('加载知识库文件列表失败 (章节生成)', e) }
  }

  const buildPrompt = () => {
    const parts: string[] = []

    if (useWorldbuilding && worldbuildingContent) {
      parts.push(`【世界观设定】\n${worldbuildingContent.slice(0, 3000)}\n`)
    }
    if (useOutline && outlineContent) {
      parts.push(`【小说大纲】\n${outlineContent.slice(0, 2000)}\n`)
    }
    if (useDetailedOutline && currentChapter?.description) {
      parts.push(`【本章细纲】\n${currentChapter.description}\n`)
    }
    if (useCharacters && selectedCharacterIds.size > 0) {
      const selected = characters.filter(c => selectedCharacterIds.has(c.id))
      const charDescs = selected.map(c => {
        const fields = [c.name, c.role, c.gender, c.age, c.occupation, c.personality, c.appearance, c.abilities, c.relationships].filter(Boolean)
        return fields.join('，')
      })
      parts.push(`【本章出场角色】\n${charDescs.join('\n\n')}\n`)
      parts.push('请根据以上角色的性格特点，写出符合各自设定的对白、行为和心理活动。')
    }
    if (selectedSummaryIds.size > 0) {
      const summaries = prevChapters.filter(c => selectedSummaryIds.has(c.id)).map(c => `第${c.order + 1}章 ${c.title}: ${c.summary || '无摘要'}`)
      parts.push(`【前文章节摘要】\n${summaries.join('\n')}\n`)
    }
    if (selectedKbFileIds.size > 0) {
      parts.push(`【知识库参考】\n以下知识库内容可供参考：\n`)
    }

    const template = chapterPrompt?.content || '根据以上设定和细纲，写出一章完整的小说正文。'
    parts.push(`【创作要求】\n${template}\n\n字数目标: ${wordTarget}字\n输出模式: ${replaceMode ? '替换当前正文' : '追加到正文末尾'}`)

    return parts.join('\n\n---\n\n')
  }

  const injectKBContents = async (prompt: string): Promise<string> => {
    if (selectedKbFileIds.size === 0) return prompt
    const kpParts: string[] = []
    let totalChars = 0
    const maxKBChars = 50000
    for (const fid of selectedKbFileIds) {
      if (totalChars >= maxKBChars) break
      try {
        const result = await kbService.read(fid) as { file: { originalName: string }; content: string }
        const sliceLen = Math.min(result.content.length, 10000, maxKBChars - totalChars)
        kpParts.push(`【文件: ${result.file.originalName}】\n${result.content.slice(0, sliceLen)}`)
        totalChars += sliceLen
      } catch (e) { logError('读取知识库文件内容失败', e) }
    }
    return prompt + '\n' + kpParts.join('\n\n')
  }

  const handleGenerate = async () => {
    const config = configs.find(c => c.id === genConfigId)
    if (!config) { setError('请先选择模型配置'); return }
    if (!genConfigId) { setError('请先选择模型配置'); return }

    setLoading(true)
    setError('')
    setStreamContent('')
    setStreamChars(0)
    setStreamDone(false)
    setStreamUsage(undefined)

    try {
      // Auto-save current content first
      if (currentContent && activeProjectId && projectsBasePath) {
        await fileService.write(`${projectsBasePath}/${activeProjectId}/chapters/${chapterId}.txt`, currentContent)
      }

      let prompt = buildPrompt()
      prompt = await injectKBContents(prompt)
      const messages = [{ role: 'user' as const, content: prompt }]

      if (streamMode) {
        // Abort any previous stream
        abortRef.current?.()
        // Streaming mode: accumulate content, show progress
        const streamHandle = aiService.chatStream(
          messages, genConfigId, activeProjectId || undefined,
          (data) => { setStreamContent(data.accumulated); setStreamChars(data.accumulated.length) },
          (data) => {
            abortRef.current = null
            setStreamDone(true)
            setStreamUsage(data.usage)
            const finalContent = replaceMode ? data.text : (currentContent ? currentContent + '\n\n' + data.text : data.text)
            onApply(finalContent)
            saveVersion({
              config, reply: data.text,
              usage: data.usage ? { input: data.usage.prompt_tokens, output: data.usage.completion_tokens, total: data.usage.total_tokens } : { input: 0, output: 0, total: 0 },
              cost: data.usage?.cost || 0,
            })
            setLoading(false)
          },
          (err) => { abortRef.current = null; setError(err.message); setLoading(false) },
          (data) => { abortRef.current = null; setError(data.message); setLoading(false) },
        )
        abortRef.current = streamHandle.abort
        // Don't close modal during streaming; user can cancel
      } else {
        // Abort any previous stream, switch to traditional mode
        abortRef.current?.()
        const { text: reply, usage: genUsage } = await aiService.chatWithUsage(messages, genConfigId, activeProjectId || undefined)
        const finalContent = replaceMode ? reply : (currentContent ? currentContent + '\n\n' + reply : reply)
        onApply(finalContent)
        saveVersion({
          config, reply,
          usage: { input: genUsage?.prompt_tokens || 0, output: genUsage?.completion_tokens || 0, total: genUsage?.total_tokens || 0 },
          cost: genUsage?.cost || 0,
        })
        setLoading(false)
        onClose()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败')
      setLoading(false)
    }
  }

  const saveVersion = async (opts: { config: { id: string; model: string; temperature: number }; reply: string; usage: { input: number; output: number; total: number }; cost: number }) => {
    const record: VersionRecord = {
      versionId: '',
      chapterId,
      modelConfigId: opts.config.id,
      modelName: opts.config.model,
      temperature: opts.config.temperature,
      promptTitle: chapterPrompt?.title || '默认章节模板',
      promptContent: chapterPrompt?.content || '',
      generatedContent: opts.reply,
      tokens: opts.usage,
      cost: opts.cost,
      generatedAt: new Date().toISOString(),
      contextUsed: [
        useWorldbuilding ? 'worldbuilding' : '', useCharacters ? 'characters' : '',
        useOutline ? 'outline' : '', useDetailedOutline ? 'detailed_outline' : '',
        selectedKbFileIds.size > 0 ? 'kb_files' : '',
      ].filter(Boolean),
    }
    if (activeProjectId && projectsBasePath) {
      await saveVersionRecord(`${projectsBasePath}/${activeProjectId}`, chapterId, record)
    }
    onVersionSaved(record)
  }

  const handleCancelStream = () => {
    abortRef.current?.()
    abortRef.current = null
    setLoading(false)
    setStreamContent('')
    setStreamDone(false)
    setError('生成已取消')
  }

  const smartSelectSummaries = () => {
    const ids = prevChapters.slice(-5).map(c => c.id)
    selectIds(setSelectedSummaryIds, ids)
  }

  const autoDetectCharacters = () => {
    const desc = (currentChapter?.description || '')
    const found = characters.filter(c => {
      if (!c.name) return false
      // Match character name as a word (surrounded by punctuation, space, or string boundary)
      const escaped = c.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const re = new RegExp(`(^|[\\s，。、；：？！""''（）\\-—…])${escaped}($|[\\s，。、；：？！""''（）\\-—…])`)
      return re.test(desc)
    })
    selectIds(setSelectedCharacterIds, found.map(c => c.id))
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="AI 生成章节" width={680}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* A: Context toggles */}
        <div style={{ padding: '10px 14px', borderRadius: 10, background: '#faf9f8' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#6b5e54', marginBottom: 8 }}>A. 关联上下文</div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <label style={checkLabel}><input type="checkbox" checked={useWorldbuilding} onChange={() => setUseWorldbuilding(!useWorldbuilding)} style={checkInput} /> 世界观</label>
            <label style={checkLabel}><input type="checkbox" checked={useCharacters} onChange={() => setUseCharacters(!useCharacters)} style={checkInput} /> 角色</label>
            <label style={checkLabel}><input type="checkbox" checked={useOutline} onChange={() => setUseOutline(!useOutline)} style={checkInput} /> 大纲</label>
            <label style={checkLabel}><input type="checkbox" checked={useDetailedOutline} onChange={() => setUseDetailedOutline(!useDetailedOutline)} style={checkInput} /> 细纲</label>
          </div>
        </div>

        {/* B: Character selector */}
        <div style={{ padding: '10px 14px', borderRadius: 10, background: '#faf9f8' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#6b5e54' }}>B. 角色库 ({selectedCharacterIds.size})</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={autoDetectCharacters} style={actionLink}>自动检测</button>
              <button onClick={() => selectIds(setSelectedCharacterIds, [])} style={actionLink}>清空</button>
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 120, overflowY: 'auto' }} className="custom-scrollbar">
            {characters.map(c => (
              <label key={c.id} style={{ ...checkLabel, padding: '2px 8px', borderRadius: 6, background: selectedCharacterIds.has(c.id) ? 'rgba(124,58,237,0.06)' : 'transparent', border: selectedCharacterIds.has(c.id) ? '1px solid rgba(124,58,237,0.2)' : '1px solid rgba(0,0,0,0.06)' }}>
                <input type="checkbox" checked={selectedCharacterIds.has(c.id)} onChange={() => toggleId(setSelectedCharacterIds, c.id)} style={checkInput} />
                {c.name} <span style={{ fontSize: 9, color: '#9b8e84' }}>{c.role}</span>
              </label>
            ))}
            {characters.length === 0 && <span style={{ fontSize: 11, color: '#9b8e84' }}>暂无角色</span>}
          </div>
        </div>

        {/* C: Chapter summaries */}
        <div style={{ padding: '10px 14px', borderRadius: 10, background: '#faf9f8' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#6b5e54' }}>C. 章节摘要参考 ({selectedSummaryIds.size}/5)</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={smartSelectSummaries} style={actionLink}>智能选择前五章</button>
              <button onClick={() => selectIds(setSelectedSummaryIds, [])} style={actionLink}>清空选择</button>
            </div>
          </div>
          <div className="custom-scrollbar" style={{ maxHeight: 140, overflowY: 'auto' }}>
            {prevChapters.map(c => (
              <label key={c.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, padding: '4px 6px', cursor: 'pointer', borderRadius: 6, fontSize: 11, color: '#2d2520' }}>
                <input type="checkbox" checked={selectedSummaryIds.has(c.id)} onChange={() => toggleId(setSelectedSummaryIds, c.id)} disabled={!selectedSummaryIds.has(c.id) && selectedSummaryIds.size >= 5} style={checkInput} />
                <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>第{c.order + 1}章</span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</span>
                <span style={{ fontSize: 9, color: '#9b8e84', whiteSpace: 'nowrap' }}>{STATUS_LABELS[c.status || 'outline']}</span>
              </label>
            ))}
            {prevChapters.length === 0 && <span style={{ fontSize: 11, color: '#9b8e84' }}>无前序章节</span>}
          </div>
        </div>

        {/* D: KB files */}
        <div style={{ padding: '10px 14px', borderRadius: 10, background: '#faf9f8' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#6b5e54' }}>D. 知识库注入 ({selectedKbFileIds.size})</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => { loadKBFiles(); if (kbFiles.length > 0) selectIds(setSelectedKbFileIds, kbFiles.map(f => f.id)) }} style={actionLink}>全选</button>
              <button onClick={() => selectIds(setSelectedKbFileIds, [])} style={actionLink}>清空</button>
            </div>
          </div>
          <button onClick={loadKBFiles} style={{ ...actionLink, marginBottom: kbLoaded ? 6 : 0 }}>
            <BookOpenIcon style={{ width: 11, height: 11, marginRight: 3 }} />
            {kbLoaded ? `已加载 ${kbFiles.length} 个文件` : '点击加载知识库文件'}
          </button>
          {kbLoaded && kbFiles.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 100, overflowY: 'auto' }} className="custom-scrollbar">
              {kbFiles.map(f => (
                <label key={f.id} style={{ ...checkLabel, padding: '2px 8px', borderRadius: 6, background: selectedKbFileIds.has(f.id) ? 'rgba(124,58,237,0.06)' : '#fff', border: selectedKbFileIds.has(f.id) ? '1px solid rgba(124,58,237,0.2)' : '1px solid rgba(0,0,0,0.06)', fontSize: 10 }}>
                  <input type="checkbox" checked={selectedKbFileIds.has(f.id)} onChange={() => toggleId(setSelectedKbFileIds, f.id)} style={checkInput} />
                  {f.originalName}
                </label>
              ))}
            </div>
          )}
        </div>

        {/* E: Template */}
        <div style={{ padding: '10px 14px', borderRadius: 10, background: '#faf9f8' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#6b5e54', marginBottom: 8 }}>E. 生成模板</div>
          {chapterPrompt ? (
            <div style={{ fontSize: 11, color: '#7c3aed', padding: '6px 10px', borderRadius: 6, background: 'rgba(124,58,237,0.04)' }}>
              已启用: {chapterPrompt.title} — {chapterPrompt.content.slice(0, 80)}...
            </div>
          ) : (
            <div style={{ fontSize: 11, color: '#9b8e84' }}>未启用"章节"提示词，将使用默认模板</div>
          )}
        </div>

        {/* F: Word target */}
        <div style={{ padding: '10px 14px', borderRadius: 10, background: '#faf9f8' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#6b5e54', marginBottom: 8 }}>F. 字数目标</div>
          <input type="number" min={500} max={50000} step={100} value={wordTarget} onChange={e => setWordTarget(Math.max(500, Math.min(50000, parseInt(e.target.value) || 500)))} style={{ width: 120, padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', fontSize: 13, fontFamily: 'inherit' }} />
          <span style={{ fontSize: 11, color: '#9b8e84', marginLeft: 8 }}>字 (500-50000)</span>
        </div>

        {/* G: Output mode + config */}
        <div style={{ padding: '10px 14px', borderRadius: 10, background: '#faf9f8' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#6b5e54', marginBottom: 8 }}>G. 输出模式与配置</div>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={checkLabel}><input type="checkbox" checked={streamMode} onChange={() => setStreamMode(!streamMode)} style={checkInput} /> 流式输出</label>
            <label style={checkLabel}><input type="checkbox" checked={replaceMode} onChange={() => setReplaceMode(!replaceMode)} style={checkInput} /> 替换正文（关闭=追加）</label>
            <select value={genConfigId} onChange={e => setGenConfigId(e.target.value)} style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.1)', fontSize: 11, fontFamily: 'inherit' }}>
              {configs.map(c => <option key={c.id} value={c.id}>{c.name} ({c.model})</option>)}
            </select>
          </div>
          {streamMode && (
            <div style={{ marginTop: 6, fontSize: 11, color: '#16a34a' }}>流式输出已启用 — 内容将逐字显示</div>
          )}
        </div>

        {/* Streaming progress */}
        {streamMode && loading && !streamContent && (
          <div style={{ padding: '10px 14px', borderRadius: 10, background: '#f5f3ff', border: '1px solid rgba(124,58,237,0.12)', textAlign: 'center', fontSize: 12, color: '#7c3aed' }}>
            等待 AI 响应...
          </div>
        )}
        {streamMode && loading && streamContent && (
          <div style={{ padding: '10px 14px', borderRadius: 10, background: '#f5f3ff', border: '1px solid rgba(124,58,237,0.12)' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#7c3aed', marginBottom: 4 }}>
              流式生成中... {streamChars.toLocaleString()} 字
              {streamDone && ' ✓ 完成'}
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.6, color: '#4a3f38', whiteSpace: 'pre-wrap', maxHeight: 200, overflowY: 'auto' }} className="custom-scrollbar">
              {streamContent.slice(-500)}
            </div>
            {streamDone && streamUsage && (
              <div style={{ fontSize: 10, color: '#6b5e54', marginTop: 4 }}>
                Token: 入{streamUsage.prompt_tokens} 出{streamUsage.completion_tokens} 总{streamUsage.total_tokens} | 花费 ${streamUsage.cost.toFixed(4)}
              </div>
            )}
          </div>
        )}

        {error && (
          <div style={{ padding: '8px 12px', borderRadius: 8, background: '#fee2e2', color: '#dc2626', fontSize: 12 }}>{error}</div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8, borderTop: '1px solid #f0ece8' }}>
          <Button variant="secondary" onClick={onClose} disabled={loading && !streamDone}>取消</Button>
          {loading && streamMode && !streamDone ? (
            <Button variant="danger" onClick={handleCancelStream}>停止生成</Button>
          ) : (
            <Button onClick={handleGenerate} disabled={loading || !genConfigId} icon={<SparklesIcon style={{ width: 16, height: 16 }} />}>
              {loading ? '生成中...' : `生成章节 (~${wordTarget}字)`}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}

const checkLabel: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer', color: '#4a3f38' }
const checkInput: React.CSSProperties = { width: 14, height: 14, accentColor: '#7c3aed', cursor: 'pointer' }
const actionLink: React.CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: '#7c3aed', padding: 0, fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center' }
