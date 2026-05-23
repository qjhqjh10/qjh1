import { fileService } from '@/services/fileService'
import { logError } from '@/utils/logger'
import type { OutlineTabToggles } from '@/types/settings'
import type { OutlineItem, OutlineLocation, OutlineFaction, PowerSystem, EmotionData } from '@/types/outline'
import type { ForeshadowItem, PlotThread } from '@/types/story'

export async function loadOutlineData<T>(projectPath: string, filename: string, defaultValue: T): Promise<T> {
  try {
    const raw = await fileService.read(`${projectPath}/outline/${filename}`)
    if (raw) return JSON.parse(raw) as T
  } catch { /* file doesn't exist yet */ }
  return defaultValue
}

export async function saveOutlineData<T>(projectPath: string, filename: string, data: T): Promise<void> {
  try {
    await fileService.ensureDir(`${projectPath}/outline`)
    await fileService.write(`${projectPath}/outline/${filename}`, JSON.stringify(data, null, 2))
  } catch (err) {
    logError(`Failed to save outline data: ${filename}`, err)
  }
}

// ---- Prompt-building helpers for each outline dimension ----

async function loadItemsPrompt(projectPath: string): Promise<string> {
  try {
    const data = await loadOutlineData<{ items: OutlineItem[] }>(projectPath, 'items.json', { items: [] })
    if (!data.items?.length) return ''
    const lines = data.items.map(item => {
      const fields = [item.name, item.type, item.grade, item.ability, item.owner].filter(Boolean)
      return `- ${fields.join(' | ')}`
    })
    return `【道具】\n${lines.join('\n')}`
  } catch { return '' }
}

async function loadLocationsPrompt(projectPath: string): Promise<string> {
  try {
    const data = await loadOutlineData<{ locations: OutlineLocation[] }>(projectPath, 'locations.json', { locations: [] })
    if (!data.locations?.length) return ''
    const lines = data.locations.map(loc => {
      const fields = [loc.name, loc.type, loc.description].filter(Boolean)
      return `- ${fields.join(' | ')}`
    })
    return `【地点】\n${lines.join('\n')}`
  } catch { return '' }
}

async function loadFactionsPrompt(projectPath: string): Promise<string> {
  try {
    const data = await loadOutlineData<{ factions: OutlineFaction[] }>(projectPath, 'factions.json', { factions: [] })
    if (!data.factions?.length) return ''
    const lines = data.factions.map(f => {
      const fields = [f.name, f.type, f.description].filter(Boolean)
      return `- ${fields.join(' | ')}`
    })
    return `【势力】\n${lines.join('\n')}`
  } catch { return '' }
}

async function loadPowerSystemPrompt(projectPath: string): Promise<string> {
  try {
    const data = await loadOutlineData<PowerSystem>(projectPath, 'power_system.json', { name: '', levels: [], description: '' })
    if (!data.levels?.length) return ''
    const lines = data.levels.map(l => `- ${l.name}: ${l.description || ''}`)
    return `【等级体系：${data.name}】\n${lines.join('\n')}`
  } catch { return '' }
}

async function loadEmotionPrompt(projectPath: string): Promise<string> {
  try {
    const data = await loadOutlineData<EmotionData>(projectPath, 'emotion.json', { segments: [] })
    if (!data.segments?.length) return ''
    const lines = data.segments.map(s => `- 第${s.chapterStart}-${s.chapterEnd}章: ${s.dominantEmotion}${s.description ? ' — ' + s.description : ''}`)
    return `【情绪曲线】\n${lines.join('\n')}`
  } catch { return '' }
}

async function loadForeshadowingPrompt(projectPath: string): Promise<string> {
  try {
    const data = await loadOutlineData<{ foreshadowing: ForeshadowItem[] }>(projectPath, 'outline_meta.json', { foreshadowing: [] })
    if (!data.foreshadowing?.length) return ''
    const lines = data.foreshadowing.map(f => {
      const fields = [f.description, f.status].filter(Boolean)
      return `- ${fields.join(' | 状态: ')}`
    })
    return `【伏笔】\n${lines.join('\n')}`
  } catch { return '' }
}

async function loadPlotThreadsPrompt(projectPath: string): Promise<string> {
  try {
    const data = await loadOutlineData<{ plotThreads: PlotThread[] }>(projectPath, 'outline_meta.json', { plotThreads: [] })
    if (!data.plotThreads?.length) return ''
    const lines = data.plotThreads.map(t => {
      const fields = [t.name, t.type].filter(Boolean)
      return `- ${fields.join(' | ')}`
    })
    return `【故事线】\n${lines.join('\n')}`
  } catch { return '' }
}

export interface LoadedOutlineDimensions {
  items: string
  locations: string
  factions: string
  powerSystem: string
  emotion: string
  foreshadowing: string
  plotThreads: string
}

export async function loadOutlineDimensions(
  projectPath: string,
  toggles: OutlineTabToggles,
): Promise<LoadedOutlineDimensions> {
  const results: LoadedOutlineDimensions = {
    items: '', locations: '', factions: '', powerSystem: '',
    emotion: '', foreshadowing: '', plotThreads: '',
  }
  const tasks: Promise<void>[] = []
  if (toggles.items) tasks.push(loadItemsPrompt(projectPath).then(r => { results.items = r }))
  if (toggles.locations) tasks.push(loadLocationsPrompt(projectPath).then(r => { results.locations = r }))
  if (toggles.factions) tasks.push(loadFactionsPrompt(projectPath).then(r => { results.factions = r }))
  if (toggles.powerSystem) tasks.push(loadPowerSystemPrompt(projectPath).then(r => { results.powerSystem = r }))
  if (toggles.emotion) tasks.push(loadEmotionPrompt(projectPath).then(r => { results.emotion = r }))
  if (toggles.foreshadowing) tasks.push(loadForeshadowingPrompt(projectPath).then(r => { results.foreshadowing = r }))
  if (toggles.plotThreads) tasks.push(loadPlotThreadsPrompt(projectPath).then(r => { results.plotThreads = r }))
  await Promise.all(tasks)
  return results
}
