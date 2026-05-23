import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/store'
import { projectService, fileService, continuationService, exportService, dialogService } from '@/services/fileService'
import { NOVEL_CATEGORIES } from '@/types/chapter'
import { nanoid } from 'nanoid'
import GlassCard from '@/components/common/GlassCard'
import CoverUpload from '@/components/common/CoverUpload'
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
  const fileEditNotify = useStore(s => s.fileEditNotify)
  const setProjects = useStore(s => s.setProjects)
  const addProject = useStore(s => s.addProject)
  const removeProject = useStore(s => s.removeProject)
  const setActiveProject = useStore(s => s.setActiveProject)

  const [showCreate, setShowCreate] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectType, setNewProjectType] = useState<'writing' | 'imitation' | 'continuation'>('writing')
  const [newNovelCategory, setNewNovelCategory] = useState('general')
  const [loading, setLoading] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null)

  const loadProjects = useCallback(async () => {
    if (!projectsBasePath) return
    setLoading(true)
    try {
      const names = await projectService.listProjects(projectsBasePath)
      const projList: Project[] = []
      for (const name of names) {
        if (name.startsWith('.') || name === 'style_templates' || name === 'scene_templates' || name === 'notes') continue
        const meta = await projectService.getMeta(`${projectsBasePath}/${name}`)
        if (!meta || (meta as Record<string, unknown>).hidden) continue
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

  // Reload projects when AI creates/deletes/modifies project files
  useEffect(() => {
    if (fileEditNotify) {
      const p = fileEditNotify.filePath.replace(/\\/g, '/')
      // Project-level changes or any file edit in projects dir should refresh list
      if (p.includes('/projects/') || p === fileEditNotify.filePath) {
        loadProjects()
      }
    }
  }, [fileEditNotify, loadProjects])

  const handleCreateProject = async () => {
    if (!newProjectName.trim() || !projectsBasePath) return
    const name = newProjectName.trim()
    try {
      await projectService.create(name, projectsBasePath, newProjectType)
      // Set initial novel category for writing projects
      if (newProjectType === 'writing') {
        await projectService.updateCategory(`${projectsBasePath}/${name}`, newNovelCategory)
      }
      const meta = await projectService.getMeta(`${projectsBasePath}/${name}`)
      addProject({ id: name, ...meta, type: newProjectType })
      // For continuation projects, also create the ContinuationProject entry (with same ID)
      if (newProjectType === 'continuation') {
        try {
          await continuationService.save({
            id: name, name, sourceFileName: '', sourceChapters: [], writtenChapters: [],
            status: 'imported', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
          })
        } catch (err) { logError('创建续写项目记录失败', err) }
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
        try { await continuationService.delete(project.id) } catch (err) { logError('删除续写记录失败', err) }
      }
      if (project.path) {
        try { await projectService.delete(project.path) } catch (err) { logError('删除项目目录失败', err) }
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

  const handleUpdateCategory = async (category: string) => {
    if (!activeProject?.path) return
    await projectService.updateCategory(activeProject.path, category)
    await loadProjects()
  }

  const handleCoverChange = async (coverImage: string | undefined) => {
    if (!activeProject?.path) return
    try {
      const pp = activeProject.path
      const metaPath = `${pp}/project.json`.replace(/\\/g, '/')
      const raw = await fileService.read(metaPath)
      const meta = raw ? JSON.parse(raw) : {}
      if (coverImage) {
        meta.coverImage = coverImage
      } else {
        delete meta.coverImage
      }
      await fileService.write(metaPath, JSON.stringify(meta, null, 2))
    } catch (err) { logError('保存封面元数据失败', err) }
    await loadProjects()
  }

  const novelCategory = activeProject?.novelCategory || 'general'

  return (
    <div className="page-enter" style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
      {/* ── Left Panel: Project List ── */}
      <div style={{
        width: 280, flexShrink: 0, borderRight: '1px solid rgba(0,0,0,0.06)',
        display: 'flex', flexDirection: 'column',
        background: 'rgba(255,255,255,0.35)',
      }}>
        {/* Header */}
        <div style={{ padding: '20px 16px 12px' }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#2d2520', marginBottom: 12 }}>项目列表</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => setShowCreate(true)}
              style={{
                flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                padding: '9px 0', borderRadius: 10, border: 'none', cursor: 'pointer',
                background: 'linear-gradient(135deg, #7c3aed, #8b5cf6)',
                color: '#fff', fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
                transition: 'all 0.2s ease',
              }}
            >
              <PlusIcon style={{ width: 15, height: 15 }} /> 新建
            </button>
            <button
              onClick={handleImportProject}
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                padding: '9px 12px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.08)',
                background: 'rgba(255,255,255,0.6)', color: '#6b5e54', fontSize: 12, fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.2s ease',
              }}
            >
              导入
            </button>
          </div>
        </div>

        {/* Project list */}
        <div className="custom-scrollbar" style={{ flex: 1, overflow: 'auto', padding: '0 10px 12px' }}>
          {projects.map(project => {
            const active = activeProjectId === project.id
            return (
              <div
                key={project.id}
                onClick={() => setActiveProject(project.id, project.type)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                  marginBottom: 4, borderRadius: 12, cursor: 'pointer',
                  background: active ? 'rgba(124,58,237,0.08)' : 'transparent',
                  borderLeft: active ? '3px solid #7c3aed' : '3px solid transparent',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(124,58,237,0.03)' }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: active ? 700 : 500, color: active ? '#7c3aed' : '#2d2520', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {project.name}
                  </div>
                  <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#9b8e84', marginTop: 2 }}>
                    <span>{project.chapterCount}章</span>
                    <span>{formatWordCount(project.wordCount)}字</span>
                    <span style={{
                      padding: '1px 6px', borderRadius: 4, fontSize: 9, fontWeight: 600,
                      background: project.type === 'imitation' ? 'rgba(22,163,74,0.1)' : project.type === 'continuation' ? 'rgba(217,119,6,0.1)' : 'rgba(124,58,237,0.1)',
                      color: project.type === 'imitation' ? '#16a34a' : project.type === 'continuation' ? '#d97706' : '#7c3aed',
                    }}>
                      {project.type === 'imitation' ? '仿写' : project.type === 'continuation' ? '续写' : '写作'}
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
          {projects.length === 0 && (
            <div style={{ textAlign: 'center', padding: 32, color: '#9b8e84', fontSize: 12 }}>
              暂无项目，点击"新建"开始
            </div>
          )}
        </div>
      </div>

      {/* ── Right Panel: Workspace ── */}
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.25)' }}>
        {activeProject ? (
          <div style={{
            width: '82%', minWidth: 520, maxWidth: 880, minHeight: '75vh', margin: '40px auto',
            padding: '44px 48px', borderRadius: 24,
            background: 'rgba(255,255,255,0.75)', backdropFilter: 'blur(24px)',
            border: '1px solid rgba(255,255,255,0.6)',
            boxShadow: '0 8px 40px rgba(0,0,0,0.06), 0 2px 8px rgba(0,0,0,0.04)',
          }}>
            {/* Cover */}
            <CoverUpload
              projectPath={activeProject.path}
              coverImage={activeProject.coverImage}
              onCoverChange={handleCoverChange}
            />

            {/* Project info */}
            <div style={{ marginTop: 28 }}>
              {/* Name & Type row */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                <h3 style={{ fontSize: 24, fontWeight: 700, color: '#2d2520', margin: 0 }}>
                  {activeProject.name}
                </h3>
                <select
                  value={novelCategory}
                  onChange={e => handleUpdateCategory(e.target.value)}
                  style={{
                    padding: '6px 16px', borderRadius: 8,
                    border: '1px solid rgba(124,58,237,0.2)',
                    background: 'rgba(124,58,237,0.04)',
                    color: '#7c3aed', fontSize: 12, fontWeight: 600,
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  {NOVEL_CATEGORIES.map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>

              {/* Stats row */}
              <div style={{ display: 'flex', gap: 0, marginBottom: 24, borderRadius: 16, background: 'rgba(124,58,237,0.03)', border: '1px solid rgba(124,58,237,0.06)', overflow: 'hidden' }}>
                <div style={{ flex: 1, textAlign: 'center', padding: '16px 12px' }}>
                  <div style={{ fontSize: 26, fontWeight: 700, color: '#7c3aed' }}>{activeProject.chapterCount}</div>
                  <div style={{ fontSize: 11, color: '#9b8e84', marginTop: 2 }}>完成章节</div>
                </div>
                <div style={{ width: 1, background: 'rgba(124,58,237,0.06)' }} />
                <div style={{ flex: 1, textAlign: 'center', padding: '16px 12px' }}>
                  <div style={{ fontSize: 26, fontWeight: 700, color: '#7c3aed' }}>{formatWordCount(activeProject.wordCount)}</div>
                  <div style={{ fontSize: 11, color: '#9b8e84', marginTop: 2 }}>已写字数</div>
                </div>
                <div style={{ width: 1, background: 'rgba(124,58,237,0.06)' }} />
                <div style={{ flex: 1, textAlign: 'center', padding: '16px 12px' }}>
                  <div style={{ fontSize: 26, fontWeight: 700, color: '#7c3aed' }}>{activeProject.type === 'imitation' ? '仿写' : activeProject.type === 'continuation' ? '续写' : '写作'}</div>
                  <div style={{ fontSize: 11, color: '#9b8e84', marginTop: 2 }}>项目类型</div>
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
                <button
                  onClick={() => handleEnterProject(activeProject)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6, flex: 1,
                    padding: '12px 0', borderRadius: 12, border: 'none', cursor: 'pointer',
                    background: 'linear-gradient(135deg, #7c3aed, #6d28d9)',
                    color: '#fff', fontSize: 14, fontWeight: 600, fontFamily: 'inherit',
                    justifyContent: 'center', transition: 'all 0.2s ease',
                  }}
                >
                  <ArrowRightIcon style={{ width: 16, height: 16 }} /> 进入项目
                </button>
                <button
                  onClick={() => handleExportProject(activeProject)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '12px 24px', borderRadius: 12,
                    border: '1px solid rgba(0,0,0,0.08)', cursor: 'pointer',
                    background: 'rgba(255,255,255,0.6)', color: '#4a3f38',
                    fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
                    transition: 'all 0.2s ease',
                  }}
                >
                  导出
                </button>
                <button
                  onClick={() => setDeleteTarget(activeProject)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '12px 24px', borderRadius: 12,
                    border: '1px solid rgba(239,68,68,0.2)', cursor: 'pointer',
                    background: 'rgba(239,68,68,0.04)', color: '#dc2626',
                    fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
                    transition: 'all 0.2s ease',
                  }}
                >
                  <TrashIcon style={{ width: 14, height: 14 }} /> 删除
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: 60, color: '#9b8e84' }}>
            <BookOpenIcon style={{ width: 64, height: 64, margin: '0 auto 16px', opacity: 0.2 }} />
            <p style={{ fontSize: 16, marginBottom: 4 }}>选择左侧项目</p>
            <p style={{ fontSize: 13 }}>或点击"新建"创建项目</p>
          </div>
        )}
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
          {/* Novel category selector — only for writing projects */}
          {newProjectType === 'writing' && (
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#6b5e54', marginBottom: 8 }}>
                小说类型
              </label>
              <select
                value={newNovelCategory}
                onChange={e => setNewNovelCategory(e.target.value)}
                style={{
                  width: '100%', padding: '10px 14px', borderRadius: 12,
                  border: '1px solid rgba(124,58,237,0.2)',
                  background: 'rgba(124,58,237,0.04)',
                  color: '#7c3aed', fontSize: 13, fontWeight: 600,
                  cursor: 'pointer', fontFamily: 'inherit', outline: 'none',
                }}
              >
                {NOVEL_CATEGORIES.map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="secondary" onClick={() => setShowCreate(false)}>取消</Button>
            <Button onClick={handleCreateProject} disabled={!newProjectName.trim()}>创建</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
