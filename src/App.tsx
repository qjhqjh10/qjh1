import { useEffect, useCallback, Component } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { appService, projectService, settingsService, aiService } from '@/services/fileService'
import { useStore, useSettingsStore } from '@/store'
import type { Project } from '@/types/project'
import type { ModelConfig } from '@/types/settings'
import { logError } from '@/utils/logger'

class ErrorBoundary extends Component<{ children: React.ReactNode }, { error: Error | null }> {
  constructor(props: { children: React.ReactNode }) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 20, color: '#dc2626', fontSize: 13, lineHeight: 1.8, fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
          <strong>AI 助手加载失败:</strong>{"\n"}{this.state.error.message}{"\n\n"}{this.state.error.stack}
        </div>
      )
    }
    return this.props.children
  }
}
import AppLayout from '@/components/layout/AppLayout'
import HomePage from '@/components/pages/HomePage'
import WorldbuildingPage from '@/components/pages/WorldbuildingPage'
import CharactersPage from '@/components/pages/CharactersPage'
import OutlinePage from '@/components/pages/OutlinePage'
import DetailedOutlinePage from '@/components/pages/DetailedOutlinePage'
import ChapterWritingPage from '@/components/pages/ChapterWritingPage'
import KnowledgeBasePage from '@/components/pages/KnowledgeBasePage'
import SystemSettingsPage from '@/components/pages/SystemSettingsPage'
import StoryMapPage from '@/components/pages/StoryMapPage'
import FloatingAIButton from '@/components/ai/FloatingAIButton'
import AIChatWindow from '@/components/ai/AIChatWindow'

function NotFound() {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8 }}>
      <h2 style={{ fontSize: 48, fontWeight: 700, color: '#d4ccc4' }}>404</h2>
      <p style={{ fontSize: 14, color: '#9b8e84' }}>页面不存在</p>
    </div>
  )
}

function AnimatedRoutes() {
  const location = useLocation()
  const routeKey = location.pathname.split('/')[1] || '/'

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={routeKey}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        style={{ flex: 1, overflow: 'hidden', display: 'flex' }}
      >
        <Routes location={location}>
          <Route path="/" element={<HomePage />} />
          <Route path="/worldbuilding" element={<WorldbuildingPage />} />
          <Route path="/characters" element={<CharactersPage />} />
          <Route path="/outline" element={<OutlinePage />} />
          <Route path="/detailed-outline" element={<DetailedOutlinePage />} />
          <Route path="/chapter/:chapterId" element={<ChapterWritingPage />} />
          <Route path="/knowledge-base" element={<KnowledgeBasePage />} />
          <Route path="/story-map" element={<StoryMapPage />} />
          <Route path="/settings" element={<SystemSettingsPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </motion.div>
    </AnimatePresence>
  )
}

export default function App() {
  const setProjectsBasePath = useStore(s => s.setProjectsBasePath)
  const setConnectionStatus = useStore(s => s.setConnectionStatus)
  const setProjects = useStore(s => s.setProjects)
  const projectsBasePath = useStore(s => s.projectsBasePath)

  const editorFontSize = useSettingsStore(s => s.editorFontSize)
  const displaySettings = useSettingsStore(s => s.displaySettings)
  const activeConfigId = useSettingsStore(s => s.activeConfigId)
  const configs = useSettingsStore(s => s.configs)

  useEffect(() => {
    appService.getProjectsBasePath().then(setProjectsBasePath)
  }, [setProjectsBasePath])

  // Load configs from electron-store into Zustand on startup (two-way sync)
  useEffect(() => {
    settingsService.loadConfigs().then(storedConfigs => {
      const existingConfigs = useSettingsStore.getState().configs
      if (existingConfigs.length === 0 && Array.isArray(storedConfigs) && storedConfigs.length > 0) {
        useSettingsStore.getState().setConfigs(storedConfigs as ModelConfig[])
      }
    }).catch((e) => { logError('从 electron-store 加载配置失败', e) })
  }, [])

  // Load projects on startup so sidebar is never empty
  const loadProjects = useCallback(async () => {
    if (!projectsBasePath) return
    try {
      const names = await projectService.listProjects(projectsBasePath)
      const projList: Project[] = []
      for (const name of names) {
        const meta = await projectService.getMeta(`${projectsBasePath}/${name}`)
        projList.push({ id: name, ...meta })
      }
      setProjects(projList)
    } catch (e) { logError('加载项目列表失败', e) }
  }, [projectsBasePath, setProjects])

  useEffect(() => {
    if (projectsBasePath) loadProjects()
  }, [projectsBasePath, loadProjects])

  // Check API connection (re-checks when config changes)
  useEffect(() => {
    const check = async () => {
      const config = configs.find(c => c.id === activeConfigId)
      if (!config?.apiUrl) { setConnectionStatus('disconnected'); return }
      try {
        const models = await aiService.listModels(config.id)
        setConnectionStatus(models.length > 0 ? 'connected' : 'disconnected', config.model)
      } catch (e) { logError('检查 API 连接失败', e); setConnectionStatus('disconnected') }
    }
    check()
    const timer = setInterval(check, 5 * 60 * 1000)
    return () => clearInterval(timer)
  }, [setConnectionStatus, activeConfigId, configs])

  // Apply display font settings
  useEffect(() => {
    document.documentElement.style.setProperty('--editor-font-size', editorFontSize)
    document.documentElement.style.setProperty('--sidebar-font-size', displaySettings.sidebarFontSize)
    document.documentElement.style.setProperty('--card-title-font-size', displaySettings.cardTitleFontSize)
    document.documentElement.style.setProperty('--button-font-size', displaySettings.buttonFontSize)
    document.documentElement.style.setProperty('--toolbar-font-size', displaySettings.toolbarFontSize)
  }, [editorFontSize, displaySettings])

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <AppLayout />
      <ErrorBoundary><AnimatedRoutes /></ErrorBoundary>
      <FloatingAIButton />
      <ErrorBoundary><AIChatWindow /></ErrorBoundary>
    </div>
  )
}
