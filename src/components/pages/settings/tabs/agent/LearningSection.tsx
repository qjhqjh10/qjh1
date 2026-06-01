import { useState, useEffect, useCallback } from 'react'
import { fileService } from '@/services/fileService'
import { SkeletonList } from '@/components/common/Skeleton'
import { TrashIcon, ArrowDownTrayIcon, CheckCircleIcon } from '@heroicons/react/24/outline'

interface LearningEntry {
  id: string
  problem: string
  solution: string
  category: string
  createdAt: string
  applied: boolean
}

const CATEGORY_LABELS: Record<string, string> = {
  file: '文件操作', character: '角色', outline: '大纲',
  chapter: '章节', style: '风格', kb: '知识库', general: '通用',
}

const PERSIST_PATH = '.aiharness/learnings.json'

export function LearningSection() {
  const [entries, setEntries] = useState<LearningEntry[]>([])
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const raw = await fileService.read(PERSIST_PATH)
      if (raw?.trim()) {
        setEntries(JSON.parse(raw).map((e: any) => ({
          ...e, applied: e.applied === true,
        })).reverse())
      }
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const saveAll = async (updated: LearningEntry[]) => {
    try {
      await fileService.ensureDir('.aiharness')
      await fileService.write(PERSIST_PATH, JSON.stringify(updated, null, 2))
      setEntries([...updated].reverse())
    } catch (e) { console.error('保存失败', e) }
  }

  // Toggle applied status by clicking on entry
  const toggleApplied = async (id: string) => {
    const updated = entries.map(e => e.id === id ? { ...e, applied: !e.applied } : e)
    await saveAll(updated.reverse())
  }

  const handleDelete = async (id: string) => {
    await saveAll(entries.filter(e => e.id !== id).reverse())
  }

  const handleClearAll = async () => {
    await saveAll([])
  }

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = 'learnings-export.json'; a.click()
  }

  if (loading) return <div style={{ padding: 12 }}><SkeletonList count={3} /></div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto', maxHeight: '100%', paddingRight: 4 }} className="custom-scrollbar">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#2d2520' }}>{entries.length} 条学习经验</span>
        <span style={{ fontSize: 10, color: '#9b8e84' }}>AI 遇到错误并解决后自动记录 · 在「自我优化」执行修正</span>
        <div style={{ flex: 1 }} />
        {entries.length > 0 && (
          <>
            <button onClick={handleExport} style={miniBtn}>导出</button>
            <button onClick={handleClearAll} style={{ ...miniBtn, color: '#dc2626' }}>清空</button>
          </>
        )}
      </div>

      {entries.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#9b8e84', fontSize: 12 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📝</div>
          <div style={{ fontWeight: 600, color: '#6b5e54', marginBottom: 4 }}>暂无学习经验</div>
          <div>切换到「自我优化」可选择经验并执行修正。</div>
        </div>
      ) : (
        entries.map(e => (
          <div key={e.id}
            onClick={() => toggleApplied(e.id)}
            title={e.applied ? '点击标记为未处理' : '点击标记为已应用'}
            style={{
            padding: '10px 14px', borderRadius: 10, cursor: 'pointer',
            background: e.applied ? 'rgba(5,150,105,0.03)' : 'rgba(220,38,38,0.02)',
            border: `1px solid ${e.applied ? 'rgba(5,150,105,0.12)' : 'rgba(220,38,38,0.1)'}`,
            transition: 'all 0.1s',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 4, background: e.applied ? 'rgba(5,150,105,0.1)' : 'rgba(220,38,38,0.08)', color: e.applied ? '#059669' : '#dc2626' }}>
                {e.applied ? <><CheckCircleIcon style={{ width: 10, height: 10, display: 'inline', marginRight: 2 }} />已应用</> : '待处理'}
              </span>
              <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 4, background: 'rgba(124,58,237,0.06)', color: '#7c3aed' }}>{CATEGORY_LABELS[e.category] || e.category}</span>
              <span style={{ fontSize: 10, color: '#9b8e84', flex: 1 }}>{e.createdAt ? new Date(e.createdAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</span>
              <button onClick={ev => { ev.stopPropagation(); handleDelete(e.id) }} title="删除" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#d4ccc4', padding: 2 }}><TrashIcon style={{ width: 14, height: 14 }} /></button>
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#dc2626', marginBottom: 3 }}>❌ {e.problem}</div>
            <div style={{ fontSize: 12, color: '#16a34a', lineHeight: 1.5 }}>✅ {e.solution}</div>
          </div>
        ))
      )}
    </div>
  )
}

const miniBtn: React.CSSProperties = {
  padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.08)',
  background: '#fff', cursor: 'pointer', fontSize: 10, color: '#6b5e54',
  fontFamily: 'inherit',
}
