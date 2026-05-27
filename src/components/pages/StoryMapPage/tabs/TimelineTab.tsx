import { EVENT_TYPE_COLORS, EVENT_TYPE_LABELS } from '../constants';
import { LinkIcon, PencilIcon, TrashIcon } from '@heroicons/react/24/outline';
import type { StoryEvent, StoryLink, ChapterEmotion, ChapterRhythm, ChapterPOV, Plotline, ChapterPlotline, GrowthTrack, GrowthEntry } from '@/types/story';
import type { DetailedChapter } from '@/types/chapter';
import type { Character } from '@/types/character';

export function TimelineTab({ chapters, events, links, linkingFrom, onEdit, onDelete, onStartLink, onFinishLink, onDeleteLink, getEventsByChapter, getLinkedEvents }: any) {
  if (chapters.length === 0) return <div style={{ textAlign: 'center', padding: 60, color: '#9b8e84' }}>暂无章节数据，请先导入 TXT</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {chapters.map((ch: any) => {
        const evs = getEventsByChapter(ch.id)
        return (
          <div key={ch.id} style={{ padding: '14px 16px', borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,0.06)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#7c3aed', marginBottom: 8 }}>第{ch.order + 1}章 {ch.title}</div>
            {evs.length === 0 && <div style={{ fontSize: 11, color: '#9b8e84' }}>暂无事件</div>}
            {evs.map((ev: any) => {
              const isForeshadow = ev.type === 'foreshadowing'
              const linked = links.filter((l: any) => l.sourceEventId === ev.id || l.targetEventId === ev.id)
              return (
                <div key={ev.id} style={{ padding: '8px 12px', borderRadius: 8, background: isForeshadow ? 'rgba(245,158,11,0.04)' : 'rgba(59,130,246,0.04)', marginBottom: 4, borderLeft: `3px solid ${EVENT_TYPE_COLORS[ev.type] || '#9b8e84'}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11 }}>
                    <span><span style={{ fontWeight: 600, color: EVENT_TYPE_COLORS[ev.type] || '#6b5e54' }}>{EVENT_TYPE_LABELS[ev.type] || ev.type}</span> {ev.timeLabel && <span style={{ color: '#9b8e84', marginLeft: 8 }}>{ev.timeLabel}</span>}</span>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {linkingFrom && <button onClick={() => onFinishLink(ev.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#9b8e84', display: 'flex', borderRadius: 6 }}>🔗</button>}
                      {!linkingFrom && <button onClick={() => onStartLink(ev.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#9b8e84', display: 'flex', borderRadius: 6 }}><LinkIcon style={{ width: 12, height: 12 }} /></button>}
                      <button onClick={() => onEdit(ev)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#9b8e84', display: 'flex', borderRadius: 6 }}><PencilIcon style={{ width: 12, height: 12 }} /></button>
                      <button onClick={() => onDelete(ev.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#ef4444', display: 'flex', borderRadius: 6 }}><TrashIcon style={{ width: 12, height: 12 }} /></button>
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: '#4a3f38', marginTop: 4 }}>{ev.summary}</div>
                  {ev.characters?.length > 0 && <div style={{ fontSize: 10, color: '#9b8e84', marginTop: 2 }}>角色: {ev.characters.join('、')}</div>}
                  {linked.length > 0 && <div style={{ fontSize: 10, color: '#f59e0b', marginTop: 2 }}>{linked.map((l: any) => { const src = getLinkedEvents(l)?.source; const tgt = getLinkedEvents(l)?.target; return src && tgt ? (ev.id === l.sourceEventId ? `→ 回收: ${tgt.summary?.slice(0, 40)}` : `← 伏笔: ${src.summary?.slice(0, 40)}`) : '' }).filter(Boolean).join(' | ')}</div>}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
