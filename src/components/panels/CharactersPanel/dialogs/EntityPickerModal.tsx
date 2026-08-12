// ── 实体勾选弹窗（v16.4.1 用户决策）──
// AI 生成弹窗的大纲部分 → 点击"选择内容"弹出：只注入勾选的实体文件。
// 语义：未展开 = 全部注入（现状）；展开后勾选列表为空 = 该部分不注入；要全部点全选。

import { useEffect, useState } from 'react'
import Modal from '@/components/common/Modal'
import Button from '@/components/common/Button'
import { checkInput } from '@/components/common/ChapterGenerationModal/constants'
import type { OutlineEntity } from '@/types/outline'

interface Props {
  open: boolean
  partName: string
  emoji: string
  entities: OutlineEntity[]
  /** 已选实体 id（空数组 = 当前选择为空） */
  selectedIds: string[]
  onClose: () => void
  /** 确定（返回勾选的实体 id 数组） */
  onConfirm: (ids: string[]) => void
}

export function EntityPickerModal({ open, partName, emoji, entities, selectedIds, onClose, onConfirm }: Props) {
  const [draft, setDraft] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (open) setDraft(new Set(selectedIds))
  }, [open, partName])

  const toggle = (id: string) => {
    setDraft(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const displayName = (e: OutlineEntity) =>
    String(e.name || (e as Record<string, unknown>).description || e.id || '未命名')

  return (
    <Modal isOpen={open} onClose={onClose} title={`选择要注入的${partName}`} width={480} draggable>
      <div style={{ fontSize: 12.5, color: '#6b5e54', marginBottom: 10, lineHeight: 1.7 }}>
        只将勾选的{partName}注入 AI 生成参考（省 token、避免无关设定干扰）。<b>不勾选任何项 = 该部分完全不注入</b>。
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#4a3f38' }}>{emoji} {partName} · 已选 {draft.size} / {entities.length}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button onClick={() => setDraft(new Set(entities.map(e => e.id)))} title="全部注入"
            style={{ background: 'none', border: '1px solid rgba(0,0,0,0.12)', borderRadius: 6, padding: '3px 10px', fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit', color: '#4a3f38', fontWeight: 600 }}>全选</button>
          <button onClick={() => setDraft(new Set())} title="该部分不注入"
            style={{ background: 'none', border: '1px solid rgba(0,0,0,0.12)', borderRadius: 6, padding: '3px 10px', fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit', color: '#4a3f38', fontWeight: 600 }}>清空（不注入）</button>
        </div>
      </div>
      <div className="custom-scrollbar" style={{ maxHeight: '48vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2, border: '1px solid rgba(0,0,0,0.05)', borderRadius: 10, padding: 6 }}>
        {entities.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', fontSize: 12.5, color: '#9b8e84' }}>该部分暂无内容，可先在大纲页创建</div>
        ) : entities.map(e => (
          <label key={e.id} style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 8, cursor: 'pointer',
            background: draft.has(e.id) ? 'rgba(124,58,237,0.06)' : 'transparent',
          }}>
            <input type="checkbox" checked={draft.has(e.id)} onChange={() => toggle(e.id)} style={checkInput} />
            <span style={{ fontSize: 13, fontWeight: draft.has(e.id) ? 600 : 400, color: draft.has(e.id) ? '#7c3aed' : '#3d342e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {displayName(e)}
            </span>
          </label>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 12, marginTop: 12, borderTop: '1px solid rgba(0,0,0,0.06)' }}>
        <Button variant="secondary" size="sm" onClick={onClose}>取消</Button>
        <Button size="sm" onClick={() => onConfirm([...draft])}>确定</Button>
      </div>
    </Modal>
  )
}
