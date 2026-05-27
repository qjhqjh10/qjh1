import { TrashIcon } from '@heroicons/react/24/outline';
import type { StoryEvent, StoryLink, ChapterEmotion, ChapterRhythm, ChapterPOV, Plotline, ChapterPlotline, GrowthTrack, GrowthEntry } from '@/types/story';
import type { DetailedChapter } from '@/types/chapter';
import type { Character } from '@/types/character';

export function ForeshadowChainTab({ events, links, onDeleteLink, getLinkedEvents }: any) {
  const fEvents = events.filter((e: any) => e.type === 'foreshadowing' || e.type === 'payoff')
  const chains = links.filter((l: any) => l.type === 'foreshadowing').map((l: any) => ({ link: l, src: getLinkedEvents(l)?.source, tgt: getLinkedEvents(l)?.target })).filter((c: any) => c.src && c.tgt)
  if (chains.length === 0) return <div style={{ textAlign: 'center', padding: 60, color: '#9b8e84' }}>暂无伏笔链数据</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {chains.map(({ link, src, tgt }: any, i: number) => (
        <div key={link.id} style={{ padding: '12px 16px', borderRadius: 12, background: '#fff', border: '1px solid rgba(245,158,11,0.1)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1, fontSize: 11 }}>
            <div style={{ color: '#f59e0b', fontWeight: 600, marginBottom: 4 }}>🌱 第{src.chapterOrder}章: {src.summary?.slice(0, 60)}</div>
            <div style={{ color: '#16a34a', fontWeight: 600 }}>✅ 第{tgt.chapterOrder}章: {tgt.summary?.slice(0, 60)}</div>
          </div>
          <button onClick={() => onDeleteLink(link.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#ef4444', display: 'flex', borderRadius: 6 }}><TrashIcon style={{ width: 12, height: 12 }} /></button>
        </div>
      ))}
      {fEvents.filter((e: any) => !chains.some((c: any) => c.link.sourceEventId === e.id || c.link.targetEventId === e.id) && e.type === 'foreshadowing').map((e: any) => (
        <div key={e.id} style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.04)', fontSize: 11, color: '#ef4444' }}>⚠ 未回收伏笔: 第{e.chapterOrder}章 {e.summary?.slice(0, 60)}</div>
      ))}
    </div>
  )
}
