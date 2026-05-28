// ── Design Tokens ──
// Central source of truth for all visual constants.
// Components should import from here instead of hardcoding values.

export const colors = {
  // Accent
  accent: '#7c3aed',
  accentHover: '#6d28d9',
  accentLight: '#ede9fe',
  accentGlow: 'rgba(124, 58, 237, 0.15)',
  accentBg: 'rgba(124, 58, 237, 0.06)',

  // Semantic
  success: '#16a34a',
  successBg: 'rgba(22, 163, 74, 0.06)',
  warning: '#e67e00',
  warningBg: 'rgba(230, 126, 0, 0.06)',
  error: '#dc2626',
  errorBg: 'rgba(220, 38, 38, 0.06)',
  info: '#2563eb',
  infoBg: 'rgba(37, 99, 235, 0.06)',

  // Text
  textPrimary: '#2d2520',
  textSecondary: '#6b5e54',
  textMuted: '#9b8e84',
  textInverse: '#ffffff',

  // Surface
  bgBody: 'linear-gradient(135deg, #faf8f6 0%, #f5f3f0 30%, #f3f0f8 70%, #f0edf6 100%)',
  bgSurface: '#faf9f8',
  bgCard: 'rgba(255, 255, 255, 0.6)',
  bgCardSolid: '#ffffff',
  bgHover: 'rgba(0, 0, 0, 0.03)',
  bgActive: 'rgba(124, 58, 237, 0.06)',
  bgInput: '#faf9f8',

  // Border
  border: 'rgba(0, 0, 0, 0.06)',
  borderHover: 'rgba(0, 0, 0, 0.1)',
  borderAccent: 'rgba(124, 58, 237, 0.2)',

  // Glass
  glassBg: 'rgba(255, 255, 255, 0.65)',
  glassBgLight: 'rgba(255, 255, 255, 0.45)',
  glassBorder: 'rgba(255, 255, 255, 0.5)',
  glassBlur: 20,
} as const

export const radius = {
  xs: 4,
  sm: 6,
  md: 10,
  lg: 14,
  xl: 16,
  '2xl': 20,
  '3xl': 24,
  full: 9999,
} as const

export const shadow = {
  none: 'none',
  xs: '0 1px 2px rgba(0,0,0,0.04)',
  sm: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
  md: '0 4px 12px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.04)',
  lg: '0 12px 40px rgba(0,0,0,0.12), 0 4px 8px rgba(0,0,0,0.04)',
  xl: '0 24px 64px rgba(0,0,0,0.14)',
  glow: `0 0 20px rgba(124, 58, 237, 0.15)`,
  glowStrong: `0 0 30px rgba(124, 58, 237, 0.25)`,
} as const

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
  '4xl': 48,
} as const

export const fontSize = {
  xs: 10,
  sm: 11,
  base: 13,
  md: 14,
  lg: 16,
  xl: 18,
  '2xl': 22,
  '3xl': 28,
} as const

export const transition = {
  fast: '100ms ease',
  normal: '150ms ease',
  slow: '200ms ease',
  smooth: '300ms cubic-bezier(0.16, 1, 0.3, 1)',
  bounce: '400ms cubic-bezier(0.34, 1.56, 0.64, 1)',
} as const

// ── Composite Styles ──
// Pre-built style objects for common patterns

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
// Call once at app startup to sync tokens to CSS custom properties

export function injectThemeVars(): void {
  const root = document.documentElement
  const vars: Record<string, string> = {
    '--color-accent': colors.accent,
    '--color-accent-hover': colors.accentHover,
    '--color-accent-light': colors.accentLight,
    '--color-accent-glow': colors.accentGlow,
    '--color-text-primary': colors.textPrimary,
    '--color-text-secondary': colors.textSecondary,
    '--color-text-muted': colors.textMuted,
    '--color-bg-surface': colors.bgSurface,
    '--color-border': colors.border,
    '--radius-sm': `${radius.sm}px`,
    '--radius-md': `${radius.md}px`,
    '--radius-lg': `${radius.lg}px`,
    '--radius-xl': `${radius.xl}px`,
    '--radius-2xl': `${radius['2xl']}px`,
    '--radius-3xl': `${radius['3xl']}px`,
    '--shadow-sm': shadow.sm,
    '--shadow-md': shadow.md,
    '--shadow-lg': shadow.lg,
    '--shadow-glow': shadow.glow,
    '--transition-fast': transition.fast,
    '--transition-normal': transition.normal,
    '--transition-smooth': transition.smooth,
  }
  for (const [key, val] of Object.entries(vars)) {
    root.style.setProperty(key, val)
  }
}
