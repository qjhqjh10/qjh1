import { fileService } from '@/services/fileService'
import { logError } from '@/utils/logger'
import { tryParseJsonOrYaml, yamlStringify } from '@/utils/yamlUtils'
import { readAndMigrate, sceneConfigPath } from '@/utils/filePaths'
import type { ChapterSceneConfig } from '@/types/story'

export const sceneService = {
  async loadChapterSceneConfig(projectPath: string, chapterId: string): Promise<ChapterSceneConfig | null> {
    try {
      const migrated = await readAndMigrate(
        p => fileService.read(p).catch(() => null),
        (p, c) => fileService.write(p, c),
        `${projectPath}/scenes`,
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
      await fileService.ensureDir(`${projectPath}/scenes`)
      const toSave = { ...config, updatedAt: new Date().toISOString() }
      await fileService.write(sceneConfigPath(projectPath, config.chapterId), yamlStringify(toSave))
    } catch (e) {
      logError(`保存场景配置失败: ${config.chapterId}`, e)
      throw e
    }
  },

  async deleteChapterSceneConfig(projectPath: string, chapterId: string): Promise<void> {
    try {
      await fileService.deleteFile(sceneConfigPath(projectPath, chapterId))
    } catch (e) {
      logError(`删除场景配置失败: ${chapterId}`, e)
      throw e
    }
  },

  async listSceneConfigs(projectPath: string): Promise<ChapterSceneConfig[]> {
    try {
      const files = await fileService.listDir(`${projectPath}/scenes`)
      const configs: ChapterSceneConfig[] = []
      for (const file of files) {
        if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue
        try {
          const raw = await fileService.read(`${projectPath}/scenes/${file}`)
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
