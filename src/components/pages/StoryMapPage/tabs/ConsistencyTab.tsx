import type { StoryEvent, StoryLink, ChapterEmotion, ChapterRhythm, ChapterPOV, Plotline, ChapterPlotline, GrowthTrack, GrowthEntry } from '@/types/story';
import type { DetailedChapter } from '@/types/chapter';
import type { Character } from '@/types/character';

export function ConsistencyTab({ conflicts, summary, chapterCount, analysisCount }: {
  conflicts: { type: string; severity: string; chapterA: number; chapterB: number; summary: string; evidence: string; suggestion: string }[]
  summary: string; chapterCount: number; analysisCount: number
}) {
  const TYPE_LABELS: Record<string, { label: string; icon: string }> = {
    character_death: { label: '角色生死', icon: '💀' }, level_regression: { label: '等级倒退', icon: '📉' },
    item_status: { label: '道具矛盾', icon: '🗡️' }, faction_status: { label: '势力存亡', icon: '🏛️' },
    timeline: { label: '时间线', icon: '⏰' }, relationship: { label: '角色关系', icon: '💔' },
    foreshadowing: { label: '伏笔遗漏', icon: '🔮' }, emotion: { label: '情绪断裂', icon: '🎭' },
  }
  const SEVERITY: Record<string, any> = {
    critical: { bg: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.2)', text: '#dc2626', badge: '严重' },
    warning: { bg: 'rgba(245,158,11,0.04)', border: '1px solid rgba(245,158,11,0.2)', text: '#e67e00', badge: '警告' },
    info: { bg: 'rgba(59,130,246,0.04)', border: '1px solid rgba(59,130,246,0.2)', text: '#3b82f6', badge: '提示' },
  }
  if (conflicts.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 60, color: '#9b8e84' }}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>📋</div>
        {analysisCount === 0 ? <div style={{ fontSize: 14 }}>请先导入 TXT 并点击"逐章分析"，然后点击"冲突检测"</div> : <div style={{ fontSize: 14 }}>🎉 暂未检测到冲突，已分析 {analysisCount}/{chapterCount} 章</div>}
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {summary && <div style={{ fontSize: 12, padding: '10px 14px', borderRadius: 10, background: '#faf9f8', marginBottom: 4 }}>{summary}</div>}
      {conflicts.map((c, i) => {
        const info = TYPE_LABELS[c.type] || { label: c.type, icon: '📌' }
        const sev = SEVERITY[c.severity] || SEVERITY.info
        return (
          <div key={i} style={{ padding: '14px 16px', borderRadius: 12, background: sev.bg, border: sev.border }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 16 }}>{info.icon}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: sev.text }}>{info.label}</span>
              <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, color: sev.text, fontWeight: 600 }}>{sev.badge}</span>
              <span style={{ fontSize: 11, color: '#9b8e84' }}>第{c.chapterA}章 ⟷ 第{c.chapterB}章</span>
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#2d2520', marginBottom: 4 }}>{c.summary}</div>
            <div style={{ fontSize: 11, color: '#6b5e54', lineHeight: 1.6 }}>📎 {c.evidence}</div>
            <div style={{ fontSize: 11, color: '#16a34a', lineHeight: 1.6 }}>💡 {c.suggestion}</div>
          </div>
        )
      })}
    </div>
  )
}
