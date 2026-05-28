import type { ThemeConfig } from './index'

export const steampunk: ThemeConfig = {
  id: 'steampunk',
  name: '蒸汽朋克',
  description: '铜色金属质感，齿轮纹理，复古工业风',
  preview: 'linear-gradient(135deg, #1a1209, #2a1f0e, #1a1209)',

  colors: {
    accent: '#cd7f32',
    accentHover: '#b8722d',
    accentLight: 'rgba(205,127,50,0.15)',
    accentGlow: 'rgba(205,127,50,0.2)',
    accentBg: 'rgba(205,127,50,0.08)',
    textPrimary: '#d4c5a9',
    textSecondary: '#a89070',
    textMuted: '#786040',
    textInverse: '#1a1209',
    bgBody: '#1a1209',
    bgSurface: '#211a0f',
    bgCard: 'rgba(33,26,15,0.85)',
    bgCardSolid: '#211a0f',
    bgHover: 'rgba(205,127,50,0.06)',
    bgInput: '#211a0f',
    border: 'rgba(205,127,50,0.2)',
    borderHover: 'rgba(205,127,50,0.35)',
    borderAccent: 'rgba(205,127,50,0.5)',
    success: '#8fbc8f', successBg: 'rgba(143,188,143,0.08)',
    warning: '#daa520', warningBg: 'rgba(218,165,32,0.08)',
    error: '#cd5c5c', errorBg: 'rgba(205,92,92,0.08)',
    info: '#5f9ea0', infoBg: 'rgba(95,158,160,0.08)',
  },

  glass: {
    bg: 'rgba(205,127,50,0.06)',
    bgLight: 'rgba(205,127,50,0.03)',
    border: 'rgba(205,127,50,0.15)',
    blur: 16,
  },

  radius: { xs: 6, sm: 8, md: 12, lg: 14, xl: 16, xxl: 20, full: 9999 },

  shadow: {
    sm: '0 2px 8px rgba(0,0,0,0.15), inset 0 1px 0 rgba(205,127,50,0.05)',
    md: '0 4px 16px rgba(0,0,0,0.2), inset 0 1px 0 rgba(205,127,50,0.08)',
    lg: '0 8px 32px rgba(0,0,0,0.25), inset 0 1px 0 rgba(205,127,50,0.1)',
    glow: '0 0 20px rgba(205,127,50,0.15)',
    glowStrong: '0 0 40px rgba(205,127,50,0.25)',
  },

  typography: {
    fontFamily: "'Georgia', 'Palatino', 'Times New Roman', 'Noto Serif SC', serif",
    baseFontSize: 14,
    scaleRatio: 1.3,
  },

  effects: {
    noiseTexture: true,
    scanlines: false,
    glowEffects: true,
    animationSpeed: 'slow',
    particleBackground: false,
  },

  layout: {
    sidebarStyle: 'solid',
    sidebarBg: '#211a0f',
    cardStyle: 'solid',
    buttonStyle: 'rounded',
    borderStyle: 'prominent',
  },
}
