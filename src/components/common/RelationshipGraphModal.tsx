import { useEffect, useRef, useState } from 'react'
import Modal from './Modal'
import type { RelationshipGraph } from '@/types/character'
import type { Character } from '@/types/character'
import { renderRelationshipGraph } from '@/utils/graphRenderer'
import {
  XMarkIcon, ArrowPathIcon, SparklesIcon,
  UserIcon, PencilIcon, PlusIcon,
} from '@heroicons/react/24/outline'

interface Props {
  isOpen: boolean
  graphData: RelationshipGraph | null
  loading: boolean
  error: string
  characters: Character[]
  onClose: () => void
  onRegenerate: () => void
  onIncrementalRefresh: () => void
  onNodeClick: (characterId: string) => void
  onEditCharacter: (char: Character) => void
  onNewCharacter: () => void
}

const ROLE_LEGEND: { role: string; color: string }[] = [
  { role: '男主', color: '#7c3aed' },
  { role: '女主', color: '#ec4899' },
  { role: '男配', color: '#3b82f6' },
  { role: '女配', color: '#f59e0b' },
  { role: '反派', color: '#ef4444' },
  { role: '其他', color: '#6b7280' },
]

const NODE_COLORS: Record<string, string> = {
  '男主': '#7c3aed', '女主': '#ec4899', '男配': '#3b82f6',
  '女配': '#f59e0b', '反派': '#ef4444', '其他': '#6b7280',
}

export default function RelationshipGraphModal({
  isOpen, graphData, loading, error, characters,
  onClose, onRegenerate, onIncrementalRefresh, onNodeClick, onEditCharacter, onNewCharacter,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const graphRef = useRef<{ destroy: () => void } | null>(null)
  const [selectedCharId, setSelectedCharId] = useState<string | null>(null)

  const selectedChar = characters.find(c => c.id === selectedCharId) || null

  // Render G6 graph when data changes or modal opens
  useEffect(() => {
    if (!isOpen || !containerRef.current || !graphData) return

    let cancelled = false
    const timer = setTimeout(() => {
      if (!containerRef.current || cancelled) return
      graphRef.current?.destroy()
      renderRelationshipGraph(
        containerRef.current,
        graphData,
        (id) => {
          setSelectedCharId(id)
          onNodeClick(id)
        },
      ).then(g => {
        if (!cancelled) graphRef.current = g
      })
    }, 300)

    return () => {
      cancelled = true
      clearTimeout(timer)
      graphRef.current?.destroy()
    }
  }, [isOpen, graphData, onNodeClick])

  // Cleanup on unmount
  useEffect(() => {
    return () => { graphRef.current?.destroy() }
  }, [])

  // Reset selection when modal closes
  useEffect(() => {
    if (!isOpen) setSelectedCharId(null)
  }, [isOpen])

  return (
    <Modal isOpen={isOpen} onClose={onClose} width="95vw" closeOnBackdropClick={false}>
      <div style={{ height: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 0 10px 0', borderBottom: '1px solid rgba(0,0,0,0.06)', flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <SparklesIcon style={{ width: 20, height: 20, color: '#7c3aed' }} />
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1e1b2e', margin: 0 }}>角色关系图</h3>
            {graphData && (
              <span style={{ fontSize: 11, color: '#9b8e84' }}>
                {graphData.nodes.length}角色 · {graphData.edges.length}关系
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 8, marginRight: 10 }}>
              {ROLE_LEGEND.map(l => (
                <div key={l.role} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: '#6b5e54' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: l.color, flexShrink: 0 }} />
                  {l.role}
                </div>
              ))}
            </div>
            <button onClick={onRegenerate} disabled={loading} title="重新生成全部关系"
              style={{ padding: '5px 10px', borderRadius: 7, border: '1px solid rgba(0,0,0,0.08)', background: '#fff', color: '#6b5e54', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4 }}>
              <ArrowPathIcon style={{ width: 12, height: 12 }} />重新生成
            </button>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#9b8e84', display: 'flex' }}>
              <XMarkIcon style={{ width: 20, height: 20 }} />
            </button>
          </div>
        </div>

        {/* Body: Graph (left) + Side panel (right) */}
        <div style={{ flex: 1, display: 'flex', gap: 12, minHeight: 0, paddingTop: 8 }}>
          {/* Left: Graph */}
          <div style={{ flex: 1, position: 'relative', borderRadius: 12, overflow: 'hidden', background: 'rgba(124,58,237,0.01)', border: '1px solid rgba(0,0,0,0.04)' }}>
            {loading && (
              <div style={{ position: 'absolute', inset: 0, zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.85)' }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', border: '3px solid rgba(124,58,237,0.15)', borderTopColor: '#7c3aed', animation: 'spin 0.7s linear infinite', marginBottom: 12 }} />
                <p style={{ fontSize: 13, color: '#6b5e54', fontWeight: 600 }}>AI 正在分析角色关系...</p>
              </div>
            )}
            {error && !loading && (
              <div style={{ position: 'absolute', inset: 0, zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.9)' }}>
                <p style={{ fontSize: 14, color: '#dc2626', marginBottom: 8, fontWeight: 600 }}>分析失败</p>
                <p style={{ fontSize: 12, color: '#6b5e54', maxWidth: 400, textAlign: 'center', lineHeight: 1.6 }}>{error}</p>
                <button onClick={onRegenerate} style={{ marginTop: 12, padding: '6px 16px', borderRadius: 8, border: '1px solid #7c3aed', background: 'rgba(124,58,237,0.04)', color: '#7c3aed', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>重试</button>
              </div>
            )}
            {!graphData && !loading && !error && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <UserIcon style={{ width: 40, height: 40, color: '#d4ccc4', marginBottom: 10 }} />
                <p style={{ fontSize: 14, color: '#9b8e84', marginBottom: 6 }}>暂无关系图</p>
                <button onClick={onRegenerate} style={{ padding: '6px 16px', borderRadius: 8, border: '1px solid #7c3aed', background: 'rgba(124,58,237,0.06)', color: '#7c3aed', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>AI 生成关系图</button>
              </div>
            )}
            <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
          </div>

          {/* Right: Side panel */}
          <div style={{
            width: 280, flexShrink: 0,
            display: 'flex', flexDirection: 'column',
            borderRadius: 12, border: '1px solid rgba(0,0,0,0.05)',
            background: 'rgba(255,255,255,0.7)', overflow: 'hidden',
          }}>
            {selectedChar ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 16, gap: 10 }}>
                {/* Selected character name + role */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: NODE_COLORS[selectedChar.role] || '#6b7280', flexShrink: 0 }} />
                  <h4 style={{ fontSize: 15, fontWeight: 700, color: '#1e1b2e', margin: 0 }}>{selectedChar.name || '未命名'}</h4>
                  {selectedChar.role && (
                    <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'rgba(124,58,237,0.06)', color: '#7c3aed', fontWeight: 600 }}>{selectedChar.role}</span>
                  )}
                </div>
                {/* Info fields */}
                {selectedChar.occupation && <InfoRow label="职业/身份" value={selectedChar.occupation} />}
                {(selectedChar.gender || selectedChar.age) && <InfoRow label="基本信息" value={[selectedChar.gender, selectedChar.age].filter(Boolean).join(' · ')} />}
                {selectedChar.personality && <InfoRow label="性格" value={selectedChar.personality.slice(0, 80) + (selectedChar.personality.length > 80 ? '…' : '')} />}
                {/* Connected characters */}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', marginBottom: 4 }}>关联角色</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {graphData?.edges
                      .filter(e => e.source === selectedChar.id || e.target === selectedChar.id)
                      .map((e, i) => {
                        const otherId = e.source === selectedChar.id ? e.target : e.source
                        const otherChar = characters.find(c => c.id === otherId)
                        return (
                          <button key={i} onClick={() => { setSelectedCharId(otherId); onNodeClick(otherId) }}
                            style={{
                              padding: '2px 8px', borderRadius: 5, fontSize: 10, cursor: 'pointer',
                              background: 'rgba(124,58,237,0.04)', border: '1px solid rgba(124,58,237,0.1)', color: '#7c3aed', fontFamily: 'inherit',
                            }}>
                            {otherChar?.name || otherId} — {e.relation}
                          </button>
                        )
                      })}
                    {graphData?.edges.filter(e => e.source === selectedChar.id || e.target === selectedChar.id).length === 0 && (
                      <span style={{ fontSize: 10, color: '#9b8e84' }}>无关联角色</span>
                    )}
                  </div>
                </div>
                <div style={{ flex: 1 }} />
                <button onClick={() => onEditCharacter(selectedChar)}
                  style={{
                    width: '100%', padding: '7px 0', borderRadius: 8,
                    border: '1px solid rgba(124,58,237,0.15)', background: 'rgba(124,58,237,0.04)',
                    color: '#7c3aed', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                  }}>
                  <PencilIcon style={{ width: 14, height: 14 }} />编辑角色
                </button>
              </div>
            ) : (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20, gap: 6 }}>
                <UserIcon style={{ width: 32, height: 32, color: '#d4ccc4' }} />
                <p style={{ fontSize: 12, color: '#9b8e84', textAlign: 'center', lineHeight: 1.6 }}>点击图中节点<br />查看角色详情</p>
              </div>
            )}
            {/* Divider */}
            <div style={{ height: 1, background: 'rgba(0,0,0,0.05)' }} />
            {/* New character button */}
            <button onClick={onNewCharacter}
              style={{
                margin: 10, padding: '8px 0', borderRadius: 8,
                border: '1px dashed rgba(124,58,237,0.2)', background: 'rgba(124,58,237,0.02)',
                color: '#7c3aed', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
              }}>
              <PlusIcon style={{ width: 14, height: 14 }} />新建角色
            </button>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '10px 0 0 0', borderTop: '1px solid rgba(0,0,0,0.04)',
          display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#9b8e84', flexShrink: 0,
        }}>
          <span>拖拽节点调整位置 · 滚轮缩放 · 点击节点查看详情</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onIncrementalRefresh} disabled={loading || !graphData}
              title="保留已有关系，仅分析新增角色"
              style={{ background: 'none', border: 'none', cursor: loading ? 'default' : 'pointer', fontSize: 11, color: '#7c3aed', fontFamily: 'inherit', opacity: loading || !graphData ? 0.4 : 1 }}>
              <SparklesIcon style={{ width: 11, height: 11, marginRight: 2 }} />增量刷新
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 600, color: '#9b8e84', marginBottom: 1 }}>{label}</div>
      <div style={{ fontSize: 11, color: '#4a3f38', lineHeight: 1.5 }}>{value}</div>
    </div>
  )
}
