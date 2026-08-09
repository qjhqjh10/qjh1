// ── 知识库三级目录树（共享组件，v16）──
// 供 KnowledgeBasePage（左侧导航）与 AIChatWindow 知识库勾选弹窗复用：
// 根目录 → 一级子目录 → 二级子目录，共三层。
// 纯展示 + 展开/收起控制；选中与操作（新建/重命名/删除目录）由父组件注入。

import { useState } from 'react'
import { FolderIcon, FolderOpenIcon, ChevronRightIcon, DocumentTextIcon } from '@heroicons/react/24/outline'

export interface KbTreeNode {
  /** 目录相对路径（"一级" 或 "一级/二级"）；根目录为 '' */
  path: string
  name: string
  /** 层级：0 = 根，1 = 一级，2 = 二级 */
  level: number
}

export interface KbTreeData {
  /** 一级目录（含其二级子目录） */
  dirs: Array<{ dir: string; subdirs: string[] }>
  /** 全部文件（含 folder 归属） */
  files: Array<{ id: string; originalName: string; type: string; size: number; folder?: string }>
}

export interface KbFolderTreeProps {
  data: KbTreeData
  /** 当前选中节点（目录或文件）的路径/ID */
  activeKey: string
  /** activeKey 类型：'root' | 'dir' | 'file' */
  activeType: 'root' | 'dir' | 'file'
  onSelect: (type: 'root' | 'dir' | 'file', key: string) => void
  /** 渲染文件行尾部的操作区（可选，如删除按钮） */
  renderFileActions?: (file: { id: string; originalName: string; type: string; size: number; folder?: string }) => React.ReactNode
  /** 显示文件数统计（默认 true） */
  showCounts?: boolean
  /** 展开态（受控，父组件持久化） */
  expanded?: Record<string, boolean>
  onToggleExpand?: (path: string) => void
  /** v16: 是否在目录树内联渲染文件行（默认 true；勾选弹窗左侧纯目录树可设 false） */
  showFiles?: boolean
}

export function KbFolderTree({
  data, activeKey, activeType, onSelect, renderFileActions, showCounts = true, expanded: expandedProp, onToggleExpand, showFiles = true,
}: KbFolderTreeProps) {
  const [expandedState, setExpandedState] = useState<Record<string, boolean>>({ '': true })
  const expanded = expandedProp ?? expandedState
  const toggle = onToggleExpand ?? ((path: string) => setExpandedState(prev => ({ ...prev, [path]: !prev[path] })))

  const fileCountInDir = (dirPath: string) =>
    data.files.filter(f => f.folder === dirPath || f.folder?.startsWith(dirPath + '/')).length

  // 文件行（根/一级/二级共用）
  const renderFileRow = (f: { id: string; originalName: string; type: string; size: number; folder?: string }, indent: number) => {
    const isActive = activeType === 'file' && activeKey === f.id
    return (
      <div key={f.id} style={{ display: 'flex', alignItems: 'center', borderRadius: 8, paddingLeft: indent }}>
        <button
          onClick={() => onSelect('file', f.id)}
          style={{
            flex: 1, display: 'flex', alignItems: 'center', gap: 6, textAlign: 'left', padding: '7px 10px',
            border: 'none', borderRadius: 8, background: isActive ? 'rgba(124,58,237,0.08)' : 'transparent',
            cursor: 'pointer', fontFamily: 'inherit', minWidth: 0,
          }}
        >
          <DocumentTextIcon style={{ width: 13, height: 13, color: isActive ? '#7c3aed' : '#b0a89e', flexShrink: 0 }} />
          <span style={{
            flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            fontSize: 12.5, color: isActive ? '#7c3aed' : '#4a4038', fontWeight: isActive ? 600 : 400,
          }}>{f.originalName}</span>
          {showCounts && <span style={{ fontSize: 10, color: '#c0b8ae', flexShrink: 0 }}>{formatKbSize(f.size)}</span>}
        </button>
        {renderFileActions?.(f)}
      </div>
    )
  }

  const renderDirRow = (node: KbTreeNode, children?: React.ReactNode) => {
    const isOpen = expanded[node.path]
    const isActive = activeType === 'dir' && activeKey === node.path
    const count = showCounts ? fileCountInDir(node.path) : null
    return (
      <div key={node.path || 'root'}>
        <button
          onClick={() => onSelect('dir', node.path)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left',
            padding: `${node.level === 0 ? 9 : 7}px 10px`, borderRadius: 10, border: 'none',
            background: isActive ? 'rgba(124,58,237,0.10)' : 'transparent',
            color: isActive ? '#7c3aed' : '#3d342e', fontWeight: isActive ? 600 : 500,
            cursor: 'pointer', fontSize: node.level === 0 ? 13.5 : 12.5, fontFamily: 'inherit',
            transition: 'background 0.1s ease',
          }}
          onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0.03)' }}
          onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
          title={node.path || '根目录'}
        >
          <button
            onClick={(e) => { e.stopPropagation(); toggle(node.path) }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', color: '#9b8e84', flexShrink: 0 }}
          >
            <ChevronRightIcon style={{ width: 13, height: 13, transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.12s ease' }} />
          </button>
          {isOpen
            ? <FolderOpenIcon style={{ width: 16, height: 16, color: isActive ? '#7c3aed' : '#8b6f47', flexShrink: 0 }} />
            : <FolderIcon style={{ width: 16, height: 16, color: isActive ? '#7c3aed' : '#8b6f47', flexShrink: 0 }} />}
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
          {count !== null && count > 0 && (
            <span style={{ fontSize: 10.5, color: '#b0a89e', flexShrink: 0, fontWeight: 400 }}>{count}</span>
          )}
        </button>
        {isOpen && children}
      </div>
    )
  }

  const rootFiles = data.files.filter(f => !f.folder)

  // 文件行渲染（仅 showFiles 时输出）
  const fileBlock = (folderKey: string, indent: number) => {
    if (!showFiles) return null
    const list = data.files.filter(f => (f.folder || '') === folderKey)
    if (list.length === 0) {
      return folderKey === '' ? null : <div style={{ padding: '5px 10px', fontSize: 11.5, color: '#c0b8ae' }}>（空目录）</div>
    }
    return <div style={{ paddingLeft: indent }}>{list.map(f => renderFileRow(f, 0))}</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, padding: '2px 0' }}>
      {/* 根目录 */}
      {renderDirRow({ path: '', name: '全部文件', level: 0 }, (
        <div>{fileBlock('', 22)}</div>
      ))}

      {/* 一级目录 → 二级目录 → 文件 */}
      {data.dirs.map(d1 => (
        <div key={d1.dir}>
          {renderDirRow({ path: d1.dir, name: d1.dir, level: 1 }, (
            <div>
              {/* 一级目录直属文件 */}
              {fileBlock(d1.dir, 22)}
              {/* 二级子目录 */}
              {d1.subdirs.length > 0 && (
                <div style={{ paddingLeft: 12 }}>
                  {d1.subdirs.map(d2 => (
                    <div key={d2}>
                      {renderDirRow({ path: `${d1.dir}/${d2}`, name: d2, level: 2 }, (
                        <div>{fileBlock(`${d1.dir}/${d2}`, 22)}</div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

export function formatKbSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}
