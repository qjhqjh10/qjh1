import Modal from './Modal'
import Button from './Button'
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline'

interface Props {
  isOpen: boolean
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmModal({ isOpen, title, message, confirmLabel = '确定', danger = false, onConfirm, onCancel }: Props) {
  return (
    <Modal isOpen={isOpen} onClose={onCancel} title="" width={420}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '8px 0' }}>
        <div style={{
          width: 48, height: 48, borderRadius: '50%',
          background: danger ? 'rgba(239,68,68,0.08)' : 'rgba(124,58,237,0.08)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <ExclamationTriangleIcon style={{ width: 24, height: 24, color: danger ? '#ef4444' : '#7c3aed' }} />
        </div>
        <div style={{ textAlign: 'center' }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1e1b2e', margin: '0 0 8px' }}>{title}</h3>
          <p style={{ fontSize: 13, color: '#6b5e54', lineHeight: 1.6, margin: 0 }}>{message}</p>
        </div>
        <div style={{ display: 'flex', gap: 10, paddingTop: 8 }}>
          <Button variant="secondary" onClick={onCancel}>取消</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
