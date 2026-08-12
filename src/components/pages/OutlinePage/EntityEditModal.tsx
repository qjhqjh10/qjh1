// ── 通用实体编辑弹窗（v16.4.1）──
// 表单 = 结构化核心字段（core: true）+ 固定专属词条（非 core 字段，按部分定制固定渲染）
//       + 自由信息条块（blocks，用户新增，可增删改）。
// 旧数据兼容：编辑旧实体时，不在字段模板中的未知键并入初始条块（保存后写为 blocks）。

import { useEffect, useState } from 'react'
import Modal from '@/components/common/Modal'
import Button from '@/components/common/Button'
import { fieldLabel, fieldInput } from '@/components/pages/OutlinePage/constants'
import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline'
import type { OutlineEntity, OutlineEntityBlock, OutlineSectionDef, OutlineSectionField } from '@/types/outline'

interface Props {
  open: boolean
  section: OutlineSectionDef
  /** null = 新建 */
  entity: OutlineEntity | null
  onClose: () => void
  /** 保存（data 不含 id；id 由调用方决定文件名） */
  onSave: (data: Record<string, unknown>) => void
}

/** 字段值 → 显示文本（textarea 兼容数组等旧数据形态，如 levels 旧数组） */
function toDisplayText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value.map(v => {
      if (typeof v === 'string') return v
      const o = v as { name?: string; description?: string }
      return o && typeof o === 'object' ? `${o.name || ''} — ${o.description || ''}`.replace(/ — $/, '') : String(v)
    }).join('\n')
  }
  return value == null ? '' : String(value)
}

/** 字段输入（按 type 渲染；固定词条中 textarea 用多行） */
function FieldInput({ field, value, onChange, textarea }: { field: OutlineSectionField; value: unknown; onChange: (v: unknown) => void; textarea?: boolean }) {
  const common: React.CSSProperties = { ...fieldInput, fontFamily: 'inherit' }
  if (field.type === 'textarea' || textarea) {
    return (
      <textarea
        value={toDisplayText(value)}
        onChange={e => onChange(e.target.value)}
        rows={textarea ? 3 : 2}
        placeholder={field.placeholder}
        style={{ ...common, resize: 'vertical', minHeight: textarea ? 60 : 48, lineHeight: 1.6 }}
      />
    )
  }
  if (field.type === 'select') {
    return (
      <select value={typeof value === 'string' ? value : ''} onChange={e => onChange(e.target.value)} style={common}>
        <option value="">未选择</option>
        {(field.options || []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    )
  }
  if (field.type === 'number') {
    return (
      <input
        type="number"
        value={typeof value === 'number' || typeof value === 'string' ? String(value) : ''}
        onChange={e => { const n = parseInt(e.target.value, 10); onChange(isNaN(n) ? '' : n) }}
        placeholder={field.placeholder}
        style={common}
      />
    )
  }
  return (
    <input
      value={typeof value === 'string' ? value : ''}
      onChange={e => onChange(e.target.value)}
      placeholder={field.placeholder}
      style={common}
    />
  )
}

export function EntityEditModal({ open, section, entity, onClose, onSave }: Props) {
  const fields = section.fields || []
  const coreFields = fields.filter(f => f.core)
  const fixedFields = fields.filter(f => !f.core)

  const [values, setValues] = useState<Record<string, unknown>>({})
  const [blocks, setBlocks] = useState<OutlineEntityBlock[]>([])

  // 打开/切换实体时初始化（旧数据兼容：模板外未知键 → 并入初始条块）
  useEffect(() => {
    if (!open) return
    const src = entity ? (entity as Record<string, unknown>) : {}
    const init: Record<string, unknown> = {}
    for (const f of fields) {
      init[f.key] = src[f.key] ?? f.defaultValue ?? ''
    }
    setValues(init)

    // 条块：优先读取已有 blocks；旧实体无 blocks 时，把模板外的键转成条块
    const existing = Array.isArray(src.blocks) ? src.blocks as OutlineEntityBlock[] : []
    if (existing.length > 0) {
      setBlocks(existing.map(b => ({ label: String(b.label || ''), content: String(b.content || '') })))
    } else {
      const knownKeys = new Set(fields.map(f => f.key))
      const converted: OutlineEntityBlock[] = []
      for (const [k, v] of Object.entries(src)) {
        if (k === 'id' || k === 'blocks' || knownKeys.has(k)) continue
        const s = typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v)
        if (s) converted.push({ label: k, content: s })
      }
      setBlocks(converted)
    }
  }, [open, section, entity])

  const setValue = (key: string, v: unknown) => setValues(prev => ({ ...prev, [key]: v }))
  const setBlock = (i: number, patch: Partial<OutlineEntityBlock>) => {
    setBlocks(prev => prev.map((b, j) => (j === i ? { ...b, ...patch } : b)))
  }
  const addBlock = () => setBlocks(prev => [...prev, { label: '', content: '' }])
  const removeBlock = (i: number) => setBlocks(prev => prev.filter((_, j) => j !== i))

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title={`${entity ? '编辑' : '新建'}${section.name}`}
      draggable
      width={580}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: '62vh', overflowY: 'auto' }} className="custom-scrollbar">
        {/* 结构化核心字段（识别属性：名称/类型/状态/章号…） */}
        {coreFields.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: coreFields.length >= 3 ? 'repeat(3, 1fr)' : `repeat(${Math.min(coreFields.length, 2)}, 1fr)`, gap: 10 }}>
            {coreFields.map(f => (
              <div key={f.key}>
                <div style={fieldLabel}>{f.label}{f.required ? <span style={{ color: '#ef4444' }}> *</span> : null}</div>
                <FieldInput field={f} value={values[f.key]} onChange={v => setValue(f.key, v)} />
              </div>
            ))}
          </div>
        )}

        {/* 固定专属词条（按部分定制，不可删；留空即可跳过） */}
        {fixedFields.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {fixedFields.map(f => (
              <div key={f.key}>
                <div style={fieldLabel}>{f.label}</div>
                <FieldInput field={f} value={values[f.key]} onChange={v => setValue(f.key, v)} textarea />
              </div>
            ))}
          </div>
        )}

        {/* 自由信息条块（用户新增，可增删改） */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <div style={fieldLabel}>新增信息条块 <span style={{ fontWeight: 400, color: '#9b8e84' }}>— 自由增删，例如「口头禅」「标志性台词」</span></div>
            <button onClick={addBlock} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#7c3aed', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <PlusIcon style={{ width: 13, height: 13 }} /> 添加条块
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {blocks.map((b, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 10, borderRadius: 10, background: '#faf9f8', border: '1px solid rgba(0,0,0,0.05)' }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input
                    value={b.label}
                    onChange={e => setBlock(i, { label: e.target.value })}
                    placeholder="条块名称（如：口头禅）"
                    style={{ ...fieldInput, fontWeight: 600, width: 150, flexShrink: 0 }}
                  />
                  <button onClick={() => removeBlock(i)} title="删除此条块"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#d4ccc4', padding: 4, display: 'flex', marginLeft: 'auto' }}
                    onMouseEnter={e => { e.currentTarget.style.color = '#ef4444' }}
                    onMouseLeave={e => { e.currentTarget.style.color = '#d4ccc4' }}>
                    <TrashIcon style={{ width: 14, height: 14 }} />
                  </button>
                </div>
                <textarea
                  value={b.content}
                  onChange={e => setBlock(i, { content: e.target.value })}
                  rows={2}
                  placeholder="条块内容..."
                  style={{ ...fieldInput, resize: 'vertical', minHeight: 48, lineHeight: 1.6, fontFamily: 'inherit' }}
                />
              </div>
            ))}
            {blocks.length === 0 && (
              <div style={{ fontSize: 12, color: '#9b8e84', padding: '8px 2px' }}>暂无条块，点击「添加条块」补充信息</div>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 14, marginTop: 14, borderTop: '1px solid rgba(0,0,0,0.06)' }}>
        <Button variant="secondary" size="sm" onClick={onClose}>取消</Button>
        <Button size="sm" onClick={() => {
          const nameField = fields.find(f => f.required || f.key === 'name')
          if (nameField && !String(values[nameField.key] ?? '').trim()) {
            alert(`请填写「${nameField.label}」`)
            return
          }
          const data: Record<string, unknown> = { ...values }
          const filled = blocks.filter(b => b.label.trim() || b.content.trim())
          if (filled.length > 0) data.blocks = filled.map(b => ({ label: b.label.trim(), content: b.content.trim() }))
          onSave(data)
        }}>保存</Button>
      </div>
    </Modal>
  )
}
