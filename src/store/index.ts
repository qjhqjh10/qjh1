import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { persist } from 'zustand/middleware'
import type { Project } from '@/types/project'
import type { Character } from '@/types/character'
import type { DetailedChapter, WritingChapter } from '@/types/chapter'
import type { ModelConfig, PromptTemplate, AIAssistantSettings, DisplaySettings, ChapterGenSettings, OutlineTabToggles, DetailedOutlineToggles, RoleTemplate } from '@/types/settings'
import { DEFAULT_AI_SETTINGS, DEFAULT_DISPLAY_SETTINGS, DEFAULT_PROMPTS, DEFAULT_OUTLINE_TABS, DEFAULT_DETAILED_OUTLINE_TOGGLES } from '@/types/settings'

export interface PopupWindow {
  id: string
  type: 'outline' | 'worldbuilding' | 'draft' | 'kb'
  title: string
  documentKey?: string
}

// ---- App Store ----

export interface AppState {
  // Project
  projects: Project[]
  activeProjectId: string | null
  activeProjectName: string | null
  projectsBasePath: string
  imitationProjectsPath: string
  continuationProjectDirsPath: string

  // Worldbuilding
  worldbuildingContent: string

  // Characters
  characters: Character[]

  // Outline
  outlineContent: string

  // Detailed Outline
  detailedChapters: DetailedChapter[]

  // Chapter Writing
  writingChapters: Record<string, WritingChapter>
  currentChapterId: string | null

  // Chapter summaries (standalone files)
  chapterSummaryMap: Record<string, string>

  // UI
  activePage: string
  isAIChatOpen: boolean
  pendingMessage: string | null       // 待发送的消息（设置页"应用学习"等触发）
  sidebarCollapsed: boolean
  connectionStatus: 'connected' | 'disconnected' | 'checking'
  connectedModel: string

  // Insertion action (AI → editor)
  insertionAction: { keyword: string; content: string; position: 'before' | 'after'; mode?: 'insert' | 'rewrite' } | null
  replaceAction: { chapterId: string; content: string } | null
  fileEditNotify: { filePath: string; newContent: string } | null
  fileVersion: number
  rewriteContent: string

  // AI → 章节生成触发
  chapterGenTrigger: string | null
  setChapterGenTrigger: (chapterId: string | null) => void

  // Popup windows
  popupWindows: PopupWindow[]
  openPopup: (popup: PopupWindow) => void
  focusPopup: (popup: PopupWindow) => void
  closePopup: (id: string) => void

  // Actions - Project
  setProjectsBasePath: (p: string) => void
  setImitationProjectsPath: (p: string) => void
  setContinuationProjectDirsPath: (p: string) => void
  setProjects: (projects: Project[]) => void
  setActiveProject: (id: string | null, type?: string) => void
  setActiveProjectName: (name: string) => void
  addProject: (p: Project) => void
  removeProject: (id: string) => void

  // Actions - Worldbuilding
  setWorldbuildingContent: (content: string) => void

  // Actions - Characters
  setCharacters: (chars: Character[]) => void
  addCharacter: (char: Character) => void
  updateCharacter: (id: string, updates: Partial<Character>) => void
  removeCharacter: (id: string) => void

  // Actions - Outline
  setOutlineContent: (content: string) => void

  // Actions - Detailed Outline
  setDetailedChapters: (chapters: DetailedChapter[]) => void
  addDetailedChapter: (chapter: DetailedChapter) => void
  updateDetailedChapter: (id: string, updates: Partial<DetailedChapter>) => void
  removeDetailedChapter: (id: string) => void
  setChapterSummary: (chapterId: string, content: string) => void

  // Actions - Chapter Writing
  setWritingChapter: (chapterId: string, chapter: WritingChapter) => void
  setCurrentChapterId: (id: string | null) => void

  // Actions - UI
  setActivePage: (page: string) => void
  toggleAIChat: () => void
  setAIChatOpen: (open: boolean) => void
  setPendingMessage: (msg: string | null) => void
  toggleSidebar: () => void
  setConnectionStatus: (status: 'connected' | 'disconnected' | 'checking', model?: string) => void
  setInsertionAction: (action: { keyword: string; content: string; position: 'before' | 'after'; mode?: 'insert' | 'rewrite' } | null) => void
  setReplaceAction: (action: { chapterId: string; content: string } | null) => void
  setFileEditNotify: (notify: { filePath: string; newContent: string } | null) => void
  setRewriteContent: (content: string) => void

  // Actions - Reset
  resetProjectState: () => void
}

const initialProjectState = {
  worldbuildingContent: '',
  characters: [] as Character[],
  outlineContent: '',
  detailedChapters: [] as DetailedChapter[],
  writingChapters: {} as Record<string, WritingChapter>,
  currentChapterId: null as string | null,
  chapterSummaryMap: {} as Record<string, string>,
  insertionAction: null as { keyword: string; content: string; position: 'before' | 'after'; mode?: 'insert' | 'rewrite' } | null,
  replaceAction: null as { chapterId: string; content: string } | null,
  fileEditNotify: null as { filePath: string; newContent: string } | null,
  fileVersion: 0,
  rewriteContent: '',
  popupWindows: [],
  chapterGenTrigger: null as string | null,
}

export const useStore = create<AppState>()(
  immer((set, get) => ({
    projects: [],
    activeProjectId: null,
    activeProjectName: null,
    projectsBasePath: '',
    imitationProjectsPath: '',
    continuationProjectDirsPath: '',
    ...initialProjectState,
    activePage: 'home',
    chapterGenTrigger: null as string | null,
    isAIChatOpen: false,
    pendingMessage: null,
    sidebarCollapsed: false,
    connectionStatus: 'checking',
    connectedModel: '',
    setProjectsBasePath: (p) => set({ projectsBasePath: p }),
    setImitationProjectsPath: (p) => set({ imitationProjectsPath: p }),
    setContinuationProjectDirsPath: (p) => set({ continuationProjectDirsPath: p }),
    setProjects: (projects) => set(s => {
      // Preserve non-writing projects that are in the store but not on disk
      const existingIds = new Set(projects.map(p => p.id))
      const special = s.projects.filter(p => p.type !== 'writing' && !existingIds.has(p.id))
      const merged = [...projects]
      for (const sp of special) {
        if (!merged.find(p => p.id === sp.id)) merged.push(sp)
      }
      s.projects = merged
    }),
    setActiveProject: (id, projectType) => set(s => {
      s.activeProjectId = id || null
      // Always sync the project type in the projects array
      if (id && projectType) {
        const existing = s.projects.find(p => p.id === id)
        if (existing) {
          (existing as any).type = projectType
        } else {
          s.projects.push({ id, name: s.activeProjectName || id, path: '', chapterCount: 0, wordCount: 0, type: projectType as any })
        }
      }
    }),
    setActiveProjectName: (name) => set(s => {
      s.activeProjectName = name
      // Update the name in the projects list too
      const p = s.projects.find(p => p.id === s.activeProjectId)
      if (p) p.name = name
    }),
    addProject: (p) => set(s => { s.projects.push(p) }),
    removeProject: (id) => set(s => {
      s.projects = s.projects.filter(p => p.id !== id)
      if (s.activeProjectId === id) {
        s.activeProjectId = null
        Object.assign(s, initialProjectState)
      }
    }),

    setWorldbuildingContent: (content) => set({ worldbuildingContent: content }),

    setCharacters: (chars) => set({ characters: chars }),
    addCharacter: (char) => set(s => { s.characters.push(char) }),
    updateCharacter: (id, updates) => set(s => {
      const idx = s.characters.findIndex(c => c.id === id)
      if (idx !== -1) Object.assign(s.characters[idx], updates)
    }),
    removeCharacter: (id) => set(s => {
      s.characters = s.characters.filter(c => c.id !== id)
    }),

    setOutlineContent: (content) => set({ outlineContent: content }),

    setDetailedChapters: (chapters) => set({ detailedChapters: chapters }),
    addDetailedChapter: (chapter) => set(s => { s.detailedChapters.push(chapter) }),
    updateDetailedChapter: (id, updates) => set(s => {
      const idx = s.detailedChapters.findIndex(c => c.id === id)
      if (idx !== -1) Object.assign(s.detailedChapters[idx], updates)
    }),
    removeDetailedChapter: (id) => set(s => {
      s.detailedChapters = s.detailedChapters.filter(c => c.id !== id)
    }),

    setChapterSummary: (chapterId, content) => set(s => {
      s.chapterSummaryMap[chapterId] = content
    }),

    setWritingChapter: (chapterId, chapter) => set(s => {
      s.writingChapters[chapterId] = chapter
    }),
    setCurrentChapterId: (id) => set({ currentChapterId: id }),

    setActivePage: (page) => set({ activePage: page }),
    toggleAIChat: () => set(s => { s.isAIChatOpen = !s.isAIChatOpen }),
    setAIChatOpen: (open) => set({ isAIChatOpen: open }),
    setPendingMessage: (msg) => set({ pendingMessage: msg }),
    toggleSidebar: () => set(s => { s.sidebarCollapsed = !s.sidebarCollapsed }),
    setConnectionStatus: (status, model) => set({ connectionStatus: status, connectedModel: model ?? get().connectedModel }),
    setInsertionAction: (action) => set({ insertionAction: action }),
    setReplaceAction: (action: { chapterId: string; content: string } | null) => set({ replaceAction: action }),
    openPopup: (popup) => set(s => { s.popupWindows = [...s.popupWindows.filter(p => p.id !== popup.id), popup] }),
    focusPopup: (popup) => set(s => { const idx = s.popupWindows.findIndex(p => p.id === popup.id); if (idx >= 0) { s.popupWindows = [...s.popupWindows.slice(0, idx), ...s.popupWindows.slice(idx + 1), s.popupWindows[idx]] } }),
    closePopup: (id) => set(s => { s.popupWindows = s.popupWindows.filter(p => p.id !== id) }),
    setFileEditNotify: (notify) => set(s => { s.fileEditNotify = notify; if (notify) s.fileVersion++ }),
    setRewriteContent: (content: string) => set({ rewriteContent: content }),
    setChapterGenTrigger: (chapterId) => set({ chapterGenTrigger: chapterId }),

    resetProjectState: () => set(s => { Object.assign(s, initialProjectState) }),
  }))
)

// ---- Settings Store (persisted) ----

export interface SettingsState {
  configs: ModelConfig[]
  activeConfigId: string | null
  prompts: PromptTemplate[]
  aiSettings: AIAssistantSettings
  displaySettings: DisplaySettings
  setConfigs: (configs: ModelConfig[]) => void
  addConfig: (config: ModelConfig) => void
  updateConfig: (id: string, updates: Partial<ModelConfig>) => void
  removeConfig: (id: string) => void
  setActiveConfig: (id: string | null) => void
  setPrompts: (prompts: PromptTemplate[]) => void
  addPrompt: (prompt: PromptTemplate) => void
  updatePrompt: (id: string, updates: Partial<PromptTemplate>) => void
  removePrompt: (id: string) => void
  setAISettings: (settings: Partial<AIAssistantSettings>) => void
  setDisplaySettings: (settings: Partial<DisplaySettings>) => void
  // v13.0: 角色模板
  addRoleTemplate: (template: RoleTemplate) => void
  updateRoleTemplate: (id: string, updates: Partial<RoleTemplate>) => void
  removeRoleTemplate: (id: string) => void
  setActiveRoleTemplate: (id: string) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    immer((set) => ({
      configs: [],
      activeConfigId: null,
      prompts: DEFAULT_PROMPTS,
      aiSettings: DEFAULT_AI_SETTINGS,
      displaySettings: DEFAULT_DISPLAY_SETTINGS,
      setConfigs: (configs) => set({ configs }),
      addConfig: (config) => set(s => { s.configs.push(config) }),
      updateConfig: (id, updates) => set(s => {
        const idx = s.configs.findIndex(c => c.id === id)
        if (idx !== -1) Object.assign(s.configs[idx], updates)
      }),
      removeConfig: (id) => set(s => {
        s.configs = s.configs.filter(c => c.id !== id)
        if (s.activeConfigId === id) s.activeConfigId = null
      }),
      setActiveConfig: (id) => set({ activeConfigId: id }),
      setPrompts: (prompts) => set({ prompts }),
      addPrompt: (prompt) => set(s => { s.prompts.push(prompt) }),
      updatePrompt: (id, updates) => set(s => {
        const idx = s.prompts.findIndex(p => p.id === id)
        if (idx !== -1) Object.assign(s.prompts[idx], updates)
      }),
      removePrompt: (id) => set(s => {
        s.prompts = s.prompts.filter(p => p.id !== id)
      }),
      setAISettings: (settings) => set(s => { Object.assign(s.aiSettings, settings) }),
      setDisplaySettings: (settings) => set(s => { Object.assign(s.displaySettings, settings) }),
      // v13.0: 角色模板
      addRoleTemplate: (template) => set(s => {
        s.aiSettings.roleTemplates.push(template)
        if (!s.aiSettings.activeRoleTemplateId) s.aiSettings.activeRoleTemplateId = template.id
      }),
      updateRoleTemplate: (id, updates) => set(s => {
        const idx = s.aiSettings.roleTemplates.findIndex(t => t.id === id)
        if (idx !== -1) Object.assign(s.aiSettings.roleTemplates[idx], updates)
      }),
      removeRoleTemplate: (id) => set(s => {
        const prevIdx = s.aiSettings.roleTemplates.findIndex(t => t.id === id)
        s.aiSettings.roleTemplates = s.aiSettings.roleTemplates.filter(t => t.id !== id)
        if (s.aiSettings.activeRoleTemplateId === id) {
          const fallbackIdx = Math.min(prevIdx, s.aiSettings.roleTemplates.length - 1)
          s.aiSettings.activeRoleTemplateId = s.aiSettings.roleTemplates[fallbackIdx]?.id || ''
        }
      }),
      setActiveRoleTemplate: (id) => set(s => { s.aiSettings.activeRoleTemplateId = id }),
    })),
    {
      name: 'novel-writer-settings',
      version: 5,
      partialize: (state) => ({
        ...state,
        configs: (state as SettingsState).configs.map(c => ({ ...c, apiKey: '', mainApiKey: '', imageApiKey: '', embeddingApiKey: '' })),
      }),
      migrate: (persisted: unknown, version: number) => {
        if (version < 1) {
          const p = (persisted && typeof persisted === 'object' ? persisted : {}) as Record<string, unknown>
          return {
            configs: Array.isArray(p.configs) ? p.configs as ModelConfig[] : [],
            activeConfigId: typeof p.activeConfigId === 'string' ? p.activeConfigId : null,
            prompts: Array.isArray(p.prompts) && (p.prompts as PromptTemplate[]).length > 0
              ? p.prompts : DEFAULT_PROMPTS,
            aiSettings: { ...DEFAULT_AI_SETTINGS, ...(p.aiSettings && typeof p.aiSettings === 'object' ? p.aiSettings as Partial<AIAssistantSettings> : {}) },
            displaySettings: { ...DEFAULT_DISPLAY_SETTINGS, ...(p.displaySettings && typeof p.displaySettings === 'object' ? p.displaySettings as Partial<DisplaySettings> : {}) },
          }
        }
        if (version < 2) {
          const p = (persisted && typeof persisted === 'object' ? persisted : {}) as Record<string, unknown>
          const aiSettings = (p.aiSettings && typeof p.aiSettings === 'object' ? p.aiSettings : {}) as Record<string, unknown>
          const oldCG = (aiSettings.chapterGen && typeof aiSettings.chapterGen === 'object' ? aiSettings.chapterGen : {}) as Record<string, unknown>

          const migrateOutlineTabs = (): OutlineTabToggles => ({
            ...DEFAULT_OUTLINE_TABS,
            plot: oldCG.useOutline === true,
            worldbuilding: oldCG.useWorldbuilding === true,
            characters: oldCG.useCharacters === true,
          })

          const migrateDetailedToggles = (): DetailedOutlineToggles => ({
            ...DEFAULT_DETAILED_OUTLINE_TOGGLES,
            plotOverview: oldCG.useDetailedOutline === true,
            chapterCharacters: oldCG.useDetailedOutline === true,
            location: oldCG.useDetailedOutline === true,
            keyEvents: oldCG.useDetailedOutline === true,
          })

          const newChapterGen: ChapterGenSettings = {
            outlineTabs: migrateOutlineTabs(),
            detailedOutlineFields: migrateDetailedToggles(),
            wordTarget: typeof oldCG.wordTarget === 'number' ? oldCG.wordTarget : 4000,
            streamMode: oldCG.streamMode === true,
            replaceMode: oldCG.replaceMode !== false,
            selectedSceneId: typeof oldCG.selectedSceneId === 'string' ? oldCG.selectedSceneId : '',
            selectedStyleTemplateId: typeof oldCG.selectedStyleTemplateId === 'string' ? oldCG.selectedStyleTemplateId : '',
            selectedCharacterIds: Array.isArray(oldCG.selectedCharacterIds) ? oldCG.selectedCharacterIds : [],
            selectedSummaryIds: Array.isArray(oldCG.selectedSummaryIds) ? oldCG.selectedSummaryIds : [],
            selectedKbFileIds: Array.isArray(oldCG.selectedKbFileIds) ? oldCG.selectedKbFileIds : [],
            styleStrength: (oldCG as any).styleStrength === 'light' || (oldCG as any).styleStrength === 'strong' ? (oldCG as any).styleStrength : 'normal',
            prevTextEnabled: typeof (oldCG as any).prevTextEnabled === 'boolean' ? (oldCG as any).prevTextEnabled : true,
            prevTextSourceChapterId: typeof (oldCG as any).prevTextSourceChapterId === 'string' ? (oldCG as any).prevTextSourceChapterId : '',
            prevTextSelectedContent: typeof (oldCG as any).prevTextSelectedContent === 'string' ? (oldCG as any).prevTextSelectedContent : '',
          }

          return {
            ...p,
            aiSettings: { ...aiSettings, chapterGen: newChapterGen },
          }
        }
        if (version < 3) {
          const p = (persisted && typeof persisted === 'object' ? persisted : {}) as Record<string, unknown>
          const ds = (p.displaySettings && typeof p.displaySettings === 'object' ? p.displaySettings : {}) as Record<string, unknown>
          let theme = 'warm-purple'
          if (ds.theme === 'dark') theme = 'neon-dark'
          else if (ds.theme === 'light') theme = 'warm-purple'
          else if (typeof ds.theme === 'string' && ds.theme !== 'light' && ds.theme !== 'dark') theme = ds.theme
          return { ...p, displaySettings: { ...ds, theme } }
        }
        if (version < 4) {
          // v4: ModelConfig type restructured — clear old configs to avoid immer proxy errors
          const p = (persisted && typeof persisted === 'object' ? persisted : {}) as Record<string, unknown>
          return { ...p, configs: [], activeConfigId: null }
        }
        if (version < 5) {
          // v5 (v13.0): 多角色系统 — 从旧 customRoles 迁移到 roleTemplates
          const p = (persisted && typeof persisted === 'object' ? persisted : {}) as Record<string, unknown>
          const ai = (p.aiSettings && typeof p.aiSettings === 'object' ? p.aiSettings : {}) as Record<string, unknown>
          const oldRoles = Array.isArray(ai.customRoles) ? ai.customRoles as { id: string; name: string; prompt: string }[] : []
          const hasTemplates = Array.isArray(ai.roleTemplates) && (ai.roleTemplates as unknown[]).length > 0
          if (oldRoles.length > 0 && !hasTemplates) {
            // 内联 createDefaultCharacter + createDefaultRoleTemplate（migrate 必须同步）
            const makeChar = (isUser: boolean, name: string, identity: string, personality = '', relationship = ''): Record<string, unknown> => ({
              id: `char_mig_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              name, identity, gender: '男', personality,
              avatar: '', relationship: relationship || (isUser ? '' : 'AI助手'),
              isUser, firstMessage: isUser ? undefined : `你好！我是${name}，有什么可以帮你的？`,
              exampleDialogue: '',
            })
            const aiChars = oldRoles.map(r => makeChar(false, r.name, '助手', r.prompt))
            const template: Record<string, unknown> = {
              id: `rt_mig_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              name: '经典模式',
              characters: [makeChar(true, '写作者', '作者'), ...aiChars],
              worldSetting: '',
              scenarioSetting: '',
            }
            return {
              ...p,
              aiSettings: {
                ...ai,
                roleTemplates: [template],
                activeRoleTemplateId: template.id,
              },
            }
          }
          // 确保字段存在
          const updatedAi = { ...ai }
          if (!Array.isArray(updatedAi.roleTemplates)) (updatedAi as any).roleTemplates = []
          if (typeof updatedAi.activeRoleTemplateId !== 'string') (updatedAi as any).activeRoleTemplateId = ''
          return { ...p, aiSettings: updatedAi }
        }
        return persisted
      },
    }
  )
)
