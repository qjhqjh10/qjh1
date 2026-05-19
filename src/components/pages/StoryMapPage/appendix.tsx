// Hard rule engine
interface SnapshotEntry {
  name: string; alive?: boolean; powerLevel?: string; location?: string
  status?: string; owner?: string; leader?: string; significance?: string
}

export function detectHardConflicts(analyses: { chapterOrder: number; snapshots?: any }[]): { type: string; severity: string; chapterA: number; chapterB: number; summary: string; evidence: string; suggestion: string }[] {
  const conflicts: { type: string; severity: string; chapterA: number; chapterB: number; summary: string; evidence: string; suggestion: string }[] = []
  const valid = analyses.filter(a => a.snapshots)

  const findPrev = (name: string, beforeChapter: number, list: string) => {
    for (let i = beforeChapter - 1; i >= 0; i--) {
      const items: SnapshotEntry[] = valid[i]?.snapshots?.[list] || []
      const found = items.find((e: SnapshotEntry) => e.name === name)
      if (found) return { chapterOrder: valid[i].chapterOrder, entry: found }
    }
    return null
  }

  for (const a of valid) {
    const chars: SnapshotEntry[] = a.snapshots?.characterSnapshots || []
    for (const c of chars) {
      if (c.alive === false) continue
      const prev = findPrev(c.name, a.chapterOrder, 'characterSnapshots')
      if (prev && prev.entry.alive === false) {
        conflicts.push({ type: 'character_death', severity: 'critical', chapterA: prev.chapterOrder, chapterB: a.chapterOrder, summary: `角色「${c.name}」在第${prev.chapterOrder}章已死亡，第${a.chapterOrder}章又出现`, evidence: `第${prev.chapterOrder}章: alive=false → 第${a.chapterOrder}章: alive=true`, suggestion: `检查第${a.chapterOrder}章是否存在复活情节或错误描写` })
      }
    }
  }

  for (const a of valid) {
    const items: SnapshotEntry[] = a.snapshots?.itemSnapshots || []
    for (const it of items) {
      if (it.status === '完好') {
        const prev = findPrev(it.name, a.chapterOrder, 'itemSnapshots')
        if (prev && ['损坏', '丢失', '毁灭'].includes(prev.entry.status || '')) {
          conflicts.push({ type: 'item_status', severity: 'critical', chapterA: prev.chapterOrder, chapterB: a.chapterOrder, summary: `道具「${it.name}」在第${prev.chapterOrder}章已${prev.entry.status}，第${a.chapterOrder}章又完好出现`, evidence: `第${prev.chapterOrder}章: status=${prev.entry.status} → 第${a.chapterOrder}章: status=完好`, suggestion: '检查是否有修复情节或标记错误' })
        }
      }
    }
  }

  for (const a of valid) {
    const factions: SnapshotEntry[] = a.snapshots?.factionSnapshots || []
    for (const f of factions) {
      if (f.status === '活跃' || f.status === '削弱') {
        const prev = findPrev(f.name, a.chapterOrder, 'factionSnapshots')
        if (prev && prev.entry.status === '覆灭') {
          conflicts.push({ type: 'faction_status', severity: 'critical', chapterA: prev.chapterOrder, chapterB: a.chapterOrder, summary: `势力「${f.name}」在第${prev.chapterOrder}章已覆灭，第${a.chapterOrder}章又活跃`, evidence: `第${prev.chapterOrder}章: status=覆灭 → 第${a.chapterOrder}章: status=活跃`, suggestion: '检查势力是否被重建或有误' })
        }
      }
    }
  }

  for (const a of valid) {
    const locs: SnapshotEntry[] = a.snapshots?.locationSnapshots || []
    for (const l of locs) {
      if (l.status === '存在') {
        const prev = findPrev(l.name, a.chapterOrder, 'locationSnapshots')
        if (prev && (prev.entry.status === '毁灭' || prev.entry.status === '废弃')) {
          conflicts.push({ type: 'faction_status', severity: 'warning', chapterA: prev.chapterOrder, chapterB: a.chapterOrder, summary: `地点「${l.name}」在第${prev.chapterOrder}章已${prev.entry.status}，第${a.chapterOrder}章又存在`, evidence: `第${prev.chapterOrder}章: status=${prev.entry.status} → 第${a.chapterOrder}章: status=存在`, suggestion: '检查地点是否被修复或有误' })
        }
      }
    }
  }

  return conflicts
}

// SettingTimelineView
export function SettingTimelineView({ analyses }: { analyses: { chapterOrder: number; snapshots?: any; analysis: string }[] }) {
  const valid = analyses.filter(a => a.snapshots)
  if (valid.length === 0) return <div style={{ textAlign: 'center', padding: 60, color: '#9b8e84' }}>暂无状态快照数据。请先进行逐章分析。</div>

  const hardConflicts = detectHardConflicts(valid)
  const conflictSet = new Set<string>()
  hardConflicts.forEach(c => { conflictSet.add(`${c.chapterA}-${c.type}`); conflictSet.add(`${c.chapterB}-${c.type}`) })

  const allChars = new Map<string, any[]>()
  const allItems = new Map<string, any[]>()
  const allFactions = new Map<string, any[]>()
  const allLocs = new Map<string, any[]>()
  for (const a of valid) {
    for (const c of (a.snapshots?.characterSnapshots || [])) { if (!allChars.has(c.name)) allChars.set(c.name, []); allChars.get(c.name)!.push({ ch: a.chapterOrder, e: c }) }
    for (const it of (a.snapshots?.itemSnapshots || [])) { if (!allItems.has(it.name)) allItems.set(it.name, []); allItems.get(it.name)!.push({ ch: a.chapterOrder, e: it }) }
    for (const f of (a.snapshots?.factionSnapshots || [])) { if (!allFactions.has(f.name)) allFactions.set(f.name, []); allFactions.get(f.name)!.push({ ch: a.chapterOrder, e: f }) }
    for (const l of (a.snapshots?.locationSnapshots || [])) { if (!allLocs.has(l.name)) allLocs.set(l.name, []); allLocs.get(l.name)!.push({ ch: a.chapterOrder, e: l }) }
  }

  const renderRow = (name: string, entries: any[], color: string) => {
    const byCh = new Map<number, any>(); entries.forEach(e => byCh.set(e.ch, e.e))
    return (
      <tr key={name} style={{ borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
        <td style={{ padding: '4px 8px', fontSize: 10, fontWeight: 600, color, whiteSpace: 'nowrap', position: 'sticky', left: 0, background: '#fff', minWidth: 70 }}>{name}</td>
        {valid.map(aa => {
          const e = byCh.get(aa.chapterOrder)
          if (!e) return <td key={aa.chapterOrder} style={{ padding: 4, textAlign: 'center', fontSize: 9, color: '#d9d2cc' }}>—</td>
          const isC = [...conflictSet].some(k => k.startsWith(`${aa.chapterOrder}-`))
          return <td key={aa.chapterOrder} style={{ padding: 4, textAlign: 'center', fontSize: 9, background: isC ? 'rgba(239,68,68,0.1)' : 'transparent' }}><span style={{ color: isC ? '#dc2626' : '#2d2520', fontWeight: isC ? 700 : 400 }}>{e.alive !== undefined ? (e.alive ? '●活' : '✖死') : e.status || e.powerLevel || '●'}</span></td>
        })}
      </tr>
    )
  }

  return (
    <div style={{ overflow: 'auto', fontSize: 10 }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, color: '#2d2520', marginBottom: 8 }}>设定状态时间线</h3>
      <div style={{ fontSize: 11, color: '#9b8e84', marginBottom: 8 }}>追踪每个设定元素在各章的状态变化。● 正常 ✖ 冲突</div>
      {hardConflicts.length > 0 && <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.06)', fontSize: 11, color: '#dc2626' }}>硬规则检测到 {hardConflicts.length} 个冲突，已在表格中红色标注</div>}
      <table style={{ borderCollapse: 'collapse', minWidth: Math.max(600, valid.length * 70) }}>
        <thead><tr style={{ borderBottom: '2px solid rgba(0,0,0,0.06)' }}><th style={{ padding: 4, fontSize: 10, position: 'sticky', left: 0, background: '#fff' }}>元素</th>{valid.map(aa => <th key={aa.chapterOrder} style={{ padding: 4, fontSize: 9, color: '#9b8e84', minWidth: 55 }}>第{aa.chapterOrder}章</th>)}</tr></thead>
        <tbody>
          <tr><td colSpan={valid.length + 1} style={{ padding: '4px 8px', fontSize: 9, fontWeight: 700, color: '#7c3aed', background: 'rgba(124,58,237,0.03)' }}>👤 角色</td></tr>
          {[...allChars.entries()].map(([n, e]) => renderRow(n, e, '#7c3aed'))}
          <tr><td colSpan={valid.length + 1} style={{ padding: '4px 8px', fontSize: 9, fontWeight: 700, color: '#f59e0b', background: 'rgba(245,158,11,0.03)' }}>🗡️ 道具</td></tr>
          {[...allItems.entries()].map(([n, e]) => renderRow(n, e, '#f59e0b'))}
          {allFactions.size > 0 && <tr><td colSpan={valid.length + 1} style={{ padding: '4px 8px', fontSize: 9, fontWeight: 700, color: '#ef4444', background: 'rgba(239,68,68,0.03)' }}>🏛️ 势力</td></tr>}
          {[...allFactions.entries()].map(([n, e]) => renderRow(n, e, '#ef4444'))}
          {allLocs.size > 0 && <tr><td colSpan={valid.length + 1} style={{ padding: '4px 8px', fontSize: 9, fontWeight: 700, color: '#3b82f6', background: 'rgba(59,130,246,0.03)' }}>📍 地点</td></tr>}
          {[...allLocs.entries()].map(([n, e]) => renderRow(n, e, '#3b82f6'))}
        </tbody>
      </table>
    </div>
  )
}
