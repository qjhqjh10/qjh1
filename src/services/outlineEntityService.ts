// ── 大纲实体 CRUD 服务（v16.4.1）──
// entities 部分的统一读写：outline/<sectionKey>/<实体id>.yaml，每实体一个文件。
// id = 文件名（去扩展名）——唯一事实来源（同角色约定，AI 生成文件内容里 id 不可信）。
// 兼容读取：readAndMigrate 自动处理 .json → .yaml。

import { fileService } from '@/services/fileService'
import { logError } from '@/utils/logger'
import { readAndMigrate, outlineSectionDir, outlineEntityPath } from '@/utils/filePaths'
import { tryParseJsonOrYaml, yamlStringify } from '@/utils/yamlUtils'
import type { OutlineEntity } from '@/types/outline'

/** 文件名净化：实体文件名 = 名称（或主字段）的 URL/文件安全形态 */
export function safeEntityName(raw: string, maxLen = 40): string {
  const cleaned = raw.trim().replace(/[\\/:*?"<>|\r\n]/g, '_').replace(/\s+/g, ' ').slice(0, maxLen)
  return cleaned || `entity_${Date.now().toString(36)}`
}

/** 读取某个部分目录下的全部实体（yaml/json 自动迁移） */
export async function listEntities(projectPath: string, sectionKey: string): Promise<OutlineEntity[]> {
  try {
    const dir = outlineSectionDir(projectPath, sectionKey)
    const files = await fileService.listDir(dir)
    const dataFiles = files.filter(f => f.endsWith('.yaml') || f.endsWith('.yml') || f.endsWith('.json'))
    const entities: OutlineEntity[] = []
    const seen = new Set<string>()

    for (const file of dataFiles) {
      const baseName = file.replace(/\.(json|ya?ml)$/, '')
      if (seen.has(baseName)) continue
      seen.add(baseName)
      try {
        const migrated = await readAndMigrate(
          p => fileService.read(p).catch(() => null),
          (p, c) => fileService.write(p, c),
          dir, baseName,
        )
        if (!migrated) continue
        const parsed = tryParseJsonOrYaml(migrated.content)
        if (!parsed) continue
        const entity = parsed.obj as Record<string, unknown>
        entities.push({ id: baseName, ...entity })
      } catch (err) { logError(`跳过无效实体文件: ${file}`, err) }
    }
    return entities
  } catch (err) {
    // 目录不存在（部分新建后未创建过实体）→ 空列表
    return []
  }
}

/** 保存实体（新建或覆盖；id 决定文件名） */
export async function saveEntity(projectPath: string, sectionKey: string, entityId: string, data: Record<string, unknown>): Promise<void> {
  await fileService.ensureDir(outlineSectionDir(projectPath, sectionKey))
  await fileService.write(outlineEntityPath(projectPath, sectionKey, entityId), yamlStringify(data))
}

export async function deleteEntity(projectPath: string, sectionKey: string, entityId: string): Promise<void> {
  try {
    await fileService.deleteFile(outlineEntityPath(projectPath, sectionKey, entityId))
  } catch (err) { logError('删除实体失败', err) }
}
