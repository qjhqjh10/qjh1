import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { persist } from 'zustand/middleware'
import type { Project } from '@/types/project'
import type { Character } from '@/types/character'
import type { DetailedChapter, WritingChapter } from '@/types/chapter'
import type { ModelConfig, PromptTemplate, AIAssistantSettings, DisplaySettings } from '@/types/settings'
import { DEFAULT_AI_SETTINGS, DEFAULT_DISPLAY_SETTINGS, DEFAULT_PROMPTS } from '@/types/settings'

// ---- App Store ----

export interface AppState {
  // Project
  projects: Project[]
  activeProjectId: string | null
  activeProjectName: string | null
  projectsBasePath: string

  // Worldbuilding
  worldbuildingContent: string
  worldbuildingDirty: boolean

  // Characters
  characters: Character[]

  // Outline
  outlineContent: string
  outlineDirty: boolean

  // Detailed Outline
  detailedChapters: DetailedChapter[]

  // Chapter Writing
  writingChapters: Record<string, WritingChapter>
  currentChapterId: string | null

  // UI
  activePage: string
  isAIChatOpen: boolean
  isExportModalOpen: boolean
  sidebarCollapsed: boolean
  connectionStatus: 'connected' | 'disconnected' | 'checking'
  connectedModel: string

  // Insertion action (AI → editor)
  insertionAction: { keyword: string; content: string; position: 'before' | 'after' } | null
  replaceAction: { chapterId: string; content: string } | null

  // Actions - Project
  setProjectsBasePath: (p: string) => void
  setProjects: (projects: Project[]) => void
  setActiveProject: (id: string | null, type?: string) => void
  setActiveProjectName: (name: string) => void
  addProject: (p: Project) => void
  removeProject: (id: string) => void

  // Actions - Worldbuilding
  setWorldbuildingContent: (content: string) => void
  setWorldbuildingDirty: (dirty: boolean) => void

  // Actions - Characters
  setCharacters: (chars: Character[]) => void
  addCharacter: (char: Character) => void
  updateCharacter: (id: string, updates: Partial<Character>) => void
  removeCharacter: (id: string) => void

  // Actions - Outline
  setOutlineContent: (content: string) => void
  setOutlineDirty: (dirty: boolean) => void

  // Actions - Detailed Outline
  setDetailedChapters: (chapters: DetailedChapter[]) => void
  addDetailedChapter: (chapter: DetailedChapter) => void
  updateDetailedChapter: (id: string, updates: Partial<DetailedChapter>) => void
  removeDetailedChapter: (id: string) => void

  // Actions - Chapter Writing
  setWritingChapter: (chapterId: string, chapter: WritingChapter) => void
  removeWritingChapter: (chapterId: string) => void
  setCurrentChapterId: (id: string | null) => void

  // Actions - UI
  setActivePage: (page: string) => void
  toggleAIChat: () => void
  setAIChatOpen: (open: boolean) => void
  setExportModalOpen: (open: boolean) => void
  toggleSidebar: () => void
  setConnectionStatus: (status: 'connected' | 'disconnected' | 'checking', model?: string) => void
  setInsertionAction: (action: { keyword: string; content: string; position: 'before' | 'after' } | null) => void
  setReplaceAction: (action: { chapterId: string; content: string } | null) => void

  // Actions - Reset
  resetProjectState: () => void
}

const initialProjectState = {
  worldbuildingContent: '',
  worldbuildingDirty: false,
  characters: [] as Character[],
  outlineContent: '',
  outlineDirty: false,
  detailedChapters: [] as DetailedChapter[],
  writingChapters: {} as Record<string, WritingChapter>,
  currentChapterId: null as string | null,
}

export const useStore = create<AppState>()(
  immer((set, get) => ({
    projects: [],
    activeProjectId: null,
    activeProjectName: null,
    projectsBasePath: '',
    ...initialProjectState,
    activePage: 'home',
    isAIChatOpen: false,
    isExportModalOpen: false,
    sidebarCollapsed: false,
    connectionStatus: 'checking',
    connectedModel: '',
    insertionAction: null,
  replaceAction: null,

    setProjectsBasePath: (p) => set({ projectsBasePath: p }),
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
    setWorldbuildingDirty: (dirty) => set({ worldbuildingDirty: dirty }),

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
    setOutlineDirty: (dirty) => set({ outlineDirty: dirty }),

    setDetailedChapters: (chapters) => set({ detailedChapters: chapters }),
    addDetailedChapter: (chapter) => set(s => { s.detailedChapters.push(chapter) }),
    updateDetailedChapter: (id, updates) => set(s => {
      const idx = s.detailedChapters.findIndex(c => c.id === id)
      if (idx !== -1) Object.assign(s.detailedChapters[idx], updates)
    }),
    removeDetailedChapter: (id) => set(s => {
      s.detailedChapters = s.detailedChapters.filter(c => c.id !== id)
    }),

    setWritingChapter: (chapterId, chapter) => set(s => {
      s.writingChapters[chapterId] = chapter
    }),
    removeWritingChapter: (chapterId) => set(s => {
      delete s.writingChapters[chapterId]
    }),
    setCurrentChapterId: (id) => set({ currentChapterId: id }),

    setActivePage: (page) => set({ activePage: page }),
    toggleAIChat: () => set(s => { s.isAIChatOpen = !s.isAIChatOpen }),
    setAIChatOpen: (open) => set({ isAIChatOpen: open }),
    setExportModalOpen: (open) => set({ isExportModalOpen: open }),
    toggleSidebar: () => set(s => { s.sidebarCollapsed = !s.sidebarCollapsed }),
    setConnectionStatus: (status, model) => set({ connectionStatus: status, connectedModel: model ?? get().connectedModel }),
    setInsertionAction: (action) => set({ insertionAction: action }),
    setReplaceAction: (action: { chapterId: string; content: string } | null) => set({ replaceAction: action }),

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
    })),
    {
      name: 'novel-writer-settings',
      version: 1,
      partialize: (state) => ({
        ...state,
        configs: (state as SettingsState).configs.map(c => ({ ...c, apiKey: '' })),
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
        return persisted
      },
    }
  )
)
