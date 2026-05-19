import { useNavigate, useLocation } from 'react-router-dom'
import { useMemo } from 'react'
import { useStore } from '@/store'
import {
  HomeIcon,
  DocumentTextIcon,
  ListBulletIcon,
  BookOpenIcon,
  FlagIcon,
  PaintBrushIcon,
  SparklesIcon,
  DocumentMagnifyingGlassIcon,
  Cog6ToothIcon,
  FolderIcon,
  TagIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline'

interface NavItem {
  path: string
  label: string
  icon: typeof HomeIcon
}

// Always-visible items (no project required)
const COMMON_ITEMS: NavItem[] = [
  { path: '/knowledge-base', label: '知识库', icon: BookOpenIcon },
  { path: '/story-map', label: '故事脉络', icon: FlagIcon },
  { path: '/style-workshop', label: '风格工坊', icon: PaintBrushIcon },
  { path: '/style-templates', label: '风格模板', icon: TagIcon },
  { path: '/scene-workshop', label: '场景工坊', icon: SparklesIcon },
  { path: '/continuation', label: '小说续写', icon: BookOpenIcon },
]

const WRITING_ITEMS: NavItem[] = [
  { path: '/outline', label: '大纲', icon: DocumentTextIcon },
  { path: '/detailed-outline', label: '细纲', icon: ListBulletIcon },
]

const IMITATION_ITEMS: NavItem[] = [
  { path: '/imitation', label: '小说仿写', icon: DocumentMagnifyingGlassIcon },
  { path: '/imitation-outline', label: '(仿写)大纲', icon: DocumentTextIcon },
  { path: '/imitation-detailed', label: '(仿写)细纲', icon: ListBulletIcon },
]

export default function Sidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const projects = useStore(s => s.projects)
  const activeProjectId = useStore(s => s.activeProjectId)
  const setActiveProject = useStore(s => s.setActiveProject)
  const setActivePage = useStore(s => s.setActivePage)
  const resetProjectState = useStore(s => s.resetProjectState)
  const collapsed = useStore(s => s.sidebarCollapsed)
  const toggleSidebar = useStore(s => s.toggleSidebar)
  const connectionStatus = useStore(s => s.connectionStatus)
  const connectedModel = useStore(s => s.connectedModel)
  const detailedChapters = useStore(s => s.detailedChapters)

  const activeProject = useMemo(() => projects.find(p => p.id === activeProjectId), [projects, activeProjectId])
  const activeProjectType = useStore(s => s.activeProjectType)
  const projectType = activeProject?.type || activeProjectType

  const navItems = useMemo((): NavItem[] => {
    const items: NavItem[] = [{ path: '/', label: '首页', icon: HomeIcon }]

    if (projectType === 'writing') {
      items.push(...WRITING_ITEMS)
      if (detailedChapters.length > 0) {
        items.push({ path: '/chapter', label: '章节创作', icon: BookOpenIcon })
      }
    } else if (projectType === 'imitation') {
      items.push(...IMITATION_ITEMS)
      if (detailedChapters.length > 0) {
        items.push({ path: '/chapter', label: '章节创作', icon: BookOpenIcon })
      }
    } else if (projectType === 'continuation') {
      items.push({ path: '/continuation-workspace', label: '续写工作台', icon: DocumentTextIcon })
      items.push({ path: '/continuation-outline', label: '(续写)大纲', icon: ListBulletIcon })
      items.push({ path: '/continuation-detailed', label: '(续写)细纲', icon: BookOpenIcon })
      if (detailedChapters.length > 0) {
        items.push({ path: '/chapter', label: '章节创作', icon: BookOpenIcon })
      }
    }

    items.push(...COMMON_ITEMS)
    return items
  }, [projectType, detailedChapters.length])

  const handleNav = (path: string) => {
    if (path === '/chapter') {
      if (detailedChapters.length > 0) {
        setActivePage('chapter')
        navigate(`/chapter/${detailedChapters[0].id}`)
        return
      }
      navigate('/detailed-outline')
      return
    }
    setActivePage(path === '/' ? 'home' : path.split('?')[0].slice(1))
    navigate(path)
  }

  const isActive = (path: string) => {
    if (path.includes('?')) {
      return location.pathname + location.search === path
    }
    if (path === '/') return location.pathname === '/'
    if (path === '/imitation') return location.pathname === '/imitation'
    return location.pathname.startsWith(path)
  }

  const width = collapsed ? 60 : 240
  const padX = collapsed ? 8 : 20

  return (
    <aside
      className="glass"
      style={{
        width,
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        padding: '12px 0',
        borderRight: 'none',
        transition: 'width 0.2s ease',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      {/* Toggle + Title */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: `0 ${padX}px`,
          marginBottom: 16,
          gap: collapsed ? 0 : 10,
        }}
      >
        {!collapsed && (
          <h1
            style={{
              flex: 1,
              fontSize: 16,
              fontWeight: 700,
              background: 'linear-gradient(135deg, #7c3aed 0%, #a78bfa 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              letterSpacing: 1,
              whiteSpace: 'nowrap',
            }}
          >
            AI 小说写作助手
          </h1>
        )}
        <button
          onClick={toggleSidebar}
          title={collapsed ? '展开侧边栏' : '收缩侧边栏'}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 32,
            height: 32,
            borderRadius: 10,
            color: '#8b7e74',
            flexShrink: 0,
            transition: 'all 0.15s ease',
            marginLeft: collapsed ? 'auto' : undefined,
            marginRight: collapsed ? 'auto' : undefined,
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.04)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
        >
          {collapsed ? (
            <ChevronRightIcon style={{ width: 18, height: 18 }} />
          ) : (
            <ChevronLeftIcon style={{ width: 18, height: 18 }} />
          )}
        </button>
      </div>

      {/* Project List */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {!collapsed && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: `0 ${padX}px`,
              marginBottom: 8,
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 600, color: '#9b8e84', textTransform: 'uppercase', letterSpacing: 1 }}>
              项目列表
            </span>
          </div>
        )}

        <div
          className="custom-scrollbar"
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: `0 ${collapsed ? 4 : 12}px`,
            maxHeight: collapsed ? undefined : 200,
          }}
        >
          {projects.map(project => (
            <button
              key={project.id}
              onClick={() => {
                if (activeProjectId !== project.id) {
                  resetProjectState()
                  setActiveProject(project.id, project.type)
                }
                setActivePage('home')
                navigate(project.type === 'imitation' ? '/imitation' : '/')
              }}
              title={collapsed ? project.name : undefined}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: collapsed ? 'center' : undefined,
                gap: 10,
                padding: collapsed ? '10px 0' : '10px 12px',
                borderRadius: 14,
                border: 'none',
                background: activeProjectId === project.id
                  ? 'rgba(124, 58, 237, 0.1)'
                  : 'transparent',
                cursor: 'pointer',
                fontSize: 'var(--sidebar-font-size, 13px)',
                color: activeProjectId === project.id ? '#7c3aed' : '#4a3f38',
                fontWeight: activeProjectId === project.id ? 600 : 400,
                transition: 'all 0.15s ease',
                marginBottom: 2,
                textAlign: 'left' as const,
              }}
            >
              <FolderIcon style={{ width: 16, height: 16, flexShrink: 0 }} />
              {!collapsed && (
                <>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    {project.type === 'imitation' && <span style={{ fontSize: 10, color: '#7c3aed', marginRight: 4, fontWeight: 600 }}>仿</span>}
                    {project.type === 'continuation' && <span style={{ fontSize: 10, color: '#16a34a', marginRight: 4, fontWeight: 600 }}>续</span>}
                    {project.name}
                  </span>
                  <span style={{ fontSize: 11, color: '#9b8e84', flexShrink: 0 }}>
                    {project.chapterCount}章
                  </span>
                </>
              )}
            </button>
          ))}
          {projects.length === 0 && !collapsed && (
            <div style={{ padding: '12px', textAlign: 'center', color: '#9b8e84', fontSize: 12 }}>
              暂无项目
            </div>
          )}
        </div>

        {/* Separator */}
        {!collapsed && (
          <div
            style={{
              margin: '12px 20px',
              height: 1,
              background: 'linear-gradient(90deg, transparent, rgba(0,0,0,0.08), transparent)',
            }}
          />
        )}

        {/* Nav Items */}
        <nav style={{ padding: `0 ${collapsed ? 4 : 12}px` }}>
          {navItems.map(item => (
            <button
              key={item.path}
              onClick={() => handleNav(item.path)}
              title={collapsed ? item.label : undefined}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: collapsed ? 'center' : undefined,
                gap: 10,
                padding: collapsed ? '10px 0' : '10px 12px',
                borderRadius: 14,
                border: 'none',
                background: isActive(item.path)
                  ? 'rgba(124, 58, 237, 0.1)'
                  : 'transparent',
                cursor: 'pointer',
                fontSize: 'var(--sidebar-font-size, 13px)',
                color: isActive(item.path) ? '#7c3aed' : '#4a3f38',
                fontWeight: isActive(item.path) ? 600 : 400,
                transition: 'all 0.15s ease',
                marginBottom: 2,
                textAlign: 'left' as const,
              }}
            >
              <item.icon style={{ width: 18, height: 18, flexShrink: 0 }} />
              {!collapsed && item.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Connection status */}
      {!collapsed && (
        <div style={{ padding: '0 12px', marginBottom: 4 }}>
          <button onClick={() => handleNav('/settings')} style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
            borderRadius: 10, border: 'none', cursor: 'pointer',
            background: 'rgba(0,0,0,0.02)', textAlign: 'left' as const,
          }}>
            <span style={{
              width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
              background: connectionStatus === 'connected' ? '#16a34a' : connectionStatus === 'disconnected' ? '#dc2626' : '#f59e0b',
            }} />
            <span style={{ fontSize: 10, color: '#6b5e54', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {connectionStatus === 'connected' ? `已连接 ${connectedModel}` : connectionStatus === 'disconnected' ? '无连接' : '检测中...'}
            </span>
          </button>
        </div>
      )}

      {/* Bottom: Settings */}
      <div style={{ padding: `0 ${collapsed ? 4 : 12}px`, marginTop: 'auto' }}>
        <button
          onClick={() => handleNav('/settings')}
          title={collapsed ? '系统设置' : undefined}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : undefined,
            gap: 10,
            padding: collapsed ? '10px 0' : '10px 12px',
            borderRadius: 14,
            border: 'none',
            background: isActive('/settings')
              ? 'rgba(124, 58, 237, 0.1)'
              : 'transparent',
            cursor: 'pointer',
            fontSize: 'var(--sidebar-font-size, 13px)',
            color: isActive('/settings') ? '#7c3aed' : '#4a3f38',
            fontWeight: isActive('/settings') ? 600 : 400,
            transition: 'all 0.15s ease',
            textAlign: 'left' as const,
          }}
        >
          <Cog6ToothIcon style={{ width: 18, height: 18, flexShrink: 0 }} />
          {!collapsed && '系统设置'}
        </button>
      </div>
    </aside>
  )
}
