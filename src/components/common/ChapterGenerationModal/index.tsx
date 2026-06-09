import { useState, useEffect, useRef } from "react";
import { useStore, useSettingsStore } from "@/store";
import { aiService, kbService, fileService, templateService, styleTemplateService, settingsService } from "@/services/fileService";
import { chatAIWithUsage, chatAIStream, chatAI } from "@/utils/chatAI";
import { loadOutlineDimensions } from "@/utils/outlineData";
import { loadAllSummaries, saveSummary } from "@/services/summaryService";
import type { OutlineTabToggles, DetailedOutlineToggles } from "@/types/settings";
import Modal from "../Modal";
import { SparklesIcon, BookOpenIcon } from "@heroicons/react/24/outline";
import type { DetailedChapter } from "@/types/chapter";
import type { SceneTemplate } from "@/types/story";
import { logError } from "@/utils/logger";
import { STATUS_LABELS, checkLabel, checkInput, miniActionLink, cardStyle, cardHeaderStyle } from "./constants";
import type { VersionRecord, ChapterGenProps } from "./types";
import { saveVersionRecord } from "./versionManager";
import { buildScenePrompt, buildPrompt, normalizeParagraphs, injectKBContents } from "./promptBuilder";

export default function ChapterGenerationModal({ isOpen, onClose, chapterId, currentContent, onApply, onVersionSaved, onGenStart, onGenChunk, onGenDone, onGenError, externalAbortRef }: ChapterGenProps) {
  const activeProjectId = useStore(s => s.activeProjectId)
  const projectsBasePath = useStore(s => s.projectsBasePath)
  const worldbuildingContent = useStore(s => s.worldbuildingContent)
  const characters = useStore(s => s.characters)
  const outlineContent = useStore(s => s.outlineContent)
  const detailedChapters = useStore(s => s.detailedChapters)
  const configs = useSettingsStore(s => s.configs)
  const activeConfigId = useSettingsStore(s => s.activeConfigId)
  const prompts = useSettingsStore(s => s.prompts)
  const updatePromptStore = useSettingsStore(s => s.updatePrompt)
  const aiSettings = useSettingsStore(s => s.aiSettings)
  const setAISettings = useSettingsStore(s => s.setAISettings)

  const chapterSummaryMap = useStore(s => s.chapterSummaryMap)
  const setChapterSummary = useStore(s => s.setChapterSummary)
  const fileEditNotify = useStore(s => s.fileEditNotify)
  const currentChapter = detailedChapters.find(c => c.id === chapterId)
  const prevChapters = detailedChapters.filter(c => c.order < (currentChapter?.order ?? 0)).sort((a, b) => a.order - b.order)
  const prevChaptersWithSummary = prevChapters.filter(c => chapterSummaryMap[c.id]?.trim())

  // Section states — load from persisted settings
  const cg = aiSettings.chapterGen
  const updateCg = (patch: Partial<typeof cg>) => setAISettings({ chapterGen: { ...cg, ...patch } })

  const [outlineTabs, setOutlineTabs] = useState<OutlineTabToggles>(cg.outlineTabs)
  const [detailedOutlineFields, setDetailedOutlineFields] = useState<DetailedOutlineToggles>(cg.detailedOutlineFields)

  const toggleOutlineTab = (key: keyof OutlineTabToggles) => {
    setOutlineTabs(prev => ({ ...prev, [key]: !prev[key] }))
  }
  const toggleDetailedField = (key: keyof DetailedOutlineToggles) => {
    setDetailedOutlineFields(prev => ({ ...prev, [key]: !prev[key] }))
  }
  const setAllOutlineTabs = (val: boolean) => {
    setOutlineTabs(prev => {
      const next = { ...prev }
      for (const k of Object.keys(next) as (keyof OutlineTabToggles)[]) next[k] = val
      return next
    })
  }
  const setAllDetailedFields = (val: boolean) => {
    setDetailedOutlineFields(prev => {
      const next = { ...prev }
      for (const k of Object.keys(next) as (keyof DetailedOutlineToggles)[]) next[k] = val
      return next
    })
  }

  const [selectedCharacterIds, setSelectedCharacterIds] = useState<Set<string>>(new Set(cg.selectedCharacterIds || []))
  const [selectedSummaryIds, setSelectedSummaryIds] = useState<Set<string>>(new Set(cg.selectedSummaryIds || []))
  const [selectedKbFileIds, setSelectedKbFileIds] = useState<Set<string>>(new Set(cg.selectedKbFileIds || []))
  const [kbFiles, setKbFiles] = useState<{ id: string; originalName: string }[]>([])
  const [kbLoaded, setKbLoaded] = useState(false)

  const [genConfigId, setGenConfigId] = useState(activeConfigId || '')
  const [wordTarget, setWordTarget] = useState(cg.wordTarget)
  const [streamMode, setStreamMode] = useState(cg.streamMode)
  const [replaceMode, setReplaceMode] = useState(cg.replaceMode)
  const [autoSummary, setAutoSummary] = useState(false)
  const [selectedSummaryPromptId, setSelectedSummaryPromptId] = useState('__none__')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const abortRef = useRef<(() => void) | null>(null)
  const [streamContent, setStreamContent] = useState('')
  const [streamChars, setStreamChars] = useState(0)
  const [streamDone, setStreamDone] = useState(false)
  const [streamUsage, setStreamUsage] = useState<{ prompt_tokens: number; completion_tokens: number; total_tokens: number; cost: number } | undefined>()

  // Scene template injection
  const [sceneTemplates, setSceneTemplates] = useState<SceneTemplate[]>([])
  const [selectedSceneId, setSelectedSceneId] = useState(cg.selectedSceneId)
  const [sceneFilterType, setSceneFilterType] = useState<'all' | '情色小说' | '普通小说'>('all')
  const [styleTemplates, setStyleTemplates] = useState<any[]>([])
  const [selectedStyleTemplateId, setSelectedStyleTemplateId] = useState(cg.selectedStyleTemplateId)
  const selectedStyleTemplate = selectedStyleTemplateId ? styleTemplates.find((t: any) => t.id === selectedStyleTemplateId) : null

  // Persist settings whenever user changes them
  useEffect(() => { updateCg({ outlineTabs, detailedOutlineFields }) }, [outlineTabs, detailedOutlineFields])
  useEffect(() => { updateCg({ wordTarget, streamMode, replaceMode }) }, [wordTarget, streamMode, replaceMode])
  useEffect(() => { updateCg({ selectedCharacterIds: [...selectedCharacterIds], selectedSummaryIds: [...selectedSummaryIds], selectedKbFileIds: [...selectedKbFileIds] }) }, [selectedCharacterIds, selectedSummaryIds, selectedKbFileIds])
  useEffect(() => { updateCg({ selectedSceneId, selectedStyleTemplateId }) }, [selectedSceneId, selectedStyleTemplateId])

  useEffect(() => {
    if (isOpen) {
      setError(''); setStreamContent(''); setStreamChars(0); setStreamDone(false); setStreamUsage(undefined)
      templateService.list().then(list => setSceneTemplates(Array.isArray(list) ? list : [])).catch(() => setSceneTemplates([]))
      styleTemplateService.list().then(list => setStyleTemplates(Array.isArray(list) ? list : [])).catch(() => setStyleTemplates([]))
      // Load summaries from files for all chapters so the modal has up-to-date data
      if (activeProjectId && projectsBasePath && detailedChapters.length > 0) {
        const pp = `${projectsBasePath}/${activeProjectId}`
        loadAllSummaries(pp, detailedChapters.map(c => c.id)).then(map => {
          Object.entries(map).forEach(([id, content]) => {
            if (content) setChapterSummary(id, content)
          })
        }).catch(() => {})
      }
    }
  }, [isOpen])

  // Listen for template creation/update from other pages and refresh dropdowns
  useEffect(() => {
    if (!fileEditNotify?.filePath) return
    if (fileEditNotify.filePath.includes('style_templates')) {
      styleTemplateService.list().then(list => setStyleTemplates(Array.isArray(list) ? list : [])).catch(() => {})
    }
    if (fileEditNotify.filePath.includes('scene_templates')) {
      templateService.list().then(list => setSceneTemplates(Array.isArray(list) ? list : [])).catch(() => {})
    }
  }, [fileEditNotify])

  const selectedScene = selectedSceneId ? sceneTemplates.find(t => t.id === selectedSceneId) : null


  // Abort stream on unmount
  useEffect(() => {
    return () => { abortRef.current?.(); if (externalAbortRef) externalAbortRef.current = null }
  }, [])

  const chapterPrompts = prompts.filter(p => p.type === '章节')
  const NONE_ID = '__none__'
  const [selectedChapterPromptId, setSelectedChapterPromptId] = useState(NONE_ID)
  const chapterPrompt = selectedChapterPromptId !== NONE_ID ? chapterPrompts.find(p => p.id === selectedChapterPromptId) : undefined

  const handleSwitchChapterPrompt = (promptId: string) => {
    setSelectedChapterPromptId(promptId)
    if (promptId === NONE_ID) return  // 不使用模板，不修改启用状态
    // Disable all chapter prompts, then enable selected one
    for (const p of chapterPrompts) {
      if (p.id !== promptId && p.enabled) updatePromptStore(p.id, { enabled: false })
    }
    updatePromptStore(promptId, { enabled: true })
  }

  // Typing-safe helpers
  const toggleId = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) => {
    setter(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
  }

  const selectIds = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, ids: string[]) => {
    setter(new Set(ids))
  }

  const loadKBFiles = async (): Promise<{ id: string; originalName: string }[]> => {
    if (kbLoaded) return kbFiles
    try {
      const meta = await kbService.list() as { files: { id: string; originalName: string; projects: string[] }[] }
      const files = meta.files.filter(f => f.projects.includes(activeProjectId || ''))
      setKbFiles(files)
      setKbLoaded(true)
      return files
    } catch (e) { logError('加载知识库文件列表失败 (章节生成)', e); return [] }
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
        chapterSummaryMap[chapterId] = summary
      }
    } catch { /* non-critical */ }
  }

  const handleGenerate = async () => {
    const config = configs.find(c => c.id === genConfigId)
    if (!config) { setError('请先选择模型配置'); return }
    if (!genConfigId) { setError('请先选择模型配置'); return }
    // Validate templates before sending to AI
    const styleTemplate = selectedStyleTemplateId ? styleTemplates.find((t: any) => t.id === selectedStyleTemplateId) : null
    const sceneTemplate = selectedSceneId ? sceneTemplates.find(t => t.id === selectedSceneId) : null
    if (styleTemplate && !Object.keys(styleTemplate.dimensions || {}).length && !styleTemplate.tone?.word) {
      setError('所选风格模板无有效维度数据（dimensions 和 tone 均为空），请选择有效模板或取消选择。')
      return
    }
    if (sceneTemplate && !sceneTemplate.config) {
      setError('所选场景模板无有效配置（config 为空），请选择有效模板或取消选择。')
      return
    }

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

      // Load async outline dimensions (items, locations, factions, etc.)
      const loadedDims = activeProjectId && projectsBasePath
        ? await loadOutlineDimensions(`${projectsBasePath}/${activeProjectId}`, outlineTabs)
        : undefined

      let prompt = buildPrompt({
        outlineTabs, detailedOutlineFields, outlineContent, worldbuildingContent,
        selectedCharacterIds, characters, currentChapter,
        loadedDims, selectedSummaryIds, prevChapters, chapterSummaryMap,
        selectedKbFileIds, selectedScene, selectedStyleTemplateId,
        selectedStyleTemplate, styleStrength: cg.styleStrength || 'normal',
        chapterPrompt, wordTarget, replaceMode
      })
      const kbSearchQuery = [currentChapter?.description?.slice(0, 200), ...selectedCharacterIds].filter(Boolean).join(' ')
      prompt = await injectKBContents(prompt, selectedKbFileIds, kbSearchQuery, activeProjectId || undefined, genConfigId)

      const messages = [{ role: 'user' as const, content: prompt }]

      if (streamMode) {
        // Abort any previous stream
        abortRef.current?.()
        // Close config modal, show overlay
        onGenStart?.()
        onClose()
        // Stream & write each chunk to editor immediately
        const streamHandle = chatAIStream(
          messages, genConfigId, activeProjectId || undefined,
          (data) => {
            setStreamContent(data.accumulated); setStreamChars(data.accumulated.length)
            const liveContent = replaceMode ? data.accumulated : (currentContent ? currentContent + '\n\n' + data.accumulated : data.accumulated)
            onApply(liveContent)
            onGenChunk?.({ accumulated: data.accumulated, charCount: data.accumulated.length })
          },
          (data) => {
            abortRef.current = null
            if (externalAbortRef) externalAbortRef.current = null
            setStreamDone(true)
            setStreamUsage(data.usage)
            const normalized = normalizeParagraphs(data.text)
            const finalContent = replaceMode ? normalized : (currentContent ? currentContent + '\n\n' + normalized : normalized)
            onApply(finalContent)
            saveVersion({
              config, reply: data.text,
              usage: data.usage ? { input: data.usage.prompt_tokens, output: data.usage.completion_tokens, total: data.usage.total_tokens } : { input: 0, output: 0, total: 0 },
              cost: data.usage?.cost || 0,
            }).catch(err => logError('保存版本记录失败', err))
            if (autoSummary && chapterId) {
              generateSummaryForChapter(chapterId, data.text, currentChapter?.title || '').catch(() => {})
            }
            setLoading(false)
            onGenDone?.()
          },
          (err) => { abortRef.current = null; if (externalAbortRef) externalAbortRef.current = null; setError(err.message); setLoading(false); onGenError?.(err.message) },
        )
        abortRef.current = streamHandle.abort
        if (externalAbortRef) externalAbortRef.current = streamHandle.abort
      } else {
        // Abort any previous stream, switch to traditional mode
        abortRef.current?.()
        const { text: reply, usage: genUsage } = await chatAIWithUsage(messages, genConfigId, activeProjectId || undefined)
        const normalized = normalizeParagraphs(reply)
        const finalContent = replaceMode ? normalized : (currentContent ? currentContent + '\n\n' + normalized : normalized)
        onApply(finalContent)
        saveVersion({
          config, reply,
          usage: { input: genUsage?.prompt_tokens || 0, output: genUsage?.completion_tokens || 0, total: genUsage?.total_tokens || 0 },
          cost: genUsage?.cost || 0,
        }).catch(err => logError('保存版本记录失败', err))
        if (autoSummary && chapterId) {
          generateSummaryForChapter(chapterId, reply, currentChapter?.title || '').catch(() => {})
        }
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
        outlineTabs.plot ? 'outline_plot' : '',
        outlineTabs.worldbuilding ? 'outline_worldbuilding' : '',
        outlineTabs.characters ? 'outline_characters' : '',
        outlineTabs.items ? 'outline_items' : '',
        outlineTabs.locations ? 'outline_locations' : '',
        outlineTabs.factions ? 'outline_factions' : '',
        outlineTabs.powerSystem ? 'outline_powerSystem' : '',
        outlineTabs.foreshadowing ? 'outline_foreshadowing' : '',
        outlineTabs.emotion ? 'outline_emotion' : '',
        outlineTabs.plotThreads ? 'outline_plotThreads' : '',
        detailedOutlineFields.plotOverview ? 'detail_plotOverview' : '',
        detailedOutlineFields.chapterCharacters ? 'detail_characters' : '',
        detailedOutlineFields.location ? 'detail_location' : '',
        detailedOutlineFields.keyEvents ? 'detail_keyEvents' : '',
        detailedOutlineFields.eroticContent ? 'detail_eroticContent' : '',
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
    if (externalAbortRef) externalAbortRef.current = null
    setLoading(false)
    setStreamContent('')
    setStreamDone(false)
    setError('生成已取消')
  }

  const smartSelectSummaries = () => {
    const ids = prevChaptersWithSummary.slice(-5).map(c => c.id)
    selectIds(setSelectedSummaryIds, ids)
  }

  const autoDetectCharacters = () => {
    const searchText = [
      currentChapter?.description || '',
      currentChapter?.characters || '',
      currentChapter?.plotOverview || '',
    ].join(' ')
    const found = characters.filter(c => {
      if (!c.name || c.name.length < 1) return false
      // Simple includes check — more robust than regex for CJK names
      return searchText.includes(c.name)
    })
    selectIds(setSelectedCharacterIds, found.map(c => c.id))
    if (found.length === 0) {
      setError('未在细纲描述/出场角色/剧情概述中匹配到任何角色名。请手动选择或检查细纲中是否正确填写了角色名。')
      setTimeout(() => setError(''), 5000)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="" width="86vw" maxHeight="100vh" closeOnBackdropClick={false} draggable resizable>
      <style>{`
        @keyframes glow-pulse { 0%,100% { box-shadow: 0 0 20px rgba(124,58,237,0.15), 0 0 40px rgba(124,58,237,0.05); } 50% { box-shadow: 0 0 28px rgba(124,58,237,0.25), 0 0 56px rgba(124,58,237,0.1); } }
        .gen-btn { transition: all 0.25s ease; }
        .gen-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 8px 24px rgba(124,58,237,0.3); }
        .gen-btn:active:not(:disabled) { transform: translateY(0) scale(0.98); }
        .chip-check { transition: all 0.2s ease; }
        .chip-check:hover { transform: translateY(-1px); }
        .section-card { transition: box-shadow 0.2s ease; }
        .section-card:hover { box-shadow: 0 2px 12px rgba(0,0,0,0.05); }
      `}</style>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '82vh', minHeight: 600 }}>
        {/* Header — clean title */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 12,
              background: 'linear-gradient(135deg, #7c3aed, #a855f7)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(124,58,237,0.25)',
            }}>
              <SparklesIcon style={{ width: 18, height: 18, color: '#fff' }} />
            </div>
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1e1b2e', margin: 0, lineHeight: 1.2 }}>AI 生成章节</h2>
              <p style={{ fontSize: 11, color: '#9b8e84', margin: 0 }}>{currentChapter?.title || '未命名章节'}</p>
            </div>
          </div>
          <button onClick={onClose} style={{
            width: 32, height: 32, borderRadius: 8, border: '1px solid rgba(0,0,0,0.06)',
            background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#9b8e84', fontSize: 16,
          }}>×</button>
        </div>

        {/* === SECTION 1: Dimensions (combined: outline + detailed) === */}
        <div className="section-card" style={{ padding: '16px 20px', borderRadius: 14, background: 'linear-gradient(135deg, rgba(124,58,237,0.015), rgba(168,85,247,0.02))', border: '1px solid rgba(124,58,237,0.08)', flexShrink: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#7c3aed', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 4, height: 16, borderRadius: 2, background: '#7c3aed' }} />
            关联大纲和细纲
          </div>
          {/* Outline tabs — all on one line */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#6b5e54' }}>大纲</span>
              <button onClick={() => setAllOutlineTabs(true)} style={miniActionLink}>全选</button>
              <button onClick={() => setAllOutlineTabs(false)} style={miniActionLink}>清空</button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {([
                ['plot', '故事剧情'], ['worldbuilding', '世界观'], ['characters', '角色'],
                ['items', '道具'], ['locations', '地点'], ['factions', '势力'],
                ['powerSystem', '等级'], ['foreshadowing', '伏笔'], ['emotion', '情绪'],
                ['plotThreads', '故事线'],
              ] as [keyof OutlineTabToggles, string][]).map(([key, label]) => (
                <label key={key} className="chip-check" style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 12px', borderRadius: 7,
                  fontSize: 12, cursor: 'pointer',
                  background: outlineTabs[key] ? 'linear-gradient(135deg, rgba(124,58,237,0.08), rgba(168,85,247,0.06))' : '#f8f7f5',
                  border: outlineTabs[key] ? '1px solid rgba(124,58,237,0.2)' : '1px solid rgba(0,0,0,0.05)',
                  color: outlineTabs[key] ? '#7c3aed' : '#6b5e54',
                  fontWeight: outlineTabs[key] ? 600 : 400,
                }}>
                  <input type="checkbox" checked={outlineTabs[key]} onChange={() => toggleOutlineTab(key)} style={checkInput} />
                  {label}
                </label>
              ))}
            </div>
          </div>
          {/* Detailed outline fields */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#4a3f38' }}>细纲</span>
              <button onClick={() => setAllDetailedFields(true)} style={miniActionLink}>全选</button>
              <button onClick={() => setAllDetailedFields(false)} style={miniActionLink}>清空</button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {([
                ['plotOverview', '剧情概述'], ['chapterCharacters', '出场角色'],
                ['location', '场景地点'], ['keyEvents', '关键事件'],
                ['eroticContent', '情色剧情'],
              ] as [keyof DetailedOutlineToggles, string][]).map(([key, label]) => (
                <label key={key} className="chip-check" style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 12px', borderRadius: 7,
                  fontSize: 12, cursor: 'pointer',
                  background: detailedOutlineFields[key] ? 'linear-gradient(135deg, rgba(59,130,246,0.08), rgba(96,165,250,0.06))' : '#f8f7f5',
                  border: detailedOutlineFields[key] ? '1px solid rgba(59,130,246,0.2)' : '1px solid rgba(0,0,0,0.05)',
                  color: detailedOutlineFields[key] ? '#3b82f6' : '#6b5e54',
                  fontWeight: detailedOutlineFields[key] ? 600 : 400,
                }}>
                  <input type="checkbox" checked={detailedOutlineFields[key]} onChange={() => toggleDetailedField(key)} style={checkInput} />
                  {label}
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* === SECTION 2: Two-column layout (characters+summary+kb | template+scene+style) === */}
        <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {/* Left column */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
            {/* Characters */}
            <div className="section-card" style={{ ...cardStyle, padding: '14px 16px', flex: 3, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ ...cardHeaderStyle, fontSize: 13, flexShrink: 0 }}>角色库 · {selectedCharacterIds.size} 个</div>
              <div style={{ flexShrink: 0, display: 'flex', gap: 4, marginBottom: 6 }}>
                <button onClick={() => selectIds(setSelectedCharacterIds, characters.map(c => c.id))} style={{...miniActionLink, fontSize: 12}}>全选</button>
                <button onClick={autoDetectCharacters} style={{...miniActionLink, fontSize: 12}}>自动检测</button>
                <button onClick={() => selectIds(setSelectedCharacterIds, [])} style={{...miniActionLink, fontSize: 12}}>清空</button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, overflowY: 'auto', flex: 1, alignContent: 'flex-start' }} className="custom-scrollbar">
                {characters.map(c => (
                  <label key={c.id} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 7, fontSize: 12, cursor: 'pointer',
                    background: selectedCharacterIds.has(c.id) ? 'rgba(124,58,237,0.06)' : 'transparent',
                    border: selectedCharacterIds.has(c.id) ? '1px solid rgba(124,58,237,0.18)' : '1px solid rgba(0,0,0,0.05)',
                  }}>
                    <input type="checkbox" checked={selectedCharacterIds.has(c.id)} onChange={() => toggleId(setSelectedCharacterIds, c.id)} style={checkInput} />
                    {c.name}<span style={{ fontSize: 11, color: '#9b8e84', marginLeft: 2 }}>{c.role}</span>
                  </label>
                ))}
                {characters.length === 0 && <span style={{ fontSize: 12, color: '#9b8e84' }}>暂无角色</span>}
              </div>
            </div>

            {/* Chapter summaries */}
            <div className="section-card" style={{ ...cardStyle, padding: '14px 16px', flex: 3, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ ...cardHeaderStyle, fontSize: 13, flexShrink: 0 }}>前文摘要 · {selectedSummaryIds.size}/5（有摘要 {prevChaptersWithSummary.length}/{prevChapters.length} 章）</div>
              <div style={{ flexShrink: 0, display: 'flex', gap: 4, marginBottom: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <button onClick={smartSelectSummaries} style={{...miniActionLink, fontSize: 12}}>最近五章（有摘要的）</button>
                <button onClick={() => selectIds(setSelectedSummaryIds, [])} style={{...miniActionLink, fontSize: 12}}>清空</button>
                <div style={{ width: 1, height: 14, background: 'rgba(0,0,0,0.1)' }} />
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 12, color: autoSummary ? '#16a34a' : '#6b5e54', fontWeight: autoSummary ? 600 : 400 }}>
                  <input type="checkbox" checked={autoSummary} onChange={() => setAutoSummary(!autoSummary)} style={checkInput} />自动生成摘要
                </label>
                {autoSummary && (
                  <select value={selectedSummaryPromptId} onChange={e => setSelectedSummaryPromptId(e.target.value)} style={{ padding: '3px 6px', borderRadius: 5, border: '1px solid rgba(0,0,0,0.1)', fontSize: 11, fontFamily: 'inherit', background: '#faf9f8', cursor: 'pointer' }}>
                    <option value={NONE_ID}>默认模板（200字摘要）</option>
                    {prompts.filter(p => p.type === '摘要' && p.enabled).map(p => (
                      <option key={p.id} value={p.id}>{p.title}</option>
                    ))}
                  </select>
                )}
              </div>
              <div className="custom-scrollbar" style={{ overflowY: 'auto', flex: 1 }}>
                {prevChapters.map(c => {
                  const hasSummary = !!chapterSummaryMap[c.id]?.trim()
                  return (
                  <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', cursor: hasSummary ? 'pointer' : 'default', borderRadius: 6, fontSize: 13, color: hasSummary ? '#2d2520' : '#b0a89e' }}>
                    <input type="checkbox" checked={selectedSummaryIds.has(c.id)} onChange={() => toggleId(setSelectedSummaryIds, c.id)} disabled={!hasSummary || (!selectedSummaryIds.has(c.id) && selectedSummaryIds.size >= 5)} style={checkInput} />
                    <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>第{c.order + 1}章</span>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</span>
                    {!hasSummary && <span style={{ fontSize: 11, color: '#f59e0b', whiteSpace: 'nowrap' }}>无摘要</span>}
                    <span style={{ fontSize: 11, color: '#9b8e84', whiteSpace: 'nowrap' }}>{STATUS_LABELS[c.status || 'incomplete']}</span>
                  </label>
                )})}
                {prevChapters.length === 0 && <span style={{ fontSize: 13, color: '#9b8e84' }}>无前序章节</span>}
              </div>
              {prevChapters.length > 0 && prevChaptersWithSummary.length === 0 && (
                <div style={{ marginTop: 4, padding: '6px 8px', borderRadius: 6, background: 'rgba(245,158,11,0.06)', color: '#b45309', lineHeight: 1.4, flexShrink: 0 }}>
                  💡 前序章节尚未创建摘要。可在章节创作页左侧面板的"章节正文摘要"中点击"AI提取"为每章自动生成摘要。
                </div>
              )}
            </div>

            {/* Knowledge base */}
            <div className="section-card" style={{ ...cardStyle, padding: '14px 16px', flex: 2, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ ...cardHeaderStyle, fontSize: 13, flexShrink: 0 }}>知识库注入 · {selectedKbFileIds.size} 个</div>
              <div style={{ flexShrink: 0, display: 'flex', gap: 4, marginBottom: 4 }}>
                <button onClick={async () => { const files = await loadKBFiles(); if (files.length > 0) selectIds(setSelectedKbFileIds, files.map(f => f.id)) }} style={miniActionLink}>全选</button>
                <button onClick={() => selectIds(setSelectedKbFileIds, [])} style={miniActionLink}>清空</button>
                <button onClick={loadKBFiles} style={{ ...miniActionLink, display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                  <BookOpenIcon style={{ width: 10, height: 10 }} />
                  {kbLoaded ? `已加载 ${kbFiles.length}` : '加载'}
                </button>
              </div>
              {kbLoaded && kbFiles.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, overflowY: 'auto', flex: 1, alignContent: 'flex-start' }} className="custom-scrollbar">
                  {kbFiles.map(f => (
                    <label key={f.id} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 3, padding: '3px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                      background: selectedKbFileIds.has(f.id) ? 'rgba(124,58,237,0.06)' : '#fff',
                      border: selectedKbFileIds.has(f.id) ? '1px solid rgba(124,58,237,0.18)' : '1px solid rgba(0,0,0,0.05)',
                    }}>
                      <input type="checkbox" checked={selectedKbFileIds.has(f.id)} onChange={() => toggleId(setSelectedKbFileIds, f.id)} style={checkInput} />
                      {f.originalName.slice(0, 20)}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right column */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
            {/* Template */}
            <div className="section-card" style={{ ...cardStyle, padding: '14px 16px', flex: 2, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ ...cardHeaderStyle, fontSize: 13, flexShrink: 0 }}>生成模板</div>
              <select value={selectedChapterPromptId} onChange={e => handleSwitchChapterPrompt(e.target.value)}
                style={{ width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid rgba(0,0,0,0.08)', fontSize: 13, cursor: 'pointer', marginBottom: 6, fontFamily: 'inherit', background: '#faf9f8' }}>
                <option value={NONE_ID}>不使用模板（根据四层配置生成）</option>
                {chapterPrompts.map(p => (
                  <option key={p.id} value={p.id}>{p.enabled ? '✓ ' : ''}{p.title}</option>
                ))}
              </select>
              {chapterPrompt ? (
                <div style={{ fontSize: 11, color: '#7c3aed', padding: '6px 10px', borderRadius: 8, background: 'rgba(124,58,237,0.04)', lineHeight: 1.5 }}>
                  <span style={{ fontWeight: 600 }}>{chapterPrompt.title}</span> — {chapterPrompt.content.slice(0, 70)}...
                </div>
              ) : (
                <div style={{ fontSize: 11, color: '#9b8e84' }}>不使用模板 — AI 根据四层配置自行组织创作要求</div>
              )}
            </div>

            {/* Scene injection */}
            <div className="section-card" style={{ ...cardStyle, padding: '14px 16px', flex: 3, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ ...cardHeaderStyle, fontSize: 13, flexShrink: 0 }}>场景注入</div>
              <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                {(['all', '情色小说', '普通小说'] as const).map(t => (
                  <button key={t} onClick={() => { setSceneFilterType(t); setSelectedSceneId('') }} style={{
                    padding: '3px 10px', borderRadius: 5, border: sceneFilterType === t ? '1px solid #7c3aed' : '1px solid rgba(0,0,0,0.05)',
                    background: sceneFilterType === t ? 'rgba(124,58,237,0.06)' : '#f8f7f5', cursor: 'pointer', fontSize: 12,
                    color: sceneFilterType === t ? '#7c3aed' : '#6b5e54', fontFamily: 'inherit',
                  }}>{t === 'all' ? '全部' : t === '情色小说' ? '情色' : '普通'}</button>
                ))}
              </div>
              <select value={selectedSceneId} onChange={e => setSelectedSceneId(e.target.value)} style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.08)', fontSize: 13, cursor: 'pointer', marginBottom: 6, fontFamily: 'inherit', background: '#faf9f8' }}>
                <option value="">— 不注入 —</option>
                {sceneTemplates.filter(t => sceneFilterType === 'all' || t.type === sceneFilterType).map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              {selectedScene && (
                <div style={{ padding: '6px 10px', borderRadius: 8, background: 'rgba(124,58,237,0.02)', border: '1px solid rgba(124,58,237,0.06)', fontSize: 10, overflow: 'auto', flex: 1, color: '#4a3f38', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                  {buildScenePrompt(selectedScene)}
                </div>
              )}
            </div>

            {/* Style template */}
            <div className="section-card" style={{ ...cardStyle, padding: '14px 16px', flex: 3, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ ...cardHeaderStyle, fontSize: 13, flexShrink: 0 }}>风格模板</div>
              <select value={selectedStyleTemplateId} onChange={e => setSelectedStyleTemplateId(e.target.value)} style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.08)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', background: '#faf9f8' }}>
                <option value="">— 不注入 —</option>
                {styleTemplates.map((t: any) => (
                  <option key={t.id} value={t.id}>{t.name || '未命名'}</option>
                ))}
              </select>
              <div style={{ display: 'flex', gap: 6, marginTop: 4, alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: '#9b8e84' }}>强度:</span>
                {(['light','normal','strong'] as const).map(s => (
                  <button key={s} onClick={() => updateCg({ styleStrength: s })}
                    style={{
                      padding: '3px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                      background: (cg.styleStrength || 'normal') === s ? 'rgba(124,58,237,0.08)' : 'transparent',
                      border: (cg.styleStrength || 'normal') === s ? '1px solid rgba(124,58,237,0.2)' : '1px solid rgba(0,0,0,0.06)',
                      color: (cg.styleStrength || 'normal') === s ? '#7c3aed' : '#9b8e84',
                      fontWeight: (cg.styleStrength || 'normal') === s ? 600 : 400,
                    }}
                  >{s === 'light' ? '轻' : s === 'normal' ? '中' : '强'}</button>
                ))}
              </div>
              {selectedStyleTemplate && (
                <div style={{ padding: '6px 10px', marginTop: 6, borderRadius: 8, background: 'rgba(236,72,153,0.03)', border: '1px solid rgba(236,72,153,0.06)', fontSize: 10, overflow: 'auto', flex: 1, color: '#4a3f38', lineHeight: 1.5 }}>
                  {(() => {
                    const t = selectedStyleTemplate
                    const parts: string[] = []
                    if (t.tone?.word) parts.push(`基调: ${t.tone.word}`)
                    const dims = t.dimensions || {}
                    const keys = Object.keys(dims).filter(k => dims[k]?.description)
                    if (keys.length > 0) {
                      parts.push(keys.slice(0, 4).map(k => `${k}: ${(dims[k].description || '').slice(0, 40)}`).join('；'))
                    }
                    if (t.fullDescription) parts.push(t.fullDescription.slice(0, 100))
                    if (t.description && parts.length === 0) parts.push(t.description.slice(0, 100))
                    return parts.length > 0 ? parts.join(' | ') : '⚠️ 此模板无有效维度数据，建议更换或先填充维度'
                  })()}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* === SECTION 3: Output settings (compact row) === */}
        <div className="section-card" style={{ padding: '14px 20px', borderRadius: 14, background: 'linear-gradient(135deg, rgba(0,0,0,0.01), rgba(0,0,0,0.02))', border: '1px solid rgba(0,0,0,0.06)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
            {/* Word target */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#6b5e54', whiteSpace: 'nowrap' }}>目标字数</span>
              <input type="number" step={100} value={wordTarget} onChange={e => setWordTarget(parseInt(e.target.value) || 0)}
                onBlur={e => { const v = parseInt(e.target.value); if (v < 500 || v > 50000) setWordTarget(4000) }}
                style={{ width: 80, padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', fontSize: 13, fontFamily: 'inherit', textAlign: 'center' }} />
              <span style={{ fontSize: 11, color: '#9b8e84' }}>字</span>
            </div>
            <div style={{ width: 1, height: 24, background: 'rgba(0,0,0,0.08)' }} />
            {/* Output mode */}
            <label title="逐字实时输出生成内容到编辑器，可随时停止" style={{ ...checkLabel, fontSize: 12, gap: 4 }}><input type="checkbox" checked={streamMode} onChange={() => setStreamMode(!streamMode)} style={checkInput} /> 流式生成</label>
            <label title="勾选：AI生成内容替换当前章节原文；不勾选：追加在原文后面" style={{ ...checkLabel, fontSize: 12, gap: 4 }}><input type="checkbox" checked={replaceMode} onChange={() => setReplaceMode(!replaceMode)} style={checkInput} /> 替换正文</label>
            <div style={{ width: 1, height: 24, background: 'rgba(0,0,0,0.08)' }} />
            {/* Model selector */}
            <select value={genConfigId} onChange={e => setGenConfigId(e.target.value)} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', fontSize: 12, fontFamily: 'inherit', background: '#faf9f8', cursor: 'pointer', maxWidth: 200 }}>
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 220 }}>
                  <span title="控制AI输出随机性：0=精准确定（适合事实性内容），2=最大创意（适合文学创作）" style={{ fontSize: 12, fontWeight: 600, color: '#6b5e54', whiteSpace: 'nowrap', cursor: 'help' }}>温度</span>
                  <button onClick={() => saveTemp(Math.max(0, curTemp - 0.1))}
                    style={{ width: 22, height: 22, borderRadius: '50%', border: '1px solid rgba(0,0,0,0.1)', background: '#fff', cursor: 'pointer', fontSize: 14, color: '#6b5e54', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit', lineHeight: 1 }}>−</button>
                  {/* Draggable slider bar */}
                  <div onMouseDown={handleSliderDown}
                    style={{ flex: 1, height: 20, borderRadius: 4, background: 'linear-gradient(90deg, #3b82f6 0%, #7c3aed 33%, #f59e0b 66%, #ef4444 100%)', position: 'relative', cursor: 'ew-resize', maxWidth: 140 }}>
                    {/* Center track line */}
                    <div style={{ position: 'absolute', left: 4, right: 4, top: '50%', transform: 'translateY(-50%)', height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.35)' }} />
                    {/* Thumb */}
                    <div style={{ position: 'absolute', left: `calc(${pct}% - 8px)`, top: 2, width: 16, height: 16, borderRadius: '50%', background: tempColor, border: '2px solid #fff', boxShadow: '0 1px 6px rgba(0,0,0,0.3)', transition: 'left 0.15s', pointerEvents: 'none' }} />
                  </div>
                  <button onClick={() => saveTemp(Math.min(2, curTemp + 0.1))}
                    style={{ width: 22, height: 22, borderRadius: '50%', border: '1px solid rgba(0,0,0,0.1)', background: '#fff', cursor: 'pointer', fontSize: 14, color: '#6b5e54', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit', lineHeight: 1 }}>+</button>
                  <span style={{ fontSize: 13, fontWeight: 700, color: tempColor, minWidth: 48, textAlign: 'center' }}>{curTemp.toFixed(1)}°C</span>
                  <span style={{ fontSize: 10, fontWeight: 600, color: tempColor, background: `${tempColor}14`, padding: '1px 6px', borderRadius: 4 }}>{tempLabel}</span>
                </div>
              )
            })()}
          </div>
          {streamMode && <div style={{ marginTop: 6, fontSize: 10, color: '#16a34a' }}>流式输出已启用 — 内容将逐字输出到编辑器</div>}
        </div>

        {/* Streaming progress */}
        {loading && streamMode && (
          <div style={{ padding: '12px 16px', borderRadius: 14, background: 'linear-gradient(135deg, rgba(124,58,237,0.03), rgba(168,85,247,0.05))', border: '1px solid rgba(124,58,237,0.1)', flexShrink: 0 }}>
            {!streamContent ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center' }}>
                <div style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid rgba(124,58,237,0.15)', borderTopColor: '#7c3aed', animation: 'spin 0.7s linear infinite' }} />
                <span style={{ fontSize: 12, color: '#7c3aed', fontWeight: 600 }}>等待 AI 响应...</span>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#7c3aed', marginBottom: 6 }}>
                  生成中 · {streamChars.toLocaleString()} 字 {streamDone && '✓ 完成'}
                </div>
                <div style={{ fontSize: 12, lineHeight: 1.6, color: '#4a3f38', whiteSpace: 'pre-wrap', maxHeight: 180, overflowY: 'auto' }} className="custom-scrollbar">
                  {streamContent.slice(-500)}
                </div>
                {streamDone && streamUsage && (
                  <div style={{ fontSize: 10, color: '#6b5e54', marginTop: 4 }}>
                    Token: 入{streamUsage.prompt_tokens} 出{streamUsage.completion_tokens} 总{streamUsage.total_tokens} | 花费 {useSettingsStore.getState().configs.find(c => c.id === genConfigId)?.currency === 'CNY' ? '¥' : '$'}{streamUsage.cost.toFixed(4)}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {error && (
          <div style={{ padding: '10px 14px', borderRadius: 12, background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.12)', color: '#dc2626', fontSize: 12, lineHeight: 1.5, flexShrink: 0 }}>{error}</div>
        )}

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, paddingTop: 8, borderTop: '1px solid rgba(0,0,0,0.05)', flexShrink: 0 }}>
          <button onClick={onClose} disabled={loading && !streamDone} style={{
            padding: '10px 28px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.08)',
            background: '#fff', cursor: loading && !streamDone ? 'not-allowed' : 'pointer',
            fontSize: 14, fontWeight: 600, color: '#6b5e54', fontFamily: 'inherit',
          }}>取消</button>
          {loading && streamMode && !streamDone ? (
            <button onClick={handleCancelStream} style={{
              padding: '10px 28px', borderRadius: 10, border: 'none',
              background: 'linear-gradient(135deg, #ef4444, #dc2626)', cursor: 'pointer',
              fontSize: 14, fontWeight: 600, color: '#fff', fontFamily: 'inherit',
            }}>停止生成</button>
          ) : (
            <button className="gen-btn" onClick={handleGenerate} disabled={loading || !genConfigId} style={{
              padding: '10px 34px', borderRadius: 10, border: 'none',
              background: loading || !genConfigId ? 'linear-gradient(135deg, #c4b5e3, #d4c4f3)' : 'linear-gradient(135deg, #7c3aed, #a855f7)',
              cursor: loading || !genConfigId ? 'not-allowed' : 'pointer',
              fontSize: 14, fontWeight: 700, color: '#fff', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', gap: 6,
              animation: loading || !genConfigId ? 'none' : 'glow-pulse 2.5s ease-in-out infinite',
              opacity: loading || !genConfigId ? 0.6 : 1,
            }}>
              <SparklesIcon style={{ width: 15, height: 15 }} />
              {loading ? '生成中...' : `生成 (~${wordTarget}字)`}
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}
