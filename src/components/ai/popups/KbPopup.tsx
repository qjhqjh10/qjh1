import { useState, useEffect, useCallback } from 'react'
import { kbService } from '@/services/fileService'
import { useStore } from '@/store'
import ScrollArea from '@/components/common/ScrollArea'
import ConfirmModal from '@/components/common/ConfirmModal'
import { SkeletonList } from '@/components/common/Skeleton'
import { KbFolderTree, formatKbSize, type KbTreeData } from '@/components/knowledge/KbFolderTree'
import { MagnifyingGlassIcon, DocumentTextIcon, TrashIcon, ArrowDownTrayIcon, FolderIcon } from '@heroicons/react/24/outline'

interface KbFile {
  id: string
  originalName: string
  type: string
  size: number
  chunkCount: number
  projects: string[]
  source: string
  uploadedAt: string
  folder?: string
}

export function KbPopup() {
  const fileEditNotify = useStore(s => s.fileEditNotify)
  const [files, setFiles] = useState<KbFile[]>([])
  const [dirTree, setDirTree] = useState<KbTreeData>({ dirs: [], files: [] })
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [activeDir, setActiveDir] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ '': true })
  const [fileToDelete, setFileToDelete] = useState<{ id: string; name: string } | null>(null)

  const loadFiles = useCallback(async () => {
    try {
      const meta = await kbService.list() as { files: KbFile[] }
      const list = meta.files || []
      setFiles(list)
      let tree: { dir: string; subdirs: string[] }[] = []
      try { tree = await kbService.listFolders() as { dir: string; subdirs: string[] }[] } catch { tree = [] }
      setDirTree({ dirs: tree, files: list })
    } catch { setFiles([]); setDirTree({ dirs: [], files: [] }) }
  }, [])

  useEffect(() => { loadFiles() }, [loadFiles])

  // Refresh when AI modifies KB files
  useEffect(() => {
    if (fileEditNotify?.filePath?.includes('knowledge_base')) {
      loadFiles()
    }
  }, [fileEditNotify, loadFiles])

  const handleSelectFile = async (fileId: string) => {
    setSelectedFileId(fileId)
    setLoading(true)
    try {
      const result = await kbService.read(fileId)
      setFileContent(result.content || '')
    } catch { setFileContent('(读取失败)') }
    setLoading(false)
  }

  const handleDelete = async (fileId: string, name: string) => {
    setFileToDelete({ id: fileId, name })
  }

  const confirmDelete = async () => {
    if (!fileToDelete) return
    try {
      await kbService.delete(fileToDelete.id)
      if (selectedFileId === fileToDelete.id) { setSelectedFileId(null); setFileContent('') }
      loadFiles()
    } catch { /* delete failed */ }
    setFileToDelete(null)
  }

  const handleDownload = async (fileId: string) => {
    try { await kbService.download(fileId) } catch { /* download failed */ }
  }

  const filteredFiles = files.filter(f => {
    if (search && !f.originalName.toLowerCase().includes(search.toLowerCase())) return false
    if (!search && activeDir && (f.folder || '') !== activeDir) return false
    return true
  })

  return (
    <>
    <div style={{ display: 'flex', height: '100%', gap: 1 }}>
      {/* Left: 三级目录树 + 文件列表 */}
      <div style={{ width: 230, flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: '1px solid rgba(0,0,0,0.06)' }}>
        <div style={{ padding: '8px 10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.08)', background: 'rgba(0,0,0,0.02)' }}>
            <MagnifyingGlassIcon style={{ width: 13, height: 13, color: '#9b8e84', flexShrink: 0 }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索文件..."
              style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 12, color: '#2d2520', width: '100%', fontFamily: 'inherit' }} />
          </div>
        </div>
        <ScrollArea style={{ flex: 1 }}>
          {search ? (
            /* 搜索模式：平铺结果 */
            filteredFiles.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', color: '#9b8e84', fontSize: 12 }}>无匹配文件</div>
            ) : filteredFiles.map(f => (
              <div key={f.id} onClick={() => handleSelectFile(f.id)} style={{
                padding: '7px 10px', cursor: 'pointer', fontSize: 12,
                background: selectedFileId === f.id ? 'rgba(124,58,237,0.06)' : 'transparent',
                borderLeft: selectedFileId === f.id ? '2px solid #7c3aed' : '2px solid transparent',
                color: selectedFileId === f.id ? '#7c3aed' : '#2d2520',
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <DocumentTextIcon style={{ width: 14, height: 14, flexShrink: 0, opacity: 0.5 }} />
                <div style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.originalName}</div>
                <span style={{ fontSize: 10, color: '#9b8e84', flexShrink: 0 }}>{formatKbSize(f.size)}</span>
              </div>
            ))
          ) : (
            /* 目录模式：三级树 */
            files.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', color: '#9b8e84', fontSize: 12 }}>知识库为空</div>
            ) : (
              <KbFolderTree
                data={dirTree}
                activeKey={activeDir}
                activeType={activeDir ? 'dir' : 'root'}
                onSelect={(type, key) => { setActiveDir(type === 'root' ? '' : key) }}
                expanded={expanded}
                onToggleExpand={(p) => setExpanded(prev => ({ ...prev, [p]: !prev[p] }))}
                showCounts={false}
              />
            )
          )}
        </ScrollArea>
      </div>

      {/* Right: content viewer */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {selectedFileId && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderBottom: '1px solid rgba(0,0,0,0.06)', background: 'rgba(0,0,0,0.01)' }}>
            <span style={{ fontSize: 11, color: '#9b8e84', flex: 1 }}>
              {files.find(f => f.id === selectedFileId)?.originalName || ''}
            </span>
            <button onClick={() => handleDownload(selectedFileId)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b5e54', padding: 2, display: 'flex' }} title="下载">
              <ArrowDownTrayIcon style={{ width: 14, height: 14 }} />
            </button>
            <button onClick={() => handleDelete(selectedFileId, files.find(f => f.id === selectedFileId)?.originalName || '')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b5e54', padding: 2, display: 'flex' }} title="删除">
              <TrashIcon style={{ width: 14, height: 14 }} />
            </button>
          </div>
        )}
        <div style={{ flex: 1, overflow: 'auto', padding: selectedFileId ? 10 : 0 }} className="custom-scrollbar">
          {!selectedFileId && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#9b8e84', fontSize: 12 }}>
              选择左侧文件查看内容
            </div>
          )}
          {loading && <div style={{ padding: 20 }}><SkeletonList count={3} /></div>}
          {selectedFileId && !loading && (
            <pre style={{ margin: 0, fontSize: 12, lineHeight: 1.7, color: '#2d2520', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit' }}>
              {fileContent || '(空文件)'}
            </pre>
          )}
        </div>
      </div>
    </div>
    {/* 知识库文件删除确认 */}
    {fileToDelete && (
      <ConfirmModal
        isOpen={true}
        title="删除知识库文件"
        message={`确定要删除「${fileToDelete.name}」？此操作不可恢复。`}
        confirmLabel="删除"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setFileToDelete(null)}
      />
    )}
    </>
  )
}
