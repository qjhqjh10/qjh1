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
  /** v16.4.1(用户决策): 渲染目录行尾部的操作区（重命名/删除——替代原目录操作条） */
  renderDirActions?: (node: KbTreeNode) => React.ReactNode
  /** 显示文件数统计（默认 true） */
  showCounts?: boolean
  /** 展开态（受控，父组件持久化） */
  expanded?: Record<string, boolean>
  onToggleExpand?: (path: string) => void
  /** v16: 是否在目录树内联渲染文件行（默认 true；勾选弹窗左侧纯目录树可设 false） */
  showFiles?: boolean
  /** v16.4.1: 紧凑行（弹窗用小行，默认 true）；知识库页面传 false 用大行（对齐原「文件」列表尺寸） */
  dense?: boolean
  /** v16.4.1: 搜索过滤——文件按名称匹配，搜索时自动展开全部目录；空目录提示隐藏 */
  searchQuery?: string
}

export function KbFolderTree({
  data, activeKey, activeType, onSelect, renderFileActions, renderDirActions, showCounts = true, expanded: expandedProp, onToggleExpand, showFiles = true, dense = true, searchQuery = '',
}: KbFolderTreeProps) {
  const [expandedState, setExpandedState] = useState<Record<string, boolean>>({ '': true })
  const expanded = expandedProp ?? expandedState
  const toggle = onToggleExpand ?? ((path: string) => setExpandedState(prev => ({ ...prev, [path]: !prev[path] })))

  const q = searchQuery.trim().toLowerCase()
  const searching = q.length > 0
  const matches = (name: string) => !searching || name.toLowerCase().includes(q)

  const fileCountInDir = (dirPath: string) =>
    data.files.filter(f => matches(f.originalName) && (f.folder === dirPath || f.folder?.startsWith(dirPath + '/'))).length

  // 文件行（根/一级/二级共用；dense=false 时用大行，对齐知识库页面原「文件」列表尺寸）
  const renderFileRow = (f: { id: string; originalName: string; type: string; size: number; folder?: string }, indent: number) => {
    const isActive = activeType === 'file' && activeKey === f.id
    if (dense) {
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
    return (
      <div key={f.id} style={{ display: 'flex', alignItems: 'center', borderRadius: 12, paddingLeft: indent }}>
        <button
          onClick={() => onSelect('file', f.id)}
          style={{
            flex: 1, display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', padding: '9px 12px',
            border: 'none', borderRadius: 12, background: isActive ? 'rgba(124,58,237,0.08)' : 'transparent',
            cursor: 'pointer', fontFamily: 'inherit', minWidth: 0, transition: 'background 0.1s ease',
          }}
        >
          <div style={{
            width: 30, height: 30, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            background: isActive ? 'rgba(124,58,237,0.12)' : 'rgba(0,0,0,0.04)',
          }}>
            <DocumentTextIcon style={{ width: 15, height: 15, color: isActive ? '#7c3aed' : '#8b7f73', flexShrink: 0 }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 13.5, fontWeight: 600, color: isActive ? '#7c3aed' : '#2d2520',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{f.originalName}</div>
            <div style={{ display: 'flex', gap: 10, marginTop: 3, fontSize: 11, color: '#9b8e84' }}>
              <span style={{ background: 'rgba(0,0,0,0.04)', padding: '1px 6px', borderRadius: 4, fontWeight: 600 }}>{f.type.toUpperCase()}</span>
              <span>{formatKbSize(f.size)}</span>
            </div>
          </div>
        </button>
        {renderFileActions?.(f)}
      </div>
    )
  }

  const renderDirRow = (node: KbTreeNode, children?: React.ReactNode) => {
    // v16.4.1: 搜索时强制展开全部目录（匹配文件散落在折叠目录内也要可见）
    const isOpen = searching || expanded[node.path]
    const isActive = activeType === 'dir' && activeKey === node.path
    const count = showCounts ? fileCountInDir(node.path) : null
    return (
      <div key={node.path || 'root'}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <button
            onClick={() => onSelect('dir', node.path)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left',
              padding: `${node.level === 0 ? 9 : 7}px 10px`, borderRadius: 10, border: 'none',
              background: isActive ? 'rgba(124,58,237,0.10)' : 'transparent',
              color: isActive ? '#7c3aed' : '#3d342e', fontWeight: isActive ? 600 : 500,
              cursor: 'pointer', fontSize: node.level === 0 ? 13.5 : 12.5, fontFamily: 'inherit',
              transition: 'background 0.1s ease', flex: 1, minWidth: 0,
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
          {/* v16.4.1(用户决策): 目录行尾部操作（重命名/删除）——替代选中目录后的操作条 */}
          {renderDirActions?.(node)}
        </div>
        {isOpen && children}
      </div>
    )
  }

  const rootFiles = data.files.filter(f => !f.folder)

  // 文件行渲染（仅 showFiles 时输出；搜索时按名称过滤）
  const fileBlock = (folderKey: string, indent: number) => {
    if (!showFiles) return null
    const list = data.files.filter(f => (f.folder || '') === folderKey && matches(f.originalName))
    if (list.length === 0) {
      // v16.4.1: 搜索时无匹配不显示「空目录」（目录可能只是没命中，并非真空）
      return folderKey === '' || searching ? null : <div style={{ padding: '5px 10px', fontSize: 11.5, color: '#c0b8ae' }}>（空目录）</div>
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
