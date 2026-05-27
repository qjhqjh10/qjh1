import { EMOTION_LINES } from '../constants';
import type { StoryEvent, StoryLink, ChapterEmotion, ChapterRhythm, ChapterPOV, Plotline, ChapterPlotline, GrowthTrack, GrowthEntry } from '@/types/story';
import type { DetailedChapter } from '@/types/chapter';
import type { Character } from '@/types/character';

export function EmotionCurveTab({ emotions }: { emotions: ChapterEmotion[] }) {
  if (emotions.length === 0) return <div style={{ textAlign: 'center', padding: 60, color: '#9b8e84' }}>暂无情绪数据</div>
  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        {EMOTION_LINES.map(el => (
          <label key={el.key} style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: el.color, display: 'inline-block' }} />{el.label}
          </label>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {emotions.sort((a, b) => a.chapterOrder - b.chapterOrder).map((em, i) => (
          <div key={i} style={{ padding: '8px 12px', borderRadius: 8, background: '#faf9f8', fontSize: 11 }}>
            <span style={{ fontWeight: 600, color: '#7c3aed', marginRight: 8 }}>第{em.chapterOrder}章</span>
            {EMOTION_LINES.map(el => <span key={el.key} style={{ marginRight: 12, color: el.color }}>{el.label}: {(em.scores as any)[el.key]}</span>)}
            <span style={{ color: '#6b5e54', marginLeft: 8 }}>{em.summary}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
