import type { StoryEvent, StoryLink, ChapterEmotion, ChapterRhythm, ChapterPOV, Plotline, ChapterPlotline, GrowthTrack, GrowthEntry } from '@/types/story';
import type { DetailedChapter } from '@/types/chapter';
import type { Character } from '@/types/character';

export function RhythmTab({ rhythms }: { rhythms: ChapterRhythm[] }) {
  if (rhythms.length === 0) return <div style={{ textAlign: 'center', padding: 60, color: '#9b8e84' }}>暂无节奏数据</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {rhythms.sort((a, b) => a.chapterOrder - b.chapterOrder).map((r, i) => (
        <div key={i} style={{ padding: '8px 12px', borderRadius: 8, background: '#faf9f8', fontSize: 11, display: 'flex', gap: 16, alignItems: 'center' }}>
          <span style={{ fontWeight: 600, color: '#7c3aed', minWidth: 50 }}>第{r.chapterOrder}章</span>
          <span>对话: {r.metrics.dialogueRatio}%</span><span>描写: {r.metrics.descriptionRatio}%</span><span>动作: {r.metrics.actionRatio}%</span>
          <span style={{ color: '#9b8e84' }}>节奏: {r.metrics.paceScore}</span>
        </div>
      ))}
    </div>
  )
}
