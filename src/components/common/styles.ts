import type React from 'react'

// ── Shared Style Library ──
// Import these instead of hardcoding values. Reference: src/theme.ts

// Colors (matching theme.ts)
export const c = {
  accent: '#7c3aed',
  accentHover: '#6d28d9',
  accentLight: '#ede9fe',
  accentGlow: 'rgba(124,58,237,0.15)',
  accentBg: 'rgba(124,58,237,0.06)',
  success: '#16a34a',
  successBg: 'rgba(22,163,74,0.06)',
  warning: '#e67e00',
  warningBg: 'rgba(230,126,0,0.06)',
  error: '#dc2626',
  errorBg: 'rgba(220,38,38,0.06)',
  info: '#2563eb',
  infoBg: 'rgba(37,99,235,0.06)',
  text: '#2d2520',
  text2: '#6b5e54',
  text3: '#9b8e84',
  bg: '#faf9f8',
  border: 'rgba(0,0,0,0.06)',
  borderHover: 'rgba(0,0,0,0.1)',
  white: '#ffffff',
} as const

// Common inline styles
export const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  fontSize: 13,
  borderRadius: 10,
  border: `1px solid ${c.border}`,
  outline: 'none',
  background: c.bg,
  fontFamily: 'inherit',
  color: c.text,
  transition: 'all 0.15s ease',
}

export const miniSelect: React.CSSProperties = {
  padding: '4px 10px', fontSize: 11, borderRadius: 8, border: `1px solid ${c.border}`,
  outline: 'none', background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: '#4a3f38',
  transition: 'all 0.15s ease',
}

export const cardBase: React.CSSProperties = {
  padding: 20,
  borderRadius: 20,
  background: 'rgba(255,255,255,0.6)',
  border: '1px solid rgba(0,0,0,0.05)',
}

export const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 600, color: c.text2, marginBottom: 4,
}

export const sectionTitle: React.CSSProperties = {
  fontSize: 14, fontWeight: 600, color: c.text, marginBottom: 12,
}

export const mutedText: React.CSSProperties = {
  fontSize: 12, color: c.text3, lineHeight: 1.6,
}

// Transition presets
export const tFast = 'all 0.1s ease'
export const tNormal = 'all 0.15s ease'
export const tSmooth = 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)'

// Stat card style generator
export function statCardStyle(color: string): React.CSSProperties {
  return {
    flex: 1,
    padding: '10px 14px',
    borderRadius: 12,
    background: `${color}08`,
    border: `1px solid ${color}20`,
    transition: 'all 0.2s ease',
  }
}

// Tab button style generator
export function tabBtnStyle(active: boolean): React.CSSProperties {
  return {
    padding: '4px 14px',
    borderRadius: 8,
    border: 'none',
    cursor: 'pointer',
    fontSize: 12,
    background: active ? 'rgba(124,58,237,0.08)' : 'transparent',
    color: active ? c.accent : c.text2,
    fontWeight: active ? 600 : 400,
    transition: 'all 0.15s ease',
  }
}

// Page container style
export const pageContainer: React.CSSProperties = {
  flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column',
}

// Glass panel style
export const glassPanel: React.CSSProperties = {
  padding: 20,
  borderRadius: 20,
  background: 'rgba(255,255,255,0.6)',
  border: '1px solid rgba(0,0,0,0.05)',
}

// Scrollable list container
export const scrollListStyle = (maxH: number): React.CSSProperties => ({
  maxHeight: maxH,
  overflowY: 'auto',
})

// Textarea style (extends inputStyle)
export const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  resize: 'none' as const,
  minHeight: 80,
  lineHeight: 1.6,
}

// Typography presets
export const headingLg: React.CSSProperties = { fontSize: 22, fontWeight: 700, color: c.text }
export const headingMd: React.CSSProperties = { fontSize: 18, fontWeight: 700, color: c.text }
export const headingSm: React.CSSProperties = { fontSize: 16, fontWeight: 600, color: c.text }
export const bodyText: React.CSSProperties = { fontSize: 13, color: c.text, lineHeight: 1.6 }
export const captionText: React.CSSProperties = { fontSize: 11, color: c.text3 }
