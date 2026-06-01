import Modal from '@/components/common/Modal'
import ScrollArea from '@/components/common/ScrollArea'
import { SOFTWARE_GUIDE } from '@/data/softwareGuide'

interface Props {
  isOpen: boolean
  onClose: () => void
}

export default function SoftwareGuideModal({ isOpen, onClose }: Props) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="软件功能说明" width={700} draggable>
      <ScrollArea maxHeight="70vh">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 4 }}>
          {SOFTWARE_GUIDE.map((section, si) => (
            <div key={si} style={{
              padding: 16, borderRadius: 14,
              background: 'rgba(255,255,255,0.6)',
              border: '1px solid rgba(0,0,0,0.05)',
            }}>
              <h3 style={{
                fontSize: 15, fontWeight: 700, color: '#2d2520',
                marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span>{section.icon}</span>
                <span>{section.title}</span>
              </h3>
              <ul style={{ margin: 0, padding: '0 0 0 4px', listStyle: 'none' }}>
                {section.items.map((item, ii) => (
                  <li key={ii} style={{
                    fontSize: 12, color: '#4a3f38', lineHeight: 1.7,
                    padding: '3px 0 3px 12px',
                    borderLeft: '2px solid rgba(124,58,237,0.15)',
                    marginBottom: 2,
                  }}>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </ScrollArea>
    </Modal>
  )
}
