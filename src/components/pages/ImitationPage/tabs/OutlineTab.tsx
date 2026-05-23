import ScrollArea from '@/components/common/ScrollArea'
import type { NovelExtraction } from '@/types/story'
import type { DimKey } from '../types'
import { DIM_LABELS } from '../constants'

function normalizeRole(role?: string): string {
  if (!role) return '其他'
  if (['男主', '女主', '男配', '女配', '反派', '其他'].includes(role)) return role
  if (/男主|男一/.test(role)) return '男主'
  if (/女主|女一|女主角/.test(role)) return '女主'
  if (/男配|男二/.test(role)) return '男配'
  if (/女配|女二/.test(role)) return '女配'
  if (/反派|坏人| antagonist/.test(role)) return '反派'
  return '其他'
}

interface Props {
  extraction: NovelExtraction
  outlineResults: Record<string, string>
  dimSubTab: DimKey
  novelType: string
  isSrc: boolean
}

export default function OutlineTab({ extraction, outlineResults, dimSubTab, novelType, isSrc }: Props) {
  const ag = extraction.aggregated || null

  if (!isSrc && !outlineResults[dimSubTab]) {
    return <div style={{ textAlign: 'center', padding: 40, fontSize: 12, color: '#9b8e84' }}>该维度尚未生成。切换到「生成」Tab 点击对应维度按钮进行模仿。</div>
  }

  // Characters
  if (dimSubTab === 'characters') {
    const srcChars = ag?.characters || []
    let genChars: any[] = []
    try { const p = JSON.parse(outlineResults.characters || '[]'); if (Array.isArray(p)) genChars = p } catch {}
    const chars = isSrc ? srcChars : genChars
    const groups: Record<string, any[]> = { '男主': [], '女主': [], '男配': [], '女配': [], '反派': [], '其他': [] }
    chars.forEach((c: any) => { const r = normalizeRole(c.role); groups[r].push(c) })
    return <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {Object.entries(groups).filter(([, list]) => list.length > 0).map(([role, list]) => (
        <div key={role}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#7c3aed', marginBottom: 4 }}>{role} ({list.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {list.map((c: any, idx: number) => (
              <div key={c.name || idx} style={{ padding: '10px 14px', borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,0.06)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#2d2520' }}>{c.name}</span>
                  <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: 'rgba(124,58,237,0.1)', color: '#7c3aed' }}>{role}</span>
                  {isSrc && <span style={{ fontSize: 9, color: '#9b8e84', marginLeft: 'auto' }}>第{c.firstChapter}-{c.lastChapter}章</span>}
                </div>
                {c.traits && <p style={{ fontSize: 10, color: '#6b5e54', margin: '2px 0' }}>{Array.isArray(c.traits) ? c.traits.join('、') : c.traits}</p>}
                {c.background && <p style={{ fontSize: 9, color: '#9b8e84', margin: 0 }}>{c.background}</p>}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  }

  // Worldbuilding
  if (dimSubTab === 'worldbuilding') {
    if (isSrc && ag) return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {ag.worldbuilding.locations.length > 0 && <div><div style={{ fontSize: 11, fontWeight: 700, color: '#7c3aed', marginBottom: 4 }}>地点 ({ag.worldbuilding.locations.length})</div><div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{ag.worldbuilding.locations.map(l => <div key={l.name} style={{ padding: '8px 12px', borderRadius: 10, background: '#fff', border: '1px solid rgba(0,0,0,0.04)', fontSize: 11 }}><strong>{l.name}</strong>: {l.description}</div>)}</div></div>}
        {ag.worldbuilding.factions.length > 0 && <div><div style={{ fontSize: 11, fontWeight: 700, color: '#7c3aed', marginBottom: 4 }}>势力 ({ag.worldbuilding.factions.length})</div><div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{ag.worldbuilding.factions.map(f => <div key={f.name} style={{ padding: '8px 12px', borderRadius: 10, background: '#fff', border: '1px solid rgba(0,0,0,0.04)', fontSize: 11 }}><strong>{f.name}</strong>: {f.description}</div>)}</div></div>}
      </div>
    )
    let genWb: any = null
    try { genWb = JSON.parse(outlineResults.worldbuilding || '') } catch {}
    if (genWb?.locations || genWb?.factions) return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {genWb.locations?.length > 0 && <div><div style={{ fontSize: 11, fontWeight: 700, color: '#7c3aed', marginBottom: 4 }}>地点 ({genWb.locations.length})</div><div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{genWb.locations.map((l: any) => <div key={l.name} style={{ padding: '8px 12px', borderRadius: 10, background: '#fff', border: '1px solid rgba(0,0,0,0.04)', fontSize: 11 }}><strong>{l.name}</strong>: {l.description}</div>)}</div></div>}
        {genWb.factions?.length > 0 && <div><div style={{ fontSize: 11, fontWeight: 700, color: '#7c3aed', marginBottom: 4 }}>势力 ({genWb.factions.length})</div><div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{genWb.factions.map((f: any) => <div key={f.name} style={{ padding: '8px 12px', borderRadius: 10, background: '#fff', border: '1px solid rgba(0,0,0,0.04)', fontSize: 11 }}><strong>{f.name}</strong>: {f.description}</div>)}</div></div>}
      </div>
    )
    return <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', color: '#4a3f38' }}>{outlineResults.worldbuilding || ''}</pre>
  }

  // Items
  if (dimSubTab === 'items') {
    if (isSrc && ag) return <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{ag.items.map(i => <div key={i.name} style={{ padding: '10px 14px', borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,0.06)' }}><div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><span style={{ fontSize: 12, fontWeight: 700, color: '#2d2520' }}>{i.name}</span><span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: 'rgba(245,158,11,0.1)', color: '#e67e00' }}>{i.type}</span>{i.grade && <span style={{ fontSize: 9, color: '#9b8e84' }}>{i.grade}</span>}</div>{i.ability && <p style={{ fontSize: 10, color: '#6b5e54', margin: 0 }}>{i.ability}</p>}</div>)}</div>
    let genItems: any[] = []
    try { const p = JSON.parse(outlineResults.items || '[]'); if (Array.isArray(p)) genItems = p } catch {}
    if (genItems.length > 0) return <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{genItems.map((i: any) => <div key={i.name} style={{ padding: '10px 14px', borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,0.06)' }}><div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><span style={{ fontSize: 12, fontWeight: 700, color: '#2d2520' }}>{i.name}</span><span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: 'rgba(245,158,11,0.1)', color: '#e67e00' }}>{i.type}</span>{i.grade && <span style={{ fontSize: 9, color: '#9b8e84' }}>{i.grade}</span>}</div>{i.ability && <p style={{ fontSize: 10, color: '#6b5e54', margin: 0 }}>{i.ability}</p>}</div>)}</div>
    return <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', color: '#4a3f38' }}>{outlineResults.items || ''}</pre>
  }

  // Power System
  if (dimSubTab === 'powerSystem') {
    if (isSrc && ag) return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {ag.powerSystem.levels.map((l: string, i: number) => (
          <div key={l} style={{ padding: '10px 14px', borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20, fontWeight: 800, color: i === 0 ? '#16a34a' : i === ag!.powerSystem.levels.length - 1 ? '#7c3aed' : '#3b82f6', minWidth: 36, textAlign: 'center' }}>{i + 1}</span>
            <div><span style={{ fontSize: 13, fontWeight: 700, color: '#2d2520' }}>{l}</span></div>
          </div>
        ))}
      </div>
    )
    let genPs: any = null
    try { genPs = JSON.parse(outlineResults.powerSystem || '') } catch {}
    if (genPs?.levels) return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {genPs.levels.map((l: string, i: number) => (
          <div key={l} style={{ padding: '10px 14px', borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20, fontWeight: 800, color: i === 0 ? '#16a34a' : i === genPs!.levels.length - 1 ? '#7c3aed' : '#3b82f6', minWidth: 36, textAlign: 'center' }}>{i + 1}</span>
            <div><span style={{ fontSize: 13, fontWeight: 700, color: '#2d2520' }}>{l}</span></div>
          </div>
        ))}
      </div>
    )
    return <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', color: '#4a3f38' }}>{outlineResults.powerSystem || ''}</pre>
  }

  // Foreshadowing
  if (dimSubTab === 'foreshadowing') {
    if (isSrc && ag) return <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{ag.foreshadowing.map(f => (
      <div key={f.description} style={{ padding: '10px 14px', borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', fontSize: 11 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{ fontSize: 9, padding: '2px 8px', borderRadius: 6, background: f.status === 'resolved' ? 'rgba(22,163,74,0.1)' : 'rgba(245,158,11,0.1)', color: f.status === 'resolved' ? '#16a34a' : '#f59e0b', fontWeight: 600 }}>{f.status === 'resolved' ? '已回收' : '已埋'}</span>
          <span style={{ color: '#9b8e84', fontSize: 10 }}>第{f.plantChapter}章{f.payoffChapter ? ` → 第${f.payoffChapter}章` : ''}</span>
        </div>
        <p style={{ color: '#4a3f38', margin: 0 }}>{f.description}</p>
      </div>
    ))}</div>
    let genFs: any[] = []
    try { const p = JSON.parse(outlineResults.foreshadowing || '[]'); if (Array.isArray(p)) genFs = p } catch {}
    if (genFs.length > 0) return <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{genFs.map((f: any) => (
      <div key={f.description} style={{ padding: '10px 14px', borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', fontSize: 11 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{ fontSize: 9, padding: '2px 8px', borderRadius: 6, background: f.status === 'resolved' ? 'rgba(22,163,74,0.1)' : 'rgba(245,158,11,0.1)', color: f.status === 'resolved' ? '#16a34a' : '#f59e0b', fontWeight: 600 }}>{f.status === 'resolved' ? '已回收' : '已埋'}</span>
          <span style={{ color: '#9b8e84', fontSize: 10 }}>{f.plantChapter ? `第${f.plantChapter}章` : ''}{f.payoffChapter ? ` → 第${f.payoffChapter}章` : ''}</span>
        </div>
        <p style={{ color: '#4a3f38', margin: 0 }}>{f.description}</p>
      </div>
    ))}</div>
    return <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', color: '#4a3f38' }}>{outlineResults.foreshadowing || ''}</pre>
  }

  // Emotion Curve
  if (dimSubTab === 'emotionCurve') {
    let genEm: any[] = []
    if (!isSrc) { try { const p = JSON.parse(outlineResults.emotionCurve || '[]'); genEm = Array.isArray(p) ? p : [] } catch {} }
    if (genEm.length > 0) return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {genEm.map((s: any, i: number) => (
          <div key={i} style={{ padding: '10px 14px', borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', fontSize: 11, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 9, padding: '2px 8px', borderRadius: 6, background: /热血|高潮|激动/.test(s.dominantEmotion || '') ? 'rgba(220,38,38,0.1)' : /压抑|悲伤|恐惧/.test(s.dominantEmotion || '') ? 'rgba(59,130,246,0.1)' : /温馨|希望/.test(s.dominantEmotion || '') ? 'rgba(22,163,74,0.1)' : 'rgba(0,0,0,0.03)', color: /热血|高潮|激动/.test(s.dominantEmotion || '') ? '#dc2626' : '#6b5e54', fontWeight: 600 }}>{s.dominantEmotion}</span>
            <span style={{ color: '#6b5e54' }}>{s.chapterStart ? `第${s.chapterStart}${s.chapterEnd ? `-${s.chapterEnd}` : ''}章` : ''}</span>
          </div>
        ))}
      </div>
    )
    if (isSrc && extraction.emotionCurve) return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {extraction.emotionCurve.segments.map((s: any) => (
          <div key={s.chapterStart} style={{ padding: '10px 14px', borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', fontSize: 11, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 9, padding: '2px 8px', borderRadius: 6, background: /热血|高潮|激动/.test(s.dominantEmotion) ? 'rgba(220,38,38,0.1)' : /压抑|悲伤|恐惧/.test(s.dominantEmotion) ? 'rgba(59,130,246,0.1)' : /温馨|希望/.test(s.dominantEmotion) ? 'rgba(22,163,74,0.1)' : 'rgba(0,0,0,0.03)', color: /热血|高潮|激动/.test(s.dominantEmotion) ? '#dc2626' : /压抑|悲伤|恐惧/.test(s.dominantEmotion) ? '#3b82f6' : '#6b5e54', fontWeight: 600 }}>{s.dominantEmotion}</span>
            <span style={{ color: '#6b5e54' }}>第{s.chapterStart}-{s.chapterEnd}章</span>
          </div>
        ))}
      </div>
    )
    return <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', color: '#4a3f38' }}>{outlineResults.emotionCurve || '未生成'}</pre>
  }

  // Erotic
  if (dimSubTab === 'erotic') {
    let genEr: any = null
    if (!isSrc) { try { genEr = JSON.parse(outlineResults.erotic || '{}') } catch {} }
    if (genEr) return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 11 }}>
        {genEr.characterRoles?.length > 0 && (
          <div>
            <div style={{ fontWeight: 700, color: '#dc2626', marginBottom: 4 }}>角色情色设定 ({genEr.characterRoles.length}个)</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {genEr.characterRoles.map((cr: any) => (
                <div key={cr.name} style={{ padding: '10px 14px', borderRadius: 12, background: '#fff', border: '1px solid rgba(220,38,38,0.12)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <span style={{ fontWeight: 700, color: '#dc2626', fontSize: 13 }}>{cr.name}</span>
                    <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: 'rgba(220,38,38,0.1)', color: '#dc2626' }}>{cr.domSub || 'sub'}</span>
                    <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: 'rgba(0,0,0,0.03)', color: '#6b5e54' }}>{cr.bodyState || '正常'}</span>
                    {cr.shameLevel && <span style={{ fontSize: 9, color: '#9b8e84' }}>羞耻: {cr.shameLevel}</span>}
                  </div>
                  {cr.kinks?.length > 0 && <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>{cr.kinks.map((k: string) => <span key={k} style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: 'rgba(220,38,38,0.06)', color: '#dc2626' }}>{k}</span>)}</div>}
                </div>
              ))}
            </div>
          </div>
        )}
        {genEr.sceneFlow?.length > 0 && (
          <div style={{ padding: '10px 14px', borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,0.04)' }}>
            <div style={{ fontWeight: 600, color: '#dc2626', marginBottom: 4 }}>场景流程</div>
            {genEr.sceneFlow.map((sf: any, i: number) => (
              <div key={i} style={{ marginBottom: i < genEr.sceneFlow.length - 1 ? 4 : 0 }}>
                <span style={{ fontWeight: 600, color: '#4a3f38' }}>{sf.phase || `阶段${i+1}`}:</span>
                <span style={{ color: '#6b5e54' }}> {sf.actions?.join('、') || ''}</span>
                {sf.bodyReactions?.length > 0 && <span style={{ color: '#9b8e84', fontSize: 10 }}> → {sf.bodyReactions.join('、')}</span>}
              </div>
            ))}
          </div>
        )}
        {genEr.techniques && (
          <div style={{ padding: '10px 14px', borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,0.04)' }}>
            <div style={{ fontWeight: 600, color: '#dc2626', marginBottom: 4 }}>技法参数</div>
            {genEr.techniques.bodyFluids?.length > 0 && <div style={{ marginTop: 2 }}><span style={{ color: '#9b8e84' }}>体液:</span> <span style={{ color: '#4a3f38' }}>{genEr.techniques.bodyFluids.join('、')}</span></div>}
            {genEr.techniques.touchFocus?.length > 0 && <div style={{ marginTop: 2 }}><span style={{ color: '#9b8e84' }}>触感焦点:</span> <span style={{ color: '#4a3f38' }}>{genEr.techniques.touchFocus.join('、')}</span></div>}
            <div style={{ marginTop: 2 }}><span style={{ color: '#9b8e84' }}>声音:</span> <span style={{ color: '#4a3f38' }}>{genEr.techniques.soundStyle || '密集'} · {genEr.techniques.moanDensity || '密集'}</span></div>
          </div>
        )}
        {genEr.powerDynamics && <div style={{ padding: '10px 14px', borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,0.04)' }}><div style={{ fontWeight: 600, color: '#dc2626', marginBottom: 4 }}>权力关系</div><span style={{ color: '#4a3f38' }}>{genEr.powerDynamics}</span></div>}
        {genEr.degradationPatterns?.length > 0 && <div style={{ padding: '10px 14px', borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,0.04)' }}><div style={{ fontWeight: 600, color: '#dc2626', marginBottom: 4 }}>羞辱模式</div><div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{genEr.degradationPatterns.map((p: string, i: number) => <span key={i} style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: 'rgba(220,38,38,0.06)', color: '#dc2626' }}>{p}</span>)}</div></div>}
      </div>
    )
    if (isSrc) return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {extraction.chapters.filter(c => c.erotic).map(ch => (
          <div key={ch.chapterId} style={{ padding: '10px 14px', borderRadius: 12, background: '#fff', border: '1px solid rgba(220,38,38,0.1)', fontSize: 11 }}>
            <div style={{ fontWeight: 700, color: '#dc2626', marginBottom: 4 }}>第{ch.chapterNumber}章</div>
            {ch.erotic?.characterRoles && ch.erotic.characterRoles.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 4 }}>
                {ch.erotic.characterRoles.map((cr: any) => (
                  <div key={cr.name} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontWeight: 600, color: '#dc2626' }}>{cr.name}</span>
                    <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 4, background: 'rgba(220,38,38,0.06)', color: '#dc2626' }}>{cr.domSub || 'sub'}</span>
                    <span style={{ fontSize: 9, color: '#9b8e84' }}>{cr.bodyState}</span>
                    {cr.kinks?.length > 0 && cr.kinks.map((k: string) => <span key={k} style={{ fontSize: 8, color: '#e67e00' }}>#{k}</span>)}
                  </div>
                ))}
              </div>
            )}
            {ch.erotic?.powerDynamics && <p style={{ color: '#6b5e54', margin: '2px 0 0', fontSize: 10 }}>{ch.erotic.powerDynamics}</p>}
          </div>
        ))}
      </div>
    )
    return <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', color: '#4a3f38' }}>{outlineResults.erotic || '未生成'}</pre>
  }

  return null
}
