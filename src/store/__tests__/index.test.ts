import { describe, it, expect, beforeEach } from 'vitest'
import { useStore, useSettingsStore } from '@/store'
import type { Character } from '@/types/character'
import type { DetailedChapter } from '@/types/chapter'

describe('useStore', () => {
  beforeEach(() => {
    useStore.setState({ projects: [], characters: [], detailedChapters: [], writingChapters: {}, sidebarCollapsed: false, connectionStatus: 'checking', connectedModel: '', isAIChatOpen: false })
  })

  it('adds a project', () => {
    useStore.getState().addProject({ id: '1', name: '测试', path: '/test', chapterCount: 0, wordCount: 0, type: 'writing' })
    expect(useStore.getState().projects).toHaveLength(1)
  })

  it('removes a project', () => {
    useStore.getState().addProject({ id: '1', name: '测试', path: '/test', chapterCount: 0, wordCount: 0, type: 'writing' })
    useStore.getState().removeProject('1')
    expect(useStore.getState().projects).toHaveLength(0)
  })

  it('manages characters', () => {
    const char: Character = {
      id: 'c1', name: '主角', role: '男主', gender: '男', age: '25',
      occupation: '', background: '', appearance: '', personality: '',
      abilities: '', weaknesses: '', relationships: '', relationshipTags: [], arc: '', importance: 50,
    }
    useStore.getState().addCharacter(char)
    expect(useStore.getState().characters).toHaveLength(1)

    useStore.getState().updateCharacter('c1', { name: '新名字' })
    expect(useStore.getState().characters[0].name).toBe('新名字')

    useStore.getState().removeCharacter('c1')
    expect(useStore.getState().characters).toHaveLength(0)
  })

  it('manages detailed chapters', () => {
    const chapter: DetailedChapter = {
      id: 'dc1', title: '第一章', description: '', summary: '', order: 0, status: 'incomplete',
    }
    useStore.getState().addDetailedChapter(chapter)
    expect(useStore.getState().detailedChapters).toHaveLength(1)

    useStore.getState().updateDetailedChapter('dc1', { title: '新标题' })
    expect(useStore.getState().detailedChapters[0].title).toBe('新标题')

    useStore.getState().removeDetailedChapter('dc1')
    expect(useStore.getState().detailedChapters).toHaveLength(0)
  })

  it('toggles sidebar', () => {
    expect(useStore.getState().sidebarCollapsed).toBe(false)
    useStore.getState().toggleSidebar()
    expect(useStore.getState().sidebarCollapsed).toBe(true)
  })

  it('sets connection status', () => {
    useStore.getState().setConnectionStatus('connected', 'gpt-4o')
    expect(useStore.getState().connectionStatus).toBe('connected')
    expect(useStore.getState().connectedModel).toBe('gpt-4o')
  })
})

describe('useSettingsStore', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      configs: [],
      activeConfigId: null,
      prompts: [],
    })
  })

  it('adds and removes model configs', () => {
    useSettingsStore.getState().addConfig({
      id: 'cfg1', name: 'GPT-4o', provider: 'openai', apiUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test', model: 'gpt-4o', cheapModel: '', reasoningModel: '', imageModel: '',
      imageProvider: '', imageApiUrl: '', imageApiKey: '',
      embeddingModel: 'text-embedding-3-small',
      temperature: 0.8, maxTokens: 0, systemPrompt: '', inputPricePerM: 2.5, outputPricePerM: 10, cacheHitPricePerM: 1.25, currency: 'USD' as const,
    })
    expect(useSettingsStore.getState().configs).toHaveLength(1)

    useSettingsStore.getState().removeConfig('cfg1')
    expect(useSettingsStore.getState().configs).toHaveLength(0)
  })

  it('updates active config', () => {
    useSettingsStore.getState().setActiveConfig('cfg1')
    expect(useSettingsStore.getState().activeConfigId).toBe('cfg1')

    useSettingsStore.getState().setActiveConfig(null)
    expect(useSettingsStore.getState().activeConfigId).toBeNull()
  })
})
