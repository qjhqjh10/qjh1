// ── Theme System ──
// Central registry for all visual themes. Each theme defines colors, glass, radius,
// shadow, typography, effects, and layout. Themes are applied via CSS custom properties.

export interface ThemeColors {
  accent: string
  accentHover: string
  accentLight: string
  accentGlow: string
  accentBg: string
  textPrimary: string
  textSecondary: string
  textMuted: string
  textInverse: string
  bgBody: string
  bgSurface: string
  bgCard: string
  bgCardSolid: string
  bgHover: string
  bgInput: string
  border: string
  borderHover: string
  borderAccent: string
  success: string; successBg: string
  warning: string; warningBg: string
  error: string; errorBg: string
  info: string; infoBg: string
}

export interface ThemeGlass {
  bg: string
  bgLight: string
  border: string
  blur: number
}

export interface ThemeRadius {
  xs: number; sm: number; md: number; lg: number
  xl: number; xxl: number; full: number
}

export interface ThemeShadow {
  sm: string; md: string; lg: string
  glow: string; glowStrong: string
}

export interface ThemeTypography {
  fontFamily: string
  headingFontFamily?: string
  baseFontSize: number
  scaleRatio: number
}

export interface ThemeEffects {
  noiseTexture: boolean
  scanlines: boolean
  glowEffects: boolean
  animationSpeed: 'fast' | 'normal' | 'slow'
  particleBackground?: boolean
}

export interface ThemeLayout {
  sidebarStyle: 'glass' | 'solid' | 'transparent'
  sidebarBg?: string
  cardStyle: 'glass' | 'solid' | 'flat'
  buttonStyle: 'rounded' | 'pill' | 'sharp' | 'angular'
  borderStyle: 'subtle' | 'prominent' | 'none'
}

export interface ThemeConfig {
  id: string
  name: string
  description: string
  preview: string
  colors: ThemeColors
  glass: ThemeGlass
  radius: ThemeRadius
  shadow: ThemeShadow
  typography: ThemeTypography
  effects: ThemeEffects
  layout: ThemeLayout
}

export type ThemeId = 'warm-purple' | 'cyberpunk' | 'steampunk' | 'british' | 'ink-wash' | 'neon-dark'

import { warmPurple } from './warm-purple'
import { cyberpunk } from './cyberpunk'
import { steampunk } from './steampunk'
import { british } from './british'
import { inkWash } from './ink-wash'
import { neonDark } from './neon-dark'

export const THEMES: Record<ThemeId, ThemeConfig> = {
  'warm-purple': warmPurple,
  'cyberpunk': cyberpunk,
  'steampunk': steampunk,
  'british': british,
  'ink-wash': inkWash,
  'neon-dark': neonDark,
}

export const DEFAULT_THEME: ThemeId = 'warm-purple'

export function getTheme(id: ThemeId): ThemeConfig {
  return THEMES[id] || THEMES[DEFAULT_THEME]
}

export function getThemeIds(): ThemeId[] {
  return Object.keys(THEMES) as ThemeId[]
}
