import { useState, useEffect } from 'react'
import Modal from './Modal'
import Button from './Button'

interface Props {
  isOpen: boolean
  title: string
  original: string
  result: string
  onApply: (text: string) => void
  onClose: () => void
}

export default function PolishPreview({ isOpen, title, original, result, onApply, onClose }: Props) {
  const [edited, setEdited] = useState(result)

  useEffect(() => { if (isOpen) setEdited(result) }, [isOpen, result])

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} width={640} draggable>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#9b8e84', marginBottom: 4 }}>原文</div>
          <div style={{
            padding: 12, borderRadius: 10, background: '#faf9f8',
            fontSize: 13, lineHeight: 1.8, color: '#6b5e54',
            maxHeight: 120, overflow: 'auto',
          }} className="custom-scrollbar">
            {original}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#7c3aed', marginBottom: 4 }}>AI 结果（可编辑）</div>
          <textarea aria-label="AI 结果（可编辑）" value={edited} onChange={e => setEdited(e.target.value)}
            className="custom-scrollbar"
            style={{
              width: '100%', padding: 12, borderRadius: 10,
              border: '1px solid rgba(124,58,237,0.15)', outline: 'none',
              fontSize: 13, lineHeight: 1.8, fontFamily: 'inherit',
              color: '#2d2520', background: '#faf9f8',
              minHeight: 160, resize: 'vertical',
            }}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8, borderTop: '1px solid #f0ece8' }}>
          <Button variant="secondary" onClick={onClose}>取消</Button>
          <Button onClick={() => onApply(edited)}>应用</Button>
        </div>
      </div>
    </Modal>
  )
}
