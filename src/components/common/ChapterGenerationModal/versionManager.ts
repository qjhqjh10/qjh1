import { fileService } from '@/services/fileService'
import type { VersionRecord } from './types'
import type { OutlineTabToggles, DetailedOutlineToggles } from '@/types/settings'

export async function saveVersionRecord(projectPath: string, chapterId: string, record: VersionRecord) {
  const id = `v_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const version = { ...record, versionId: id }
  const dir = `${projectPath}/chapters/${chapterId}_versions`
  await fileService.ensureDir(dir)
  await fileService.write(`${dir}/${id}.json`, JSON.stringify(version, null, 2))
  return id
}

export interface SaveVersionOptions {
  chapterId: string
  config: { id: string; model: string; temperature: number }
  reply: string
  usage: { input: number; output: number; total: number }
  cost: number
  chapterPrompt: { title: string; content: string } | undefined
  outlineTabs: OutlineTabToggles
  detailedOutlineFields: DetailedOutlineToggles
  selectedKbFileIds: Set<string>
  projectPath: string
  onVersionSaved: (version: VersionRecord) => void
}

export async function saveVersion(opts: SaveVersionOptions): Promise<void> {
  const { chapterId, config, reply, usage, cost, chapterPrompt, outlineTabs,
    detailedOutlineFields, selectedKbFileIds, projectPath, onVersionSaved } = opts

  const record: VersionRecord = {
    versionId: '',
    chapterId,
    modelConfigId: config.id,
    modelName: config.model,
    temperature: config.temperature,
    promptTitle: chapterPrompt?.title || '默认章节模板',
    promptContent: chapterPrompt?.content || '',
    generatedContent: reply,
    tokens: usage,
    cost,
    generatedAt: new Date().toISOString(),
    contextUsed: [
      outlineTabs.plot ? 'outline_plot' : '',
      outlineTabs.worldbuilding ? 'outline_worldbuilding' : '',
      outlineTabs.characters ? 'outline_characters' : '',
      outlineTabs.items ? 'outline_items' : '',
      outlineTabs.locations ? 'outline_locations' : '',
      outlineTabs.factions ? 'outline_factions' : '',
      outlineTabs.powerSystem ? 'outline_powerSystem' : '',
      outlineTabs.foreshadowing ? 'outline_foreshadowing' : '',
      outlineTabs.emotion ? 'outline_emotion' : '',
      outlineTabs.plotThreads ? 'outline_plotThreads' : '',
      detailedOutlineFields.plotOverview ? 'detail_plotOverview' : '',
      detailedOutlineFields.chapterCharacters ? 'detail_characters' : '',
      detailedOutlineFields.location ? 'detail_location' : '',
      detailedOutlineFields.keyEvents ? 'detail_keyEvents' : '',
      detailedOutlineFields.eroticContent ? 'detail_eroticContent' : '',
      selectedKbFileIds.size > 0 ? 'kb_files' : '',
    ].filter(Boolean),
  }

  if (projectPath) {
    await saveVersionRecord(projectPath, chapterId, record)
  }
  onVersionSaved(record)
}
