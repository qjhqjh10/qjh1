import type { ThemeConfig } from './index'

export const warmPurple: ThemeConfig = {
  id: 'warm-purple',
  name: '暖白紫调',
  description: '温暖柔和，玻璃态质感，适合长时间写作',
  preview: 'linear-gradient(135deg, #faf8f6, #f3f0f8, #ede9fe)',

  colors: {
    accent: '#7c3aed',
    accentHover: '#6d28d9',
    accentLight: '#ede9fe',
    accentGlow: 'rgba(124,58,237,0.15)',
    accentBg: 'rgba(124,58,237,0.06)',
    textPrimary: '#2d2520',
    textSecondary: '#6b5e54',
    textMuted: '#9b8e84',
    textInverse: '#ffffff',
    bgBody: 'linear-gradient(135deg, #faf8f6 0%, #f5f3f0 30%, #f3f0f8 70%, #f0edf6 100%)',
    bgSurface: '#faf9f8',
    bgCard: 'rgba(255,255,255,0.7)',
    bgCardSolid: '#ffffff',
    bgHover: 'rgba(0,0,0,0.03)',
    bgInput: '#faf9f8',
    border: 'rgba(0,0,0,0.06)',
    borderHover: 'rgba(0,0,0,0.1)',
    borderAccent: 'rgba(124,58,237,0.2)',
    success: '#16a34a', successBg: 'rgba(22,163,74,0.06)',
    warning: '#e67e00', warningBg: 'rgba(230,126,0,0.06)',
    error: '#dc2626', errorBg: 'rgba(220,38,38,0.06)',
    info: '#2563eb', infoBg: 'rgba(37,99,235,0.06)',
  },

  glass: {
    bg: 'rgba(255,255,255,0.65)',
    bgLight: 'rgba(255,255,255,0.45)',
    border: 'rgba(255,255,255,0.5)',
    blur: 20,
  },

  radius: { xs: 4, sm: 6, md: 10, lg: 14, xl: 16, xxl: 20, full: 9999 },

  shadow: {
    sm: '0 2px 8px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.06)',
    md: '0 8px 24px rgba(0,0,0,0.06), 0 2px 4px rgba(0,0,0,0.04)',
    lg: '0 12px 40px rgba(0,0,0,0.08), 0 4px 8px rgba(0,0,0,0.04)',
    glow: '0 0 20px rgba(124,58,237,0.12)',
    glowStrong: '0 0 40px rgba(124,58,237,0.2)',
  },

  typography: {
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'Helvetica Neue', Arial, sans-serif",
    baseFontSize: 13,
    scaleRatio: 1.25,
  },

  effects: {
    noiseTexture: true,
    scanlines: false,
    glowEffects: true,
    animationSpeed: 'normal',
    particleBackground: false,
  },

  layout: {
    sidebarStyle: 'glass',
    cardStyle: 'glass',
    buttonStyle: 'rounded',
    borderStyle: 'subtle',
  },
}
