import React from 'react'

export function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#6b5e54', marginBottom: 4 }}>
        {label}
      </label>
      {children}
    </div>
  )
}

export function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div
      className="glow-hover"
      style={{
        flex: 1,
        padding: '12px 16px',
        borderRadius: 14,
        background: `linear-gradient(135deg, ${color}06 0%, ${color}0c 100%)`,
        border: `1px solid ${color}18`,
        transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        minWidth: 100,
      }}
      onMouseEnter={e => {
        e.currentTarget.style.transform = 'translateY(-2px)'
        e.currentTarget.style.boxShadow = `0 6px 20px ${color}15`
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = 'translateY(0)'
        e.currentTarget.style.boxShadow = 'none'
      }}
    >
      <div style={{ fontSize: 10, color: '#9b8e84', marginBottom: 4, fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color, letterSpacing: '-0.5px' }}>{value}</div>
    </div>
  )
}

export const miniSelect: React.CSSProperties = {
  padding: '4px 10px', fontSize: 11, borderRadius: 10, border: '1px solid rgba(0,0,0,0.08)',
  outline: 'none', background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: '#4a3f38',
  transition: 'all 0.15s ease',
}
