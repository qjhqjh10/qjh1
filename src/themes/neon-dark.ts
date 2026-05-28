import type { ThemeConfig } from './index'

export const neonDark: ThemeConfig = {
  id: 'neon-dark',
  name: '霓虹暗夜',
  description: '深邃暗夜，极光渐变，高对比霓虹',
  preview: 'linear-gradient(135deg, #0f0f1a, #1a0a2e, #0a1628)',

  colors: {
    accent: '#ff006e',
    accentHover: '#e6005e',
    accentLight: 'rgba(255,0,110,0.15)',
    accentGlow: 'rgba(255,0,110,0.25)',
    accentBg: 'rgba(255,0,110,0.08)',
    textPrimary: '#e8e8e8',
    textSecondary: '#a0a0a0',
    textMuted: '#606060',
    textInverse: '#0f0f1a',
    bgBody: '#0f0f1a',
    bgSurface: '#16162a',
    bgCard: 'rgba(22,22,42,0.8)',
    bgCardSolid: '#16162a',
    bgHover: 'rgba(255,0,110,0.05)',
    bgInput: '#16162a',
    border: 'rgba(255,0,110,0.12)',
    borderHover: 'rgba(255,0,110,0.25)',
    borderAccent: 'rgba(255,0,110,0.4)',
    success: '#00ff88', successBg: 'rgba(0,255,136,0.08)',
    warning: '#ffd700', warningBg: 'rgba(255,215,0,0.08)',
    error: '#ff3366', errorBg: 'rgba(255,51,102,0.08)',
    info: '#3a86ff', infoBg: 'rgba(58,134,255,0.08)',
  },

  glass: {
    bg: 'rgba(15,15,26,0.65)',
    bgLight: 'rgba(15,15,26,0.45)',
    border: 'rgba(255,0,110,0.1)',
    blur: 20,
  },

  radius: { xs: 8, sm: 10, md: 14, lg: 18, xl: 20, xxl: 24, full: 9999 },

  shadow: {
    sm: '0 2px 8px rgba(0,0,0,0.3)',
    md: '0 8px 24px rgba(0,0,0,0.4)',
    lg: '0 12px 40px rgba(0,0,0,0.5)',
    glow: '0 0 20px rgba(255,0,110,0.2)',
    glowStrong: '0 0 40px rgba(255,0,110,0.35)',
  },

  typography: {
    fontFamily: "'Inter', 'SF Pro Display', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif",
    baseFontSize: 13,
    scaleRatio: 1.25,
  },

  effects: {
    noiseTexture: false,
    scanlines: false,
    glowEffects: true,
    animationSpeed: 'fast',
    particleBackground: true,
  },

  layout: {
    sidebarStyle: 'solid',
    sidebarBg: '#16162a',
    cardStyle: 'glass',
    buttonStyle: 'pill',
    borderStyle: 'subtle',
  },
}
