// ── Operation History Section (v14.3) ──
// 操作记录内容组件：原 OperationHistoryPage 的内容逻辑提取为可嵌入组件，
// 供 设置 → Agent → 操作记录 子标签使用（卡片容器，非全页布局）。
// 数据源不变：useOpHistoryStore（localStorage 持久化）。

import { useState, useMemo } from 'react'
import {
  DocumentTextIcon, TrashIcon, DocumentPlusIcon,
  FolderOpenIcon, MagnifyingGlassIcon, ArrowPathIcon,
  ArrowUturnLeftIcon, PencilIcon, CheckCircleIcon,
  XCircleIcon, ClockIcon, ChevronDownIcon, ChevronRightIcon,
  FunnelIcon, XMarkIcon,
} from '@heroicons/react/24/outline'
import { useOpHistoryStore } from '@/store/operationHistoryStore'
import GlassCard from '@/components/common/GlassCard'

const iconMap: Record<string, React.ReactNode> = {
  list_directory: <FolderOpenIcon style={{ width: 16, height: 16, color: '#7c3aed' }} />,
  read_file: <DocumentTextIcon style={{ width: 16, height: 16, color: '#7c3aed' }} />,
  search_content: <MagnifyingGlassIcon style={{ width: 16, height: 16, color: '#7c3aed' }} />,
  create_file: <DocumentPlusIcon style={{ width: 16, height: 16, color: '#16a34a' }} />,
  edit_file: <PencilIcon style={{ width: 16, height: 16, color: '#7c3aed' }} />,
  delete_file: <TrashIcon style={{ width: 16, height: 16, color: '#dc2626' }} />,
  restore_backup: <ArrowPathIcon style={{ width: 16, height: 16, color: '#d97706' }} />,
  rename_file: <ArrowUturnLeftIcon style={{ width: 16, height: 16, color: '#7c3aed' }} />,
}

const labelMap: Record<string, string> = {
  list_directory: '列出目录',
  read_file: '读取文件',
  search_content: '搜索内容',
  create_file: '创建文件',
  edit_file: '编辑文件',
  delete_file: '删除文件',
  restore_backup: '恢复备份',
  rename_file: '重命名/移动',
}

export default function OperationHistorySection() {
  const entries = useOpHistoryStore(s => s.entries)
  const clearEntries = useOpHistoryStore(s => s.clearEntries)
  const removeEntry = useOpHistoryStore(s => s.removeEntry)
  const [filter, setFilter] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    if (!filter) return entries
    const f = filter.toLowerCase()
    return entries.filter(e =>
      e.filePath.toLowerCase().includes(f) ||
      (labelMap[e.toolName] || e.toolName).includes(f) ||
      e.summary.toLowerCase().includes(f),
    )
  }, [entries, filter])

  const stats = useMemo(() => {
    const success = entries.filter(e => e.status === 'success' || e.status === 'confirmed').length
    const errors = entries.filter(e => e.status === 'error').length
    const undone = entries.filter(e => e.status === 'undone').length
    return { total: entries.length, success, errors, undone }
  }, [entries])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Stats bar */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <StatChip label="总计" value={stats.total} color="#6b5e54" />
        <StatChip label="成功" value={stats.success} color="#16a34a" />
        <StatChip label="失败" value={stats.errors} color="#dc2626" />
        <StatChip label="已撤销" value={stats.undone} color="#9ca3af" />
      </div>

      {/* Filter + clear */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <FunnelIcon style={{ position: 'absolute', left: 10, top: 9, width: 14, height: 14, color: '#9b8e84' }} />
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="筛选文件名、操作类型..."
            style={{
              width: '100%', padding: '7px 10px 7px 30px', borderRadius: 10,
              border: '1px solid rgba(0,0,0,0.08)', outline: 'none',
              fontSize: 12, fontFamily: 'inherit', color: '#2d2520',
              background: 'rgba(0,0,0,0.02)',
            }}
          />
          {filter && (
            <button onClick={() => setFilter('')} style={{ position: 'absolute', right: 8, top: 7, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              <XMarkIcon style={{ width: 14, height: 14, color: '#9b8e84' }} />
            </button>
          )}
        </div>
        {entries.length > 0 && (
          <button onClick={clearEntries} style={{
            padding: '7px 14px', borderRadius: 8, border: '1px solid rgba(239,68,68,0.2)',
            background: 'rgba(239,68,68,0.03)', color: '#dc2626',
            fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
          }}>
            清空全部
          </button>
        )}
      </div>

      {/* Entry list */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#9b8e84', fontSize: 13, padding: 40 }}>
          {entries.length === 0 ? '暂无操作记录。使用 AI 聊天窗口进行文件操作后，记录将出现在这里。' : '无匹配结果。'}
        </div>
      ) : (
        <div className="custom-scrollbar" style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 'calc(100vh - 320px)', overflowY: 'auto', paddingRight: 4 }}>
          {filtered.map(entry => {
            const isExpanded = expandedId === entry.id
            return (
              <GlassCard key={entry.id} style={{ padding: '12px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
                  onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                >
                  {iconMap[entry.toolName] || <DocumentTextIcon style={{ width: 16, height: 16 }} />}
                  <span style={{ fontWeight: 600, fontSize: 13, color: '#2d2520', flex: 1 }}>
                    {labelMap[entry.toolName] || entry.toolName}
                  </span>
                  <span style={{ fontSize: 11, color: '#6b5e54', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {entry.filePath}
                  </span>
                  <StatusBadge status={entry.status} />
                  <span style={{ fontSize: 10, color: '#9b8e84' }}>
                    {new Date(entry.timestamp).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {isExpanded
                    ? <ChevronDownIcon style={{ width: 14, height: 14, color: '#9b8e84', flexShrink: 0 }} />
                    : <ChevronRightIcon style={{ width: 14, height: 14, color: '#9b8e84', flexShrink: 0 }} />
                  }
                </div>
                {isExpanded && (
                  <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 8, background: 'rgba(0,0,0,0.02)', fontSize: 12 }}>
                    <div style={{ color: '#6b5e54', marginBottom: 4 }}>{entry.summary}</div>
                    {entry.detail && (
                      <div style={{
                        padding: '6px 8px', borderRadius: 6, background: 'rgba(0,0,0,0.03)',
                        fontSize: 11, color: '#6b5e54', whiteSpace: 'pre-wrap',
                        fontFamily: '"Cascadia Code", "Fira Code", "Consolas", monospace',
                        marginBottom: 8,
                      }}>
                        {entry.detail}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 8 }}>
                      {entry.status === 'success' || entry.status === 'confirmed' ? (
                        <button onClick={(e) => { e.stopPropagation(); removeEntry(entry.id) }} style={{
                          padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.08)',
                          background: 'transparent', color: '#6b5e54', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit',
                        }}>
                          删除记录
                        </button>
                      ) : null}
                    </div>
                  </div>
                )}
              </GlassCard>
            )
          })}
        </div>
      )}

      {/* Footer info */}
      <div style={{ textAlign: 'center', fontSize: 11, color: '#9b8e84' }}>
        <ClockIcon style={{ width: 12, height: 12, display: 'inline', marginRight: 4, verticalAlign: -2 }} />
        记录持久化到本地存储，切换项目或重启应用后仍可查看
      </div>
    </div>
  )
}

function StatChip({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '6px 14px', borderRadius: 10,
      border: `1px solid ${color}20`, background: `${color}08`,
    }}>
      <span style={{ fontSize: 11, color: '#9b8e84' }}>{label}</span>
      <span style={{ fontSize: 16, fontWeight: 700, color }}>{value}</span>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  let color = '#10b981'
  let label = '成功'
  if (status === 'error') { color = '#dc2626'; label = '失败' }
  else if (status === 'denied') { color = '#9ca3af'; label = '已取消' }
  else if (status === 'undone') { color = '#9ca3af'; label = '已撤销' }

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      padding: '1px 8px', borderRadius: 6,
      background: `${color}10`, color, fontSize: 10, fontWeight: 600,
    }}>
      {status === 'error' ? <XCircleIcon style={{ width: 10, height: 10 }} /> :
       status === 'success' || status === 'confirmed' ? <CheckCircleIcon style={{ width: 10, height: 10 }} /> :
       null}
      {label}
    </span>
  )
}
