import type React from 'react'

export type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7
export const stepLabels = ['导入分章', '逐章分析', '原作理解', '剧情走向', '大纲融合', '续写细纲', '续写章节']

export const resultCard: React.CSSProperties = { background: '#fff', borderRadius: 12, border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', overflow: 'hidden' }
export const resultCardHeader = (color: string): React.CSSProperties => ({ fontSize: 11, fontWeight: 700, padding: '8px 14px', borderBottom: '1px solid rgba(0,0,0,0.04)', background: `${color}08`, color })
export const resultCardBody: React.CSSProperties = { padding: '10px 14px' }
export const dimItem: React.CSSProperties = { fontSize: 10, padding: '3px 8px', borderRadius: 4, background: 'rgba(0,0,0,0.01)', marginBottom: 2, lineHeight: 1.5 }
export const dimEmpty: React.CSSProperties = { fontSize: 10, color: '#9b8e84', fontStyle: 'italic', padding: '2px 8px' }
