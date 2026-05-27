import type { StoryEvent, StoryLink, ChapterEmotion, ChapterRhythm, ChapterPOV, Plotline, ChapterPlotline, GrowthTrack, GrowthEntry } from '@/types/story';
import type { DetailedChapter } from '@/types/chapter';
import type { Character } from '@/types/character';

export function TimeFlowTab({ chapters }: { chapters: DetailedChapter[] }) {
  if (chapters.length === 0) return <div style={{ textAlign: 'center', padding: 60, color: '#9b8e84' }}>暂无章节</div>
  return (
    <div>
      <h3 style={{ fontSize: 14, fontWeight: 700, color: '#2d2520', marginBottom: 12 }}>时间流速</h3>
      <div style={{ fontSize: 11, color: '#9b8e84', marginBottom: 16 }}>基于章节描述中的时间线索</div>
      {chapters.map((ch, i) => (
        <div key={ch.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 12px', borderRadius: 8, background: i % 2 === 0 ? '#faf9f8' : '#fff', fontSize: 11 }}>
          <span style={{ fontWeight: 600, minWidth: 50, color: '#7c3aed' }}>第{i + 1}章</span>
          <span style={{ flex: 1 }}>{ch.title}</span>
          <span style={{ color: '#9b8e84' }}>{ch.description?.match(/(\d+[天日月年])/) || '?'}</span>
        </div>
      ))}
    </div>
  )
}
