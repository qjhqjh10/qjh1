import type React from 'react'

// ── Shared Style Library ──
// All values use CSS custom properties injected by injectThemeVars().
// Switching themes automatically updates all styles that import from here.

// Colors — mapped to theme CSS variables
export const c = {
  accent: 'var(--theme-accent)',
  accentHover: 'var(--theme-accent-hover)',
  accentLight: 'var(--theme-accent-light)',
  accentGlow: 'var(--theme-accent-glow)',
  accentBg: 'var(--theme-accent-bg)',
  success: 'var(--theme-success)',
  successBg: 'var(--theme-success-bg)',
  warning: 'var(--theme-warning)',
  warningBg: 'var(--theme-warning-bg)',
  error: 'var(--theme-error)',
  errorBg: 'var(--theme-error-bg)',
  info: 'var(--theme-info)',
  infoBg: 'var(--theme-info-bg)',
  text: 'var(--theme-text-primary)',
  text2: 'var(--theme-text-secondary)',
  text3: 'var(--theme-text-muted)',
  bg: 'var(--theme-bg-surface)',
  border: 'var(--theme-border)',
  borderHover: 'var(--theme-border-hover)',
  white: 'var(--theme-text-inverse)',
}

// Common inline styles
export const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  fontSize: 'var(--theme-base-font-size)',
  borderRadius: 'var(--theme-radius-md)',
  border: '1px solid var(--theme-border)',
  outline: 'none',
  background: 'var(--theme-bg-input)',
  fontFamily: 'inherit',
  color: 'var(--theme-text-primary)',
  transition: 'all 0.15s ease',
}

export const miniSelect: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: 11,
  borderRadius: 'var(--theme-radius-sm)',
  border: '1px solid var(--theme-border)',
  outline: 'none',
  background: 'var(--theme-bg-card-solid)',
  cursor: 'pointer',
  fontFamily: 'inherit',
  color: 'var(--theme-text-primary)',
  transition: 'all 0.15s ease',
}

export const cardBase: React.CSSProperties = {
  padding: 20,
  borderRadius: 'var(--theme-radius-xxl)',
  background: 'var(--theme-glass-bg)',
  border: '1px solid var(--theme-glass-border)',
}

export const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--theme-text-secondary)', marginBottom: 4,
}

export const sectionTitle: React.CSSProperties = {
  fontSize: 14, fontWeight: 600, color: 'var(--theme-text-primary)', marginBottom: 12,
}

export const mutedText: React.CSSProperties = {
  fontSize: 12, color: 'var(--theme-text-muted)', lineHeight: 1.6,
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
    borderRadius: 'var(--theme-radius-lg)',
    background: `${color}08`,
    border: `1px solid ${color}20`,
    transition: 'all 0.2s ease',
  }
}

// Tab button style generator
export function tabBtnStyle(active: boolean): React.CSSProperties {
  return {
    padding: '4px 14px',
    borderRadius: 'var(--theme-radius-sm)',
    border: 'none',
    cursor: 'pointer',
    fontSize: 12,
    background: active ? 'var(--theme-accent-bg)' : 'transparent',
    color: active ? 'var(--theme-accent)' : 'var(--theme-text-secondary)',
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
  borderRadius: 'var(--theme-radius-xxl)',
  background: 'var(--theme-glass-bg)',
  border: '1px solid var(--theme-glass-border)',
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

// Typography presets — responsive to theme baseFontSize and font
export const headingLg: React.CSSProperties = {
  fontSize: 'calc(var(--theme-base-font-size) * 1.7)',
  fontWeight: 700,
  color: 'var(--theme-text-primary)',
  fontFamily: 'var(--theme-font-heading)',
}
export const headingMd: React.CSSProperties = {
  fontSize: 'calc(var(--theme-base-font-size) * 1.4)',
  fontWeight: 700,
  color: 'var(--theme-text-primary)',
  fontFamily: 'var(--theme-font-heading)',
}
export const headingSm: React.CSSProperties = {
  fontSize: 'calc(var(--theme-base-font-size) * 1.25)',
  fontWeight: 600,
  color: 'var(--theme-text-primary)',
  fontFamily: 'var(--theme-font-heading)',
}
export const bodyText: React.CSSProperties = {
  fontSize: 'var(--theme-base-font-size)',
  color: 'var(--theme-text-primary)',
  lineHeight: 1.6,
}
export const captionText: React.CSSProperties = {
  fontSize: 'calc(var(--theme-base-font-size) * 0.85)',
  color: 'var(--theme-text-muted)',
}
