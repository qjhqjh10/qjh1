import { useState, type ReactNode } from 'react'
import { PlusIcon } from '@heroicons/react/24/outline'
import EmptyState from '@/components/common/EmptyState'
import ConfirmModal from '@/components/common/ConfirmModal'

export interface ProjectHubItem {
  id: string
  name: string
}

interface ProjectHubLayoutProps<T extends ProjectHubItem> {
  /** 左栏标题 */
  title: string
  /** 项目列表 */
  projects: T[]
  /** 当前选中项目 ID */
  activeProjectId: string | null
  /** 选中项目回调 */
  onSelectProject: (project: T) => void
  /** 新建项目回调 */
  onCreateProject: () => void
  /** 导入项目回调（不传则隐藏导入按钮） */
  onImportProject?: () => void
  /** 导入按钮文案 */
  importLabel?: string
  /** 新建按钮文案 */
  createLabel?: string
  /** 渲染单个项目项（名称 + 元信息），active 表示是否选中 */
  renderProjectItem: (project: T, active: boolean) => ReactNode
  /** 删除项目回调（不传则项目项上不显示删除） */
  onDeleteProject?: (project: T) => void
  /** 删除确认对话框文案定制 */
  deleteTitle?: string
  deleteMessage?: (name: string) => string
  /** 右栏空状态（无选中项目时） */
  renderEmptyState?: () => ReactNode
  /** 右栏项目详情（有选中项目时） */
  renderProjectDetail?: (project: T) => ReactNode
  /** 左栏宽度 */
  leftWidth?: number
  /** 左栏空列表定制 */
  emptyIcon?: string
  emptyTitle?: string
  emptyDescription?: string
}

export default function ProjectHubLayout<T extends ProjectHubItem>({
  title,
  projects,
  activeProjectId,
  onSelectProject,
  onCreateProject,
  onImportProject,
  importLabel = '导入',
  createLabel = '新建',
  renderProjectItem,
  onDeleteProject,
  deleteTitle = '删除项目',
  deleteMessage = (name) => `确定要删除项目「${name}」吗？此操作不可撤销。`,
  renderEmptyState,
  renderProjectDetail,
  leftWidth = 280,
  emptyIcon = '📁',
  emptyTitle = '暂无项目',
  emptyDescription = '点击新建开始创作',
}: ProjectHubLayoutProps<T>) {
  const [deleteTarget, setDeleteTarget] = useState<T | null>(null)

  const activeProject = activeProjectId ? projects.find(p => p.id === activeProjectId) : null

  return (
    <div className="page-enter" style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
      {/* ── Left Panel: Project List ── */}
      <div style={{
        width: leftWidth, flexShrink: 0, borderRight: '1px solid rgba(0,0,0,0.06)',
        display: 'flex', flexDirection: 'column',
        background: 'rgba(255,255,255,0.35)',
      }}>
        {/* Header */}
        <div style={{ padding: '20px 16px 12px' }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#2d2520', marginBottom: 12 }}>{title}</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onCreateProject}
              style={{
                flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                padding: '9px 0', borderRadius: 10, border: 'none', cursor: 'pointer',
                background: 'linear-gradient(135deg, #7c3aed, #8b5cf6)',
                color: '#fff', fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
                transition: 'all 0.2s ease',
              }}
            >
              <PlusIcon style={{ width: 15, height: 15 }} /> {createLabel}
            </button>
            {onImportProject && (
              <button
                onClick={onImportProject}
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  padding: '9px 12px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.08)',
                  background: 'rgba(255,255,255,0.6)', color: '#6b5e54', fontSize: 12, fontWeight: 600,
                  cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.2s ease',
                }}
              >
                {importLabel}
              </button>
            )}
          </div>
        </div>

        {/* Project list */}
        <div className="custom-scrollbar" style={{ flex: 1, overflow: 'auto', padding: '0 10px 12px' }}>
          {projects.map(project => {
            const active = activeProjectId === project.id
            return (
              <div
                key={project.id}
                onClick={() => onSelectProject(project)}
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
                  {renderProjectItem(project, active)}
                </div>
                {onDeleteProject && (
                  <button
                    onClick={e => { e.stopPropagation(); setDeleteTarget(project) }}
                    title="删除项目"
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer', padding: 4,
                      color: '#d4ccc4', flexShrink: 0, borderRadius: 6,
                      display: 'flex', alignItems: 'center',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.color = '#dc2626' }}
                    onMouseLeave={e => { e.currentTarget.style.color = '#d4ccc4' }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m3 0v14a1 1 0 01-1 1H6a1 1 0 01-1-1V6h14M10 11v6M14 11v6" />
                    </svg>
                  </button>
                )}
              </div>
            )
          })}
          {projects.length === 0 && (
            <div style={{ padding: 16 }}>
              <EmptyState icon={emptyIcon} title={emptyTitle} description={emptyDescription}
                action={{ label: createLabel + '项目', onClick: onCreateProject }} />
            </div>
          )}
        </div>
      </div>

      {/* ── Right Panel: Detail / Empty ── */}
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.25)' }}>
        {activeProject ? (
          renderProjectDetail ? (
            renderProjectDetail(activeProject)
          ) : (
            <EmptyState icon="📄" title={activeProject.name} description="选择左侧项目查看详情" />
          )
        ) : (
          renderEmptyState ? renderEmptyState() : (
            <EmptyState icon="📚" title={`选择左侧${title}`} description={`或点击${createLabel}创建项目`} />
          )
        )}
      </div>

      {/* Delete Confirmation */}
      {deleteTarget && (
        <ConfirmModal
          isOpen={true}
          title={deleteTitle}
          message={deleteMessage(deleteTarget.name)}
          confirmLabel="删除"
          danger
          onConfirm={() => { onDeleteProject?.(deleteTarget!); setDeleteTarget(null) }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}
