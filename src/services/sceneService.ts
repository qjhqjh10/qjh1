import { fileService } from '@/services/fileService'
import { logError } from '@/utils/logger'
import { tryParseJsonOrYaml, yamlStringify } from '@/utils/yamlUtils'
import { readAndMigrate } from '@/utils/filePaths'
import type { ChapterSceneConfig } from '@/types/story'

const SCENES_DIR = 'scenes'

function sceneDir(projectPath: string): string {
  return `${projectPath}/${SCENES_DIR}`
}

export const sceneService = {
  async loadChapterSceneConfig(projectPath: string, chapterId: string): Promise<ChapterSceneConfig | null> {
    try {
      const migrated = await readAndMigrate(
        p => fileService.read(p).catch(() => null),
        (p, c) => fileService.write(p, c),
        sceneDir(projectPath),
        chapterId,
      )
      if (migrated) {
        const parsed = tryParseJsonOrYaml(migrated.content)
        if (parsed) return parsed.obj as ChapterSceneConfig
      }
      return null
    } catch (e) {
      logError(`加载场景配置失败: ${chapterId}`, e)
      return null
    }
  },

  async saveChapterSceneConfig(projectPath: string, config: ChapterSceneConfig): Promise<void> {
    try {
      await fileService.ensureDir(sceneDir(projectPath))
      const toSave = { ...config, updatedAt: new Date().toISOString() }
      await fileService.write(`${sceneDir(projectPath)}/${config.chapterId}.yaml`, yamlStringify(toSave))
    } catch (e) {
      logError(`保存场景配置失败: ${config.chapterId}`, e)
      throw e
    }
  },

  async deleteChapterSceneConfig(projectPath: string, chapterId: string): Promise<void> {
    try {
      await fileService.deleteFile(`${sceneDir(projectPath)}/${chapterId}.yaml`)
    } catch (e) {
      logError(`删除场景配置失败: ${chapterId}`, e)
      throw e
    }
  },

  async listSceneConfigs(projectPath: string): Promise<ChapterSceneConfig[]> {
    try {
      const files = await fileService.listDir(sceneDir(projectPath))
      const configs: ChapterSceneConfig[] = []
      for (const file of files) {
        if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue
        try {
          const raw = await fileService.read(`${sceneDir(projectPath)}/${file}`)
          const parsed = tryParseJsonOrYaml(raw, 'yaml')
          if (parsed) configs.push(parsed.obj as ChapterSceneConfig)
        } catch (err) { logError(`跳过无效场景配置: ${file}`, err) }
      }
      return configs
    } catch {
      return []
    }
  },
}
