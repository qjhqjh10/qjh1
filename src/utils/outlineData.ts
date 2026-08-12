import { fileService } from '@/services/fileService'
import { logError } from '@/utils/logger'
import { tryParseJsonOrYaml, yamlStringify } from '@/utils/yamlUtils'
import { readAndMigrate } from '@/utils/filePaths'
import { listEntities } from '@/services/outlineEntityService'
import type { OutlineTabToggles } from '@/types/settings'
import type { OutlineItem, OutlineLocation, OutlineFaction, PowerSystem, EmotionData } from '@/types/outline'
import type { ForeshadowItem, PlotThread } from '@/types/story'

const OUTLINE_DIR = (pp: string) => `${pp}/outline`

export async function loadOutlineData<T>(projectPath: string, baseName: string, defaultValue: T): Promise<T> {
  try {
    const migrated = await readAndMigrate(
      p => fileService.read(p).catch(() => null),
      (p, c) => fileService.write(p, c),
      OUTLINE_DIR(projectPath),
      baseName,
    )
    if (migrated) {
      const parsed = tryParseJsonOrYaml(migrated.content)
      if (parsed) return parsed.obj as T
    }
  } catch (err) { logError(`Failed to load outline data: ${baseName}`, err) }
  return defaultValue
}

export async function saveOutlineData<T>(projectPath: string, baseName: string, data: T): Promise<void> {
  try {
    await fileService.ensureDir(OUTLINE_DIR(projectPath))
    await fileService.write(`${OUTLINE_DIR(projectPath)}/${baseName}.yaml`, yamlStringify(data))
  } catch (err) {
    logError(`Failed to save outline data: ${baseName}`, err)
  }
}

// ---- Prompt-building helpers for each outline dimension ----
// v16.4.1: 实体部分已改为每实体一文件（outline/<部分>/），优先读新目录；
// 旧平铺 yaml 仍作兼容回退（迁移后旧文件保留）。

async function loadItemsPrompt(projectPath: string, filter?: string[]): Promise<string> {
  try {
    const entities = await listEntities(projectPath, 'items')
    if (entities.length === 0) {
      const data = await loadOutlineData<{ items: OutlineItem[] }>(projectPath, 'items', { items: [] })
      if (!data.items?.length) return ''
      const lines = data.items.map(item => {
        const fields = [item.name, item.type, item.grade, item.ability, item.owner].filter(Boolean)
        return `- ${fields.join(' | ')}`
      })
      return `【道具】\n${lines.join('\n')}`
    }
    const selected = filter ? entities.filter(e => filter.includes(e.id)) : entities
    if (selected.length === 0) return ''
    const lines = selected.map(item => {
      const fields = [item.name, item.type, item.grade, item.ability, item.owner].filter(Boolean)
      return `- ${fields.join(' | ')}`
    })
    return `【道具】\n${lines.join('\n')}`
  } catch (err) { logError('Failed to load items prompt', err); return '' }
}

async function loadLocationsPrompt(projectPath: string, filter?: string[]): Promise<string> {
  try {
    const entities = await listEntities(projectPath, 'locations')
    if (entities.length === 0) {
      const data = await loadOutlineData<{ locations: OutlineLocation[] }>(projectPath, 'locations', { locations: [] })
      if (!data.locations?.length) return ''
      const lines = data.locations.map(loc => {
        const fields = [loc.name, loc.type, loc.description].filter(Boolean)
        return `- ${fields.join(' | ')}`
      })
      return `【地点】\n${lines.join('\n')}`
    }
    const selected = filter ? entities.filter(e => filter.includes(e.id)) : entities
    if (selected.length === 0) return ''
    const lines = selected.map(loc => {
      const fields = [loc.name, loc.type, loc.description].filter(Boolean)
      return `- ${fields.join(' | ')}`
    })
    return `【地点】\n${lines.join('\n')}`
  } catch (err) { logError('Failed to load outline prompt', err); return '' }
}

async function loadFactionsPrompt(projectPath: string, filter?: string[]): Promise<string> {
  try {
    const entities = await listEntities(projectPath, 'factions')
    if (entities.length === 0) {
      const data = await loadOutlineData<{ factions: OutlineFaction[] }>(projectPath, 'factions', { factions: [] })
      if (!data.factions?.length) return ''
      const lines = data.factions.map(f => {
        const fields = [f.name, f.type, f.description].filter(Boolean)
        return `- ${fields.join(' | ')}`
      })
      return `【势力】\n${lines.join('\n')}`
    }
    const selected = filter ? entities.filter(e => filter.includes(e.id)) : entities
    if (selected.length === 0) return ''
    const lines = selected.map(f => {
      const fields = [f.name, f.type, f.description].filter(Boolean)
      return `- ${fields.join(' | ')}`
    })
    return `【势力】\n${lines.join('\n')}`
  } catch (err) { logError('Failed to load outline prompt', err); return '' }
}

/** 等级：新布局支持多体系（每个体系一个文件）；旧格式回退单体系 */
async function loadPowerSystemPrompt(projectPath: string, filter?: string[]): Promise<string> {
  try {
    const systems = await listEntities(projectPath, 'power_systems')
    if (systems.length === 0) {
      const data = await loadOutlineData<PowerSystem>(projectPath, 'power_system', { name: '', levels: [], description: '' })
      if (!data.levels?.length) return ''
      const lines = data.levels.map(l => `- ${l.name}: ${l.description || ''}`)
      return `【等级体系：${data.name}】\n${lines.join('\n')}`
    }
    const selected = filter ? systems.filter(e => filter.includes(e.id)) : systems
    if (selected.length === 0) return ''
    // levels 兼容两种形态：字符串（textarea 模板，每行一个等级）或旧数组 [{name,description}]
    const levelLines = (levels: unknown): string => {
      if (typeof levels === 'string') {
        return (levels as string).split('\n').map(l => l.trim()).filter(Boolean).map(l => `- ${l}`).join('\n')
      }
      if (Array.isArray(levels)) {
        return (levels as unknown[]).map(l => {
          if (typeof l === 'string') return `- ${l}`
          const o = l as { name?: string; description?: string }
          return `- ${o.name || ''}: ${o.description || ''}`
        }).join('\n')
      }
      return ''
    }
    const blocks = selected.map(sys => {
      const levelsText = levelLines(sys.levels)
      return `【等级体系：${sys.name || '未命名'}】\n${levelsText || (sys.description ? sys.description : '（空）')}`
    })
    return blocks.join('\n')
  } catch (err) { logError('Failed to load outline prompt', err); return '' }
}

async function loadEmotionPrompt(projectPath: string, filter?: string[]): Promise<string> {
  try {
    const segments = await listEntities(projectPath, 'emotions')
    if (segments.length === 0) {
      const data = await loadOutlineData<EmotionData>(projectPath, 'emotion', { segments: [] })
      if (!data.segments?.length) return ''
      const lines = data.segments.map(s => `- 第${s.chapterStart}-${s.chapterEnd}章: ${s.dominantEmotion}${s.description ? ' — ' + s.description : ''}`)
      return `【情绪曲线】\n${lines.join('\n')}`
    }
    const selected = filter ? segments.filter(e => filter.includes(e.id)) : segments
    if (selected.length === 0) return ''
    const lines = selected.map(s => `- 第${s.chapterStart}-${s.chapterEnd}章: ${s.dominantEmotion}${s.description ? ' — ' + s.description : ''}`)
    return `【情绪曲线】\n${lines.join('\n')}`
  } catch (err) { logError('Failed to load outline prompt', err); return '' }
}

async function loadForeshadowingPrompt(projectPath: string, filter?: string[]): Promise<string> {
  try {
    const foreshadows = await listEntities(projectPath, 'foreshadows')
    if (foreshadows.length === 0) {
      const data = await loadOutlineData<{ foreshadowing: ForeshadowItem[] }>(projectPath, 'outline_meta', { foreshadowing: [] })
      if (!data.foreshadowing?.length) return ''
      const lines = data.foreshadowing.map(f => {
        const fields = [
          f.description,
          f.plantChapterId && `埋设:${f.plantChapterId}`,
          f.payoffChapterId && `回收:${f.payoffChapterId}`,
          `状态:${f.status || 'planted'}`,
        ].filter(Boolean)
        return `- ${fields.join(' | ')}`
      })
      return `【伏笔】\n${lines.join('\n')}`
    }
    const selected = filter ? foreshadows.filter(e => filter.includes(e.id)) : foreshadows
    if (selected.length === 0) return ''
    const lines = selected.map(f => {
      const fields = [
        f.description,
        f.plantChapterId && `埋设:${f.plantChapterId}`,
        f.payoffChapterId && `回收:${f.payoffChapterId}`,
        `状态:${f.status || 'planted'}`,
      ].filter(Boolean)
      return `- ${fields.join(' | ')}`
    })
    return `【伏笔】\n${lines.join('\n')}`
  } catch (err) { logError('Failed to load outline prompt', err); return '' }
}

async function loadPlotThreadsPrompt(projectPath: string, filter?: string[]): Promise<string> {
  try {
    const threads = await listEntities(projectPath, 'threads')
    if (threads.length === 0) {
      const data = await loadOutlineData<{ plotThreads: PlotThread[] }>(projectPath, 'outline_meta', { plotThreads: [] })
      if (!data.plotThreads?.length) return ''
      const lines = data.plotThreads.map(t => {
        const fields = [t.name, t.type].filter(Boolean)
        return `- ${fields.join(' | ')}`
      })
      return `【故事线】\n${lines.join('\n')}`
    }
    const selected = filter ? threads.filter(e => filter.includes(e.id)) : threads
    if (selected.length === 0) return ''
    const lines = selected.map(t => {
      const fields = [t.name, t.type].filter(Boolean)
      return `- ${fields.join(' | ')}`
    })
    return `【故事线】\n${lines.join('\n')}`
  } catch (err) { logError('Failed to load outline prompt', err); return '' }
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

/** v16.4.1(用户决策): 维度键 → 部分 key 映射（屏蔽的部分不注入） */
const DIM_SECTION_MAP: Record<keyof LoadedOutlineDimensions, string> = {
  items: 'items',
  locations: 'locations',
  factions: 'factions',
  powerSystem: 'power_systems',
  emotion: 'emotions',
  foreshadowing: 'foreshadows',
  plotThreads: 'threads',
}

/**
 * 屏蔽的部分从维度注入中排除（sections.json 的 hidden 标记）。
 * 返回：被屏蔽的维度键集合（toggles 对应键应置 false）
 */
export async function hiddenOutlineDims(projectPath: string): Promise<Set<keyof LoadedOutlineDimensions>> {
  const hidden = new Set<keyof LoadedOutlineDimensions>()
  try {
    const { loadSections } = await import('@/services/outlineSectionService')
    const sections = await loadSections(projectPath)
    const hiddenKeys = new Set(sections.filter(s => s.hidden).map(s => s.key))
    for (const [dim, sectionKey] of Object.entries(DIM_SECTION_MAP)) {
      if (hiddenKeys.has(sectionKey)) hidden.add(dim as keyof LoadedOutlineDimensions)
    }
  } catch { /* sections 读取失败则不影响注入 */ }
  return hidden
}

/**
 * 加载大纲各维度参考文本。
 * @param entityFilter 部分 key → 实体 id 列表：存在 = 只注入勾选实体（空数组 = 该部分不注入）；
 *                     undefined/缺省 = 全部注入（现状语义）
 */
export async function loadOutlineDimensions(
  projectPath: string,
  toggles: OutlineTabToggles,
  entityFilter?: Record<string, string[]>,
): Promise<LoadedOutlineDimensions> {
  const results: LoadedOutlineDimensions = {
    items: '', locations: '', factions: '', powerSystem: '',
    emotion: '', foreshadowing: '', plotThreads: '',
  }
  // v16.4.1(用户决策): 屏蔽 = 不注入——hidden 部分对应维度强制关闭
  const hiddenDims = await hiddenOutlineDims(projectPath)
  const effective: OutlineTabToggles = { ...toggles }
  for (const dim of hiddenDims) {
    effective[dim as keyof OutlineTabToggles] = false
  }
  // 实体级过滤：维度键 → 部分 key
  const filterOf = (dimKey: keyof LoadedOutlineDimensions): string[] | undefined => {
    const sectionKey = DIM_SECTION_MAP[dimKey]
    return entityFilter ? entityFilter[sectionKey] : undefined
  }
  const tasks: Promise<void>[] = []
  if (effective.items) tasks.push(loadItemsPrompt(projectPath, filterOf('items')).then(r => { results.items = r }))
  if (effective.locations) tasks.push(loadLocationsPrompt(projectPath, filterOf('locations')).then(r => { results.locations = r }))
  if (effective.factions) tasks.push(loadFactionsPrompt(projectPath, filterOf('factions')).then(r => { results.factions = r }))
  if (effective.powerSystem) tasks.push(loadPowerSystemPrompt(projectPath, filterOf('powerSystem')).then(r => { results.powerSystem = r }))
  if (effective.emotion) tasks.push(loadEmotionPrompt(projectPath, filterOf('emotion')).then(r => { results.emotion = r }))
  if (effective.foreshadowing) tasks.push(loadForeshadowingPrompt(projectPath, filterOf('foreshadowing')).then(r => { results.foreshadowing = r }))
  if (effective.plotThreads) tasks.push(loadPlotThreadsPrompt(projectPath, filterOf('plotThreads')).then(r => { results.plotThreads = r }))
  await Promise.all(tasks)
  return results
}
