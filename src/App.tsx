import { useEffect, useCallback, Component } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { appService, projectService, settingsService, aiService, continuationService } from '@/services/fileService'
import { useStore, useSettingsStore } from '@/store'
import type { Project } from '@/types/project'
import type { ModelConfig } from '@/types/settings'
import { DEFAULT_PROMPTS } from '@/types/settings'
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
import OutlinePage from '@/components/pages/OutlinePage'
import DetailedOutlinePage from '@/components/pages/DetailedOutlinePage'
import ChapterWritingPage from '@/components/pages/ChapterWritingPage'
import KnowledgeBasePage from '@/components/pages/KnowledgeBasePage'
import SystemSettingsPage from '@/components/pages/SystemSettingsPage'
import StoryMapPage from '@/components/pages/StoryMapPage'
import StyleWorkshopPage from '@/components/pages/StyleWorkshopPage'
import ContinuationPage from '@/components/pages/ContinuationPage'
import ContinuationWorkspacePage from '@/components/pages/ContinuationWorkspacePage'
import ContinuationOutlinePage from '@/components/pages/ContinuationOutlinePage'
import ContinuationDetailedPage from '@/components/pages/ContinuationDetailedPage'
import ContinuationWritingPage from '@/components/pages/ContinuationWritingPage'
import SceneWorkshopPage from '@/components/pages/SceneWorkshopPage'
import ImitationPage from '@/components/pages/ImitationPage'
import ImitationOutlinePage from '@/components/pages/ImitationOutlinePage'
import ImitationDetailedPage from '@/components/pages/ImitationDetailedPage'
import RewritePage from '@/components/pages/RewritePage'
import OperationHistoryPage from '@/components/pages/OperationHistoryPage'
import ScratchpadPage from '@/components/pages/ScratchpadPage'
import FloatingAIButton from '@/components/ai/FloatingAIButton'
import AIChatWindow from '@/components/ai/AIChatWindow'
import PopupWindow from '@/components/ai/PopupWindow'

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
          <Route path="/characters" element={<Navigate to="/outline?tab=characters" replace />} />
          <Route path="/outline" element={<OutlinePage />} />
          <Route path="/detailed-outline" element={<DetailedOutlinePage />} />
          <Route path="/chapter/:chapterId" element={<ChapterWritingPage />} />
          <Route path="/knowledge-base" element={<KnowledgeBasePage />} />
          <Route path="/story-map" element={<StoryMapPage />} />
          <Route path="/style-workshop" element={<StyleWorkshopPage />} />
          <Route path="/style-templates" element={<Navigate to="/style-workshop" replace />} />
          <Route path="/continuation" element={<ContinuationPage />} />
          <Route path="/continuation-workspace" element={<ContinuationWorkspacePage />} />
          <Route path="/continuation-outline" element={<ContinuationOutlinePage />} />
          <Route path="/continuation-detailed" element={<ContinuationDetailedPage />} />
          <Route path="/continuation-writing" element={<ContinuationWritingPage />} />
          <Route path="/scene-workshop" element={<SceneWorkshopPage />} />
          <Route path="/imitation" element={<ImitationPage />} />
          <Route path="/imitation-outline" element={<ImitationOutlinePage />} />
          <Route path="/imitation-detailed" element={<ImitationDetailedPage />} />
          <Route path="/rewrite" element={<RewritePage />} />
          <Route path="/operation-history" element={<OperationHistoryPage />} />
          <Route path="/scratchpad" element={<ScratchpadPage />} />
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

  const displaySettings = useSettingsStore(s => s.displaySettings)
  const activeConfigId = useSettingsStore(s => s.activeConfigId)
  const configs = useSettingsStore(s => s.configs)

  useEffect(() => {
    appService.getProjectsBasePath().then(setProjectsBasePath)
  }, [setProjectsBasePath])

  // Load configs from electron-store into Zustand on startup.
  // electron-store is authoritative (stores encrypted API keys); localStorage is a mirror.
  useEffect(() => {
    settingsService.loadConfigs().then(storedConfigs => {
      if (Array.isArray(storedConfigs) && storedConfigs.length > 0) {
        const existing = useSettingsStore.getState().configs
        const existingMap = new Map(existing.map(c => [c.id, c]))
        for (const sc of (storedConfigs as ModelConfig[])) {
          existingMap.set(sc.id, { ...existingMap.get(sc.id), ...sc } as ModelConfig)
        }
        useSettingsStore.getState().setConfigs([...existingMap.values()])
      }
    }).catch((e) => { logError('从 electron-store 加载配置失败', e) })
  }, [])

  // Merge DEFAULT_PROMPTS into user's prompts (adds new defaults without overwriting custom ones)
  useEffect(() => {
    const prompts = useSettingsStore.getState().prompts
    const existingIds = new Set(prompts.map(p => p.id))
    const missing = DEFAULT_PROMPTS.filter(p => !existingIds.has(p.id))
    if (missing.length > 0) {
      useSettingsStore.getState().setPrompts([...prompts, ...missing])
    }
  }, [])

  // Load projects on startup so sidebar is never empty
  const loadProjects = useCallback(async () => {
    if (!projectsBasePath) return
    try {
      const names = await projectService.listProjects(projectsBasePath)
      const projList: Project[] = []
      for (const name of names) {
        const meta = await projectService.getMeta(`${projectsBasePath}/${name}`)
        const pt = (meta.type as string) === 'imitation' ? 'imitation' : (meta.type as string) === 'continuation' ? 'continuation' : 'writing'
        projList.push({ id: name, ...meta, type: pt })
      }
      // Also load continuation-only projects (no project directory)
      try {
        const contList = await continuationService.list() as any[]
        const existingIds = new Set(projList.map(p => p.id))
        for (const cp of contList) {
          if (!existingIds.has(cp.id)) {
            projList.push({
              id: cp.id, name: cp.name, path: '',
              chapterCount: cp.writtenChapters?.length || 0,
              wordCount: cp.writtenChapters?.reduce((s: number, c: any) => s + (c.content?.length || 0), 0) || 0,
              type: 'continuation',
            })
          }
        }
      } catch { /* continuation service unavailable */ }
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

  // Apply display settings (font + theme)
  useEffect(() => {
    document.documentElement.style.setProperty('--editor-font-size', displaySettings.editorFontSize)
    document.documentElement.style.setProperty('--sidebar-font-size', displaySettings.sidebarFontSize)
    document.documentElement.style.setProperty('--card-title-font-size', displaySettings.cardTitleFontSize)
    document.documentElement.style.setProperty('--button-font-size', displaySettings.buttonFontSize)
    document.documentElement.style.setProperty('--toolbar-font-size', displaySettings.toolbarFontSize)

    // Dark mode
    if (displaySettings.theme === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [displaySettings])

  return (
    <ErrorBoundary>
      <div id="app-root" style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
        <AppLayout />
        <ErrorBoundary><AnimatedRoutes /></ErrorBoundary>
        <FloatingAIButton />
        <ErrorBoundary><AIChatWindow /></ErrorBoundary>
        <PopupWindowsLayer />
      </div>
    </ErrorBoundary>
  )
}

function PopupWindowsLayer() {
  const popupWindows = useStore(s => s.popupWindows)
  const focusPopup = useStore(s => s.focusPopup)

  if (popupWindows.length === 0) return null

  return (
    <>
      {popupWindows.map((pw, i) => (
        <PopupWindow
          key={pw.id}
          popup={pw}
          zIndex={i}
          onFocus={() => focusPopup(pw)}
        />
      ))}
    </>
  )
}
