import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/store'
import { continuationService, extractionService } from '@/services/fileService'
import { splitChaptersByHeadings, countChineseWords } from '@/utils/textUtils'
import { logError } from '@/utils/logger'
import Button from '@/components/common/Button'
import Modal from '@/components/common/Modal'
import EmptyState from '@/components/common/EmptyState'
import ProjectHubLayout from '@/components/common/ProjectHubLayout'
import { ArrowRightIcon, SparklesIcon } from '@heroicons/react/24/outline'
import type { ContinuationProject, ContinuationChapter } from '@/types/continuation'

export default function ContinuationPage() {
  const navigate = useNavigate()
  const setActiveProject = useStore(s => s.setActiveProject)
  const setActiveProjectName = useStore(s => s.setActiveProjectName)
  const removeProject = useStore(s => s.removeProject)
  const [projects, setProjects] = useState<ContinuationProject[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [showNewDialog, setShowNewDialog] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')

  useEffect(() => { loadProjects() }, [])

  const loadProjects = async () => {
    try { setProjects(await continuationService.list() as ContinuationProject[]) } catch (err) { logError('加载续写项目列表失败', err) }
  }

  const handleEnterProject = (proj: ContinuationProject) => {
    setActiveProject(proj.id, 'continuation')
    setActiveProjectName(proj.name)
    navigate('/continuation-workspace')
  }

  const handleImport = async () => {
    setImporting(true)
    try {
      const result = await extractionService.importFile() as { name: string; content: string } | null
      if (!result) { setImporting(false); return }
      const split = splitChaptersByHeadings(result.content)
      if (split.length === 1 && split[0].chapterType === 'chapter' && split[0].title === '全文') {
        alert('未检测到章节标题，已导入为单章全文。\n请确认小说文件使用了标准的"第X章"格式。')
      }
      const chs: ContinuationChapter[] = split.map((r, i) => ({
        chapterNumber: i + 1, title: r.title, content: r.content, wordCount: countChineseWords(r.content),
      }))
      const projName = result.name.replace(/\.txt$/i, '')
      const proj: ContinuationProject = {
        id: projName, name: projName,
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
      id: newProjectName.trim(), name: newProjectName.trim(), sourceFileName: '',
      sourceChapters: [], writtenChapters: [], status: 'imported',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }
    const saved = await continuationService.save(p)
    await loadProjects()
    setShowNewDialog(false)
    setNewProjectName('')
    setActiveId(saved.id)
  }

  const handleDelete = async (proj: ContinuationProject) => {
    await continuationService.delete(proj.id)
    removeProject(proj.id)
    if (activeId === proj.id) setActiveId(null)
    await loadProjects()
  }

  const statusColor = (s: string) =>
    s === 'writing' ? '#16a34a' : s === 'planned' ? '#7c3aed' : s === 'merged' ? '#8b5cf6' : s === 'outlining' ? '#f59e0b' : s === 'analyzed' ? '#3b82f6' : s === 'analyzing' ? '#06b6d4' : '#9b8e84'
  const statusLabel = (s: string) =>
    s === 'writing' ? '续写中' : s === 'planned' ? '已计划' : s === 'merged' ? '已融合' : s === 'outlining' ? '大纲中' : s === 'analyzed' ? '已分析' : s === 'analyzing' ? '分析中' : '已导入'

  const activeProject = activeId ? projects.find(p => p.id === activeId) : null

  return (
    <>
      <ProjectHubLayout
        title="小说续写"
        projects={projects}
        activeProjectId={activeId}
        onSelectProject={(p) => setActiveId(p.id)}
        onCreateProject={() => setShowNewDialog(true)}
        onImportProject={handleImport}
        importLabel={importing ? '导入中...' : '导入小说'}
        createLabel="新建"
        onDeleteProject={handleDelete}
        deleteTitle="删除续写项目"
        deleteMessage={(name) => `确定要删除续写项目「${name}」吗？此操作不可撤销。`}
        emptyIcon="📖"
        emptyTitle="暂无续写项目"
        emptyDescription="导入一本未完结的小说，AI 理解剧情后沿着原作逻辑继续创作"
        renderProjectItem={(p, active) => (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: active ? 700 : 500, color: active ? '#7c3aed' : '#2d2520', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.name}
              </div>
              <div style={{ fontSize: 11, color: '#9b8e84', marginTop: 2 }}>
                {p.sourceFileName && `来源: ${p.sourceFileName} · `}
                {p.sourceChapters.length}章
                {p.writtenChapters.length > 0 && ` · 已续写 ${p.writtenChapters.length}章`}
              </div>
            </div>
            <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: `${statusColor(p.status)}15`, color: statusColor(p.status), fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}>
              {statusLabel(p.status)}
            </span>
          </div>
        )}
        renderEmptyState={() => (
          <EmptyState icon="📖" title="选择左侧续写项目" description="或新建 / 导入一个项目开始续写" />
        )}
        renderProjectDetail={(p) => (
          <div style={{
            width: '82%', minWidth: 520, maxWidth: 880, minHeight: '65vh', margin: '40px auto',
            padding: '44px 48px', borderRadius: 24,
            background: 'rgba(255,255,255,0.75)', backdropFilter: 'blur(24px)',
            border: '1px solid rgba(255,255,255,0.6)',
            boxShadow: '0 8px 40px rgba(0,0,0,0.06), 0 2px 8px rgba(0,0,0,0.04)',
          }}>
            {/* Project name */}
            <h3 style={{ fontSize: 24, fontWeight: 700, color: '#2d2520', margin: '0 0 8px' }}>
              {p.name}
            </h3>
            {p.sourceFileName && (
              <p style={{ fontSize: 13, color: '#9b8e84', margin: '0 0 24px' }}>
                来源文件: {p.sourceFileName}
              </p>
            )}

            {/* Stats row */}
            <div style={{ display: 'flex', gap: 0, marginBottom: 28, borderRadius: 16, background: 'rgba(124,58,237,0.03)', border: '1px solid rgba(124,58,237,0.06)', overflow: 'hidden' }}>
              <div className="stagger-item" style={{ flex: 1, textAlign: 'center', padding: '16px 12px' }}>
                <div style={{ fontSize: 26, fontWeight: 700, color: '#7c3aed' }}>{p.sourceChapters.length}</div>
                <div style={{ fontSize: 11, color: '#9b8e84', marginTop: 2 }}>源章节</div>
              </div>
              <div style={{ width: 1, background: 'rgba(124,58,237,0.06)' }} />
              <div className="stagger-item" style={{ flex: 1, textAlign: 'center', padding: '16px 12px' }}>
                <div style={{ fontSize: 26, fontWeight: 700, color: '#7c3aed' }}>{p.sourceChapters.filter(c => c.analysis).length}</div>
                <div style={{ fontSize: 11, color: '#9b8e84', marginTop: 2 }}>已分析</div>
              </div>
              <div style={{ width: 1, background: 'rgba(124,58,237,0.06)' }} />
              <div className="stagger-item" style={{ flex: 1, textAlign: 'center', padding: '16px 12px' }}>
                <div style={{ fontSize: 26, fontWeight: 700, color: '#7c3aed' }}>{p.writtenChapters.length}</div>
                <div style={{ fontSize: 11, color: '#9b8e84', marginTop: 2 }}>已续写</div>
              </div>
              <div style={{ width: 1, background: 'rgba(124,58,237,0.06)' }} />
              <div className="stagger-item" style={{ flex: 1, textAlign: 'center', padding: '16px 12px' }}>
                <div style={{ fontSize: 26, fontWeight: 700, color: statusColor(p.status) }}>
                  {statusLabel(p.status)}
                </div>
                <div style={{ fontSize: 11, color: '#9b8e84', marginTop: 2 }}>状态</div>
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
              <Button
                variant="accent-gradient"
                onClick={() => handleEnterProject(p)}
                icon={<ArrowRightIcon style={{ width: 16, height: 16 }} />}
                style={{ flex: 1, justifyContent: 'center', padding: '12px 0', fontSize: 14 }}
              >
                进入项目
              </Button>
            </div>
          </div>
        )}
      />

      {/* Create Modal */}
      <Modal isOpen={showNewDialog} onClose={() => setShowNewDialog(false)} title="新建续写项目" width={440}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#6b5e54', marginBottom: 6 }}>项目名称</label>
            <input value={newProjectName} onChange={e => setNewProjectName(e.target.value)}
              placeholder="输入项目名称..." autoFocus className="focus-ring"
              onKeyDown={e => { if (e.key === 'Enter') handleCreateEmpty() }}
              style={{ width: '100%', padding: '10px 14px', fontSize: 14, borderRadius: 10,
                border: '1px solid #e5e0da', outline: 'none', background: '#faf9f8', fontFamily: 'inherit' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8, borderTop: '1px solid #f0ece8' }}>
            <Button variant="secondary" onClick={() => setShowNewDialog(false)}>取消</Button>
            <Button onClick={handleCreateEmpty} disabled={!newProjectName.trim()}>创建</Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
