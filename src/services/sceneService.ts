import { fileService } from '@/services/fileService'
import { logError } from '@/utils/logger'
import type { ChapterSceneConfig } from '@/types/story'

const SCENES_DIR = 'scenes'

function sceneFilePath(projectPath: string, chapterId: string): string {
  return `${projectPath}/${SCENES_DIR}/${chapterId}.json`
}

export const sceneService = {
  async loadChapterSceneConfig(projectPath: string, chapterId: string): Promise<ChapterSceneConfig | null> {
    try {
      const raw = await fileService.read(sceneFilePath(projectPath, chapterId))
      return JSON.parse(raw) as ChapterSceneConfig
    } catch (e) {
      logError(`加载场景配置失败: ${chapterId}`, e)
      return null
    }
  },

  async saveChapterSceneConfig(projectPath: string, config: ChapterSceneConfig): Promise<void> {
    try {
      await fileService.ensureDir(`${projectPath}/${SCENES_DIR}`)
      const toSave = { ...config, updatedAt: new Date().toISOString() }
      await fileService.write(sceneFilePath(projectPath, config.chapterId), JSON.stringify(toSave, null, 2))
    } catch (e) {
      logError(`保存场景配置失败: ${config.chapterId}`, e)
      throw e
    }
  },

  async deleteChapterSceneConfig(projectPath: string, chapterId: string): Promise<void> {
    try {
      await fileService.deleteFile(sceneFilePath(projectPath, chapterId))
    } catch (e) {
      logError(`删除场景配置失败: ${chapterId}`, e)
      throw e
    }
  },

  async listSceneConfigs(projectPath: string): Promise<ChapterSceneConfig[]> {
    try {
      const files = await fileService.listDir(`${projectPath}/${SCENES_DIR}`)
      const configs: ChapterSceneConfig[] = []
      for (const file of files) {
        if (!file.endsWith('.json')) continue
        try {
          const raw = await fileService.read(`${projectPath}/${SCENES_DIR}/${file}`)
          configs.push(JSON.parse(raw) as ChapterSceneConfig)
        } catch (err) { logError(`跳过无效场景配置: ${file}`, err) }
      }
      return configs
    } catch {
      return []
    }
  },
}
