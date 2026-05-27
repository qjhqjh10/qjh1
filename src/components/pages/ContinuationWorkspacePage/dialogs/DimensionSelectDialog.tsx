import Modal from '@/components/common/Modal'
import { CONTINUATION_DIMS } from '@/types/continuation'

interface DimensionSelectDialogProps {
  isOpen: boolean
  enabledDims: Set<string>
  activeProjectId: string | null
  onClose: () => void
  onUpdate: (dims: Set<string>) => void
}

const CATEGORIES = ['基础', '伏笔', '进阶'] as const

export function DimensionSelectDialog({ isOpen, enabledDims, activeProjectId, onClose, onUpdate }: DimensionSelectDialogProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="选择分析维度" width={520} draggable>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
          <button onClick={() => onUpdate(new Set(CONTINUATION_DIMS.map(d => d.key)))} style={{ fontSize: 10, padding: '3px 10px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.08)', background: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>全选</button>
          <button onClick={() => { onUpdate(new Set()); localStorage.setItem(`cont_dims_${activeProjectId}`, '[]') }} style={{ fontSize: 10, padding: '3px 10px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.08)', background: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>清空</button>
          <button onClick={() => { const d = new Set(CONTINUATION_DIMS.filter(d => d.category === '基础').map(d => d.key)); onUpdate(d); localStorage.setItem(`cont_dims_${activeProjectId}`, JSON.stringify([...d])) }} style={{ fontSize: 10, padding: '3px 10px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.08)', background: '#7c3aed', color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>仅基础</button>
        </div>
        {CATEGORIES.map(cat => {
          const catDims = CONTINUATION_DIMS.filter(d => d.category === cat)
          if (catDims.length === 0) return null
          return (
            <div key={cat}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#6b5e54', marginBottom: 6 }}>{cat}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                {catDims.map(d => (
                  <label key={d.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#2d2520', cursor: 'pointer' }}>
                    <input type="checkbox" checked={enabledDims.has(d.key)} onChange={() => {
                      const next = new Set(enabledDims)
                      if (next.has(d.key)) next.delete(d.key); else next.add(d.key)
                      localStorage.setItem(`cont_dims_${activeProjectId}`, JSON.stringify([...next]))
                      onUpdate(next)
                    }} style={{ accentColor: '#7c3aed' }} />
                    {d.label}
                  </label>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </Modal>
  )
}
