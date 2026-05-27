import type { StoryEvent, StoryLink, ChapterEmotion, ChapterRhythm, ChapterPOV, Plotline, ChapterPlotline, GrowthTrack, GrowthEntry } from '@/types/story';
import type { DetailedChapter } from '@/types/chapter';
import type { Character } from '@/types/character';

export function POVTab({ povs, characters, chapters }: any) {
  if (povs.length === 0) return <div style={{ textAlign: 'center', padding: 60, color: '#9b8e84' }}>暂无POV数据</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {povs.sort((a: any, b: any) => a.chapterOrder - b.chapterOrder).map((p: any, i: number) => (
        <div key={i} style={{ padding: '8px 12px', borderRadius: 8, background: '#faf9f8', fontSize: 11 }}>
          <span style={{ fontWeight: 600, color: '#7c3aed', marginRight: 8 }}>第{p.chapterOrder}章</span>
          <span>POV: {p.primaryPOV?.characterName || '未知'}</span>
          <span style={{ marginLeft: 8, color: p.hasHeadHopping ? '#ef4444' : '#16a34a' }}>{p.hasHeadHopping ? '⚠ 视角跳跃' : '✓'}</span>
        </div>
      ))}
    </div>
  )
}
