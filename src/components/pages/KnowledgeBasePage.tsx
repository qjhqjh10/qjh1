import { useEffect, useState, useCallback, useRef } from 'react'
import { useStore, useSettingsStore } from '@/store'
import { kbService } from '@/services/fileService'
import { countChineseWords } from '@/utils/textUtils'
import Button from '@/components/common/Button'
import Modal from '@/components/common/Modal'
import ConfirmModal from '@/components/common/ConfirmModal'
import ScrollArea from '@/components/common/ScrollArea'
import { KbFolderTree, formatKbSize as formatSize, type KbTreeData } from '@/components/knowledge/KbFolderTree'
import {
  DocumentTextIcon,
  DocumentArrowUpIcon,
  DocumentArrowDownIcon,
  DocumentDuplicateIcon,
  TrashIcon,
  MagnifyingGlassIcon,
  ArrowPathIcon,
  FolderPlusIcon,
  FolderIcon,
  PencilIcon,
  ArrowRightIcon,
} from '@heroicons/react/24/outline'
import type { KnowledgeFile } from '@/types/knowledge'
import { logError } from '@/utils/logger'

// ── 主题色（与全局紫色主题一致）──
const C = {
  primary: '#7c3aed',
  primarySoft: 'rgba(124,58,237,0.08)',
  text: '#2d2520',
  textSec: '#6b5e54',
  muted: '#9b8e84',
  line: 'rgba(0,0,0,0.06)',
  bg: 'rgba(255,255,255,0.6)',
}

export default function KnowledgeBasePage() {
  const activeProjectId = useStore(s => s.activeProjectId)
  const projects = useStore(s => s.projects)
  const fileEditNotify = useStore(s => s.fileEditNotify)
  const activeConfigId = useSettingsStore(s => s.activeConfigId)
  const configs = useSettingsStore(s => s.configs)

  const [files, setFiles] = useState<KnowledgeFile[]>([])
  const [dirTree, setDirTree] = useState<KbTreeData>({ dirs: [], files: [] })
  const [selectedFile, setSelectedFile] = useState<KnowledgeFile | null>(null)
  const [fileContent, setFileContent] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [indexing, setIndexing] = useState<string | null>(null)

  // 三级目录选中态
  const [activeType, setActiveType] = useState<'root' | 'dir' | 'file'>('root')  // 当前激活节点类型
  const [activeDir, setActiveDir] = useState('')  // '' = 根目录；'一级' / '一级/二级'
  // v16.4.1(用户需求): 左侧只留目录树（树内即文件，大小对齐原「文件」列表）——filterFolder 死逻辑移除
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ '': true })

  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'single'; file: KnowledgeFile } | null>(null)
  const [folderToDelete, setFolderToDelete] = useState<{ folder: string; name: string } | null>(null)
  const [showNewFile, setShowNewFile] = useState(false)
  const [newFileName, setNewFileName] = useState('')
  const [newFileContent, setNewFileContent] = useState('')
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [folderRename, setFolderRename] = useState<{ folder: string; name: string } | null>(null)
  const [folderRenameValue, setFolderRenameValue] = useState('')
  // v16.4.1(任务2): 多选/批量操作——支持批量移动/删除/复制
  const [multiSelectMode, setMultiSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [movingFiles, setMovingFiles] = useState<KnowledgeFile[] | null>(null)
  const [moveTarget, setMoveTarget] = useState('')
  const [batchDeleteConfirm, setBatchDeleteConfirm] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  // Estimate dialog
  const [showEstimate, setShowEstimate] = useState(false)
  const [estimatedFiles, setEstimatedFiles] = useState<{ path: string; name: string; size: number; type: string; chunkCount: number }[]>([])
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const activeConfig = configs.find(c => c.id === activeConfigId)

  const notify = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2200)
  }, [])

  const loadFiles = useCallback(async () => {
    const meta = await kbService.list()
    const list = meta.files || []
    setFiles(list)
    // 目录树数据
    let tree: { dir: string; subdirs: string[] }[] = []
    try { tree = await kbService.listFolders() as { dir: string; subdirs: string[] }[] } catch { tree = [] }
    setDirTree({
      dirs: tree,
      files: list.map(f => ({ id: f.id, originalName: f.originalName, type: f.type, size: f.size, folder: f.folder })),
    })
  }, [])

  useEffect(() => { loadFiles() }, [loadFiles])

  // Reload file list when AI modifies KB files
  useEffect(() => {
    if (fileEditNotify?.filePath?.includes('knowledge_base')) {
      loadFiles()
    }
  }, [fileEditNotify, loadFiles])

  // ── 目录/文件选择 ──
  const handleSelect = useCallback(async (type: 'root' | 'dir' | 'file', key: string) => {
    if (type === 'root') { setActiveType('root'); setActiveDir(''); return }
    if (type === 'dir') { setActiveType('dir'); setActiveDir(key); return }
    // 文件选中 → 读取内容
    setActiveType('file')
    const f = files.find(x => x.id === key)
    if (!f) return
    setSelectedFile(f)
    try {
      const result = await kbService.read(f.id)
      setFileContent(result.content)
    } catch (e) {
      logError('读取知识库文件内容失败', e)
      setFileContent('')
    }
  }, [files])

  const handleUpload = async () => {
    // Step 1: Open file dialog
    const filePaths = await kbService.selectFiles() as string[]
    if (!filePaths || filePaths.length === 0) return

    // Step 2: Estimate each file
    setLoading(true)
    const estimates: { path: string; name: string; size: number; type: string; chunkCount: number }[] = []
    for (const fp of filePaths) {
      try {
        const est = await kbService.estimate(fp) as { name: string; size: number; type: string; chunkCount: number }
        estimates.push({ path: fp, ...est })
      } catch (e) { logError('预估文件 chunk 失败', e) }
    }
    setLoading(false)

    if (estimates.length === 0) return
    setEstimatedFiles(estimates)
    setShowEstimate(true)
  }

  const handleConfirmUpload = async () => {
    setShowEstimate(false)
    setLoading(true)
    try {
      const paths = estimatedFiles.map(e => e.path)
      // v16: 上传到当前选中目录（activeDir：'' = 根，'一级' / '一级/二级'）
      await kbService.uploadFiles(paths, activeProjectId || '__unassigned__', activeDir || undefined)
      await loadFiles()
      notify(`已上传 ${paths.length} 个文件到${activeDir ? `「${activeDir}」` : '根目录'}`)
    } catch (err) {
      logError('Upload failed', err)
      alert(err instanceof Error ? err.message : '上传失败')
    }
    setLoading(false)
    setEstimatedFiles([])
  }

  const handleDelete = async (file: KnowledgeFile) => {
    await kbService.delete(file.id)
    if (selectedFile?.id === file.id) {
      setSelectedFile(null)
      setFileContent('')
    }
    await loadFiles()
    notify('文件已删除')
  }

  const handleSave = async () => {
    if (!selectedFile || selectedFile.type === 'pdf' || selectedFile.type === 'docx') return
    await kbService.write(selectedFile.id, fileContent)
    await loadFiles()
    notify('保存成功')
  }

  const handleReindex = async (file: KnowledgeFile) => {
    if (!activeConfig) return
    setIndexing(file.id)
    try {
      const result = await kbService.index(file.id, activeConfig.id) as { chunkCount: number }
      notify(`索引完成，共 ${result.chunkCount} 个片段`)
      await loadFiles()
    } catch (err) {
      logError('Indexing failed', err)
      alert('索引失败，请检查 Embedding 模型配置')
    }
    setIndexing(null)
  }

  // v16.4.1(用户决策): 文件与项目已解绑（v16.3.0）——toggleProject/所属项目 UI 整体移除

  // ── 目录操作 ──
  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return
    try {
      // 在当前选中目录下新建：根下建一级；一级下建二级
      const parts = activeDir.split('/').filter(Boolean)
      if (parts.length >= 2) {
        notify('已达三级目录上限（根 + 两级子目录）')
        setShowNewFolder(false)
        return
      }
      await kbService.createFolder(newFolderName.trim(), parts.length === 1 ? parts[0] : '')
      setShowNewFolder(false)
      setNewFolderName('')
      setExpanded(prev => ({ ...prev, [activeDir]: true }))
      await loadFiles()
      notify('文件夹已创建')
    } catch (err) {
      alert(err instanceof Error ? err.message : '创建文件夹失败')
    }
  }

  const handleRenameFolder = async () => {
    if (!folderRename || !folderRenameValue.trim()) return
    try {
      await kbService.renameFolder(folderRename.folder, folderRenameValue.trim())
      // 当前选中目录若被重命名 → 跟随
      if (activeDir === folderRename.folder) {
        setActiveDir(folderRenameValue.trim())
      } else if (activeDir.startsWith(folderRename.folder + '/')) {
        const newPath = folderRenameValue.trim() + activeDir.slice(folderRename.folder.length)
        setActiveDir(newPath)
      }
      setFolderRename(null)
      await loadFiles()
      notify('文件夹已重命名')
    } catch (err) {
      alert(err instanceof Error ? err.message : '重命名失败')
    }
  }

  // v16.4.1(任务4 修复): 支持非空目录递归删除（主进程返回删除文件数）
  const handleDeleteFolder = async () => {
    if (!folderToDelete) return
    try {
      const result = await kbService.deleteFolder(folderToDelete.folder) as { deleted: number }
      setFolderToDelete(null)
      if (activeDir === folderToDelete.folder) { setActiveDir('') }
      // 若当前打开的文件在删除目录内 → 清空详情
      if (selectedFile && (selectedFile.folder === folderToDelete.folder || selectedFile.folder?.startsWith(folderToDelete.folder + '/'))) {
        setSelectedFile(null)
        setFileContent('')
      }
      await loadFiles()
      notify(`文件夹已删除${result?.deleted ? `（含 ${result.deleted} 个文件）` : ''}`)
    } catch (err) {
      alert(err instanceof Error ? err.message : '删除失败')
    }
  }

  // v16.4.1(任务2): 批量移动（循环 moveFile）
  const handleMoveFiles = async () => {
    if (!movingFiles || movingFiles.length === 0) return
    try {
      for (const f of movingFiles) {
        await kbService.moveFile(f.id, moveTarget)
      }
      setMovingFiles(null)
      setMoveTarget('')
      await loadFiles()
      setSelectedIds(new Set())
      notify(`已移动 ${movingFiles.length} 个文件到${moveTarget ? `「${moveTarget}」` : '根目录'}`)
    } catch (err) {
      alert(err instanceof Error ? err.message : '移动失败')
    }
  }

  // v16.4.1(任务2): 批量复制（复制到各自当前目录）
  const handleBatchCopy = async () => {
    if (selectedIds.size === 0) return
    try {
      const targets = files.filter(f => selectedIds.has(f.id))
      for (const f of targets) {
        await kbService.copyFile(f.id, f.folder || '')
      }
      await loadFiles()
      notify(`已复制 ${targets.length} 个文件（副本）`)
    } catch (err) {
      alert(err instanceof Error ? err.message : '复制失败')
    }
  }

  // v16.4.1(任务2): 批量删除
  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return
    try {
      for (const id of selectedIds) {
        await kbService.delete(id)
      }
      setBatchDeleteConfirm(false)
      setSelectedIds(new Set())
      setMultiSelectMode(false)
      if (selectedFile && selectedIds.has(selectedFile.id)) {
        setSelectedFile(null)
        setFileContent('')
      }
      await loadFiles()
      notify('已删除所选文件')
    } catch (err) {
      alert(err instanceof Error ? err.message : '删除失败')
    }
  }

  // 多选切换
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // v16.4.1: 搜索过滤移入 KbFolderTree（树内文件按名称匹配）——原「文件」列表及其过滤逻辑删除

  const isEditable = selectedFile && (selectedFile.type === 'txt' || selectedFile.type === 'md')
  const isIndexable = selectedFile && selectedFile.type !== 'pdf' && selectedFile.type !== 'docx'

  // 目录路径面包屑
  const crumbs = activeDir ? activeDir.split('/') : []

  return (
    <>
    <div className="page-enter" style={{ flex: 1, overflow: 'hidden', display: 'flex', background: '#faf9f7' }}>
      {/* ═══ 左栏：目录树 + 文件列表 ═══ */}
      <div style={{
        width: 340, minWidth: 300, borderRight: '1px solid rgba(0,0,0,0.07)',
        display: 'flex', flexDirection: 'column', background: '#fff',
      }}>
        {/* 头部：标题 + 搜索 */}
        <div style={{ padding: '20px 18px 14px', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: C.primarySoft, color: C.primary,
            }}>
              <DocumentTextIcon style={{ width: 18, height: 18 }} />
            </div>
            <div>
              <h2 style={{ fontSize: 17, fontWeight: 700, color: C.text, lineHeight: 1.2 }}>知识库</h2>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>共 {files.length} 个文件 · 三级目录</div>
            </div>
          </div>
          <div style={{ position: 'relative' }}>
            <MagnifyingGlassIcon style={{ position: 'absolute', left: 12, top: 9, width: 15, height: 15, color: '#9b8e84' }} />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="搜索文件..."
              style={{
                width: '100%', padding: '9px 12px 9px 34px', borderRadius: 12,
                border: '1px solid rgba(0,0,0,0.08)', outline: 'none', fontSize: 13,
                background: '#f7f5f2', color: C.text, fontFamily: 'inherit',
                transition: 'border-color 0.15s ease, background 0.15s ease',
              }}
              onFocus={e => { e.currentTarget.style.borderColor = 'rgba(124,58,237,0.45)'; e.currentTarget.style.background = '#fff' }}
              onBlur={e => { e.currentTarget.style.borderColor = 'rgba(0,0,0,0.08)'; e.currentTarget.style.background = '#f7f5f2' }}
            />
          </div>
        </div>

        {/* 目录树 + 文件列表（双区滚动） */}
        <ScrollArea maxHeight="100%" style={{ flex: 1, padding: '10px 12px' }}>
          {/* 三级目录树 */}
          <div style={{ marginBottom: 10 }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '0 4px 6px', fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: '0.5px',
            }}>
              <span>📂 目录</span>
              <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                {/* v16.4.1(任务2): 多选模式开关 */}
                <button onClick={() => { setMultiSelectMode(v => !v); setSelectedIds(new Set()) }} title={multiSelectMode ? '退出多选模式' : '多选模式（批量移动/复制/删除）'}
                  style={{
                    background: multiSelectMode ? 'rgba(124,58,237,0.1)' : 'none',
                    border: multiSelectMode ? '1px solid rgba(124,58,237,0.3)' : '1px solid rgba(0,0,0,0.08)',
                    cursor: 'pointer', color: multiSelectMode ? '#7c3aed' : '#6b5e54', padding: '2px 8px',
                    borderRadius: 6, fontSize: 11, fontWeight: multiSelectMode ? 700 : 500, fontFamily: 'inherit',
                  }}>
                  {multiSelectMode ? '退出多选' : '多选'}
                </button>
                <button onClick={() => setShowNewFolder(true)} title="新建文件夹"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.primary, padding: 2, display: 'flex' }}>
                  <FolderPlusIcon style={{ width: 15, height: 15 }} />
                </button>
              </div>
            </div>
            {/* v16.4.1(用户需求): 目录行尾部操作（重命名/删除）——替代原"目录操作条"（重复显示） */}
            <KbFolderTree
              data={dirTree}
              activeKey={activeType === 'file' ? (selectedFile?.id || '') : activeDir}
              activeType={activeType}
              onSelect={handleSelect}
              expanded={expanded}
              onToggleExpand={(p) => setExpanded(prev => ({ ...prev, [p]: !prev[p] }))}
              dense={false}
              searchQuery={searchQuery}
              renderDirActions={(node) => node.path ? (
                <div style={{ display: 'flex', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                  <button
                    onClick={() => setFolderRename({ folder: node.path, name: node.name })}
                    title={`重命名文件夹「${node.name}」`}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '6px 4px', color: '#d4ccc4', borderRadius: 6, display: 'flex' }}
                    onMouseEnter={e => { e.currentTarget.style.color = '#7c3aed'; e.currentTarget.style.background = 'rgba(124,58,237,0.06)' }}
                    onMouseLeave={e => { e.currentTarget.style.color = '#d4ccc4'; e.currentTarget.style.background = 'transparent' }}
                  >
                    <PencilIcon style={{ width: 13, height: 13 }} />
                  </button>
                  <button
                    onClick={() => setFolderToDelete({ folder: node.path, name: node.name })}
                    title={`删除文件夹「${node.name}」`}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '6px 4px', color: '#d4ccc4', borderRadius: 6, display: 'flex' }}
                    onMouseEnter={e => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.background = 'rgba(239,68,68,0.06)' }}
                    onMouseLeave={e => { e.currentTarget.style.color = '#d4ccc4'; e.currentTarget.style.background = 'transparent' }}
                  >
                    <TrashIcon style={{ width: 13, height: 13 }} />
                  </button>
                </div>
              ) : null}
              renderFileActions={(f) => {
                const file = files.find(x => x.id === f.id)
                const isSelected = selectedIds.has(f.id)
                return (
                  <div style={{ display: 'flex', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                    {/* v16.4.1(任务2): 多选模式 → checkbox；普通模式 hover → 操作按钮 */}
                    {multiSelectMode ? (
                      <label style={{ display: 'flex', alignItems: 'center', padding: '8px 10px', cursor: 'pointer' }} title="勾选（批量操作）">
                        <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(f.id)}
                          style={{ width: 14, height: 14, accentColor: '#7c3aed', cursor: 'pointer' }} />
                      </label>
                    ) : (
                      <>
                        <button
                          onClick={() => { if (file) { setFolderRename(null); setFolderRenameValue(''); const newName = prompt('重命名文件:', file.originalName); if (newName && newName.trim() && newName !== file.originalName) { kbService.rename(file.id, newName.trim()).then(loadFiles) } } }}
                          title="重命名"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '8px 7px', color: '#d4ccc4', borderRadius: 8, display: 'flex' }}
                          onMouseEnter={e => { e.currentTarget.style.color = '#7c3aed'; e.currentTarget.style.background = 'rgba(124,58,237,0.06)' }}
                          onMouseLeave={e => { e.currentTarget.style.color = '#d4ccc4'; e.currentTarget.style.background = 'transparent' }}
                        >
                          <PencilIcon style={{ width: 14, height: 14 }} />
                        </button>
                        <button
                          onClick={() => { if (file) setMovingFiles([file]) }}
                          title="移动到其他目录"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '8px 7px', color: '#d4ccc4', borderRadius: 8, display: 'flex' }}
                          onMouseEnter={e => { e.currentTarget.style.color = '#7c3aed'; e.currentTarget.style.background = 'rgba(124,58,237,0.06)' }}
                          onMouseLeave={e => { e.currentTarget.style.color = '#d4ccc4'; e.currentTarget.style.background = 'transparent' }}
                        >
                          <ArrowRightIcon style={{ width: 14, height: 14 }} />
                        </button>
                        <button
                          onClick={async () => { if (file) { try { await kbService.copyFile(file.id, file.folder || ''); await loadFiles(); notify('已复制副本') } catch (err) { alert(err instanceof Error ? err.message : '复制失败') } } }}
                          title="复制副本"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '8px 7px', color: '#d4ccc4', borderRadius: 8, display: 'flex' }}
                          onMouseEnter={e => { e.currentTarget.style.color = '#7c3aed'; e.currentTarget.style.background = 'rgba(124,58,237,0.06)' }}
                          onMouseLeave={e => { e.currentTarget.style.color = '#d4ccc4'; e.currentTarget.style.background = 'transparent' }}
                        >
                          <DocumentDuplicateIcon style={{ width: 14, height: 14 }} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            if (file) setDeleteConfirm({ type: 'single', file })
                          }}
                          title="删除"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '8px 7px', color: '#d4ccc4', borderRadius: 8, display: 'flex' }}
                          onMouseEnter={e => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.background = 'rgba(239,68,68,0.06)' }}
                          onMouseLeave={e => { e.currentTarget.style.color = '#d4ccc4'; e.currentTarget.style.background = 'transparent' }}
                        >
                          <TrashIcon style={{ width: 14, height: 14 }} />
                        </button>
                      </>
                    )}
                  </div>
                )
              }}
            />
            {/* 搜索无匹配提示 */}
            {searchQuery.trim() && dirTree.files.filter(f => f.originalName.toLowerCase().includes(searchQuery.trim().toLowerCase())).length === 0 && (
              <div style={{ textAlign: 'center', padding: 24, color: C.muted, fontSize: 13 }}>未找到匹配文件</div>
            )}
          </div>

            {/* v16.4.1(任务2): 批量操作条——多选模式下选中文件时显示 */}
            {multiSelectMode && selectedIds.size > 0 && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', margin: '2px 0 8px',
                borderRadius: 10, background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.15)', flexWrap: 'wrap',
              }}>
                <span style={{ fontSize: 11.5, color: '#7c3aed', fontWeight: 700, flexShrink: 0 }}>已选 {selectedIds.size} 个</span>
                <button onClick={() => setMovingFiles(files.filter(f => selectedIds.has(f.id)))}
                  style={{ background: 'none', border: '1px solid rgba(124,58,237,0.3)', borderRadius: 6, padding: '2px 9px', fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit', color: '#7c3aed', fontWeight: 600 }}>移动</button>
                <button onClick={handleBatchCopy}
                  style={{ background: 'none', border: '1px solid rgba(124,58,237,0.3)', borderRadius: 6, padding: '2px 9px', fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit', color: '#7c3aed', fontWeight: 600 }}>复制</button>
                <button onClick={() => setBatchDeleteConfirm(true)}
                  style={{ background: 'none', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, padding: '2px 9px', fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit', color: '#ef4444', fontWeight: 600 }}>删除</button>
                <button onClick={() => setSelectedIds(new Set())} title="取消选择"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11.5, color: '#9b8e84', fontFamily: 'inherit', marginLeft: 'auto' }}>取消选择</button>
              </div>
            )}

        </ScrollArea>

        {/* 底部操作区 */}
        <div style={{ padding: '12px 14px', borderTop: '1px solid rgba(0,0,0,0.06)', display: 'flex', gap: 6 }}>
          <Button size="sm" onClick={handleUpload} disabled={loading} icon={<DocumentArrowUpIcon style={{ width: 14, height: 14 }} />}>
            {loading ? '处理中...' : '上传文件'}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => { setShowNewFile(true); setNewFileName(''); setNewFileContent('') }} icon={<DocumentTextIcon style={{ width: 14, height: 14 }} />}>
            新建文件
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setShowNewFolder(true)} icon={<FolderPlusIcon style={{ width: 14, height: 14 }} />}>
            新文件夹
          </Button>
        </div>
      </div>

      {/* ═══ 右栏：文件详情 ═══ */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#faf9f7' }}>
        {selectedFile ? (
          <>
            {/* 面包屑导航 */}
            <div style={{ padding: '14px 24px 0', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: C.muted }}>
              <button onClick={() => { setActiveDir('') }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.primary, fontSize: 12, fontFamily: 'inherit', fontWeight: 600 }}>知识库</button>
              {crumbs.length > 0 && crumbs.map((c, i) => {
                const path = crumbs.slice(0, i + 1).join('/')
                return (
                  <span key={path} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <ArrowRightIcon style={{ width: 10, height: 10, color: '#d0c8be' }} />
                    <button onClick={() => { setActiveDir(path) }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: i === crumbs.length - 1 ? C.text : C.primary, fontSize: 12, fontFamily: 'inherit', fontWeight: i === crumbs.length - 1 ? 600 : 400 }}>
                      {c}
                    </button>
                  </span>
                )
              })}
              <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                {selectedFile.folder && (
                  <span style={{ background: C.primarySoft, color: C.primary, padding: '2px 8px', borderRadius: 6, fontWeight: 600 }}>
                    📂 {selectedFile.folder}
                  </span>
                )}
              </span>
            </div>

            {/* File info header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '14px 24px 16px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 42, height: 42, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: C.primarySoft, color: C.primary, flexShrink: 0,
                }}>
                  <DocumentTextIcon style={{ width: 22, height: 22 }} />
                </div>
                <div>
                  <h3 style={{ fontSize: 17, fontWeight: 700, color: C.text }}
                    onDoubleClick={async () => {
                      const newName = prompt('重命名文件:', selectedFile.originalName)
                      if (newName && newName.trim() && newName !== selectedFile.originalName) {
                        await kbService.rename(selectedFile.id, newName.trim())
                        loadFiles()
                      }
                    }}
                    title="双击重命名"
                  >{selectedFile.originalName}</h3>
                  <div style={{ display: 'flex', gap: 12, marginTop: 4, fontSize: 12, color: C.muted, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{ background: 'rgba(0,0,0,0.04)', padding: '1px 7px', borderRadius: 4, fontWeight: 600 }}>{selectedFile.type.toUpperCase()}</span>
                    <span>{formatSize(selectedFile.size)}</span>
                    {fileContent && <span>{countChineseWords(fileContent).toLocaleString()} 字</span>}
                    <span>{selectedFile.chunkCount} 个片段</span>
                    {selectedFile.chunkCount > 0 && <span style={{ color: indexStateColor(selectedFile) }}>{indexStateLabel(selectedFile)}</span>}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <Button size="sm" variant="secondary" onClick={() => setMovingFiles([selectedFile])} icon={<ArrowRightIcon style={{ width: 14, height: 14 }} />}>
                  移动
                </Button>
                {isIndexable && (
                  <Button size="sm" variant="secondary" onClick={() => handleReindex(selectedFile)} disabled={indexing === selectedFile.id || !activeConfig} icon={<ArrowPathIcon style={{ width: 14, height: 14 }} />}>
                    {indexing === selectedFile.id ? '索引中...' : '重新索引'}
                  </Button>
                )}
                {isEditable && (
                  <Button size="sm" onClick={handleSave}>保存修改</Button>
                )}
                <Button size="sm" variant="secondary" onClick={async () => { await kbService.download(selectedFile.id) }} icon={<DocumentArrowDownIcon style={{ width: 14, height: 14 }} />}>
                  下载
                </Button>
              </div>
            </div>

            {/* File content */}
            <div style={{ flex: 1, overflow: 'hidden', padding: 16 }}>
              <div className="custom-scrollbar" style={{ height: '100%', overflowY: 'auto' }}>
                {isEditable ? (
                  <textarea
                    value={fileContent}
                    onChange={e => setFileContent(e.target.value)}
                    style={{
                      width: '100%', height: '100%', minHeight: 400,
                      border: '1px solid rgba(0,0,0,0.06)', borderRadius: 14, outline: 'none',
                      resize: 'none', fontSize: 14.5, lineHeight: 1.8, fontFamily: 'inherit',
                      color: C.text, background: '#fff', padding: 20,
                    }}
                    placeholder="文件内容..."
                  />
                ) : (
                  <div style={{
                    padding: 20, borderRadius: 14, background: '#fff',
                    border: '1px solid rgba(0,0,0,0.06)', minHeight: 400,
                    fontSize: 14.5, lineHeight: 1.8, color: '#4a3f38', whiteSpace: 'pre-wrap',
                  }}>
                    {fileContent || '无法预览此文件类型，请下载后查看'}
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, fontSize: 14 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{
                width: 72, height: 72, borderRadius: 20, margin: '0 auto 16px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(124,58,237,0.06)', color: 'rgba(124,58,237,0.4)',
              }}>
                <DocumentTextIcon style={{ width: 36, height: 36 }} />
              </div>
              <p style={{ fontWeight: 600, color: C.textSec }}>选择一个文件查看详情</p>
              <p style={{ fontSize: 13, marginTop: 6 }}>或点击"上传文件"添加参考资料</p>
            </div>
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 200,
          background: '#2d2520', color: '#fff', padding: '10px 18px', borderRadius: 12,
          fontSize: 13, boxShadow: '0 8px 24px rgba(0,0,0,0.2)', pointerEvents: 'none',
        }}>
          {toast}
        </div>
      )}

      {/* Upload Estimate Modal */}
      <Modal isOpen={showEstimate} onClose={() => { setShowEstimate(false); setEstimatedFiles([]) }} title="上传文件预估" width={560}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p style={{ fontSize: 13.5, color: '#6b5e54' }}>
            即将上传 {estimatedFiles.length} 个文件到{activeDir ? `「${activeDir}」` : '根目录'}，预估信息如下：
          </p>
          <div className="custom-scrollbar" style={{ maxHeight: 280, overflowY: 'auto' }}>
            {estimatedFiles.map((f, i) => (
              <div key={i} style={{
                padding: 12, borderRadius: 10, background: '#faf9f8',
                border: '1px solid rgba(0,0,0,0.04)', marginBottom: 8,
              }}>
                <div style={{ fontWeight: 600, fontSize: 13.5, color: '#2d2520', marginBottom: 4 }}>{f.name}</div>
                <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#9b8e84' }}>
                  <span>{f.type.toUpperCase()}</span>
                  <span>{formatSize(f.size)}</span>
                  <span>约 {f.chunkCount} 个片段</span>
                  <span style={{ color: '#7c3aed' }}>≈ {f.chunkCount} 次 API 调用</span>
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8, borderTop: '1px solid #f0ece8' }}>
            <Button variant="secondary" onClick={() => { setShowEstimate(false); setEstimatedFiles([]) }}>取消</Button>
            <Button onClick={handleConfirmUpload}>确认上传</Button>
          </div>
        </div>
      </Modal>

      {/* New file modal */}
      <Modal isOpen={showNewFile} onClose={() => setShowNewFile(false)} title="新建知识库文件" width={560}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{
            padding: '10px 14px', borderRadius: 10, background: C.primarySoft, fontSize: 13, color: C.primary,
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <FolderIcon style={{ width: 14, height: 14 }} />
            创建到：{activeDir ? `「${activeDir}」` : '根目录'}
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#6b5e54', marginBottom: 6 }}>文件名</div>
            <input value={newFileName} onChange={e => setNewFileName(e.target.value)}
              placeholder="例如：世界观设定参考.md"
              style={{ width: '100%', padding: '11px 12px', borderRadius: 10, border: '1px solid #e5e0da', outline: 'none', fontSize: 14, fontFamily: 'inherit', color: '#2d2520', background: '#faf9f8' }}
              autoFocus
            />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#6b5e54', marginBottom: 6 }}>内容（可选）</div>
            <textarea value={newFileContent} onChange={e => setNewFileContent(e.target.value)}
              placeholder="输入文件内容..."
              style={{ width: '100%', padding: 12, borderRadius: 10, border: '1px solid #e5e0da', outline: 'none', resize: 'vertical', fontSize: 14, lineHeight: 1.8, fontFamily: 'inherit', color: '#2d2520', background: '#faf9f8', minHeight: 200 }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8, borderTop: '1px solid #f0ece8' }}>
            <Button variant="secondary" onClick={() => setShowNewFile(false)}>取消</Button>
            <Button onClick={async () => {
              if (!newFileName.trim()) return
              setShowNewFile(false)
              setLoading(true)
              try {
                await kbService.create(newFileName.trim(), newFileContent, activeProjectId || undefined, activeDir || undefined)
                await loadFiles()
                notify('文件已创建')
              } catch (err) { logError('创建文件失败', err); alert('创建文件失败') }
              setLoading(false)
            }} disabled={!newFileName.trim()}>创建</Button>
          </div>
        </div>
      </Modal>

      {/* New folder modal */}
      <Modal isOpen={showNewFolder} onClose={() => setShowNewFolder(false)} title="新建文件夹" width={420}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{
            padding: '10px 14px', borderRadius: 10, background: C.primarySoft, fontSize: 13, color: C.primary,
          }}>
            {activeDir
              ? `在「${activeDir}」下新建${activeDir.includes('/') ? '' : '（最多两级子目录）'}`
              : '在根目录下新建一级子目录（可再建二级）'}
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#6b5e54', marginBottom: 6 }}>文件夹名</div>
            <input value={newFolderName} onChange={e => setNewFolderName(e.target.value)}
              placeholder="例如：世界观设定"
              style={{ width: '100%', padding: '11px 12px', borderRadius: 10, border: '1px solid #e5e0da', outline: 'none', fontSize: 14, fontFamily: 'inherit', color: '#2d2520', background: '#faf9f8' }}
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') handleCreateFolder() }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8, borderTop: '1px solid #f0ece8' }}>
            <Button variant="secondary" onClick={() => setShowNewFolder(false)}>取消</Button>
            <Button onClick={handleCreateFolder} disabled={!newFolderName.trim()}>创建</Button>
          </div>
        </div>
      </Modal>

      {/* Rename folder modal */}
      <Modal isOpen={folderRename !== null} onClose={() => setFolderRename(null)} title="重命名文件夹" width={420}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#6b5e54', marginBottom: 6 }}>新名称（原：{folderRename?.name}）</div>
            <input value={folderRenameValue} onChange={e => setFolderRenameValue(e.target.value)}
              placeholder="新文件夹名"
              style={{ width: '100%', padding: '11px 12px', borderRadius: 10, border: '1px solid #e5e0da', outline: 'none', fontSize: 14, fontFamily: 'inherit', color: '#2d2520', background: '#faf9f8' }}
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') handleRenameFolder() }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8, borderTop: '1px solid #f0ece8' }}>
            <Button variant="secondary" onClick={() => setFolderRename(null)}>取消</Button>
            <Button onClick={handleRenameFolder} disabled={!folderRenameValue.trim()}>重命名</Button>
          </div>
        </div>
      </Modal>

      {/* Move file modal（v16.4.1: 支持批量移动） */}
      <Modal isOpen={movingFiles !== null} onClose={() => { setMovingFiles(null); setMoveTarget('') }} title={`移动${(movingFiles?.length || 1) > 1 ? `${movingFiles?.length} 个文件` : '文件'}到目录`} width={480}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p style={{ fontSize: 13.5, color: '#6b5e54' }}>
            {(movingFiles?.length || 1) > 1
              ? `将 ${movingFiles?.length} 个文件移动到：`
              : `将「${movingFiles?.[0]?.originalName || ''}」移动到：`}
          </p>
          <div className="custom-scrollbar" style={{ maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <button
              onClick={() => setMoveTarget('')}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 10, border: 'none', cursor: 'pointer',
                background: moveTarget === '' ? C.primarySoft : 'transparent', fontFamily: 'inherit', fontSize: 13.5,
                color: moveTarget === '' ? C.primary : C.text, fontWeight: moveTarget === '' ? 600 : 400, textAlign: 'left',
              }}
            >
              <FolderIcon style={{ width: 16, height: 16, color: '#8b6f47' }} />
              根目录
              {moveTarget === '' && <span style={{ marginLeft: 'auto' }}>✓</span>}
            </button>
            {dirTree.dirs.map(d => (
              <div key={d.dir}>
                <button
                  onClick={() => setMoveTarget(d.dir)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 10, border: 'none', cursor: 'pointer',
                    background: moveTarget === d.dir ? C.primarySoft : 'transparent', fontFamily: 'inherit', fontSize: 13.5,
                    color: moveTarget === d.dir ? C.primary : C.text, fontWeight: moveTarget === d.dir ? 600 : 400, textAlign: 'left', width: '100%',
                  }}
                >
                  <FolderIcon style={{ width: 16, height: 16, color: '#8b6f47' }} />
                  {d.dir}
                  {moveTarget === d.dir && <span style={{ marginLeft: 'auto' }}>✓</span>}
                </button>
                {d.subdirs.map(s => (
                  <button
                    key={s}
                    onClick={() => setMoveTarget(`${d.dir}/${s}`)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 10, border: 'none', cursor: 'pointer',
                      background: moveTarget === `${d.dir}/${s}` ? C.primarySoft : 'transparent', fontFamily: 'inherit', fontSize: 13,
                      color: moveTarget === `${d.dir}/${s}` ? C.primary : C.textSec, fontWeight: moveTarget === `${d.dir}/${s}` ? 600 : 400, textAlign: 'left', width: '100%',
                      paddingLeft: 36,
                    }}
                  >
                    <ArrowRightIcon style={{ width: 12, height: 12, color: '#b0a89e' }} />
                    {s}
                    {moveTarget === `${d.dir}/${s}` && <span style={{ marginLeft: 'auto' }}>✓</span>}
                  </button>
                ))}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8, borderTop: '1px solid #f0ece8' }}>
            <Button variant="secondary" onClick={() => setMovingFiles(null)}>取消</Button>
            <Button onClick={handleMoveFiles}>移动</Button>
          </div>
        </div>
      </Modal>

      {/* 批量删除确认（v16.4.1） */}
      <ConfirmModal
        isOpen={batchDeleteConfirm}
        title="批量删除文件"
        message={`确定删除选中的 ${selectedIds.size} 个文件？此操作不可恢复。`}
        confirmLabel="删除"
        danger
        onConfirm={handleBatchDelete}
        onCancel={() => setBatchDeleteConfirm(false)}
      />

      <ConfirmModal
        isOpen={deleteConfirm !== null}
        title="删除知识库文件"
        message={`确定删除「${deleteConfirm?.file?.originalName || ''}」？`}
        confirmLabel="删除"
        danger
        onConfirm={async () => {
          if (!deleteConfirm) return
          await kbService.delete(deleteConfirm.file.id).catch(() => {})
          if (selectedFile?.id === deleteConfirm.file.id) { setSelectedFile(null); setFileContent('') }
          setDeleteConfirm(null)
          await loadFiles()
        }}
        onCancel={() => setDeleteConfirm(null)}
      />
      <ConfirmModal
        isOpen={folderToDelete !== null}
        title="删除文件夹"
        message={`确定删除文件夹「${folderToDelete?.name || ''}」？${folderToDelete?.folder ? `（将删除该文件夹内的全部文件，不可恢复）` : ''}`}
        confirmLabel="删除"
        danger
        onConfirm={handleDeleteFolder}
        onCancel={() => setFolderToDelete(null)}
      />
    </div>
    </>
  )
}

function indexStateLabel(file: { chunkCount: number }): string {
  // 调用点仅在 chunkCount > 0 时渲染（未索引不显示标签）
  return '已索引'
}

function indexStateColor(file: { chunkCount: number }): string {
  return file.chunkCount === 0 ? '#9b8e84' : '#16a34a'
}
