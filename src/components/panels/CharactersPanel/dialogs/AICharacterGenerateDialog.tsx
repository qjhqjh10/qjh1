import { useState, useEffect } from 'react'
import Modal from '@/components/common/Modal'
import Button from '@/components/common/Button'
import { SparklesIcon } from '@heroicons/react/24/outline'
import type { ModelConfig, PromptTemplate } from '@/types/settings'
import type { OutlineTabToggles, DetailedOutlineToggles } from '@/types/settings'
import type { Character } from '@/types/character'
import type { DetailedChapter } from '@/types/chapter'
import { loadOutlineDimensions } from '@/utils/outlineData'
import { loadAllSummaries } from '@/services/summaryService'
import { useStore, useSettingsStore } from '@/store'
import { checkInput, miniActionLink } from '@/components/common/ChapterGenerationModal/constants'

interface AICharacterGenerateDialogProps {
  isOpen: boolean
  aiGenDesc: string
  aiGenConfigId: string | null
  aiGenLoading: boolean
  aiGenImageNote: string
  aiGenPromptId: string
  configs: ModelConfig[]
  promptTemplates: PromptTemplate[]
  activeConfigId: string | null
  characters: Character[]
  outlineContent: string
  detailedChapters: DetailedChapter[]
  currentChapterId?: string
  onClose: () => void
  onDescChange: (v: string) => void
  onConfigChange: (v: string) => void
  onPromptChange: (v: string) => void
  onGenerate: (referenceContext: string) => void
}

const OUTLINE_TABS: [keyof OutlineTabToggles, string][] = [
  ['plot', '故事剧情'], ['worldbuilding', '世界观'], ['characters', '角色'],
  ['items', '道具'], ['locations', '地点'], ['factions', '势力'],
  ['powerSystem', '等级'], ['foreshadowing', '伏笔'], ['emotion', '情绪'],
  ['plotThreads', '故事线'],
]

const DETAILED_FIELDS: [keyof DetailedOutlineToggles, string][] = [
  ['plotOverview', '剧情概述'], ['chapterCharacters', '出场角色'],
  ['location', '场景地点'], ['keyEvents', '关键事件'],
  ['eroticContent', '情色剧情'],
]

const NONE_ID = '__none__'

type SetIdsDispatch = (action: Set<string> | ((prev: Set<string>) => Set<string>)) => void

function toggleId(setter: SetIdsDispatch, id: string) {
  setter((prev: Set<string>) => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })
}

function selectIds(setter: SetIdsDispatch, ids: string[]) {
  setter(new Set(ids))
}

export function AICharacterGenerateDialog({
  isOpen, aiGenDesc, aiGenConfigId, aiGenLoading, aiGenImageNote,
  aiGenPromptId, configs, promptTemplates, activeConfigId,
  characters, outlineContent, detailedChapters, currentChapterId,
  onClose, onDescChange, onConfigChange, onPromptChange, onGenerate,
}: AICharacterGenerateDialogProps) {
  const activeProjectId = useStore(s => s.activeProjectId)
  const projectsBasePath = useStore(s => s.projectsBasePath)

  const selectedPromptId = aiGenPromptId || NONE_ID
  const rp = selectedPromptId !== NONE_ID ? promptTemplates.find(p => p.id === selectedPromptId) : null
  const availablePrompts = promptTemplates.filter(p => p.enabled && p.type === '角色')

  // Right panel state
  const cg = useSettingsStore(s => s.aiSettings).chapterGen
  const [outlineTabs, setOutlineTabs] = useState<OutlineTabToggles>(cg.outlineTabs)
  const [detailedOutlineFields, setDetailedOutlineFields] = useState<DetailedOutlineToggles>(cg.detailedOutlineFields)
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (isOpen) {
      setOutlineTabs(cg.outlineTabs)
      setDetailedOutlineFields(cg.detailedOutlineFields)
      setSelectedCharacterIds(new Set())
    }
  }, [isOpen])

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

  const handleGenerate = async () => {
    // Build reference context: priority 细纲 > 角色 > 大纲
    const parts: string[] = []
    const pp = `${projectsBasePath}/${activeProjectId}`

    // 1. 细纲 (highest priority)
    if (pp && activeProjectId && Object.values(detailedOutlineFields).some(Boolean)) {
      try {
        const currentChapter = currentChapterId
          ? detailedChapters.find(c => c.id === currentChapterId)
          : detailedChapters[0]
        if (currentChapter) {
          const summaries = await loadAllSummaries(pp, [currentChapter.id])
          const summary = summaries[currentChapter.id]
          if (summary) {
            const lines: string[] = []
            if (detailedOutlineFields.plotOverview) lines.push(`剧情概述: ${summary}`)
            if (detailedOutlineFields.chapterCharacters) {
              const chars = (currentChapter as any).chapterCharacters || (currentChapter as any).characters || ''
              if (chars) lines.push(`出场角色: ${Array.isArray(chars) ? chars.join('、') : chars}`)
            }
            if (detailedOutlineFields.location) {
              const loc = (currentChapter as any).location || ''
              if (loc) lines.push(`场景地点: ${loc}`)
            }
            if (detailedOutlineFields.keyEvents) {
              const events = (currentChapter as any).keyEvents || ''
              if (events) lines.push(`关键事件: ${events}`)
            }
            if (detailedOutlineFields.eroticContent) {
              const erotic = (currentChapter as any).eroticContent || ''
              if (erotic) lines.push(`情色剧情: ${erotic}`)
            }
            if (lines.length > 0) parts.push(`【细纲参考】\n${lines.join('\n')}`)
          }
        }
      } catch { /* ignore */ }
    }

    // 2. 角色 (medium priority) - only selected characters
    if (selectedCharacterIds.size > 0) {
      const selectedChars = characters.filter(c => selectedCharacterIds.has(c.id))
      if (selectedChars.length > 0) {
        const charInfos = selectedChars.map(c => {
          const fields: string[] = [`名称: ${c.name}`]
          if (c.role) fields.push(`身份: ${c.role}`)
          if (c.personality) fields.push(`性格: ${c.personality}`)
          if (c.appearance) fields.push(`外貌: ${c.appearance}`)
          if (c.background) fields.push(`背景: ${c.background}`)
          if (c.abilities) fields.push(`能力: ${c.abilities}`)
          if (c.relationships) fields.push(`关系: ${c.relationships}`)
          return fields.join('\n')
        })
        parts.push(`【角色参考】\n${charInfos.join('\n---\n')}`)
      }
    }

    // 3. 大纲 (lowest priority)
    if (pp && activeProjectId && Object.values(outlineTabs).some(Boolean)) {
      try {
        const dims = await loadOutlineDimensions(pp, outlineTabs)
        const activeDims = Object.entries(dims).filter(([, v]) => v)
        if (activeDims.length > 0) {
          const outlineParts = activeDims.map(([k, v]) => {
            const label = OUTLINE_TABS.find(([key]) => key === k)?.[1] || k
            return `【${label}】\n${v}`
          })
          parts.push(`【大纲参考】\n${outlineParts.join('\n\n')}`)
        }
      } catch { /* ignore */ }
    }

    const referenceContext = parts.join('\n\n')
    onGenerate(referenceContext)
  }

  const sectionHeader: React.CSSProperties = {
    fontSize: 11, fontWeight: 600, color: '#4a3f38', marginBottom: 6,
    display: 'flex', alignItems: 'center', gap: 4,
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="AI 生成角色" width="90vw" draggable resizable>
      <div style={{ display: 'flex', gap: 16, height: '68vh', minHeight: 500 }}>
        {/* ===== 左栏：配置面板 ===== */}
        <div style={{ width: 380, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 14, overflow: 'auto', paddingRight: 4 }} className="custom-scrollbar">
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <label style={{ display: 'block', fontSize: 14, fontWeight: 600, color: '#2d2520', marginBottom: 6 }}>
              描述你需要的角色
            </label>
            <textarea
              value={aiGenDesc}
              onChange={e => onDescChange(e.target.value)}
              placeholder="例如：一个冷酷的剑客，曾是皇家护卫队长，因一场冤案被逐出师门，背负血海深仇寻找真相..."
              style={{
                width: '100%', border: '1px solid #e5e0da', borderRadius: 12, outline: 'none',
                resize: 'none', fontSize: 15, lineHeight: 1.9, fontFamily: 'inherit',
                color: '#1a1512', background: '#faf9f8', padding: 14, flex: 1, minHeight: 180,
              }}
              autoFocus
            />
          </div>

          {availablePrompts.length > 0 && (
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#6b5e54', marginBottom: 4 }}>
                提示词模板
              </label>
              <select
                value={selectedPromptId}
                onChange={e => onPromptChange(e.target.value)}
                style={{
                  width: '100%', padding: '8px 12px', fontSize: 13, borderRadius: 10,
                  border: '1px solid #e5e0da', outline: 'none', cursor: 'pointer',
                  background: '#faf9f8', fontFamily: 'inherit', color: '#2d2520',
                }}
              >
                <option value={NONE_ID}>不使用模板（AI 自行决定角色设定）</option>
                {availablePrompts.map(p => (
                  <option key={p.id} value={p.id}>{p.title} [{p.type}]</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#6b5e54', marginBottom: 4 }}>
              选择模型配置
            </label>
            <select
              value={aiGenConfigId || activeConfigId || ''}
              onChange={e => onConfigChange(e.target.value)}
              style={{
                width: '100%', padding: '8px 12px', fontSize: 13, borderRadius: 10,
                border: '1px solid #e5e0da', outline: 'none', cursor: 'pointer',
                background: '#faf9f8', fontFamily: 'inherit', color: '#2d2520',
              }}
            >
              {configs.map(c => (
                <option key={c.id} value={c.id}>{c.name} ({c.model})</option>
              ))}
            </select>
          </div>

          <div style={{
            fontSize: 12, color: rp ? '#7c3aed' : '#9b8e84',
            padding: '8px 12px', borderRadius: 8, background: rp ? 'rgba(124,58,237,0.04)' : '#f5f2f0',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <SparklesIcon style={{ width: 14, height: 14 }} />
            {rp ? `已加载提示词: ${rp.title}` : '未启用角色提示词，将使用默认格式'}
          </div>

          {!aiGenConfigId && !activeConfigId && (
            <div style={{ fontSize: 12, color: '#dc2626', padding: '8px 12px', borderRadius: 8, background: '#fee2e2' }}>
              请先在系统设置中配置AI模型
            </div>
          )}

          {aiGenImageNote && (
            <div style={{ fontSize: 11, color: aiGenImageNote.includes('失败') || aiGenImageNote.includes('不可用') ? '#e67e00' : '#16a34a', padding: '6px 10px', borderRadius: 8, background: aiGenImageNote.includes('失败') || aiGenImageNote.includes('不可用') ? 'rgba(245,158,11,0.06)' : 'rgba(16,163,74,0.04)', border: `1px solid ${aiGenImageNote.includes('失败') || aiGenImageNote.includes('不可用') ? 'rgba(245,158,11,0.15)' : 'rgba(16,163,74,0.12)'}` }}>
              {aiGenImageNote}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8, borderTop: '1px solid #f0ece8' }}>
            <Button variant="secondary" onClick={onClose}>取消</Button>
            <Button
              onClick={handleGenerate}
              disabled={!aiGenDesc.trim() || (!aiGenConfigId && !activeConfigId) || aiGenLoading}
              icon={<SparklesIcon style={{ width: 16, height: 16 }} />}
            >
              {aiGenLoading ? '生成中...' : '生成角色'}
            </Button>
          </div>
        </div>

        {/* 分隔 */}
        <div style={{ width: 1, alignSelf: 'stretch', background: '#d0cbc4', flexShrink: 0 }} />

        {/* ===== 右栏：参考背景 ===== */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, overflow: 'auto', minWidth: 0 }} className="custom-scrollbar">
          <div style={{ fontSize: 13, fontWeight: 600, color: '#7c3aed', display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
            <span style={{ width: 3, height: 16, borderRadius: 2, background: '#7c3aed' }} />
            参考背景（优先度：细纲 &gt; 角色 &gt; 大纲）
          </div>

          {/* 细纲 — highest priority */}
          <div style={{ padding: '12px 16px', borderRadius: 12, background: 'rgba(59,130,246,0.03)', border: '1px solid rgba(59,130,246,0.12)', flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#3b82f6' }}>细纲 · 故事剧情</span>
              <span style={{ fontSize: 10, color: '#9b8e84' }}>（优先度最高）</span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                <button onClick={() => setAllDetailedFields(true)} style={miniActionLink}>全选</button>
                <button onClick={() => setAllDetailedFields(false)} style={miniActionLink}>清空</button>
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {DETAILED_FIELDS.map(([key, label]) => (
                <label key={key} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 12px', borderRadius: 7,
                  fontSize: 12, cursor: 'pointer',
                  background: detailedOutlineFields[key] ? 'rgba(59,130,246,0.1)' : '#f8f7f5',
                  border: detailedOutlineFields[key] ? '1px solid rgba(59,130,246,0.25)' : '1px solid rgba(0,0,0,0.05)',
                  color: detailedOutlineFields[key] ? '#3b82f6' : '#6b5e54',
                  fontWeight: detailedOutlineFields[key] ? 600 : 400,
                }}>
                  <input type="checkbox" checked={detailedOutlineFields[key]} onChange={() => toggleDetailedField(key)} style={checkInput} />
                  {label}
                </label>
              ))}
            </div>
          </div>

          {/* 角色 — medium priority */}
          <div style={{ padding: '12px 16px', borderRadius: 12, background: 'rgba(124,58,237,0.03)', border: '1px solid rgba(124,58,237,0.12)', flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#7c3aed' }}>角色库 · {selectedCharacterIds.size} 个</span>
              <span style={{ fontSize: 10, color: '#9b8e84' }}>（选择需要参考的角色）</span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                <button onClick={() => selectIds(setSelectedCharacterIds, characters.map(c => c.id))} style={miniActionLink}>全选</button>
                <button onClick={() => selectIds(setSelectedCharacterIds, [])} style={miniActionLink}>清空</button>
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, overflowY: 'auto', flex: 1, alignContent: 'flex-start' }} className="custom-scrollbar">
              {characters.map(c => (
                <label key={c.id} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 12px', borderRadius: 7,
                  fontSize: 12, cursor: 'pointer',
                  background: selectedCharacterIds.has(c.id) ? 'rgba(124,58,237,0.08)' : 'transparent',
                  border: selectedCharacterIds.has(c.id) ? '1px solid rgba(124,58,237,0.22)' : '1px solid rgba(0,0,0,0.05)',
                  color: selectedCharacterIds.has(c.id) ? '#7c3aed' : '#6b5e54',
                  fontWeight: selectedCharacterIds.has(c.id) ? 600 : 400,
                }}>
                  <input type="checkbox" checked={selectedCharacterIds.has(c.id)} onChange={() => toggleId(setSelectedCharacterIds, c.id)} style={checkInput} />
                  {c.name}
                  {c.role && <span style={{ fontSize: 10, color: '#9b8e84', marginLeft: 2 }}>{c.role}</span>}
                </label>
              ))}
              {characters.length === 0 && <span style={{ fontSize: 12, color: '#9b8e84' }}>暂无角色，可在角色面板手动创建</span>}
            </div>
          </div>

          {/* 大纲 — lowest priority */}
          <div style={{ padding: '12px 16px', borderRadius: 12, background: 'rgba(0,0,0,0.02)', border: '1px solid rgba(0,0,0,0.06)', flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#4a3f38' }}>大纲</span>
              <span style={{ fontSize: 10, color: '#9b8e84' }}>（优先度最低）</span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                <button onClick={() => setAllOutlineTabs(true)} style={miniActionLink}>全选</button>
                <button onClick={() => setAllOutlineTabs(false)} style={miniActionLink}>清空</button>
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, overflowY: 'auto', flex: 1, alignContent: 'flex-start' }} className="custom-scrollbar">
              {OUTLINE_TABS.map(([key, label]) => (
                <label key={key} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 12px', borderRadius: 7,
                  fontSize: 12, cursor: 'pointer',
                  background: outlineTabs[key] ? 'rgba(0,0,0,0.06)' : '#f8f7f5',
                  border: outlineTabs[key] ? '1px solid rgba(0,0,0,0.15)' : '1px solid rgba(0,0,0,0.05)',
                  color: outlineTabs[key] ? '#2d2520' : '#6b5e54',
                  fontWeight: outlineTabs[key] ? 600 : 400,
                }}>
                  <input type="checkbox" checked={outlineTabs[key]} onChange={() => toggleOutlineTab(key)} style={checkInput} />
                  {label}
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  )
}
