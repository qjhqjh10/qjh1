import type { StoryEvent, StoryLink, ChapterEmotion, ChapterRhythm, ChapterPOV, Plotline, ChapterPlotline, GrowthTrack, GrowthEntry } from '@/types/story';
import type { DetailedChapter } from '@/types/chapter';
import type { Character } from '@/types/character';

export function PresenceTab({ presences, characters, chapters }: any) {
  if (presences.length === 0) return <div style={{ textAlign: 'center', padding: 60, color: '#9b8e84' }}>暂无出场数据</div>
  return (
    <div style={{ overflow: 'auto' }}>
      <table style={{ fontSize: 10, borderCollapse: 'collapse' }}>
        <thead><tr><th style={{ padding: 4, position: 'sticky', left: 0, background: '#fff' }}>角色</th>{chapters.map((ch: any) => <th key={ch.id} style={{ padding: 4, writingMode: 'vertical-rl', fontSize: 9 }}>{ch.title?.slice(0, 6)}</th>)}</tr></thead>
        <tbody>{presences.map((p: any, i: number) => (
          <tr key={i}>{p.characters?.map((c: any, j: number) => <td key={j} style={{ padding: 4, textAlign: 'center', background: `rgba(124,58,237,${Math.min(c.mentionCount * 0.2, 0.9)})`, color: c.mentionCount > 2 ? '#fff' : '#2d2520', fontSize: 9 }}>{c.mentionCount}</td>)}</tr>
        ))}</tbody>
      </table>
    </div>
  )
}
