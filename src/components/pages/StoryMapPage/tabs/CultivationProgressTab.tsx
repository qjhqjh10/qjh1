import type { StoryEvent, StoryLink, ChapterEmotion, ChapterRhythm, ChapterPOV, Plotline, ChapterPlotline, GrowthTrack, GrowthEntry } from '@/types/story';
import type { DetailedChapter } from '@/types/chapter';
import type { Character } from '@/types/character';

export function CultivationProgressTab({ chapters }: { chapters: DetailedChapter[] }) {
  return (
    <div>
      <h3 style={{ fontSize: 14, fontWeight: 700, color: '#2d2520', marginBottom: 12 }}>修炼进度</h3>
      <div style={{ fontSize: 11, color: '#9b8e84', marginBottom: 16 }}>基于章节细纲描述中的等级信息</div>
      {chapters.map((ch, i) => {
        const lm = (ch.description || '').match(/突破[至到]?\s*(\S+)/)
        return (
          <div key={ch.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 12px', borderRadius: 8, background: i % 2 === 0 ? 'rgba(22,163,74,0.03)' : '#fff', border: '1px solid rgba(22,163,74,0.06)', fontSize: 11, marginBottom: 2 }}>
            <span style={{ fontWeight: 600, minWidth: 50, color: '#16a34a' }}>第{i + 1}章</span>
            <span style={{ flex: 1 }}>{ch.title}</span>
            {lm && <span style={{ padding: '2px 8px', borderRadius: 6, background: 'rgba(22,163,74,0.08)', color: '#16a34a', fontWeight: 600 }}>{lm[1]}</span>}
          </div>
        )
      })}
    </div>
  )
}
