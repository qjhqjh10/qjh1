// ── AI 写作助手 · 知识库文件勾选弹窗（v16 重设计）──
// 点击知识库「文件」按钮弹出的大弹窗：左侧三级目录树 + 右侧文件勾选列表。
// 替代原先的小 dropdown 勾选（小字、窄列、无目录）。
// 三态语义不变（[] = 全部；['__none__'] = 不使用；其余 = 勾选文件）。

import { useState, useEffect, useCallback, useMemo } from 'react'
import Modal from '@/components/common/Modal'
import { kbService } from '@/services/fileService'
import { KbFolderTree, formatKbSize, type KbTreeData } from '@/components/knowledge/KbFolderTree'
import { MagnifyingGlassIcon, CheckIcon, FolderIcon, DocumentTextIcon } from '@heroicons/react/24/outline'

export interface KbSelectionModalProps {
  isOpen: boolean
  onClose: () => void
  /** 当前选中文件 id 列表（不含 __none__/全部语义的解析已由调用方处理） */
  selectedIds: string[]
  /** 三态：'all' = 全部 / 'none' = 不使用 / 'custom' = 勾选具体文件 */
  mode: 'all' | 'none' | 'custom'
  onSelectAll: () => void
  onSelectNone: () => void
  onToggleFile: (fileId: string) => void
}

export function KbSelectionModal({
  isOpen, onClose, selectedIds, mode, onSelectAll, onSelectNone, onToggleFile,
}: KbSelectionModalProps) {
  const [dirTree, setDirTree] = useState<KbTreeData>({ dirs: [], files: [] })
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [activeDir, setActiveDir] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ '': true })
  const [selectDirMode, setSelectDirMode] = useState(false)  // 目录全选模式：true = 勾选当前目录全部文件

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const meta = await kbService.list() as { files: KbTreeData['files'] }
      const list = meta.files || []
      let tree: { dir: string; subdirs: string[] }[] = []
      try { tree = await kbService.listFolders() as { dir: string; subdirs: string[] }[] } catch { tree = [] }
      setDirTree({ dirs: tree, files: list })
    } catch { setDirTree({ dirs: [], files: [] }) }
    setLoading(false)
  }, [])

  useEffect(() => { if (isOpen) load() }, [isOpen, load])

  const fileList = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = dirTree.files
    if (q) list = list.filter(f => f.originalName.toLowerCase().includes(q))
    else if (activeDir) list = list.filter(f => (f.folder || '') === activeDir)
    return list
  }, [dirTree.files, search, activeDir])

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const checkedCount = mode === 'all' ? dirTree.files.length : mode === 'none' ? 0 : selectedIds.length

  // 当前目录勾选状态（用于"全选此目录"）
  const dirIds = useMemo(() => {
    const q = search.trim().toLowerCase()
    const dir = activeDir || ''
    return dirTree.files
      .filter(f => ((f.folder || '') === dir) && (!q || f.originalName.toLowerCase().includes(q)))
      .map(f => f.id)
  }, [dirTree.files, activeDir, search])

  const dirAllChecked = dirIds.length > 0 && dirIds.every(id => selectedSet.has(id))
  const dirSomeChecked = dirIds.some(id => selectedSet.has(id)) && !dirAllChecked

  const toggleDirAll = () => {
    if (dirAllChecked) {
      dirIds.forEach(id => { if (selectedSet.has(id)) onToggleFile(id) })
    } else {
      dirIds.forEach(id => { if (!selectedSet.has(id)) onToggleFile(id) })
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="选择知识库文件" width={860} maxHeight="80vh">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* 顶部：三态切换 + 搜索 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'inline-flex', borderRadius: 12, border: '1px solid rgba(0,0,0,0.08)', overflow: 'hidden', flexShrink: 0 }}>
            {([
              ['all', '全部文件'],
              ['none', '不使用'],
              ['custom', '自定义'],
            ] as const).map(([m, label]) => (
              <button key={m} onClick={() => m === 'all' ? onSelectAll() : m === 'none' ? onSelectNone() : undefined}
                style={{
                  padding: '9px 18px', border: 'none', cursor: 'pointer', fontSize: 13.5, fontFamily: 'inherit',
                  background: (mode === m ? 'rgba(124,58,237,0.12)' : 'transparent'),
                  color: mode === m ? '#7c3aed' : '#6b5e54', fontWeight: mode === m ? 700 : 500,
                  transition: 'all 0.12s ease', borderRight: '1px solid rgba(0,0,0,0.06)',
                }}
                onMouseEnter={e => { if (mode !== m) e.currentTarget.style.background = 'rgba(0,0,0,0.03)' }}
                onMouseLeave={e => { if (mode !== m) e.currentTarget.style.background = 'transparent' }}
              >
                {label}
              </button>
            ))}
          </div>
          <div style={{ position: 'relative', flex: 1, minWidth: 180 }}>
            <MagnifyingGlassIcon style={{ position: 'absolute', left: 12, top: 10, width: 15, height: 15, color: '#9b8e84' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="搜索文件名..."
              style={{
                width: '100%', padding: '10px 12px 10px 34px', borderRadius: 12,
                border: '1px solid rgba(0,0,0,0.08)', outline: 'none', fontSize: 13.5, fontFamily: 'inherit',
                background: '#f7f5f2', color: '#2d2520',
              }}
            />
          </div>
          <div style={{ fontSize: 12.5, color: '#9b8e84', whiteSpace: 'nowrap', flexShrink: 0 }}>
            已选 <span style={{ color: '#7c3aed', fontWeight: 700, fontSize: 14 }}>{checkedCount}</span> / {dirTree.files.length} 个文件
          </div>
        </div>

        {/* 主体：左目录树 + 右文件列表 */}
        <div style={{
          display: 'flex', gap: 0, border: '1px solid rgba(0,0,0,0.07)', borderRadius: 14, overflow: 'hidden',
          minHeight: 340, maxHeight: '52vh', background: '#fff',
        }}>
          {/* 左：三级目录树 */}
          <div style={{
            width: 240, flexShrink: 0, borderRight: '1px solid rgba(0,0,0,0.06)',
            background: '#faf9f7', display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }}>
            <div style={{ padding: '10px 12px 6px', fontSize: 11.5, fontWeight: 700, color: '#9b8e84', letterSpacing: '0.5px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>📂 目录</span>
              <span style={{ fontWeight: 400, fontSize: 11 }}>三级</span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }} className="custom-scrollbar">
              <KbFolderTree
                data={dirTree}
                activeKey={activeDir}
                activeType={activeDir ? 'dir' : 'root'}
                onSelect={(type, key) => { setActiveDir(type === 'root' ? '' : key); setSearch('') }}
                expanded={expanded}
                onToggleExpand={(p) => setExpanded(prev => ({ ...prev, [p]: !prev[p] }))}
                showFiles={false}
                showCounts
              />
            </div>
          </div>

          {/* 右：文件勾选列表 */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#fff' }}>
            {/* 目录栏 + 全选此目录 */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px',
              borderBottom: '1px solid rgba(0,0,0,0.05)', background: '#faf9f7',
            }}>
              <FolderIcon style={{ width: 14, height: 14, color: '#8b6f47', flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: '#3d342e', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {search ? `搜索结果（${fileList.length}）` : (activeDir || '根目录')}
              </span>
              {!search && dirIds.length > 0 && (
                <button
                  onClick={toggleDirAll}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 12px', borderRadius: 999,
                    border: dirAllChecked ? '1px solid rgba(124,58,237,0.3)' : '1px solid rgba(0,0,0,0.08)',
                    background: dirAllChecked ? 'rgba(124,58,237,0.08)' : 'transparent',
                    color: dirAllChecked ? '#7c3aed' : '#6b5e54', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  {dirAllChecked ? '取消全选此目录' : (dirSomeChecked ? '全选此目录' : '全选此目录')}
                </button>
              )}
            </div>

            {/* 文件行（大字体 + 大勾选框 + 悬浮操作） */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '6px 8px' }} className="custom-scrollbar">
              {loading && <div style={{ padding: 30, textAlign: 'center', color: '#9b8e84', fontSize: 13 }}>加载中...</div>}
              {!loading && fileList.length === 0 && (
                <div style={{ padding: 40, textAlign: 'center', color: '#9b8e84', fontSize: 13.5 }}>
                  {search ? '未找到匹配文件' : '此目录暂无文件'}
                </div>
              )}
              {!loading && fileList.map(f => {
                const checked = mode === 'all' || selectedSet.has(f.id)
                const disabled = mode === 'all'  // 全部模式下无需单独勾选
                return (
                  <label
                    key={f.id}
                    onClick={() => { if (!disabled) onToggleFile(f.id) }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '11px 12px', borderRadius: 12,
                      cursor: disabled ? 'default' : 'pointer', marginBottom: 2,
                      background: checked ? 'rgba(124,58,237,0.05)' : 'transparent',
                      border: checked ? '1px solid rgba(124,58,237,0.18)' : '1px solid transparent',
                      transition: 'background 0.1s ease, border-color 0.1s ease',
                      fontFamily: 'inherit',
                    }}
                    onMouseEnter={e => { if (!checked) e.currentTarget.style.background = 'rgba(0,0,0,0.02)' }}
                    onMouseLeave={e => { if (!checked) e.currentTarget.style.background = 'transparent' }}
                  >
                    {/* 大号勾选框 */}
                    <span style={{
                      width: 22, height: 22, borderRadius: 7, flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      border: checked ? '2px solid #7c3aed' : '2px solid #d0c8be',
                      background: checked ? '#7c3aed' : '#fff',
                      transition: 'all 0.12s ease',
                    }}>
                      {checked && <CheckIcon style={{ width: 14, height: 14, color: '#fff', strokeWidth: 3 }} />}
                    </span>
                    <DocumentTextIcon style={{ width: 17, height: 17, color: checked ? '#7c3aed' : '#b0a89e', flexShrink: 0 }} />
                    <span style={{
                      flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      fontSize: 13.5, fontWeight: checked ? 600 : 400, color: checked ? '#7c3aed' : '#3d342e',
                    }}>{f.originalName}</span>
                    <span style={{ fontSize: 11, color: '#b0a89e', flexShrink: 0 }}>{formatKbSize(f.size)}</span>
                    <span style={{
                      fontSize: 10.5, padding: '1px 7px', borderRadius: 5, background: 'rgba(0,0,0,0.04)',
                      color: '#9b8e84', flexShrink: 0, fontWeight: 600,
                    }}>{f.type.toUpperCase()}</span>
                  </label>
                )
              })}
            </div>
          </div>
        </div>

        {/* 底部：提示 + 确定 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 4 }}>
          <div style={{ flex: 1, fontSize: 12, color: '#9b8e84', lineHeight: 1.6 }}>
            {mode === 'all' && <span>📚 已选择全部知识库文件，AI 按话题自动检索。</span>}
            {mode === 'none' && <span>🚫 知识库已开启但未选择文件——AI 不会检索知识库。可在上方切换「全部文件」或「自定义」。</span>}
            {mode === 'custom' && <span>✓ 已勾选 <b style={{ color: '#7c3aed' }}>{selectedIds.length}</b> 个文件（按三级目录组织）。</span>}
          </div>
          <button onClick={onClose} style={{
            padding: '10px 28px', borderRadius: 12, border: 'none', cursor: 'pointer',
            background: 'linear-gradient(135deg, #7c3aed, #6d28d9)', color: '#fff',
            fontSize: 14, fontWeight: 700, fontFamily: 'inherit', boxShadow: '0 4px 14px rgba(124,58,237,0.3)',
            transition: 'transform 0.1s ease, box-shadow 0.1s ease',
          }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.03)'; e.currentTarget.style.boxShadow = '0 6px 18px rgba(124,58,237,0.4)' }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 4px 14px rgba(124,58,237,0.3)' }}
          >完成 ({checkedCount})</button>
        </div>
      </div>
    </Modal>
  )
}
