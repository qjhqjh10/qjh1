// ── 通用实体部分视图（v16.4.1 方案 A 重设计）──
// 卡片：主题色浅渐变底 + 左侧主题色竖条 + 大号半透明 emoji 水印 +
//      两行摘要 + 核心字段彩色标签行（品级/状态/章节范围/类型）+
//      hover 上浮 + 操作条浮现。
// 编辑弹窗 = 固定专属词条（core 结构化 + 非 core 多行）+ 新增自由条块。
// AI 生成按「核心字段 + 条块」格式。

import { useEffect, useState } from 'react'
import Button from '@/components/common/Button'
import Modal from '@/components/common/Modal'
import ScrollArea from '@/components/common/ScrollArea'
import { EntityEditModal } from './EntityEditModal'
import { chatAI } from '@/utils/chatAI'
import { tryParseJsonOrYaml } from '@/utils/yamlUtils'
import { PlusIcon, SparklesIcon, TrashIcon, PencilIcon } from '@heroicons/react/24/outline'
import { safeEntityName, listEntities, saveEntity, deleteEntity } from '@/services/outlineEntityService'
import { useStore, useSettingsStore } from '@/store'
import { logError } from '@/utils/logger'
import type { OutlineEntity, OutlineEntityBlock, OutlineSectionDef, OutlineSectionField } from '@/types/outline'
import { nanoid } from 'nanoid'

interface Props {
  projectPath: string
  section: OutlineSectionDef
  activeConfigId: string | null
  /** 可选：注入给 AI 生成的参考背景（如当前世界观/剧情） */
  referenceContext?: string
  /** 实体变更后（父级刷新计数用） */
  onChanged?: () => void
  /** v16.4.1: 外部刷新信号（AI 直接改文件 → 父级 fileEditNotify 命中时 +1） */
  reloadSignal?: number
}

// ── 部分主题色（卡片徽章/渐变/悬停，按 key 映射；自定义部分默认绿）──
const SECTION_THEMES: Record<string, { color: string; soft: string; gradient: string }> = {
  items:         { color: '#f59e0b', soft: 'rgba(245,158,11,0.10)', gradient: 'linear-gradient(135deg, #fbbf24, #f59e0b)' },
  locations:     { color: '#3b82f6', soft: 'rgba(59,130,246,0.10)', gradient: 'linear-gradient(135deg, #60a5fa, #3b82f6)' },
  factions:      { color: '#ef4444', soft: 'rgba(239,68,68,0.10)', gradient: 'linear-gradient(135deg, #f87171, #ef4444)' },
  power_systems: { color: '#8b5cf6', soft: 'rgba(139,92,246,0.10)', gradient: 'linear-gradient(135deg, #a78bfa, #8b5cf6)' },
  foreshadows:   { color: '#eab308', soft: 'rgba(234,179,8,0.12)', gradient: 'linear-gradient(135deg, #facc15, #eab308)' },
  emotions:      { color: '#ec4899', soft: 'rgba(236,72,153,0.10)', gradient: 'linear-gradient(135deg, #f472b6, #ec4899)' },
  threads:       { color: '#06b6d4', soft: 'rgba(6,182,212,0.10)', gradient: 'linear-gradient(135deg, #22d3ee, #06b6d4)' },
}
const DEFAULT_THEME = { color: '#10b981', soft: 'rgba(16,185,129,0.10)', gradient: 'linear-gradient(135deg, #34d399, #10b981)' }
const themeOf = (key: string) => SECTION_THEMES[key] || DEFAULT_THEME

// v16.4.1(审查修复): emoji 收敛共享单一真源
import { SECTION_EMOJI } from '@/data/builtinSections'
const emojiOf = (key: string) => SECTION_EMOJI[key] || '📄'

/** 故事线类型中文映射 */
const THREAD_TYPE_LABELS: Record<string, string> = { main: '主线', sub: '副线', hidden: '暗线' }

/** 实体摘要与标签行（按部分词条提取） */
function cardInfo(entity: OutlineEntity, section: OutlineSectionDef) {
  const fields = section.fields || []
  const core = fields.filter(f => f.core)
  const nameField = core.find(f => f.key === 'name') || core.find(f => f.required)
  const src = entity as Record<string, unknown>

  const name = nameField ? String(src[nameField.key] ?? '') || '未命名' : String(entity.name || '') || '未命名'

  // 摘要：首个非空固定词条（非 core 多行/文本）→ blocks 首条
  let detail = ''
  const descField = fields.find(f => !f.core && String(src[f.key] ?? '').trim())
  if (descField) detail = String(src[descField.key] ?? '')
  if (!detail) {
    const blocks = Array.isArray(entity.blocks) ? entity.blocks as OutlineEntityBlock[] : []
    const first = blocks.find(b => b.content?.trim())
    if (first) detail = `${first.label ? `【${first.label}】` : ''}${first.content}`
  }

  // 标签行（按部分定制）
  const tags: Array<{ text: string; color: string; bg: string }> = []
  const theme = themeOf(section.key)
  const push = (text: string, color = theme.color, bg = theme.soft) => tags.push({ text, color, bg })
  if (section.key === 'items' && src.grade) push(String(src.grade))
  else if (section.key === 'locations' && src.type) push(String(src.type))
  else if (section.key === 'factions' && src.type) push(String(src.type))
  else if (section.key === 'power_systems' && typeof src.levels === 'string' && (src.levels as string).trim()) {
    push(`${(src.levels as string).split('\n').filter(l => l.trim()).length} 级`)
  } else if (section.key === 'foreshadows') {
    const resolved = src.status === 'resolved'
    push(resolved ? '已回收' : '已埋', resolved ? '#16a34a' : '#f59e0b', resolved ? 'rgba(22,163,74,0.10)' : 'rgba(245,158,11,0.10)')
    if (src.plantChapterId) push(`埋于${src.plantChapterId}`)
  } else if (section.key === 'emotions') {
    const s = Number(src.chapterStart) || 0
    const e = Number(src.chapterEnd) || 0
    if (s || e) push(s === e ? `第${s}章` : `第${s}-${e}章`)
  } else if (section.key === 'threads' && src.type) {
    push(THREAD_TYPE_LABELS[String(src.type)] || String(src.type))
  }

  return { name, detail: detail || '暂无描述', tags }
}

/** 单张实体卡片（自管 hover 态：上浮 + 操作条浮现） */
function EntityCard({ entity, section, onEdit, onDelete }: {
  entity: OutlineEntity
  section: OutlineSectionDef
  onEdit: () => void
  onDelete: () => void
}) {
  const [hover, setHover] = useState(false)
  const theme = themeOf(section.key)
  const emoji = emojiOf(section.key)
  const { name, detail, tags } = cardInfo(entity, section)

  return (
    <div
      onClick={onEdit}
      title="点击编辑"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative', borderRadius: 14, overflow: 'hidden', cursor: 'pointer',
        background: `linear-gradient(160deg, ${theme.soft}, rgba(255,255,255,0.96) 42%)`,
        border: `1px solid ${hover ? theme.color + '66' : 'rgba(0,0,0,0.07)'}`,
        boxShadow: hover ? `0 12px 30px ${theme.soft}, 0 2px 6px rgba(0,0,0,0.04)` : '0 1px 3px rgba(0,0,0,0.05)',
        transform: hover ? 'translateY(-3px)' : 'translateY(0)',
        transition: 'all 0.18s ease, transform 0.18s ease',
      }}
    >
      {/* 左侧主题色竖条 */}
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: theme.gradient }} />
      {/* 右下角大号半透明水印 */}
      <div style={{
        position: 'absolute', right: -6, bottom: -10, fontSize: 72, opacity: 0.06,
        pointerEvents: 'none', userSelect: 'none', lineHeight: 1,
      }}>{emoji}</div>

      <div style={{ padding: '14px 16px 10px 18px', display: 'flex', gap: 12, position: 'relative' }}>
        {/* 圆形图标徽章 */}
        <div style={{
          width: 42, height: 42, borderRadius: '50%', flexShrink: 0,
          background: theme.gradient, color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 19, boxShadow: `0 4px 12px ${theme.color}44`,
        }}>{emoji}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: '#1f1a16', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
          </div>
          {/* 标签行 */}
          {tags.length > 0 && (
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 5 }}>
              {tags.map((t, i) => (
                <span key={i} style={{
                  fontSize: 10.5, padding: '1px 8px', borderRadius: 999,
                  background: t.bg, color: t.color, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4,
                }}>
                  {t.text === '已埋' || t.text === '已回收' ? <span style={{ width: 5, height: 5, borderRadius: '50%', background: t.color, display: 'inline-block' }} /> : null}
                  {t.text}
                </span>
              ))}
            </div>
          )}
          {/* 两行摘要 */}
          <p style={{
            fontSize: 12, color: '#5c5149', margin: '6px 0 0', lineHeight: 1.65,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}>{detail}</p>
        </div>
      </div>

      {/* 底部操作条（hover 浮现） */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 2,
        padding: '4px 10px', borderTop: '1px solid rgba(0,0,0,0.045)',
        background: 'rgba(255,255,255,0.5)',
        opacity: hover ? 1 : 0.35, transition: 'opacity 0.18s ease',
      }} onClick={e => e.stopPropagation()}>
        <button onClick={onEdit} title="编辑"
          style={{
            background: 'none', border: 'none', cursor: 'pointer', color: '#7a6f66', padding: '4px 10px', borderRadius: 6,
            display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, fontFamily: 'inherit', fontWeight: 600,
            transition: 'all 0.12s ease',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = theme.color; e.currentTarget.style.background = theme.soft }}
          onMouseLeave={e => { e.currentTarget.style.color = '#7a6f66'; e.currentTarget.style.background = 'transparent' }}>
          <PencilIcon style={{ width: 12, height: 12 }} /> 编辑
        </button>
        <button onClick={onDelete} title="删除"
          style={{
            background: 'none', border: 'none', cursor: 'pointer', color: '#b0a89e', padding: '4px 10px', borderRadius: 6,
            display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, fontFamily: 'inherit', marginLeft: 'auto', fontWeight: 600,
          }}
          onMouseEnter={e => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.background = 'rgba(239,68,68,0.06)' }}
          onMouseLeave={e => { e.currentTarget.style.color = '#b0a89e'; e.currentTarget.style.background = 'transparent' }}>
          <TrashIcon style={{ width: 12, height: 12 }} /> 删除
        </button>
      </div>
    </div>
  )
}

export function EntitySectionView({ projectPath, section, activeConfigId, referenceContext, onChanged, reloadSignal = 0 }: Props) {
  const [entities, setEntities] = useState<OutlineEntity[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<OutlineEntity | null | 'new'>(null)
  const [showAiGen, setShowAiGen] = useState(false)
  const [aiDesc, setAiDesc] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [toDelete, setToDelete] = useState<OutlineEntity | null>(null)
  // v16.4.1(任务6): AI 生成弹窗升级——模型选择 + 参考背景勾选（世界观/故事剧情）
  const configs = useSettingsStore(s => s.configs)
  const [aiGenConfigId, setAiGenConfigId] = useState<string>('')
  const [refWorld, setRefWorld] = useState(true)
  const [refStory, setRefStory] = useState(false)
  const storeOutline = useStore(s => s.outlineContent)
  const storeWorld = useStore(s => s.worldbuildingContent)

  const theme = themeOf(section.key)
  const emoji = emojiOf(section.key)

  const reload = async () => {
    const list = await listEntities(projectPath, section.key)
    setEntities(list)
    setLoading(false)
  }

  useEffect(() => { reload() }, [projectPath, section.key, reloadSignal])

  const handleSave = async (data: Record<string, unknown>) => {
    let id = editing === 'new' ? '' : (editing as OutlineEntity | null)?.id || ''
    if (!id) {
      const nameField = (section.fields || []).find(f => f.key === 'name' || f.required)
      const raw = nameField ? String(data[nameField.key] ?? '') : ''
      id = safeEntityName(raw || '未命名')
      const exists = entities.some(e => e.id === id)
      if (exists) id = `${id}-${nanoid(4)}`
    }
    await saveEntity(projectPath, section.key, id, data)
    setEditing(null)
    await reload()
    onChanged?.()
  }

  const handleAiGenerate = async () => {
    if (!aiDesc.trim() || !aiGenConfigId) return
    setAiLoading(true)
    try {
      const fields = section.fields || []
      const coreFields = fields.filter(f => f.core)
      const coreFormat = coreFields.map(f =>
        f.type === 'select'
          ? `"${f.key}"(label ${f.label}): ${(f.options || []).join('/')} 之一`
          : `"${f.key}"(label ${f.label}): ${f.type === 'number' ? '数字' : '文本'}${f.required ? '（必填）' : ''}`
      ).join('\n')
      const fixedFormat = fields.filter(f => !f.core)
        .map(f => `"${f.key}"(label ${f.label}): 长文本（无内容可省略）`)
        .join('\n')
      // v16.4.1(任务6): 参考背景 = 弹窗内勾选的世界观/故事剧情（纯文本截断）
      const refParts: string[] = []
      if (refWorld && storeWorld) refParts.push(`[世界观设定]\n${storeWorld.replace(/<[^>]+>/g, '').slice(0, 2000)}`)
      if (refStory && storeOutline) refParts.push(`[故事剧情]\n${storeOutline.replace(/<[^>]+>/g, '').slice(0, 2000)}`)
      const refBlock = refParts.length > 0 ? `\n\n[参考背景]\n${refParts.join('\n\n')}` : ''
      const messages = [{
        role: 'user' as const,
        content: `请为小说大纲创建${section.name}数据。\n\n[核心字段]\n${coreFormat}\n\n[固定词条]\n${fixedFormat}\n\n[输出要求]\n只输出一个 YAML 对象，字段用上面指定的 key，不要输出 markdown 代码块或额外说明。\n\n[用户需求]\n${aiDesc}${refBlock}`,
      }]
      const reply = await chatAI(messages, aiGenConfigId, projectPath.split('/').filter(Boolean).pop() || undefined)
      const clean = reply.replace(/```(?:ya?ml|json)?/gi, '').trim()
      const parsed = tryParseJsonOrYaml(clean)
      if (!parsed) throw new Error('AI 返回内容无法解析为结构化数据')
      const obj = parsed.obj as Record<string, unknown>
      const normalized: Record<string, unknown> = {}
      for (const f of fields) {
        const v = obj[f.key] ?? obj[f.label] ?? obj[f.label.replace(/\s/g, '')]
        if (v !== undefined) normalized[f.key] = v
      }
      setEditing({ id: '', ...normalized } as OutlineEntity)
      setShowAiGen(false)
      setAiDesc('')
    } catch (err) {
      logError('AI 生成实体失败', err)
      alert(`AI 生成失败: ${err instanceof Error ? err.message : '未知错误'}`)
    }
    setAiLoading(false)
  }

  const handleDelete = async () => {
    if (!toDelete) return
    await deleteEntity(projectPath, section.key, toDelete.id)
    setToDelete(null)
    await reload()
    onChanged?.()
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#faf9f7' }}>
      {/* 头部操作区 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 24px', borderBottom: '1px solid rgba(0,0,0,0.05)', background: 'rgba(255,255,255,0.6)' }}>
        <span style={{ fontSize: 12.5, color: '#6b5e54', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: theme.color, display: 'inline-block' }} />
          共 {entities.length} 个{section.name}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button size="sm" onClick={() => { setAiGenConfigId(activeConfigId || (configs[0]?.id || '')); setShowAiGen(true) }} disabled={!activeConfigId} icon={<SparklesIcon style={{ width: 13, height: 13 }} />}>
            AI 生成
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setEditing('new')} icon={<PlusIcon style={{ width: 13, height: 13 }} />}>
            新建{section.name}
          </Button>
        </div>
      </div>

      {/* 卡片网格 */}
      <ScrollArea maxHeight="100%" style={{ flex: 1, padding: 24 }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 48, fontSize: 12.5, color: '#9b8e84' }}>加载中…</div>
        ) : entities.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 56 }}>
            <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.5 }}>{emoji}</div>
            <div style={{ fontSize: 14, color: '#6b5e54', fontWeight: 600 }}>暂无{section.name}</div>
            <div style={{ fontSize: 12.5, color: '#9b8e84', marginTop: 6 }}>点击「新建{section.name}」或「AI 生成」创建第一个</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
            {entities.map(entity => (
              <EntityCard
                key={entity.id}
                entity={entity}
                section={section}
                onEdit={() => setEditing(entity)}
                onDelete={() => setToDelete(entity)}
              />
            ))}
          </div>
        )}
      </ScrollArea>

      {/* 编辑/新建弹窗 */}
      <EntityEditModal
        open={editing !== null}
        section={section}
        entity={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)}
        onSave={handleSave}
      />

      {/* v16.4.1(任务6): AI 生成弹窗升级——模型选择 + 参考背景（对齐角色 AI 生成弹窗） */}
      <Modal isOpen={showAiGen} onClose={() => setShowAiGen(false)} title={`AI 生成${section.name}`} width={540} draggable>
        <div style={{ fontSize: 12.5, color: '#6b5e54', marginBottom: 10, lineHeight: 1.7 }}>
          按核心字段 + 固定词条生成 1 个实体并进入编辑弹窗确认（可重复生成多个）。描述想要的内容与风格。
        </div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#4a3f38', marginBottom: 4 }}>选择模型配置</div>
            <select value={aiGenConfigId} onChange={e => setAiGenConfigId(e.target.value)}
              style={{ width: '100%', padding: '8px 12px', fontSize: 13, borderRadius: 10, border: '1px solid #ddd6cf', outline: 'none', cursor: 'pointer', background: '#faf9f8', fontFamily: 'inherit', color: '#2d2520' }}>
              {configs.map(c => <option key={c.id} value={c.id}>{c.name} ({c.model})</option>)}
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#4a3f38' }}>参考背景:</span>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12.5, cursor: 'pointer', color: '#3d342e' }}>
            <input type="checkbox" checked={refWorld} onChange={e => setRefWorld(e.target.checked)} style={{ accentColor: '#7c3aed' }} />
            🌍 世界观设定
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12.5, cursor: 'pointer', color: '#3d342e' }}>
            <input type="checkbox" checked={refStory} onChange={e => setRefStory(e.target.checked)} style={{ accentColor: '#7c3aed' }} />
            📜 故事剧情
          </label>
        </div>
        <textarea
          value={aiDesc}
          onChange={e => setAiDesc(e.target.value)}
          rows={4}
          placeholder={`例如：生成 2 件主角用到的法器，一攻一守，品级为灵器`}
          style={{ width: '100%', padding: 12, borderRadius: 10, border: '1px solid #e5e0da', outline: 'none', fontSize: 13, lineHeight: 1.7, fontFamily: 'inherit', resize: 'vertical', background: '#faf9f8' }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 12, marginTop: 12, borderTop: '1px solid rgba(0,0,0,0.06)' }}>
          <Button variant="secondary" size="sm" onClick={() => setShowAiGen(false)}>取消</Button>
          <Button size="sm" onClick={handleAiGenerate} disabled={!aiDesc.trim() || aiLoading || !aiGenConfigId}>
            {aiLoading ? '生成中…' : '生成'}
          </Button>
        </div>
      </Modal>

      {/* 删除确认 */}
      {toDelete && (
        <Modal isOpen={true} onClose={() => setToDelete(null)} title={`删除${section.name}`} width={420}>
          <p style={{ fontSize: 13, color: '#6b5e54', lineHeight: 1.7, marginBottom: 14 }}>
            确定删除「{cardInfo(toDelete, section).name}」？对应文件将一并删除，此操作不可恢复。
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="secondary" size="sm" onClick={() => setToDelete(null)}>取消</Button>
            <Button size="sm" variant="danger" onClick={handleDelete}>删除</Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
