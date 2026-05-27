import type { StoryEvent, StoryLink, ChapterEmotion, ChapterRhythm, ChapterPOV, Plotline, ChapterPlotline, GrowthTrack, GrowthEntry } from '@/types/story';
import type { DetailedChapter } from '@/types/chapter';
import type { Character } from '@/types/character';

export function RomanceProgressTab({ chapters }: { chapters: DetailedChapter[] }) {
  return (
    <div>
      <h3 style={{ fontSize: 14, fontWeight: 700, color: '#2d2520', marginBottom: 12 }}>感情线进度</h3>
      <div style={{ fontSize: 11, color: '#9b8e84', marginBottom: 16 }}>基于章节细纲描述中的角色标注</div>
      {chapters.map((ch, i) => (
        <div key={ch.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '8px 12px', borderRadius: 8, background: i % 2 === 0 ? 'rgba(236,72,153,0.03)' : '#fff', border: '1px solid rgba(236,72,153,0.06)', fontSize: 11, marginBottom: 4 }}>
          <span style={{ fontWeight: 600, minWidth: 50, color: '#ec4899' }}>第{i + 1}章</span>
          <div><div style={{ fontWeight: 600 }}>{ch.title}</div><div style={{ color: '#6b5e54' }}>角色: {ch.description?.match(/[：:]\s*(.+)/)?.[1] || '未标注'}</div></div>
        </div>
      ))}
    </div>
  )
}
