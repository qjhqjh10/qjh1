import type React from 'react'

interface Props {
  icon: React.ReactNode
  label: string
  active: boolean
  onClick: () => void
}

export default function ToggleButton({ icon, label, active, onClick }: Props) {
  return (
    <button onClick={onClick} style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 8,
      border: active ? '1px solid rgba(124,58,237,0.25)' : '1px solid rgba(0,0,0,0.06)',
      background: active ? 'rgba(124,58,237,0.06)' : 'transparent',
      color: active ? '#7c3aed' : '#9b8e84', fontSize: 11, fontWeight: active ? 600 : 400,
      cursor: 'pointer', transition: 'all 0.1s ease',
    }}>
      {icon} {label} {active ? 'ON' : 'OFF'}
    </button>
  )
}
