import ScrollArea from '@/components/common/ScrollArea'
import type { NovelExtraction } from '@/types/story'

interface Props {
  extraction: NovelExtraction
}

export default function TimelineTab({ extraction }: Props) {
  const hasExtracted = extraction.chapters.some(c => c.extractedAt)
  if (!hasExtracted) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', color: '#9b8e84', fontSize: 12 }}>请先提取章节数据</div>
      </div>
    )
  }

  return (
    <ScrollArea maxHeight="100%" style={{ flex: 1 }}>
      <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {extraction.chapters.filter(c => c.extractedAt).map(ch => (
          <div key={ch.chapterId} style={{ padding: '12px 16px', borderRadius: 14, background: '#fff', border: '1px solid rgba(0,0,0,0.05)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#7c3aed', marginBottom: 10 }}>第{ch.chapterNumber}章: {ch.chapterTitle}</div>
            {ch.characters.length > 0 && (
              <div style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: '#9b8e84', marginBottom: 2 }}>出场角色</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {ch.characters.map((c: any) => <span key={c.name} style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: 'rgba(124,58,237,0.06)', color: '#7c3aed' }}>{c.name}{c.role ? `(${c.role})` : ''}</span>)}
                </div>
              </div>
            )}
            {ch.powerSystem.length > 0 && (
              <div style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: '#9b8e84', marginBottom: 2 }}>等级</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {ch.powerSystem.map((ps: any, idx: number) => <span key={idx} style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: 'rgba(22,163,74,0.06)', color: '#16a34a' }}>{ps.term}</span>)}
                </div>
              </div>
            )}
            {ch.items.length > 0 && (
              <div style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: '#9b8e84', marginBottom: 2 }}>道具</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {ch.items.map((it: any, idx: number) => <span key={idx} style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: 'rgba(245,158,11,0.06)', color: '#e67e00' }}>{it.name}({it.type})</span>)}
                </div>
              </div>
            )}
            {ch.worldbuilding.length > 0 && (
              <div style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: '#9b8e84', marginBottom: 2 }}>世界观</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {ch.worldbuilding.map((w: any, idx: number) => <span key={idx} style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: 'rgba(59,130,246,0.06)', color: '#3b82f6' }}>{w.name}</span>)}
                </div>
              </div>
            )}
            {ch.foreshadowing.length > 0 && (
              <div style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: '#9b8e84', marginBottom: 2 }}>伏笔</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {ch.foreshadowing.map((f: any, idx: number) => <span key={idx} style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: f.type === 'planted' ? 'rgba(245,158,11,0.06)' : 'rgba(22,163,74,0.06)', color: f.type === 'planted' ? '#f59e0b' : '#16a34a' }}>{f.type==='planted'?'埋':'收'}:{f.description.slice(0,30)}</span>)}
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 10, marginTop: 4 }}>
              {ch.events.length > 0 && <span style={{ color: '#4a3f38' }}>事件: {ch.events.join(' · ')}</span>}
              {ch.emotionalTone && <span style={{ color: '#9b8e84' }}>情绪: {ch.emotionalTone}</span>}
            </div>
            {ch.erotic && <div style={{ fontSize: 9, color: '#dc2626', marginTop: 4 }}>含情色数据</div>}
          </div>
        ))}
      </div>
    </ScrollArea>
  )
}
