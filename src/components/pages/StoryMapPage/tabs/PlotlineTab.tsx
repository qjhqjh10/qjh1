import { PLOTLINE_COLORS } from '../constants';
import type { StoryEvent, StoryLink, ChapterEmotion, ChapterRhythm, ChapterPOV, Plotline, ChapterPlotline, GrowthTrack, GrowthEntry } from '@/types/story';
import type { DetailedChapter } from '@/types/chapter';
import type { Character } from '@/types/character';

export function PlotlineTab({ plotlines, chapterPlotlines, chapters, onUpdate, onScanPlotlines }: any) {
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {PLOTLINE_COLORS.map((color, i) => (
          <div key={i} style={{ width: 16, height: 16, borderRadius: 4, background: color }} />
        ))}
      </div>
      {plotlines.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#9b8e84' }}>暂无支线数据</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {chapters.map((ch: any, i: number) => {
            const cpl = chapterPlotlines.find((cp: any) => cp.chapterId === ch.id)
            return (
              <div key={i} style={{ padding: '8px 12px', borderRadius: 8, background: '#faf9f8', fontSize: 11 }}>
                <span style={{ fontWeight: 600, color: '#7c3aed', marginRight: 12 }}>第{ch.order + 1}章</span>
                {plotlines.map((pl: any, j: number) => {
                  const ip = cpl?.plotlines?.find((p: any) => p.plotlineId === pl.id)
                  return <span key={j} style={{ marginRight: 12, color: PLOTLINE_COLORS[j] }}>{pl.name}: {ip?.intensity ?? '-'}</span>
                })}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
