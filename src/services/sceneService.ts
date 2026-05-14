import { fileService } from '@/services/fileService'
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
    } catch {
      return null
    }
  },

  async saveChapterSceneConfig(projectPath: string, config: ChapterSceneConfig): Promise<void> {
    await fileService.ensureDir(`${projectPath}/${SCENES_DIR}`)
    config.updatedAt = new Date().toISOString()
    await fileService.write(sceneFilePath(projectPath, config.chapterId), JSON.stringify(config, null, 2))
  },

  async deleteChapterSceneConfig(projectPath: string, chapterId: string): Promise<void> {
    await fileService.deleteFile(sceneFilePath(projectPath, chapterId))
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
        } catch { /* skip invalid */ }
      }
      return configs
    } catch {
      return []
    }
  },
}
