import { useState, useEffect, useRef } from 'react'
import { useStore, useSettingsStore } from '@/store'
import { aiService, kbService, fileService, templateService, styleTemplateService } from '@/services/fileService'
import { buildStylePrompt, convertTemplateToProfile } from '@/utils/styleInjector'
import Modal from './Modal'
import Button from './Button'
import { SparklesIcon, BookOpenIcon } from '@heroicons/react/24/outline'
import type { DetailedChapter, ChapterStatus } from '@/types/chapter'
import type { SceneTemplate, EroticSceneConfig, NovelSceneConfig } from '@/types/story'
import { logError } from '@/utils/logger'

interface Props {
  isOpen: boolean
  onClose: () => void
  chapterId: string
  currentContent: string
  onApply: (content: string) => void
  onVersionSaved: (version: VersionRecord) => void
  // Overlay mode callbacks (for non-blocking generation UX)
  onGenStart?: () => void
  onGenChunk?: (data: { accumulated: string; charCount: number }) => void
  onGenDone?: () => void
  onGenError?: (msg: string) => void
  // Expose abort function to parent for cancel button in overlay
  externalAbortRef?: React.MutableRefObject<(() => void) | null>
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
  incomplete: '未完成', completed: '已完成',
}

export async function saveVersionRecord(projectPath: string, chapterId: string, record: VersionRecord) {
  const id = `v_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const version = { ...record, versionId: id }
  const dir = `${projectPath}/chapters/${chapterId}_versions`
  await fileService.ensureDir(dir)
  await fileService.write(`${dir}/${id}.json`, JSON.stringify(version, null, 2))
  return id
}

export default function ChapterGenerationModal({ isOpen, onClose, chapterId, currentContent, onApply, onVersionSaved, onGenStart, onGenChunk, onGenDone, onGenError, externalAbortRef }: Props) {
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

  // Scene template injection
  const [sceneTemplates, setSceneTemplates] = useState<SceneTemplate[]>([])
  const [selectedSceneId, setSelectedSceneId] = useState('')
  const [sceneFilterType, setSceneFilterType] = useState<'all' | 'erotic' | 'novel'>('all')
  const [styleTemplates, setStyleTemplates] = useState<any[]>([])
  const [selectedStyleTemplateId, setSelectedStyleTemplateId] = useState('')
  const selectedStyleTemplate = selectedStyleTemplateId ? styleTemplates.find((t: any) => t.id === selectedStyleTemplateId) : null

  useEffect(() => {
    if (isOpen) {
      setError(''); setStreamContent(''); setStreamChars(0); setStreamDone(false); setStreamUsage(undefined)
      templateService.list().then(list => setSceneTemplates(Array.isArray(list) ? list : [])).catch(() => setSceneTemplates([]))
      styleTemplateService.list().then(list => setStyleTemplates(Array.isArray(list) ? list : [])).catch(() => setStyleTemplates([]))
    }
  }, [isOpen])

  const selectedScene = selectedSceneId ? sceneTemplates.find(t => t.id === selectedSceneId) : null

  const ROLE_LABELS: Record<string, string> = { dom: '主导', sub: '服从', switch: 'Switch', observer: '旁观' }

  const buildScenePrompt = (tpl: SceneTemplate): string => {
    const auto = tpl.config.autoFields || {}
    const a = (field: string) => !!auto[field]
    const autoLabel = (field: string, label: string) => a(field) ? `【${label}：AI根据上下文自主决定】` : null

    if (tpl.type === 'erotic') {
      const ec = tpl.config as EroticSceneConfig
      const parts: string[] = []
      if (a('characters')) parts.push('【角色状态：AI根据上下文自主决定】')
      else {
        const charLines: string[] = []
        if (ec.characters?.length > 0) charLines.push(ec.characters.map(c => `${c.characterName}: ${ROLE_LABELS[c.role] || c.role}, ${c.bodyState}${c.customNote ? ', ' + c.customNote : ''}`).join('\n'))
        if (ec.customCharacters?.length > 0) charLines.push(ec.customCharacters.map(c => `${c.name}: ${c.role}, ${c.bodyState}${c.note ? ', ' + c.note : ''}`).join('\n'))
        if (charLines.length > 0) parts.push('【角色状态】\n' + charLines.join('\n'))
      }
      const sceneLine = autoLabel('location', '场景') || `【场景】${ec.location || ''} | ${ec.time || ''} | ${ec.atmosphere || ''} | ${ec.publicity || ''}`
      parts.push(sceneLine)
      if (a('selectedKinks')) parts.push('【玩法：AI根据上下文自主决定】')
      else if (ec.selectedKinks?.length > 0) {
        let kinkLine = `【玩法】${ec.selectedKinks.join('、')}${ec.kinkNote ? ' | ' + ec.kinkNote : ''}`
        const intensities = ec.kinkIntensities || {}
        const intensityParts = Object.entries(intensities).filter(([, v]) => v && v !== '标准').map(([k, v]) => `${k}:${v}`)
        if (intensityParts.length > 0) kinkLine += ` | 强度: ${intensityParts.join('、')}`
        parts.push(kinkLine)
      }
      if (a('opening')) parts.push('【起始：AI根据上下文自主决定】')
      else if (ec.opening?.length > 0) parts.push(`【起始】${ec.opening.join('、')}`)
      parts.push(a('mainPose') ? '【主戏：AI根据上下文自主决定】' : `【主戏】姿势: ${ec.mainPose || ''} | 节奏: ${ec.mainRhythm || ''} | 转换: ${ec.poseChanges || ''}`)
      if (a('climax')) parts.push('【高潮：AI根据上下文自主决定】')
      else if (ec.climax?.length > 0) parts.push(`【高潮】${ec.climax.join('、')}`)
      if (a('aftermath')) parts.push('【余韵：AI根据上下文自主决定】')
      else if (ec.aftermath?.length > 0) parts.push(`【余韵】${ec.aftermath.join('、')}`)
      if (!a('extraPhases') && ec.extraPhases?.length > 0) parts.push(`【自定义阶段】${ec.extraPhases.map(p => `${p.name}: ${p.desc}`).join(' | ')}`)
      if (!a('bodyFluidFocus') && ec.bodyFluidFocus?.length) parts.push(`【体液】${ec.bodyFluidFocus.join('、')}`)
      if (!a('bodyPartFocus') && ec.bodyPartFocus?.length) parts.push(`【身体焦点】${ec.bodyPartFocus.join('、')}`)
      if (!a('tactileFocus') && ec.tactileFocus?.length) parts.push(`【触感焦点】${ec.tactileFocus.join('、')}`)
      if (!a('sensoryAnchors') && ec.sensoryAnchors) parts.push(`【感官锚点】${ec.sensoryAnchors}`)
      if (!a('bodyLanguage') && ec.bodyLanguage) parts.push(`【非言语表达】${ec.bodyLanguage}`)
      if (!a('degradeLangs') && ec.degradeLangs?.length) {
        let degradeLine = `【侮辱词】${ec.degradeLangs.join('、')}`
        if (ec.customDegradeLangs?.length) degradeLine += ' | 自定义:' + ec.customDegradeLangs.join(',')
        if (ec.customInsults) degradeLine += ' | 补充:' + ec.customInsults
        parts.push(degradeLine)
      }
      if (!a('bannedWords') && ec.bannedWords) parts.push(`【禁用词】${ec.bannedWords}`)
      parts.push(a('soundDensity') ? '【声音：AI根据上下文自主决定】' : `【声音】密度: ${ec.soundDensity || ''} | 呻吟: ${ec.moanStyle || ''}`)
      if (a('dominantEmotion')) parts.push('【情绪：AI根据上下文自主决定】')
      else if (ec.dominantEmotion) parts.push(`【情绪】${ec.dominantEmotion}${ec.emotionCurveInput ? ' | 曲线: ' + ec.emotionCurveInput : ''}${ec.triggerWords ? ' | 触发: ' + ec.triggerWords : ''}`)
      if (a('narrativeStyle')) parts.push('【叙事：AI根据上下文自主决定】')
      else if (ec.narrativeStyle) parts.push(`【叙事】${ec.narrativeStyle} | 时间: ${ec.timeCompression || ''} | 内省: ${ec.introspection || ''}`)
      if (!a('worldRules') && (ec.worldRules || ec.propList || ec.costumeList)) parts.push(`【特殊设定】${[ec.worldRules, ec.propList, ec.costumeList].filter(Boolean).join(' | ')}`)
      parts.push(a('intensity') ? '【强度：AI根据上下文自主决定】' : `【强度】${ec.intensity}/5 | ${ec.narrativePOV || ''}`)
      if (a('pacing')) parts.push('【节奏：AI根据上下文自主决定】')
      else if (ec.pacing) parts.push(`【节奏】${ec.pacing}`)
      if (a('consentDynamic')) parts.push('【同意动态：AI根据上下文自主决定】')
      else if (ec.consentDynamic) parts.push(`【同意动态】${ec.consentDynamic}`)
      if (a('aftercareDetail')) parts.push('【事后关怀：AI根据上下文自主决定】')
      else if (ec.aftercareDetail) parts.push(`【事后关怀】${ec.aftercareDetail}`)
      if (!a('extraNote') && ec.extraNote) parts.push('【额外要求】' + ec.extraNote)
      return parts.join('\n')
    } else {
      const nc = tpl.config as NovelSceneConfig
      const parts: string[] = []
      parts.push(a('sceneType') ? '【场景类型：AI根据上下文自主决定】' : `【场景类型】${nc.sceneType} | ${(nc.scenePurpose || []).join('、')} | ${nc.conflictType}`)
      if (a('povCharacterId')) parts.push('【主视角：AI根据上下文自主决定】')
      else if (nc.povCharacterName) parts.push(`【主视角】${nc.povCharacterName}`)
      if (a('characters')) parts.push('【角色情绪：AI根据上下文自主决定】')
      else if (nc.characters?.length > 0) parts.push('【角色情绪】\n' + nc.characters.map(c => `${c.characterName}: ${c.emotion || ''}`).join('\n'))
      parts.push(a('location') ? '【环境：AI根据上下文自主决定】' : `【环境】${nc.location} / ${nc.weather || ''} / ${nc.time || ''} / ${nc.atmosphere || ''} / 感官: ${(nc.senses || []).join('、')}`)
      if (a('genreElements')) parts.push('【类型要素：AI根据上下文自主决定】')
      else if (nc.genreElements?.length) parts.push(`【类型要素】${nc.genreElements.join('、')}`)
      parts.push(a('dialogueRatio') ? '【对话：AI根据上下文自主决定】' : `【对话】${nc.dialogueRatio || ''} | 潜台词: ${nc.subtextLevel || ''} | ${nc.sentenceStyle || ''} | 段落: ${nc.paragraphDensity || ''}`)
      parts.push(a('wordTarget') ? '【篇幅：AI根据上下文自主决定】' : `【篇幅】${nc.wordTarget}字 | ${nc.narrativePOV || ''}`)
      if (a('emotionStart')) parts.push('【情绪：AI根据上下文自主决定】')
      else if (nc.emotionStart) parts.push(`【情绪】${nc.emotionStart}→${nc.emotionEnd || ''}`)
      if (a('narrativeStyle')) parts.push('【叙事技法：AI根据上下文自主决定】')
      else if (nc.narrativeStyle) parts.push(`【叙事技法】${nc.narrativeStyle} | 时间: ${nc.timeCompression || ''} | 内省: ${nc.introspection || ''}`)
      if (a('dominantEmotion')) parts.push('【情绪设计：AI根据上下文自主决定】')
      else if (nc.dominantEmotion || nc.pacing) parts.push(`【情绪设计】${nc.dominantEmotion || ''} | 节奏: ${nc.pacing || ''}${nc.emotionCurveInput ? ' | 曲线: ' + nc.emotionCurveInput : ''}`)
      if (a('sensoryAnchors')) parts.push('【感官细节：AI根据上下文自主决定】')
      else if (nc.sensoryAnchors || nc.props || nc.appearance || nc.bodyLanguage) parts.push(`【感官细节】${[nc.sensoryAnchors && '锚点:' + nc.sensoryAnchors, nc.props && '道具:' + nc.props, nc.appearance && '外观:' + nc.appearance, nc.bodyLanguage && '肢体:' + nc.bodyLanguage].filter(Boolean).join(' | ')}`)
      if (a('foreshadowUse')) parts.push('【伏笔转折：AI根据上下文自主决定】')
      else if (nc.foreshadowUse && nc.foreshadowUse !== '无') parts.push(`【伏笔转折】${nc.foreshadowUse}${nc.sceneTurningPoint ? ' | 转折: ' + nc.sceneTurningPoint : ''}`)
      if (!a('extraNote') && nc.extraNote) parts.push('【额外要求】' + nc.extraNote)
      return parts.join('\n')
    }
  }

  // Abort stream on unmount
  useEffect(() => {
    return () => { abortRef.current?.(); if (externalAbortRef) externalAbortRef.current = null }
  }, [])

  const chapterPrompt = prompts.find(p => p.type === '章节' && p.enabled)

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

  const buildPrompt = () => {
    const parts: string[] = []

    if (useWorldbuilding && worldbuildingContent) {
      parts.push(`【世界观设定】\n${worldbuildingContent.slice(0, 30000)}\n`)
    }
    if (useOutline && outlineContent) {
      parts.push(`【小说大纲】\n${outlineContent.slice(0, 15000)}\n`)
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

    // Inject scene template
    if (selectedScene) {
      const scenePrompt = buildScenePrompt(selectedScene)
      parts.push('【场景模板注入】\n' + scenePrompt)
    }

    // Inject style template
    if (selectedStyleTemplateId && selectedStyleTemplate) {
      try {
        const stylePrompt = buildStylePrompt(convertTemplateToProfile(selectedStyleTemplate))
        if (stylePrompt) parts.unshift('---\n' + stylePrompt + '\n---')
      } catch { /* skip */ }
    }

    const template = chapterPrompt?.content || '根据以上设定和细纲，写出一章完整的小说正文。正文用空行分隔自然段，禁止全文一堆到底。'
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
        // Close config modal, show overlay
        onGenStart?.()
        onClose()
        // Stream & write each chunk to editor immediately
        const streamHandle = aiService.chatStream(
          messages, genConfigId, activeProjectId || undefined,
          (data) => {
            setStreamContent(data.accumulated); setStreamChars(data.accumulated.length)
            // Write to editor in real-time
            const liveContent = replaceMode ? data.accumulated : (currentContent ? currentContent + '\n\n' + data.accumulated : data.accumulated)
            onApply(liveContent)
            onGenChunk?.({ accumulated: data.accumulated, charCount: data.accumulated.length })
          },
          (data) => {
            abortRef.current = null
            if (externalAbortRef) externalAbortRef.current = null
            setStreamDone(true)
            setStreamUsage(data.usage)
            saveVersion({
              config, reply: data.text,
              usage: data.usage ? { input: data.usage.prompt_tokens, output: data.usage.completion_tokens, total: data.usage.total_tokens } : { input: 0, output: 0, total: 0 },
              cost: data.usage?.cost || 0,
            }).catch(err => logError('保存版本记录失败', err))
            setLoading(false)
            onGenDone?.()
          },
          (err) => { abortRef.current = null; if (externalAbortRef) externalAbortRef.current = null; setError(err.message); setLoading(false); onGenError?.(err.message) },
          (data) => { abortRef.current = null; if (externalAbortRef) externalAbortRef.current = null; setError(data.message); setLoading(false); onGenError?.(data.message) },
        )
        abortRef.current = streamHandle.abort
        if (externalAbortRef) externalAbortRef.current = streamHandle.abort
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
        }).catch(err => logError('保存版本记录失败', err))
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
    if (externalAbortRef) externalAbortRef.current = null
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
              <button onClick={async () => { const files = await loadKBFiles(); if (files.length > 0) selectIds(setSelectedKbFileIds, files.map(f => f.id)) }} style={actionLink}>全选</button>
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

        {/* F: Scene template injection */}
        <div style={{ padding: '10px 14px', borderRadius: 10, background: '#faf9f8' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#6b5e54', marginBottom: 8 }}>F. 场景注入</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            {(['all', 'erotic', 'novel'] as const).map(t => (
              <button key={t} onClick={() => { setSceneFilterType(t); setSelectedSceneId('') }} style={{
                padding: '3px 8px', borderRadius: 6, border: sceneFilterType === t ? '1px solid #7c3aed' : '1px solid rgba(0,0,0,0.08)',
                background: sceneFilterType === t ? 'rgba(124,58,237,0.06)' : '#fff', cursor: 'pointer', fontSize: 10,
                color: sceneFilterType === t ? '#7c3aed' : '#6b5e54',
              }}>{t === 'all' ? '全部' : t === 'erotic' ? '情色' : '普通'}</button>
            ))}
          </div>
          <select value={selectedSceneId} onChange={e => setSelectedSceneId(e.target.value)} style={{ width: '100%', padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', fontSize: 12, cursor: 'pointer', marginBottom: 6 }}>
            <option value="">-- 不注入场景模板 --</option>
            {sceneTemplates.filter(t => sceneFilterType === 'all' || t.type === sceneFilterType).map(t => (
              <option key={t.id} value={t.id}>{t.name} ({t.type === 'erotic' ? '情色' : '普通'})</option>
            ))}
          </select>
          {selectedScene && (
            <div style={{ padding: '6px 10px', borderRadius: 6, background: 'rgba(124,58,237,0.03)', border: '1px solid rgba(124,58,237,0.08)', fontSize: 10, maxHeight: 200, overflow: 'auto', color: '#4a3f38', whiteSpace: 'pre-wrap' }}>
              {buildScenePrompt(selectedScene)}
            </div>
          )}
        </div>

        {/* G: Style template injection */}
        <div style={{ padding: '10px 14px', borderRadius: 10, background: '#faf9f8' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#6b5e54', marginBottom: 8 }}>G. 风格模板</div>
          <select value={selectedStyleTemplateId} onChange={e => setSelectedStyleTemplateId(e.target.value)} style={{ width: '100%', padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', fontSize: 12, cursor: 'pointer', marginBottom: 6 }}>
            <option value="">-- 不注入风格模板 --</option>
            {styleTemplates.map((t: any) => (
              <option key={t.id} value={t.id}>{t.name || '未命名'} ({t.type === '情色小说' ? '情色' : '普通'} · {Object.keys(t.dimensions || {}).length}维)</option>
            ))}
          </select>
          {selectedStyleTemplate && (
            <div style={{ padding: '6px 10px', borderRadius: 6, background: 'rgba(236,72,153,0.03)', border: '1px solid rgba(236,72,153,0.08)', fontSize: 10, maxHeight: 120, overflow: 'auto', color: '#4a3f38' }}>
              <span style={{ fontWeight: 600 }}>{selectedStyleTemplate.tone?.word && `基调: ${selectedStyleTemplate.tone.word} | `}</span>
              {selectedStyleTemplate.description || selectedStyleTemplate.fullDescription?.slice(0, 120) || '已加载风格模板'}
            </div>
          )}
        </div>

        {/* H: Word target */}
        <div style={{ padding: '10px 14px', borderRadius: 10, background: '#faf9f8' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#6b5e54', marginBottom: 8 }}>H. 字数目标</div>
          <input type="number" min={500} max={50000} step={100} value={wordTarget} onChange={e => setWordTarget(Math.max(500, Math.min(50000, parseInt(e.target.value) || 500)))} style={{ width: 120, padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', fontSize: 13, fontFamily: 'inherit' }} />
          <span style={{ fontSize: 11, color: '#9b8e84', marginLeft: 8 }}>字 (500-50000)</span>
        </div>

        {/* I: Output mode + config */}
        <div style={{ padding: '10px 14px', borderRadius: 10, background: '#faf9f8' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#6b5e54', marginBottom: 8 }}>I. 输出模式与配置</div>
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
                Token: 入{streamUsage.prompt_tokens} 出{streamUsage.completion_tokens} 总{streamUsage.total_tokens} | 花费 {useSettingsStore.getState().configs.find(c => c.id === genConfigId)?.currency === 'CNY' ? '¥' : '$'}{streamUsage.cost.toFixed(4)}
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
