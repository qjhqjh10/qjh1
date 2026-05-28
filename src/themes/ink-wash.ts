import type { ThemeConfig } from './index'

export const inkWash: ThemeConfig = {
  id: 'ink-wash',
  name: '水墨丹青',
  description: '极简留白，宣纸质感，墨色点缀',
  preview: 'linear-gradient(135deg, #f8f5f0, #f0ede8, #f8f5f0)',

  colors: {
    accent: '#2d3436',
    accentHover: '#1e272e',
    accentLight: 'rgba(45,52,54,0.08)',
    accentGlow: 'rgba(45,52,54,0.1)',
    accentBg: 'rgba(45,52,54,0.04)',
    textPrimary: '#2d3436',
    textSecondary: '#636e72',
    textMuted: '#b2bec3',
    textInverse: '#f8f5f0',
    bgBody: '#f8f5f0',
    bgSurface: '#f5f2ed',
    bgCard: 'rgba(245,242,237,0.7)',
    bgCardSolid: '#f5f2ed',
    bgHover: 'rgba(45,52,54,0.03)',
    bgInput: '#f5f2ed',
    border: 'rgba(45,52,54,0.08)',
    borderHover: 'rgba(45,52,54,0.15)',
    borderAccent: 'rgba(45,52,54,0.2)',
    success: '#636e72', successBg: 'rgba(99,110,114,0.05)',
    warning: '#636e72', warningBg: 'rgba(99,110,114,0.05)',
    error: '#2d3436', errorBg: 'rgba(45,52,54,0.05)',
    info: '#636e72', infoBg: 'rgba(99,110,114,0.05)',
  },

  glass: {
    bg: 'rgba(245,242,237,0.85)',
    bgLight: 'rgba(245,242,237,0.6)',
    border: 'rgba(45,52,54,0.06)',
    blur: 4,
  },

  radius: { xs: 0, sm: 2, md: 4, lg: 6, xl: 8, xxl: 10, full: 9999 },

  shadow: {
    sm: 'none',
    md: '0 1px 2px rgba(45,52,54,0.04)',
    lg: '0 2px 4px rgba(45,52,54,0.06)',
    glow: 'none',
    glowStrong: 'none',
  },

  typography: {
    fontFamily: "'KaiTi', '楷体', 'STKaiti', 'Noto Serif SC', serif",
    headingFontFamily: "'KaiTi', '楷体', 'STKaiti', serif",
    baseFontSize: 15,
    scaleRatio: 1.4,
  },

  effects: {
    noiseTexture: false,
    scanlines: false,
    glowEffects: false,
    animationSpeed: 'slow',
    particleBackground: false,
  },

  layout: {
    sidebarStyle: 'transparent',
    cardStyle: 'flat',
    buttonStyle: 'rounded',
    borderStyle: 'subtle',
  },
}
