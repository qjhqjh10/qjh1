import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { styleTemplateService } from '@/services/fileService'
import type { StyleTemplate, StyleTemplateType } from '@/types/styleTemplate'
import { getTemplateDims, createEmptyTemplate } from '@/types/styleTemplate'
import type { DimAnalysis } from '@/types/story'
import { DIMENSION_META } from '@/types/story'
import Button from '@/components/common/Button'
import Modal from '@/components/common/Modal'
import ScrollArea from '@/components/common/ScrollArea'
import { inputStyle } from '@/components/common/styles'
import { logError } from '@/utils/logger'
import {
  PlusIcon, TrashIcon, DocumentTextIcon,
  SparklesIcon, XMarkIcon,
} from '@heroicons/react/24/outline'

const TYPE_LABELS: Record<string, string> = { '普通小说': '普通', '情色小说': '情色', '都市小说': '都市', '修仙小说': '修仙', '武侠小说': '武侠', '恋爱小说': '恋爱', '古风小说': '古风', '悬疑小说': '悬疑', '历史小说': '历史', '科幻小说': '科幻', '穿越小说': '穿越' }
const ALL_TYPES = Object.keys(TYPE_LABELS)

export default function TemplateLibraryPage() {
  const navigate = useNavigate()
  const [templates, setTemplates] = useState<StyleTemplate[]>([])
  const [editTemplate, setEditTemplate] = useState<StyleTemplate | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => { loadTemplates() }, [])

  const loadTemplates = async () => {
    try { setTemplates(await styleTemplateService.list() as StyleTemplate[]) } catch { /* */ }
  }

  const handleCreate = async (type: StyleTemplateType) => {
    setEditTemplate(createEmptyTemplate(type))
    setShowCreate(false)
  }

  const handleSave = async () => {
    if (!editTemplate) return
    setSaving(true)
    try {
      await styleTemplateService.save(editTemplate)
      await loadTemplates()
      setEditTemplate(null)
    } catch (err) { logError('保存模板失败', err) }
    setSaving(false)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('删除此模板？')) return
    try { await styleTemplateService.delete(id); await loadTemplates() } catch (err) { logError('删除失败', err) }
  }

  const updateDim = (key: string, field: keyof DimAnalysis, value: string | string[]) => {
    if (!editTemplate) return
    const dims = { ...editTemplate.dimensions }
    const existing = dims[key] || { description: '', examples: [], writingRules: [], vocabularyList: [] }
    dims[key] = { ...existing, [field]: value }
    setEditTemplate({ ...editTemplate, dimensions: dims })
  }

  const addVocabItem = (dimKey: string) => {
    if (!editTemplate) return
    const dims = { ...editTemplate.dimensions }
    const existing = dims[dimKey] || { description: '', examples: [], writingRules: [], vocabularyList: [] }
    dims[dimKey] = { ...existing, vocabularyList: [...existing.vocabularyList, ''] }
    setEditTemplate({ ...editTemplate, dimensions: dims })
  }

  const updateVocabItem = (dimKey: string, idx: number, value: string) => {
    if (!editTemplate) return
    const dims = { ...editTemplate.dimensions }
    const list = [...(dims[dimKey]?.vocabularyList || [])]
    list[idx] = value
    dims[dimKey] = { ...dims[dimKey], vocabularyList: list }
    setEditTemplate({ ...editTemplate, dimensions: dims })
  }

  const removeVocabItem = (dimKey: string, idx: number) => {
    if (!editTemplate) return
    const dims = { ...editTemplate.dimensions }
    const list = [...(dims[dimKey]?.vocabularyList || [])]
    list.splice(idx, 1)
    dims[dimKey] = { ...dims[dimKey], vocabularyList: list }
    setEditTemplate({ ...editTemplate, dimensions: dims })
  }

  const addRule = (dimKey: string) => {
    if (!editTemplate) return
    const dims = { ...editTemplate.dimensions }
    const existing = dims[dimKey] || { description: '', examples: [], writingRules: [], vocabularyList: [] }
    dims[dimKey] = { ...existing, writingRules: [...existing.writingRules, ''] }
    setEditTemplate({ ...editTemplate, dimensions: dims })
  }

  const updateRule = (dimKey: string, idx: number, value: string) => {
    if (!editTemplate) return
    const dims = { ...editTemplate.dimensions }
    const list = [...(dims[dimKey]?.writingRules || [])]
    list[idx] = value
    dims[dimKey] = { ...dims[dimKey], writingRules: list }
    setEditTemplate({ ...editTemplate, dimensions: dims })
  }

  const removeRule = (dimKey: string, idx: number) => {
    if (!editTemplate) return
    const dims = { ...editTemplate.dimensions }
    const list = [...(dims[dimKey]?.writingRules || [])]
    list.splice(idx, 1)
    dims[dimKey] = { ...dims[dimKey], writingRules: list }
    setEditTemplate({ ...editTemplate, dimensions: dims })
  }

  // ── Render ──
  // Edit modal with dimension editor
  const editingDims = editTemplate ? getTemplateDims(editTemplate.type) : []

  return (
    <div className="page-enter" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '20px 24px 12px', borderBottom: '1px solid rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#2d2520', margin: 0 }}>风格模板库</h2>
          <p style={{ fontSize: 12, color: '#9b8e84', margin: '4px 0 0' }}>管理风格模板，支持手动创建或从AI分析导入</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="secondary" size="sm" onClick={() => navigate('/style-workshop')}>
            导入分析
          </Button>
          <Button size="sm" onClick={() => setShowCreate(true)} icon={<PlusIcon style={{ width: 14, height: 14 }} />}>
            新建模板
          </Button>
        </div>
      </div>

      {/* Template cards */}
      <ScrollArea style={{ flex: 1, padding: '16px 24px' }}>
        {templates.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#9b8e84', fontSize: 13 }}>
            <DocumentTextIcon style={{ width: 40, height: 40, marginBottom: 12, opacity: 0.3 }} />
            <div>暂无风格模板</div>
            <div style={{ marginTop: 8, fontSize: 11 }}>点击"新建模板"手动创建，或到风格工坊导入小说生成</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
            {templates.map(t => (
              <div key={t.id} style={{
                padding: '16px 18px', borderRadius: 14, background: '#fff',
                border: '1px solid rgba(0,0,0,0.06)', cursor: 'pointer',
                transition: 'box-shadow 0.15s',
              }} onClick={() => setEditTemplate(t)}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#2d2520' }}>{t.name || '未命名模板'}</span>
                  <span style={{
                    fontSize: 10, padding: '2px 8px', borderRadius: 10,
                    background: t.type === '情色小说' ? 'rgba(236,72,153,0.08)' : 'rgba(124,58,237,0.08)',
                    color: t.type === '情色小说' ? '#ec4899' : '#7c3aed',
                    fontWeight: 600,
                  }}>
                    {t.type === '情色小说' ? '🔥 情色' : '📖 普通'}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: '#6b5e54', marginBottom: 6 }}>
                  {t.description || t.fullDescription?.slice(0, 80) || '暂无描述'}
                </div>
                <div style={{ display: 'flex', gap: 12, fontSize: 10, color: '#9b8e84', flexWrap: 'wrap' }}>
                  {t.worldType && <span>🌍 {t.worldType}</span>}
                  <span>{Object.keys(t.dimensions).length}维</span>
                  <span>{t.source === 'ai-generated' ? '🤖 AI生成' : '✏️ 手动'}</span>
                  <span>{new Date(t.updatedAt).toLocaleDateString()}</span>
                </div>
                <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
                  <button onClick={e => { e.stopPropagation(); handleDelete(t.id) }} style={{
                    background: 'none', border: 'none', color: '#9b8e84', cursor: 'pointer', padding: 2,
                  }} title="删除"><TrashIcon style={{ width: 14, height: 14 }} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Create type selector */}
      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="新建风格模板" width={600}>
        <div style={{ fontSize: 13, color: '#6b5e54', marginBottom: 10 }}>选择模板类型：</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          {ALL_TYPES.map(type => {
            const dimCount = getTemplateDims(type).length
            const isErotic = type === '情色小说'
            return (
              <button key={type} onClick={() => handleCreate(type as StyleTemplateType)} style={{
                padding: '12px 14px', borderRadius: 10, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                border: isErotic ? '1px solid rgba(239,68,68,0.15)' : '1px solid rgba(124,58,237,0.1)',
                background: isErotic ? 'rgba(239,68,68,0.02)' : 'rgba(124,58,237,0.02)',
              }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: isErotic ? '#dc2626' : '#7c3aed', marginBottom: 2 }}>{TYPE_LABELS[type]}</div>
                <div style={{ fontSize: 10, color: '#9b8e84' }}>{dimCount}维</div>
              </button>
            )
          })}
        </div>
      </Modal>

      {/* Edit modal */}
      <Modal isOpen={!!editTemplate} onClose={() => { setEditTemplate(null) }} title={editTemplate?.source === 'manual' && !editTemplate?.fullDescription ? '新建模板' : '编辑模板'} width={700}>
        {editTemplate && (
          <div style={{ maxHeight: '65vh', overflowY: 'auto', paddingRight: 4 }} className="custom-scrollbar">
            {/* Basic info */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={labelStyle}>模板名称</div>
                  <input value={editTemplate.name} onChange={e => setEditTemplate({ ...editTemplate, name: e.target.value })} style={inputStyle as any} placeholder="输入模板名称" />
                </div>
                <div style={{ width: 140 }}>
                  <div style={labelStyle}>世界观</div>
                  <select value={editTemplate.worldType} onChange={e => setEditTemplate({ ...editTemplate, worldType: e.target.value })} style={{ ...inputStyle as any, cursor: 'pointer' }}>
                    <option value="">未设置</option>
                    <option value="古代">古代（东方古典）</option>
                    <option value="现代">现代（都市/职场）</option>
                    <option value="西幻">西幻（西方奇幻）</option>
                    <option value="日系">日系（二次元/ACG）</option>
                  </select>
                </div>
              </div>
              <div>
                <div style={labelStyle}>简介</div>
                <input value={editTemplate.description} onChange={e => setEditTemplate({ ...editTemplate, description: e.target.value })} style={inputStyle as any} placeholder="一句话描述这个风格" />
              </div>
            </div>

            {/* Tone */}
            <div style={{ marginBottom: 16, padding: '12px 14px', borderRadius: 10, background: 'rgba(236,72,153,0.04)', border: '1px solid rgba(236,72,153,0.1)' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#ec4899', marginBottom: 10 }}>叙事基调</div>
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={labelStyle}>基调词</div>
                  <input value={editTemplate.tone.word} onChange={e => setEditTemplate({ ...editTemplate, tone: { ...editTemplate.tone, word: e.target.value } })} style={inputStyle as any} placeholder="如: 冷酷复仇的性支配" />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={labelStyle}>叙述者态度</div>
                  <select value={editTemplate.tone.attitude} onChange={e => setEditTemplate({ ...editTemplate, tone: { ...editTemplate.tone, attitude: e.target.value } })} style={{ ...inputStyle as any, cursor: 'pointer' }}>
                    <option value="">未设置</option>
                    <option value="冷漠旁观">冷漠旁观</option>
                    <option value="欣赏把玩">欣赏把玩</option>
                    <option value="幽默调侃">幽默调侃</option>
                    <option value="温柔包容">温柔包容</option>
                    <option value="神圣庄严">神圣庄严</option>
                  </select>
                </div>
              </div>
              <div style={{ marginTop: 8 }}>
                <div style={labelStyle}>基调描述</div>
                <textarea value={editTemplate.tone.description} onChange={e => setEditTemplate({ ...editTemplate, tone: { ...editTemplate.tone, description: e.target.value } })} rows={2} style={{ ...inputStyle as any, width: '100%', resize: 'vertical', fontFamily: 'inherit' }} placeholder="100字基调描述" />
              </div>
            </div>

            {/* Dimensions */}
            {editingDims.map(dk => {
              const meta = DIMENSION_META[dk]
              const dim = editTemplate.dimensions[dk] || { description: '', examples: [], writingRules: [], vocabularyList: [] }
              return (
                <div key={dk} style={{ marginBottom: 14, padding: '10px 12px', borderRadius: 8, background: '#faf9f8', border: '1px solid rgba(0,0,0,0.04)' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#2d2520', marginBottom: 6 }}>
                    {meta?.label || dk} <span style={{ fontWeight: 400, color: '#9b8e84', fontSize: 10 }}>({meta?.category || ''})</span>
                  </div>
                  <textarea value={dim.description} onChange={e => updateDim(dk, 'description', e.target.value)} rows={2} style={{ ...inputStyle as any, width: '100%', resize: 'vertical', fontFamily: 'inherit', fontSize: 11, marginBottom: 8 }} placeholder="维度描述（200-400字）" />

                  {/* Vocabulary tags */}
                  <div style={{ marginBottom: 6 }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: '#6b5e54', marginBottom: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      词汇清单 ({dim.vocabularyList?.length || 0})
                      <button onClick={() => addVocabItem(dk)} style={{ background: 'none', border: 'none', color: '#7c3aed', cursor: 'pointer', fontSize: 10, fontWeight: 600 }}>+ 添加</button>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {(dim.vocabularyList || []).map((v: string, i: number) => (
                        <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <input value={v} onChange={e => updateVocabItem(dk, i, e.target.value)} style={{ width: 80, padding: '2px 6px', borderRadius: 4, border: '1px solid rgba(0,0,0,0.1)', fontSize: 10, fontFamily: 'inherit' }} placeholder="词" />
                          <button onClick={() => removeVocabItem(dk, i)} style={{ background: 'none', border: 'none', color: '#9b8e84', cursor: 'pointer', fontSize: 10 }}>×</button>
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Rules */}
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 600, color: '#6b5e54', marginBottom: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      写作规则 ({dim.writingRules?.length || 0})
                      <button onClick={() => addRule(dk)} style={{ background: 'none', border: 'none', color: '#7c3aed', cursor: 'pointer', fontSize: 10, fontWeight: 600 }}>+ 添加</button>
                    </div>
                    {(dim.writingRules || []).map((r: string, i: number) => (
                      <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 3, alignItems: 'center' }}>
                        <input value={r} onChange={e => updateRule(dk, i, e.target.value)} style={{ flex: 1, padding: '3px 6px', borderRadius: 4, border: '1px solid rgba(0,0,0,0.1)', fontSize: 10, fontFamily: 'inherit' }} placeholder="规则" />
                        <button onClick={() => removeRule(dk, i)} style={{ background: 'none', border: 'none', color: '#9b8e84', cursor: 'pointer', fontSize: 12 }}>×</button>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16, paddingTop: 12, borderTop: '1px solid #f0ece8' }}>
          <Button variant="secondary" onClick={() => { setEditTemplate(null) }}>取消</Button>
          <Button onClick={handleSave} disabled={saving || !editTemplate?.name.trim()}>{saving ? '保存中...' : '保存模板'}</Button>
        </div>
      </Modal>
    </div>
  )
}

const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: '#6b5e54', marginBottom: 4 }
