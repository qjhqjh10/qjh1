// ── 新建部分向导（v16.4.1）──
// 用户自定义大纲部分（如"恋爱关系"）：填名称 + 字段模板。
// 字段 key 自动取 label（YAML 支持中文键，AI 生成时按 label 输出）。

import { useState } from 'react'
import Modal from '@/components/common/Modal'
import Button from '@/components/common/Button'
import { fieldLabel } from '@/components/pages/OutlinePage/constants'
import type { OutlineSectionField } from '@/types/outline'
import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline'
import { nanoid } from 'nanoid'

interface Props {
  open: boolean
  onClose: () => void
  /** 创建（key 自动生成 = 英文 safe key；name = 用户输入） */
  onCreate: (name: string, fields: OutlineSectionField[]) => void
}

const FIELD_TYPES: Array<{ value: OutlineSectionField['type']; label: string }> = [
  { value: 'text', label: '短文本' },
  { value: 'textarea', label: '长文本' },
  { value: 'select', label: '下拉选项' },
  { value: 'number', label: '数字' },
]

/** key 生成：中文 label → 拼音不可用，直接用 label（YAML 中文键合法） */
function keyFromLabel(label: string): string {
  return label.trim().replace(/\s+/g, '_') || `field_${nanoid(4)}`
}

export function SectionWizardModal({ open, onClose, onCreate }: Props) {
  // v16.4.1(审查修复): 默认模板单一真源（reset 复用）
  const defaultFields = (): OutlineSectionField[] => [
    { key: 'name', label: '名称', type: 'text', required: true },
    { key: 'description', label: '描述', type: 'textarea' },
  ]
  const [name, setName] = useState('')
  const [fields, setFields] = useState<OutlineSectionField[]>(defaultFields)

  // 打开时重置默认模板（onClose 里调用 reset）
  const reset = () => {
    setName('')
    setFields(defaultFields())
  }

  const updateField = (i: number, patch: Partial<OutlineSectionField>) => {
    setFields(prev => prev.map((f, j) => {
      if (j !== i) return f
      const next = { ...f, ...patch }
      // label 变化时同步 key（name 字段除外——保留固定 key）
      if (patch.label !== undefined && f.key !== 'name' && patch.label !== f.label) {
        next.key = keyFromLabel(patch.label)
      }
      return next
    }))
  }

  const submit = () => {
    if (!name.trim()) { alert('请填写部分名称'); return }
    const valid = fields.filter(f => f.label.trim())
    onCreate(name.trim(), valid.map(f => ({ ...f, label: f.label.trim(), key: f.key === 'name' ? 'name' : keyFromLabel(f.label), core: true })))
    reset()
  }

  return (
    <Modal isOpen={open} onClose={() => { reset(); onClose() }} title="新建大纲部分" width={560} draggable>
      <div style={{ fontSize: 12.5, color: '#6b5e54', lineHeight: 1.7, marginBottom: 12 }}>
        创建后侧边栏会出现新部分，按卡片管理每个实体（一个实体一个文件）。
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={fieldLabel}>部分名称 <span style={{ color: '#ef4444' }}>*</span></div>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="如：恋爱关系、家族关系、时间线、修炼体系"
          style={{ width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid #e5e0da', outline: 'none', fontSize: 13.5, fontFamily: 'inherit', color: '#2d2520', background: '#faf9f8' }}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={fieldLabel} className="!mb-0">字段模板（编辑弹窗与 AI 生成共用）</div>
        <button onClick={() => setFields(prev => [...prev, { key: '', label: '', type: 'text' }])}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#7c3aed', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <PlusIcon style={{ width: 13, height: 13 }} /> 添加字段
        </button>
      </div>

      <div className="custom-scrollbar" style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 300, overflowY: 'auto', padding: 2 }}>
        {fields.map((f, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select
              value={f.type}
              onChange={e => updateField(i, { type: e.target.value as OutlineSectionField['type'] })}
              style={{ padding: '7px 8px', borderRadius: 8, border: '1px solid #e5e0da', fontSize: 12, fontFamily: 'inherit', background: '#fff', flexShrink: 0 }}
            >
              {FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <input
              value={f.label}
              onChange={e => updateField(i, { label: e.target.value })}
              placeholder={f.key === 'name' ? '名称（必填，不可删）' : '字段名'}
              disabled={f.key === 'name'}
              style={{ flex: 1, minWidth: 0, padding: '7px 10px', borderRadius: 8, border: '1px solid #e5e0da', outline: 'none', fontSize: 12.5, fontFamily: 'inherit', background: f.key === 'name' ? '#f1f0ee' : '#fff' }}
            />
            {f.type === 'select' && (
              <input
                value={(f.options || []).join(',')}
                onChange={e => updateField(i, { options: e.target.value.split(/[,，]/).map(s => s.trim()).filter(Boolean) })}
                placeholder="选项，逗号分隔"
                style={{ flex: 1, minWidth: 0, padding: '7px 10px', borderRadius: 8, border: '1px solid #e5e0da', outline: 'none', fontSize: 12, fontFamily: 'inherit' }}
              />
            )}
            {f.key !== 'name' && (
              <button onClick={() => setFields(prev => prev.filter((_, j) => j !== i))} title="删除字段"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#d4ccc4', padding: 6, display: 'flex', flexShrink: 0 }}>
                <TrashIcon style={{ width: 14, height: 14 }} />
              </button>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 14, marginTop: 14, borderTop: '1px solid rgba(0,0,0,0.06)' }}>
        <Button variant="secondary" size="sm" onClick={() => { reset(); onClose() }}>取消</Button>
        <Button size="sm" onClick={submit} disabled={!name.trim()}>创建</Button>
      </div>
    </Modal>
  )
}
