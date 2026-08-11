// ── AI 写作助手 · 知识库文件勾选弹窗（v16 重设计；v16.3.0: 纯勾选模式 + 书签式）──
// v16.3.0 改造：
//   1. 可拖动/缩放（Modal draggable+resizable）
//   2. 去掉三态快捷按钮（全部文件/不使用/自定义）——纯勾选，用户自己选
//   3. **书签式**：目录与文件合为一个树形列表（不再分左右两栏）——目录展开/折叠，
//      文件行缩进显示 + 直接勾选；目录行 hover 出现「全选此目录」
//   4. 语义：勾选 N 个 = 用这 N 个；一个不勾 = 不使用知识库（空数组 → ['__none__']）；
//      旧数据 []（全部）打开时视觉全勾（localAll），首次勾选自动展开为显式列表
//   5. 文件与项目解绑：任意项目可勾选/检索任意知识库文件（kb:search 已取消 projectId 过滤）

import { useState, useEffect, useCallback, useMemo } from 'react'
import Modal from '@/components/common/Modal'
import { kbService } from '@/services/fileService'
import { formatKbSize, type KbTreeData } from '@/components/knowledge/KbFolderTree'
import { MagnifyingGlassIcon, CheckIcon, FolderIcon, FolderOpenIcon, ChevronRightIcon, DocumentTextIcon } from '@heroicons/react/24/outline'

export interface KbSelectionModalProps {
  isOpen: boolean
  onClose: () => void
  /** 当前选中文件 id 列表（不含 __none__） */
  selectedIds: string[]
  /** 'all' = 旧数据 []（全部）语义：视觉全勾，首次勾选自动展开为显式列表；'custom' = 勾选文件 */
  mode: 'all' | 'custom'
  /** v16.3.0: 整体替换勾选（空数组 = 不使用知识库，调用方落为 ['__none__']） */
  onSetIds: (ids: string[]) => void
}

export function KbSelectionModal({
  isOpen, onClose, selectedIds, mode, onSetIds,
}: KbSelectionModalProps) {
  const [dirTree, setDirTree] = useState<KbTreeData>({ dirs: [], files: [] })
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ '': true })
  // 旧数据 []（全部）打开 → 视觉全勾；任何勾选操作先展开为显式文件列表
  const [localAll, setLocalAll] = useState(false)

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

  useEffect(() => { if (isOpen) { setLocalAll(mode === 'all'); load() } }, [isOpen, mode, load])

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const checkedCount = localAll ? dirTree.files.length : selectedIds.length

  // ── 数据助手 ──
  const filesIn = (dir: string) => dirTree.files.filter(f => (f.folder || '') === dir)
  const subdirsOf = (dir: string) => {
    const d = dirTree.dirs.find(x => x.dir === dir)
    return d?.subdirs || []
  }
  // 目录内全部文件（含子目录），用于「全选此目录」
  const dirAllIds = (dir: string) => dirTree.files
    .filter(f => (f.folder || '') === dir || f.folder?.startsWith(dir + '/'))
    .map(f => f.id)

  // ── 勾选操作 ──
  const toggleFile = (id: string) => {
    if (localAll) {
      // 全部 → 显式：整体替换为全部文件 id 并剔除当前 id
      onSetIds(dirTree.files.map(f => f.id).filter(fid => fid !== id))
      setLocalAll(false)
    } else {
      const next = selectedSet.has(id) ? selectedIds.filter(x => x !== id) : [...selectedIds, id]
      onSetIds(next)
    }
  }

  const toggleDirAll = (dir: string) => {
    const ids = dirAllIds(dir)
    if (localAll) {
      onSetIds(dirTree.files.map(f => f.id).filter(id => !ids.includes(id)))
      setLocalAll(false)
    } else if (ids.length > 0 && ids.every(id => selectedSet.has(id))) {
      onSetIds(selectedIds.filter(id => !ids.includes(id)))
    } else {
      onSetIds([...new Set([...selectedIds, ...ids])])
    }
  }

  // ── 渲染 ──
  const renderFileRow = (f: { id: string; originalName: string; type: string; size: number; folder?: string }, indent: number) => {
    const checked = localAll || selectedSet.has(f.id)
    return (
      <label
        key={f.id}
        onClick={() => toggleFile(f.id)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', margin: '0 6px 1px',
          borderRadius: 10, cursor: 'pointer',
          background: checked ? 'rgba(124,58,237,0.05)' : 'transparent',
          border: checked ? '1px solid rgba(124,58,237,0.18)' : '1px solid transparent',
          paddingLeft: 12 + indent,
          transition: 'background 0.1s ease, border-color 0.1s ease',
          fontFamily: 'inherit',
        }}
        onMouseEnter={e => { if (!checked) e.currentTarget.style.background = 'rgba(0,0,0,0.02)' }}
        onMouseLeave={e => { if (!checked) e.currentTarget.style.background = 'transparent' }}
      >
        {/* 勾选框 */}
        <span style={{
          width: 20, height: 20, borderRadius: 6, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: checked ? '2px solid #7c3aed' : '2px solid #d0c8be',
          background: checked ? '#7c3aed' : '#fff',
          transition: 'all 0.12s ease',
        }}>
          {checked && <CheckIcon style={{ width: 13, height: 13, color: '#fff', strokeWidth: 3 }} />}
        </span>
        <DocumentTextIcon style={{ width: 15, height: 15, color: checked ? '#7c3aed' : '#b0a89e', flexShrink: 0 }} />
        <span style={{
          flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          fontSize: 13, fontWeight: checked ? 600 : 400, color: checked ? '#7c3aed' : '#3d342e',
        }}>{f.originalName}</span>
        <span style={{ fontSize: 11, color: '#b0a89e', flexShrink: 0 }}>{formatKbSize(f.size)}</span>
        <span style={{
          fontSize: 10, padding: '1px 6px', borderRadius: 5, background: 'rgba(0,0,0,0.04)',
          color: '#9b8e84', flexShrink: 0, fontWeight: 600,
        }}>{f.type.toUpperCase()}</span>
      </label>
    )
  }

  const renderDirRow = (path: string, name: string, level: number, count: number) => {
    const isOpen = !!expanded[path]
    const ids = dirAllIds(path)
    const dirChecked = ids.length > 0 && (localAll || ids.every(id => selectedSet.has(id)))
    const dirSome = !dirChecked && ids.some(id => localAll || selectedSet.has(id))
    return (
      <div key={path || 'root'}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 4, padding: `${level === 0 ? 9 : 7}px 8px ${level === 0 ? 9 : 7}px ${10 + level * 14}px`,
          borderRadius: 10, fontFamily: 'inherit',
        }}>
          <button
            onClick={() => setExpanded(prev => ({ ...prev, [path]: !prev[path] }))}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex', color: '#9b8e84', flexShrink: 0 }}
            title={isOpen ? '折叠' : '展开'}
          >
            <ChevronRightIcon style={{ width: 13, height: 13, transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.12s ease' }} />
          </button>
          {isOpen
            ? <FolderOpenIcon style={{ width: 16, height: 16, color: '#8b6f47', flexShrink: 0 }} />
            : <FolderIcon style={{ width: 16, height: 16, color: '#8b6f47', flexShrink: 0 }} />}
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: level === 0 ? 13.5 : 12.5, fontWeight: 600, color: '#3d342e' }}>{name}</span>
          <span style={{ fontSize: 10.5, color: '#b0a89e', flexShrink: 0, fontWeight: 400 }}>{count}</span>
          {/* hover 显示「全选此目录」 */}
          {ids.length > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); toggleDirAll(path) }}
              title={dirChecked ? '取消全选此目录' : '全选此目录（含子目录）'}
              style={{
                display: 'none', alignItems: 'center', gap: 3, padding: '3px 8px', borderRadius: 999,
                border: dirChecked ? '1px solid rgba(124,58,237,0.3)' : '1px solid rgba(0,0,0,0.08)',
                background: dirChecked ? 'rgba(124,58,237,0.08)' : 'transparent',
                color: dirChecked ? '#7c3aed' : '#6b5e54', fontSize: 11, fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0, whiteSpace: 'nowrap',
              }}
            >
              {dirChecked ? '取消全选' : (dirSome ? '全选此目录' : '全选此目录')}
            </button>
          )}
        </div>
        {isOpen && (
          <div>
            {filesIn(path).map(f => renderFileRow(f, (level + 1) * 14))}
            {path === ''
              ? dirTree.dirs.map(d1 => (
                  <div key={d1.dir}>{renderDirRow(d1.dir, d1.dir, 1, dirAllIds(d1.dir).length)}</div>
                ))
              : subdirsOf(path).map(sub => (
                  <div key={`${path}/${sub}`}>{renderDirRow(`${path}/${sub}`, sub, 2, dirAllIds(`${path}/${sub}`).length)}</div>
                ))}
            {path === '' && filesIn('').length === 0 && dirTree.dirs.length === 0 && !loading && (
              <div style={{ padding: '12px 16px', fontSize: 12, color: '#b0a89e' }}>（知识库暂无文件，可在知识库页面上传）</div>
            )}
          </div>
        )}
      </div>
    )
  }

  // 搜索模式：平铺所有匹配文件（忽略目录层级）
  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return null
    return dirTree.files.filter(f => f.originalName.toLowerCase().includes(q))
  }, [dirTree.files, search])

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="选择知识库文件" width={680} maxHeight="80vh" draggable resizable>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* 顶部：搜索 + 计数 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
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

        {/* 书签式树形列表（目录+文件合一） */}
        <div style={{
          border: '1px solid rgba(0,0,0,0.07)', borderRadius: 14, overflow: 'hidden',
          minHeight: 340, maxHeight: '54vh', background: '#fff', display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }} className="custom-scrollbar">
            {loading && <div style={{ padding: 30, textAlign: 'center', color: '#9b8e84', fontSize: 13 }}>加载中...</div>}
            {!loading && searchResults !== null && (
              searchResults.length === 0
                ? <div style={{ padding: 40, textAlign: 'center', color: '#9b8e84', fontSize: 13.5 }}>未找到匹配文件</div>
                : searchResults.map(f => renderFileRow(f, 0))
            )}
            {!loading && searchResults === null && renderDirRow('', '全部文件', 0, dirTree.files.length)}
          </div>
        </div>

        {/* 底部：提示 + 确定 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 2 }}>
          <div style={{ flex: 1, fontSize: 12, color: '#9b8e84', lineHeight: 1.6 }}>
            {localAll
              ? <span>📚 当前选择<b>全部</b>知识库文件——勾选/取消任意文件即转为自定义选择。</span>
              : <span>✓ 已勾选 <b style={{ color: '#7c3aed' }}>{selectedIds.length}</b> 个文件（不勾选任何文件 = 不使用知识库；任意项目均可用全部知识库文件）。</span>}
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
