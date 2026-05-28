import type { ThemeConfig } from './index'

export const cyberpunk: ThemeConfig = {
  id: 'cyberpunk',
  name: '赛博朋克',
  description: '霓虹闪烁，未来科技感，深邃暗夜',
  preview: 'linear-gradient(135deg, #0a0a0f, #0d1117, #0a0a0f)',

  colors: {
    accent: '#00fff9',
    accentHover: '#00e5e0',
    accentLight: 'rgba(0,255,249,0.15)',
    accentGlow: 'rgba(0,255,249,0.25)',
    accentBg: 'rgba(0,255,249,0.08)',
    textPrimary: '#e0e0e0',
    textSecondary: '#a0a0a0',
    textMuted: '#606060',
    textInverse: '#0a0a0f',
    bgBody: '#0a0a0f',
    bgSurface: '#0d1117',
    bgCard: 'rgba(13,17,23,0.8)',
    bgCardSolid: '#0d1117',
    bgHover: 'rgba(0,255,249,0.05)',
    bgInput: '#0d1117',
    border: 'rgba(0,255,249,0.15)',
    borderHover: 'rgba(0,255,249,0.3)',
    borderAccent: 'rgba(0,255,249,0.4)',
    success: '#00ff88', successBg: 'rgba(0,255,136,0.08)',
    warning: '#fcee09', warningBg: 'rgba(252,238,9,0.08)',
    error: '#ff3366', errorBg: 'rgba(255,51,102,0.08)',
    info: '#00fff9', infoBg: 'rgba(0,255,249,0.08)',
  },

  glass: {
    bg: 'rgba(0,255,249,0.03)',
    bgLight: 'rgba(0,255,249,0.02)',
    border: 'rgba(0,255,249,0.12)',
    blur: 12,
  },

  radius: { xs: 2, sm: 2, md: 4, lg: 4, xl: 6, xxl: 8, full: 9999 },

  shadow: {
    sm: '0 0 8px rgba(0,255,249,0.08)',
    md: '0 0 16px rgba(0,255,249,0.12)',
    lg: '0 0 32px rgba(0,255,249,0.18)',
    glow: '0 0 20px rgba(0,255,249,0.25)',
    glowStrong: '0 0 40px rgba(0,255,249,0.4)',
  },

  typography: {
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', 'SF Mono', monospace",
    baseFontSize: 13,
    scaleRatio: 1.2,
  },

  effects: {
    noiseTexture: false,
    scanlines: true,
    glowEffects: true,
    animationSpeed: 'fast',
    particleBackground: false,
  },

  layout: {
    sidebarStyle: 'solid',
    sidebarBg: '#0d1117',
    cardStyle: 'flat',
    buttonStyle: 'sharp',
    borderStyle: 'prominent',
  },
}
