import { useNavigate, useLocation } from 'react-router-dom'
import { useMemo } from 'react'
import { useStore } from '@/store'
import {
  HomeIcon,
  GlobeAltIcon,
  UserGroupIcon,
  DocumentTextIcon,
  ListBulletIcon,
  BookOpenIcon,
  FlagIcon,
  PaintBrushIcon,
  Cog6ToothIcon,
  FolderIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline'

const NAV_ITEMS = [
  { path: '/', label: '首页', icon: HomeIcon },
  { path: '/worldbuilding', label: '世界观', icon: GlobeAltIcon },
  { path: '/characters', label: '角色', icon: UserGroupIcon },
  { path: '/outline', label: '小说大纲', icon: DocumentTextIcon },
  { path: '/detailed-outline', label: '小说细纲', icon: ListBulletIcon },
  { path: '/knowledge-base', label: '知识库', icon: BookOpenIcon },
  { path: '/story-map', label: '故事脉络', icon: FlagIcon },
  { path: '/style-workshop', label: '风格工坊', icon: PaintBrushIcon },
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

  const navItems = useMemo(() => {
    if (activeProjectId && detailedChapters.length > 0) {
      const items = [...NAV_ITEMS]
      items.splice(5, 0, { path: '/chapter', label: '章节创作', icon: BookOpenIcon })
      return items
    }
    return NAV_ITEMS
  }, [activeProjectId, detailedChapters.length])

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
    setActivePage(path === '/' ? 'home' : path.slice(1))
    navigate(path)
  }

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/'
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
                  setActiveProject(project.id)
                }
                setActivePage('home')
                navigate('/')
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
