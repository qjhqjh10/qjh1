import { useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { RelationshipGraph } from '@/types/character'
import { renderRelationshipGraph } from '@/utils/graphRenderer'
import {
  XMarkIcon, ArrowPathIcon, SparklesIcon,
} from '@heroicons/react/24/outline'

interface Props {
  isOpen: boolean
  graphData: RelationshipGraph | null
  loading: boolean
  error: string
  onClose: () => void
  onRegenerate: () => void
  onNodeClick: (characterId: string) => void
}

const ROLE_LEGEND: { role: string; color: string }[] = [
  { role: '男主', color: '#7c3aed' },
  { role: '女主', color: '#ec4899' },
  { role: '男配', color: '#3b82f6' },
  { role: '女配', color: '#f59e0b' },
  { role: '反派', color: '#ef4444' },
  { role: '其他', color: '#6b7280' },
]

export default function RelationshipGraphModal({
  isOpen, graphData, loading, error, onClose, onRegenerate, onNodeClick,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const graphRef = useRef<{ destroy: () => void } | null>(null)
  const onNodeClickRef = useRef(onNodeClick)
  onNodeClickRef.current = onNodeClick

  useEffect(() => {
    if (!isOpen || !containerRef.current || !graphData) return

    // Delay to let the DOM settle (modal animation)
    const timer = setTimeout(() => {
      if (!containerRef.current) return
      graphRef.current?.destroy()
      graphRef.current = renderRelationshipGraph(
        containerRef.current,
        graphData,
        (id) => onNodeClickRef.current(id),
      )
    }, 300)

    return () => {
      clearTimeout(timer)
      graphRef.current?.destroy()
    }
  }, [isOpen, graphData])

  // Cleanup on unmount
  useEffect(() => {
    return () => { graphRef.current?.destroy() }
  }, [])

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          style={{
            position: 'fixed', inset: 0, zIndex: 100,
            background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.92, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.92, opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={e => e.stopPropagation()}
            style={{
              width: '90vw', height: '85vh', maxWidth: 1100,
              background: '#fff', borderRadius: 24,
              border: '1px solid rgba(0,0,0,0.08)',
              boxShadow: '0 20px 80px rgba(0,0,0,0.15)',
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
            }}
          >
            {/* Header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '16px 24px', borderBottom: '1px solid rgba(0,0,0,0.06)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <SparklesIcon style={{ width: 20, height: 20, color: '#7c3aed' }} />
                <h3 style={{ fontSize: 16, fontWeight: 700, color: '#2d2520' }}>角色关系图</h3>
                {graphData && (
                  <span style={{ fontSize: 11, color: '#9b8e84' }}>
                    {graphData.nodes.length}个角色 · {graphData.edges.length}条关系
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {/* Legend */}
                <div style={{ display: 'flex', gap: 6, marginRight: 12 }}>
                  {ROLE_LEGEND.map(l => (
                    <div key={l.role} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: '#6b5e54' }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: l.color, flexShrink: 0 }} />
                      {l.role}
                    </div>
                  ))}
                </div>
                <button
                  onClick={onRegenerate}
                  disabled={loading}
                  title="重新分析"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '6px 12px', borderRadius: 8,
                    border: '1px solid rgba(0,0,0,0.08)', background: '#fff',
                    color: '#6b5e54', fontSize: 11, cursor: 'pointer',
                  }}
                >
                  <ArrowPathIcon style={{ width: 13, height: 13 }} />
                  重新生成
                </button>
                <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#9b8e84', display: 'flex' }}>
                  <XMarkIcon style={{ width: 20, height: 20 }} />
                </button>
              </div>
            </div>

            {/* Graph area */}
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
              {loading && (
                <div style={{
                  position: 'absolute', inset: 0, zIndex: 10,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  background: 'rgba(255,255,255,0.85)',
                }}>
                  <SparklesIcon style={{ width: 32, height: 32, color: '#7c3aed', marginBottom: 12, opacity: 0.6 }} />
                  <p style={{ fontSize: 14, color: '#6b5e54' }}>AI 正在分析角色关系...</p>
                  <p style={{ fontSize: 12, color: '#9b8e84', marginTop: 4 }}>正在提取角色关系网中的关系数据</p>
                </div>
              )}
              {error && !loading && (
                <div style={{
                  position: 'absolute', inset: 0, zIndex: 10,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  background: 'rgba(255,255,255,0.9)',
                }}>
                  <p style={{ fontSize: 14, color: '#dc2626', marginBottom: 8 }}>分析失败</p>
                  <p style={{ fontSize: 12, color: '#6b5e54', maxWidth: 400, textAlign: 'center' }}>{error}</p>
                </div>
              )}
              {!graphData && !loading && !error && (
                <div style={{
                  position: 'absolute', inset: 0,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                }}>
                  <p style={{ fontSize: 14, color: '#9b8e84' }}>暂无关系图数据</p>
                  <p style={{ fontSize: 12, color: '#9b8e84', marginTop: 4 }}>点击上方「重新生成」开始分析</p>
                </div>
              )}
              <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
            </div>

            {/* Footer hint */}
            <div style={{
              padding: '10px 24px', borderTop: '1px solid rgba(0,0,0,0.04)',
              display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#9b8e84',
            }}>
              <span>拖拽节点调整位置 · 滚轮缩放 · 点击节点编辑角色</span>
              <span>关系数据由 AI 根据角色关系网分析生成</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
