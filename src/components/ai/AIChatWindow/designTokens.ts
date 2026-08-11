// ── v16.3.0: AI 写作助手设计 Token（UI 彻底优化 V2）──
// 统一 颜色/字号/圆角/间距/阴影 常量，替代消息区/工具条/输入区散落的硬编码色值。
// 语义约定：紫=用户&激活、中性米白=AI 消息、绿=成功/缓存命中、红=错误、橙=缓存创建/警告。
// 弹窗维持"白纸化"设计（不跟随主题变量——neon-dark 等主题 accent 会破坏紫/蓝/橙语义）。
// v16.3.0(审计 M6 修复): 清理零引用的死导出（C.success*/danger*/warning*/blue*/textFaint/
// borderLighter/bgCard/bgHover、F.lg/xl、R.xl、SP.*、SH.lg）——头注释曾宣称"替代硬编码"
// 但大量导出无消费；本次保留实际使用的最小集，未来扩展按需添加

export const C = {
  // ── 主语义色 ──
  primary: '#7c3aed',            // 用户气泡/激活/聚焦/主操作
  primarySoft: 'rgba(124,58,237,0.08)',  // 用户气泡底
  primaryBorder: 'rgba(124,58,237,0.18)',
  aiBubble: '#f7f5f2',           // AI 消息中性米白底（与 StreamingMessage 一致）
  aiBubbleBorder: 'rgba(0,0,0,0.05)',
  // ── 文本层级 ──
  text: '#2d2520',
  textSecondary: '#6b5e54',
  textMuted: '#9b8e84',
  // ── 边框/背景 ──
  border: 'rgba(0,0,0,0.08)',
  borderLight: 'rgba(0,0,0,0.05)',
  bgSoft: '#faf9f7',
  // ── 扩展色（保留语义，按需使用） ──
  blue: '#2563eb',               // #工具提示（蓝）
}

export const F = {
  xs: 10,        // badge/页脚
  sm: 11,        // 工具条/卡片标题
  base: 13,      // 常规正文
  md: 14,        // 消息正文（v16.3.0 上调）
}

export const R = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
}

export const SH = {
  sm: '0 2px 8px rgba(0,0,0,0.04)',
  md: '0 4px 20px rgba(0,0,0,0.08)',
}

// v16.3.0(UI 优化 V2): 消息辅助卡片通用样式（任务进度/子代理简报/执行计划/压缩摘要/来源统一）
// 卡片底统一中性，语义靠标题图标/文字色区分（避免紫色/绿色在每张卡片上重复超载）
export const CARD = {
  bg: 'rgba(0,0,0,0.02)',
  border: '1px solid rgba(0,0,0,0.06)',
  radius: 10,
  titleColor: '#6b5e54',
  titleSize: 11,
}
