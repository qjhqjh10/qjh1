import type { ReactNode } from 'react'
import Modal from './Modal'
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
    <Modal isOpen onClose={onClose} title={title} width={width}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {children}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 14 }}>
        <Button variant="secondary" size="sm" onClick={onClose}>取消</Button>
        <Button size="sm" onClick={onSave} disabled={saveDisabled}>保存</Button>
      </div>
    </Modal>
  )
}
