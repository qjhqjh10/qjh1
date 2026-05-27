import type React from 'react'
import type { ChapterStatus } from '@/types/chapter'

export const STATUS_LABELS: Record<ChapterStatus, string> = {
  incomplete: '未完成', completed: '已完成',
}

export const checkLabel: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer', color: '#4a3f38' }
export const checkInput: React.CSSProperties = { width: 14, height: 14, accentColor: '#7c3aed', cursor: 'pointer' }
export const miniActionLink: React.CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: '#7c3aed', padding: '1px 4px', fontFamily: 'inherit', borderRadius: 4 }
export const cardStyle: React.CSSProperties = { padding: '12px 14px', borderRadius: 12, background: 'rgba(255,255,255,0.7)', border: '1px solid rgba(0,0,0,0.05)' }
export const cardHeaderStyle: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: '#4a3f38', marginBottom: 6 }
