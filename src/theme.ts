// ── Design Tokens ──
// Central source of truth for all visual constants.
// Components should import from here instead of hardcoding values.
// Now supports multi-theme via ThemeConfig.

import type { ThemeConfig } from './themes'
import { getTheme, DEFAULT_THEME } from './themes'

// ── Legacy exports (backward compatible, points to default theme) ──

const defaultTheme = getTheme(DEFAULT_THEME)

export const colors = {
  accent: defaultTheme.colors.accent,
  accentHover: defaultTheme.colors.accentHover,
  accentLight: defaultTheme.colors.accentLight,
  accentGlow: defaultTheme.colors.accentGlow,
  accentBg: defaultTheme.colors.accentBg,
  success: defaultTheme.colors.success,
  successBg: defaultTheme.colors.successBg,
  warning: defaultTheme.colors.warning,
  warningBg: defaultTheme.colors.warningBg,
  error: defaultTheme.colors.error,
  errorBg: defaultTheme.colors.errorBg,
  info: defaultTheme.colors.info,
  infoBg: defaultTheme.colors.infoBg,
  textPrimary: defaultTheme.colors.textPrimary,
  textSecondary: defaultTheme.colors.textSecondary,
  textMuted: defaultTheme.colors.textMuted,
  textInverse: defaultTheme.colors.textInverse,
  bgBody: defaultTheme.colors.bgBody,
  bgSurface: defaultTheme.colors.bgSurface,
  bgCard: defaultTheme.colors.bgCard,
  bgCardSolid: defaultTheme.colors.bgCardSolid,
  bgHover: defaultTheme.colors.bgHover,
  bgActive: 'rgba(124,58,237,0.06)',
  bgInput: defaultTheme.colors.bgInput,
  border: defaultTheme.colors.border,
  borderHover: defaultTheme.colors.borderHover,
  borderAccent: defaultTheme.colors.borderAccent,
  glassBg: defaultTheme.glass.bg,
  glassBgLight: defaultTheme.glass.bgLight,
  glassBorder: defaultTheme.glass.border,
  glassBlur: defaultTheme.glass.blur,
} as const

export const radius = {
  xs: defaultTheme.radius.xs,
  sm: defaultTheme.radius.sm,
  md: defaultTheme.radius.md,
  lg: defaultTheme.radius.lg,
  xl: defaultTheme.radius.xl,
  '2xl': defaultTheme.radius.xxl,
  '3xl': 24,
  full: defaultTheme.radius.full,
} as const

export const shadow = {
  none: 'none',
  xs: '0 1px 2px rgba(0,0,0,0.04)',
  sm: defaultTheme.shadow.sm,
  md: defaultTheme.shadow.md,
  lg: defaultTheme.shadow.lg,
  xl: '0 24px 64px rgba(0,0,0,0.14)',
  glow: defaultTheme.shadow.glow,
  glowStrong: defaultTheme.shadow.glowStrong,
} as const

export const spacing = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 20, '2xl': 24, '3xl': 32, '4xl': 48,
} as const

export const fontSize = {
  xs: 10, sm: 11, base: 13, md: 14, lg: 16, xl: 18, '2xl': 22, '3xl': 28,
} as const

export const transition = {
  fast: '100ms ease',
  normal: '150ms ease',
  slow: '200ms ease',
  smooth: '300ms cubic-bezier(0.16, 1, 0.3, 1)',
  bounce: '400ms cubic-bezier(0.34, 1.56, 0.64, 1)',
} as const

export const glassStyle = {
  background: colors.glassBg,
  backdropFilter: `blur(${colors.glassBlur}px)`,
  WebkitBackdropFilter: `blur(${colors.glassBlur}px)`,
  border: `1px solid ${colors.glassBorder}`,
} as const

export const cardStyle = {
  ...glassStyle,
  borderRadius: radius['2xl'],
  padding: spacing.xl,
  transition: transition.slow,
} as const

export const inputStyle = {
  width: '100%',
  padding: '8px 12px',
  fontSize: fontSize.base,
  borderRadius: radius.md,
  border: `1px solid ${colors.border}`,
  outline: 'none',
  background: colors.bgInput,
  fontFamily: 'inherit',
  color: colors.textPrimary,
  transition: transition.normal,
} as const

// ── CSS Variable Injection ──
// Now accepts a ThemeConfig parameter for multi-theme support

export function injectThemeVars(theme?: ThemeConfig): void {
  const t = theme || defaultTheme
  const root = document.documentElement
  const vars: Record<string, string> = {
    // Colors
    '--theme-accent': t.colors.accent,
    '--theme-accent-hover': t.colors.accentHover,
    '--theme-accent-light': t.colors.accentLight,
    '--theme-accent-glow': t.colors.accentGlow,
    '--theme-accent-bg': t.colors.accentBg,
    '--theme-text-primary': t.colors.textPrimary,
    '--theme-text-secondary': t.colors.textSecondary,
    '--theme-text-muted': t.colors.textMuted,
    '--theme-text-inverse': t.colors.textInverse,
    '--theme-bg-body': t.colors.bgBody,
    '--theme-bg-surface': t.colors.bgSurface,
    '--theme-bg-card': t.colors.bgCard,
    '--theme-bg-card-solid': t.colors.bgCardSolid,
    '--theme-bg-hover': t.colors.bgHover,
    '--theme-bg-input': t.colors.bgInput,
    '--theme-border': t.colors.border,
    '--theme-border-hover': t.colors.borderHover,
    '--theme-border-accent': t.colors.borderAccent,
    '--theme-success': t.colors.success,
    '--theme-success-bg': t.colors.successBg,
    '--theme-warning': t.colors.warning,
    '--theme-warning-bg': t.colors.warningBg,
    '--theme-error': t.colors.error,
    '--theme-error-bg': t.colors.errorBg,
    '--theme-info': t.colors.info,
    '--theme-info-bg': t.colors.infoBg,
    // Glass
    '--theme-glass-bg': t.glass.bg,
    '--theme-glass-bg-light': t.glass.bgLight,
    '--theme-glass-border': t.glass.border,
    '--theme-glass-blur': `${t.glass.blur}px`,
    // Radius
    '--theme-radius-xs': `${t.radius.xs}px`,
    '--theme-radius-sm': `${t.radius.sm}px`,
    '--theme-radius-md': `${t.radius.md}px`,
    '--theme-radius-lg': `${t.radius.lg}px`,
    '--theme-radius-xl': `${t.radius.xl}px`,
    '--theme-radius-xxl': `${t.radius.xxl}px`,
    // Shadow
    '--theme-shadow-sm': t.shadow.sm,
    '--theme-shadow-md': t.shadow.md,
    '--theme-shadow-lg': t.shadow.lg,
    '--theme-shadow-glow': t.shadow.glow,
    '--theme-shadow-glow-strong': t.shadow.glowStrong,
    // Typography
    '--theme-font-family': t.typography.fontFamily,
    '--theme-font-heading': t.typography.headingFontFamily || t.typography.fontFamily,
    '--theme-base-font-size': `${t.typography.baseFontSize}px`,
    // Legacy aliases (for existing CSS that uses old var names)
    '--color-accent': t.colors.accent,
    '--color-accent-hover': t.colors.accentHover,
    '--color-accent-light': t.colors.accentLight,
    '--color-accent-glow': t.colors.accentGlow,
    '--color-text-primary': t.colors.textPrimary,
    '--color-text-secondary': t.colors.textSecondary,
    '--color-text-muted': t.colors.textMuted,
    '--color-bg-surface': t.colors.bgSurface,
    '--color-border': t.colors.border,
    '--radius-sm': `${t.radius.sm}px`,
    '--radius-md': `${t.radius.md}px`,
    '--radius-lg': `${t.radius.lg}px`,
    '--radius-xl': `${t.radius.xl}px`,
    '--radius-2xl': `${t.radius.xxl}px`,
    '--radius-3xl': '24px',
    '--shadow-sm': t.shadow.sm,
    '--shadow-md': t.shadow.md,
    '--shadow-lg': t.shadow.lg,
    '--shadow-glow': t.shadow.glow,
    '--transition-fast': transition.fast,
    '--transition-normal': transition.normal,
    '--transition-smooth': transition.smooth,
  }
  for (const [key, val] of Object.entries(vars)) {
    root.style.setProperty(key, val)
  }

  // Set theme class on html element
  root.className = `theme-${t.id}`
}
