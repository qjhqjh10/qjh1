import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/store'
import { projectService, continuationService, exportService, dialogService } from '@/services/fileService'
import { nanoid } from 'nanoid'
import GlassCard from '@/components/common/GlassCard'
import Button from '@/components/common/Button'
import Modal from '@/components/common/Modal'
import ScrollArea from '@/components/common/ScrollArea'
import { formatWordCount } from '@/utils/textUtils'
import { logError } from '@/utils/logger'
import {
  PlusIcon,
  TrashIcon,
  ArrowRightIcon,
  BookOpenIcon,
  DocumentTextIcon,
} from '@heroicons/react/24/outline'
import type { Project } from '@/types/project'

export default function HomePage() {
  const navigate = useNavigate()
  const projects = useStore(s => s.projects)
  const activeProjectId = useStore(s => s.activeProjectId)
  const projectsBasePath = useStore(s => s.projectsBasePath)
  const setProjects = useStore(s => s.setProjects)
  const addProject = useStore(s => s.addProject)
  const removeProject = useStore(s => s.removeProject)
  const setActiveProject = useStore(s => s.setActiveProject)

  const [showCreate, setShowCreate] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectType, setNewProjectType] = useState<'writing' | 'imitation' | 'continuation'>('writing')
  const [loading, setLoading] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null)

  const loadProjects = useCallback(async () => {
    if (!projectsBasePath) return
    setLoading(true)
    try {
      const names = await projectService.listProjects(projectsBasePath)
      const projList: Project[] = []
      for (const name of names) {
        const meta = await projectService.getMeta(`${projectsBasePath}/${name}`)
        const pt = (meta.type as string) === 'imitation' ? 'imitation' : (meta.type as string) === 'continuation' ? 'continuation' : 'writing'
projList.push({ id: name, ...meta, type: pt })
      }
      setProjects(projList)
    } catch (err) {
      logError('Failed to load projects', err)
    }
    setLoading(false)
  }, [projectsBasePath, setProjects])

  // Projects loaded globally in App.tsx; refresh after create/delete only
  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  const handleCreateProject = async () => {
    if (!newProjectName.trim() || !projectsBasePath) return
    const name = newProjectName.trim()
    try {
      await projectService.create(name, projectsBasePath, newProjectType)
      const meta = await projectService.getMeta(`${projectsBasePath}/${name}`)
      addProject({ id: name, ...meta, type: newProjectType })
      // For continuation projects, also create the ContinuationProject entry (with same ID)
      if (newProjectType === 'continuation') {
        try {
          await continuationService.save({
            id: name, name, sourceFileName: '', sourceChapters: [], writtenChapters: [],
            status: 'imported', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
          })
        } catch {}
      }
      setNewProjectName('')
      setShowCreate(false)
      // Navigate to imitation page if imitation project
      if (newProjectType === 'imitation') {
        setActiveProject(name, newProjectType)
        navigate('/imitation')
      } else {
        navigate('/outline')
      }
    } catch (err) {
      logError('Failed to create project', err)
      const msg = err instanceof Error ? err.message : '创建项目失败'
      alert(msg.includes('已存在') ? msg : '创建项目失败：' + msg)
    }
  }

  const handleDeleteProject = async (project: Project) => {
    try {
      if (project.type === 'continuation') {
        try { await continuationService.delete(project.id) } catch {}
      }
      if (project.path) {
        try { await projectService.delete(project.path) } catch {}
      }
      removeProject(project.id)
    } catch (err) {
      logError('Failed to delete project', err)
      alert('删除项目失败，请检查权限')
    }
  }

  const handleExportProject = async (project: Project) => {
    const outputPath = await dialogService.saveZip(`${project.name}.zip`)
    if (!outputPath) return
    try {
      await exportService.exportProject(project.path, outputPath)
      alert('项目导出成功')
    } catch (err) {
      logError('Failed to export project', err)
      alert('导出失败：' + (err instanceof Error ? err.message : '未知错误'))
    }
  }

  const handleImportProject = async () => {
    const zipPath = await dialogService.openZip()
    if (!zipPath) return
    try {
      const result = await projectService.importProject(zipPath)
      await loadProjects()
      alert(`项目"${result.name}"导入成功（类型: ${result.type === 'imitation' ? '仿写' : result.type === 'continuation' ? '续写' : '写作'}）`)
    } catch (err) {
      logError('Failed to import project', err)
      alert('导入失败：' + (err instanceof Error ? err.message : '未知错误'))
    }
  }

  const handleEnterProject = (project: Project) => {
    setActiveProject(project.id, project.type)
    navigate(project.type === 'imitation' ? '/imitation' : project.type === 'continuation' ? '/continuation-workspace' : '/outline')
  }

  const activeProject = projects.find(p => p.id === activeProjectId)

  return (
    <div className="page-enter" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: 32 }}>
      <div style={{ maxWidth: 900, width: '100%', margin: '0 auto', flex: 1, display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
          <div>
            <h2 style={{ fontSize: 24, fontWeight: 700, color: '#2d2520' }}>工作台</h2>
            <p style={{ fontSize: 14, color: '#9b8e84', marginTop: 4 }}>
              {activeProject ? `当前项目: ${activeProject.name}` : '选择或创建一个项目开始写作'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="secondary" size="sm" onClick={handleImportProject}>导入项目</Button>
            <Button onClick={() => setShowCreate(true)} icon={<PlusIcon style={{ width: 18, height: 18 }} />}>
              新建项目
            </Button>
          </div>
        </div>

        {/* Active Project Detail */}
        {activeProject ? (
          <GlassCard style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <div>
                <h3 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>{activeProject.name}</h3>
                <div style={{ display: 'flex', gap: 32, marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 12, color: '#9b8e84' }}>完成章节</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: '#7c3aed' }}>{activeProject.chapterCount}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: '#9b8e84' }}>已写字数</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: '#7c3aed' }}>{formatWordCount(activeProject.wordCount)}</div>
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button onClick={() => handleEnterProject(activeProject)} icon={<ArrowRightIcon style={{ width: 16, height: 16 }} />}>
                  进入项目
                </Button>
                <Button variant="secondary" size="sm" onClick={() => handleExportProject(activeProject)}>导出</Button>
                <Button variant="danger" onClick={() => handleDeleteProject(activeProject)} icon={<TrashIcon style={{ width: 16, height: 16 }} />}>
                  删除
                </Button>
              </div>
            </div>
          </GlassCard>
        ) : (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: '#9b8e84' }}>
            <BookOpenIcon style={{ width: 64, height: 64, margin: '0 auto 16px', opacity: 0.3 }} />
            <p style={{ fontSize: 16, marginBottom: 8 }}>尚未选择项目</p>
            <p style={{ fontSize: 13 }}>选择左侧项目列表中的项目，或创建一个新项目</p>
          </div>
        )}

        {/* All Projects */}
        <div style={{ marginTop: 8 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: '#6b5e54', marginBottom: 12 }}>
            所有项目 ({projects.length})
          </h3>
          <ScrollArea maxHeight={400}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
              {projects.map(project => (
                <GlassCard
                  key={project.id}
                  onClick={() => setActiveProject(project.id, project.type)}
                  style={{
                    border: activeProjectId === project.id ? '2px solid rgba(124, 58, 237, 0.3)' : undefined,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <h4 style={{ fontSize: 15, fontWeight: 600, marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {project.name}
                      </h4>
                      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#9b8e84' }}>
                        <span><DocumentTextIcon style={{ width: 14, height: 14, display: 'inline', marginRight: 2 }} /> {project.chapterCount}章</span>
                        <span>{formatWordCount(project.wordCount)}字</span>
                      </div>
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); setDeleteTarget(project) }}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: 6,
                        borderRadius: 8,
                        color: '#d4ccc4',
                        flexShrink: 0,
                      }}
                      onMouseEnter={e => { (e.target as HTMLElement).style.color = '#dc2626' }}
                      onMouseLeave={e => { (e.target as HTMLElement).style.color = '#d4ccc4' }}
                    >
                      <TrashIcon style={{ width: 16, height: 16 }} />
                    </button>
                  </div>
                </GlassCard>
              ))}
            </div>
          </ScrollArea>
          {loading && <div style={{ textAlign: 'center', padding: 16, color: '#9b8e84', fontSize: 13 }}>加载中...</div>}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      <Modal isOpen={deleteTarget !== null} onClose={() => setDeleteTarget(null)} title="删除项目" width={440}>
        <p style={{ fontSize: 14, color: '#4a3f38', lineHeight: 1.8 }}>
          确定删除项目「<strong>{deleteTarget?.name}</strong>」吗？
        </p>
        <p style={{ fontSize: 13, color: '#dc2626', marginTop: 8, lineHeight: 1.6 }}>
          该操作不可撤销，项目内所有内容（世界观、角色、大纲、细纲、章节、知识库）将被永久删除。
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20, paddingTop: 16, borderTop: '1px solid #f0ece8' }}>
          <Button variant="secondary" onClick={() => setDeleteTarget(null)}>取消</Button>
          <Button variant="danger" onClick={() => { if (deleteTarget) { handleDeleteProject(deleteTarget); setDeleteTarget(null) } }}>确定删除</Button>
        </div>
      </Modal>

      {/* Create Modal */}
      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="新建项目">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#6b5e54', marginBottom: 6 }}>
              项目名称
            </label>
            <input
              type="text"
              value={newProjectName}
              onChange={e => setNewProjectName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCreateProject() }}
              placeholder="输入项目名称..."
              autoFocus
              style={{
                width: '100%',
                padding: '10px 14px',
                fontSize: 14,
                borderRadius: 12,
                border: '1px solid #e5e0da',
                outline: 'none',
                background: '#faf9f8',
              }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#6b5e54', marginBottom: 8 }}>
              项目类型
            </label>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setNewProjectType('writing')} style={{
                flex: 1, padding: '14px 16px', borderRadius: 14, cursor: 'pointer', textAlign: 'left',
                border: newProjectType === 'writing' ? '2px solid #7c3aed' : '2px solid rgba(0,0,0,0.06)',
                background: newProjectType === 'writing' ? 'rgba(124,58,237,0.04)' : '#fff',
              }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: newProjectType === 'writing' ? '#7c3aed' : '#2d2520', marginBottom: 4 }}>📝 普通写作</div>
                <div style={{ fontSize: 11, color: '#9b8e84' }}>常规小说创作，从零开始写作</div>
              </button>
              <button onClick={() => setNewProjectType('imitation')} style={{
                flex: 1, padding: '14px 16px', borderRadius: 14, cursor: 'pointer', textAlign: 'left',
                border: newProjectType === 'imitation' ? '2px solid #7c3aed' : '2px solid rgba(0,0,0,0.06)',
                background: newProjectType === 'imitation' ? 'rgba(124,58,237,0.04)' : '#fff',
              }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: newProjectType === 'imitation' ? '#7c3aed' : '#2d2520', marginBottom: 4 }}>📋 小说仿写</div>
                <div style={{ fontSize: 11, color: '#9b8e84' }}>导入小说 → AI分析结构 → 模仿生成新作</div>
              </button>
              <button onClick={() => setNewProjectType('continuation')} style={{
                flex: 1, padding: '14px 16px', borderRadius: 14, cursor: 'pointer', textAlign: 'left',
                border: newProjectType === 'continuation' ? '2px solid #7c3aed' : '2px solid rgba(0,0,0,0.06)',
                background: newProjectType === 'continuation' ? 'rgba(124,58,237,0.04)' : '#fff',
              }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: newProjectType === 'continuation' ? '#7c3aed' : '#2d2520', marginBottom: 4 }}>📖 小说续写</div>
                <div style={{ fontSize: 11, color: '#9b8e84' }}>导入未完结小说 → AI理解剧情 → 沿着原作逻辑续写</div>
              </button>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="secondary" onClick={() => setShowCreate(false)}>取消</Button>
            <Button onClick={handleCreateProject} disabled={!newProjectName.trim()}>创建</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
