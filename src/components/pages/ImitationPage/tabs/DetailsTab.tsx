import ScrollArea from '@/components/common/ScrollArea'
import Button from '@/components/common/Button'
import type { NovelExtraction, DetailGenResult } from '@/types/story'

function safeItemName(i: unknown): string {
  if (typeof i === 'string') return i
  if (i && typeof i === 'object') return (i as Record<string, unknown>).name as string || (i as Record<string, unknown>).title as string || String(i)
  return String(i)
}

interface Props {
  isSrc: boolean
  extraction: NovelExtraction
  detailGenResults: DetailGenResult[]
  detailsResults: string
  chapterContents: Record<string, string>
  onViewSrcDetail: (ch: any) => void
  onEditDetail: (d: DetailGenResult) => void
  onWriteChapter: (chapterNumber: string) => void
}

export default function DetailsTab({ isSrc, extraction, detailGenResults, detailsResults, chapterContents, onViewSrcDetail, onEditDetail, onWriteChapter }: Props) {
  if (isSrc) {
    const extracted = extraction.chapters.filter(c => c.extractedAt)
    return (
      <ScrollArea maxHeight="100%" style={{ flex: 1 }}>
        <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {extracted.length > 0 ? extracted.map(ch => (
            <div key={ch.chapterId} onClick={() => onViewSrcDetail(ch)} style={{ padding: '12px 16px', borderRadius: 14, background: '#fff', border: '1px solid rgba(0,0,0,0.05)', cursor: 'pointer' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#7c3aed', marginBottom: 8 }}>第{ch.chapterNumber}章: {ch.chapterTitle}</div>
              <div style={{ marginBottom: 8 }}><div style={{ fontSize: 10, fontWeight: 600, color: '#9b8e84', marginBottom: 2 }}>剧情摘要</div><p style={{ fontSize: 11, color: '#4a3f38', lineHeight: 1.7, margin: 0 }}>{ch.chapterSummary}</p></div>
              {ch.characters && ch.characters.length > 0 && (<div style={{ marginBottom: 6 }}><div style={{ fontSize: 10, fontWeight: 600, color: '#9b8e84', marginBottom: 2 }}>出场角色</div><div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{ch.characters.map((c: any) => <span key={c.name || c} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6, background: 'rgba(124,58,237,0.06)', color: '#7c3aed' }}>{typeof c === 'string' ? c : (c.name + (c.role ? `(${c.role})` : ''))}</span>)}</div></div>)}
              {ch.events && ch.events.length > 0 && (<div style={{ marginBottom: 6 }}><div style={{ fontSize: 10, fontWeight: 600, color: '#9b8e84', marginBottom: 2 }}>关键事件</div><div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{ch.events.map((ev: string) => <span key={ev} style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: 'rgba(59,130,246,0.06)', color: '#3b82f6' }}>{ev}</span>)}</div></div>)}
              {ch.emotionalTone && <div style={{ fontSize: 10 }}><span style={{ color: '#9b8e84' }}>情绪基调:</span> <span style={{ color: '#4a3f38' }}>{ch.emotionalTone}</span></div>}
              {ch.erotic && <div style={{ marginTop: 6, padding: '6px 10px', borderRadius: 8, background: 'rgba(220,38,38,0.04)', border: '1px solid rgba(220,38,38,0.1)', fontSize: 10 }}>
                <span style={{ color: '#dc2626', fontWeight: 600 }}>情色分析:</span>
                {ch.erotic.characterRoles?.length > 0 && <span style={{ color: '#6b5e54', marginLeft: 4 }}>{ch.erotic.characterRoles.map((cr: any) => cr.name + '(' + cr.domSub + ')').join(', ')}</span>}
                {ch.erotic.sceneFlow?.length > 0 && <span style={{ color: '#9b8e84', marginLeft: 4 }}>| 流程: {ch.erotic.sceneFlow.length}阶段</span>}
                {ch.erotic.powerDynamics && <span style={{ color: '#9b8e84', marginLeft: 4 }}>| 权力: {ch.erotic.powerDynamics.slice(0, 40)}{ch.erotic.powerDynamics.length > 40 ? '...' : ''}</span>}
              </div>}
            </div>
          )) : <div style={{ textAlign: 'center', padding: 40, fontSize: 12, color: '#9b8e84' }}>请先提取章节</div>}
        </div>
      </ScrollArea>
    )
  }

  // Generated details tab
  const results = detailGenResults.length > 0 ? detailGenResults : (() => { try { return detailsResults ? JSON.parse(detailsResults) : [] } catch { return [] } })()
  return (
    <ScrollArea maxHeight="100%" style={{ flex: 1 }}>
      <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {results.length > 0 ? results.map((d: any) => (
          <div key={d.chapterNumber} onClick={() => onEditDetail(d)} style={{ padding: '12px 16px', borderRadius: 14, background: '#fff', border: '1px solid rgba(0,0,0,0.05)', cursor: 'pointer' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#3b82f6', marginBottom: 8 }}>第{d.chapterNumber}章: {d.title}</div>
            <div style={{ marginBottom: 8 }}><div style={{ fontSize: 10, fontWeight: 600, color: '#9b8e84', marginBottom: 2 }}>剧情摘要</div><p style={{ fontSize: 11, color: '#4a3f38', lineHeight: 1.7, margin: 0 }}>{d.summary}</p></div>
            {d.charactersAppearing?.length > 0 && (<div style={{ marginBottom: 6 }}><div style={{ fontSize: 10, fontWeight: 600, color: '#9b8e84', marginBottom: 2 }}>出场角色</div><div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{d.charactersAppearing.map((c: string) => <span key={c} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6, background: 'rgba(59,130,246,0.06)', color: '#3b82f6' }}>{c}</span>)}</div></div>)}
            {d.levelChange && <div style={{ marginBottom: 6 }}><span style={{ fontSize: 10 }}><span style={{ color: '#9b8e84' }}>等级:</span> <span style={{ color: '#16a34a' }}>{d.levelChange}</span></span></div>}
            {d.itemsUsed?.length > 0 && (<div style={{ marginBottom: 6 }}><span style={{ fontSize: 10 }}><span style={{ color: '#9b8e84' }}>道具:</span> {d.itemsUsed.map((i: any, idx: number) => <span key={idx} style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: 'rgba(245,158,11,0.06)', color: '#e67e00', marginRight: 4 }}>{safeItemName(i)}</span>)}</span></div>)}
            {d.keyEvents?.length > 0 && (<div style={{ marginBottom: 6 }}><span style={{ fontSize: 10 }}><span style={{ color: '#9b8e84' }}>事件:</span> {d.keyEvents.join(' · ')}</span></div>)}
            {d.emotionalTone && <div style={{ fontSize: 10 }}><span style={{ color: '#9b8e84' }}>情绪基调:</span> <span style={{ color: '#4a3f38' }}>{d.emotionalTone}</span></div>}
            {d.eroticScene && <div style={{ marginTop: 6, padding: '6px 10px', borderRadius: 8, background: 'rgba(220,38,38,0.04)', border: '1px solid rgba(220,38,38,0.1)', fontSize: 10, color: '#dc2626' }}>情色剧情: {d.eroticScene.slice(0, 80)}{d.eroticScene.length > 80 ? '...' : ''}</div>}
            <div style={{ marginTop: 8, display: 'flex', gap: 4 }}>
              <Button size="sm" variant="ghost" onClick={() => onWriteChapter(String(d.chapterNumber))}>写本章</Button>
              {chapterContents[String(d.chapterNumber)] && <span style={{ fontSize: 10, color: '#16a34a', padding: '4px 0' }}>已写 {chapterContents[String(d.chapterNumber)].length}字</span>}
            </div>
          </div>
        )) : <div style={{ textAlign: 'center', padding: 40, fontSize: 12, color: '#9b8e84' }}>尚未生成细纲。切换到「生成」Tab 生成细纲。</div>}
      </div>
    </ScrollArea>
  )
}
