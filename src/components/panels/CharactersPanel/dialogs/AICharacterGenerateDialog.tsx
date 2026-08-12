import { useState, useEffect } from 'react'
import Modal from '@/components/common/Modal'
import Button from '@/components/common/Button'
import { SparklesIcon } from '@heroicons/react/24/outline'
import type { ModelConfig, PromptTemplate } from '@/types/settings'
import type { OutlineTabToggles, DetailedOutlineToggles, KBInjectMode } from '@/types/settings'
import type { Character } from '@/types/character'
import { buildKBBlock, getSceneKb } from '@/services/knowledgePipeline'
import type { DetailedChapter } from '@/types/chapter'
import { loadOutlineDimensions } from '@/utils/outlineData'
import { loadAllSummaries } from '@/services/summaryService'
import { kbService } from '@/services/fileService'
import { listEntities } from '@/services/outlineEntityService'
import { loadSections } from '@/services/outlineSectionService'
import type { OutlineSectionDef } from '@/types/outline'
import { useStore, useSettingsStore } from '@/store'
import { checkInput, miniActionLink } from '@/components/common/ChapterGenerationModal/constants'
import { ChapterRefModal } from './ChapterRefModal'
import { OutlineRefModal } from './OutlineRefModal'
import { KbSelectionModal } from '@/components/ai/AIChatWindow/components/KbSelectionModal'
import type { OutlineEntity } from '@/types/outline'

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

// v16.4.1(审查修复): DIM_SECTION_MAP/emoji/名称收敛共享单一真源（builtinSections）
import { DIM_SECTION_MAP, SECTION_EMOJI, SECTION_NAMES } from '@/data/builtinSections'
const partEmoji = (key: string) => SECTION_EMOJI[key] || '📄'
const PART_NAMES = SECTION_NAMES

// v16.4.1(用户决策): 参考背景四卡片——外面显示摘要，点击打开对应勾选弹窗
function RefCard({ emoji, title, color, soft, summary, onClick }: {
  emoji: string; title: string; color: string; soft: string; summary: string; onClick: () => void
}) {
  return (
    <button onClick={onClick} title="点击打开设置"
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 12,
        background: `linear-gradient(160deg, ${soft}, #fff 55%)`,
        border: '1px solid rgba(0,0,0,0.07)', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
        transition: 'all 0.15s ease',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = `${color}55`; e.currentTarget.style.boxShadow = `0 4px 14px ${soft}` }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(0,0,0,0.07)'; e.currentTarget.style.boxShadow = 'none' }}
    >
      <div style={{ width: 34, height: 34, borderRadius: 10, background: soft, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, flexShrink: 0 }}>{emoji}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#1f1a16' }}>{title}</div>
        <div style={{ fontSize: 11.5, color, fontWeight: 600, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summary}</div>
      </div>
      <span style={{ fontSize: 15, color: '#c0b8ae', flexShrink: 0 }}>›</span>
    </button>
  )
}

// v16.4.1(审查修复): 细纲字段共享单一真源（ChapterRefModal 导出）
import { CHAPTER_REF_FIELDS as DETAILED_FIELDS } from './ChapterRefModal'

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
  const availablePrompts = promptTemplates.filter(p => p.type === '角色')

  // Right panel state
  const cg = useSettingsStore(s => s.aiSettings).chapterGen
  const [outlineTabs, setOutlineTabs] = useState<OutlineTabToggles>(cg.outlineTabs)
  const [detailedOutlineFields, setDetailedOutlineFields] = useState<DetailedOutlineToggles>(cg.detailedOutlineFields)
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<Set<string>>(new Set())
  // 知识库参考（v13.x 新增）
  const [selectedKbFileIds, setSelectedKbFileIds] = useState<Set<string>>(new Set())
  const [kbFiles, setKbFiles] = useState<{ id: string; originalName: string }[]>([])
  // v15.4.0: 知识库注入方式（全量/片段）与片段关键词——弹窗内 state
  const [kbInjectMode, setKbInjectMode] = useState<KBInjectMode>('full')
  const [kbKeywords, setKbKeywords] = useState('')
  // v16.4.1(用户决策): 大纲实体级勾选注入——partEntities（部分→实体列表）、
  // selectedEntities（部分→勾选 id；缺省=全部注入）
  const [partEntities, setPartEntities] = useState<Record<string, OutlineEntity[]>>({})
  const [selectedEntities, setSelectedEntities] = useState<Record<string, string[]>>({})
  // v16.4.1(用户决策): 细纲章节级选择（多选章节，字段勾选应用于每章）
  const [selectedChapterIds, setSelectedChapterIds] = useState<string[]>([])
  // v16.4.1: 参考背景四卡片 → 打开的弹窗（'chapter' | 'role' | 'outline' | 'kb' | null）
  const [refModal, setRefModal] = useState<'chapter' | 'role' | 'outline' | 'kb' | null>(null)
  // v16.4.1(审查修复): 大纲参考弹窗动态部分（含自定义部分与屏蔽态）
  const [outlineSections, setOutlineSections] = useState<OutlineSectionDef[]>([])

  const loadKBFiles = async () => {
    try { setKbFiles((await kbService.list()).files.map(f => ({ id: f.id, originalName: f.originalName }))) } catch { setKbFiles([]) }
  }

  useEffect(() => {
    if (isOpen) {
      setOutlineTabs(cg.outlineTabs)
      setDetailedOutlineFields(cg.detailedOutlineFields)
      setSelectedCharacterIds(new Set())
      setSelectedKbFileIds(new Set())
      setSelectedEntities({})
      setSelectedChapterIds([])
      setRefModal(null)
      loadKBFiles()
      // 并行预载部分注册表（大纲参考弹窗动态渲染用）
      if (activeProjectId && projectsBasePath) {
        loadSections(`${projectsBasePath}/${activeProjectId}`).then(setOutlineSections).catch(() => {})
      }
      // 并行预载实体部分列表（实体级勾选用）
      if (activeProjectId && projectsBasePath) {
        const pp = `${projectsBasePath}/${activeProjectId}`
        Object.values(DIM_SECTION_MAP).forEach(sectionKey => {
          listEntities(pp, sectionKey).then(list => {
            setPartEntities(prev => ({ ...prev, [sectionKey]: list }))
          }).catch(() => {})
        })
      }
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

    // 1. 细纲 (highest priority) —— v16.4.1(用户决策): 章节级选择，字段勾选应用于每章
    if (pp && activeProjectId && selectedChapterIds.length > 0 && Object.values(detailedOutlineFields).some(Boolean)) {
      try {
        const summaries = await loadAllSummaries(pp, selectedChapterIds)
        for (const chId of selectedChapterIds) {
          const currentChapter = detailedChapters.find(c => c.id === chId)
          if (!currentChapter) continue
          const summary = summaries[chId]
          if (!summary) continue
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
          // v16.4.1(用户需求): 情色剧情注入链路已移除
          if (lines.length > 0) {
            const idx = detailedChapters.findIndex(c => c.id === chId)
            parts.push(`【细纲参考 · 第${idx + 1}章】\n${lines.join('\n')}`)
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
          const custom = (c.customBlocks || []).filter(b => b.label.trim() && b.content.trim()).map(b => `${b.label}: ${b.content}`)
          if (custom.length > 0) fields.push(...custom)
          return fields.join('\n')
        })
        parts.push(`【角色参考】\n${charInfos.join('\n---\n')}`)
      }
    }

    // 3. 大纲 (medium-low priority)
    if (pp && activeProjectId && Object.values(outlineTabs).some(Boolean)) {
      try {
        // v16.4.1(用户决策): 实体级勾选注入——展开过的部分只注入勾选实体（空数组=不注入）
        const entityFilter: Record<string, string[]> = {}
        for (const sectionKey of Object.values(DIM_SECTION_MAP)) {
          if (sectionKey in selectedEntities) {
            entityFilter[sectionKey] = selectedEntities[sectionKey]
          }
        }
        const dims = await loadOutlineDimensions(pp, outlineTabs, entityFilter)
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

    // 4. 知识库 (lowest priority, 补充参考；v15.4.0: 统一走 knowledgePipeline——全量/片段两种模式)
    if (selectedKbFileIds.size > 0) {
      const { useSettingsStore } = await import('@/store')
      const block = await buildKBBlock([...selectedKbFileIds], {
        mode: kbInjectMode,
        keywords: kbKeywords,
        projectId: activeProjectId || '',
        configId: aiGenConfigId || activeConfigId || '',
        scene: getSceneKb(useSettingsStore.getState().aiSettings.kbSettings, 'characterGen'),
      })
      if (block) parts.push(block)
    }

    const referenceContext = parts.join('\n\n')
    onGenerate(referenceContext)
  }

  const sectionHeader: React.CSSProperties = {
    fontSize: 11, fontWeight: 600, color: '#4a3f38', marginBottom: 6,
    display: 'flex', alignItems: 'center', gap: 4,
  }

  // v16.4.1(用户决策): 参考背景卡片化后弹窗改小——90vw → 76vw（右栏参考区约为原来 2/3）
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="AI 生成角色" width="76vw" draggable resizable>
      <div style={{ display: 'flex', gap: 16, height: '68vh', minHeight: 500 }}>
        {/* ===== 左栏：配置面板（v16.4.1: 向右增宽 380→470，便于长需求输入） ===== */}
        <div style={{ width: 470, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 14, overflow: 'auto', paddingRight: 4 }} className="custom-scrollbar">
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <label style={{ display: 'block', fontSize: 15, fontWeight: 700, color: '#1a1512', marginBottom: 8 }}>
              描述你需要的角色
            </label>
            <textarea
              value={aiGenDesc}
              onChange={e => onDescChange(e.target.value)}
              placeholder="例如：一个冷酷的剑客，曾是皇家护卫队长，因一场冤案被逐出师门，背负血海深仇寻找真相..."
              style={{
                width: '100%', border: '1px solid #ddd6cf', borderRadius: 12, outline: 'none',
                resize: 'none', fontSize: 15, lineHeight: 1.9, fontFamily: 'inherit',
                color: '#1a1512', background: '#faf9f8', padding: 14, flex: 1, minHeight: 200,
              }}
              autoFocus
            />
          </div>

          {availablePrompts.length > 0 && (
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#4a3f38', marginBottom: 5 }}>
                提示词模板
              </label>
              <select
                value={selectedPromptId}
                onChange={e => onPromptChange(e.target.value)}
                style={{
                  width: '100%', padding: '9px 12px', fontSize: 13.5, borderRadius: 10,
                  border: '1px solid #ddd6cf', outline: 'none', cursor: 'pointer',
                  background: '#faf9f8', fontFamily: 'inherit', color: '#2d2520',
                }}
              >
                <option value={NONE_ID}>不使用模板（AI 自行决定角色设定）</option>
                {availablePrompts.map(p => (
                  <option key={p.id} value={p.id}>{p.enabled ? '✓ ' : ''}{p.title}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#4a3f38', marginBottom: 5 }}>
              选择模型配置
            </label>
            <select
              value={aiGenConfigId || activeConfigId || ''}
              onChange={e => onConfigChange(e.target.value)}
              style={{
                width: '100%', padding: '9px 12px', fontSize: 13.5, borderRadius: 10,
                border: '1px solid #ddd6cf', outline: 'none', cursor: 'pointer',
                background: '#faf9f8', fontFamily: 'inherit', color: '#2d2520',
              }}
            >
              {configs.map(c => (
                <option key={c.id} value={c.id}>{c.name} ({c.model})</option>
              ))}
            </select>
          </div>

          <div style={{
            fontSize: 12.5, color: rp ? '#7c3aed' : '#6b5e54',
            padding: '8px 12px', borderRadius: 8, background: rp ? 'rgba(124,58,237,0.05)' : '#f5f2f0',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <SparklesIcon style={{ width: 14, height: 14 }} />
            {rp ? `已加载提示词: ${rp.title}` : '未启用角色提示词，将使用默认格式'}
          </div>

          {!aiGenConfigId && !activeConfigId && (
            <div style={{ fontSize: 12.5, color: '#dc2626', padding: '8px 12px', borderRadius: 8, background: '#fee2e2' }}>
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

        {/* ===== 右栏：参考背景（v16.4.1: 四卡片式，点击卡片打开弹窗勾选） ===== */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, overflow: 'auto', minWidth: 0 }} className="custom-scrollbar">
          <div style={{ fontSize: 14, fontWeight: 700, color: '#7c3aed', display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
            <span style={{ width: 3, height: 16, borderRadius: 2, background: '#7c3aed' }} />
            参考背景（优先度：细纲 &gt; 角色 &gt; 大纲 &gt; 知识库）
          </div>

          {/* 四卡片 2×2 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, flexShrink: 0 }}>
            <RefCard
              emoji="📖" title="细纲 · 故事剧情" color="#2563eb" soft="rgba(59,130,246,0.08)"
              summary={selectedChapterIds.length > 0
                ? `已选 ${selectedChapterIds.length} 章${Object.values(detailedOutlineFields).some(Boolean) ? '' : '（未勾选字段）'}`
                : '未选择章节（不注入）'}
              onClick={() => setRefModal('chapter')}
            />
            <RefCard
              emoji="👥" title="角色库" color="#7c3aed" soft="rgba(124,58,237,0.08)"
              summary={selectedCharacterIds.size > 0 ? `已选 ${selectedCharacterIds.size} 个角色` : '未选择（不注入）'}
              onClick={() => setRefModal('role')}
            />
            <RefCard
              emoji="📚" title="大纲" color="#3d342e" soft="rgba(0,0,0,0.04)"
              summary={(() => {
                const active = Object.entries(DIM_SECTION_MAP).filter(([dk]) => outlineTabs[dk as keyof OutlineTabToggles])
                if (active.length === 0) return '未启用（不注入）'
                return active.map(([, sectionKey]) => {
                  const sel = selectedEntities[sectionKey]
                  return sel !== undefined ? `${PART_NAMES[sectionKey]}×${sel.length}` : PART_NAMES[sectionKey]
                }).join(' · ')
              })()}
              onClick={() => setRefModal('outline')}
            />
            <RefCard
              emoji="🗂️" title="知识库" color="#15803d" soft="rgba(16,163,74,0.08)"
              summary={selectedKbFileIds.size > 0 ? `已选 ${selectedKbFileIds.size} 个文件` : '未选择（不注入）'}
              onClick={() => setRefModal('kb')}
            />
          </div>

          {/* 知识库注入方式（仅知识库生效） */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', flexShrink: 0, padding: '8px 12px', borderRadius: 10, background: 'rgba(16,163,74,0.03)', border: '1px solid rgba(16,163,74,0.1)' }}>
            <span style={{ fontSize: 12, color: '#4a3f38', fontWeight: 700 }}>知识库注入方式:</span>
            <button onClick={() => setKbInjectMode('full')} title="勾选文件全文截断注入（上限取知识库设置）"
              style={{ padding: '4px 10px', borderRadius: 6, fontSize: 12, fontFamily: 'inherit', cursor: 'pointer',
                border: kbInjectMode === 'full' ? '1px solid rgba(16,163,74,0.4)' : '1px solid rgba(0,0,0,0.12)',
                background: kbInjectMode === 'full' ? 'rgba(16,163,74,0.1)' : '#fff', color: kbInjectMode === 'full' ? '#15803d' : '#4a3f38', fontWeight: kbInjectMode === 'full' ? 700 : 400 }}>全量注入</button>
            <button onClick={() => setKbInjectMode('chunk')} title="按关键词向量化检索相关片段注入（topK 取知识库设置）"
              style={{ padding: '4px 10px', borderRadius: 6, fontSize: 12, fontFamily: 'inherit', cursor: 'pointer',
                border: kbInjectMode === 'chunk' ? '1px solid rgba(16,163,74,0.4)' : '1px solid rgba(0,0,0,0.12)',
                background: kbInjectMode === 'chunk' ? 'rgba(16,163,74,0.1)' : '#fff', color: kbInjectMode === 'chunk' ? '#15803d' : '#4a3f38', fontWeight: kbInjectMode === 'chunk' ? 700 : 400 }}>片段注入</button>
            {kbInjectMode === 'chunk' && (
              <input value={kbKeywords} onChange={e => setKbKeywords(e.target.value)}
                placeholder="片段关键词：如 剑术, 宗门, 炼丹（逗号/顿号分隔）"
                style={{ flex: 1, minWidth: 180, boxSizing: 'border-box', padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.12)', fontSize: 12, fontFamily: 'inherit', outline: 'none' }} />
            )}
            <span style={{ fontSize: 11, color: '#6b5e54' }}>
              {kbInjectMode === 'full' ? '全文截断注入，适合整体参考' : '关键词向量化定位，省 token'}
            </span>
          </div>
        </div>
      </div>

      {/* ── v16.4.1: 参考背景弹窗们（点击卡片打开） ── */}
      <ChapterRefModal
        open={refModal === 'chapter'}
        chapters={detailedChapters}
        selectedChapterIds={selectedChapterIds}
        fields={detailedOutlineFields}
        onClose={() => setRefModal(null)}
        onConfirm={(chapterIds, fields) => {
          setSelectedChapterIds(chapterIds)
          setDetailedOutlineFields(fields)
          setRefModal(null)
        }}
      />
      {/* 角色多选弹窗 */}
      <Modal isOpen={refModal === 'role'} onClose={() => setRefModal(null)} title="选择参考角色" width={460} draggable>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: '#4a3f38' }}>角色 · 已选 {selectedCharacterIds.size} 个</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            <button onClick={() => selectIds(setSelectedCharacterIds, characters.map(c => c.id))} style={miniActionLink}>全选</button>
            <button onClick={() => selectIds(setSelectedCharacterIds, [])} style={miniActionLink}>清空</button>
          </div>
        </div>
        <div className="custom-scrollbar" style={{ maxHeight: '46vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2, border: '1px solid rgba(0,0,0,0.05)', borderRadius: 10, padding: 6 }}>
          {characters.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', fontSize: 12.5, color: '#9b8e84' }}>暂无角色，可在角色面板创建</div>
          ) : characters.map(c => (
            <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 8, cursor: 'pointer', background: selectedCharacterIds.has(c.id) ? 'rgba(124,58,237,0.06)' : 'transparent' }}>
              <input type="checkbox" checked={selectedCharacterIds.has(c.id)} onChange={() => toggleId(setSelectedCharacterIds, c.id)} style={checkInput} />
              <span style={{ fontSize: 13, fontWeight: selectedCharacterIds.has(c.id) ? 600 : 400, color: selectedCharacterIds.has(c.id) ? '#7c3aed' : '#3d342e' }}>{c.name}</span>
              {c.role && <span style={{ fontSize: 11, color: '#9b8e84' }}>{c.role}</span>}
            </label>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 12, marginTop: 12, borderTop: '1px solid rgba(0,0,0,0.06)' }}>
          <Button size="sm" onClick={() => setRefModal(null)}>完成</Button>
        </div>
      </Modal>
      <OutlineRefModal
        open={refModal === 'outline'}
        sections={outlineSections}
        partEntities={partEntities}
        selectedEntities={selectedEntities}
        enabledParts={Object.fromEntries(Object.entries(DIM_SECTION_MAP).map(([dk, sk]) => [sk, outlineTabs[dk as keyof OutlineTabToggles]]))}
        onClose={() => setRefModal(null)}
        onPickEntities={(sectionKey, ids) => setSelectedEntities(prev => ({ ...prev, [sectionKey]: ids }))}
        onToggleEnabled={(sectionKey, enabled) => {
          const dk = Object.entries(DIM_SECTION_MAP).find(([, v]) => v === sectionKey)?.[0]
          if (dk) setOutlineTabs(prev => ({ ...prev, [dk]: enabled }))
        }}
      />
      <KbSelectionModal
        isOpen={refModal === 'kb'}
        onClose={() => setRefModal(null)}
        selectedIds={[...selectedKbFileIds]}
        mode="custom"
        onSetIds={(ids) => setSelectedKbFileIds(new Set(ids))}
      />
    </Modal>
  )
}
