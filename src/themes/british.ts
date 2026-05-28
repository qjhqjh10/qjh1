import type { ThemeConfig } from './index'

export const british: ThemeConfig = {
  id: 'british',
  name: '英伦雅致',
  description: '经典优雅，格纹纹理，衬线排版',
  preview: 'linear-gradient(135deg, #f5f0e8, #ede5d8, #f5f0e8)',

  colors: {
    accent: '#1a5276',
    accentHover: '#154360',
    accentLight: 'rgba(26,82,118,0.1)',
    accentGlow: 'rgba(26,82,118,0.15)',
    accentBg: 'rgba(26,82,118,0.05)',
    textPrimary: '#2c3e50',
    textSecondary: '#5d6d7e',
    textMuted: '#95a5a6',
    textInverse: '#f5f0e8',
    bgBody: '#f5f0e8',
    bgSurface: '#f0ebe3',
    bgCard: 'rgba(240,235,227,0.85)',
    bgCardSolid: '#f0ebe3',
    bgHover: 'rgba(26,82,118,0.04)',
    bgInput: '#f0ebe3',
    border: 'rgba(44,62,80,0.1)',
    borderHover: 'rgba(44,62,80,0.18)',
    borderAccent: 'rgba(26,82,118,0.25)',
    success: '#196f3d', successBg: 'rgba(25,111,61,0.06)',
    warning: '#b7950b', warningBg: 'rgba(183,149,11,0.06)',
    error: '#922b21', errorBg: 'rgba(146,43,33,0.06)',
    info: '#1a5276', infoBg: 'rgba(26,82,118,0.06)',
  },

  glass: {
    bg: 'rgba(240,235,227,0.8)',
    bgLight: 'rgba(240,235,227,0.6)',
    border: 'rgba(44,62,80,0.08)',
    blur: 8,
  },

  radius: { xs: 2, sm: 4, md: 6, lg: 8, xl: 10, xxl: 12, full: 9999 },

  shadow: {
    sm: '0 1px 3px rgba(44,62,80,0.06)',
    md: '0 2px 8px rgba(44,62,80,0.08)',
    lg: '0 4px 16px rgba(44,62,80,0.1)',
    glow: '0 0 12px rgba(26,82,118,0.08)',
    glowStrong: '0 0 24px rgba(26,82,118,0.12)',
  },

  typography: {
    fontFamily: "'Garamond', 'Georgia', 'Palatino', 'Noto Serif SC', 'SimSun', serif",
    headingFontFamily: "'Garamond', 'Georgia', 'Palatino', serif",
    baseFontSize: 14,
    scaleRatio: 1.35,
  },

  effects: {
    noiseTexture: false,
    scanlines: false,
    glowEffects: false,
    animationSpeed: 'slow',
    particleBackground: false,
  },

  layout: {
    sidebarStyle: 'solid',
    sidebarBg: '#f0ebe3',
    cardStyle: 'solid',
    buttonStyle: 'rounded',
    borderStyle: 'prominent',
  },
}
