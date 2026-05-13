import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore, useSettingsStore } from '@/store'
import { kbService } from '@/services/fileService'
import { countChineseWords } from '@/utils/textUtils'
import Button from '@/components/common/Button'
import Modal from '@/components/common/Modal'
import ScrollArea from '@/components/common/ScrollArea'
import {
  DocumentTextIcon,
  DocumentArrowUpIcon,
  DocumentArrowDownIcon,
  TrashIcon,
  MagnifyingGlassIcon,
  ArrowPathIcon,
  TagIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import type { KnowledgeFile } from '@/types/knowledge'
import { logError } from '@/utils/logger'

export default function KnowledgeBasePage() {
  const navigate = useNavigate()
  const activeProjectId = useStore(s => s.activeProjectId)
  const projects = useStore(s => s.projects)
  const activeConfigId = useSettingsStore(s => s.activeConfigId)
  const configs = useSettingsStore(s => s.configs)

  const [files, setFiles] = useState<KnowledgeFile[]>([])
  const [selectedFile, setSelectedFile] = useState<KnowledgeFile | null>(null)
  const [fileContent, setFileContent] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [kbTab, setKbTab] = useState<'upload' | 'project'>('upload')
  const [loading, setLoading] = useState(false)
  const [indexing, setIndexing] = useState<string | null>(null)

  // Collapse & multi-select
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set())
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set())

  // Estimate dialog
  const [showEstimate, setShowEstimate] = useState(false)
  const [estimatedFiles, setEstimatedFiles] = useState<{ path: string; name: string; size: number; type: string; chunkCount: number }[]>([])

  const activeConfig = configs.find(c => c.id === activeConfigId)

  useEffect(() => {
    loadFiles()
  }, [])

  const loadFiles = async () => {
    const meta = await kbService.list() as { files: KnowledgeFile[] }
    setFiles(meta.files || [])
  }

  const handleSelectFile = async (file: KnowledgeFile) => {
    setSelectedFile(file)
    try {
      const result = await kbService.read(file.id) as { file: KnowledgeFile; content: string }
      setFileContent(result.content)
    } catch (e) {
      logError('读取知识库文件内容失败', e)
      setFileContent('')
    }
  }

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
      await kbService.uploadFiles(paths, activeProjectId || '__unassigned__')
      await loadFiles()
    } catch (err) {
      console.error('Upload failed:', err)
      alert(err instanceof Error ? err.message : '上传失败')
    }
    setLoading(false)
    setEstimatedFiles([])
  }

  const toggleCollapse = (pid: string) => {
    setCollapsedProjects(prev => { const next = new Set(prev); next.has(pid) ? next.delete(pid) : next.add(pid); return next })
  }
  const toggleSelect = (fid: string) => {
    setSelectedFileIds(prev => { const next = new Set(prev); next.has(fid) ? next.delete(fid) : next.add(fid); return next })
  }
  const selectAllInProject = (files: KnowledgeFile[]) => {
    setSelectedFileIds(prev => { const next = new Set(prev); files.forEach(f => next.add(f.id)); return next })
  }
  const batchDelete = async () => {
    if (selectedFileIds.size === 0) return
    if (!confirm(`确定删除选中的 ${selectedFileIds.size} 个文件？`)) return
    for (const fid of selectedFileIds) { await kbService.delete(fid) }
    setSelectedFileIds(new Set())
    setSelectedFile(null)
    await loadFiles()
  }
  const deleteProjectFiles = async (files: KnowledgeFile[]) => {
    if (!confirm(`确定删除该项目关联的全部 ${files.length} 个文件？`)) return
    for (const f of files) { await kbService.delete(f.id) }
    setSelectedFileIds(new Set())
    setSelectedFile(null)
    await loadFiles()
  }

  const handleClearProjectFiles = async () => {
    const projectFiles = files.filter(f => f.source === 'project')
    if (projectFiles.length === 0) return
    if (!confirm(`确定删除全部 ${projectFiles.length} 个旧版自动索引文件？此操作不可撤销。`)) return
    for (const f of projectFiles) { await kbService.delete(f.id) }
    await loadFiles()
  }

  const handleDelete = async (file: KnowledgeFile) => {
    await kbService.delete(file.id)
    if (selectedFile?.id === file.id) {
      setSelectedFile(null)
      setFileContent('')
    }
    await loadFiles()
  }

  const handleSave = async () => {
    if (!selectedFile || selectedFile.type === 'pdf' || selectedFile.type === 'docx') return
    await kbService.write(selectedFile.id, fileContent)
    await loadFiles()
  }

  const handleReindex = async (file: KnowledgeFile) => {
    if (!activeConfig) return
    setIndexing(file.id)
    try {
      const result = await kbService.index(
        file.id,
        activeConfig.apiUrl,
        activeConfig.apiKey,
        activeConfig.embeddingModel || 'text-embedding-3-small',
      ) as { chunkCount: number }
      alert(`索引完成，共 ${result.chunkCount} 个片段`)
      await loadFiles()
    } catch (err) {
      console.error('Indexing failed:', err)
      alert('索引失败，请检查 Embedding 模型配置')
    }
    setIndexing(null)
  }

  const toggleProject = async (file: KnowledgeFile, projectId: string) => {
    const assigned = !file.projects.includes(projectId)
    await kbService.assignProject(file.id, projectId, assigned)
    // Update selectedFile immediately without waiting for re-render
    const updatedProjects = assigned
      ? [...file.projects, projectId]
      : file.projects.filter(p => p !== projectId)
    setSelectedFile(prev => prev?.id === file.id ? { ...prev, projects: updatedProjects } : prev)
    await loadFiles()
  }

  const filteredFiles = files.filter(f => {
    if (kbTab === 'upload' && f.source !== 'upload') return false
    if (kbTab === 'project' && f.source !== 'project') return false
    if (searchQuery && !f.originalName.toLowerCase().includes(searchQuery.toLowerCase())) return false
    return true
  })

  // Group project files by project
  const projectGroupedFiles = kbTab === 'project'
    ? (() => {
        const map = new Map<string, KnowledgeFile[]>()
        for (const f of filteredFiles) {
          for (const pid of f.projects) {
            if (!map.has(pid)) map.set(pid, [])
            map.get(pid)!.push(f)
          }
        }
        return map
      })()
    : null

  const isEditable = selectedFile && (selectedFile.type === 'txt' || selectedFile.type === 'md')
  const isIndexable = selectedFile && selectedFile.type !== 'pdf' && selectedFile.type !== 'docx'

  return (
    <div className="page-enter" style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
      {/* Left: File list */}
      <div style={{
        width: '30%', minWidth: 260, borderRight: '1px solid rgba(0,0,0,0.05)',
        display: 'flex', flexDirection: 'column', background: 'rgba(255,255,255,0.35)',
      }}>
        <div style={{ padding: '16px 18px 12px', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#2d2520', marginBottom: 10 }}>知识库</h2>
          <div style={{ position: 'relative' }}>
            <MagnifyingGlassIcon style={{ position: 'absolute', left: 10, top: 8, width: 14, height: 14, color: '#9b8e84' }} />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="搜索文件..."
              style={{
                width: '100%', padding: '7px 12px 7px 30px', borderRadius: 10,
                border: '1px solid rgba(0,0,0,0.06)', outline: 'none', fontSize: 12,
                background: 'rgba(0,0,0,0.02)', color: '#2d2520',
              }}
            />
          </div>
          {/* Old project files cleanup */}
          {files.some(f => f.source === 'project') && (
            <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: '#fff3cd', border: '1px solid #ffc107', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, color: '#856404' }}>检测到旧版自动索引文件，建议清理</span>
              <button onClick={handleClearProjectFiles} style={{ padding: '3px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 10, fontWeight: 600, background: '#ffc107', color: '#856404' }}>一键清理</button>
            </div>
          )}
        </div>

        <ScrollArea maxHeight="100%" style={{ flex: 1, padding: '8px 12px' }}>
          {/* Uploaded files list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {filteredFiles.filter(f => f.source === 'upload').map(file => (
              <button key={file.id} onClick={() => handleSelectFile(file)} style={{
                width: '100%', textAlign: 'left', padding: '10px 12px', borderRadius: 12,
                border: 'none', cursor: 'pointer',
                background: selectedFile?.id === file.id ? 'rgba(124,58,237,0.06)' : 'transparent',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <DocumentTextIcon style={{ width: 15, height: 15, color: '#7c3aed', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#2d2520', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {file.originalName}
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 2, fontSize: 10, color: '#9b8e84' }}>
                      <span>{file.type.toUpperCase()}</span>
                      <span>{formatSize(file.size)}</span>
                      {file.chunkCount > 0 && <span>{file.chunkCount}块</span>}
                      <span>关联项目: {file.projects.length > 0 ? file.projects.join(', ') : '无'}</span>
                    </div>
                  </div>
                </div>
              </button>
            ))}
            {filteredFiles.filter(f => f.source === 'upload').length === 0 && (
              <div style={{ textAlign: 'center', padding: 40, color: '#9b8e84', fontSize: 13 }}>
                {searchQuery ? '未找到匹配文件' : '暂无文件，点击"上传文件"添加'}
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Multi-select bar */}
        {selectedFileIds.size > 0 && (
          <div style={{ padding: '8px 12px', borderTop: '1px solid rgba(0,0,0,0.06)', background: 'rgba(124,58,237,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, color: '#7c3aed', fontWeight: 600 }}>已选 {selectedFileIds.size} 个文件</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <Button size="sm" variant="ghost" onClick={() => setSelectedFileIds(new Set())}>取消选择</Button>
              <Button size="sm" variant="danger" onClick={batchDelete} icon={<TrashIcon style={{ width: 14, height: 14 }} />}>删除选中</Button>
            </div>
          </div>
        )}

        <div style={{ padding: '12px', borderTop: '1px solid rgba(0,0,0,0.04)', display: 'flex', gap: 6 }}>
          <Button size="sm" onClick={handleUpload} disabled={loading} icon={<DocumentArrowUpIcon style={{ width: 14, height: 14 }} />}>
            {loading ? '处理中...' : '上传文件'}
          </Button>
          {selectedFile && (
            <Button size="sm" variant="danger" onClick={() => handleDelete(selectedFile)} icon={<TrashIcon style={{ width: 14, height: 14 }} />}>
              删除
            </Button>
          )}
        </div>
      </div>

      {/* Right: File detail */}
      <div style={{ flex: '70%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {selectedFile ? (
          <>
            {/* File info header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '16px 24px', borderBottom: '1px solid rgba(0,0,0,0.05)',
            }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: '#2d2520' }}
                  onDoubleClick={async () => {
                    const newName = prompt('重命名文件:', selectedFile.originalName)
                    if (newName && newName.trim() && newName !== selectedFile.originalName) {
                      await kbService.rename(selectedFile.id, newName.trim())
                      loadFiles()
                    }
                  }}
                  title="双击重命名"
                >{selectedFile.originalName}</h3>
                <div style={{ display: 'flex', gap: 12, marginTop: 4, fontSize: 11, color: '#9b8e84', flexWrap: 'wrap', alignItems: 'center' }}>
                  <span>{selectedFile.type.toUpperCase()}</span>
                  <span>{formatSize(selectedFile.size)}</span>
                  {fileContent && <span>{countChineseWords(fileContent).toLocaleString()} 字</span>}
                  <span>{selectedFile.chunkCount} 个片段</span>
                  {selectedFile.chunkCount > 0 && <span style={{ color: indexStateColor(selectedFile) }}>{indexStateLabel(selectedFile)}</span>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
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

            {/* Project assignment */}
            <div style={{
              padding: '10px 24px', borderBottom: '1px solid rgba(0,0,0,0.04)',
              display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
            }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', whiteSpace: 'nowrap' }}>
                <TagIcon style={{ width: 12, height: 12, display: 'inline', marginRight: 3 }} />
                所属项目:
              </span>
              {projects.map(proj => {
                const assigned = selectedFile.projects.includes(proj.id)
                return (
                  <button
                    key={proj.id}
                    onClick={() => toggleProject(selectedFile, proj.id)}
                    title={assigned ? '点击取消关联' : '点击关联'}
                    style={{
                      padding: '3px 10px', borderRadius: 8, border: assigned ? '1px solid rgba(124,58,237,0.3)' : '1px solid rgba(0,0,0,0.08)',
                      background: assigned ? 'rgba(124,58,237,0.08)' : '#fff',
                      color: assigned ? '#7c3aed' : '#9b8e84', fontSize: 11, cursor: 'pointer',
                      fontWeight: assigned ? 600 : 400, transition: 'all 0.1s ease',
                    }}
                  >
                    {proj.name} {assigned ? '✓' : '+'}
                  </button>
                )
              })}
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
                      border: '1px solid rgba(0,0,0,0.06)', borderRadius: 12, outline: 'none',
                      resize: 'none', fontSize: 14, lineHeight: 1.8, fontFamily: 'inherit',
                      color: '#2d2520', background: '#fff', padding: 20,
                    }}
                    placeholder="文件内容..."
                  />
                ) : (
                  <div style={{
                    padding: 20, borderRadius: 12, background: '#fff',
                    border: '1px solid rgba(0,0,0,0.06)', minHeight: 400,
                    fontSize: 14, lineHeight: 1.8, color: '#4a3f38', whiteSpace: 'pre-wrap',
                  }}>
                    {fileContent || '无法预览此文件类型，请下载后查看'}
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9b8e84', fontSize: 14 }}>
            <div style={{ textAlign: 'center' }}>
              <DocumentTextIcon style={{ width: 48, height: 48, margin: '0 auto 12px', opacity: 0.2 }} />
              <p>选择一个文件查看详情</p>
              <p style={{ fontSize: 12, marginTop: 4 }}>或点击"上传文件"添加参考资料</p>
            </div>
          </div>
        )}
      </div>

      {/* Upload Estimate Modal */}
      <Modal isOpen={showEstimate} onClose={() => { setShowEstimate(false); setEstimatedFiles([]) }} title="上传文件预估" width={520}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p style={{ fontSize: 13, color: '#6b5e54' }}>
            即将上传 {estimatedFiles.length} 个文件，预估信息如下：
          </p>
          <div className="custom-scrollbar" style={{ maxHeight: 260, overflowY: 'auto' }}>
            {estimatedFiles.map((f, i) => (
              <div key={i} style={{
                padding: 12, borderRadius: 10, background: '#faf9f8',
                border: '1px solid rgba(0,0,0,0.04)', marginBottom: 8,
              }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: '#2d2520', marginBottom: 4 }}>{f.name}</div>
                <div style={{ display: 'flex', gap: 16, fontSize: 11, color: '#9b8e84' }}>
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
    </div>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function indexStateLabel(file: { chunkCount: number }): string {
  if (file.chunkCount === 0) return '未索引'
  // chunkCount > 0 but we can't check embedding presence from metadata alone
  return '已索引'
}

function indexStateColor(file: { chunkCount: number }): string {
  return file.chunkCount === 0 ? '#9b8e84' : '#16a34a'
}
