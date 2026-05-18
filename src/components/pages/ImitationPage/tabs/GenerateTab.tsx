import ScrollArea from '@/components/common/ScrollArea'
import Button from '@/components/common/Button'
import type { NovelExtraction, DetailGenResult } from '@/types/story'
import { SparklesIcon, CheckCircleIcon, UserGroupIcon, GlobeAltIcon, LightBulbIcon, BookOpenIcon, FireIcon } from '@heroicons/react/24/outline'

function safeItemName(i: unknown): string {
  if (typeof i === 'string') return i
  if (i && typeof i === 'object') return (i as Record<string, unknown>).name as string || (i as Record<string, unknown>).title as string || String(i)
  return String(i)
}

interface Props {
  extraction: NovelExtraction
  outlineResults: Record<string, string>
  outlineGenerated: Record<string, boolean>
  novelType: string
  genLoading: boolean
  genPreview: string
  genType: string | null
  detailGenRunning: boolean
  detailGenCurrent: number
  detailGenResults: DetailGenResult[]
  detailsResults: string
  extractIds: Set<string>
  onGenerateDim: (dimKey: string) => void
  onGenerateDetails: () => void
  onStopDetailGen: () => void
  onSaveAllDetails: () => void
  onClearDetails: () => void
  onSelectRemaining: () => void
}

export default function GenerateTab({
  extraction, outlineResults, outlineGenerated, novelType, genLoading, genPreview, genType,
  detailGenRunning, detailGenCurrent, detailGenResults, detailsResults, extractIds,
  onGenerateDim, onGenerateDetails, onStopDetailGen, onSaveAllDetails, onClearDetails, onSelectRemaining,
}: Props) {
  return (
    <ScrollArea maxHeight="100%" style={{ flex: 1 }}>
      <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ padding: 14, borderRadius: 16, background: 'rgba(124,58,237,0.03)', border: '1px solid rgba(124,58,237,0.1)' }}>
          <h4 style={{ fontSize: 14, fontWeight: 700, color: '#7c3aed', marginBottom: 10 }}>大纲模仿 — 逐维度生成新设定</h4>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            {[
              { key: 'characters', label: '角色模仿', icon: UserGroupIcon },
              { key: 'worldbuilding', label: '世界观模仿', icon: GlobeAltIcon },
              { key: 'items', label: '道具模仿', icon: SparklesIcon },
              { key: 'powerSystem', label: '等级模仿', icon: LightBulbIcon },
              { key: 'foreshadowing', label: '伏笔模仿', icon: BookOpenIcon },
              { key: 'emotionCurve', label: '情绪模仿', icon: SparklesIcon },
              ...(novelType === 'erotic' ? [{ key: 'erotic', label: '情色模仿', icon: FireIcon }] : []),
            ].map(dim => (
              <Button key={dim.key} size="sm" variant={outlineGenerated[dim.key] ? 'secondary' : 'ghost'} onClick={() => {
                if (outlineGenerated[dim.key] && !confirm(`${dim.label}已完成，是否重新生成？`)) return
                onGenerateDim(dim.key)
              }} disabled={genLoading || !extraction.aggregated} icon={outlineGenerated[dim.key] ? <CheckCircleIcon style={{ width: 14, height: 14 }} /> : <SparklesIcon style={{ width: 14, height: 14 }} />}>{dim.label}{outlineGenerated[dim.key] ? ' ✓' : ''}</Button>
            ))}
            <Button size="sm" variant="secondary" onClick={async () => {
              const keys = ['characters','worldbuilding','items','powerSystem','foreshadowing','emotionCurve',...(novelType === 'erotic' ? ['erotic'] : [])]
              for (const k of keys) { if (!outlineGenerated[k]) await onGenerateDim(k) }
            }} disabled={genLoading || !extraction.aggregated} icon={<SparklesIcon style={{ width: 14, height: 14 }} />}>自动模仿全部</Button>
          </div>
          {genPreview && genType && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#7c3aed' }}>{genLoading ? '生成中...' : genType + ' 预览'}</span>
              </div>
              <div style={{ fontSize: 11, lineHeight: 1.7, whiteSpace: 'pre-wrap', padding: 10, borderRadius: 10, background: '#fff', border: '1px solid rgba(0,0,0,0.04)', maxHeight: 400, overflow: 'auto', color: '#4a3f38' }}>{genPreview}</div>
            </div>
          )}
          {Object.keys(outlineResults).length > 0 && !genPreview && (
            <div style={{ fontSize: 10, color: '#9b8e84' }}>已生成: {Object.entries(outlineResults).map(([k]) => {
              const labels: Record<string, string> = { characters: '角色', worldbuilding: '世界观', items: '道具', powerSystem: '等级', foreshadowing: '伏笔', emotionCurve: '情绪', erotic: '情色' }
              return labels[k] || k
            }).join(' · ')}</div>
          )}
        </div>
        <div style={{ padding: 14, borderRadius: 16, background: 'rgba(59,130,246,0.03)', border: '1px solid rgba(59,130,246,0.1)' }}>
          <h4 style={{ fontSize: 14, fontWeight: 700, color: '#3b82f6', marginBottom: 10 }}>细纲模仿 — 逐章生成（每章对照原作对应章）</h4>
          <p style={{ fontSize: 11, color: '#6b5e54', marginBottom: 8 }}>先生成角色模仿。每章AI会拿到：①原作该章摘要+②新大纲全部设定。逐章生成，精确对应。</p>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
            <Button size="sm" onClick={onGenerateDetails} disabled={detailGenRunning || !outlineGenerated['characters'] || !extraction.aggregated || extractIds.size === 0} icon={<SparklesIcon style={{ width: 14, height: 14 }} />}>
              {detailGenRunning ? `生成中 ${detailGenCurrent}/${extractIds.size}` : `开始逐章生成 (${extractIds.size}章)`}
            </Button>
            <Button size="sm" variant="ghost" onClick={onSelectRemaining} disabled={detailGenRunning || !outlineGenerated['characters'] || extractIds.size === 0}>
              生成剩余
            </Button>
            {detailGenRunning && <Button size="sm" variant="danger" onClick={onStopDetailGen}>停止</Button>}
            {detailGenResults.length > 0 && !detailGenRunning && (
              <><Button size="sm" variant="secondary" onClick={onSaveAllDetails}>保存全部细纲</Button>
              <Button size="sm" variant="ghost" onClick={onClearDetails}>清空</Button></>
            )}
          </div>
          {detailGenRunning && (
            <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'rgba(0,0,0,0.05)', overflow: 'hidden', marginBottom: 8 }}>
              <div style={{ height: '100%', width: `${extractIds.size > 0 ? (detailGenCurrent / extractIds.size) * 100 : 0}%`, background: '#3b82f6', borderRadius: 2, transition: 'width 0.3s' }} />
            </div>
          )}
          {detailGenResults.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 400, overflow: 'auto' }}>
              {detailGenResults.map((d: any) => (
                <div key={d.chapterNumber} style={{ padding: '8px 10px', borderRadius: 10, background: '#fff', border: '1px solid rgba(0,0,0,0.04)', fontSize: 11 }}>
                  <div style={{ fontWeight: 700, color: '#3b82f6', marginBottom: 4 }}>第{d.chapterNumber}章: {d.title}</div>
                  <div style={{ color: '#4a3f38', lineHeight: 1.6, marginBottom: 4 }}>{d.summary}</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 9 }}>
                    {d.charactersAppearing?.length > 0 && <span style={{ color: '#7c3aed' }}>角色:{d.charactersAppearing.join(',')}</span>}
                    {d.levelChange && <span style={{ color: '#16a34a' }}>等级:{d.levelChange}</span>}
                    {d.itemsUsed?.length > 0 && <span style={{ color: '#e67e00' }}>道具:{d.itemsUsed.map((i: any) => safeItemName(i)).join(',')}</span>}
                    {d.emotionalTone && <span style={{ color: '#9b8e84' }}>情绪:{d.emotionalTone}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
          {detailsResults && detailGenResults.length === 0 && (
            <div style={{ fontSize: 10, color: '#16a34a' }}>细纲已保存 ({(() => { try { return JSON.parse(detailsResults).length } catch { return 0 } })()}章)</div>
          )}
        </div>
      </div>
    </ScrollArea>
  )
}
