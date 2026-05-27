import { GENRE_TRACK_PRESETS } from '@/types/story';
import { CHANGE_COLORS, CHANGE_LABELS } from '../constants';
import type { StoryEvent, StoryLink, ChapterEmotion, ChapterRhythm, ChapterPOV, Plotline, ChapterPlotline, GrowthTrack, GrowthEntry } from '@/types/story';
import type { DetailedChapter } from '@/types/chapter';
import type { Character } from '@/types/character';

export function GrowthTab({ tracks, entries, characters, chapters, onUpdateTracks, onUpdateNovelType, onAddEntry, onUpdateEntry, onDeleteEntry, novelType }: any) {
  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <select value={novelType} onChange={e => onUpdateNovelType(e.target.value)} style={{ padding: '4px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', fontSize: 12 }}>
          <option value="">选择小说类型</option>
          {Object.entries(GENRE_TRACK_PRESETS).map(([k, v]: [string, any]) => <option key={k} value={k}>{k}</option>)}
        </select>
      </div>
      {tracks.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#9b8e84' }}>请先选择小说类型以配置成长维度</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {entries.sort((a: any, b: any) => a.chapterOrder - b.chapterOrder).map((e: any, i: number) => (
            <div key={i} style={{ padding: '8px 12px', borderRadius: 8, background: '#faf9f8', fontSize: 11 }}>
              <span style={{ fontWeight: 600, color: '#7c3aed', marginRight: 8 }}>第{e.chapterOrder}章</span>
              <span>{e.characterName}</span>
              <span style={{ marginLeft: 8, color: CHANGE_COLORS[e.change] || '#6b5e54' }}>{CHANGE_LABELS[e.change] || e.change}: {e.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
