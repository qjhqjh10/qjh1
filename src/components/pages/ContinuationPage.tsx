import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/store'
import { continuationService, extractionService } from '@/services/fileService'
import { splitChaptersByHeadings } from '@/utils/textUtils'
import { logError } from '@/utils/logger'
import Button from '@/components/common/Button'
import ScrollArea from '@/components/common/ScrollArea'
import Modal from '@/components/common/Modal'
import { PlusIcon, SparklesIcon, TrashIcon, ChevronRightIcon } from '@heroicons/react/24/outline'
import type { ContinuationProject, ContinuationChapter } from '@/types/continuation'
import { inputStyle } from '@/components/common/styles'

export default function ContinuationPage() {
  const navigate = useNavigate()
  const setActivePage = useStore(s => s.setActivePage)
  const setActiveProject = useStore(s => s.setActiveProject)
  const setActiveProjectName = useStore(s => s.setActiveProjectName)
  const [projects, setProjects] = useState<ContinuationProject[]>([])
  const [importing, setImporting] = useState(false)
  const [showDeleteId, setShowDeleteId] = useState<string | null>(null)
  const [showNewDialog, setShowNewDialog] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')

  useEffect(() => { loadProjects() }, [])

  const loadProjects = async () => {
    try { setProjects(await continuationService.list() as ContinuationProject[]) } catch {}
  }

  const handleEnterProject = (proj: ContinuationProject) => {
    setActiveProject(proj.id, 'continuation' as any)
    setActiveProjectName(proj.name)
    setActivePage('chapter')
    navigate('/continuation-workspace')
  }

  const handleImport = async () => {
    setImporting(true)
    try {
      const result = await extractionService.importFile() as { name: string; content: string } | null
      if (!result) { setImporting(false); return }
      const split = splitChaptersByHeadings(result.content)
      const chs: ContinuationChapter[] = split.map((r, i) => ({
        chapterNumber: i + 1, title: r.title, content: r.content, wordCount: r.content.length,
      }))
      const proj: ContinuationProject = {
        id: '', name: result.name.replace(/\.txt$/i, ''),
        sourceFileName: result.name, sourceChapters: chs, writtenChapters: [],
        status: 'imported', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }
      const saved = await continuationService.save(proj)
      await loadProjects()
      handleEnterProject(saved)
    } catch (err) { logError('导入失败', err) }
    setImporting(false)
  }

  const handleCreateEmpty = async () => {
    if (!newProjectName.trim()) return
    const p: ContinuationProject = {
      id: '', name: newProjectName.trim(), sourceFileName: '',
      sourceChapters: [], writtenChapters: [], status: 'imported',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }
    const saved = await continuationService.save(p)
    await loadProjects()
    setShowNewDialog(false)
    setNewProjectName('')
    handleEnterProject(saved)
  }

  const handleDelete = async (id: string) => {
    await continuationService.delete(id)
    await loadProjects()
    setShowDeleteId(null)
  }

  const statusColor = (s: string) =>
    s === 'writing' ? '#16a34a' : s === 'planned' ? '#7c3aed' : s === 'analyzed' ? '#3b82f6' : '#9b8e84'
  const statusLabel = (s: string) =>
    s === 'writing' ? '续写中' : s === 'planned' ? '已计划' : s === 'analyzed' ? '已分析' : '已导入'

  return (
    <div className="page-enter" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '20px 24px 12px', borderBottom: '1px solid rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#2d2520', margin: 0 }}>小说续写</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button size="sm" variant="secondary" onClick={() => setShowNewDialog(true)} icon={<PlusIcon style={{ width: 14, height: 14 }} />}>新建</Button>
          <Button size="sm" onClick={handleImport} disabled={importing} icon={<SparklesIcon style={{ width: 14, height: 14 }} />}>{importing ? '导入中...' : '导入小说'}</Button>
        </div>
      </div>

      <ScrollArea style={{ flex: 1, padding: '16px 24px' }}>
        {/* Base card */}
        <div style={{
          padding: projects.length === 0 ? '24px 20px' : '20px',
          borderRadius: 20, minHeight: 200,
          background: 'linear-gradient(135deg, rgba(124,58,237,0.03) 0%, rgba(236,72,153,0.02) 100%)',
          border: '1px solid rgba(124,58,237,0.08)',
          boxShadow: '0 4px 20px rgba(124,58,237,0.04)',
        }}>
          <div style={{ fontSize: 11, color: '#9b8e84', marginBottom: projects.length > 0 ? 16 : 0, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#7c3aed', display: 'inline-block' }} />
            续写项目 · {projects.length}
          </div>
          {projects.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#9b8e84' }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>📖</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#4a3f38', marginBottom: 4 }}>开始你的续写之旅</div>
              <div style={{ fontSize: 12 }}>导入一本未完结的小说，AI 理解剧情后沿着原作逻辑继续创作</div>
              <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'center' }}>
                <Button size="sm" variant="secondary" onClick={() => setShowNewDialog(true)} icon={<PlusIcon style={{ width: 12, height: 12 }} />}>新建空项目</Button>
                <Button size="sm" onClick={handleImport} disabled={importing} icon={<SparklesIcon style={{ width: 12, height: 12 }} />}>{importing ? '导入中...' : '导入小说'}</Button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
              {projects.map(p => (
                <div key={p.id} onClick={() => handleEnterProject(p)} style={{
                  padding: '16px 18px', borderRadius: 14, background: '#fff',
                  border: '1px solid rgba(0,0,0,0.06)', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  transition: 'border-color 0.15s, box-shadow 0.15s',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                }} onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(124,58,237,0.2)')} onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.06)')}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#2d2520' }}>{p.name}</div>
                    <div style={{ fontSize: 11, color: '#9b8e84', marginTop: 2 }}>
                      {p.sourceFileName && `来源: ${p.sourceFileName} · `}
                      {p.sourceChapters.length}章 · 已分析 {p.sourceChapters.filter(c => c.analysis).length}章
                      {p.writtenChapters.length > 0 && ` · 已续写 ${p.writtenChapters.length}章`}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: `${statusColor(p.status)}15`, color: statusColor(p.status), fontWeight: 600 }}>{statusLabel(p.status)}</span>
                    <button onClick={e => { e.stopPropagation(); setShowDeleteId(p.id) }} style={{ background: 'none', border: 'none', color: '#9b8e84', cursor: 'pointer', padding: 2 }}>
                      <TrashIcon style={{ width: 14, height: 14 }} />
                    </button>
                    <ChevronRightIcon style={{ width: 14, height: 14, color: '#d9d2cc' }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>

      <Modal isOpen={showNewDialog} onClose={() => setShowNewDialog(false)} title="新建续写项目" width={400}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input value={newProjectName} onChange={e => setNewProjectName(e.target.value)} placeholder="项目名称" style={inputStyle as any} onKeyDown={e => { if (e.key === 'Enter') handleCreateEmpty() }} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="secondary" onClick={() => setShowNewDialog(false)}>取消</Button>
            <Button onClick={handleCreateEmpty} disabled={!newProjectName.trim()}>创建</Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={!!showDeleteId} onClose={() => setShowDeleteId(null)} title="删除项目" width={360}>
        <div style={{ fontSize: 13, color: '#6b5e54', marginBottom: 16 }}>确定删除此续写项目？此操作不可撤销。</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="secondary" onClick={() => setShowDeleteId(null)}>取消</Button>
          <Button variant="danger" onClick={() => showDeleteId && handleDelete(showDeleteId)}>删除</Button>
        </div>
      </Modal>
    </div>
  )
}
