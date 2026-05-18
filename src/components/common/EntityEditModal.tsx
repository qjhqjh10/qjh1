import type { ReactNode } from 'react'
import Button from './Button'

interface Props {
  title: string
  onClose: () => void
  onSave: () => void
  saveDisabled?: boolean
  width?: number
  children: ReactNode
}

export function EntityEditModal({ title, onClose, onSave, saveDisabled, width = 420, children }: Props) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 16, padding: 20, width, boxShadow: '0 12px 40px rgba(0,0,0,0.15)' }}
      >
        <h3 style={{ fontSize: 15, fontWeight: 700, color: '#2d2520', marginBottom: 14 }}>{title}</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {children}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 14 }}>
          <Button variant="secondary" size="sm" onClick={onClose}>取消</Button>
          <Button size="sm" onClick={onSave} disabled={saveDisabled}>保存</Button>
        </div>
      </div>
    </div>
  )
}
