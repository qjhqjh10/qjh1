import Modal from '@/components/common/Modal'
import Button from '@/components/common/Button'
import type { Character } from '@/types/character'

interface RawCharacterInput {
  name?: string; role?: string; traits?: string[] | string; personality?: string
  background?: string; appearance?: string; arc?: string; abilities?: string
  importance?: number; relationships?: { target: string; type: string }[] | string
}

interface Props {
  isOpen: boolean
  importChars: RawCharacterInput[]
  existingChars: Character[]
  charActions: Record<string, 'new' | 'skip' | 'overwrite' | 'merge'>
  onActionChange: (actions: Record<string, 'new' | 'skip' | 'overwrite' | 'merge'>) => void
  onConfirm: () => void
  onClose: () => void
}

export default function ImportCharactersModal({ isOpen, importChars, existingChars, charActions, onActionChange, onConfirm, onClose }: Props) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`导入角色预览 (${importChars.length}个)`} width={700}>
      <div style={{ maxHeight: '60vh', overflowY: 'auto' }} className="custom-scrollbar">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {importChars.map((c, i) => {
            const existing = existingChars.find(ec => ec.name === c.name)
            const isNew = !existing
            const action = charActions[i] || 'skip'
            const traitsStr = Array.isArray(c.traits) ? c.traits.join('、') : (c.traits || '')
            return (
              <div key={i} style={{
                padding: '12px 16px', borderRadius: 12, background: '#fff',
                border: action === 'skip' ? '1px solid rgba(0,0,0,0.04)' : isNew ? '1px solid rgba(22,163,74,0.2)' : '1px solid rgba(245,158,11,0.2)',
                opacity: action === 'skip' ? 0.5 : 1,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="checkbox" checked={action !== 'skip'} onChange={() => {
                      const next = { ...charActions }
                      next[i] = action === 'skip' ? (isNew ? 'new' : 'merge') : 'skip'
                      onActionChange(next)
                    }} style={{ width: 14, height: 14, accentColor: '#7c3aed' }} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#2d2520' }}>{c.name}</span>
                    <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'rgba(124,58,237,0.08)', color: '#7c3aed' }}>{c.role || '其他'}</span>
                    {isNew ? <span style={{ fontSize: 9, color: '#16a34a' }}>新建</span> : <span style={{ fontSize: 9, color: '#f59e0b' }}>冲突(已存在)</span>}
                  </div>
                  {!isNew && action !== 'skip' && (
                    <div style={{ display: 'flex', gap: 4, fontSize: 10 }}>
                      {(['skip', 'overwrite', 'merge'] as const).map(act => (
                        <button key={act} onClick={() => { const next = { ...charActions }; next[i] = act; onActionChange(next) }} style={{
                          padding: '3px 8px', borderRadius: 6, border: '1px solid ' + (action === act ? '#7c3aed' : 'rgba(0,0,0,0.08)'),
                          background: action === act ? 'rgba(124,58,237,0.06)' : '#fff', cursor: 'pointer',
                          color: action === act ? '#7c3aed' : '#6b5e54', fontWeight: action === act ? 600 : 400,
                        }}>{act === 'overwrite' ? '覆盖' : act === 'merge' ? '合并' : '跳过'}</button>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 10, color: '#6b5e54', lineHeight: 1.6 }}>
                  {traitsStr && <div>性格: {traitsStr}</div>}
                  {c.background && <div>背景: {c.background.slice(0, 80)}{c.background.length > 80 ? '...' : ''}</div>}
                  {c.appearance && <div>外貌: {c.appearance.slice(0, 60)}{c.appearance.length > 60 ? '...' : ''}</div>}
                </div>
                {!isNew && action === 'merge' && existing && (
                  <div style={{ fontSize: 9, color: '#9b8e84', marginTop: 4, padding: '4px 8px', borderRadius: 6, background: 'rgba(0,0,0,0.02)' }}>
                    合并: 新数据覆盖同名非空字段，保留旧数据独有字段
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, paddingTop: 12, borderTop: '1px solid rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => onActionChange(Object.fromEntries(importChars.map((_, i) => [i, 'new'] as const)))} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: '#7c3aed' }}>全选新建</button>
          <button onClick={() => onActionChange(Object.fromEntries(importChars.map((_, i) => [i, 'skip'] as const)))} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: '#7c3aed' }}>全不选</button>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="secondary" size="sm" onClick={onClose}>取消</Button>
          <Button size="sm" onClick={onConfirm} disabled={Object.values(charActions).every(a => a === 'skip')}>
            确认导入 ({Object.values(charActions).filter(a => a !== 'skip').length}个角色)
          </Button>
        </div>
      </div>
    </Modal>
  )
}
