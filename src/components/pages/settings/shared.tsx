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
    <div style={{ flex: 1, padding: '10px 14px', borderRadius: 12, background: `${color}08`, border: `1px solid ${color}20` }}>
      <div style={{ fontSize: 10, color: '#9b8e84', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color }}>{value}</div>
    </div>
  )
}

export const miniSelect: React.CSSProperties = {
  padding: '4px 10px', fontSize: 11, borderRadius: 8, border: '1px solid rgba(0,0,0,0.08)',
  outline: 'none', background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: '#4a3f38',
}
